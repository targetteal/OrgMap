import { after, test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { domainToASCII } from "node:url";
import { createPublicAdmissionServices } from "../../server/src/admission-public.js";
import {
  canonicalAdmissionDomain,
  normalizeAdmissionEmail,
} from "../../server/src/admission.js";
import { createRuntime } from "../../server/src/runtime.js";
import { buildApp } from "../../server/src/app.js";
import { createSessionRecord } from "../../server/src/sessions.js";
import { pool, transaction } from "../../server/src/db.js";
import { digest, fail, Failure } from "../../server/src/core.js";
import { sendLocalMail, startSmtpSink, SmtpDeliveryError } from "../../server/src/smtp.js";
import type { AdmissionPolicy } from "../../server/src/admission-contract.js";

const runtime = new URL(process.env.DATABASE_URL ?? "postgres://invalid/"),
  operator = new URL(
    process.env.MIGRATION_DATABASE_URL ?? "postgres://invalid/",
  );
if (
  !/^\/orgmap_admission_public_[a-f0-9]{16}$/.test(runtime.pathname) ||
  runtime.pathname !== operator.pathname ||
  runtime.host !== operator.host ||
  !["127.0.0.1", "localhost", "[::1]"].includes(runtime.hostname)
)
  throw Error("EXCLUSIVE_PUBLIC_ADMISSION_DATABASE_REQUIRED");
const directory = await mkdtemp(join(tmpdir(), "orgmap-admission-public-"));
const smtp = await startSmtpSink({ port: 0, directory });
const smtpPort = (smtp.address() as { port: number }).port;
const sender = (mail: Parameters<typeof sendLocalMail>[0]) =>
  sendLocalMail(mail, smtpPort);
const core = createRuntime(),
  policies = new Map<string, AdmissionPolicy>();
let configured = true;
const resolve = async ({ organizationId }: any) =>
  policies.get(organizationId) ??
  ({
    schemaVersion: 1,
    policyId: null,
    revision: 0,
    registrationMode: "DISABLED",
    allowedDomains: [],
    membersMayInvite: false,
    limitMemberInvitesToDomains: false,
    invitationLinkEnabled: false,
  } as AdmissionPolicy);
const services = createPublicAdmissionServices({
  auth: core.auth,
  envelope: core.envelope,
  tenant: core.tenant,
  changed: core.changed,
  resolveAdmissionPolicy: resolve,
  isAdmissionMailConfigured: () => configured,
  assertPublicAdmission: (p, email, source) => {
    if (
      p.registrationMode === "DISABLED" ||
      (source === "INVITATION_LINK" && !p.invitationLinkEnabled)
    )
      fail(403, "ADMISSION_DENIED");
    const domain = domainToASCII(
      email.slice(email.lastIndexOf("@") + 1),
    ).toLowerCase();
    if (
      p.registrationMode === "DOMAIN_RESTRICTED" &&
      !p.allowedDomains.includes(domain)
    )
      fail(403, "ADMISSION_DENIED");
  },
});
const app = Fastify();
await app.register(cookie);
app.addHook("onRequest", async (r) => {
  if (r.method !== "GET" && r.headers.origin !== "http://localhost:5173")
    fail(403, "ORIGIN_DENIED");
});
app.setErrorHandler((error, _r, reply) => {
  if (error instanceof Failure)
    return reply.code(error.status).send({ error: { code: error.code } });
  throw error;
});
await services.registerPublicAdmissionRoutes(app);
after(async () => {
  await app.close();
  await pool.end();
  await new Promise<void>((resolve, reject) =>
    smtp.close((error) => (error ? reject(error) : resolve())),
  );
  await rm(directory, { recursive: true, force: true });
});
type User = { id: string; email: string; cookie: string; csrf: string };
async function user(email = randomUUID() + "@example.test"): Promise<User> {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO accounts(id,email,display_name,password_hash) VALUES($1,$2,'Admission fixture','unused')",
    [id, email],
  );
  const session = await transaction((c) =>
    createSessionRecord(c, id, { method: "PASSWORD" }),
  );
  return {
    id,
    email,
    cookie: "orgmap_session=" + session.token,
    csrf: session.csrf,
  };
}
async function org(owner: User) {
  const id = randomUUID(),
    member = randomUUID();
  await transaction(async (c) => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [id]);
    await c.query(
      "INSERT INTO organizations(id,name,locale,time_zone) VALUES($1,'Admission fixture','en','UTC')",
      [id],
    );
    await c.query(
      "INSERT INTO members(organization_id,id,account_id,org_role) VALUES($1,$2,$3,'OWNER')",
      [id, member, owner.id],
    );
  });
  return { id, member, base: "/api/v1/organizations/" + id };
}
function setPolicy(org: string, changes: Partial<AdmissionPolicy> = {}) {
  const p: AdmissionPolicy = {
    schemaVersion: 1,
    policyId: randomUUID(),
    revision: (policies.get(org)?.revision ?? 0) + 1,
    registrationMode: "OPEN",
    allowedDomains: [],
    membersMayInvite: false,
    limitMemberInvitesToDomains: false,
    invitationLinkEnabled: false,
    ...changes,
  };
  policies.set(org, p);
  return p;
}
async function call(
  method: any,
  path: string,
  payload: any = undefined,
  u?: User,
  headers: any = {},
  ip: string = randomUUID(),
) {
  return app.inject({
    method,
    url: path,
    payload,
    remoteAddress: ip,
    headers: {
      origin: "http://localhost:5173",
      "idempotency-key": randomUUID(),
      ...(u ? { cookie: u.cookie, "x-csrf-token": u.csrf } : {}),
      ...headers,
    },
  });
}
function ok(response: any, status?: number) {
  assert.ok(
    status
      ? response.statusCode === status
      : [200, 201, 202].includes(response.statusCode),
    response.body,
  );
  return response.json().data;
}
function denied(response: any, code?: string, status?: number) {
  assert.ok(
    status ? response.statusCode === status : response.statusCode >= 400,
    response.body,
  );
  if (code) assert.equal(response.json().error.code, code, response.body);
}
async function scoped<T>(org: string, fn: (c: PoolClient) => Promise<T>) {
  return transaction(async (c) => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [org]);
    return fn(c);
  });
}
async function row(org: string, table: string, where = "", args: any[] = []) {
  return scoped(
    org,
    async (c) =>
      (
        await c.query(
          "SELECT * FROM " + table + " WHERE organization_id=$1 " + where,
          [org, ...args],
        )
      ).rows,
  );
}
async function request(
  A: Awaited<ReturnType<typeof org>>,
  u: User,
  linkToken?: string,
) {
  const result = ok(
    await call(
      "POST",
      A.base + "/admission/" + (linkToken ? "link-requests" : "requests"),
      linkToken ? { linkToken } : {},
      u,
    ),
    202,
  );
  return {
    id: result.requestId as string,
    path: A.base + "/admission/requests/" + result.requestId + "/complete",
  };
}
let smtpEvidenceRecorded = false;
async function mailbox(
  A: Awaited<ReturnType<typeof org>>,
  u: User,
  req: { id: string },
) {
  await services.deliverAdmissionMail(A.id, sender);
  const mails = await Promise.all(
    (await readdir(directory)).map((name) =>
      readFile(join(directory, name), "utf8"),
    ),
  );
  const exact = mails.filter(
    (mail) =>
      mail.includes("request " + req.id + " ") &&
      mail.includes("To: <" + u.email + ">"),
  );
  assert.equal(exact.length, 1, "exact request mailbox SMTP transcript");
  const raw = exact[0].match(/\r\n([a-f0-9]{64})\r\n$/)?.[1];
  assert.ok(raw, "opaque mailbox token in actual SMTP body");
  if (!smtpEvidenceRecorded) {
    smtpEvidenceRecorded = true;
    console.info(
      "ADMISSION_SMTP_EVIDENCE " +
        JSON.stringify({
          organizationId: A.id,
          requestId: req.id,
          to: u.email,
          emlSha256: digest(exact[0]),
          bytes: Buffer.byteLength(exact[0]),
          transcript: exact[0].replace(raw, "[REDACTED mailbox token]"),
        }),
    );
  }
  return raw;
}
async function issue(A: Awaited<ReturnType<typeof org>>, owner: User) {
  const meta = ok(
    await call("GET", A.base + "/invitation-links", undefined, owner),
  );
  const k = randomUUID(),
    payload = {},
    headers = { "if-match": '"' + meta.version + '"', "idempotency-key": k };
  const value = ok(
    await call("POST", A.base + "/invitation-links", payload, owner, headers),
  );
  assert.match(value.linkToken, /^[a-f0-9]{64}$/);
  assert.equal(value.secretUnavailable, false);
  const replay = ok(
    await call("POST", A.base + "/invitation-links", payload, owner, headers),
  );
  assert.equal(replay.linkToken, undefined);
  assert.equal(replay.secretUnavailable, true);
  return value;
}

test("default disabled, own session CSRF/Origin, closed payload and no premature membership", async () => {
  const owner = await user(),
    u = await user(),
    A = await org(owner);
  denied(
    await call("POST", A.base + "/admission/requests", {}, u),
    "ADMISSION_DENIED",
    403,
  );
  setPolicy(A.id);
  denied(
    await call("POST", A.base + "/admission/requests", {}),
    "UNAUTHENTICATED",
    401,
  );
  denied(
    await call("POST", A.base + "/admission/requests", {}, u, {
      "x-csrf-token": "wrong",
    }),
    "CSRF_INVALID",
    403,
  );
  denied(
    await call("POST", A.base + "/admission/requests", {}, u, {
      origin: "https://evil.test",
    }),
    "ORIGIN_DENIED",
    403,
  );
  denied(
    await call(
      "POST",
      A.base + "/admission/requests",
      { accountId: owner.id, source: "ADMIN_ADD", emailVerified: true },
      u,
    ),
    "INVALID_REQUEST",
    400,
  );
  const req = await request(A, u);
  assert.equal(
    (await row(A.id, "members", "AND account_id=$2", [u.id])).length,
    0,
  );
  const intents = await row(A.id, "admission_requests", "AND id=$2", [req.id]);
  assert.equal(intents[0].source, "PUBLIC_JOIN");
  assert.equal(intents[0].policy_revision, 1);
  assert.equal(intents[0].token, undefined);
});
test("OPEN consumes actual SMTP proof once; replay revalidates own Account and current membership", async () => {
  const owner = await user(),
    u = await user(),
    other = await user(),
    A = await org(owner),
    B = await org(owner);
  setPolicy(A.id);
  setPolicy(B.id);
  const req = await request(A, u),
    raw = await mailbox(A, u, req),
    k = randomUUID();
  assert.equal(
    (await row(A.id, "admission_mail", "AND request_id=$2", [req.id]))[0].token,
    null,
  );
  denied(
    await call("POST", req.path, { mailboxToken: raw }, other),
    "ADMISSION_INVALID",
    404,
  );
  denied(
    await call("POST", req.path.replace(A.id, B.id), { mailboxToken: raw }, u),
    "ADMISSION_INVALID",
    404,
  );
  const first = ok(
    await call("POST", req.path, { mailboxToken: raw }, u, {
      "idempotency-key": k,
    }),
    201,
  );
  assert.equal(first.membership.orgRole, "MEMBER");
  assert.equal(first.membership.memberType, "MEMBER");
  const replay = ok(
    await call("POST", req.path, { mailboxToken: raw }, u, {
      "idempotency-key": k,
    }),
    200,
  );
  assert.equal(replay.membership.id, first.membership.id);
  denied(
    await call("POST", req.path, { mailboxToken: raw }, u),
    "ADMISSION_ALREADY_COMPLETED",
    409,
  );
  assert.equal(
    (await row(A.id, "members", "AND account_id=$2", [u.id])).length,
    1,
  );
  const stored =
    JSON.stringify(await row(A.id, "command_results")) +
    JSON.stringify(await row(A.id, "audit_events"));
  assert.ok(!stored.includes(raw));
  assert.equal(
    (await pool.query("SELECT email FROM accounts WHERE id=$1", [u.id])).rows[0]
      .email,
    u.email,
  );
  await scoped(A.id, (c) =>
    c.query(
      "UPDATE members SET status='SUSPENDED' WHERE organization_id=$1 AND account_id=$2",
      [A.id, u.id],
    ),
  );
  denied(
    await call("POST", req.path, { mailboxToken: raw }, u, {
      "idempotency-key": k,
    }),
    "MEMBERSHIP_SUSPENDED",
    403,
  );
});
test("proof binds policy revision, email, TTL, and a persistent five-attempt budget", async () => {
  const owner = await user(),
    A = await org(owner);
  setPolicy(A.id);
  const u = await user(),
    req = await request(A, u),
    raw = await mailbox(A, u, req);
  for (let n = 0; n < 5; n++)
    denied(
      await call("POST", req.path, { mailboxToken: "wrong" }, u),
      "ADMISSION_INVALID",
      404,
    );
  assert.equal(
    (await row(A.id, "admission_requests", "AND id=$2", [req.id]))[0].attempts,
    5,
  );
  denied(
    await call("POST", req.path, { mailboxToken: raw }, u),
    "ADMISSION_INVALID",
    404,
  );
  const expiredUser = await user(),
    expired = await request(A, expiredUser),
    expiredToken = await mailbox(A, expiredUser, expired);
  await scoped(A.id, (c) =>
    c.query(
      "UPDATE admission_requests SET expires_at=clock_timestamp()-interval '1 second' WHERE organization_id=$1 AND id=$2",
      [A.id, expired.id],
    ),
  );
  denied(
    await call(
      "POST",
      expired.path,
      { mailboxToken: expiredToken },
      expiredUser,
    ),
    "ADMISSION_INVALID",
    404,
  );
  const changedUser = await user(),
    changed = await request(A, changedUser),
    changedToken = await mailbox(A, changedUser, changed);
  setPolicy(A.id);
  denied(
    await call(
      "POST",
      changed.path,
      { mailboxToken: changedToken },
      changedUser,
    ),
    "POLICY_CHANGED",
    409,
  );
  const emailUser = await user(),
    emailRequest = await request(A, emailUser),
    emailToken = await mailbox(A, emailUser, emailRequest);
  await pool.query("UPDATE accounts SET email=$2 WHERE id=$1", [
    emailUser.id,
    randomUUID() + "@example.test",
  ]);
  denied(
    await call(
      "POST",
      emailRequest.path,
      { mailboxToken: emailToken },
      emailUser,
    ),
    "ADMISSION_INVALID",
    404,
  );
  assert.equal((await row(A.id, "members")).length, 1);
});
test("exact-domain policy, account-org request throttle, Guest conflict and suspension preserve global identity", async () => {
  const owner = await user(),
    A = await org(owner),
    B = await org(owner);
  setPolicy(A.id, {
    registrationMode: "DOMAIN_RESTRICTED",
    allowedDomains: ["example.test", "xn--bcher-kva.test"],
  });
  setPolicy(B.id);
  for (const domain of [
    "evil-example.test",
    "example.test.evil",
    "sub.example.test",
  ])
    denied(
      await call(
        "POST",
        A.base + "/admission/requests",
        {},
        await user(randomUUID() + "@" + domain),
      ),
      "ADMISSION_DENIED",
      403,
    );
  await request(A, await user(randomUUID() + "@BÜCHER.test"));
  const u = await user();
  for (let i = 0; i < 5; i++) await request(A, u);
  denied(
    await call("POST", A.base + "/admission/requests", {}, u),
    "RATE_LIMITED",
    429,
  );
  await request(B, u);
  const guest = await user(),
    suspended = await user();
  await scoped(A.id, async (c) => {
    await c.query(
      "INSERT INTO members(organization_id,id,account_id,org_role,member_type) VALUES($1,$2,$3,'MEMBER','GUEST')",
      [A.id, randomUUID(), guest.id],
    );
    await c.query(
      "INSERT INTO members(organization_id,id,account_id,org_role,status) VALUES($1,$2,$3,'MEMBER','SUSPENDED')",
      [A.id, randomUUID(), suspended.id],
    );
  });
  denied(
    await call("POST", A.base + "/admission/requests", {}, guest),
    "TYPE_CHANGE_REQUIRED",
    409,
  );
  denied(
    await call("POST", A.base + "/admission/requests", {}, suspended),
    "MEMBERSHIP_SUSPENDED",
    403,
  );
  await request(B, guest);
  await request(B, suspended);
});
test("owner links keep secrets out of metadata/ledger; rotate, revoke, expiry, quota, and distinct replay", async () => {
  const owner = await user(),
    A = await org(owner),
    u = await user();
  setPolicy(A.id, { invitationLinkEnabled: true });
  const issued = await issue(A, owner),
    req = await request(A, u, issued.linkToken),
    raw = await mailbox(A, u, req),
    k = randomUUID();
  ok(
    await call("POST", req.path, { mailboxToken: raw }, u, {
      "idempotency-key": k,
    }),
    201,
  );
  ok(
    await call("POST", req.path, { mailboxToken: raw }, u, {
      "idempotency-key": k,
    }),
    200,
  );
  const second = await request(A, u, issued.linkToken),
    secondToken = await mailbox(A, u, second);
  ok(await call("POST", second.path, { mailboxToken: secondToken }, u), 200);
  assert.equal((await row(A.id, "admission_links"))[0].acceptance_count, 1);
  const metadata = ok(
    await call("GET", A.base + "/invitation-links", undefined, owner),
  );
  assert.equal(metadata.linkToken, undefined);
  assert.ok(
    !JSON.stringify(await row(A.id, "command_results")).includes(
      issued.linkToken,
    ),
  );
  denied(
    await call("POST", A.base + "/invitation-links", {}, u, {
      "if-match": '"1"',
    }),
    "ACTION_DENIED",
    403,
  );
  const quotaUser = await user();
  await scoped(A.id, (c) =>
    c.query(
      "UPDATE admission_links SET acceptance_count=100 WHERE organization_id=$1",
      [A.id],
    ),
  );
  denied(
    await call(
      "POST",
      A.base + "/admission/link-requests",
      { linkToken: issued.linkToken },
      quotaUser,
    ),
    "ADMISSION_INVALID",
    404,
  );
  ok(
    await call("POST", req.path, { mailboxToken: raw }, u, {
      "idempotency-key": k,
    }),
    200,
  );
  const rotated = await issue(A, owner);
  denied(
    await call("POST", req.path, { mailboxToken: raw }, u, {
      "idempotency-key": k,
    }),
    "ADMISSION_INVALID",
    404,
  );
  denied(
    await call(
      "POST",
      A.base + "/admission/link-requests",
      { linkToken: issued.linkToken },
      quotaUser,
    ),
    "ADMISSION_INVALID",
    404,
  );
  const pending = await request(A, quotaUser, rotated.linkToken),
    pendingToken = await mailbox(A, quotaUser, pending);
  ok(
    await call(
      "POST",
      A.base + "/invitation-links/" + rotated.link.id + "/revoke",
      {},
      owner,
      { "if-match": '"' + rotated.version + '"' },
    ),
  );
  denied(
    await call("POST", pending.path, { mailboxToken: pendingToken }, quotaUser),
    "ADMISSION_INVALID",
    404,
  );
  const last = await issue(A, owner);
  await scoped(A.id, (c) =>
    c.query(
      "UPDATE admission_links SET expires_at=clock_timestamp()-interval '1 second' WHERE organization_id=$1 AND id=$2",
      [A.id, last.link.id],
    ),
  );
  denied(
    await call(
      "POST",
      A.base + "/admission/link-requests",
      { linkToken: last.linkToken },
      await user(),
    ),
    "ADMISSION_INVALID",
    404,
  );
});
test("mail failure retries without membership; policy change cancels delivery; stale lease cannot finalize", async () => {
  const owner = await user(),
    u = await user(),
    A = await org(owner);
  setPolicy(A.id);
  const req = await request(A, u);
  assert.equal(
    await services.deliverAdmissionMail(A.id, async () => {
      throw new SmtpDeliveryError("NOT_SENT", "synthetic SMTP offline");
    }),
    0,
  );
  let m = (await row(A.id, "admission_mail"))[0];
  assert.equal(m.state, "FAILED");
  assert.ok(m.token);
  assert.equal(m.last_error, "SMTP_DELIVERY_FAILED");
  assert.equal((await row(A.id, "members")).length, 1);
  await scoped(A.id, (c) =>
    c.query(
      "UPDATE admission_mail SET next_attempt_at=clock_timestamp() WHERE organization_id=$1",
      [A.id],
    ),
  );
  const raw = await mailbox(A, u, req);
  assert.equal(
    digest(raw),
    (await row(A.id, "admission_requests"))[0].token_hash,
  );
  const nextUser = await user(),
    next = await request(A, nextUser);
  setPolicy(A.id, { registrationMode: "DISABLED" });
  assert.equal(await services.deliverAdmissionMail(A.id, sender), 0);
  m = (await row(A.id, "admission_mail", "AND request_id=$2", [next.id]))[0];
  assert.equal(m.state, "CANCELLED");
  assert.equal(m.token, null);
  setPolicy(A.id);
  const staleUser = await user(),
    stale = await request(A, staleUser);
  assert.equal(
    await services.deliverAdmissionMail(A.id, async (message) => {
      await scoped(A.id, (c) =>
        c.query(
          "UPDATE admission_mail SET lease_token=gen_random_uuid() WHERE organization_id=$1 AND id=$2",
          [A.id, message.id],
        ),
      );
    }),
    0,
  );
  m = (await row(A.id, "admission_mail", "AND request_id=$2", [stale.id]))[0];
  assert.equal(m.state, "PROCESSING");
  assert.ok(m.token);
});
test("IP ingress throttle and RLS isolation are real", async () => {
  const owner = await user(),
    A = await org(owner),
    B = await org(owner),
    u = await user();
  setPolicy(A.id);
  setPolicy(B.id);
  const req = await request(A, u),
    ip = "192.0.2.44";
  for (let n = 0; n < 30; n++)
    denied(
      await call("POST", req.path, { mailboxToken: "invalid" }, u, {}, ip),
    );
  denied(
    await call("POST", req.path, { mailboxToken: "invalid" }, u, {}, ip),
    "RATE_LIMITED",
    429,
  );
  assert.equal(
    (
      await scoped(B.id, (c) =>
        c.query("SELECT * FROM admission_requests WHERE organization_id=$1", [
          A.id,
        ]),
      )
    ).rowCount,
    0,
  );
  const before = (await row(A.id, "admission_link_state")).length;
  await assert.rejects(
    scoped(B.id, (c) =>
      c.query("INSERT INTO admission_link_state(organization_id) VALUES($1)", [
        A.id,
      ]),
    ),
  );
  assert.equal((await row(A.id, "admission_link_state")).length, before);
  configured = false;
  await assert.rejects(
    scoped(A.id, (c) => services.validatePublicAdmissionReady({ c } as any)),
    (error: any) => error.code === "POLICY_CONSUMER_UNAVAILABLE",
  );
  configured = true;
  await scoped(A.id, (c) =>
    services.validatePublicAdmissionReady({ c } as any),
  );
});

async function blockedOnOrganization() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const rows = (
      await pool.query(
        "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND usename=current_user AND wait_event_type='Lock' AND query LIKE 'SELECT * FROM organizations WHERE id=$1 FOR UPDATE%' AND cardinality(pg_blocking_pids(pid))>0",
      )
    ).rows;
    if (rows.length) return;
  }
  throw Error("ORGANIZATION_LOCK_BARRIER_NOT_REACHED");
}
test(
  "organization barrier serializes changed policy and session expiry before proof/replay",
  { timeout: 15000 },
  async () => {
    const owner = await user(),
      A = await org(owner),
      u = await user();
    setPolicy(A.id);
    const req = await request(A, u),
      raw = await mailbox(A, u, req);
    const blocker = await pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT set_config('orgmap.organization_id',$1,true)",
        [A.id],
      );
      await blocker.query(
        "SELECT * FROM organizations WHERE id=$1 FOR UPDATE",
        [A.id],
      );
      const completion = call("POST", req.path, { mailboxToken: raw }, u).then(
        (value) => value,
      );
      await blockedOnOrganization();
      setPolicy(A.id);
      await blocker.query("COMMIT");
      denied(await completion, "POLICY_CHANGED", 409);
      const next = await request(A, u),
        nextRaw = await mailbox(A, u, next);
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT set_config('orgmap.organization_id',$1,true)",
        [A.id],
      );
      await blocker.query(
        "SELECT * FROM organizations WHERE id=$1 FOR UPDATE",
        [A.id],
      );
      const expiring = call(
        "POST",
        next.path,
        { mailboxToken: nextRaw },
        u,
      ).then((value) => value);
      await blockedOnOrganization();
      await pool.query(
        "UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE account_id=$1",
        [u.id],
      );
      await blocker.query("COMMIT");
      denied(await expiring, "UNAUTHENTICATED", 401);
      assert.equal((await row(A.id, "members")).length, 1);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
  },
);
test("simultaneous valid proofs cannot overspend the final distinct link acceptance", async () => {
  const owner = await user(),
    A = await org(owner),
    one = await user(),
    two = await user();
  setPolicy(A.id, { invitationLinkEnabled: true });
  const issued = await issue(A, owner),
    r1 = await request(A, one, issued.linkToken),
    r2 = await request(A, two, issued.linkToken);
  const t1 = await mailbox(A, one, r1),
    t2 = await mailbox(A, two, r2);
  await scoped(A.id, (c) =>
    c.query(
      "UPDATE admission_links SET acceptance_count=99 WHERE organization_id=$1",
      [A.id],
    ),
  );
  const results = await Promise.all([
    call("POST", r1.path, { mailboxToken: t1 }, one),
    call("POST", r2.path, { mailboxToken: t2 }, two),
  ]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [201, 404]);
  assert.equal((await row(A.id, "admission_links"))[0].acceptance_count, 100);
  assert.equal((await row(A.id, "members")).length, 2);
});
test("composed buildApp uses real policy provider, configured SMTP, and same-UoW link OFF revocation", async () => {
  let integratedCore!: ReturnType<typeof createRuntime>;
  const integrated = await buildApp([
    async (_app, runtime) => {
      integratedCore = runtime;
      runtime.registerAdmissionPolicyProvider({ resolve });
      runtime.registerAdmissionMailTransport({
        host: "127.0.0.1",
        port: smtpPort,
      });
    },
  ]);
  const invoke = (
    method: any,
    url: string,
    payload: any,
    u: User,
    headers: any = {},
  ) =>
    integrated.inject({
      method,
      url,
      payload,
      headers: {
        origin: "http://localhost:5173",
        "idempotency-key": randomUUID(),
        cookie: u.cookie,
        "x-csrf-token": u.csrf,
        ...headers,
      },
    });
  try {
    const owner = await user(),
      A = await org(owner),
      u = await user();
    const p = setPolicy(A.id, { invitationLinkEnabled: true });
    const issued = ok(
      await invoke("POST", A.base + "/invitation-links", {}, owner, {
        "if-match": '"0"',
      }),
    );
    const pending = ok(
      await invoke(
        "POST",
        A.base + "/admission/link-requests",
        { linkToken: issued.linkToken },
        u,
      ),
      202,
    );
    assert.equal(await integratedCore.deliverAdmissionMail(A.id, sender), 1);
    const raw = await mailbox(A, u, { id: pending.requestId });
    const completePath =
        A.base + "/admission/requests/" + pending.requestId + "/complete",
      replayKey = randomUUID();
    ok(
      await invoke("POST", completePath, { mailboxToken: raw }, u, {
        "idempotency-key": replayKey,
      }),
      201,
    );
    await scoped(A.id, async (c) => {
      const organization = (
        await c.query("SELECT * FROM organizations WHERE id=$1 FOR UPDATE", [
          A.id,
        ])
      ).rows[0];
      const member = (
        await c.query(
          "SELECT * FROM members WHERE organization_id=$1 AND id=$2",
          [A.id, A.member],
        )
      ).rows[0];
      const next = {
        ...p,
        revision: p.revision + 1,
        invitationLinkEnabled: false,
      };
      await integratedCore.admissionPolicyConsumer.validateChange(
        {
          c,
          org: organization,
          member,
          account: { id: owner.id },
          mode: "authorization_write",
        },
        { previous: p, next },
      );
      policies.set(A.id, next);
    });
    assert.ok((await row(A.id, "admission_links"))[0].revoked_at);
    denied(
      await invoke("POST", completePath, { mailboxToken: raw }, u, {
        "idempotency-key": replayKey,
      }),
    );
    setPolicy(A.id, { invitationLinkEnabled: true });
    denied(
      await invoke(
        "POST",
        A.base + "/admission/link-requests",
        { linkToken: issued.linkToken },
        await user(),
      ),
      "ADMISSION_INVALID",
      404,
    );
    assert.equal(
      (await row(A.id, "members", "AND account_id=$2", [u.id])).length,
      1,
    );
  } finally {
    await integrated.close();
  }
});

test("pending proof cannot reactivate a new suspension, promote Guest, or retain a departed link owner", async () => {
  const owner = await user(),
    A = await org(owner);
  setPolicy(A.id, { invitationLinkEnabled: true });
  for (const kind of ["SUSPENDED", "GUEST"] as const) {
    const u = await user(),
      req = await request(A, u),
      raw = await mailbox(A, u, req);
    await scoped(A.id, (c) =>
      c.query(
        "INSERT INTO members(organization_id,id,account_id,org_role,status,member_type) VALUES($1,$2,$3,'MEMBER',$4,$5)",
        [
          A.id,
          randomUUID(),
          u.id,
          kind === "SUSPENDED" ? "SUSPENDED" : "ACTIVE",
          kind === "GUEST" ? "GUEST" : "MEMBER",
        ],
      ),
    );
    denied(
      await call("POST", req.path, { mailboxToken: raw }, u),
      kind === "GUEST" ? "TYPE_CHANGE_REQUIRED" : "MEMBERSHIP_SUSPENDED",
      kind === "GUEST" ? 409 : 403,
    );
    const member = (await row(A.id, "members", "AND account_id=$2", [u.id]))[0];
    assert.equal(member.member_type, kind === "GUEST" ? "GUEST" : "MEMBER");
    assert.equal(member.status, kind === "SUSPENDED" ? "SUSPENDED" : "ACTIVE");
  }
  const issued = await issue(A, owner),
    u = await user(),
    req = await request(A, u, issued.linkToken),
    raw = await mailbox(A, u, req);
  await scoped(A.id, (c) =>
    c.query(
      "UPDATE members SET org_role='MEMBER' WHERE organization_id=$1 AND id=$2",
      [A.id, A.member],
    ),
  );
  denied(
    await call("POST", req.path, { mailboxToken: raw }, u),
    "ADMISSION_INVALID",
    404,
  );
  assert.equal(
    (await row(A.id, "members", "AND account_id=$2", [u.id])).length,
    0,
  );
});

test("request idempotency is namespace-bound and replay checks current intent before cache", async () => {
  const owner = await user(),
    A = await org(owner),
    u = await user();
  setPolicy(A.id, { invitationLinkEnabled: true });
  const path = A.base + "/admission/requests",
    k = randomUUID(),
    headers = { "idempotency-key": k };
  const first = ok(await call("POST", path, {}, u, headers), 202),
    again = ok(await call("POST", path, {}, u, headers), 202);
  assert.deepEqual(again, first);
  assert.equal((await row(A.id, "admission_requests")).length, 1);
  assert.equal((await row(A.id, "admission_mail")).length, 1);
  const issued = await issue(A, owner),
    linkPath = A.base + "/admission/link-requests";
  const linked = ok(
    await call("POST", linkPath, { linkToken: issued.linkToken }, u, headers),
    202,
  );
  assert.notEqual(linked.requestId, first.requestId);
  const rotated = await issue(A, owner);
  denied(
    await call("POST", linkPath, { linkToken: rotated.linkToken }, u, headers),
    "IDEMPOTENCY_CONFLICT",
    409,
  );
  setPolicy(A.id, { invitationLinkEnabled: true });
  denied(await call("POST", path, {}, u, headers), "POLICY_CHANGED", 409);
});

test("actual IAM domain helpers and public guards reject encoded URL delimiters in OPEN and restricted modes", async () => {
  const invalidDomains = [
    "ex%61mple.org",
    "example.org%2eevil.test",
    "example.org%2f.evil.test",
    "example.org%40evil.test",
    "example.org#x",
    "example.org?x",
    "*.example.org",
    "https://example.org",
    "127.0.0.1",
    "example.org.",
  ];
  for (const domain of invalidDomains) {
    assert.throws(
      () => canonicalAdmissionDomain(domain),
      (error: any) =>
        error instanceof Failure && error.code === "INVALID_ADMISSION_DOMAIN",
      domain,
    );
    assert.throws(
      () => normalizeAdmissionEmail("member@" + domain),
      (error: any) =>
        error instanceof Failure && error.code === "INVALID_ADMISSION_DOMAIN",
      domain,
    );
  }
  assert.equal(canonicalAdmissionDomain("BÜCHER.test"), "xn--bcher-kva.test");
  assert.equal(
    normalizeAdmissionEmail(" Member+Tag@BÜCHER.test "),
    "member+tag@bücher.test",
    "domain eligibility must not rewrite the global Account key to punycode",
  );
  const open: AdmissionPolicy = {
    schemaVersion: 1,
    policyId: randomUUID(),
    revision: 1,
    registrationMode: "OPEN",
    allowedDomains: [],
    membersMayInvite: false,
    limitMemberInvitesToDomains: false,
    invitationLinkEnabled: true,
  };
  const restricted: AdmissionPolicy = {
    ...open,
    registrationMode: "DOMAIN_RESTRICTED",
    allowedDomains: ["example.org", "xn--bcher-kva.test"],
  };
  for (const p of [open, restricted]) {
    for (const source of ["PUBLIC_JOIN", "INVITATION_LINK"] as const) {
      assert.doesNotThrow(() =>
        core.assertPublicAdmission(p, "MEMBER@EXAMPLE.ORG", source),
      );
      assert.doesNotThrow(() =>
        core.assertPublicAdmission(p, "Member+Tag@BÜCHER.test", source),
      );
      for (const domain of invalidDomains)
        assert.throws(
          () => core.assertPublicAdmission(p, "member@" + domain, source),
          (error: any) =>
            error instanceof Failure &&
            error.status === 404 &&
            error.code === "RESOURCE_NOT_FOUND",
          p.registrationMode + "/" + source + "/" + domain,
        );
    }
  }
  for (const domain of [
    "evil-example.org",
    "example.org.evil",
    "sub.example.org",
  ])
    assert.throws(
      () =>
        core.assertPublicAdmission(
          restricted,
          "member@" + domain,
          "PUBLIC_JOIN",
        ),
      (error: any) =>
        error instanceof Failure && error.code === "RESOURCE_NOT_FOUND",
      domain,
    );

  const integrated = await buildApp([
    async (_app, runtime) => {
      runtime.registerAdmissionPolicyProvider({ resolve });
      runtime.registerAdmissionMailTransport({
        host: "127.0.0.1",
        port: smtpPort,
      });
    },
  ]);
  try {
    const owner = await user(),
      A = await org(owner);
    setPolicy(A.id);
    for (const domain of ["ex%61mple.org", "example.org#x"]) {
      const u = await user("member@" + domain);
      const response = await integrated.inject({
        method: "POST",
        url: A.base + "/admission/requests",
        payload: {},
        headers: {
          origin: "http://localhost:5173",
          cookie: u.cookie,
          "x-csrf-token": u.csrf,
          "idempotency-key": randomUUID(),
        },
      });
      denied(response, "RESOURCE_NOT_FOUND", 404);
    }
    assert.equal((await row(A.id, "admission_requests")).length, 0);
    assert.equal((await row(A.id, "admission_mail")).length, 0);
  } finally {
    await integrated.close();
  }
});
