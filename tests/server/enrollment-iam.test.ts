import { foundationDefaultAdmissionPolicy } from "../../server/src/admission.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { buildApp } from "../../server/src/app.js";
import { pool, transaction } from "../../server/src/db.js";
import { createSessionRecord } from "../../server/src/sessions.js";
import { secret } from "../../server/src/core.js";
import { startSmtpSink, sendLocalMail } from "../../server/src/smtp.js";
import type { ModuleRuntime, Ctx } from "../../server/src/runtime.js";
import type { VerifiedEnrollmentFederation } from "../../server/src/enrollment-contract.js";
const fixtureRuntime = new URL(
    process.env.DATABASE_URL ?? "postgres://invalid/",
  ),
  fixtureOperator = new URL(
    process.env.MIGRATION_DATABASE_URL ?? "postgres://invalid/",
  );
if (
  !/^\/orgmap_(?:enrollment_test_[a-f0-9]{16}|test_[a-f0-9]{16,32})$/.test(
    fixtureRuntime.pathname,
  ) ||
  fixtureOperator.pathname !== fixtureRuntime.pathname ||
  fixtureOperator.host !== fixtureRuntime.host ||
  !["127.0.0.1", "localhost", "[::1]"].includes(fixtureRuntime.hostname)
)
  throw Error("EXCLUSIVE_ENROLLMENT_DATABASE_REQUIRED");
const admin = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
let core: ModuleRuntime;
const proofs = new WeakMap<object, VerifiedEnrollmentFederation>();
const disabled = new Set<string>(),
  sso = new Set<string>();
const conn = randomUUID(),
  orgA = randomUUID(),
  orgB = randomUUID(),
  owner = randomUUID(),
  ownerMember = randomUUID();
// Trusted fake authority tests IAM invariants only; no assertion of IdP cryptographic verification.
const app = await buildApp(
  [
    foundationDefaultAdmissionPolicy,
    async (app, c) => {
      core = c;
      c.registerProvisionedEnrollmentAuthority({
        validateSource: async () => {},
        revalidateSource: async (_c, _org, s) => !disabled.has(s.connectionId),
        verifyFederationProof: async (_c, p) => {
          if (!p || typeof p !== "object") return null;
          const proof = proofs.get(p);
          proofs.delete(p);
          return proof ?? null;
        },
        bindFederatedIdentity: async () => {},
        authenticationPolicy: async (ctx) => ({
          mode: sso.has(ctx.org.id) ? "SSO_REQUIRED" : "ANY",
          connectionIds: [conn],
        }),
        validateSessionProvenance: async (_ctx, p) =>
          !disabled.has(p.connectionId!),
      });
      app.get("/test/:organizationId/access", (r) =>
        c.tenant(r, false, async () => ({ ok: true })),
      );
    },
  ],
  { migrationMaxPrefix: 19 },
);
after(async () => {
  await app.close();
  await pool.end();
  await admin.end();
});
async function ctxRun<T>(org: string, fn: (ctx: Ctx) => Promise<T>, targets: string[] = []) {
  return transaction(async (c) => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [org]);
    const o = (
      await c.query("SELECT * FROM organizations WHERE id=$1 FOR UPDATE", [org])
    ).rows[0];
    const accountIds = [...new Set([owner, ...targets])].sort();
    await c.query("SELECT id FROM accounts WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE", [accountIds]);
    return fn({
      c,
      org: o,
      lockedAccountIds: new Set(accountIds),
      member: { id: ownerMember, org_role: "OWNER" },
      account: { id: owner },
      mode: "authorization_write",
    });
  });
}
function proof(subject: string, organizationId = orgA) {
  const value = {};
  proofs.set(value, {
    organizationId,
    connectionId: conn,
    issuer: "https://fake-idp.local",
    subject,
    claims: {},
    verifiedAt: new Date(),
  });
  return value;
}
async function begin(email: string, subject: string) {
  return ctxRun(orgA, (ctx) =>
    core.beginProvisionedEnrollment(
      ctx,
      { connectionId: conn, externalId: randomUUID() },
      {
        userName: email,
        email,
        identity: {
          issuer: "https://fake-idp.local",
          claim: "sub",
          value: subject,
          mappingRevision: 1,
        },
      },
      true,
    ),
  );
}
async function mailToken(enrollmentId: string) {
  return (
    await admin.query(
      "SELECT token FROM provisioned_enrollment_mail WHERE enrollment_id=$1",
      [enrollmentId],
    )
  ).rows[0].token as string;
}
async function activate(token: string, p: unknown, receipt?: string) {
  return transaction((c) =>
    core.completeProvisionedEnrollment(c, token, p, receipt),
  );
}
async function session(accountId: string, method: "PASSWORD" | "FEDERATED") {
  return transaction((c) =>
    createSessionRecord(
      c,
      accountId,
      method === "PASSWORD"
        ? { method }
        : {
            method,
            organizationId: orgA,
            connectionId: conn,
            issuer: "https://fake-idp.local",
            subject: "free-sub",
            verifiedAt: new Date(),
          },
    ),
  );
}
const access = (org: string, cookie: string) =>
  app.inject({
    method: "GET",
    url: "/test/" + org + "/access",
    headers: { cookie: "orgmap_session=" + cookie },
  });
test("IAM pending, SMTP proof, activation, existing account confirmation, tenant provenance and deprovision isolation", async () => {
  for (const org of [orgA, orgB])
    await admin.query(
      "INSERT INTO organizations(id,name,locale,time_zone) VALUES($1,'IAM test','pt-BR','UTC')",
      [org],
    );
  await admin.query(
    "INSERT INTO accounts(id,email,display_name,password_hash) VALUES($1,'owner@iam.local','Owner','unused')",
    [owner],
  );
  await admin.query(
    "INSERT INTO members(organization_id,id,account_id,org_role) VALUES($1,$2,$3,'OWNER')",
    [orgA, ownerMember, owner],
  );
  const free = await begin("free@iam.local", "free-sub");
  assert.equal(free.provisioningState, "PENDING_ENROLLMENT");
  assert.equal(
    (await admin.query("SELECT 1 FROM accounts WHERE email='free@iam.local'"))
      .rowCount,
    0,
  );
  const raw = await mailToken(free.enrollmentId);
  const directory = await mkdtemp(join(tmpdir(), "enrollment-smtp-"));
  const sink = await startSmtpSink({ port: 0, directory });
  try {
    assert.equal(
      await core.deliverProvisionedEnrollmentMail(orgA, (m) =>
        sendLocalMail(m, (sink.address() as any).port),
      ),
      1,
    );
    const eml = await readFile(
      join(directory, (await readdir(directory))[0]),
      "utf8",
    );
    assert.ok(eml.includes(raw));
  } finally {
    await new Promise<void>((r) => sink.close(() => r()));
    await rm(directory, { recursive: true, force: true });
  }
  await assert.rejects(
    activate(raw, proof("wrong-sub")),
    /ENROLLMENT_IDENTITY_MISMATCH/,
  );
  const result = await activate(raw, proof("free-sub"));
  const account = (
    await admin.query("SELECT * FROM accounts WHERE id=$1", [result.account.id])
  ).rows[0];
  assert.equal(account.password_enabled, false);
  assert.ok(account.email_verified_at);
  await assert.rejects(activate(raw, proof("free-sub")), /ENROLLMENT_INVALID/);
  await admin.query(
    "INSERT INTO members(organization_id,id,account_id,org_role) VALUES($1,$2,$3,'MEMBER')",
    [orgB, randomUUID(), account.id],
  );
  const password = await session(account.id, "PASSWORD"),
    federated = await session(account.id, "FEDERATED");
  assert.equal((await access(orgA, password.token)).statusCode, 200);
  sso.add(orgA);
  assert.equal((await access(orgA, password.token)).statusCode, 403);
  assert.equal((await access(orgA, federated.token)).statusCode, 200);
  disabled.add(conn);
  assert.equal((await access(orgA, federated.token)).statusCode, 403);
  disabled.delete(conn);
  await assert.rejects(
    activate(secret(), proof("free-sub")),
    /ENROLLMENT_INVALID/,
  );
  const rec = await app.inject({
    method: "POST",
    url: "/api/v1/auth/recovery/request",
    headers: {
      origin: "http://localhost:5173",
      "idempotency-key": randomUUID(),
    },
    payload: { email: account.email },
  });
  assert.equal(rec.statusCode, 200);
  assert.equal(
    (
      await admin.query("SELECT 1 FROM password_recovery WHERE account_id=$1", [
        account.id,
      ])
    ).rowCount,
    0,
  );
  const source = (
    await admin.query(
      "SELECT external_id FROM provisioned_enrollments WHERE id=$1",
      [free.enrollmentId],
    )
  ).rows[0];
  await ctxRun(orgA, (ctx) =>
    core.setProvisionedAccess(
      ctx,
      { connectionId: conn, externalId: source.external_id },
      false,
    ),
    [account.id],
  );
  assert.ok(
    [403, 404].includes((await access(orgA, federated.token)).statusCode),
  );
  assert.equal((await access(orgB, federated.token)).statusCode, 200);
  const existing = await begin("owner@iam.local", "owner-sub"),
    existingToken = await mailToken(existing.enrollmentId);
  await assert.rejects(
    activate(existingToken, proof("owner-sub")),
    /ACTIVATION_CONFIRMATION_REQUIRED/,
  );
  await assert.rejects(
    activate(existingToken, proof("owner-sub"), secret()),
    /ACTIVATION_CONFIRMATION_REQUIRED/,
  );
  const ownerSession = await session(owner, "PASSWORD");
  const reauth = await app.inject({
    method: "POST",
    url: "/api/v1/enrollments/reauthenticate",
    headers: {
      origin: "http://localhost:5173",
      cookie: "orgmap_session=" + ownerSession.token,
      "x-csrf-token": ownerSession.csrf,
      "idempotency-key": randomUUID(),
    },
    payload: { token: existingToken, confirmAccountLink: true },
  });
  assert.equal(reauth.statusCode, 200, reauth.body);
  const receipt = reauth.json().data.existingAccountReauth;
  const linked = await activate(existingToken, proof("owner-sub"), receipt);
  assert.equal(linked.account.id, owner);
  const pending = await begin("blocked@iam.local", "blocked-sub");
  disabled.add(conn);
  await assert.rejects(
    activate(await mailToken(pending.enrollmentId), proof("blocked-sub")),
    /ENROLLMENT_INVALID/,
  );
});
