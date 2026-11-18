import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { buildApp } from "../../server/src/app.js";

import { pool } from "../../server/src/db.js";
import { withWorkerContext } from "../../server/src/identity.js";
import { lockActiveOrganization, hasIndependentLoginMethod, lockAndCheckOrganizationAuthContinuity } from "../../server/src/organization-lifecycle.js";

const runtime = new URL(process.env.DATABASE_URL ?? "postgres://invalid/");
const operator = new URL(process.env.MIGRATION_DATABASE_URL ?? "postgres://invalid/");
if (!/^\/orgmap_test_[a-f0-9]{16,32}$/.test(runtime.pathname) ||
    operator.pathname !== runtime.pathname || operator.host !== runtime.host ||
    !["127.0.0.1", "localhost", "[::1]"].includes(runtime.hostname))
  throw Error("EXCLUSIVE_FOUNDATION_DATABASE_REQUIRED");
const admin = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
let effects = 0;
const app = await buildApp([async (app, core) => {
  core.registerAdmissionPolicyProvider({ resolve: async () => ({
    schemaVersion: 1, policyId: null, revision: 0, registrationMode: "OPEN",
    allowedDomains: [], membersMayInvite: false, limitMemberInvitesToDomains: false,
    invitationLinkEnabled: true,
  }) });
  app.get("/api/v1/organizations/:organizationId/lifecycle-probe", (r) =>
    core.tenant(r, false, async () => ({ ok: true })));
  app.post("/api/v1/organizations/:organizationId/lifecycle-probe", (r) =>
    core.tenant(r, true, async () => ({ value: ++effects })));
}]);
after(async () => { await app.close(); await pool.end(); await admin.end(); });
const origin = "http://localhost:5173";
async function call(method: "GET" | "POST", path: string, body?: any,
  user?: { cookie: string; csrf: string }, key = randomUUID(), extra: Record<string, string> = {}) {
  return app.inject({ method, url: "/api/v1" + path, headers: {
    origin, "idempotency-key": key,
    ...(user ? { cookie: user.cookie, "x-csrf-token": user.csrf } : {}), ...extra,
  }, payload: body });
}

test("lifecycle gate fences real owner read/write/replay and worker; preserves B", async () => {
  const registration = await call("POST", "/auth/register", {
    email: randomUUID() + "@example.test", password: "a-secure-password-123", displayName: "Lifecycle test",
  });
  assert.ok([200, 201].includes(registration.statusCode), registration.body);
  const user = { cookie: registration.cookies[0].name + "=" + registration.cookies[0].value,
    csrf: registration.json().data.csrfToken };
  const createKey = randomUUID();
  const createOrg = async (name: string, key = randomUUID()) => {
    const r = await call("POST", "/organizations", { name }, user, key);
    assert.ok([200, 201].includes(r.statusCode), r.body);
    return r.json().data.organization.id as string;
  };
  const a = await createOrg("Lifecycle A", createKey), b = await createOrg("Lifecycle B");
  const invited = await call("POST", "/auth/register", {
    email: randomUUID() + "@example.test", password: "a-secure-password-123", displayName: "Invitee",
  });
  assert.ok([200, 201].includes(invited.statusCode), invited.body);
  const invitee = { cookie: invited.cookies[0].name + "=" + invited.cookies[0].value,
    csrf: invited.json().data.csrfToken };
  const email = invited.json().data.account.email;
  const invitation = await call("POST", `/organizations/${a}/invitations`, { email }, user);
  assert.ok([200, 201].includes(invitation.statusCode), invitation.body);
  const invitationId = invitation.json().data.invitation.id;
  const token = (await admin.query("SELECT token FROM invitation_delivery WHERE organization_id=$1 AND invitation_id=$2", [a, invitationId])).rows[0].token;
  assert.ok(token);
  const recovery = await call("POST", "/auth/recovery/request", { email });
  assert.equal(recovery.statusCode, 200, recovery.body);
  const scopes = (await admin.query("SELECT * FROM iam_mail_claim()")).rows;
  const invitationScope = scopes.find((scope) => scope.kind === "INVITATION" && scope.organization_id === a);
  const accountScope = scopes.find((scope) => scope.kind === "ACCOUNT");
  assert.ok(invitationScope);
  assert.ok(accountScope);
  const meta = await call("GET", `/organizations/${a}/invitation-links`, undefined, user);
  assert.equal(meta.statusCode, 200, meta.body);
  const issued = await call("POST", `/organizations/${a}/invitation-links`, {}, user, randomUUID(),
    { "if-match": `"${meta.json().data.version}"` });
  assert.ok([200, 201].includes(issued.statusCode), issued.body);
  const linkToken = issued.json().data.linkToken as string;
  assert.ok(linkToken);
  const requestKey = randomUUID();
  const pending = await call("POST", `/organizations/${a}/admission/link-requests`, { linkToken }, invitee, requestKey);
  assert.equal(pending.statusCode, 202, pending.body);
  const requestId = pending.json().data.requestId;
  const mailboxToken = (await admin.query("SELECT token FROM admission_mail WHERE organization_id=$1 AND request_id=$2", [a, requestId])).rows[0].token;
  assert.ok(mailboxToken);
  const before = await call("GET", "/me", undefined, user);
  assert.deepEqual(new Set(before.json().data.organizations.map((org: any) => org.id)), new Set([a, b]));
  const member = (await admin.query("SELECT id FROM members WHERE organization_id=$1", [a])).rows[0].id;
  const path = (id: string) => `/organizations/${id}/lifecycle-probe`;
  const key = randomUUID();
  assert.equal((await call("GET", path(a), undefined, user)).statusCode, 200);
  assert.ok([200, 201].includes((await call("POST", path(a), {}, user, key)).statusCode));
  assert.ok([200, 201].includes((await call("POST", path(a), {}, user, key)).statusCode));
  assert.equal(effects, 1);
  assert.equal(await withWorkerContext(a, member, async () => true), true);
  await assert.rejects(pool.query("UPDATE organization_lifecycle SET state='DELETION_PENDING',fence=fence+1 WHERE organization_id=$1", [a]), /permission denied/i);
  const c = await admin.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [a]);
    await c.query("UPDATE organization_lifecycle SET state='DELETION_PENDING', fence=fence+1 WHERE organization_id=$1", [a]);
    // A request waiting on org lock must observe the committed fence, not a stale join snapshot.
    const waiting = pool.connect().then(async (other) => {
      try { await other.query("BEGIN"); await lockActiveOrganization(other, a); }
      finally { await other.query("ROLLBACK"); other.release(); }
    });
    await c.query("COMMIT");
    await assert.rejects(waiting);
  } finally { c.release(); }
  const after = await call("GET", "/me", undefined, user);
  assert.equal(after.statusCode, 200, after.body);
  assert.deepEqual(after.json().data.organizations.map((org: any) => org.id), [b]);
  assert.equal(after.json().data.account.email, registration.json().data.account.email);
  assert.equal((await call("POST", "/organizations", { name: "Lifecycle A" }, user, createKey)).statusCode, 404);
  assert.equal((await call("POST", "/invitations/accept", { token }, invitee)).statusCode, 404);
  assert.equal((await call("POST", `/organizations/${a}/admission/link-requests`, { linkToken }, invitee, requestKey)).statusCode, 404);
  assert.equal((await call("POST", `/organizations/${a}/admission/requests/${requestId}/complete`, { mailboxToken }, invitee)).statusCode, 404);
  assert.equal((await admin.query("SELECT iam_mail_heartbeat($1,$2,$3) AS ok", ["INVITATION", a, invitationScope.lease_token])).rows[0].ok, false);
  assert.equal((await admin.query("SELECT iam_mail_release($1,$2,$3) AS ok", ["INVITATION", a, invitationScope.lease_token])).rows[0].ok, false);
  assert.equal((await admin.query("SELECT iam_mail_heartbeat($1,$2,$3) AS ok", ["ACCOUNT", accountScope.organization_id, accountScope.lease_token])).rows[0].ok, true);
  assert.equal((await admin.query("SELECT iam_mail_release($1,$2,$3) AS ok", ["ACCOUNT", accountScope.organization_id, accountScope.lease_token])).rows[0].ok, true);
  assert.ok(!(await admin.query("SELECT * FROM iam_mail_claim()")).rows.some((scope) => scope.organization_id === a));
  assert.equal((await call("GET", path(a), undefined, user)).statusCode, 404);
  assert.equal((await call("POST", path(a), {}, user, key)).statusCode, 404);
  assert.equal((await call("POST", path(a), {}, user)).statusCode, 404);
  assert.equal(effects, 1);
  await assert.rejects(withWorkerContext(a, member, async () => true));
  assert.equal((await call("GET", path(b), undefined, user)).statusCode, 200);
  await assert.rejects(admin.query("UPDATE organization_lifecycle SET state='ACTIVE',fence=fence+1 WHERE organization_id=$1", [a]), /invalid lifecycle transition/);
  await assert.rejects(admin.query("UPDATE organization_lifecycle SET state='DELETED',fence=fence+1 WHERE organization_id=$1", [a]), /invalid lifecycle transition/);
  await assert.rejects(admin.query("UPDATE organization_lifecycle SET state='PURGING',fence=1 WHERE organization_id=$1", [a]), /invalid lifecycle transition/);
  await assert.rejects(admin.query("DELETE FROM organization_lifecycle WHERE organization_id=$1", [a]), /tombstone cannot be deleted/);
  await admin.query("UPDATE organization_lifecycle SET state='PURGING',fence=fence+1 WHERE organization_id=$1", [a]);
  await admin.query("UPDATE organization_lifecycle SET state='DELETED',fence=fence+1 WHERE organization_id=$1", [a]);
  assert.equal((await admin.query("SELECT state,fence::text FROM organization_lifecycle WHERE organization_id=$1", [a])).rows[0].fence, "4");
});

test("continuity accepts password or verified active other-org OIDC/SAML only", () => {
  const a = randomUUID(), b = randomUUID();
  const method = { organizationId: b, kind: "OIDC" as const, enabled: true, verified: true };
  assert.equal(hasIndependentLoginMethod(true, a, [], new Set()), true);
  assert.equal(hasIndependentLoginMethod(false, a, [method], new Set([b])), true);
  assert.equal(hasIndependentLoginMethod(false, a, [{ ...method, kind: "SAML" }], new Set([b])), true);
  assert.equal(hasIndependentLoginMethod(false, a, [method], new Set()), false);
  assert.equal(hasIndependentLoginMethod(false, a, [{ ...method, enabled: false }], new Set([b])), false);
  assert.equal(hasIndependentLoginMethod(false, a, [{ ...method, verified: false }], new Set([b])), false);
  assert.equal(hasIndependentLoginMethod(false, a, [{ ...method, organizationId: a }], new Set([a])), false);
});

// The Interop provider below is a controlled fixture, not proof of real federation integration.
test("continuity serializes simultaneous A/B cuts on the actual Account lock", async () => {
  const registration = await call("POST", "/auth/register", {
    email: randomUUID() + "@example.test", password: "a-secure-password-123", displayName: "Concurrency",
  });
  assert.ok([200, 201].includes(registration.statusCode), registration.body);
  const user = { cookie: registration.cookies[0].name + "=" + registration.cookies[0].value,
    csrf: registration.json().data.csrfToken };
  const accountId = registration.json().data.account.id as string;
  const createOrg = async (name: string) => {
    const r = await call("POST", "/organizations", { name }, user);
    assert.ok([200, 201].includes(r.statusCode), r.body);
    return r.json().data.organization.id as string;
  };
  const a = await createOrg("Continuity A"), b = await createOrg("Continuity B");
  const port = {
    affectedAccountIds: async () => [accountId],
    methodsForAccount: async () => [a, b].map((organizationId) => ({
      organizationId, kind: "OIDC" as const, enabled: true, verified: true,
    })),
  };
  await admin.query("UPDATE accounts SET password_enabled=false WHERE id=$1", [accountId]);
  const check = async (methods: Awaited<ReturnType<typeof port.methodsForAccount>>) => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [a]);
      return await lockAndCheckOrganizationAuthContinuity(c, a, { ...port, methodsForAccount: async () => methods });
    } finally { await c.query("ROLLBACK"); c.release(); }
  };
  // A discovered but already unusable binding does not strand the Account.
  assert.equal((await check([{ organizationId: a, kind: "OIDC", enabled: false, verified: true }])).affectedCount, 0);
  // Offboarding B before the A check removes B as an independent method.
  await assert.rejects(check([
    { organizationId: a, kind: "OIDC", enabled: true, verified: true },
    { organizationId: b, kind: "OIDC", enabled: false, verified: true },
  ]), (error: any) => error?.code === "AUTH_CONTINUITY_REQUIRED");
  const first = await admin.connect(), second = await pool.connect();
  try {
    await first.query("BEGIN"); await second.query("BEGIN");
    await first.query("SELECT set_config('orgmap.organization_id',$1,true)", [a]);
    await second.query("SELECT set_config('orgmap.organization_id',$1,true)", [b]);
    await lockAndCheckOrganizationAuthContinuity(first, a, port);
    const pid = (await second.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const pending = lockAndCheckOrganizationAuthContinuity(second, b, port);
    // Attach a rejection handler immediately, so the expected error cannot be unhandled.
    const outcome = pending.then(() => "accepted", () => "rejected");
    let blocked = false;
    for (let n = 0; n < 200; n++) {
      const state = await admin.query("SELECT cardinality(pg_blocking_pids($1)) AS count", [pid]);
      if (Number(state.rows[0].count) > 0) { blocked = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(blocked, true, "second cut must wait for Account lock");
    // The owner fixture simulates cutover inside the same locked transaction.
    await first.query("UPDATE organization_lifecycle SET state='DELETION_PENDING',fence=fence+1 WHERE organization_id=$1", [a]);
    await first.query("COMMIT");
    assert.equal(await outcome, "rejected");
    await second.query("ROLLBACK");
    assert.equal((await admin.query("SELECT state FROM organization_lifecycle WHERE organization_id=$1", [b])).rows[0].state, "ACTIVE");
  } finally {
    await first.query("ROLLBACK").catch(() => {});
    await second.query("ROLLBACK").catch(() => {});
    first.release(); second.release();
  }
});
