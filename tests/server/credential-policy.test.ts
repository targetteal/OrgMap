import { foundationDefaultAdmissionPolicy } from "../../server/src/admission.js";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { totpAt } from "../../server/src/mfa.js";
import { buildApp } from "../../server/src/app.js";
import { pool, transaction } from "../../server/src/db.js";
import { hashPassword } from "../../server/src/password.js";
import {
  evaluateCredentialPassword,
  CREDENTIAL_EVALUATOR_VERSION,
} from "../../server/src/credential-evaluator.js";
import type { CredentialPolicy } from "../../server/src/credential-policy-contract.js";
import type { ModuleRuntime } from "../../server/src/runtime.js";
const runtime = new URL(process.env.DATABASE_URL ?? "postgres://invalid/");
const operator = new URL(
  process.env.MIGRATION_DATABASE_URL ?? "postgres://invalid/",
);
if (
  !/^\/orgmap_credential_[a-f0-9]{16}$/.test(runtime.pathname) ||
  runtime.pathname !== operator.pathname ||
  runtime.host !== operator.host ||
  !["127.0.0.1", "localhost", "[::1]"].includes(runtime.hostname)
)
  throw Error("EXCLUSIVE_CREDENTIAL_POLICY_DATABASE_REQUIRED");
const directory = await mkdtemp(join(tmpdir(), "orgmap-credential-"));
process.env.ORGMAP_MFA_KEY_FILE = join(directory, "mfa.key");
await writeFile(
  process.env.ORGMAP_MFA_KEY_FILE,
  randomBytes(32).toString("hex"),
  { mode: 0o600 },
);
const authenticationPolicies = new Map<
  string,
  { mode: "ANY" | "SSO_REQUIRED"; connectionIds: string[] }
>();
const principals = new Map<string, any>();
const policies = new Map<string, CredentialPolicy>();
let core!: ModuleRuntime;
const app = await buildApp([
  foundationDefaultAdmissionPolicy,
  async (_app, value) => {
    core = value;
    const unsupported = async (): Promise<never> => {
      throw Error("PROVISIONING_NOT_IMPLEMENTED_BY_CREDENTIAL_FIXTURE");
    };
    core.registerProvisionedEnrollmentAuthority({
      validateSource: unsupported,
      revalidateSource: unsupported,
      verifyFederationProof: unsupported,
      bindFederatedIdentity: unsupported,
      authenticationPolicy: async (ctx) =>
        authenticationPolicies.get(ctx.org.id) ?? {
          mode: "ANY",
          connectionIds: [],
        },
      validateSessionProvenance: async () => false,
    });
    core.registerPrincipalResolver(
      async ({ token }) => principals.get(token) ?? null,
    );
    core.registerCredentialPolicyResolver(
      async (ctx) => policies.get(ctx.org.id) ?? null,
    );
  },
]);
after(async () => {
  await app.close();
  await pool.end();
  await rm(directory, { recursive: true, force: true });
});
const strong = "Árvore!Violeta-Estrela-Cobre-7429";
type User = { id: string; cookie: string; csrf: string };
async function call(
  method: any,
  path: string,
  payload?: any,
  user?: User,
  headers: any = {},
) {
  return app.inject({
    method,
    url: "/api/v1" + path,
    payload,
    headers: {
      origin: "http://localhost:5173",
      "idempotency-key": randomUUID(),
      ...(user ? { cookie: user.cookie, "x-csrf-token": user.csrf } : {}),
      ...headers,
    },
  });
}
function data(r: any) {
  assert.ok([200, 201].includes(r.statusCode), r.body);
  return r.json().data;
}
async function user(age?: Date | null): Promise<User> {
  const email = randomUUID() + "@example.test";
  let response;
  if (age !== undefined) {
    await pool.query(
      "INSERT INTO accounts(id,email,display_name,password_hash,credential_changed_at) VALUES($1,$2,$3,$4,$5)",
      [
        randomUUID(),
        email,
        "Credential fixture",
        await hashPassword(strong),
        age,
      ],
    );
    response = await call("POST", "/auth/login", { email, password: strong });
  } else
    response = await call("POST", "/auth/register", {
      email,
      password: strong,
      displayName: "Credential fixture",
    });
  const body = data(response);
  return {
    id: body.account.id,
    cookie: response.cookies[0].name + "=" + response.cookies[0].value,
    csrf: body.csrfToken,
  };
}
async function organization(a: User) {
  const result = data(
    await call("POST", "/organizations", { name: "Credential isolation" }, a),
  );
  const org = result.organization.id;
  const members = data(
    await call("GET", "/organizations/" + org + "/members", undefined, a),
  );
  return {
    org,
    member: members.items.find((m: any) => m.accountId === a.id).id,
    base: "/organizations/" + org,
  };
}
function policy(overrides: Partial<CredentialPolicy> = {}): CredentialPolicy {
  return {
    policyId: randomUUID(),
    revision: 1,
    complexity: true,
    strength: "HIGH",
    expirationDays: null,
    mfaEnforced: false,
    ...overrides,
  };
}
function denied(r: any) {
  assert.equal(r.statusCode, 403, r.body);
  assert.equal(r.json().error.code, "ORG_CREDENTIAL_REQUIREMENT_UNMET", r.body);
}
test("real estimator and Unicode complexity return minimal versioned verdicts", () => {
  const p = policy();
  assert.equal(evaluateCredentialPassword(strong, p).passed, true);
  const weak = evaluateCredentialPassword("Password123!", p);
  assert.equal(weak.passed, false);
  assert.ok(weak.reasons.includes("PASSWORD_STRENGTH_REQUIRED"));
  for (const password of [
    "abcdefghijklmnop",
    "UPPERCASE!LONGPASSWORD",
    "lowercase!longpassword",
    "Abcdefgh123456789",
    "Abcdefgh 123456789",
  ])
    assert.ok(
      evaluateCredentialPassword(password, p).reasons.includes(
        "PASSWORD_COMPLEXITY_REQUIRED",
      ),
    );
  const verdict = evaluateCredentialPassword(strong, p);
  assert.deepEqual(Object.keys(verdict).sort(), [
    "evaluatorVersion",
    "passed",
    "reasons",
  ]);
  assert.equal(verdict.evaluatorVersion, CREDENTIAL_EVALUATOR_VERSION);
});
test("org-local attestation binds credential, evaluator inputs and policy revisions; workers fail closed", async () => {
  const a = await user(),
    A = await organization(a),
    B = await organization(a),
    p = policy();
  policies.set(A.org, p);
  const token = randomUUID();
  principals.set(token, {
    accountId: a.id,
    organizationId: A.org,
    credentialId: randomUUID(),
    scopes: ["orgmap:read", "orgmap:write"],
  });
  const bearer = { authorization: "Bearer " + token, origin: "" };
  denied(
    await call("GET", A.base + "/bootstrap", undefined, undefined, bearer),
  );
  denied(await call("GET", A.base + "/bootstrap", undefined, a));
  assert.equal(
    (await call("GET", B.base + "/bootstrap", undefined, a)).statusCode,
    200,
  );
  assert.equal((await call("GET", "/account", undefined, a)).statusCode, 200);
  const requirements = data(
    await call("GET", A.base + "/security/requirements", undefined, a),
  );
  assert.ok(!JSON.stringify(requirements).includes(strong));
  const csrfDenied = await call(
    "POST",
    A.base + "/security/attest",
    { password: strong },
    a,
    { "x-csrf-token": "invalid" },
  );
  assert.equal(csrfDenied.statusCode, 403, csrfDenied.body);
  const arbitraryAccount = await call(
    "POST",
    A.base + "/security/attest",
    { password: strong, accountId: randomUUID() },
    a,
  );
  assert.equal(arbitraryAccount.statusCode, 400, arbitraryAccount.body);
  const wrong = await call(
    "POST",
    A.base + "/security/attest",
    { password: "wrong" },
    a,
  );
  assert.ok(wrong.statusCode >= 400, wrong.body);
  data(
    await call("POST", A.base + "/security/attest", { password: strong }, a),
  );
  assert.equal((await call("GET", A.base + "/bootstrap", undefined, a)).statusCode, 200);
  const before = (
    await pool.query(
      "SELECT credential_revision,credential_changed_at FROM accounts WHERE id=$1",
      [a.id],
    )
  ).rows[0];
  await pool.query(
    "UPDATE accounts SET display_name='Renamed',version=version+1 WHERE id=$1",
    [a.id],
  );
  const after = (
    await pool.query(
      "SELECT credential_revision,credential_changed_at FROM accounts WHERE id=$1",
      [a.id],
    )
  ).rows[0];
  assert.deepEqual(after, before);
  denied(await call("GET", A.base + "/bootstrap", undefined, a));
  denied(await call("GET", A.base + "/bootstrap", undefined, undefined, bearer));
  await assert.rejects(
    core.withWorkerContext(A.org, A.member, async () => "must not run"),
    (e: any) => e.code === "ORG_CREDENTIAL_REQUIREMENT_UNMET",
  );
  data(await call("POST", A.base + "/security/attest", { password: strong }, a));
  assert.equal(
    (await call("GET", A.base + "/bootstrap", undefined, a)).statusCode,
    200,
  );
  assert.equal(
    (await call("GET", A.base + "/bootstrap", undefined, undefined, bearer))
      .statusCode,
    200,
  );
  const replayKey = randomUUID(),
    writePath = A.base + "/circles",
    writeBody = {
      parentCircleId: data(
        await call("GET", A.base + "/bootstrap", undefined, a),
      ).rootCircleId,
      name: "Replay probe",
      mode: "DIRECT",
    };
  data(
    await call("POST", writePath, writeBody, a, {
      "idempotency-key": replayKey,
    }),
  );
  assert.equal(
    await core.withWorkerContext(A.org, A.member, async () => "allowed"),
    "allowed",
  );
  const rows = await transaction(async (c) => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
      A.org,
    ]);
    return (
      await c.query(
        "SELECT row_to_json(a) AS value FROM credential_attestations a WHERE organization_id=$1",
        [A.org],
      )
    ).rows;
  });
  assert.ok(rows.length > 0);
  assert.ok(!JSON.stringify(rows).includes(strong));
  assert.ok(!JSON.stringify(rows).includes("scrypt:"));
  assert.ok(!JSON.stringify(rows).includes("guesses"));
  policies.set(A.org, { ...p, revision: 2 });
  denied(
    await call("POST", writePath, writeBody, a, {
      "idempotency-key": replayKey,
    }),
  );
  denied(
    await call("GET", A.base + "/bootstrap", undefined, undefined, bearer),
  );
  denied(await call("GET", A.base + "/bootstrap", undefined, a));
  await assert.rejects(
    core.withWorkerContext(A.org, A.member, async () => "must not run"),
    (e: any) => e.code === "ORG_CREDENTIAL_REQUIREMENT_UNMET",
  );
  assert.equal(
    (await call("GET", B.base + "/bootstrap", undefined, a)).statusCode,
    200,
  );
  data(
    await call("POST", A.base + "/security/attest", { password: strong }, a),
  );
  await pool.query("UPDATE accounts SET password_hash=$2 WHERE id=$1", [
    a.id,
    await hashPassword("Outra!Senha-Laranja-Lunar-8274"),
  ]);
  const changed = (
    await pool.query("SELECT credential_revision FROM accounts WHERE id=$1", [
      a.id,
    ])
  ).rows[0];
  assert.equal(
    Number(changed.credential_revision),
    Number(before.credential_revision) + 1,
  );
  denied(await call("GET", A.base + "/bootstrap", undefined, a));
  assert.equal(
    (await call("GET", B.base + "/bootstrap", undefined, a)).statusCode,
    200,
  );
});
test("expired or legacy unknown age cannot be repaired by reattesting the same password", async () => {
  for (const age of [null, new Date(Date.now() - 91 * 86400000)]) {
    const a = await user(age),
      A = await organization(a),
      B = await organization(a);
    policies.set(A.org, policy({ expirationDays: 90 }));
    const before = (
      await pool.query(
        "SELECT credential_changed_at FROM accounts WHERE id=$1",
        [a.id],
      )
    ).rows[0];
    const result = await call(
      "POST",
      A.base + "/security/attest",
      { password: strong },
      a,
    );
    assert.ok(result.statusCode >= 400, result.body);
    denied(await call("GET", A.base + "/bootstrap", undefined, a));
    assert.equal(
      (await call("GET", B.base + "/bootstrap", undefined, a)).statusCode,
      200,
    );
    const after = (
      await pool.query(
        "SELECT credential_changed_at FROM accounts WHERE id=$1",
        [a.id],
      )
    ).rows[0];
    assert.deepEqual(after, before);
  }
});

test("Guest has narrow self attestation access, with no directory expansion", async () => {
  const owner = await user(),
    guest = await user(),
    A = await organization(owner);
  const membership = data(
    await call(
      "POST",
      A.base + "/members",
      { accountId: guest.id, memberType: "GUEST", accessPlan: [] },
      owner,
    ),
  ).membership;
  policies.set(A.org, policy());
  denied(await call("GET", A.base + "/bootstrap", undefined, guest));
  data(await call("GET", A.base + "/security/requirements", undefined, guest));
  data(
    await call(
      "POST",
      A.base + "/security/attest",
      { password: strong },
      guest,
    ),
  );
  assert.deepEqual(
    data(await call("GET", A.base + "/structure", undefined, guest)).nodes,
    [],
  );
  assert.deepEqual(
    data(await call("GET", A.base + "/members", undefined, guest)).items.map(
      (v: any) => v.id,
    ),
    [membership.id],
  );
  assert.equal(
    (await call("GET", A.base + "/bootstrap", undefined, owner)).statusCode,
    403,
  );
});
function decodeBase32(value: string) {
  let bits = 0,
    acc = 0;
  const bytes: number[] = [];
  for (const char of value) {
    acc = (acc << 5) | "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >>> bits) & 255);
    }
  }
  return Buffer.from(bytes);
}
test("MFA policy consumes real own TOTP/session proof and disabling factor invalidates only policy access", async () => {
  const a = await user(),
    A = await organization(a),
    B = await organization(a);
  policies.set(A.org, policy({ mfaEnforced: true }));
  const savedKey = process.env.ORGMAP_MFA_KEY_FILE;
  process.env.ORGMAP_MFA_KEY_FILE = join(directory, "absent.key");
  try {
    const unavailable = await call(
      "POST",
      A.base + "/security/attest",
      { password: strong },
      a,
    );
    assert.equal(unavailable.statusCode, 503, unavailable.body);
    assert.equal(unavailable.json().error.code, "MFA_CONFIGURATION_REQUIRED");
  } finally {
    process.env.ORGMAP_MFA_KEY_FILE = savedKey;
  }
  const missing = await call(
    "POST",
    A.base + "/security/attest",
    { password: strong },
    a,
  );
  assert.equal(missing.statusCode, 401, missing.body);
  assert.equal(missing.json().error.code, "MFA_VERIFICATION_REQUIRED");
  const enrollment = data(
    await call(
      "POST",
      "/account/mfa/enrollment/start",
      { currentPassword: strong },
      a,
    ),
  );
  const secret = decodeBase32(enrollment.secret),
    code = totpAt(secret, Math.floor(Date.now() / 30000));
  data(await call("POST", "/account/mfa/enrollment/confirm", { code }, a));
  data(
    await call("POST", A.base + "/security/attest", { password: strong }, a),
  );
  assert.equal(
    (await call("GET", A.base + "/bootstrap", undefined, a)).statusCode,
    200,
  );
  const email = (
    await pool.query("SELECT email FROM accounts WHERE id=$1", [a.id])
  ).rows[0].email;
  const login = await call("POST", "/auth/login", { email, password: strong });
  const sessionBody = data(login),
    second = {
      id: a.id,
      cookie: login.cookies[0].name + "=" + login.cookies[0].value,
      csrf: sessionBody.csrfToken,
    };
  denied(await call("GET", A.base + "/bootstrap", undefined, second));
  assert.equal(
    (await call("GET", B.base + "/bootstrap", undefined, second)).statusCode,
    200,
  );
  const fresh = totpAt(secret, Math.floor(Date.now() / 30000) + 1);
  data(
    await call(
      "POST",
      A.base + "/security/attest",
      { password: strong, totpCode: fresh },
      second,
    ),
  );
  assert.equal(
    (await call("GET", A.base + "/bootstrap", undefined, second)).statusCode,
    200,
  );
  data(
    await call("POST", "/account/mfa/disable", { currentPassword: strong }, a),
  );
  denied(await call("GET", A.base + "/bootstrap", undefined, a));
  assert.equal(
    (await call("GET", B.base + "/bootstrap", undefined, a)).statusCode,
    200,
  );
  assert.equal((await call("GET", "/account", undefined, a)).statusCode, 200);
});
test(
  "same password cannot renew age; concurrent profile write and attestation finish with dedicated credential revision intact",
  { timeout: 10000 },
  async () => {
    const a = await user(),
      A = await organization(a);
    policies.set(A.org, policy());
    const before = (
      await pool.query(
        "SELECT credential_revision,credential_changed_at FROM accounts WHERE id=$1",
        [a.id],
      )
    ).rows[0];
    let account = data(await call("GET", "/account", undefined, a)).account;
    const unchanged = await call(
      "POST",
      "/auth/password",
      { currentPassword: strong, newPassword: strong },
      a,
      { "if-match": '"' + account.version + '"' },
    );
    assert.equal(unchanged.statusCode, 422, unchanged.body);
    assert.equal(unchanged.json().error.code, "PASSWORD_UNCHANGED");
    const results = await Promise.all([
      call("PATCH", "/account", { displayName: "Concurrent rename" }, a, {
        "if-match": '"' + account.version + '"',
      }),
      call("POST", A.base + "/security/attest", { password: strong }, a),
    ]);
    for (const result of results) data(result);
    assert.deepEqual(
      (
        await pool.query(
          "SELECT credential_revision,credential_changed_at FROM accounts WHERE id=$1",
          [a.id],
        )
      ).rows[0],
      before,
    );
    assert.equal(
      (await call("GET", A.base + "/bootstrap", undefined, a)).statusCode,
      200,
    );
  },
);

test("current SSO_REQUIRED denies worker and bearer old PASSWORD proof and methodless no-policy access", async () => {
  const a = await user(),
    A = await organization(a),
    B = await organization(a),
    p = policy();
  policies.set(A.org, p);
  data(
    await call("POST", A.base + "/security/attest", { password: strong }, a),
  );
  const token = randomUUID();
  principals.set(token, {
    accountId: a.id,
    organizationId: A.org,
    credentialId: randomUUID(),
    scopes: ["orgmap:read", "orgmap:write"],
  });
  const bearer = { authorization: "Bearer " + token, origin: "" };
  assert.equal(
    (await call("GET", A.base + "/bootstrap", undefined, undefined, bearer))
      .statusCode,
    200,
  );
  assert.equal(
    await core.withWorkerContext(A.org, A.member, async () => true),
    true,
  );
  authenticationPolicies.set(A.org, {
    mode: "SSO_REQUIRED",
    connectionIds: [randomUUID()],
  });
  const bearerBlocked = await call(
    "GET",
    A.base + "/bootstrap",
    undefined,
    undefined,
    bearer,
  );
  assert.equal(bearerBlocked.statusCode, 403, bearerBlocked.body);
  await assert.rejects(
    core.withWorkerContext(A.org, A.member, async () => "must not run"),
    (e: any) =>
      ["SSO_REQUIRED", "ORG_CREDENTIAL_REQUIREMENT_UNMET"].includes(e.code),
  );
  assert.equal(
    (await call("GET", B.base + "/bootstrap", undefined, a)).statusCode,
    200,
  );
  policies.delete(A.org);
  const methodless = await call(
    "GET",
    A.base + "/bootstrap",
    undefined,
    undefined,
    bearer,
  );
  assert.equal(methodless.statusCode, 403, methodless.body);
  assert.equal(methodless.json().error.code, "SSO_REQUIRED");
  await assert.rejects(
    core.withWorkerContext(A.org, A.member, async () => "must not run"),
    (e: any) => e.code === "SSO_REQUIRED",
  );
});
test("actual voluntary password change and queued-mail recovery increment credential revision and stale A while fresh sessions retain B", async () => {
  let a = await user();
  const A = await organization(a),
    B = await organization(a),
    email = (await pool.query("SELECT email FROM accounts WHERE id=$1", [a.id]))
      .rows[0].email;
  policies.set(A.org, policy());
  data(
    await call("POST", A.base + "/security/attest", { password: strong }, a),
  );
  const revision = async () =>
    Number(
      (
        await pool.query(
          "SELECT credential_revision FROM accounts WHERE id=$1",
          [a.id],
        )
      ).rows[0].credential_revision,
    );
  const firstRevision = await revision(),
    account = data(await call("GET", "/account", undefined, a)).account;
  const changedPassword = "Cobre!Ponte-Violeta-Lua-87496";
  const changed = await call(
    "POST",
    "/auth/password",
    { currentPassword: strong, newPassword: changedPassword },
    a,
    { "if-match": '"' + account.version + '"' },
  );
  data(changed);
  assert.equal(await revision(), firstRevision + 1);
  const loginChanged = await call("POST", "/auth/login", {
    email,
    password: changedPassword,
  });
  const changedSession = data(loginChanged);
  a = {
    id: a.id,
    cookie: loginChanged.cookies[0].name + "=" + loginChanged.cookies[0].value,
    csrf: changedSession.csrfToken,
  };
  denied(await call("GET", A.base + "/bootstrap", undefined, a));
  assert.equal(
    (await call("GET", B.base + "/bootstrap", undefined, a)).statusCode,
    200,
  );
  data(
    await call(
      "POST",
      A.base + "/security/attest",
      { password: changedPassword },
      a,
    ),
  );
  assert.equal(
    (await call("GET", A.base + "/bootstrap", undefined, a)).statusCode,
    200,
  );
  data(await call("POST", "/auth/recovery/request", { email }));
  // This exclusive fixture reads only its account's queued-mail token to model
  // possession. This is not an SMTP delivery assertion.
  const mail = (
    await pool.query(
      "SELECT token FROM account_mail WHERE account_id=$1 AND state='PENDING' ORDER BY id",
      [a.id],
    )
  ).rows;
  assert.equal(mail.length, 1);
  assert.equal(typeof mail[0].token, "string");
  const recoveredPassword = "Marfim!Lago-Estrela-Verde-95372";
  data(
    await call("POST", "/auth/recovery/complete", {
      token: mail[0].token,
      newPassword: recoveredPassword,
    }),
  );
  assert.equal(await revision(), firstRevision + 2);
  assert.equal((await call("GET", "/account", undefined, a)).statusCode, 401);
  const loginRecovered = await call("POST", "/auth/login", {
    email,
    password: recoveredPassword,
  });
  const recoveredSession = data(loginRecovered);
  a = {
    id: a.id,
    cookie:
      loginRecovered.cookies[0].name + "=" + loginRecovered.cookies[0].value,
    csrf: recoveredSession.csrfToken,
  };
  denied(await call("GET", A.base + "/bootstrap", undefined, a));
  assert.equal(
    (await call("GET", B.base + "/bootstrap", undefined, a)).statusCode,
    200,
  );
  data(
    await call(
      "POST",
      A.base + "/security/attest",
      { password: recoveredPassword },
      a,
    ),
  );
  assert.equal(
    (await call("GET", A.base + "/bootstrap", undefined, a)).statusCode,
    200,
  );
});
