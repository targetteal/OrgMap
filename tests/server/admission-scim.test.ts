import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import pg from "pg";
import { buildApp } from "../../server/src/app.js";
import { pool } from "../../server/src/db.js";
import type { ModuleRuntime } from "../../server/src/runtime.js";
import { startSmtpSink, sendLocalMail } from "../../server/src/smtp.js";
import { createInteroperability } from "../../server/modules/interoperability/index.js";
import type { FederationConfiguration } from "../../server/modules/interoperability/federation.js";
import type { EnrollmentConfiguration } from "../../server/modules/interoperability/enrollment-ports.js";
import { pkceChallenge } from "../../server/modules/interoperability/oidc.js";
import { readAdmissionPolicy } from "../../server/modules/administration/admission.js";

const runtimeUrl = new URL(process.env.DATABASE_URL ?? "postgres://invalid/"),
  operatorUrl = new URL(
    process.env.MIGRATION_DATABASE_URL ?? "postgres://invalid/",
  );
if (
  !/^\/orgmap_admission_scim_[a-f0-9]{16}$/.test(runtimeUrl.pathname) ||
  operatorUrl.pathname !== runtimeUrl.pathname ||
  operatorUrl.host !== runtimeUrl.host ||
  !["127.0.0.1", "localhost", "[::1]"].includes(runtimeUrl.hostname)
)
  throw Error("EXCLUSIVE_ADMISSION_SCIM_DATABASE_REQUIRED");
const admin = new pg.Pool({ connectionString: operatorUrl.href });
const oidc: FederationConfiguration = {},
  configuration: EnrollmentConfiguration = {};
let core!: ModuleRuntime;
const reads: string[] = [];
const app = await buildApp([
  createInteroperability(oidc, undefined, {}, {}, undefined, configuration),
  async (app, runtime) => {
    core = runtime;
    core.registerAdmissionPolicyProvider({
      resolve: async (input) => {
        reads.push(input.organizationId);
        return readAdmissionPolicy(input);
      },
    });
    app.get("/test/:organizationId/access", (r) =>
      core.tenant(r, false, async () => ({ ok: true })),
    );
  },
]);
after(async () => {
  await app.close();
  await pool.end();
  await admin.end();
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
function cookies(...responses: any[]) {
  const jar = new Map<string, string>();
  for (const response of responses)
    for (const c of response.cookies ?? [])
      if (c.value) jar.set(c.name, c.value);
  return [...jar].map(([k, v]) => k + "=" + v).join("; ");
}
async function register() {
  const email = randomUUID() + "@example.test";
  const result = await request("POST", "/auth/register", undefined, {
    email,
    password: "admission-scim-synthetic-123",
    displayName: "SCIM owner",
  });
  assert.equal(result.statusCode, 201, result.body);
  return {
    id: result.json().data.account.id,
    email,
    cookie: cookies(result),
    csrf: result.json().data.csrfToken,
  };
}

test("real SCIM authority and signed OIDC preserve suspension origin, current admission and global/B sessions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "orgmap-admission-scim-"));
  const smtp = await startSmtpSink({ port: 0, directory });
  const keys = await generateKeyPair("RS256"),
    jwk = await exportJWK(keys.publicKey);
  jwk.kid = "admission-scim-local";
  let providerBase = "",
    subject = "immutable-subject";
  const codes = new Map<
    string,
    {
      issuer: string;
      nonce: string;
      challenge: string;
      redirect: string;
      subject: string;
    }
  >();
  const idp = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, providerBase);
      res.setHeader("Content-Type", "application/json");
      if (url.pathname === "/jwks") {
        res.end(JSON.stringify({ keys: [jwk] }));
        return;
      }
      if (url.pathname === "/authorize-a" || url.pathname === "/authorize-b") {
        assert.equal(
          url.searchParams.get("client_id"),
          "admission-scim-client",
        );
        assert.equal(url.searchParams.get("code_challenge_method"), "S256");
        const code = randomUUID();
        codes.set(code, {
          issuer: providerBase + "/issuer-" + url.pathname.slice(-1),
          nonce: url.searchParams.get("nonce")!,
          challenge: url.searchParams.get("code_challenge")!,
          redirect: url.searchParams.get("redirect_uri")!,
          subject,
        });
        const callback = new URL(url.searchParams.get("redirect_uri")!);
        callback.searchParams.set("code", code);
        callback.searchParams.set("state", url.searchParams.get("state")!);
        res.writeHead(302, { Location: callback.href }).end();
        return;
      }
      if (url.pathname === "/token") {
        let bytes = "";
        for await (const chunk of req) bytes += chunk;
        const form = new URLSearchParams(bytes),
          code = codes.get(form.get("code") ?? "");
        assert.ok(code);
        codes.delete(form.get("code")!);
        assert.equal(pkceChallenge(form.get("code_verifier")!), code.challenge);
        assert.equal(form.get("redirect_uri"), code.redirect);
        const jwt = await new SignJWT({
          nonce: code.nonce,
          amr: ["pwd", "otp"],
          auth_time: Math.floor(Date.now() / 1000),
          email: "untrusted@example.test",
          email_verified: true,
        })
          .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
          .setSubject(code.subject)
          .setIssuer(code.issuer)
          .setAudience("admission-scim-client")
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(keys.privateKey);
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
    const owner = await register();
    const orgA = await request("POST", "/organizations", owner, {
      name: "SCIM provenance A",
    });
    const orgB = await request("POST", "/organizations", owner, {
      name: "SCIM provenance B",
    });
    assert.equal(orgA.statusCode, 201, orgA.body);
    assert.equal(orgB.statusCode, 201, orgB.body);
    const organizationId = orgA.json().data.organization.id,
      otherOrg = orgB.json().data.organization.id;
    const p = "/organizations/" + organizationId + "/interoperability";
    async function connection(letter: "a" | "b") {
      const result = await request("POST", p + "/connections", owner, {
        provider: "OIDC",
        label: "Source " + letter,
      });
      assert.equal(result.statusCode, 200, result.body);
      const id = result.json().data.connection.id,
        key = organizationId + ":" + id;
      oidc[key] = {
        issuer: providerBase + "/issuer-" + letter,
        clientId: "admission-scim-client",
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
      configuration[key] = {
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
      b = await connection("b");
    const email = randomUUID() + "@example.test",
      externalId = "employee-" + randomUUID();
    const payload = {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      externalId,
      userName: externalId,
      displayName: "SCIM subject",
      emails: [{ value: email, primary: true }],
      active: true,
    };
    const unconfigured = await request(
      "POST",
      p + "/scim/v2/Users",
      undefined,
      payload,
      a.headers,
    );
    assert.equal(unconfigured.statusCode, 503, unconfigured.body);
    assert.equal(
      (
        await admin.query(
          "SELECT 1 FROM provisioned_enrollments WHERE email=$1",
          [email],
        )
      ).rowCount,
      0,
    );
    configuration[a.key].externalIdToValue[externalId] = subject;
    const readBefore = reads.length;
    const pending = await request(
      "POST",
      p + "/scim/v2/Users",
      undefined,
      payload,
      a.headers,
    );
    assert.equal(pending.statusCode, 201, pending.body);
    assert.ok(
      reads.length > readBefore,
      "begin must resolve current admission policy",
    );
    const resource = pending.json();
    assert.equal(
      resource["urn:orgmap:params:scim:schemas:extension:enrollment:2.0:User"]
        .provisioningState,
      "PENDING_ENROLLMENT",
    );
    assert.equal(
      (await admin.query("SELECT 1 FROM accounts WHERE email=$1", [email]))
        .rowCount,
      0,
    );
    const noMailbox = await request(
      "POST",
      p + "/connections/" + a.id + "/enrollment/start",
      undefined,
      {},
    );
    assert.equal(noMailbox.statusCode, 401, noMailbox.body);
    assert.equal(
      await core.deliverProvisionedEnrollmentMail(organizationId, (mail) =>
        sendLocalMail(mail, (smtp.address() as any).port),
      ),
      1,
    );
    const mail = await readFile(
      join(directory, (await readdir(directory))[0]),
      "utf8",
    );
    assert.ok(mail.includes(email));
    const mailbox = mail.match(/\r?\n([a-f0-9]{64})(?:\r?\n|$)/)![1];
    const prepared = await request("POST", "/enrollments/prepare", undefined, {
      token: mailbox,
    });
    assert.equal(prepared.statusCode, 200, prepared.body);
    async function finish(source = a, preparation = prepared) {
      const started = await request(
        "POST",
        p + "/connections/" + source.id + "/enrollment/start",
        undefined,
        {},
        { cookie: cookies(preparation) },
      );
      assert.equal(started.statusCode, 200, started.body);
      const authorization = await fetch(started.json().data.authorizationUrl, {
        redirect: "manual",
      });
      assert.equal(authorization.status, 302);
      const callback = new URL(authorization.headers.get("location")!);
      return request(
        "GET",
        callback.pathname.replace("/api/v1", "") + callback.search,
        undefined,
        undefined,
        { cookie: cookies(preparation, started) },
      );
    }
    subject = "wrong-subject";
    const wrong = await finish();
    assert.equal(wrong.statusCode, 401, wrong.body);
    assert.equal(
      (await admin.query("SELECT 1 FROM accounts WHERE email=$1", [email]))
        .rowCount,
      0,
    );
    subject = configuration[a.key].externalIdToValue[externalId];
    const readsBeforeComplete = reads.length;
    const activated = await finish();
    assert.equal(activated.statusCode, 200, activated.body);
    assert.ok(
      reads.length > readsBeforeComplete,
      "complete must resolve policy after signed proof",
    );
    const data = activated.json().data,
      memberId = data.membership.id;
    const member = {
      id: data.account.id,
      cookie: cookies(activated),
      csrf: data.csrfToken,
    };
    assert.equal(data.account.email, email);
    assert.deepEqual(
      (
        await admin.query("SELECT auth_amr FROM sessions WHERE account_id=$1", [
          member.id,
        ])
      ).rows[0].auth_amr,
      ["pwd", "otp"],
    );
    const addedB = await request(
      "POST",
      "/organizations/" + otherOrg + "/members",
      owner,
      { accountId: member.id },
    );
    assert.equal(addedB.statusCode, 201, addedB.body);
    const snapshot = async () => ({
      account: (
        await admin.query("SELECT * FROM accounts WHERE id=$1", [member.id])
      ).rows,
      sessions: (
        await admin.query(
          "SELECT * FROM sessions WHERE account_id=$1 ORDER BY id",
          [member.id],
        )
      ).rows,
      b: (
        await admin.query(
          "SELECT * FROM members WHERE organization_id=$1 AND account_id=$2",
          [otherOrg, member.id],
        )
      ).rows,
    });
    const globalBefore = await snapshot();
    const current = async () =>
      (
        await admin.query(
          "SELECT * FROM members WHERE organization_id=$1 AND id=$2",
          [organizationId, memberId],
        )
      ).rows[0];
    const access = (org: string) =>
      app.inject({
        method: "GET",
        url: "/test/" + org + "/access",
        headers: { cookie: member.cookie },
      });
    async function state(active: boolean) {
      const currentSource = await request(
        "GET",
        p + "/scim/v2/Users/" + resource.id,
        undefined,
        undefined,
        a.headers,
      );
      assert.equal(currentSource.statusCode, 200, currentSource.body);
      return request(
        "PUT",
        p + "/scim/v2/Users/" + resource.id,
        undefined,
        { ...payload, active },
        { ...a.headers, "if-match": currentSource.json().meta.version },
      );
    }
    const origin = {
      type: "SCIM",
      connectionId: a.id,
      externalId,
      mappingRevision: 1,
    };
    let result = await state(false);
    assert.equal(result.statusCode, 200, result.body);
    assert.deepEqual((await current()).suspension_origin, origin);
    assert.ok([403, 404].includes((await access(organizationId)).statusCode));
    assert.equal((await access(otherOrg)).statusCode, 200);
    assert.deepEqual(await snapshot(), globalBefore);
    const readsBeforeReactivate = reads.length;
    result = await state(true);
    assert.equal(result.statusCode, 200, result.body);
    assert.ok(
      reads.length > readsBeforeReactivate,
      "reactivation must resolve current policy",
    );
    assert.equal((await current()).status, "ACTIVE");
    assert.equal((await current()).suspension_origin, null);
    assert.equal((await current()).org_role, "MEMBER");
    assert.equal((await current()).member_type, "MEMBER");
    async function manual(status: "ACTIVE" | "SUSPENDED") {
      const result = await request(
        "PATCH",
        "/organizations/" + organizationId + "/members/" + memberId,
        owner,
        { status },
        { "if-match": '"' + (await current()).version + '"' },
      );
      assert.equal(result.statusCode, 200, result.body);
      return result;
    }
    await manual("SUSPENDED");
    assert.deepEqual((await current()).suspension_origin, { type: "MANUAL" });
    const manualBefore = await current();
    // A second real, verified source cannot use enrollment completion to undo
    // this suspension, even after mailbox and explicit existing-account reauth.
    const secondaryExternal = "secondary-" + randomUUID();
    configuration[b.key].externalIdToValue[secondaryExternal] =
      "secondary-subject";
    const secondary = await request(
      "POST",
      p + "/scim/v2/Users",
      undefined,
      {
        ...payload,
        externalId: secondaryExternal,
        userName: secondaryExternal,
      },
      b.headers,
    );
    assert.equal(secondary.statusCode, 201, secondary.body);
    const existingFiles = new Set(await readdir(directory));
    assert.equal(
      await core.deliverProvisionedEnrollmentMail(organizationId, (mail) =>
        sendLocalMail(mail, (smtp.address() as any).port),
      ),
      1,
    );
    const secondaryFiles = (await readdir(directory)).filter(
      (file) => !existingFiles.has(file),
    );
    assert.equal(secondaryFiles.length, 1);
    const secondaryMail = await readFile(
      join(directory, secondaryFiles[0]),
      "utf8",
    );
    const secondaryToken = secondaryMail.match(
      /\r?\n([a-f0-9]{64})(?:\r?\n|$)/,
    )![1];
    const reauth = await request(
      "POST",
      "/enrollments/reauthenticate",
      member,
      { token: secondaryToken, confirmAccountLink: true },
    );
    assert.equal(reauth.statusCode, 200, reauth.body);
    const secondaryPrepared = await request(
      "POST",
      "/enrollments/prepare",
      undefined,
      {
        token: secondaryToken,
        existingAccountReauth: reauth.json().data.existingAccountReauth,
      },
    );
    assert.equal(secondaryPrepared.statusCode, 200, secondaryPrepared.body);
    subject = "secondary-subject";
    const deniedCompletion = await finish(b, secondaryPrepared);
    assert.equal(deniedCompletion.statusCode, 403, deniedCompletion.body);
    assert.equal(deniedCompletion.json().error.code, "ACTION_DENIED");
    assert.deepEqual(await current(), manualBefore);
    subject = configuration[a.key].externalIdToValue[externalId];
    result = await state(false);
    assert.equal(result.statusCode, 200, result.body);
    assert.deepEqual(
      await current(),
      manualBefore,
      "SCIM false must not launder manual suspension or bump its version",
    );
    result = await state(true);
    assert.equal(result.statusCode, 403, result.body);
    assert.equal(result.json().detail, "SCIM_REACTIVATION_REQUIRES_OWNER");
    await manual("ACTIVE");
    assert.equal((await current()).suspension_origin, null);
    result = await state(false);
    assert.equal(result.statusCode, 200, result.body);
    configuration[a.key].mappingRevision = 2;
    result = await state(true);
    assert.equal(result.statusCode, 403, result.body);
    assert.equal(result.json().detail, "SCIM_REACTIVATION_REQUIRES_OWNER");
    configuration[a.key].mappingRevision = 1;
    for (const foreign of [
      null,
      { ...origin, connectionId: b.id },
      { ...origin, externalId: "other-external" },
      { ...origin, mappingRevision: 2 },
    ]) {
      await admin.query(
        "UPDATE members SET suspension_origin=$3 WHERE organization_id=$1 AND id=$2",
        [organizationId, memberId, foreign],
      );
      const before = await current();
      result = await state(false);
      assert.equal(result.statusCode, 200, result.body);
      assert.deepEqual(
        await current(),
        before,
        "repeated false preserves unknown or foreign provenance",
      );
      result = await state(true);
      assert.equal(result.statusCode, 403, result.body);
      assert.equal(
        result.json().detail,
        "SCIM_REACTIVATION_REQUIRES_OWNER",
      );
      assert.deepEqual(await current(), before);
    }
    // A current source is necessary even for an already ACTIVE status no-op.
    await manual("ACTIVE");
    configuration[a.key].mappingRevision = 2;
    result = await state(true);
    assert.equal(result.statusCode, 401, result.body);
    assert.equal(result.json().detail, "ENROLLMENT_INVALID");
    configuration[a.key].mappingRevision = 1;
    assert.equal((await access(otherOrg)).statusCode, 200);
    assert.deepEqual(await snapshot(), globalBefore);
    assert.equal((await current()).status, "ACTIVE");
    const migrations = (
      await admin.query(
        "SELECT name FROM schema_migrations WHERE name LIKE '01%' ORDER BY name",
      )
    ).rows.map((r) => r.name);
    assert.ok(migrations.includes("017_suspension_origin.sql"));
    console.log(
      JSON.stringify({
        evidence: "SCIM_ADMISSION_PROVENANCE",
        organizationId,
        otherOrg,
        memberId,
        mappingRevision: 1,
        policyRevision: 0,
        policyReads: reads.length,
        signedAmr: ["pwd", "otp"],
        smtpMessages: (await readdir(directory)).length,
        preservedGlobalAccountAndSessions: true,
        migrations,
      }),
    );
  } finally {
    await new Promise<void>((resolve) => idp.close(() => resolve()));
    await new Promise<void>((resolve) => smtp.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
