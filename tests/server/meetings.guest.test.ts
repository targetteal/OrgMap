import { foundationDefaultAdmissionPolicy } from "../../server/src/admission.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { createRichYDoc } from "../../packages/content/collaboration.js";
import { fromPlainText } from "../../packages/content/index.js";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../server/src/app.js";
import { pool } from "../../server/src/db.js";
import { createRuntime, type ModuleRuntime } from "../../server/src/runtime.js";
import { withWorkerContext } from "../../server/src/identity.js";
import { createMeetings } from "../../server/modules/meetings/plugin.js";
import {
  createMeetingRuntimePorts,
  createMeetingGuestReadContext,
} from "../../server/modules/meetings/guest.js";
import {
  detail,
  type MeetingPorts,
} from "../../server/modules/meetings/service.js";
import { createMeetingResourceAdapters } from "../../server/modules/meetings/platform.js";
if (
  !/^\/orgmap_meetings_test_[a-f0-9]+$/.test(
    new URL(process.env.DATABASE_URL!).pathname,
  )
)
  throw Error("Disposable DB required");
let enabled = true,
  coreHTTP: ModuleRuntime;
const input: MeetingPorts = {
  validateMembers: async (ctx, ids) =>
    (
      await ctx.c.query(
        "SELECT id FROM members WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND status='ACTIVE'",
        [ctx.org.id, ids],
      )
    ).rowCount === new Set(ids).size,
};
function bind(core: ModuleRuntime) {
  core.registerModuleScope({
    module: "meetings",
    routePrefixes: [],
    resourceTypes: ["meeting", "report"],
  });
  core.registerOrganizationSettings(async (ctx) => ({
    version: 1,
    settings: {
      name: ctx.org.name,
      locale: ctx.org.locale,
      timezone: ctx.org.time_zone,
      modules: { structure: true, meetings: enabled },
    },
  }));
  return createMeetingRuntimePorts(core, input);
}
const app = await buildApp([
  foundationDefaultAdmissionPolicy,
  async (app, core) => {
    coreHTTP = core;
    await createMeetings(bind(core))(app, core);
  },
]);
after(async () => {
  await app.close();
  await pool.end();
});
type User = { id: string; cookie: string; csrf: string };
async function call(
  method: string,
  path: string,
  payload?: any,
  u?: User,
  version?: number,
  key = randomUUID(),
) {
  return app.inject({
    method: method as any,
    url: "/api/v1" + path,
    payload,
    headers: {
      origin: "http://localhost:5173",
      "idempotency-key": key,
      ...(u ? { cookie: u.cookie, "x-csrf-token": u.csrf } : {}),
      ...(version !== undefined ? { "if-match": `"${version}"` } : {}),
    },
  });
}
function ok(r: any, status = 200) {
  assert.equal(r.statusCode, status, r.body);
  return r.json().data;
}
async function user(): Promise<User> {
  const r = await call("POST", "/auth/register", {
    email: randomUUID() + "@example.test",
    displayName: "Sentinel private person",
    password: "meetings-guest-test-123",
  });
  const d = ok(r, 201);
  return {
    id: d.account.id,
    cookie: r.cookies[0].name + "=" + r.cookies[0].value,
    csrf: d.csrfToken,
  };
}
const ref = (kind: string, id: string) => ({ context: "meetings", kind, id });
test("Guest meeting/report exact grants: projections, no inheritance/write, denies/revoke/moduleOFF and worker parity", async () => {
  const owner = await user(),
    guest = await user(),
    reportGuest = await user(),
    foreign = await user();
  const A = ok(
      await call("POST", "/organizations", { name: "Meetings Guest" }, owner),
      201,
    ),
    B = ok(
      await call("POST", "/organizations", { name: "Foreign" }, foreign),
      201,
    ),
    base = "/organizations/" + A.organization.id;
  async function meeting(title: string) {
    const d = ok(
      await call(
        "POST",
        base + "/meeting-series",
        {
          title,
          circleId: A.rootCircle.id,
          localStart: "2030-01-01T10:00",
          timeZone: "America/Sao_Paulo",
          durationMinutes: 60,
          recurrence: { frequency: "ONCE" },
          sections: [{ id: "agenda", title: "Agenda", kind: "AGENDA" }],
          participants: [],
          policy: { notesOnlyNoter: false, windowDays: 7 },
          notesProtocol: "orgmap-richtext-yjs-v1",
        },
        owner,
      ),
      201,
    );
    return d.occurrenceIds[0];
  }
  const mid = await meeting("Explicit meeting"),
    hidden = await meeting("AAA hidden meeting sentinel"),
    published = await meeting("Explicit published report");
  let d = ok(
    await call("GET", base + "/meetings/" + published, undefined, owner),
  );
  d = ok(
    await call(
      "POST",
      base + "/meetings/" + published + "/actions/start",
      {},
      owner,
      d.meeting.version,
    ),
  );
  d = ok(
    await call(
      "POST",
      base + "/meetings/" + published + "/actions/close",
      {},
      owner,
      d.meeting.version,
    ),
  );
  d = ok(
    await call(
      "POST",
      base + "/meetings/" + published + "/report/actions/publish",
      {},
      owner,
      d.report.version,
    ),
  );
  const rid = d.report.id;
  assert.equal(
    (
      await call(
        "POST",
        base + "/members",
        {
          accountId: guest.id,
          memberType: "GUEST",
          accessPlan: [
            { resource: ref("meeting", mid), actions: ["read", "edit"] },
          ],
        },
        owner,
      )
    ).statusCode,
    403,
  );
  const member = ok(
    await call(
      "POST",
      base + "/members",
      {
        accountId: guest.id,
        memberType: "GUEST",
        accessPlan: [{ resource: ref("meeting", mid), actions: ["read"] }],
      },
      owner,
    ),
    201,
  ).membership;
  const reportMember = ok(
    await call(
      "POST",
      base + "/members",
      {
        accountId: reportGuest.id,
        memberType: "GUEST",
        accessPlan: [{ resource: ref("report", rid), actions: ["read"] }],
      },
      owner,
    ),
    201,
  ).membership;
  const read = ok(
    await call("GET", base + "/meetings/" + mid, undefined, guest),
  );
  assert.equal(read.accessMode, "GUEST_READ");
  assert.deepEqual(read.participants, []);
  assert.equal(read.report, null);
  assert.ok(Object.values(read.capabilities).every((v) => v === false));
  for (const sentinel of [
    hidden,
    A.rootCircle.id,
    A.membership.id,
    owner.id,
    "Sentinel private person",
  ]) {
    assert.ok(!JSON.stringify(read).includes(sentinel), sentinel);
  }
  const listing = ok(
    await call("GET", base + "/meetings?limit=1", undefined, guest),
  );
  assert.deepEqual(
    listing.items.map((m: any) => m.id),
    [mid],
  );
  assert.equal(listing.page.hasMore, false);
  assert.equal(listing.page.nextCursor, null);
  for (const path of [
    "/meetings/" + hidden,
    "/meetings/" + published,
    "/meeting-reports/" + rid,
    "/meeting-templates",
    "/meeting-agenda",
    "/meetings/" + mid + "/linked-items",
    "/meetings/" + mid + "/report/versions",
  ]) {
    assert.equal(
      (await call("GET", base + path, undefined, guest)).statusCode,
      404,
      path,
    );
  }
  assert.equal(
    (
      await call(
        "GET",
        "/organizations/" + B.organization.id + "/meetings/" + mid,
        undefined,
        guest,
      )
    ).statusCode,
    404,
  );
  for (const action of [
    "start",
    "close",
    "notetaker",
    "participants",
    "attendance",
  ]) {
    assert.equal(
      (
        await call(
          "POST",
          base + "/meetings/" + mid + "/actions/" + action,
          {},
          guest,
          read.meeting.version,
        )
      ).statusCode,
      404,
    );
  }
  assert.equal(
    (
      await call(
        "POST",
        base + "/meetings/" + mid + "/collaboration/tickets",
        { sectionId: "agenda", epoch: 1 },
        guest,
      )
    ).statusCode,
    404,
  );
  const report = ok(
    await call("GET", base + "/meeting-reports/" + rid, undefined, reportGuest),
  );
  assert.equal(report.report.id, rid);
  assert.ok(!JSON.stringify(report).includes(published));
  assert.deepEqual(report.snapshot.participants, []);
  assert.equal(report.snapshot.meeting.title, "Explicit published report");
  assert.equal(
    (await call("GET", base + "/meetings/" + published, undefined, reportGuest))
      .statusCode,
    404,
  );
  assert.deepEqual(
    ok(await call("GET", base + "/meetings", undefined, reportGuest)).items,
    [],
  );
  assert.equal(
    ok(await call("GET", base + "/meeting-reports", undefined, reportGuest))
      .items.length,
    1,
  );
  // Access-only versions snapshot current drafts; Guests must stay on the
  // last explicitly published version, not the newest report version.
  const draftDoc = createRichYDoc(
    fromPlainText("UNPUBLISHED_PRIVATE_SENTINEL"),
  );
  ok(
    await call(
      "POST",
      base + "/meetings/" + published + "/collaboration/updates",
      {
        sectionId: "agenda",
        epoch: 1,
        protocol: "orgmap-richtext-yjs-v1",
        schemaVersion: 1,
        updateId: randomUUID(),
        update: Buffer.from(Y.encodeStateAsUpdate(draftDoc)).toString("base64"),
      },
      owner,
    ),
  );
  draftDoc.destroy();
  const beforeAccess = ok(
    await call("GET", base + "/meetings/" + published, undefined, owner),
  );
  ok(
    await call(
      "POST",
      base + "/meetings/" + published + "/report/actions/access",
      { memberId: reportMember.id, canRead: true, canEdit: false },
      owner,
      beforeAccess.report.version,
    ),
  );
  const publishedRead = ok(
    await call("GET", base + "/meeting-reports/" + rid, undefined, reportGuest),
  );
  assert.equal(publishedRead.report.version, report.report.version);
  assert.ok(
    !JSON.stringify(publishedRead).includes("UNPUBLISHED_PRIVATE_SENTINEL"),
  );
  const worker = createRuntime(),
    workerPorts = bind(worker),
    adapters = createMeetingResourceAdapters(workerPorts.readPolicy),
    guestReadContext = createMeetingGuestReadContext(worker, workerPorts);
  let callbacks = 0;
  const workerRead = () =>
    guestReadContext(
      A.organization.id,
      member.id,
      [{ context: "meetings", kind: "meeting", id: mid }],
      async (ctx) => {
        callbacks++;
        assert.equal(await adapters.meeting.authorize(ctx, mid, "read"), true);
        assert.equal(
          await adapters.meeting.authorize(ctx, mid, "export"),
          false,
        );
        assert.equal(
          await adapters.meeting.authorize(ctx, hidden, "read"),
          false,
        );
        assert.deepEqual(
          (await adapters.meeting.search!(ctx, "", 1)).map((x) => x.id),
          [mid],
        );
        return detail(ctx, mid, workerPorts.readPolicy);
      },
    );
  assert.equal((await workerRead()).accessMode, "GUEST_READ");
  await worker.withResourceWorkerContext(
    A.organization.id,
    reportMember.id,
    [{ resource: ref("report", rid), action: "read" }],
    async (ctx) => {
      assert.equal(await adapters.report.authorize(ctx, rid, "read"), true);
      assert.equal(await adapters.report.authorize(ctx, rid, "export"), false);
      assert.equal(
        await adapters.meeting.authorize(ctx, published, "read"),
        false,
      );
      assert.deepEqual(
        (await adapters.report.search!(ctx, "", 1)).map((x) => x.id),
        [rid],
      );
    },
  );
  let reportCallbacks = 0;
  const workerReportRead = () =>
    guestReadContext(
      A.organization.id,
      reportMember.id,
      [{ context: "meetings", kind: "report", id: rid }],
      async () => {
        reportCallbacks++;
        return true;
      },
    );
  await workerReportRead();
  await assert.rejects(() =>
    withWorkerContext(A.organization.id, member.id, async () => true),
  );
  await assert.rejects(() =>
    worker.withResourceWorkerContext(
      A.organization.id,
      member.id,
      [{ resource: ref("meeting", hidden), action: "read" }],
      async () => {
        callbacks++;
      },
    ),
  );
  enabled = false;
  const before = callbacks;
  assert.equal(
    (await call("GET", base + "/meetings/" + mid, undefined, guest)).statusCode,
    404,
  );
  await assert.rejects(workerRead);
  assert.equal(callbacks, before);
  enabled = true;
  // Current participant DENY defeats an otherwise valid explicit grant.
  let current = ok(
    await call("GET", base + "/meetings/" + mid, undefined, owner),
  );
  current = ok(
    await call(
      "POST",
      base + "/meetings/" + mid + "/actions/participants",
      {
        participants: [{ memberId: member.id, access: "DENY" }],
        scope: "THIS",
      },
      owner,
      current.meeting.version,
    ),
  );
  assert.equal(
    (await call("GET", base + "/meetings/" + mid, undefined, guest)).statusCode,
    404,
  );
  assert.deepEqual(
    ok(await call("GET", base + "/meetings?limit=1", undefined, guest)).items,
    [],
  );
  const beforeDeny = callbacks;
  await assert.rejects(workerRead);
  assert.equal(callbacks, beforeDeny);
  ok(
    await call(
      "POST",
      base + "/meetings/" + mid + "/actions/participants/remove",
      { memberId: member.id },
      owner,
      current.meeting.version,
    ),
  );
  ok(await call("GET", base + "/meetings/" + mid, undefined, guest));
  // A current report read denial overrides its exact grant.
  const reportNow = ok(
    await call("GET", base + "/meetings/" + published, undefined, owner),
  );
  ok(
    await call(
      "POST",
      base + "/meetings/" + published + "/report/actions/access",
      { memberId: reportMember.id, canRead: false, canEdit: false },
      owner,
      reportNow.report.version,
    ),
  );
  assert.equal(
    (
      await call(
        "GET",
        base + "/meeting-reports/" + rid,
        undefined,
        reportGuest,
      )
    ).statusCode,
    404,
  );
  assert.deepEqual(
    ok(await call("GET", base + "/meeting-reports", undefined, reportGuest))
      .items,
    [],
  );
  const beforeReportDeny = reportCallbacks;
  await assert.rejects(workerReportRead);
  assert.equal(reportCallbacks, beforeReportDeny);
  const grants = ok(
    await call(
      "GET",
      base + "/members/" + member.id + "/access-grants",
      undefined,
      owner,
    ),
  );
  const grant = grants.items.find((g: any) => g.resourceId === mid);
  ok(
    await call(
      "POST",
      base + "/members/" + member.id + "/access-grants/" + grant.id + "/revoke",
      {},
      owner,
      grant.version,
    ),
  );
  assert.equal(
    (await call("GET", base + "/meetings/" + mid, undefined, guest)).statusCode,
    404,
  );
  const atRevoke = callbacks;
  await assert.rejects(workerRead);
  assert.equal(callbacks, atRevoke);
  // Current grantor loss invalidates the grant before a worker callback.
  ok(
    await call(
      "POST",
      base + "/members/" + member.id + "/access-grants",
      { accessPlan: [{ resource: ref("meeting", mid), actions: ["read"] }] },
      owner,
    ),
  );
  await workerRead();
  const second = ok(
    await call("POST", base + "/members", { accountId: foreign.id }, owner),
    201,
  ).membership;
  current = ok(await call("GET", base + "/meetings/" + mid, undefined, owner));
  current = ok(
    await call(
      "POST",
      base + "/meetings/" + mid + "/actions/participants",
      {
        participants: [
          { memberId: second.id, access: "EDIT", canManage: true },
        ],
        scope: "THIS",
      },
      owner,
      current.meeting.version,
    ),
  );
  ok(
    await call(
      "POST",
      base + "/meetings/" + mid + "/actions/participants/remove",
      { memberId: A.membership.id },
      owner,
      current.meeting.version,
    ),
  );
  assert.equal(
    (await call("GET", base + "/meetings/" + mid, undefined, guest)).statusCode,
    404,
  );
  const atGrantorLoss = callbacks;
  await assert.rejects(workerRead);
  assert.equal(callbacks, atGrantorLoss);
  assert.equal(
    coreHTTP!.isGuest({ member: { member_type: "GUEST" } } as any),
    true,
  );
});

test("MEMBER to Guest downgrade preserves exact read but blocks successful write replay and legacy participant EDIT", async () => {
  const owner = await user(),
    actor = await user();
  const A = ok(
      await call("POST", "/organizations", { name: "Guest replay" }, owner),
      201,
    ),
    base = "/organizations/" + A.organization.id;
  const membership = ok(
    await call("POST", base + "/members", { accountId: actor.id }, owner),
    201,
  ).membership;
  const created = ok(
    await call(
      "POST",
      base + "/meeting-series",
      {
        title: "Read after downgrade",
        circleId: A.rootCircle.id,
        localStart: "2030-01-01T10:00",
        timeZone: "America/Sao_Paulo",
        durationMinutes: 60,
        recurrence: { frequency: "ONCE" },
        sections: [{ id: "agenda", title: "Agenda", kind: "AGENDA" }],
        participants: [{ memberId: membership.id, access: "EDIT" }],
        policy: { notesOnlyNoter: false, windowDays: 7 },
      },
      owner,
    ),
    201,
  );
  const mid = created.occurrenceIds[0],
    route = base + "/meetings/" + mid;
  const before = ok(await call("GET", route, undefined, actor)),
    key = randomUUID(),
    payload = { title: "Created before downgrade" };
  ok(
    await call(
      "POST",
      route + "/agenda",
      payload,
      actor,
      before.meeting.version,
      key,
    ),
  );
  ok(
    await call(
      "POST",
      base + "/members/" + membership.id + "/access-grants",
      { accessPlan: [{ resource: ref("meeting", mid), actions: ["read"] }] },
      owner,
    ),
  );
  const currentMember = ok(
    await call("GET", base + "/members", undefined, owner),
  ).items.find((m: any) => m.id === membership.id);
  ok(
    await call(
      "POST",
      base + "/members/" + membership.id + "/actions/change-type",
      { memberType: "GUEST", confirmVisibilityChange: true },
      owner,
      currentMember.version,
    ),
  );
  const after = ok(await call("GET", route, undefined, actor));
  assert.equal(after.accessMode, "GUEST_READ");
  assert.ok(Object.values(after.capabilities).every((v) => v === false));
  assert.deepEqual(after.participants, []);
  assert.equal(after.agenda.length, 1);
  const replay = await call(
    "POST",
    route + "/agenda",
    payload,
    actor,
    before.meeting.version,
    key,
  );
  assert.equal(replay.statusCode, 404);
  assert.ok(!replay.body.includes(A.membership.id));
  assert.equal(
    (
      await call(
        "POST",
        route + "/agenda",
        { title: "Forbidden after downgrade" },
        actor,
        after.meeting.version,
      )
    ).statusCode,
    404,
  );
  assert.equal(ok(await call("GET", route, undefined, owner)).agenda.length, 1);
});
