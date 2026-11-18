import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../../server/src/app.js";
import { createAccountEmailServices } from "../../server/src/account-email.js";
import { pool, transaction } from "../../server/src/db.js";
import { digest } from "../../server/src/core.js";
import { startSmtpSink, sendLocalMail, SmtpDeliveryError } from "../../server/src/smtp.js";
import { totpAt } from "../../server/src/mfa.js";
import { createSessionRecord } from "../../server/src/sessions.js";
import type { ModuleRuntime } from "../../server/src/runtime.js";
import type { PoolClient } from "pg";
import { defaultAdmissionPolicy, type AdmissionPolicy } from "../../server/src/admission-contract.js";
import type { CredentialPolicy } from "../../server/src/credential-policy-contract.js";
import { proofToken } from "./mail-fixture.js";

const runtime = new URL(process.env.DATABASE_URL ?? "postgres://invalid/");
const operator = new URL(process.env.MIGRATION_DATABASE_URL ?? "postgres://invalid/");
if (!/^\/orgmap_account_email_[a-f0-9]{16}$/.test(runtime.pathname) ||
  runtime.pathname !== operator.pathname || runtime.host !== operator.host ||
  runtime.protocol !== "postgres:" || operator.protocol !== "postgres:" ||
  !["127.0.0.1", "localhost", "[::1]"].includes(runtime.hostname) ||
  !["127.0.0.1", "localhost", "[::1]"].includes(operator.hostname))
  throw Error("EXCLUSIVE_ACCOUNT_EMAIL_DATABASE_REQUIRED");
process.env.ORGMAP_PUBLIC_URL = "http://localhost:5173";

const directory = await mkdtemp(join(tmpdir(), "orgmap-account-email-"));
process.env.ORGMAP_MFA_KEY_FILE = join(directory, "mfa.key");
await writeFile(process.env.ORGMAP_MFA_KEY_FILE, randomBytes(32).toString("hex"), { mode: 0o600 });
const smtp = await startSmtpSink({ port: 0, directory: join(directory, "smtp") });
const smtpPort = (smtp.address() as any).port as number;
let core!: ModuleRuntime, services!: ReturnType<typeof createAccountEmailServices>;
// Explicit TEST-only policy composition: no synthetic organization is open or
// subject to credential requirements unless its test opts into this Map.
const admissionPolicies = new Map<string, AdmissionPolicy>();
const credentialPolicies = new Map<string, CredentialPolicy>();
const app = await buildApp([async (app, value) => {
  core = value;
  core.registerAdmissionPolicyProvider({ resolve: async ({ organizationId }) =>
    admissionPolicies.get(organizationId) ?? defaultAdmissionPolicy() });
  core.registerAdmissionMailTransport({ host: "127.0.0.1", port: smtpPort });
  core.registerCredentialPolicyResolver(async (ctx) => credentialPolicies.get(ctx.org.id) ?? null);
  services = createAccountEmailServices(core);
  if (!app.hasRoute({ method: "POST", url: "/api/v1/account/email-change/requests" }))
    await services.registerAccountEmailRoutes(app);
}]);
const address = await app.listen({ host: "127.0.0.1", port: 0 });
after(async () => {
  await app.close();
  await new Promise<void>((resolve, reject) => smtp.close((e) => e ? reject(e) : resolve()));
  await pool.end();
  await rm(directory, { recursive: true, force: true });
});
const password = "Exact! password-Árvore-93742 ";
type User = { id: string; cookie: string; csrf: string; email: string };
type Response = { status: number; body: any; headers: Headers; cookie?: string; raw: string };
async function call(method: string, path: string, payload?: any, user?: User, headers: Record<string, string> = {}): Promise<Response> {
  const response = await fetch(address + "/api/v1" + path, {
    method, headers: { origin: "http://localhost:5173", "content-type": "application/json",
      "idempotency-key": randomUUID(), ...(user ? { cookie: user.cookie, "x-csrf-token": user.csrf } : {}), ...headers },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const raw = await response.text();
  return { status: response.status, body: JSON.parse(raw), raw, headers: response.headers,
    cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
function data(response: Response, status = 200) {
  assert.equal(response.status, status, response.raw);
  return response.body.data;
}
async function user(): Promise<User> {
  const email = randomUUID() + "@example.test";
  const response = await call("POST", "/auth/register", { email, password, displayName: "Email owner" });
  const value = data(response, 201);
  return { id: value.account.id, email, cookie: response.cookie!, csrf: value.csrfToken };
}
async function account(a: User) { return data(await call("GET", "/account", undefined, a)).account; }
const path = "/account/email-change/requests";
async function start(a: User, email = randomUUID() + "@example.test", headers: Record<string, string> = {}, credentials = { currentPassword: password } as any) {
  return call("POST", path, { newEmail: email, ...credentials }, a, { "if-match": '"' + (await account(a)).version + '"', ...headers });
}
async function complete(a: User, requestId: string, token: any, headers: Record<string, string> = {}, credentials = { currentPassword: password } as any) {
  return call("POST", path + "/" + requestId + "/complete", { mailboxToken: token, ...credentials }, a,
    { "if-match": '"' + (await account(a)).version + '"', ...headers });
}
async function proof(a: User, email = randomUUID() + "@example.test") {
  const result = data(await start(a, email), 202);
  const mailId = (await pool.query("SELECT id FROM account_email_change_mail WHERE request_id=$1", [result.requestId])).rows[0].id;
  assert.equal(await services.deliverAccountEmailChangeMail((mail) => sendLocalMail(mail, smtpPort)), 1);
  const files = await readdir(join(directory, "smtp"));
  for (const file of files) {
    const contents = await readFile(join(directory, "smtp", file), "utf8");
    if (contents.includes("To: <" + email + ">") && contents.includes("Message-ID: <" + mailId + "@orgmap.local>")) {
      const token = contents.match(/Email change token \(expires in 30 minutes\):\r?\n([a-f0-9]{64})/)?.[1];
      assert.ok(token);
      return { ...result, token, email };
    }
  }
  throw Error("TCP_SMTP_PROOF_NOT_RECEIVED");
}
async function snapshot(a: User) {
  const row = (await pool.query("SELECT * FROM accounts WHERE id=$1", [a.id])).rows[0];
  const sessions = (await pool.query("SELECT * FROM sessions WHERE account_id=$1 ORDER BY id", [a.id])).rows;
  return { row, sessions };
}
async function scoped<T>(organizationId: string, fn: (c: PoolClient) => Promise<T>) {
  return transaction(async (c) => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [organizationId]);
    return fn(c);
  });
}
async function organizationSnapshot(organizationId: string) {
  return scoped(organizationId, async (c) => ({
    organization: (await c.query("SELECT * FROM organizations WHERE id=$1", [organizationId])).rows,
    members: (await c.query("SELECT * FROM members WHERE organization_id=$1 ORDER BY id", [organizationId])).rows,
    entities: (await c.query("SELECT * FROM entities WHERE organization_id=$1 ORDER BY id", [organizationId])).rows,
  }));
}
async function smtpMessage(messageId: string) {
  for (const file of await readdir(join(directory, "smtp"))) {
    const contents = await readFile(join(directory, "smtp", file), "utf8");
    if (contents.includes("Message-ID: <" + messageId + "@orgmap.local>")) return contents;
  }
  throw Error("EXPECTED_REAL_TCP_SMTP_MESSAGE_MISSING");
}
function noSecrets(value: unknown, tokens: string[]) {
  const serialized = JSON.stringify(value);
  for (const token of [password, ...tokens]) assert.ok(!serialized.includes(token));
}

test("authenticated HTTP request requires exact reauthentication, CSRF, preconditions and exposes only metadata", async () => {
  const a = await user(), before = await snapshot(a), email = randomUUID() + "@example.test";
  assert.equal((await call("POST", path, { newEmail: email, currentPassword: password })).status, 401);
  assert.equal((await start(a, email, { "x-csrf-token": "wrong" })).status, 403);
  assert.equal((await start(a, email, {}, { currentPassword: password.trim() })).status, 401);
  assert.equal((await call("POST", path, { newEmail: email, currentPassword: password }, a)).status, 428);
  const response = await start(a, email);
  const pending = data(response, 202);
  assert.deepEqual(Object.keys(pending).sort(), ["expiresAt", "requestId", "state"]);
  assert.equal(pending.state, "PENDING_PROOF");
  assert.ok(new Date(pending.expiresAt).getTime() > Date.now() + 29 * 60000);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await snapshot(a), before);
  const stored = (await pool.query("SELECT * FROM account_email_change_requests WHERE id=$1", [pending.requestId])).rows[0];
  const mail = (await pool.query("SELECT * FROM account_email_change_mail WHERE request_id=$1", [pending.requestId])).rows[0];
  assert.equal(stored.token_hash, digest(mail.token));
  noSecrets(response.body, [mail.token]);
  noSecrets(stored, [mail.token]);
  noSecrets((await pool.query("SELECT result FROM account_commands WHERE account_id=$1", [a.id])).rows, [mail.token]);
  data(await call("POST", path + "/" + pending.requestId + "/revoke", {}, a, { "if-match": '"1"' }));
});

test("real TCP mailbox proof changes only own email/revision, preserves A/B membership, invalidates recovery and rotates sessions; replay reauthorizes without secrets", async () => {
  const a = await user();
  const orgA = data(await call("POST", "/organizations", { name: "Email A" }, a), 201).organization.id;
  const orgB = data(await call("POST", "/organizations", { name: "Email B" }, a), 201).organization.id;
  const login = await call("POST", "/auth/login", { email: a.email, password });
  const otherSession = { ...a, cookie: login.cookie!, csrf: data(login).csrfToken };
  data(await call("POST", "/auth/recovery/request", { email: a.email }));
  const recovery = (await pool.query("SELECT token FROM account_mail WHERE account_id=$1 AND state='PENDING'", [a.id])).rows[0].token;
  const before = await snapshot(a), oldRevision = before.row.email_revision;
  const request = await proof(a), cmd = randomUUID(), headers = { "idempotency-key": cmd, "if-match": '"' + before.row.version + '"' };
  const changed = await complete(a, request.requestId, request.token, headers);
  const value = data(changed);
  assert.equal(value.account.id, a.id);
  assert.equal(value.account.email, request.email);
  assert.ok(changed.cookie && changed.cookie !== a.cookie);
  assert.ok(value.csrfToken && value.csrfToken !== a.csrf);
  const fresh = { ...a, email: request.email, cookie: changed.cookie!, csrf: value.csrfToken };
  const after = await snapshot(a);
  assert.equal(Number(after.row.email_revision), Number(oldRevision) + 1);
  assert.equal(after.row.version, before.row.version + 1);
  assert.equal(after.row.credential_revision, before.row.credential_revision);
  assert.deepEqual(after.row.credential_changed_at, before.row.credential_changed_at);
  assert.equal(after.row.password_hash, before.row.password_hash);
  assert.ok(after.row.email_verified_at);
  assert.equal(after.sessions.length, 1);
  assert.equal(after.sessions[0].auth_method, "PASSWORD");
  assert.equal(after.sessions[0].mfa_verified_at, null);
  assert.equal((await call("GET", "/account", undefined, a)).status, 401);
  assert.equal((await call("GET", "/account", undefined, otherSession)).status, 401);
  for (const org of [orgA, orgB]) {
    const members = data(await call("GET", "/organizations/" + org + "/members", undefined, fresh)).items;
    assert.equal(members.find((m: any) => m.accountId === a.id).accountId, a.id);
  }
  assert.equal((await call("POST", "/auth/recovery/complete", { token: recovery, newPassword: "Replacement!password-92847" })).status, 401);
  const replay = await complete(fresh, request.requestId, request.token, headers);
  const replayed = data(replay);
  assert.equal(replayed.requestId, value.requestId);
  assert.equal(replayed.state, "COMPLETED");
  assert.equal(replayed.csrfToken, undefined);
  assert.equal(replay.cookie, undefined);
  assert.equal((await complete(fresh, request.requestId, request.token, headers, { currentPassword: "wrong" })).status, 401);
  assert.equal((await complete(fresh, request.requestId, "tampered", headers)).status, 409);
  assert.deepEqual(await snapshot(a), after);
  noSecrets((await pool.query("SELECT result FROM account_commands WHERE account_id=$1", [a.id])).rows, [request.token, value.csrfToken, changed.cookie!.split("=")[1]]);
  noSecrets((await pool.query("SELECT * FROM account_events WHERE account_id=$1", [a.id])).rows, [request.token]);
  // An upgraded historical completion has no trustworthy session stamp. Its
  // cached metadata must not acquire a fabricated binding to this live session.
  await pool.query("UPDATE account_email_change_requests SET initiating_session_id=NULL,completion_session_id=NULL WHERE id=$1", [request.requestId]);
  assert.equal((await complete(fresh, request.requestId, request.token, headers)).status, 409);
  assert.deepEqual(await snapshot(a), after);
});

test("wrong token attempts commit independently, fifth locks request, and Account/session rows stay byte-for-byte unchanged", async () => {
  const a = await user(), request = await proof(a), before = await snapshot(a);
  for (let n = 1; n <= 5; n++) {
    const result = await complete(a, request.requestId, n === 2 ? null : "wrong-" + n);
    assert.equal(result.status, 401, result.raw);
    const row = (await pool.query("SELECT failed_attempts,state FROM account_email_change_requests WHERE id=$1", [request.requestId])).rows[0];
    assert.equal(row.failed_attempts, n);
    assert.equal(row.state, n === 5 ? "LOCKED" : "PENDING_PROOF");
    assert.deepEqual(await snapshot(a), before);
    noSecrets(result.body, [request.token]);
  }
  assert.equal((await complete(a, request.requestId, request.token)).status, 409);
  assert.deepEqual(await snapshot(a), before);
});

test("expired, credential-stale, foreign and occupied requests preserve all Account/session state", async () => {
  const a = await user(), other = await user();
  const expired = await proof(a);
  await pool.query("UPDATE account_email_change_requests SET created_at=clock_timestamp()-interval '31 minutes',expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1", [expired.requestId]);
  const before = await snapshot(a), foreignBefore = await snapshot(other);
  assert.equal((await complete(a, expired.requestId, expired.token)).status, 409);
  assert.equal((await complete(other, expired.requestId, expired.token)).status, 404);
  assert.equal((await call("GET", path + "/" + expired.requestId, undefined, other)).status, 404);
  assert.equal((await call("POST", path + "/" + expired.requestId + "/revoke", {}, other, { "if-match": '"1"' })).status, 404);
  assert.deepEqual(await snapshot(a), before);
  assert.deepEqual(await snapshot(other), foreignBefore);
  const occupied = await proof(a, other.email), occupiedBefore = await snapshot(a);
  const collision = await complete(a, occupied.requestId, occupied.token);
  assert.equal(collision.status, 409, collision.raw);
  assert.equal(collision.body.error.code, "EMAIL_CHANGE_UNAVAILABLE");
  assert.ok(!collision.raw.includes(other.id));
  assert.deepEqual(await snapshot(a), occupiedBefore);
  assert.deepEqual(await snapshot(other), foreignBefore);
  const stale = await proof(a);
  await pool.query("UPDATE account_email_change_requests SET credential_revision=credential_revision+1 WHERE id=$1", [stale.requestId]);
  assert.equal((await complete(a, stale.requestId, stale.token)).status, 409);
  assert.deepEqual(await snapshot(a), occupiedBefore);
});

test("one active intention replaces the previous proof; own status/revoke cancel plaintext mail and deny cross-account selectors", async () => {
  const a = await user(), first = data(await start(a), 202), second = data(await start(a), 202);
  const status = data(await call("GET", path + "/" + first.requestId, undefined, a));
  assert.equal(status.state, "REPLACED");
  const cancelled = (await pool.query("SELECT token,state FROM account_email_change_mail WHERE request_id=$1", [first.requestId])).rows[0];
  assert.deepEqual(cancelled, { token: null, state: "CANCELLED" });
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM account_email_change_requests WHERE account_id=$1 AND state='PENDING_PROOF'", [a.id])).rows[0].n, 1);
  const revokeKey = randomUUID();
  const revoked = await call("POST", path + "/" + second.requestId + "/revoke", {}, a, { "if-match": '"1"', "idempotency-key": revokeKey });
  assert.equal(data(revoked).state, "REVOKED");
  assert.equal(data(await call("POST", path + "/" + second.requestId + "/revoke", {}, a, { "if-match": '"1"', "idempotency-key": revokeKey })).state, "REVOKED");
  let sent = 0;
  assert.equal(await services.deliverAccountEmailChangeMail(async () => { sent++; }), 0);
  assert.equal(sent, 0);
  assert.equal(data(await call("GET", path, undefined, a)).items.length, 2);
  assert.equal((await start(a, randomUUID() + "@example.test", {}, { currentPassword: password, accountId: randomUUID() })).status, 400);
});

test("concurrent HTTP completions serialize on Account and uniqueness; replay cannot distribute a replacement session", async () => {
  const a = await user(), request = await proof(a), cmd = randomUUID();
  const concurrent = () => call("POST", path + "/" + request.requestId + "/complete", { mailboxToken: request.token, currentPassword: password }, a, { "idempotency-key": cmd, "if-match": '"1"' });
  const results = await Promise.all([concurrent(), concurrent()]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);
  assert.equal((await snapshot(a)).sessions.length, 1);
  const b = await user(), c = await user(), target = randomUUID() + "@example.test";
  const B = await proof(b, target), C = await proof(c, target);
  const beforeB = await snapshot(b), beforeC = await snapshot(c);
  const collisions = await Promise.all([complete(b, B.requestId, B.token), complete(c, C.requestId, C.token)]);
  assert.deepEqual(collisions.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM accounts WHERE email=$1", [target])).rows[0].n, 1);
  assert.deepEqual(await snapshot(collisions[0].status === 409 ? b : c), collisions[0].status === 409 ? beforeB : beforeC);
});

test("delivery uses real SMTP outside SQL, fences failures, and revalidates cancelled/stale intents before retries", async () => {
  const a = await user(), pending = data(await start(a), 202);
  assert.equal(await services.deliverAccountEmailChangeMail(async () => { throw Error("provider secret must never be persisted"); }), 0);
  const failed = (await pool.query("SELECT state,last_error,token FROM account_email_change_mail WHERE request_id=$1", [pending.requestId])).rows[0];
  assert.equal(failed.state, "FAILED");
  assert.equal(failed.last_error, "EMAIL_CHANGE_DELIVERY_FAILED");
  assert.ok(failed.token);
  await pool.query("UPDATE account_email_change_mail SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE request_id=$1", [pending.requestId]);
  let calls = 0;
  assert.equal(await services.deliverAccountEmailChangeMail(async (mail) => {
    calls++;
    await transaction(async (c) => {
      await c.query("SET LOCAL lock_timeout='1s'");
      await c.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [a.id]);
    });
    await sendLocalMail(mail, smtpPort);
  }), 1);
  assert.equal(calls, 1);
  const second = data(await start(a), 202);
  await pool.query("UPDATE account_email_change_requests SET email_revision=email_revision+1 WHERE id=$1", [second.requestId]);
  assert.equal(await services.deliverAccountEmailChangeMail(async () => { throw Error("stale sender must never run"); }), 0);
  assert.deepEqual((await pool.query("SELECT state,token FROM account_email_change_mail WHERE request_id=$1", [second.requestId])).rows[0], { state: "CANCELLED", token: null });
});

function decode(value: string) {
  let bits = 0, acc = 0; const bytes: number[] = [];
  for (const char of value) {
    acc = (acc << 5) | "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(char); bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((acc >>> bits) & 255); }
  }
  return Buffer.from(bytes);
}
test("current MFA is actually verified and only the completed replacement session gets its proven stamp", async () => {
  const a = await user();
  const enrollment = data(await call("POST", "/account/mfa/enrollment/start", { currentPassword: password }, a));
  const seed = decode(enrollment.secret), step = Math.floor(Date.now() / 30000);
  data(await call("POST", "/account/mfa/enrollment/confirm", { code: totpAt(seed, step - 1) }, a));
  await pool.query("UPDATE sessions SET mfa_verified_at=NULL,mfa_factor_revision=NULL WHERE account_id=$1", [a.id]);
  assert.equal((await start(a)).status, 401);
  const email = randomUUID() + "@example.test";
  const pending = data(await start(a, email, {}, { currentPassword: password, totpCode: totpAt(seed, step) }), 202);
  await services.deliverAccountEmailChangeMail((mail) => sendLocalMail(mail, smtpPort));
  const mails = await Promise.all((await readdir(join(directory, "smtp"))).map((f) => readFile(join(directory, "smtp", f), "utf8")));
  const token = mails.find((m) => m.includes("To: <" + email + ">"))!.match(/Email change token \(expires in 30 minutes\):\r?\n([a-f0-9]{64})/)![1];
  const before = await snapshot(a);
  assert.equal((await complete(a, pending.requestId, token)).status, 401);
  assert.deepEqual(await snapshot(a), before);
  const freshCode = totpAt(seed, step + 1);
  const factorBefore = (await pool.query("SELECT last_used_step FROM account_mfa_factors WHERE account_id=$1", [a.id])).rows[0];
  assert.equal((await complete(a, pending.requestId, "wrong-token", {}, { currentPassword: password, totpCode: freshCode })).status, 401);
  assert.deepEqual(await snapshot(a), before);
  assert.deepEqual((await pool.query("SELECT last_used_step FROM account_mfa_factors WHERE account_id=$1", [a.id])).rows[0], factorBefore);
  assert.equal((await pool.query("SELECT failed_attempts FROM account_email_change_requests WHERE id=$1", [pending.requestId])).rows[0].failed_attempts, 1);
  const done = data(await complete(a, pending.requestId, token, {}, { currentPassword: password, totpCode: freshCode }));
  assert.equal(done.account.email, email);
  const stamped = (await snapshot(a)).sessions[0];
  assert.ok(stamped.mfa_verified_at);
  assert.equal(String(stamped.mfa_factor_revision), String(before.row.mfa_revision));
});

test("persistent own request rate budget remains bounded through failures", async () => {
  const a = await user();
  for (let i = 0; i < 6; i++) assert.equal((await start(a, undefined, {}, { currentPassword: "wrong" })).status, 401);
  assert.equal((await start(a)).status, 429);
  assert.equal((await pool.query("SELECT attempts FROM account_email_change_rate_budgets WHERE account_id=$1 AND operation='REQUEST'", [a.id])).rows[0].attempts, 7);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM account_email_change_requests WHERE account_id=$1", [a.id])).rows[0].n, 0);
});

test("federated reauthentication registration seam: disabled password fails closed without verifier or current verified provenance, then retains issuer/subject", async () => {
  const a = await user();
  const org = data(await call("POST", "/organizations", { name: "Federated seam" }, a), 201).organization.id;
  await pool.query("UPDATE accounts SET password_enabled=false WHERE id=$1", [a.id]);
  assert.equal((await start(a, undefined, {}, {})).status, 401);
  const connection = randomUUID(), issuer = "https://verified-provider.example.test", subject = randomUUID();
  async function federation(verifiedAt: Date, authTime: Date | null = verifiedAt) {
    const issued = await transaction(async (c) => {
      await c.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [a.id]);
      return createSessionRecord(c, a.id, { method: "FEDERATED", organizationId: org,
        connectionId: connection, issuer, subject, verifiedAt, amr: ["external"], ...(authTime ? { authTime } : {}) });
    });
    return { ...a, cookie: "orgmap_session=" + issued.token, csrf: issued.csrf };
  }
  const old = await federation(new Date(Date.now() - 360000));
  assert.equal((await start(old, undefined, {}, {})).status, 401);
  const fresh = await federation(new Date()), before = await snapshot(a);
  const unavailable = await start(fresh, undefined, {}, {});
  assert.equal(unavailable.status, 503, unavailable.raw);
  assert.equal(unavailable.body.error.code, "FEDERATION_REAUTHENTICATION_UNAVAILABLE");
  let verified = false, calls = 0;
  core.registerAccountFederatedReauthenticationVerifier(async ({ c, accountId, sessionId }) => {
    calls++;
    const row = (await c.query("SELECT auth_issuer,auth_subject,auth_connection_id FROM sessions WHERE account_id=$1 AND id=$2", [accountId, sessionId])).rows[0];
    return verified && row?.auth_issuer === issuer && row?.auth_subject === subject && row?.auth_connection_id === connection;
  });
  assert.equal((await start(fresh, undefined, {}, {})).status, 401);
  assert.deepEqual(await snapshot(a), before);
  verified = true;
  // These are persisted provenance seam fixtures, not signed OIDC/SAML proofs.
  // A recent local verifiedAt cannot freshen old or absent authenticated time.
  const oldAuthTime = await federation(new Date(), new Date(Date.now() - 360000));
  const missingAuthTime = await federation(new Date(), null);
  for (const insufficient of [oldAuthTime, missingAuthTime]) {
    const insufficientBefore = await snapshot(a);
    const denied = await call("POST", path, { newEmail: randomUUID() + "@example.test" }, insufficient, { "if-match": '"' + (await account(insufficient)).version + '"' });
    // These negative authorization attempts share the real six-request budget;
    // open a fresh budget window in this exclusive fixture only.
    assert.equal(denied.status, 401, denied.raw);
    assert.deepEqual(await snapshot(a), insufficientBefore);
  }
  await pool.query("UPDATE account_email_change_rate_budgets SET window_started_at=clock_timestamp()-interval '2 hours' WHERE account_id=$1 AND operation='REQUEST'", [a.id]);
  const email = randomUUID() + "@example.test", pending = data(await start(fresh, email, {}, {}), 202);
  assert.equal(await services.deliverAccountEmailChangeMail((mail) => sendLocalMail(mail, smtpPort)), 1);
  const mails = await Promise.all((await readdir(join(directory, "smtp"))).map((f) => readFile(join(directory, "smtp", f), "utf8")));
  const token = mails.find((m) => m.includes("To: <" + email + ">"))!.match(/Email change token \(expires in 30 minutes\):\r?\n([a-f0-9]{64})/)![1];
  const changed = await complete(fresh, pending.requestId, token, {}, {});
  data(changed);
  assert.ok(calls >= 3);
  const after = await snapshot(a), session = after.sessions[0];
  assert.equal(after.row.password_enabled, false);
  assert.equal(after.row.password_hash, before.row.password_hash);
  assert.equal(after.row.credential_revision, before.row.credential_revision);
  assert.equal(session.auth_method, "FEDERATED");
  assert.equal(session.auth_organization_id, org);
  assert.equal(session.auth_connection_id, connection);
  assert.equal(session.auth_issuer, issuer);
  assert.equal(session.auth_subject, subject);
  assert.deepEqual(session.auth_amr, ["external"]);
  assert.equal(session.mfa_verified_at, null);
  // A real verified federated alternative is also usable while a password is
  // enabled, without treating the mere presence of that password as proof.
  await pool.query("UPDATE accounts SET password_enabled=true WHERE id=$1", [a.id]);
  const enabledFederation = await federation(new Date());
  const enabledStart = data(await start(enabledFederation, undefined, {}, {}), 202);
  data(await call("POST", path + "/" + enabledStart.requestId + "/revoke", {}, enabledFederation,
    { "if-match": '"' + (await account(enabledFederation)).version + '"' }));
});

test("crossorg admission SMTP proofs and retries stay stale through old→new→old email epochs; nominal invitation stays addressed to old mailbox", async () => {
  const owner = await user(), actor = await user(), oldEmail = actor.email;
  const A = data(await call("POST", "/organizations", { name: "Admission epoch A" }, owner), 201).organization.id;
  const B = data(await call("POST", "/organizations", { name: "Actor invariant B" }, actor), 201).organization.id;
  admissionPolicies.set(A, { ...defaultAdmissionPolicy(), policyId: randomUUID(), revision: 1, registrationMode: "OPEN" });
  const baseA = "/organizations/" + A;
  const beforeAccount = (await snapshot(actor)).row, beforeB = await organizationSnapshot(B);
  const invitation = data(await call("POST", baseA + "/invitations", { email: oldEmail, memberType: "MEMBER", accessPlan: [] }, owner), 201);
  assert.equal(await core.deliverInvitationMail(A, (mail) => sendLocalMail(mail, smtpPort)), 1);
  const invitationMail = await smtpMessage(invitation.deliveryJobId);
  assert.ok(invitationMail.includes("To: <" + oldEmail + ">"));
  const invitationToken = proofToken(invitationMail);
  assert.match(invitationToken, /^[a-f0-9]{64}$/);

  // This fixture fails before any transport I/O, so a retry is safe. The
  // outbound message is captured in memory; no delivery is claimed.
  async function pendingAdmission() {
    const requested = data(await call("POST", baseA + "/admission/requests", {}, actor), 202);
    const job = await scoped(A, async (c) => (await c.query("SELECT id FROM admission_mail WHERE organization_id=$1 AND request_id=$2", [A, requested.requestId])).rows[0]);
    let outbound: {to:string;text:string}|undefined;
    assert.equal(await core.deliverAdmissionMail(A, async (mail) => {
      outbound=mail;
      throw new SmtpDeliveryError("NOT_SENT", "synthetic failure before transport");
    }), 0);
    assert.ok(outbound);
    assert.ok(outbound.text.includes("request " + requested.requestId + " "));
    assert.equal(outbound.to,oldEmail);
    const token = outbound.text.match(/(?:^|\n)([a-f0-9]{64})\s*$/)?.[1];
    assert.ok(token);
    await scoped(A, async (c) => {
      const row = (await c.query("SELECT state,last_error FROM admission_mail WHERE organization_id=$1 AND id=$2", [A, job.id])).rows[0];
      assert.deepEqual(row, { state: "FAILED", last_error: "SMTP_DELIVERY_FAILED" });
      await c.query("UPDATE admission_mail SET next_attempt_at=clock_timestamp()+interval '1 day' WHERE organization_id=$1 AND id=$2", [A, job.id]);
    });
    return { requestId: requested.requestId, jobId: job.id, token };
  }
  const first = await pendingAdmission(), cycle = await pendingAdmission();
  const change = await proof(actor);
  const completed = await complete(actor, change.requestId, change.token), changed = data(completed);
  let current = { ...actor, email: change.email, cookie: completed.cookie!, csrf: changed.csrfToken };
  assert.equal((await call("POST", "/invitations/accept", { token: invitationToken }, current)).status, 404);
  const staleComplete = async (intent: typeof first) => {
    const response = await call("POST", baseA + "/admission/requests/" + intent.requestId + "/complete", { mailboxToken: intent.token }, current);
    assert.equal(response.status, 404, response.raw);
    assert.equal(response.body.error.code, "ADMISSION_INVALID");
  };
  await staleComplete(first);
  let deliveries = 0;
  async function denyRetry(intent: typeof first) {
    await scoped(A, (c) => c.query("UPDATE admission_mail SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE organization_id=$1 AND id=$2", [A, intent.jobId]));
    assert.equal(await core.deliverAdmissionMail(A, async () => { deliveries++; }), 0);
    assert.deepEqual(await scoped(A, async (c) => (await c.query("SELECT state,token FROM admission_mail WHERE organization_id=$1 AND id=$2", [A, intent.jobId])).rows[0]), { state: "CANCELLED", token: null });
  }
  await denyRetry(first);
  assert.equal(deliveries, 0);
  assert.deepEqual(await organizationSnapshot(B), beforeB);
  data(await call("GET", "/organizations/" + B + "/bootstrap", undefined, current));

  // Address equality is restored, but the old Account-bound epoch remains stale.
  const returnProof = await proof(current, oldEmail), returned = await complete(current, returnProof.requestId, returnProof.token), returnedData = data(returned);
  current = { ...current, email: oldEmail, cookie: returned.cookie!, csrf: returnedData.csrfToken };
  const afterCycle = (await snapshot(current)).row;
  assert.equal(afterCycle.id, actor.id);
  assert.equal(afterCycle.email, oldEmail);
  assert.equal(Number(afterCycle.email_revision), Number(beforeAccount.email_revision) + 2);
  assert.equal(afterCycle.credential_revision, beforeAccount.credential_revision);
  assert.deepEqual(afterCycle.credential_changed_at, beforeAccount.credential_changed_at);
  assert.equal(afterCycle.password_hash, beforeAccount.password_hash);
  await staleComplete(first);
  await staleComplete(cycle);
  await denyRetry(cycle);
  assert.equal(deliveries, 0);
  assert.deepEqual(await organizationSnapshot(B), beforeB);
  data(await call("GET", "/organizations/" + B + "/bootstrap", undefined, current));
  const invariantA = await scoped(A, async (c) => ({
    invitation: (await c.query("SELECT id,email,status FROM invitations WHERE organization_id=$1 AND id=$2", [A, invitation.invitation.id])).rows[0],
    member: (await c.query("SELECT id FROM members WHERE organization_id=$1 AND account_id=$2", [A, actor.id])).rows,
    requests: (await c.query("SELECT email,email_revision,completed_at FROM admission_requests WHERE organization_id=$1 AND account_id=$2 ORDER BY id", [A, actor.id])).rows,
  }));
  assert.deepEqual(invariantA.invitation, { id: invitation.invitation.id, email: oldEmail, status: "PENDING" });
  assert.deepEqual(invariantA.member, []);
  assert.equal(invariantA.requests.length, 2);
  for (const request of invariantA.requests) {
    assert.equal(request.email, oldEmail);
    assert.equal(request.email_revision, beforeAccount.email_revision);
    assert.equal(request.completed_at, null);
  }
});

test("actual organization credential attestation becomes stale only by email epoch while credential age/revision and open B stay intact", async () => {
  const a = await user();
  const A = data(await call("POST", "/organizations", { name: "Attestation epoch A" }, a), 201).organization.id;
  const B = data(await call("POST", "/organizations", { name: "Attestation open B" }, a), 201).organization.id;
  credentialPolicies.set(A, { policyId: randomUUID(), revision: 1, complexity: false, strength: "LOW", expirationDays: null, mfaEnforced: false });
  const baseA = "/organizations/" + A, baseB = "/organizations/" + B;
  assert.equal((await call("GET", baseA + "/bootstrap", undefined, a)).status, 403);
  data(await call("POST", baseA + "/security/attest", { password }, a));
  data(await call("GET", baseA + "/bootstrap", undefined, a));
  data(await call("GET", baseB + "/bootstrap", undefined, a));
  const before = (await snapshot(a)).row, beforeB = await organizationSnapshot(B);
  const readAttestation = () => scoped(A, async (c) => (await c.query("SELECT * FROM credential_attestations WHERE organization_id=$1 AND account_id=$2", [A, a.id])).rows[0]);
  const oldAttestation = await readAttestation();
  assert.equal(oldAttestation.email_revision, before.email_revision);
  const request = await proof(a), response = await complete(a, request.requestId, request.token), changed = data(response);
  const fresh = { ...a, email: request.email, cookie: response.cookie!, csrf: changed.csrfToken };
  const after = (await snapshot(fresh)).row;
  assert.equal(after.credential_revision, before.credential_revision);
  assert.deepEqual(after.credential_changed_at, before.credential_changed_at);
  assert.equal(after.password_hash, before.password_hash);
  assert.equal(Number(after.email_revision), Number(before.email_revision) + 1);
  assert.deepEqual(await readAttestation(), oldAttestation);
  const blocked = await call("GET", baseA + "/bootstrap", undefined, fresh);
  assert.equal(blocked.status, 403, blocked.raw);
  assert.equal(blocked.body.error.code, "ORG_CREDENTIAL_REQUIREMENT_UNMET");
  data(await call("GET", baseB + "/bootstrap", undefined, fresh));
  assert.deepEqual(await organizationSnapshot(B), beforeB);
  data(await call("POST", baseA + "/security/attest", { password }, fresh));
  const currentAttestation = await readAttestation();
  assert.equal(currentAttestation.email_revision, after.email_revision);
  assert.equal(currentAttestation.credential_revision, oldAttestation.credential_revision);
  data(await call("GET", baseA + "/bootstrap", undefined, fresh));
  data(await call("GET", baseB + "/bootstrap", undefined, fresh));
  const final = (await snapshot(fresh)).row;
  assert.equal(final.credential_revision, before.credential_revision);
  assert.deepEqual(final.credential_changed_at, before.credential_changed_at);

  const noOpProfile = data(await call("PATCH", "/account", { displayName: final.display_name }, fresh, { "if-match": '"' + final.version + '"' })).account;
  const afterNoOp = (await snapshot(fresh)).row;
  assert.equal(afterNoOp.credential_policy_input_revision, final.credential_policy_input_revision);
  data(await call("GET", baseA + "/bootstrap", undefined, fresh));
  data(await call("PATCH", "/account", { displayName: "A different evaluator context" }, fresh, { "if-match": '"' + noOpProfile.version + '"' }));
  const renamed = (await snapshot(fresh)).row;
  assert.equal(Number(renamed.credential_policy_input_revision), Number(final.credential_policy_input_revision) + 1);
  assert.equal(renamed.credential_revision, before.credential_revision);
  assert.deepEqual(renamed.credential_changed_at, before.credential_changed_at);
  const staleName = await call("GET", baseA + "/bootstrap", undefined, fresh);
  assert.equal(staleName.status, 403, staleName.raw);
  assert.equal(staleName.body.error.code, "ORG_CREDENTIAL_REQUIREMENT_UNMET");
  data(await call("GET", baseB + "/bootstrap", undefined, fresh));
  data(await call("POST", baseA + "/security/attest", { password }, fresh));
  data(await call("GET", baseA + "/bootstrap", undefined, fresh));
});

test("pending mailbox proof belongs to its initiating live session; concurrent or post-logout login cannot borrow it", async () => {
  const a = await user(), pending = await proof(a);
  const initiating = (await pool.query("SELECT initiating_session_id FROM account_email_change_requests WHERE id=$1", [pending.requestId])).rows[0].initiating_session_id;
  assert.equal(initiating, (await pool.query("SELECT id FROM sessions WHERE token_hash=$1", [digest(a.cookie.split("=")[1])])).rows[0].id);
  const secondLogin = await call("POST", "/auth/login", { email: a.email, password }), secondData = data(secondLogin);
  const concurrent = { ...a, cookie: secondLogin.cookie!, csrf: secondData.csrfToken };
  const beforeConcurrent = await snapshot(a);
  const borrowed = await complete(concurrent, pending.requestId, pending.token);
  assert.equal(borrowed.status, 409, borrowed.raw);
  assert.equal(borrowed.body.error.code, "EMAIL_CHANGE_INVALID");
  assert.deepEqual(await snapshot(a), beforeConcurrent);
  assert.equal((await pool.query("SELECT failed_attempts FROM account_email_change_requests WHERE id=$1", [pending.requestId])).rows[0].failed_attempts, 0);

  data(await call("POST", "/auth/logout", {}, a));
  const relogin = await call("POST", "/auth/login", { email: a.email, password }), relogged = data(relogin);
  const current = { ...a, cookie: relogin.cookie!, csrf: relogged.csrfToken };
  const beforeNew = await snapshot(a);
  const afterLogout = await complete(current, pending.requestId, pending.token);
  assert.equal(afterLogout.status, 409, afterLogout.raw);
  assert.equal(afterLogout.body.error.code, "EMAIL_CHANGE_INVALID");
  assert.deepEqual(await snapshot(a), beforeNew);
  assert.equal((await call("GET", "/account", undefined, a)).status, 401);
  data(await call("GET", "/account", undefined, concurrent));
  data(await call("GET", "/account", undefined, current));
  assert.equal(data(await call("GET", path + "/" + pending.requestId, undefined, current)).state, "EXPIRED");
});
