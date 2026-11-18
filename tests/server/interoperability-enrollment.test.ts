import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import pg from "pg";
import { buildApp } from "../../server/src/app.js";
import { pool, transaction } from "../../server/src/db.js";
import type { ModuleRuntime } from "../../server/src/runtime.js";
import { createRuntime } from "../../server/src/runtime.js";
import { registerInteroperabilityWorkerAuthorization } from "../../server/modules/interoperability/worker-authorization.js";
import { startSmtpSink, sendLocalMail } from "../../server/src/smtp.js";
import { createInteroperability } from "../../server/modules/interoperability/index.js";
import type { FederationConfiguration } from "../../server/modules/interoperability/federation.js";
import type { EnrollmentConfiguration } from "../../server/modules/interoperability/enrollment-ports.js";
import { pkceChallenge } from "../../server/modules/interoperability/oidc.js";
import type { CredentialPolicy } from "../../server/src/credential-policy-contract.js";
import { defaultAdmissionPolicy, type AdmissionPolicy } from "../../server/src/admission-contract.js";
const admissionPolicies = new Map<string, AdmissionPolicy>();
const policies = new Map<string, CredentialPolicy>();
const oidc: FederationConfiguration = {},
  enrollment: EnrollmentConfiguration = {};
let core!: ModuleRuntime;
const app = await buildApp([
  createInteroperability(oidc, undefined, {}, {}, undefined, enrollment),
  async (_app, runtime) => {
    core = runtime;
    // Explicit test provider. Production registers the real Admin reader.
    core.registerAdmissionPolicyProvider({ resolve: async ({ organizationId }) => admissionPolicies.get(organizationId) ?? defaultAdmissionPolicy() });
    core.registerCredentialPolicyResolver(async ctx => policies.get(ctx.org.id) ?? null);
  },
]);
after(async () => {
  await app.close();
  await pool.end();
});
async function request(
  method: string,
  path: string,
  user?: any,
  payload?: any,
  headers: any = {},
) {
  return app.inject({
    method: method as any,
    url: "/api/v1" + path,
    headers: {
      origin: "http://localhost:5173",
      "idempotency-key": randomUUID(),
      ...(user ? { cookie: user.cookie, "x-csrf-token": user.csrf } : {}),
      ...headers,
    },
    payload,
  });
}
async function user() {
  const email = randomUUID() + "@example.test";
  const r = await request("POST", "/auth/register", undefined, {
    email,
    password: "enrollment-synthetic-123",
    displayName: "Enrollment existing",
  });
  assert.equal(r.statusCode, 201, r.body);
  return {
    id: r.json().data.account.id,
    email,
    cookie: r.cookies[0].name + "=" + r.cookies[0].value,
    csrf: r.json().data.csrfToken,
  };
}
const cookies = (...responses: any[]) => {
  const jar = new Map<string, string>();
  for (const response of responses)
    for (const c of response.cookies ?? [])
      if (c.value) jar.set(c.name, c.value);
  return [...jar].map(([name, value]) => name + "=" + value).join("; ");
};
test("SCIM pending enrollment activates only after real SMTP+OIDC PKCE/JWKS, isolates provider/account claims, explicit reauth, SSO provenance and deprovision across organizations", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "orgmap-enrollment-smtp-")),
    smtp = await startSmtpSink({ port: 0, directory }),
    smtpPort = (smtp.address() as any).port;
  const admin = new pg.Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const keys = await generateKeyPair("RS256"),
    jwk = await exportJWK(keys.publicKey);
  jwk.kid = "enrollment-local";
  let providerBase = "",
    subject = "immutable-free",
    emailClaim = "untrusted@example.test";
  let authEvidence: Record<string, unknown> = {};
  let emailVerifiedClaim = false;
  let tokenGate: Promise<void> | null = null,
    tokenEntered: (() => void) | null = null;
  const codes = new Map<
    string,
    {
      issuer: string;
      nonce: string;
      challenge: string;
      redirect: string;
      subject: string;
      email: string;
    }
  >();
  const idp = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, providerBase);
      if (url.pathname === "/jwks") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ keys: [jwk] }));
        return;
      }
      if (url.pathname === "/authorize-a" || url.pathname === "/authorize-b") {
        assert.equal(url.searchParams.get("client_id"), "enrollment-client");
        assert.equal(url.searchParams.get("code_challenge_method"), "S256");
        const code = randomUUID(),
          issuer =
            providerBase +
            (url.pathname.endsWith("a") ? "/issuer-a" : "/issuer-b");
        codes.set(code, {
          issuer,
          nonce: url.searchParams.get("nonce")!,
          challenge: url.searchParams.get("code_challenge")!,
          redirect: url.searchParams.get("redirect_uri")!,
          subject,
          email: emailClaim,
        });
        const callback = new URL(url.searchParams.get("redirect_uri")!);
        callback.searchParams.set("state", url.searchParams.get("state")!);
        callback.searchParams.set("code", code);
        res.writeHead(302, { Location: callback.href }).end();
        return;
      }
      if (url.pathname === "/token") {
        let bytes = "";
        for await (const chunk of req) bytes += chunk;
        const form = new URLSearchParams(bytes),
          code = codes.get(form.get("code") ?? "");
        assert.ok(code);
        assert.equal(pkceChallenge(form.get("code_verifier")!), code.challenge);
        assert.equal(form.get("redirect_uri"), code.redirect);
        codes.delete(form.get("code")!);
        if (tokenGate) {
          const gate = tokenGate;
          tokenEntered?.();
          await gate;
        }
        const jwt = await new SignJWT({
          ...authEvidence,
          nonce: code.nonce,
          email: code.email,
          email_verified: emailVerifiedClaim,
        })
          .setProtectedHeader({ alg: "RS256", kid: "enrollment-local" })
          .setSubject(code.subject)
          .setIssuer(code.issuer)
          .setAudience("enrollment-client")
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(keys.privateKey);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ id_token: jwt }));
        return;
      }
      res.writeHead(404).end();
    } catch {
      res.writeHead(400).end();
    }
  });
  await new Promise<void>((resolve) => idp.listen(0, "127.0.0.1", resolve));
  providerBase = "http://127.0.0.1:" + (idp.address() as any).port;
  try {
    const owner = await user(),
      existing = await user(),
      org = await request("POST", "/organizations", owner, {
        name: "Enrollment isolated tenant",
      });
    assert.equal(org.statusCode, 201, org.body);
    const orgId = org.json().data.organization.id,
      p = "/organizations/" + orgId + "/interoperability";
    async function connection(letter: "a" | "b") {
      const result = await request("POST", p + "/connections", owner, {
        provider: "OIDC",
        label: "Local IdP " + letter,
      });
      assert.equal(result.statusCode, 200, result.body);
      const id = result.json().data.connection.id,
        key = orgId + ":" + id;
      oidc[key] = {
        issuer: providerBase + "/issuer-" + letter,
        clientId: "enrollment-client",
        authorizationEndpoint: providerBase + "/authorize-" + letter,
        tokenEndpoint: providerBase + "/token",
        jwksUri: providerBase + "/jwks",
        redirectUri:
          "http://localhost:3001/api/v1" +
          p +
          "/connections/" +
          id +
          "/oidc/callback",
        allowLocalHttp: true,
      };
      enrollment[key] = {
        issuer: oidc[key].issuer,
        claim: "sub",
        mappingRevision: 1,
        externalIdToValue: {},
      };
      const credential = await request("POST", p + "/credentials", owner, {
        label: "SCIM " + letter,
        kind: "SCIM",
        connectionId: id,
        scopes: ["members.provision"],
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      });
      assert.equal(credential.statusCode, 200, credential.body);
      return {
        id,
        key,
        headers: { authorization: "Bearer " + credential.json().data.secret },
      };
    }
    const a = await connection("a"),
      b = await connection("b"),
      freeEmail = randomUUID() + "@example.test";
    for (const field of ["memberType", "requestedMemberType", "orgRole", "accountId", "source", "admissionSource", "operation", "verified"]) {
      const deniedType = await request("POST", p + "/scim/v2/Users", undefined, {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        externalId: "forbidden-type-" + field,
        userName: "forbidden-" + field,
        emails: [{ value: randomUUID() + "@example.test" }],
        active: true,
        [field]: field === "accountId" ? owner.id : "GUEST",
      }, a.headers);
      assert.equal(deniedType.statusCode, 400, deniedType.body);
    }
    async function create(
      source: typeof a,
      externalId: string,
      email: string,
      immutable: string,
    ) {
      enrollment[source.key].externalIdToValue[externalId] = immutable;
      const payload = {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        externalId,
        userName: "user-" + externalId,
        emails: [{ value: email, primary: true }],
        active: true,
      };
      const result = await request(
        "POST",
        p + "/scim/v2/Users",
        undefined,
        payload,
        source.headers,
      );
      assert.equal(result.statusCode, 201, result.body);
      const resource = result.json();
      assert.equal(
        resource["urn:orgmap:params:scim:schemas:extension:enrollment:2.0:User"]
          .provisioningState,
        "PENDING_ENROLLMENT",
      );
      assert.equal(
        resource["urn:orgmap:params:scim:schemas:extension:enrollment:2.0:User"]
          .effectiveAccess,
        false,
      );
      assert.ok(!result.body.includes("accountId"));
      const before = new Set(await readdir(directory));
      assert.equal(
        await core.deliverProvisionedEnrollmentMail(orgId, (mail) =>
          sendLocalMail(mail, smtpPort),
        ),
        1,
      );
      const files = (await readdir(directory)).filter(
        (file) => !before.has(file),
      );
      assert.equal(files.length, 1);
      const mail = await readFile(join(directory, files[0]), "utf8");
      assert.ok(mail.includes(email));
      const token = mail.match(/\r?\n([a-f0-9]{64})(?:\r?\n|$)/)![1];
      return { payload, resource, token };
    }
    async function prepare(token: string, receipt?: string) {
      const result = await request("POST", "/enrollments/prepare", undefined, {
        token,
        ...(receipt ? { existingAccountReauth: receipt } : {}),
      });
      assert.equal(result.statusCode, 200, result.body);
      assert.ok(!result.body.includes("accountId"));
      return result;
    }
    async function start(source: typeof a, prepared: any) {
      const response = await request(
        "POST",
        p + "/connections/" + source.id + "/enrollment/start",
        undefined,
        {},
        { cookie: cookies(prepared) },
      );
      assert.equal(response.statusCode, 200, response.body);
      const authorization = await fetch(response.json().data.authorizationUrl, {
        redirect: "manual",
      });
      assert.equal(authorization.status, 302);
      const callback = new URL(authorization.headers.get("location")!);
      const result = await request(
        "GET",
        callback.pathname.replace("/api/v1", "") + callback.search,
        undefined,
        undefined,
        { cookie: cookies(prepared, response) },
      );
      return { result, response, callback };
    }
    const pending = await create(
      a,
      "opaque-employee-free",
      freeEmail,
      "immutable-free",
    );
    assert.equal(
      Number(
        (
          await admin.query(
            "SELECT count(*) AS n FROM accounts WHERE email=$1",
            [freeEmail],
          )
        ).rows[0].n,
      ),
      0,
    );
    const noMailbox = await request(
      "POST",
      p + "/connections/" + a.id + "/enrollment/start",
      undefined,
      {},
    );
    assert.equal(noMailbox.statusCode, 401, noMailbox.body);
    const prepared = await prepare(pending.token);
    subject = "wrong-subject";
    const wrong = await start(a, prepared);
    assert.equal(wrong.result.statusCode, 401, wrong.result.body);
    assert.equal(
      Number(
        (
          await admin.query(
            "SELECT count(*) AS n FROM accounts WHERE email=$1",
            [freeEmail],
          )
        ).rows[0].n,
      ),
      0,
    );
    subject = "immutable-free";
    const activated = await start(a, prepared);
    assert.equal(activated.result.statusCode, 200, activated.result.body);
    const active = activated.result.json().data,
      session = {
        id: active.account.id,
        cookie: cookies(activated.result),
        csrf: active.csrfToken,
      };
    assert.equal(active.enrollment.provisioningState, "ACTIVE");
    assert.equal(active.account.email, freeEmail);
    const account = (
      await admin.query(
        "SELECT password_enabled,email_verified_at FROM accounts WHERE id=$1",
        [active.account.id],
      )
    ).rows[0];
    assert.equal(account.password_enabled, false);
    assert.ok(account.email_verified_at);
    const recovery = await request(
      "POST",
      "/auth/recovery/request",
      undefined,
      { email: freeEmail },
    );
    assert.equal(recovery.statusCode, 200, recovery.body);
    assert.equal(recovery.json().data.accepted, true);
    assert.equal(
      Number(
        (
          await admin.query(
            "SELECT count(*) AS n FROM password_recovery WHERE account_id=$1",
            [active.account.id],
          )
        ).rows[0].n,
      ),
      0,
    );
    assert.equal(
      (
        await admin.query("SELECT password_enabled FROM accounts WHERE id=$1", [
          active.account.id,
        ])
      ).rows[0].password_enabled,
      false,
    );
    const state = await request(
      "GET",
      p + "/scim/v2/Users/" + pending.resource.id,
      undefined,
      undefined,
      a.headers,
    );
    assert.equal(state.statusCode, 200, state.body);
    assert.equal(
      state.json()[
        "urn:orgmap:params:scim:schemas:extension:enrollment:2.0:User"
      ].effectiveAccess,
      true,
    );
    const ownerPolicy: CredentialPolicy = { policyId: randomUUID(), revision: 1, complexity: false, strength: "LOW", expirationDays: null, mfaEnforced: false };
    policies.set(orgId, ownerPolicy);
    assert.equal((await request("POST", "/organizations/" + orgId + "/security/attest", owner, { password: "enrollment-synthetic-123" })).statusCode, 200);
    assert.equal((await request("GET", p + "/scim/v2/Users", undefined, undefined, a.headers)).statusCode, 200);
    assert.equal(await core.withWorkerContext(orgId, org.json().data.membership.id, async () => true), true);
    enrollment[a.key].ssoRequired = true;
    assert.equal((await request("GET", p + "/scim/v2/Users", undefined, undefined, a.headers)).statusCode, 403);
    await assert.rejects(() => core.withWorkerContext(orgId, org.json().data.membership.id, async () => true));
    policies.delete(orgId);

    assert.equal(
      (await request("GET", "/organizations/" + orgId + "/structure", owner))
        .statusCode,
      403,
    );
    assert.equal(
      (await request("GET", "/organizations/" + orgId + "/structure", session))
        .statusCode,
      200,
    );
    const otherOrg = await request("POST", "/organizations", session, {
      name: "Other organization preserved",
    });
    assert.equal(otherOrg.statusCode, 201, otherOrg.body);
    const other = otherOrg.json().data.organization.id;
    // Re-enable ANY for the owner SCIM service; its PASSWORD provenance is not SSO.
    enrollment[a.key].ssoRequired = false;
    const suspended = await request(
      "PUT",
      p + "/scim/v2/Users/" + pending.resource.id,
      undefined,
      { ...pending.payload, active: false },
      { ...a.headers, "if-match": '"1"' },
    );
    assert.equal(suspended.statusCode, 200, suspended.body);
    assert.equal(
      (await request("GET", "/organizations/" + orgId + "/structure", session))
        .statusCode,
      404,
    );
    assert.equal(
      (await request("GET", "/organizations/" + other + "/structure", session))
        .statusCode,
      200,
    );
    const replay = await request(
      "GET",
      activated.callback.pathname.replace("/api/v1", "") +
        activated.callback.search,
      undefined,
      undefined,
      { cookie: cookies(prepared, activated.response) },
    );
    assert.equal(replay.statusCode, 401, replay.body);
    // Admission preserves the closed SCIM_ADMIN source and suspension provenance.
    const memberId = active.membership.id;
    async function memberState() {
      return (await admin.query("SELECT id,status,version,suspension_origin FROM members WHERE organization_id=$1 AND id=$2", [orgId, memberId])).rows[0];
    }
    async function setScimActive(active: boolean) {
      const current = await request("GET", p + "/scim/v2/Users/" + pending.resource.id, undefined, undefined, a.headers);
      assert.equal(current.statusCode, 200, current.body);
      return request("PUT", p + "/scim/v2/Users/" + pending.resource.id, undefined,
        { ...pending.payload, active }, { ...a.headers, "if-match": current.json().meta.version });
    }
    async function ownerState(status: "ACTIVE" | "SUSPENDED") {
      const current = await memberState();
      const updated = await request("PATCH", "/organizations/" + orgId + "/members/" + memberId, owner, { status }, { "if-match": '"' + current.version + '"' });
      assert.equal(updated.statusCode, 200, updated.body);
    }
    const accountSnapshot = (await admin.query("SELECT id,email,display_name,password_enabled,email_verified_at FROM accounts WHERE id=$1", [session.id])).rows[0];
    const otherMembership = (await admin.query("SELECT id,status,version,member_type FROM members WHERE organization_id=$1 AND account_id=$2", [other, session.id])).rows[0];
    assert.deepEqual((await memberState()).suspension_origin, { type: "SCIM", connectionId: a.id, externalId: pending.payload.externalId, mappingRevision: 1 });
    const sameSource = await setScimActive(true);
    assert.equal(sameSource.statusCode, 200, sameSource.body);
    assert.equal((await memberState()).status, "ACTIVE");
    assert.equal((await memberState()).suspension_origin, null);
    assert.equal((await setScimActive(false)).statusCode, 200);
    const ownOrigin = (await memberState()).suspension_origin;
    enrollment[a.key].mappingRevision = 2;
    const changedMapping = await setScimActive(true);
    assert.equal(changedMapping.statusCode, 403, changedMapping.body);
    assert.equal(changedMapping.json().detail, "SCIM_REACTIVATION_REQUIRES_OWNER");
    assert.deepEqual((await memberState()).suspension_origin, ownOrigin);
    enrollment[a.key].mappingRevision = 1;
    await ownerState("SUSPENDED");
    assert.deepEqual((await memberState()).suspension_origin, { type: "MANUAL" });
    assert.equal((await setScimActive(false)).statusCode, 200);
    assert.deepEqual((await memberState()).suspension_origin, { type: "MANUAL" });
    const manualDenied = await setScimActive(true);
    assert.equal(manualDenied.statusCode, 403, manualDenied.body);
    assert.equal(manualDenied.json().detail, "SCIM_REACTIVATION_REQUIRES_OWNER");
    // Legacy-null and foreign provenance are persisted fixture states, never inferred from email.
    for (const origin of [null, { type: "SCIM", connectionId: b.id, externalId: pending.payload.externalId, mappingRevision: 1 }]) {
      await admin.query("UPDATE members SET suspension_origin=$3 WHERE organization_id=$1 AND id=$2", [orgId, memberId, origin]);
      assert.equal((await setScimActive(false)).statusCode, 200);
      assert.deepEqual((await memberState()).suspension_origin, origin);
      const deniedOrigin = await setScimActive(true);
      assert.equal(deniedOrigin.statusCode, 403, deniedOrigin.body);
      assert.equal(deniedOrigin.json().detail, "SCIM_REACTIVATION_REQUIRES_OWNER");
      assert.equal((await memberState()).status, "SUSPENDED");
    }
    await ownerState("ACTIVE");
    assert.equal((await setScimActive(false)).statusCode, 200);
    assert.deepEqual((await admin.query("SELECT id,email,display_name,password_enabled,email_verified_at FROM accounts WHERE id=$1", [session.id])).rows[0], accountSnapshot);
    assert.deepEqual((await admin.query("SELECT id,status,version,member_type FROM members WHERE organization_id=$1 AND account_id=$2", [other, session.id])).rows[0], otherMembership);
    // Administrative provisioning is an explicit exception to public domain restrictions.
    admissionPolicies.set(orgId, { ...defaultAdmissionPolicy(), policyId: randomUUID(), revision: 1, registrationMode: "DOMAIN_RESTRICTED", allowedDomains: ["different.example"] });
    const occupied = await create(
      b,
      "opaque-existing",
      existing.email,
      "immutable-existing",
    );
    const noReauth = await prepare(occupied.token);
    subject = "immutable-existing";
    const denied = await start(b, noReauth);
    assert.equal(denied.result.statusCode, 409, denied.result.body);
    assert.equal(
      denied.result.json().error.code,
      "ACTIVATION_CONFIRMATION_REQUIRED",
    );
    const reauth = await request(
      "POST",
      "/enrollments/reauthenticate",
      existing,
      {
        token: occupied.token,
        confirmAccountLink: true,
        currentPassword: "enrollment-synthetic-123",
      },
    );
    assert.equal(reauth.statusCode, 200, reauth.body);
    const confirmation = await prepare(
      occupied.token,
      reauth.json().data.existingAccountReauth,
    );
    enrollment[b.key].ssoRequired = true;
    const linked = await start(b, confirmation);
    assert.equal(linked.result.statusCode, 200, linked.result.body);
    assert.equal(linked.result.json().data.account.id, existing.id);
    enrollment[b.key].ssoRequired = false;
    // Same global email at a different issuer/subject never auto-links.
    const secondIdp = await create(
      b,
      "opaque-other-idp",
      freeEmail,
      "different-issuer-subject",
    );
    const secondPrepared = await prepare(secondIdp.token);
    subject = "different-issuer-subject";
    const secondDenied = await start(b, secondPrepared);
    assert.equal(secondDenied.result.statusCode, 409, secondDenied.result.body);
    assert.equal(
      secondDenied.result.json().error.code,
      "ACTIVATION_CONFIRMATION_REQUIRED",
    );
    assert.equal(
      Number(
        (
          await admin.query(
            "SELECT count(*) AS n FROM accounts WHERE email=$1",
            [freeEmail],
          )
        ).rows[0].n,
      ),
      1,
    );
    // Registration commits while activation is awaiting a real IdP token response.
    const raceEmail = randomUUID() + "@example.test",
      racing = await create(
        a,
        "opaque-registration-race",
        raceEmail,
        "race-subject",
      ),
      racePrepared = await prepare(racing.token);
    subject = "race-subject";
    let releaseToken!: () => void;
    tokenGate = new Promise<void>((resolve) => {
      releaseToken = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      tokenEntered = resolve;
    });
    const activation = start(a, racePrepared);
    await entered;
    try {
      const registered = await request("POST", "/auth/register", undefined, {
        email: raceEmail,
        password: "race-registration-test-123",
        displayName: "Registered concurrently",
      });
      assert.equal(registered.statusCode, 201, registered.body);
    } finally {
      tokenGate = null;
      tokenEntered = null;
      releaseToken();
    }
    const raceDenied = await activation;
    assert.equal(raceDenied.result.statusCode, 409, raceDenied.result.body);
    assert.equal(
      raceDenied.result.json().error.code,
      "ACTIVATION_CONFIRMATION_REQUIRED",
    );
    assert.equal(
      Number(
        (
          await admin.query(
            "SELECT count(*) AS n FROM accounts WHERE email=$1",
            [raceEmail],
          )
        ).rows[0].n,
      ),
      1,
    );
    // Only the trusted server mapping may request a Guest enrollment.
    enrollment[b.key].requestedMemberType = "GUEST";
    const guestEmail = randomUUID() + "@example.test";
    const guestPending = await create(b, "opaque-trusted-guest", guestEmail, "immutable-guest");
    const guestPrepared = await prepare(guestPending.token);
    subject = "immutable-guest";
    const guestActivated = await start(b, guestPrepared);
    assert.equal(guestActivated.result.statusCode, 200, guestActivated.result.body);
    const guestAccountId = guestActivated.result.json().data.account.id;
    const guestMember = (await admin.query(
      "SELECT member_type FROM members WHERE organization_id=$1 AND account_id=$2",
      [orgId, guestAccountId],
    )).rows[0];
    assert.equal(guestMember.member_type, "GUEST");
    const guestSource = (await admin.query(
      "SELECT requested_member_type FROM interop_scim_sources WHERE organization_id=$1 AND external_id=$2",
      [orgId, "opaque-trusted-guest"],
    )).rows[0];
    assert.equal(guestSource.requested_member_type, "GUEST");
    // The real signed IdP, not the FEDERATED label, supplies MFA evidence.
    process.env.ORGMAP_MFA_KEY_FILE = join(directory, "mfa-test.key");
    await writeFile(process.env.ORGMAP_MFA_KEY_FILE, randomBytes(32).toString("hex"), { mode: 0o600 });
    enrollment[b.key].requestedMemberType = "MEMBER";
    const mfaEmail = randomUUID() + "@example.test";
    const mfaPending = await create(b, "opaque-mfa-member", mfaEmail, "immutable-mfa-member");
    subject = "immutable-mfa-member";
    const mfaActivated = await start(b, await prepare(mfaPending.token));
    assert.equal(mfaActivated.result.statusCode, 200, mfaActivated.result.body);
    function federatedSession(response: any) {
      const value = response.json().data;
      return { id: value.account.id, cookie: cookies(response), csrf: value.csrfToken };
    }
    let mfaSession = federatedSession(mfaActivated.result);
    const secondOrg = await request("POST", "/organizations", mfaSession, { name: "MFA isolation B" });
    assert.equal(secondOrg.statusCode, 201, secondOrg.body);
    const secondBase = "/organizations/" + secondOrg.json().data.organization.id;
    const securityBase = "/organizations/" + orgId + "/security/attest";
    const policy: CredentialPolicy = { policyId: randomUUID(), revision: 1, complexity: false, strength: "LOW", expirationDays: null, mfaEnforced: false };
    policies.set(orgId, policy);
    const withoutPassword = await request("POST", securityBase, mfaSession, {});
    assert.equal(withoutPassword.statusCode, 200, withoutPassword.body);
    assert.equal(withoutPassword.json().data.attested, true);
    policies.set(orgId, { ...policy, revision: 2, mfaEnforced: true });
    const labelOnly = await request("POST", securityBase, mfaSession, {});
    assert.equal(labelOnly.statusCode, 401, labelOnly.body);
    assert.equal(labelOnly.json().error.code, "MFA_VERIFICATION_REQUIRED");
    async function providerLogin() {
      const begun = await request("GET", p + "/connections/" + b.id + "/oidc/login");
      assert.equal(begun.statusCode, 200, begun.body);
      const authorize = await fetch((begun.json().data ?? begun.json()).authorizationUrl, { redirect: "manual" });
      const callback = new URL(authorize.headers.get("location")!);
      return request("GET", callback.pathname.replace("/api/v1", "") + callback.search, undefined, undefined, { cookie: cookies(begun) });
    }
    // Reauthentication is judged against PostgreSQL's clock. Anchor this
    // synthetic IdP assertion to that same clock so host/DB skew does not
    // turn the lock-isolation assertion into an unrelated freshness failure.
    const authTime = Math.floor(+new Date((await admin.query("SELECT clock_timestamp() AS now")).rows[0].now) / 1000) - 30;
    authEvidence = { amr: ["pwd", "otp"], auth_time: authTime };
    // The application and PostgreSQL may briefly disagree about the current time.
    const freshLogin = await (async () => {
      t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 10_000 });
      try { return await providerLogin(); }
      finally { t.mock.timers.reset(); }
    })();
    assert.equal(freshLogin.statusCode, 200, freshLogin.body);
    mfaSession = federatedSession(freshLogin);
    const sessionToken = freshLogin.cookies.find((c: any) => c.name === "orgmap_session")!.value;
    const stored = (await admin.query("SELECT auth_amr,auth_time FROM sessions WHERE token_hash=$1", [createHash("sha256").update(sessionToken).digest("hex")])).rows[0];
    assert.deepEqual(stored.auth_amr, ["pwd", "otp"]);
    assert.equal(+new Date(stored.auth_time), authTime * 1000);
    const primarySession = (await admin.query("SELECT id,auth_verified_at FROM sessions WHERE token_hash=$1", [createHash("sha256").update(sessionToken).digest("hex")])).rows[0];
    async function verifyPrimary() {
      return transaction(async c => {
        await c.query("SET LOCAL lock_timeout='250ms'");
        await c.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [mfaSession.id]);
        const now = (await c.query("SELECT clock_timestamp() AS now")).rows[0].now;
        const previous = (await c.query("SELECT current_setting('orgmap.organization_id',true) AS value")).rows[0].value ?? "";
        const valid = await core.verifyAccountFederatedReauthentication({ c, accountId: mfaSession.id, sessionId: primarySession.id, now });
        assert.equal((await c.query("SELECT current_setting('orgmap.organization_id',true) AS value")).rows[0].value ?? "", previous);
        return valid;
      });
    }
    assert.equal(await verifyPrimary(), true, "Synthetic federated session must be fresh before the lock-isolation proof");
    const heldOrganization = await admin.connect();
    try {
      await heldOrganization.query("BEGIN");
      await heldOrganization.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [orgId]);
      const validWhileLocked = await verifyPrimary();
      if (!validWhileLocked) {
        const diagnostic = (await admin.query(
          "SELECT clock_timestamp() AS db_now, auth_verified_at, auth_time, auth_method, auth_organization_id, auth_connection_id, auth_issuer FROM sessions WHERE id=$1",
          [primarySession.id],
        )).rows[0];
        assert.fail("Account-first verifier returned false while the organization lock was held; synthetic session diagnostic=" + JSON.stringify({
          dbNow: diagnostic?.db_now,
          verifiedAt: diagnostic?.auth_verified_at,
          authTime: diagnostic?.auth_time,
          method: diagnostic?.auth_method,
          organizationMatches: diagnostic?.auth_organization_id === orgId,
          connectionMatches: diagnostic?.auth_connection_id === b.id,
          issuerMatches: diagnostic?.auth_issuer === oidc[b.key]?.issuer,
        }));
      }
    } finally { await heldOrganization.query("ROLLBACK"); heldOrganization.release(); }
    const trustedConfiguration = oidc[b.key];
    delete oidc[b.key];
    assert.equal(await verifyPrimary(), false);
    oidc[b.key] = trustedConfiguration;
    await admin.query("UPDATE sessions SET auth_verified_at=clock_timestamp()-interval '6 minutes' WHERE id=$1", [primarySession.id]);
    assert.equal(await verifyPrimary(), false);
    await admin.query("UPDATE sessions SET auth_verified_at=$2 WHERE id=$1", [primarySession.id, primarySession.auth_verified_at]);
    assert.equal(await verifyPrimary(), true);
    for (const authenticatedAt of [null, new Date(Date.now() - 360000)]) {
      await admin.query("UPDATE sessions SET auth_time=$2 WHERE id=$1", [primarySession.id, authenticatedAt]);
      assert.equal(await verifyPrimary(), false, "fresh callback cannot replace recent authenticated provider auth_time");
    }
    await admin.query("UPDATE sessions SET auth_time=$2 WHERE id=$1", [primarySession.id, new Date(authTime * 1000)]);
    assert.equal(await verifyPrimary(), true);
    const attestedMfa = await request("POST", securityBase, mfaSession, {});
    assert.equal(attestedMfa.statusCode, 200, attestedMfa.body);
    enrollment[b.key].ssoRequired = true;
    const strictWorker = createRuntime();
    registerInteroperabilityWorkerAuthorization(strictWorker, { oidc, enrollment });
    await assert.rejects(() => strictWorker.withWorkerContext(orgId, org.json().data.membership.id, async () => true), (error: any) => error.code === "SSO_REQUIRED");
    const federatedWorker = createRuntime();
    federatedWorker.registerCredentialPolicyResolver(async ctx => policies.get(ctx.org.id) ?? null);
    registerInteroperabilityWorkerAuthorization(federatedWorker, { oidc, enrollment });
    assert.equal(await federatedWorker.withWorkerContext(orgId, mfaActivated.result.json().data.membership.id, async () => true), true);
    assert.equal((await request("GET", "/organizations/" + orgId + "/structure", mfaSession)).statusCode, 200);
    authEvidence = { amr: ["pwd"], auth_time: authTime };
    const secondSessionLogin = await providerLogin();
    assert.equal(secondSessionLogin.statusCode, 200, secondSessionLogin.body);
    const secondSession = federatedSession(secondSessionLogin);
    assert.equal((await request("GET", "/organizations/" + orgId + "/structure", secondSession)).statusCode, 403);
    const secondAttest = await request("POST", securityBase, secondSession, {});
    assert.equal(secondAttest.statusCode, 401, secondAttest.body);
    assert.equal(secondAttest.json().error.code, "MFA_VERIFICATION_REQUIRED");
    assert.equal((await request("GET", "/organizations/" + orgId + "/structure", mfaSession)).statusCode, 200);
    authEvidence = { amr: ["otp"], auth_time: authTime };
    const singleFactorLogin = await providerLogin();
    assert.equal(singleFactorLogin.statusCode, 200, singleFactorLogin.body);
    const singleFactorAttest = await request("POST", securityBase, federatedSession(singleFactorLogin), {});
    assert.equal(singleFactorAttest.statusCode, 401, singleFactorAttest.body);
    assert.equal(singleFactorAttest.json().error.code, "MFA_VERIFICATION_REQUIRED");
    authEvidence = { amr: ["mfa"], auth_time: authTime - 13 * 3600 };
    const staleLogin = await providerLogin();
    assert.equal(staleLogin.statusCode, 200, staleLogin.body);
    const staleAttest = await request("POST", securityBase, federatedSession(staleLogin), {});
    assert.equal(staleAttest.statusCode, 401, staleAttest.body);
    assert.equal(staleAttest.json().error.code, "MFA_VERIFICATION_REQUIRED");
    authEvidence = { amr: ["mfa"], auth_time: authTime + 3600 };
    const futureLogin = await providerLogin();
    assert.equal(futureLogin.statusCode, 401, futureLogin.body);
    assert.equal(futureLogin.json().error.code, "OIDC_CLAIMS_INVALID");
    // OPEN never turns normal federated login into JIT, even with signed email_verified.
    const savedAdmission = admissionPolicies.get(orgId)!;
    admissionPolicies.set(orgId, { ...savedAdmission, revision: savedAdmission.revision + 1, registrationMode: "OPEN" });
    const unboundEmail = randomUUID() + "@example.test";
    subject = "unbound-no-jit-" + randomUUID();
    emailClaim = unboundEmail;
    emailVerifiedClaim = true;
    authEvidence = { amr: ["mfa"], auth_time: Math.floor(Date.now() / 1000) };
    const noJit = await providerLogin();
    assert.equal(noJit.statusCode, 401, noJit.body);
    assert.equal(noJit.json().error.code, "FEDERATED_IDENTITY_NOT_LINKED");
    assert.equal(Number((await admin.query("SELECT count(*) AS n FROM accounts WHERE email=$1", [unboundEmail])).rows[0].n), 0);
    admissionPolicies.set(orgId, savedAdmission);
    subject = "immutable-mfa-member";
    emailVerifiedClaim = false;
    // Simulate upstream connection withdrawal as authoritative persisted state.
    // Voluntary local revoke protects the account's last login method separately.
    await admin.query("UPDATE interop_connections SET state='REVOKED' WHERE organization_id=$1 AND id=$2", [orgId, b.id]);
    assert.equal(await verifyPrimary(), false);
    await assert.rejects(() => federatedWorker.withWorkerContext(orgId, mfaActivated.result.json().data.membership.id, async () => true));
    assert.equal(await federatedWorker.withWorkerContext(secondOrg.json().data.organization.id, secondOrg.json().data.membership.id, async () => true), true);
    const revokedAttest = await request("POST", securityBase, mfaSession, {});
    assert.ok([401,403].includes(revokedAttest.statusCode), revokedAttest.body);
    assert.equal((await request("GET", secondBase + "/structure", mfaSession)).statusCode, 200);
    assert.equal((await admin.query("SELECT password_enabled FROM accounts WHERE id=$1", [mfaSession.id])).rows[0].password_enabled, false);
  } finally {
    await admin.end();
    await new Promise<void>((resolve, reject) =>
      idp.close((e) => (e ? reject(e) : resolve())),
    );
    await new Promise<void>((resolve, reject) =>
      smtp.close((e) => (e ? reject(e) : resolve())),
    );
    await rm(directory, { recursive: true, force: true });
  }
});
