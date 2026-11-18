import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  startSmtpSink,
  sendLocalMail,
  SmtpDeliveryError,
} from "../../server/src/smtp.js";
import { buildApp } from "../../server/src/app.js";
import { pool, transaction } from "../../server/src/db.js";
import {
  defaultAdmissionPolicy,
  type AdmissionPolicy,
} from "../../server/src/admission-contract.js";
import type { ModuleRuntime } from "../../server/src/runtime.js";
import {
  authorizeOrganizationEffect,
  recordOrganizationEffectOutcome,
} from "../../server/src/organization-effects.js";

const runtime = new URL(process.env.DATABASE_URL ?? "postgres://invalid/");
const operator = new URL(
  process.env.MIGRATION_DATABASE_URL ?? "postgres://invalid/",
);
if (
  !/^\/orgmap_admission_invites_[a-f0-9]{16}$/.test(runtime.pathname) ||
  runtime.pathname !== operator.pathname ||
  runtime.host !== operator.host ||
  ![runtime, operator].every(
    (u) =>
      u.protocol === "postgres:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname),
  )
)
  throw Error("EXCLUSIVE_ADMISSION_INVITATIONS_DATABASE_REQUIRED");
const admin = new pg.Pool({ connectionString: operator.href });
const policies = new Map<string, AdmissionPolicy>();
const workspaceSettings = new Map<string, { name: string; locale: string }>();
const noticeRecipients = new Map<string, string>();
// This suite only delivers to its own ephemeral loopback SMTP sink.
process.env.ORGMAP_PUBLIC_URL = "http://localhost:5173";
let core!: ModuleRuntime;
let guestPlanEnabled = true;
const app = await buildApp([
  async (_app, runtime) => {
    core = runtime;
    core.registerInvitationLifecycleNotifier(async (ctx, notice) => {
      await ctx.c.query(
        "INSERT INTO domain_events(organization_id,id,action,resource_id) VALUES($1,$2,$3,$4)",
        [ctx.org.id, notice.eventId, notice.event, notice.invitationId],
      );
      noticeRecipients.set(
        notice.invitationId + ":" + notice.event,
        notice.recipientMemberId,
      );
    });
    core.registerOrganizationSettings(async (ctx) => ({
      version: 0,
      settings: {
        name: ctx.org.name,
        locale: ctx.org.locale,
        timezone: ctx.org.time_zone,
        modules: { structure: true },
        ...workspaceSettings.get(ctx.org.id),
      },
    }));
    core.registerAdmissionPolicyProvider({
      resolve: async (read) =>
        policies.get(read.organizationId) ?? defaultAdmissionPolicy(),
    });
    core.registerGuestAccessAdapter({
      context: "invitation-proof",
      routes: [],
      validateSharePlan: async (ctx) =>
        guestPlanEnabled && ctx.member.org_role === "OWNER",
    });
  },
]);
after(async () => {
  await app.close();
  await pool.end();
  await admin.end();
});

test("administrative admission replay rechecks current suspension and type after explicit Owner changes", async () => {
  const owner = await user(),
    target = await user(),
    A = await organization(owner);
  const input = { accountId: target.id },
    command = randomUUID();
  const issued = data(
    await call("POST", A.base + "/members", input, owner, {
      "idempotency-key": command,
    }),
  ).membership;
  const path = A.base + "/members/" + issued.id;
  const suspended = data(
    await call("PATCH", path, { status: "SUSPENDED" }, owner, {
      "if-match": '"' + issued.version + '"',
    }),
  ).membership;
  const beforeSuspendedReplay = await counts(A.org);
  failure(
    await call("POST", A.base + "/members", input, owner, {
      "idempotency-key": command,
    }),
    403,
    "ACTION_DENIED",
  );
  assert.deepEqual(await counts(A.org), beforeSuspendedReplay);
  const current = () =>
    scoped(
      A.org,
      async (c) =>
        (
          await c.query(
            "SELECT status,member_type,version FROM members WHERE organization_id=$1 AND id=$2",
            [A.org, issued.id],
          )
        ).rows[0],
    );
  assert.deepEqual(await current(), {
    status: "SUSPENDED",
    member_type: "MEMBER",
    version: suspended.version,
  });

  const restored = data(
    await call("PATCH", path, { status: "ACTIVE" }, owner, {
      "if-match": '"' + suspended.version + '"',
    }),
  ).membership;
  const beforeActiveReplay = await counts(A.org);
  const replay = await call("POST", A.base + "/members", input, owner, {
    "idempotency-key": command,
  });
  assert.equal(data(replay).membership.id, issued.id);
  assert.equal(
    replay.statusCode,
    201,
    "cached resource creates preserve the existing 201 HTTP contract",
  );
  assert.deepEqual(await counts(A.org), beforeActiveReplay);
  assert.deepEqual(await current(), {
    status: "ACTIVE",
    member_type: "MEMBER",
    version: restored.version,
  });

  const changed = data(
    await call(
      "POST",
      path + "/actions/change-type",
      { memberType: "GUEST", confirmVisibilityChange: true },
      owner,
      { "if-match": '"' + restored.version + '"' },
    ),
  ).membership;
  const beforeTypeReplay = await counts(A.org);
  failure(
    await call("POST", A.base + "/members", input, owner, {
      "idempotency-key": command,
    }),
    409,
    "TYPE_CHANGE_REQUIRED",
  );
  assert.deepEqual(await counts(A.org), beforeTypeReplay);
  assert.deepEqual(await current(), {
    status: "ACTIVE",
    member_type: "GUEST",
    version: changed.version,
  });
});
type User = { id: string; email: string; cookie: string; csrf: string };
let requestAddress = 0;
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
    remoteAddress: "192.0.2." + ((++requestAddress % 250) + 1),
    headers: {
      origin: "http://localhost:5173",
      "idempotency-key": randomUUID(),
      ...(user ? { cookie: user.cookie, "x-csrf-token": user.csrf } : {}),
      ...headers,
    },
  });
}
function data(response: any) {
  assert.ok([200, 201].includes(response.statusCode), response.body);
  return response.json().data;
}
function failure(response: any, status: number, code?: string) {
  assert.equal(response.statusCode, status, response.body);
  if (code) assert.equal(response.json().error.code, code, response.body);
}
async function user(domain = "example.test"): Promise<User> {
  const email = randomUUID() + "@" + domain;
  const response = await call("POST", "/auth/register", {
    email,
    password: "Invitation!fixture-password-739",
    displayName: "Original global name",
  });
  const result = data(response);
  return {
    id: result.account.id,
    email,
    cookie: response.cookies[0].name + "=" + response.cookies[0].value,
    csrf: result.csrfToken,
  };
}
async function organization(owner: User) {
  const result = data(
    await call(
      "POST",
      "/organizations",
      { name: "Invitation isolation" },
      owner,
    ),
  );
  const org = result.organization.id,
    base = "/organizations/" + org;
  const ownerMember = data(
    await call("GET", base + "/members", undefined, owner),
  ).items.find((m: any) => m.accountId === owner.id).id;
  return { org, base, ownerMember, root: result.rootCircle.id };
}
async function scoped<T>(org: string, fn: (c: pg.PoolClient) => Promise<T>) {
  return transaction(async (c) => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [org]);
    return fn(c);
  });
}
const setPolicy = (org: string, patch: Partial<AdmissionPolicy>) =>
  policies.set(org, { ...defaultAdmissionPolicy(), ...patch });
const invitationToken = (org: string, jobId: string) =>
  scoped(
    org,
    async (c) =>
      (
        await c.query(
          "SELECT token FROM invitation_delivery WHERE organization_id=$1 AND id=$2",
          [org, jobId],
        )
      ).rows[0].token as string,
  );
async function lifecycleNotices(org: string, invitationId: string) {
  return scoped(org, async (c) =>
    (
      await c.query(
        "SELECT action FROM domain_events WHERE organization_id=$1 AND resource_id=$2 AND action IN ('InvitationAccepted','InvitationDeliveryFailed') ORDER BY action",
        [org, invitationId],
      )
    ).rows.map((row) => row.action),
  );
}
async function counts(org: string) {
  return scoped(
    org,
    async (c) =>
      (
        await c.query(
          "SELECT (SELECT count(*) FROM invitations WHERE organization_id=$1)::int AS invitations,(SELECT count(*) FROM invitation_delivery WHERE organization_id=$1)::int AS jobs,(SELECT count(*) FROM audit_events WHERE organization_id=$1)::int AS audit,(SELECT count(*) FROM command_results WHERE organization_id=$1)::int AS commands,(SELECT count(*) FROM members WHERE organization_id=$1)::int AS members",
          [org],
        )
      ).rows[0],
  );
}

test("resend rotates exactly once, cancels old jobs and cancellation invalidates both links", async () => {
  const owner = await user(),
    target = await user(),
    A = await organization(owner);
  const issued = data(
    await call("POST", A.base + "/invitations", { email: target.email }, owner),
  );
  const oldToken = await invitationToken(A.org, issued.deliveryJobId),
    path = A.base + "/invitations/" + issued.invitation.id + "/actions/";
  failure(await call("POST", path + "resend", {}, owner), 428);
  failure(
    await call("POST", path + "resend", { token: "forged" }, owner, {
      "if-match": '"1"',
    }),
    400,
  );
  const command = randomUUID(),
    headers = { "if-match": '"1"', "idempotency-key": command };
  const resent = data(await call("POST", path + "resend", {}, owner, headers));
  assert.equal(resent.invitation.version, 2);
  const newToken = await invitationToken(A.org, resent.deliveryJobId);
  assert.notEqual(newToken, oldToken);
  assert.ok(+new Date(resent.invitation.expiresAt) > Date.now() + 6 * 86400000);
  const beforeReplay = await counts(A.org);
  assert.deepEqual(
    data(await call("POST", path + "resend", {}, owner, headers)),
    resent,
  );
  assert.deepEqual(await counts(A.org), beforeReplay);
  failure(
    await call("POST", "/invitations/accept", { token: oldToken }, target),
    404,
  );
  const races = await Promise.all([
    call("POST", path + "cancel", {}, owner, { "if-match": '"2"' }),
    call("POST", path + "resend", {}, owner, { "if-match": '"2"' }),
  ]);
  assert.equal(
    races.filter((r) => r.statusCode === 200 || r.statusCode === 201).length,
    1,
  );
  assert.equal(races.filter((r) => r.statusCode === 409).length, 1);
  const latest = data(
    await call("GET", A.base + "/invitations?status=ALL", undefined, owner),
  ).items[0];
  if (latest.status === "PENDING")
    data(
      await call("POST", path + "cancel", {}, owner, {
        "if-match": '"' + latest.version + '"',
      }),
    );
  failure(
    await call("POST", "/invitations/accept", { token: newToken }, target),
    404,
  );
  const cancelled = data(
    await call("GET", A.base + "/invitations?status=ALL", undefined, owner),
  ).items[0];
  assert.equal(cancelled.status, "REVOKED");
  assert.ok(cancelled.revokedAt);
  assert.equal(cancelled.delivery.state, "CANCELLED");
  assert.equal(cancelled.canCancel, false);
  assert.deepEqual(
    data(await call("GET", A.base + "/invitations", undefined, owner)).items,
    [],
  );
  assert.deepEqual(await lifecycleNotices(A.org, issued.invitation.id), []);
});

test("history survives policy loss, stays private, paginates and honestly represents unknown timestamps", async () => {
  const owner = await user(),
    member = await user(),
    guest = await user(),
    A = await organization(owner);
  data(
    await call("POST", A.base + "/members", { accountId: member.id }, owner),
  );
  data(
    await call(
      "POST",
      A.base + "/members",
      { accountId: guest.id, memberType: "GUEST" },
      owner,
    ),
  );
  setPolicy(A.org, { membersMayInvite: true });
  const own = data(
    await call(
      "POST",
      A.base + "/invitations",
      { email: randomUUID() + "@example.test" },
      member,
    ),
  );
  data(
    await call(
      "POST",
      A.base + "/invitations",
      { email: randomUUID() + "@example.test" },
      owner,
    ),
  );
  await scoped(A.org, (c) =>
    c.query(
      "UPDATE invitations SET created_at=NULL,expires_at=clock_timestamp()-interval '1 day' WHERE organization_id=$1 AND id=$2",
      [A.org, own.invitation.id],
    ),
  );
  setPolicy(A.org, { membersMayInvite: false });
  const history = data(
    await call("GET", A.base + "/invitations?status=ALL", undefined, member),
  ).items;
  assert.equal(history.length, 1);
  assert.equal(history[0].createdAt, null);
  assert.equal(history[0].expired, true);
  assert.equal(history[0].canResend, false);
  assert.equal(history[0].canCancel, true);
  const path = A.base + "/invitations/" + own.invitation.id + "/actions/";
  failure(
    await call("POST", path + "resend", {}, member, { "if-match": '"1"' }),
    403,
  );
  data(await call("POST", path + "cancel", {}, member, { "if-match": '"1"' }));
  failure(
    await call("GET", A.base + "/invitations?status=ALL", undefined, guest),
    404,
  );
  const first = data(
    await call(
      "GET",
      A.base + "/invitations?status=ALL&limit=1",
      undefined,
      owner,
    ),
  );
  assert.equal(first.items.length, 1);
  assert.equal(first.hasMore, true);
  const second = data(
    await call(
      "GET",
      A.base + "/invitations?status=ALL&limit=1&cursor=" + first.nextCursor,
      undefined,
      owner,
    ),
  );
  assert.equal(second.items.length, 1);
  assert.equal(second.hasMore, false);
  assert.notEqual(first.items[0].id, second.items[0].id);
  failure(
    await call(
      "GET",
      A.base + "/invitations?status=ALL&limit=101",
      undefined,
      owner,
    ),
    400,
  );
});

test("Owner resend takes responsibility after the original inviter loses authority", async () => {
  const owner = await user(),
    member = await user(),
    target = await user(),
    A = await organization(owner);
  data(
    await call("POST", A.base + "/members", { accountId: member.id }, owner),
  );
  setPolicy(A.org, { membersMayInvite: true });
  const issued = data(
    await call(
      "POST",
      A.base + "/invitations",
      { email: target.email },
      member,
    ),
  );
  setPolicy(A.org, { membersMayInvite: false });
  const resent = data(
    await call(
      "POST",
      A.base + "/invitations/" + issued.invitation.id + "/actions/resend",
      {},
      owner,
      { "if-match": '"1"' },
    ),
  );
  const token = await invitationToken(A.org, resent.deliveryJobId);
  let sends = 0;
  assert.equal(
    await core.deliverInvitationMail(A.org, async () => {
      sends++;
    }),
    1,
  );
  assert.equal(sends, 1);
  const resourceFor = (user: User) =>
    scoped(A.org, async (c) => {
      const org = (
        await c.query("SELECT * FROM organizations WHERE id=$1", [A.org])
      ).rows[0];
      const actorMember = (
        await c.query(
          "SELECT * FROM members WHERE organization_id=$1 AND account_id=$2",
          [A.org, user.id],
        )
      ).rows[0];
      return core.invitationResource(
        { c, org, member: actorMember, account: { id: user.id }, mode: "read" },
        issued.invitation.id,
      );
    });
  assert.equal((await resourceFor(owner))?.email, target.email);
  assert.equal(await resourceFor(member), null);
  const oldAuthorView = data(
    await call(
      "GET",
      A.base + "/invitations?status=ALL&invitationId=" + issued.invitation.id,
      undefined,
      member,
    ),
  );
  assert.deepEqual(oldAuthorView.items, []);
  data(await call("POST", "/invitations/accept", { token }, target));
  assert.equal(
    noticeRecipients.get(issued.invitation.id + ":InvitationAccepted"),
    A.ownerMember,
  );
});

test("transport retry is bounded, failure notice is atomic once, unknown outcome never repeats", async () => {
  const owner = await user(),
    A = await organization(owner);
  const issued = data(
    await call(
      "POST",
      A.base + "/invitations",
      { email: randomUUID() + "@example.test" },
      owner,
    ),
  );
  for (let i = 0; i < 5; i++) {
    await scoped(A.org, (c) =>
      c.query(
        "UPDATE invitation_delivery SET next_attempt_at=clock_timestamp() WHERE organization_id=$1 AND id=$2",
        [A.org, issued.deliveryJobId],
      ),
    );
    assert.equal(
      await core.deliverInvitationMail(A.org, async () => {
        throw new SmtpDeliveryError("NOT_SENT", "private transport error");
      }),
      0,
    );
    assert.equal(
      (await lifecycleNotices(A.org, issued.invitation.id)).length,
      i === 4 ? 1 : 0,
    );
  }
  let attempts = 0;
  await core.deliverInvitationMail(A.org, async () => {
    attempts++;
  });
  assert.equal(attempts, 0);
  const failed = data(
    await call("GET", A.base + "/invitations?status=ALL", undefined, owner),
  ).items[0];
  assert.equal(failed.delivery.state, "FAILED");
  assert.equal(failed.delivery.attempts, 5);
  assert.equal(failed.delivery.nextAttemptAt, null);
  assert.ok(failed.delivery.completedAt);
  assert.ok(!JSON.stringify(failed).includes("private transport"));
  const unknown = data(
    await call(
      "POST",
      A.base + "/invitations",
      { email: randomUUID() + "@example.test" },
      owner,
    ),
  );
  await core.deliverInvitationMail(A.org, async () => {
    throw Error("unobserved receipt");
  });
  assert.deepEqual(await lifecycleNotices(A.org, unknown.invitation.id), [
    "InvitationDeliveryFailed",
  ]);
  await core.deliverInvitationMail(A.org, async () => {
    attempts++;
  });
  assert.equal(attempts, 0);
  await scoped(A.org, (c) =>
    core.reportInvitationDelivery(c, A.org, unknown.deliveryJobId),
  );
  assert.deepEqual(await lifecycleNotices(A.org, unknown.invitation.id), [
    "InvitationDeliveryFailed",
  ]);
});

test("acceptance during prepared delivery succeeds once and blocks resend/cancel after completion", async () => {
  const owner = await user(),
    target = await user(),
    A = await organization(owner);
  const issued = data(
    await call("POST", A.base + "/invitations", { email: target.email }, owner),
  );
  const token = await invitationToken(A.org, issued.deliveryJobId),
    path = A.base + "/invitations/" + issued.invitation.id + "/actions/";
  let release!: () => void, started!: () => void;
  const sending = new Promise<void>((yes) => {
      started = yes;
    }),
    barrier = new Promise<void>((yes) => {
      release = yes;
    });
  const delivery = core.deliverInvitationMail(A.org, async () => {
    started();
    await barrier;
  });
  await sending;
  try {
    failure(
      await call("POST", path + "resend", {}, owner, { "if-match": '"1"' }),
      409,
      "INVITATION_DELIVERY_IN_PROGRESS",
    );
    failure(
      await call("POST", path + "cancel", {}, owner, { "if-match": '"1"' }),
      409,
      "INVITATION_DELIVERY_IN_PROGRESS",
    );
    const headers = { "idempotency-key": randomUUID() };
    data(await call("POST", "/invitations/accept", { token }, target, headers));
    data(await call("POST", "/invitations/accept", { token }, target, headers));
    assert.deepEqual(await lifecycleNotices(A.org, issued.invitation.id), [
      "InvitationAccepted",
    ]);
  } finally {
    release();
    await delivery;
  }
  const accepted = data(
    await call("GET", A.base + "/invitations?status=ALL", undefined, owner),
  ).items[0];
  assert.equal(accepted.status, "ACCEPTED");
  assert.ok(accepted.acceptedAt);
  assert.equal(accepted.canResend, false);
  assert.equal(accepted.canCancel, false);
  failure(
    await call("POST", path + "cancel", {}, owner, {
      "if-match": '"' + accepted.version + '"',
    }),
    409,
  );
});

test("dead final lease emits a terminal notice without sending and notification SQL failure rolls state back", async () => {
  const owner = await user(),
    A = await organization(owner);
  const issued = data(
    await call(
      "POST",
      A.base + "/invitations",
      { email: randomUUID() + "@example.test" },
      owner,
    ),
  );
  await scoped(A.org, (c) =>
    c.query(
      "UPDATE invitation_delivery SET state='PROCESSING',attempts=5,lease_token=gen_random_uuid(),lease_until=clock_timestamp()-interval '1 minute' WHERE organization_id=$1 AND id=$2",
      [A.org, issued.deliveryJobId],
    ),
  );
  let attempts = 0;
  await core.deliverInvitationMail(A.org, async () => {
    attempts++;
  });
  assert.equal(attempts, 0);
  assert.deepEqual(await lifecycleNotices(A.org, issued.invitation.id), [
    "InvitationDeliveryFailed",
  ]);
  const rollback = data(
    await call(
      "POST",
      A.base + "/invitations",
      { email: randomUUID() + "@example.test" },
      owner,
    ),
  );
  await scoped(A.org, (c) =>
    c.query(
      "UPDATE invitation_delivery SET attempts=4 WHERE organization_id=$1 AND id=$2",
      [A.org, rollback.deliveryJobId],
    ),
  );
  await admin.query(
    "CREATE FUNCTION invitation_notice_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='InvitationDeliveryFailed' THEN RAISE EXCEPTION 'synthetic notifier failure'; END IF; RETURN NEW; END $$",
  );
  await admin.query(
    "CREATE TRIGGER invitation_notice_test_fail BEFORE INSERT ON domain_events FOR EACH ROW EXECUTE FUNCTION invitation_notice_test_fail()",
  );
  try {
    await assert.rejects(
      core.deliverInvitationMail(A.org, async () => {
        throw new SmtpDeliveryError("NOT_SENT", "synthetic offline");
      }),
    );
    const state = await scoped(
      A.org,
      async (c) =>
        (
          await c.query(
            "SELECT state,terminal_at FROM invitation_delivery WHERE organization_id=$1 AND id=$2",
            [A.org, rollback.deliveryJobId],
          )
        ).rows[0],
    );
    assert.equal(state.state, "PROCESSING");
    assert.equal(state.terminal_at, null);
    assert.deepEqual(await lifecycleNotices(A.org, rollback.invitation.id), []);
  } finally {
    await admin.query(
      "DROP TRIGGER invitation_notice_test_fail ON domain_events",
    );
    await admin.query("DROP FUNCTION invitation_notice_test_fail()");
  }
  await scoped(A.org, (c) =>
    c.query(
      "UPDATE invitation_delivery SET lease_until=clock_timestamp()-interval '1 minute' WHERE organization_id=$1 AND id=$2",
      [A.org, rollback.deliveryJobId],
    ),
  );
  await core.deliverInvitationMail(A.org, async () => {
    attempts++;
  });
  assert.equal(attempts, 0);
  assert.deepEqual(await lifecycleNotices(A.org, rollback.invitation.id), [
    "InvitationDeliveryFailed",
  ]);
});

test("lost transport receipt after authorization recovers as unknown without a second send", async () => {
  const owner = await user(),
    A = await organization(owner);
  const issued = data(
    await call(
      "POST",
      A.base + "/invitations",
      { email: randomUUID() + "@example.test" },
      owner,
    ),
  );
  const lease = randomUUID();
  await scoped(A.org, async (c) => {
    await c.query(
      "UPDATE invitation_delivery SET state='PROCESSING',attempts=4,lease_token=$3,lease_until=clock_timestamp()+interval '1 minute' WHERE organization_id=$1 AND id=$2",
      [A.org, issued.deliveryJobId, lease],
    );
    await authorizeOrganizationEffect(c, {
      organizationId: A.org,
      owner: "IAM",
      effectKey: "invitation:" + issued.deliveryJobId,
      sourceLeaseToken: lease,
      validateSourceLease: async (client, token) =>
        !!(
          await client.query(
            "SELECT 1 FROM invitation_delivery WHERE organization_id=$1 AND id=$2 AND lease_token=$3 AND state='PROCESSING' AND lease_until>clock_timestamp() FOR UPDATE",
            [A.org, issued.deliveryJobId, token],
          )
        ).rowCount,
    });
    await c.query(
      "UPDATE invitation_delivery SET lease_until=clock_timestamp()-interval '1 minute' WHERE organization_id=$1 AND id=$2",
      [A.org, issued.deliveryJobId],
    );
  });
  let attempts = 0;
  await core.deliverInvitationMail(A.org, async () => {
    attempts++;
  });
  assert.equal(attempts, 0);
  const row = data(
    await call(
      "GET",
      A.base + "/invitations?status=ALL&invitationId=" + issued.invitation.id,
      undefined,
      owner,
    ),
  ).items[0];
  assert.equal(row.delivery.state, "OUTCOME_UNKNOWN");
  assert.equal(row.delivery.attempts, 5);
  assert.equal(row.delivery.nextAttemptAt, null);
  assert.deepEqual(await lifecycleNotices(A.org, issued.invitation.id), [
    "InvitationDeliveryFailed",
  ]);
  const confirmed = data(
    await call(
      "POST",
      A.base + "/invitations",
      { email: randomUUID() + "@example.test" },
      owner,
    ),
  );
  const confirmedLease = randomUUID();
  await scoped(A.org, async (c) => {
    await c.query(
      "UPDATE invitation_delivery SET state='PROCESSING',attempts=5,lease_token=$3,lease_until=clock_timestamp()+interval '1 minute' WHERE organization_id=$1 AND id=$2",
      [A.org, confirmed.deliveryJobId, confirmedLease],
    );
    const effect = await authorizeOrganizationEffect(c, {
      organizationId: A.org,
      owner: "IAM",
      effectKey: "invitation:" + confirmed.deliveryJobId,
      sourceLeaseToken: confirmedLease,
      validateSourceLease: async (client, token) =>
        !!(
          await client.query(
            "SELECT 1 FROM invitation_delivery WHERE organization_id=$1 AND id=$2 AND lease_token=$3 AND state='PROCESSING' AND lease_until>clock_timestamp() FOR UPDATE",
            [A.org, confirmed.deliveryJobId, token],
          )
        ).rowCount,
    });
    await recordOrganizationEffectOutcome(c, effect, "CONFIRMED");
    await c.query(
      "UPDATE invitation_delivery SET lease_until=clock_timestamp()-interval '1 minute' WHERE organization_id=$1 AND id=$2",
      [A.org, confirmed.deliveryJobId],
    );
  });
  await core.deliverInvitationMail(A.org, async () => {
    attempts++;
  });
  assert.equal(attempts, 0);
  const known = data(
    await call(
      "GET",
      A.base +
        "/invitations?status=ALL&invitationId=" +
        confirmed.invitation.id,
      undefined,
      owner,
    ),
  ).items[0];
  assert.equal(known.delivery.state, "DELIVERED");
  assert.deepEqual(await lifecycleNotices(A.org, confirmed.invitation.id), []);
});

test("public invitation preview is narrow, localized through the workspace port and rechecks source authority", async () => {
  const owner = await user(),
    member = await user(),
    target = await user(),
    A = await organization(owner);
  data(
    await call("POST", A.base + "/members", { accountId: member.id }, owner),
  );
  setPolicy(A.org, { membersMayInvite: true });
  workspaceSettings.set(A.org, { name: "Espaço em espanhol", locale: "es-ES" });
  const issued = data(
    await call(
      "POST",
      A.base + "/invitations",
      {
        email: target.email,
        firstName: "private first name",
        personalMessage: "private personal message",
      },
      member,
    ),
  );
  const token = await invitationToken(A.org, issued.deliveryJobId),
    before = await counts(A.org);
  const previewResponse = await call("POST", "/invitations/preview", { token });
  assert.equal(previewResponse.headers["cache-control"], "no-store");
  assert.deepEqual(data(previewResponse), {
    organizationName: "Espaço em espanhol",
    locale: "es-ES",
    emailHint: target.email.slice(0, 1) + "***@example.test",
    memberType: "MEMBER",
    expiresAt: issued.invitation.expiresAt,
  });
  assert.deepEqual(
    await counts(A.org),
    before,
    "preview never joins or creates commands",
  );
  failure(
    await call("POST", "/invitations/preview", { token: "a".repeat(64) }),
    404,
    "RESOURCE_NOT_FOUND",
  );
  failure(
    await call("POST", "/invitations/preview", { token: "invalid" }),
    404,
    "RESOURCE_NOT_FOUND",
  );
  failure(
    await call("POST", "/invitations/accept", { token }),
    401,
    "UNAUTHENTICATED",
  );
  failure(
    await call("POST", "/invitations/accept", { token }, owner),
    404,
    "RESOURCE_NOT_FOUND",
  );
  const validated = await scoped(A.org, (c) =>
    core.validateInvitationDelivery(c, A.org, {
      invitation_id: issued.invitation.id,
      token,
    }),
  );
  assert.equal(validated?.organizationName, "Espaço em espanhol");
  assert.equal(
    validated?.locale,
    "es-ES",
    "settings override the organizations creation locale",
  );
  assert.equal(validated?.inviterName, "Original global name");
  assert.equal(validated?.expiresAt, issued.invitation.expiresAt);
  assert.equal(
    (await call("GET", A.base + "/bootstrap", undefined, member)).json()
      .capabilities["members.invite"],
    true,
  );
  setPolicy(A.org, { membersMayInvite: false });
  assert.equal(
    (await call("GET", A.base + "/bootstrap", undefined, member)).json()
      .capabilities["members.invite"],
    false,
  );
  assert.equal(
    (await call("GET", A.base + "/bootstrap", undefined, owner)).json()
      .capabilities["members.invite"],
    true,
  );
  failure(
    await call("POST", "/invitations/preview", { token }),
    404,
    "RESOURCE_NOT_FOUND",
  );
});

test("public invitation preview hides expired, revoked and closing organization links", async () => {
  const owner = await user(),
    target = await user(),
    A = await organization(owner);
  const issued = data(
    await call("POST", A.base + "/invitations", { email: target.email }, owner),
  );
  const token = await invitationToken(A.org, issued.deliveryJobId);
  await scoped(A.org, (c) =>
    c.query(
      "UPDATE invitations SET expires_at=clock_timestamp()-interval '1 second' WHERE organization_id=$1 AND id=$2",
      [A.org, issued.invitation.id],
    ),
  );
  failure(
    await call("POST", "/invitations/preview", { token }),
    404,
    "RESOURCE_NOT_FOUND",
  );
  await scoped(A.org, (c) =>
    c.query(
      "UPDATE invitations SET expires_at=clock_timestamp()+interval '1 day',status='REVOKED' WHERE organization_id=$1 AND id=$2",
      [A.org, issued.invitation.id],
    ),
  );
  failure(
    await call("POST", "/invitations/preview", { token }),
    404,
    "RESOURCE_NOT_FOUND",
  );
  await scoped(A.org, (c) =>
    c.query(
      "UPDATE invitations SET status='PENDING' WHERE organization_id=$1 AND id=$2",
      [A.org, issued.invitation.id],
    ),
  );
  await admin.query(
    "UPDATE organization_lifecycle SET state='DELETION_PENDING',fence=fence+1 WHERE organization_id=$1",
    [A.org],
  );
  failure(
    await call("POST", "/invitations/preview", { token }),
    404,
    "RESOURCE_NOT_FOUND",
  );
});

test("default disabled preserves owner nominal issuance, mailbox target and global Account separation", async () => {
  const owner = await user(),
    target = await user("external.test"),
    wrong = await user(),
    A = await organization(owner);
  const before = (
    await pool.query(
      "SELECT display_name,email,password_hash FROM accounts WHERE id=$1",
      [target.id],
    )
  ).rows[0];
  const issued = data(
    await call(
      "POST",
      A.base + "/invitations",
      {
        email: target.email.toUpperCase(),
        firstName: "<A & B>",
        lastName: "Nome literal",
        personalMessage: "Olá\n<script>literal</script>",
      },
      owner,
    ),
  );
  assert.equal(issued.invitation.email, target.email);
  assert.equal(issued.invitation.firstName, "<A & B>");
  assert.ok(!JSON.stringify(issued).includes("token"));
  assert.deepEqual(
    (
      await pool.query(
        "SELECT display_name,email,password_hash FROM accounts WHERE id=$1",
        [target.id],
      )
    ).rows[0],
    before,
  );
  const token = await invitationToken(A.org, issued.deliveryJobId);
  failure(await call("POST", "/invitations/accept", { token }, wrong), 404);
  failure(
    await call(
      "POST",
      "/invitations/accept",
      { token, accountId: wrong.id },
      target,
    ),
    400,
  );
  const replay = randomUUID();
  const accepted = data(
    await call("POST", "/invitations/accept", { token }, target, {
      "idempotency-key": replay,
    }),
  );
  assert.equal(accepted.membership.orgRole, "MEMBER");
  assert.equal(accepted.membership.memberType, "MEMBER");
  assert.equal(accepted.membership.accountId, target.id);
  const afterAccept = await counts(A.org);
  data(
    await call("POST", "/invitations/accept", { token }, target, {
      "idempotency-key": replay,
    }),
  );
  assert.deepEqual(await counts(A.org), afterAccept);
  const B = await organization(target);
  assert.equal(
    data(await call("GET", B.base + "/bootstrap", undefined, target)).membership
      .orgRole,
    "OWNER",
  );
  await scoped(A.org, (c) =>
    c.query("DELETE FROM members WHERE organization_id=$1 AND id=$2", [
      A.org,
      accepted.membership.id,
    ]),
  );
  failure(
    await call("POST", "/invitations/accept", { token }, target, {
      "idempotency-key": replay,
    }),
    409,
    "STATE_CONFLICT",
  );
  assert.equal((await counts(A.org)).members, 1);
});

test("member actor flag, exact domain restriction, Guest denial and current policy before every replay", async () => {
  const owner = await user(),
    member = await user(),
    guest = await user(),
    target = await user("allowed.test"),
    A = await organization(owner);
  data(
    await call("POST", A.base + "/members", { accountId: member.id }, owner),
  );
  data(
    await call(
      "POST",
      A.base + "/members",
      { accountId: guest.id, memberType: "GUEST" },
      owner,
    ),
  );
  failure(
    await call(
      "POST",
      A.base + "/invitations",
      { email: target.email },
      member,
    ),
    403,
  );
  failure(
    await call(
      "POST",
      A.base + "/invitations/batch",
      { items: [{ clientRef: "a", email: target.email }] },
      member,
    ),
    403,
  );
  assert.ok(
    (
      await call(
        "POST",
        A.base + "/invitations",
        { email: target.email },
        guest,
      )
    ).statusCode >= 400,
  );
  setPolicy(A.org, {
    membersMayInvite: true,
    limitMemberInvitesToDomains: true,
    allowedDomains: ["allowed.test"],
  });
  for (const domain of [
    "evil-allowed.test",
    "allowed.test.evil",
    "sub.allowed.test",
  ])
    failure(
      await call(
        "POST",
        A.base + "/invitations",
        { email: "person@" + domain },
        member,
      ),
      403,
    );
  failure(
    await call(
      "POST",
      A.base + "/invitations",
      { email: target.email, memberType: "GUEST" },
      member,
    ),
    403,
  );
  failure(
    await call(
      "POST",
      A.base + "/invitations",
      {
        email: target.email,
        accessPlan: [
          {
            resource: {
              context: "invitation-proof",
              kind: "circle",
              id: A.root,
            },
            actions: ["read"],
          },
        ],
      },
      member,
    ),
    403,
  );
  const requestKey = randomUUID(),
    input = { email: target.email };
  const issued = data(
    await call("POST", A.base + "/invitations", input, member, {
      "idempotency-key": requestKey,
    }),
  );
  const token = await invitationToken(A.org, issued.deliveryJobId);
  const otherTarget = await user("allowed.test");
  const memberIssued = data(
    await call(
      "POST",
      A.base + "/invitations",
      { email: otherTarget.email },
      member,
    ),
  );
  const memberAccepted = data(
    await call(
      "POST",
      "/invitations/accept",
      { token: await invitationToken(A.org, memberIssued.deliveryJobId) },
      otherTarget,
    ),
  );
  assert.equal(memberAccepted.membership.memberType, "MEMBER");
  const mixed = data(
    await call(
      "POST",
      A.base + "/invitations/batch",
      {
        items: [
          {
            clientRef: "denied-guest",
            email: randomUUID() + "@allowed.test",
            memberType: "GUEST",
          },
          {
            clientRef: "allowed-member",
            email: randomUUID() + "@allowed.test",
          },
        ],
      },
      member,
    ),
  );
  assert.deepEqual(
    mixed.results.map((r: any) => r.status),
    ["DENIED", "QUEUED"],
  );
  const before = await counts(A.org);
  setPolicy(A.org, { membersMayInvite: false });
  failure(
    await call("POST", A.base + "/invitations", input, member, {
      "idempotency-key": requestKey,
    }),
    403,
  );
  failure(await call("POST", "/invitations/accept", { token }, target), 403);
  assert.equal(
    await scoped(A.org, (c) =>
      core.validateInvitationDelivery(c, A.org, { id: issued.invitation.id }),
    ),
    null,
  );
  assert.deepEqual(await counts(A.org), before);
  setPolicy(A.org, {
    membersMayInvite: true,
    limitMemberInvitesToDomains: true,
    allowedDomains: ["other.test"],
  });
  failure(await call("POST", "/invitations/accept", { token }, target), 403);
  // Owner keeps explicit nominal authority for external addresses in every registration mode.
  setPolicy(A.org, {
    registrationMode: "DOMAIN_RESTRICTED",
    allowedDomains: ["allowed.test"],
    limitMemberInvitesToDomains: true,
  });
  data(
    await call(
      "POST",
      A.base + "/invitations",
      { email: randomUUID() + "@external.test" },
      owner,
    ),
  );
});

test("batch has seven ordered statuses, no global Account discovery and stable atomic idempotency", async () => {
  const owner = await user(),
    existing = await user(),
    suspended = await user(),
    accountOnly = await user(),
    A = await organization(owner);
  data(
    await call("POST", A.base + "/members", { accountId: existing.id }, owner),
  );
  const suspendedMembership = data(
    await call("POST", A.base + "/members", { accountId: suspended.id }, owner),
  ).membership;
  await scoped(A.org, (c) =>
    c.query(
      "UPDATE members SET status='SUSPENDED' WHERE organization_id=$1 AND id=$2",
      [A.org, suspendedMembership.id],
    ),
  );
  const pendingEmail = randomUUID() + "@example.test";
  const own = data(
    await call("POST", A.base + "/invitations", { email: pendingEmail }, owner),
  );
  const ambiguous = randomUUID() + "@example.test";
  await scoped(A.org, async (c) => {
    for (let i = 0; i < 2; i++)
      await c.query(
        "INSERT INTO invitations(organization_id,id,email,token_hash,expires_at,invited_by_member_id) VALUES($1,$2,$3,$4,clock_timestamp()+interval '1 day',$5)",
        [A.org, randomUUID(), ambiguous, randomUUID(), A.ownerMember],
      );
  });
  const input = {
    items: [
      { clientRef: "queued", email: accountOnly.email },
      { clientRef: "pending", email: pendingEmail },
      { clientRef: "member", email: existing.email },
      { clientRef: "duplicate", email: accountOnly.email.toUpperCase() },
      { clientRef: "invalid", email: "invalid" },
      { clientRef: "denied", email: suspended.email },
      { clientRef: "conflict", email: ambiguous },
    ],
  };
  const command = randomUUID(),
    result = data(
      await call("POST", A.base + "/invitations/batch", input, owner, {
        "idempotency-key": command,
      }),
    );
  assert.deepEqual(
    result.results.map((r: any) => r.clientRef),
    input.items.map((r) => r.clientRef),
  );
  assert.deepEqual(
    result.results.map((r: any) => r.status),
    [
      "QUEUED",
      "EXISTING_PENDING",
      "ALREADY_MEMBER",
      "DUPLICATE_IN_BATCH",
      "INVALID",
      "DENIED",
      "CONFLICT",
    ],
  );
  assert.equal(result.results[1].deliveryJobId, own.deliveryJobId);
  assert.equal(result.results[6].code, "INVITATION_RECONCILIATION_REQUIRED");
  for (const forbidden of [
    "token",
    "password",
    "accountId",
    "authMethod",
    accountOnly.id,
  ])
    assert.ok(!JSON.stringify(result).includes(forbidden));
  const before = await counts(A.org);
  assert.deepEqual(
    data(
      await call("POST", A.base + "/invitations/batch", input, owner, {
        "idempotency-key": command,
      }),
    ),
    result,
  );
  assert.deepEqual(await counts(A.org), before);
  failure(
    await call(
      "POST",
      A.base + "/invitations/batch",
      { items: input.items.slice(1) },
      owner,
      { "idempotency-key": command },
    ),
    409,
    "IDEMPOTENCY_CONFLICT",
  );
  failure(
    await call(
      "POST",
      A.base + "/invitations/batch",
      {
        items: Array.from({ length: 101 }, (_, i) => ({
          clientRef: String(i),
          email: "x@example.test",
        })),
      },
      owner,
    ),
    422,
  );
  failure(
    await call(
      "POST",
      A.base + "/invitations/batch",
      {
        items: [
          { clientRef: "a", email: "x@example.test", source: "ADMIN_ADD" },
        ],
      },
      owner,
    ),
    400,
  );
  failure(
    await call(
      "POST",
      A.base + "/invitations/batch",
      {
        items: [{ clientRef: "a", email: "x@example.test" }],
        personalMessage: "😀".repeat(2001),
      },
      owner,
    ),
    400,
  );
});

test("same pending intent does not rotate or resend; explicit change uses If-Match and cancels old job", async () => {
  const owner = await user(),
    target = await user(),
    A = await organization(owner);
  const input = {
    email: target.email,
    firstName: "😀".repeat(200),
    personalMessage: "literal\r\nBcc: remains body text",
  };
  const issued = data(
    await call("POST", A.base + "/invitations", input, owner),
  );
  const oldToken = await invitationToken(A.org, issued.deliveryJobId),
    before = await counts(A.org);
  assert.deepEqual(
    data(await call("POST", A.base + "/invitations", input, owner)),
    issued,
  );
  assert.deepEqual(await counts(A.org), {
    ...before,
    commands: before.commands + 1,
  });
  failure(
    await call(
      "POST",
      A.base + "/invitations",
      { ...input, personalMessage: "different" },
      owner,
    ),
    409,
    "INVITATION_CHANGE_REQUIRED",
  );
  const path =
    A.base + "/invitations/" + issued.invitation.id + "/actions/change-access";
  failure(
    await call("POST", path, { personalMessage: "replacement" }, owner),
    428,
  );
  failure(
    await call("POST", path, { personalMessage: "replacement" }, owner, {
      "if-match": '"999"',
    }),
    409,
  );
  const changed = data(
    await call("POST", path, { personalMessage: "replacement" }, owner, {
      "if-match": '"1"',
    }),
  );
  assert.equal(changed.invitation.version, 2);
  assert.equal(changed.invitation.personalMessage, "replacement");
  const oldJob = await scoped(
    A.org,
    async (c) =>
      (
        await c.query(
          "SELECT state,token FROM invitation_delivery WHERE id=$1",
          [issued.deliveryJobId],
        )
      ).rows[0],
  );
  assert.deepEqual(oldJob, { state: "CANCELLED", token: null });
  failure(
    await call("POST", "/invitations/accept", { token: oldToken }, target),
    404,
  );
  data(
    await call(
      "POST",
      "/invitations/accept",
      { token: await invitationToken(A.org, changed.deliveryJobId) },
      target,
    ),
  );
  const ownAccount = (
    await pool.query("SELECT display_name FROM accounts WHERE id=$1", [
      target.id,
    ])
  ).rows[0];
  assert.equal(ownAccount.display_name, "Original global name");
});

test("Member sees only own pending projection and third-party pending status stays opaque", async () => {
  const owner = await user(),
    member = await user(),
    target = await user(),
    A = await organization(owner);
  data(
    await call("POST", A.base + "/members", { accountId: member.id }, owner),
  );
  setPolicy(A.org, { membersMayInvite: true });
  const issued = data(
    await call(
      "POST",
      A.base + "/invitations",
      { email: target.email, firstName: "private invitation metadata" },
      owner,
    ),
  );
  const result = data(
    await call(
      "POST",
      A.base + "/invitations/batch",
      { items: [{ clientRef: "third", email: target.email }] },
      member,
    ),
  );
  assert.deepEqual(result.results, [
    { clientRef: "third", status: "EXISTING_PENDING" },
  ]);
  const own = data(
    await call(
      "POST",
      A.base + "/invitations",
      { email: randomUUID() + "@example.test" },
      member,
    ),
  );
  assert.deepEqual(
    data(
      await call("GET", A.base + "/invitations", undefined, member),
    ).items.map((i: any) => i.id),
    [own.invitation.id],
  );
  const ownerList = data(
    await call("GET", A.base + "/invitations", undefined, owner),
  );
  assert.equal(ownerList.items.length, 2);
  assert.ok(!JSON.stringify(ownerList).includes("token"));
  failure(
    await call(
      "POST",
      A.base +
        "/invitations/" +
        issued.invitation.id +
        "/actions/change-access",
      {},
      member,
      { "if-match": '"1"' },
    ),
    404,
  );
});

test("suspension and type conflicts never reactivate or promote; Guest plans and source authority are current", async () => {
  const owner = await user(),
    guest = await user(),
    suspended = await user(),
    target = await user(),
    A = await organization(owner);
  const share = [
    {
      resource: { context: "invitation-proof", kind: "circle", id: A.root },
      actions: ["read"],
    },
  ];
  data(
    await call(
      "POST",
      A.base + "/members",
      { accountId: guest.id, memberType: "GUEST" },
      owner,
    ),
  );
  const member = data(
    await call("POST", A.base + "/members", { accountId: suspended.id }, owner),
  ).membership;
  await scoped(A.org, (c) =>
    c.query(
      "UPDATE members SET status='SUSPENDED' WHERE organization_id=$1 AND id=$2",
      [A.org, member.id],
    ),
  );
  for (const [person, expected, code] of [
    [guest, 409, "TYPE_CHANGE_REQUIRED"],
    [suspended, 403, "ACTION_DENIED"],
  ] as const) {
    const issued = data(
      await call(
        "POST",
        A.base + "/invitations",
        { email: person.email },
        owner,
      ),
    );
    failure(
      await call(
        "POST",
        "/invitations/accept",
        { token: await invitationToken(A.org, issued.deliveryJobId) },
        person,
      ),
      expected,
      code,
    );
  }
  const issued = data(
    await call(
      "POST",
      A.base + "/invitations",
      { email: target.email, memberType: "GUEST", accessPlan: share },
      owner,
    ),
  );
  const token = await invitationToken(A.org, issued.deliveryJobId);
  guestPlanEnabled = false;
  try {
    failure(await call("POST", "/invitations/accept", { token }, target), 403);
  } finally {
    guestPlanEnabled = true;
  }
  const replay = randomUUID();
  data(
    await call("POST", "/invitations/accept", { token }, target, {
      "idempotency-key": replay,
    }),
  );
  const before = await counts(A.org);
  data(
    await call("POST", "/invitations/accept", { token }, target, {
      "idempotency-key": replay,
    }),
  );
  assert.deepEqual(await counts(A.org), before);
  await scoped(A.org, (c) =>
    c.query(
      "UPDATE members SET org_role='MEMBER' WHERE organization_id=$1 AND id=$2",
      [A.org, A.ownerMember],
    ),
  );
  failure(
    await call("POST", "/invitations/accept", { token }, target, {
      "idempotency-key": replay,
    }),
    403,
  );
});

test("unexpected final queue SQL failure rolls back the whole batch and command result", async () => {
  const owner = await user(),
    A = await organization(owner),
    failureEmail = randomUUID() + "@failure.test";
  await admin.query(
    "CREATE FUNCTION invitation_test_fail_queue() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM invitations WHERE organization_id=NEW.organization_id AND id=NEW.invitation_id AND email LIKE '%@failure.test') THEN RAISE EXCEPTION 'synthetic queue insert failure'; END IF; RETURN NEW; END $$",
  );
  await admin.query(
    "CREATE TRIGGER invitation_test_fail_queue BEFORE INSERT ON invitation_delivery FOR EACH ROW EXECUTE FUNCTION invitation_test_fail_queue()",
  );
  const before = await counts(A.org);
  try {
    failure(
      await call(
        "POST",
        A.base + "/invitations/batch",
        {
          items: [
            { clientRef: "first-valid", email: randomUUID() + "@example.test" },
            { clientRef: "last-fails", email: failureEmail },
          ],
        },
        owner,
      ),
      500,
    );
    assert.deepEqual(await counts(A.org), before);
  } finally {
    await admin.query(
      "DROP TRIGGER invitation_test_fail_queue ON invitation_delivery",
    );
    await admin.query("DROP FUNCTION invitation_test_fail_queue()");
  }
});

test("real synthetic SMTP preserves literal names/message, delivery policy and offline retry without early membership", async () => {
  const owner = await user(),
    member = await user(),
    target = await user(),
    A = await organization(owner);
  data(
    await call("POST", A.base + "/members", { accountId: member.id }, owner),
  );
  setPolicy(A.org, { membersMayInvite: true });
  const message = "<script>literal</script>\r\nBcc: still only body text";
  const issued = data(
    await call(
      "POST",
      A.base + "/invitations",
      {
        email: target.email,
        firstName: "<Ana & Bia>",
        personalMessage: message,
      },
      member,
    ),
  );
  const directory = await mkdtemp(join(tmpdir(), "orgmap-invitation-smtp-"));
  const sink = await startSmtpSink({ port: 0, directory });
  const port = (sink.address() as import("node:net").AddressInfo).port;
  try {
    assert.equal(
      await core.deliverInvitationMail(A.org, async (mail) => {
        // SMTP runs after the claim/validation UoW committed; it does not hold the org lock.
        const probe = await admin.connect();
        try {
          await probe.query("BEGIN");
          await probe.query(
            "SELECT id FROM organizations WHERE id=$1 FOR UPDATE NOWAIT",
            [A.org],
          );
          await probe.query("ROLLBACK");
        } finally {
          probe.release();
        }
        await sendLocalMail(mail, port);
      }),
      1,
    );
    const files = await readdir(directory);
    assert.equal(files.length, 1);
    const eml = await readFile(join(directory, files[0]), "utf8");
    const [headers] = eml.split("\r\n\r\n"),
      textPart =
        /Content-Type: text\/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/.exec(
          eml,
        );
    assert.ok(textPart, "SMTP message has an alternative plain text part");
    const mailBody = Buffer.from(
      textPart[1].replace(/\s/g, ""),
      "base64",
    ).toString("utf8");
    assert.ok(headers.includes("To: <" + target.email + ">"));
    assert.ok(!headers.includes("Bcc:"));
    assert.ok(mailBody.includes("<Ana & Bia>"));
    assert.ok(mailBody.includes(message));
    assert.equal((await counts(A.org)).members, 2);
    const token = /#token=([a-f0-9]{64})/.exec(mailBody)?.[1];
    assert.ok(token, "plain text has the same actionable invitation link");
    data(await call("POST", "/invitations/accept", { token }, target));
    const job = await scoped(
      A.org,
      async (c) =>
        (
          await c.query(
            "SELECT state,token FROM invitation_delivery WHERE id=$1",
            [issued.deliveryJobId],
          )
        ).rows[0],
    );
    assert.deepEqual(job, { state: "DELIVERED", token: null });
    assert.equal(
      await core.deliverInvitationMail(A.org, async () => {
        throw Error("must not resend");
      }),
      0,
    );
    const offline = data(
      await call(
        "POST",
        A.base + "/invitations",
        { email: randomUUID() + "@example.test" },
        member,
      ),
    );
    const beforeMembers = (await counts(A.org)).members;
    assert.equal(
      await core.deliverInvitationMail(A.org, async () => {
        throw new SmtpDeliveryError("NOT_SENT", "synthetic offline SMTP");
      }),
      0,
    );
    const failed = await scoped(
      A.org,
      async (c) =>
        (
          await c.query(
            "SELECT state,token IS NOT NULL AS retained FROM invitation_delivery WHERE id=$1",
            [offline.deliveryJobId],
          )
        ).rows[0],
    );
    assert.deepEqual(failed, { state: "FAILED", retained: true });
    assert.equal((await counts(A.org)).members, beforeMembers);
    await scoped(A.org, (c) =>
      c.query(
        "UPDATE invitation_delivery SET next_attempt_at=clock_timestamp() WHERE id=$1",
        [offline.deliveryJobId],
      ),
    );
    setPolicy(A.org, { membersMayInvite: false });
    let attempted = 0;
    assert.equal(
      await core.deliverInvitationMail(A.org, async () => {
        attempted++;
      }),
      0,
    );
    assert.equal(attempted, 0);
    const cancelled = await scoped(
      A.org,
      async (c) =>
        (
          await c.query(
            "SELECT state,token FROM invitation_delivery WHERE id=$1",
            [offline.deliveryJobId],
          )
        ).rows[0],
    );
    assert.deepEqual(cancelled, { state: "CANCELLED", token: null });
  } finally {
    await new Promise<void>((yes, no) =>
      sink.close((error) => (error ? no(error) : yes())),
    );
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  "acceptance waits on organization before Account and rejects a session revoked across the barrier",
  { timeout: 10000 },
  async () => {
    const owner = await user(),
      target = await user(),
      A = await organization(owner);
    const issued = data(
      await call(
        "POST",
        A.base + "/invitations",
        { email: target.email },
        owner,
      ),
    );
    const token = await invitationToken(A.org, issued.deliveryJobId),
      blocker = await admin.connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
      A.org,
    ]);
    const pending = call("POST", "/invitations/accept", { token }, target);
    try {
      let observed = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const waiting = await admin.query(
          "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND usename='orgmap_app' AND wait_event_type='Lock' AND query LIKE 'SELECT * FROM organizations WHERE id=%' LIMIT 1",
        );
        if (waiting.rowCount) {
          observed = true;
          break;
        }
      }
      assert.ok(
        observed,
        "acceptance reached deterministic organization-lock barrier",
      );
      // If acceptance still held Account first, this update would deadlock.
      await blocker.query("SET LOCAL lock_timeout='2s'");
      await blocker.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [
        target.id,
      ]);
      await blocker.query("DELETE FROM sessions WHERE account_id=$1", [
        target.id,
      ]);
      await blocker.query("COMMIT");
      failure(await pending, 401, "UNAUTHENTICATED");
      assert.equal((await counts(A.org)).members, 1);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
  },
);
