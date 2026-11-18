import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { buildApp } from "../../server/src/app.js";
import { foundationDefaultAdmissionPolicy } from "../../server/src/admission.js";
import { pool } from "../../server/src/db.js";
import { fail, version } from "../../server/src/core.js";
import { createMeetings } from "../../server/modules/meetings/plugin.js";
import { type MeetingPorts } from "../../server/modules/meetings/service.js";
import {
  authorizeAgendaItem,
  agendaTarget,
  moveAgendaItem,
} from "../../server/modules/meetings/agenda-items.js";
import { fromPlainText } from "../../packages/content/index.js";

if (
  !/^\/orgmap_meetings_test_[a-f0-9]+$/.test(
    new URL(process.env.DATABASE_URL ?? "postgres://invalid/orgmap").pathname,
  )
)
  throw Error(
    "Exclusive disposable Meetings DB required; run server/modules/meetings/validate.ts.",
  );
const admin = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
const disabled = new Set<string>();
const ports: MeetingPorts = {
  validateMembers: async (ctx, ids) =>
    (
      await ctx.c.query(
        "SELECT id FROM members WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND status='ACTIVE' AND member_type='MEMBER'",
        [ctx.org.id, ids],
      )
    ).rowCount === new Set(ids).size,
};
const app = await buildApp([
  foundationDefaultAdmissionPolicy,
  async (_app, core) => {
    core.registerModuleScope({
      module: "meetings",
      routePrefixes: [],
      resourceTypes: ["meeting", "report", "agenda-item"],
    });
    core.registerOrganizationSettings(async (ctx) => ({
      version: 1,
      settings: {
        name: ctx.org.name,
        locale: ctx.org.locale,
        timezone: ctx.org.time_zone,
        modules: { structure: true, meetings: !disabled.has(ctx.org.id) },
      },
    }));
  },
  createMeetings(ports),
  async (app, core) => {
    // Test-only fault injection. The production common writer, event, audit and outbox
    // run in the real tenant UoW, then this fixture deliberately throws before commit.
    app.post(
      "/api/v1/organizations/:organizationId/test-only-agenda-rollback",
      (request) => {
        const input = request.body as any;
        return core.tenant(
          request,
          {
            mode: "write",
            authorize: async (ctx) => {
              await core.assertResourceAvailable(ctx, "meeting");
              await authorizeAgendaItem(
                ctx,
                input.itemId,
                "RESCHEDULE",
                ports,
                input.targetMeetingId,
              );
              return true;
            },
          },
          async (ctx) => {
            const item = await authorizeAgendaItem(
              ctx,
              input.itemId,
              "RESCHEDULE",
              ports,
              input.targetMeetingId,
            );
            version(request, item.version);
            const target = await agendaTarget(
              ctx,
              input.targetMeetingId,
              ports,
            );
            if (input.expectedTargetVersion !== target.m.version)
              fail(409, "VERSION_CONFLICT");
            await moveAgendaItem(ctx, item, target.m, undefined, ports);
            await core.changed(
              ctx,
              request,
              item.id,
              "TestOnlyAgendaAfterWriter",
            );
            throw Error("test-only agenda common-writer rollback");
          },
        );
      },
    );
  },
]);
after(async () => {
  await app.close();
  await pool.end();
  await admin.end();
});
type User = { cookie: string; csrf: string; id: string };
async function call(
  method: string,
  path: string,
  payload?: any,
  actor?: User,
  expectedVersion?: number,
  key = randomUUID(),
) {
  return app.inject({
    method: method as any,
    url: "/api/v1" + path,
    payload,
    headers: {
      origin: "http://localhost:5173",
      "idempotency-key": key,
      ...(actor ? { cookie: actor.cookie, "x-csrf-token": actor.csrf } : {}),
      ...(expectedVersion === undefined
        ? {}
        : { "if-match": `"${expectedVersion}"` }),
    },
  });
}
function data(response: any, status?: number) {
  assert.ok(
    status
      ? response.statusCode === status
      : [200, 201].includes(response.statusCode),
    response.body,
  );
  return response.json().data;
}
async function user(): Promise<User> {
  const response = await call("POST", "/auth/register", {
    email: randomUUID() + "@example.test",
    password: "agenda-items-test-password-123",
    displayName: "Synthetic agenda member",
  });
  const result = data(response, 201);
  return {
    cookie: response.cookies[0].name + "=" + response.cookies[0].value,
    csrf: result.csrfToken,
    id: result.account.id,
  };
}
async function organization() {
  const owner = await user();
  const result = data(
    await call(
      "POST",
      "/organizations",
      { name: "Synthetic LF06 agenda" },
      owner,
    ),
    201,
  );
  return { ...result, owner, base: "/organizations/" + result.organization.id };
}
async function member(o: any, account: User, memberType = "MEMBER") {
  return data(
    await call(
      "POST",
      o.base + "/members",
      {
        accountId: account.id,
        ...(memberType === "GUEST" ? { memberType, accessPlan: [] } : {}),
      },
      o.owner,
    ),
    201,
  ).membership;
}
async function meeting(
  o: any,
  participants: any[] = [],
  title = "Synthetic meeting",
) {
  const created = data(
    await call(
      "POST",
      o.base + "/meeting-series",
      {
        title,
        circleId: o.rootCircle.id,
        localStart: "2031-01-15T10:00",
        timeZone: "UTC",
        durationMinutes: 60,
        recurrence: { frequency: "ONCE" },
        sections: [{ id: "agenda", title: "Agenda", kind: "AGENDA" }],
        participants,
        policy: {},
      },
      o.owner,
    ),
    201,
  );
  return created.occurrenceIds[0] as string;
}
async function detail(o: any, id: string, actor = o.owner) {
  return data(await call("GET", o.base + "/meetings/" + id, undefined, actor));
}
async function intention(
  o: any,
  actor = o.owner,
  body: any = { title: "Synthetic intention" },
) {
  return data(
    await call("POST", o.base + "/meeting-agenda-items", body, actor),
    201,
  );
}
async function itemDetail(o: any, id: string, actor = o.owner) {
  return data(
    await call("GET", o.base + "/meeting-agenda-items/" + id, undefined, actor),
  );
}
async function schedule(
  o: any,
  item: any,
  meetingId: string,
  actor = o.owner,
  key = randomUUID(),
) {
  const target = await detail(o, meetingId, actor);
  const body = {
    targetMeetingId: meetingId,
    expectedTargetVersion: target.meeting.version,
  };
  const result = data(
    await call(
      "POST",
      o.base + `/meeting-agenda-items/${item.item.id}/actions/schedule`,
      body,
      actor,
      item.item.version,
      key,
    ),
  );
  return { result, body, version: item.item.version, key };
}
async function currentAcl(
  o: any,
  mid: string,
  memberId: string,
  access: string,
) {
  const current = await detail(o, mid);
  data(
    await call(
      "POST",
      o.base + `/meetings/${mid}/actions/participants`,
      { scope: "THIS", participants: [{ memberId, access }] },
      o.owner,
      current.meeting.version,
    ),
  );
}
async function snapshot(o: any) {
  const org = o.organization.id;
  return (
    await admin.query(
      `SELECT
    (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM meeting_agenda_items i WHERE organization_id=$1) AS items,
    (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM meeting_agenda a WHERE organization_id=$1) AS placements,
    (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM meeting_occurrences m WHERE organization_id=$1) AS meetings,
    (SELECT authorization_revision FROM organizations WHERE id=$1) AS authorization,
    (SELECT count(*) FROM command_results WHERE organization_id=$1) AS commands,
    (SELECT count(*) FROM domain_events WHERE organization_id=$1) AS events,
    (SELECT count(*) FROM audit_events WHERE organization_id=$1) AS audit,
    (SELECT count(*) FROM outbox WHERE organization_id=$1) AS outbox`,
      [org],
    )
  ).rows[0];
}

test("AG01: standalone rich intention reloads PARKED, null differs from zero, and creates no meeting or task", async () => {
  const o = await organization();
  const rich = fromPlainText("Rich agenda description");
  rich.doc.content[0] = {
    type: "paragraph",
    content: [
      {
        type: "text",
        text: "Rich agenda description",
        marks: [
          { type: "bold" },
          { type: "link", attrs: { href: "https://example.test/agenda" } },
        ],
      },
    ],
  };
  const first = await intention(o, o.owner, {
    title: "Independent",
    descriptionRich: rich,
  });
  assert.equal(first.item.state, "PARKED");
  assert.equal(first.item.ownerId, o.membership.id);
  assert.equal(first.item.expectedDurationMinutes, null);
  assert.equal(first.item.circleId, null);
  assert.equal(first.placement, undefined);
  assert.deepEqual(
    (await itemDetail(o, first.item.id)).item.descriptionRich,
    rich,
  );
  const zero = await intention(o, o.owner, {
    title: "Zero duration",
    expectedDurationMinutes: 0,
  });
  assert.equal(
    (await itemDetail(o, zero.item.id)).item.expectedDurationMinutes,
    0,
  );
  const updated = data(
    await call(
      "PATCH",
      o.base + "/meeting-agenda-items/" + first.item.id,
      { title: "Revised", expectedDurationMinutes: 0 },
      o.owner,
      first.item.version,
    ),
  );
  assert.equal(updated.item.version, first.item.version + 1);
  assert.deepEqual(updated.item.descriptionRich, rich);
  const stale = await call(
    "PATCH",
    o.base + "/meeting-agenda-items/" + first.item.id,
    { title: "Stale overwrite" },
    o.owner,
    first.item.version,
  );
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().error.code, "VERSION_CONFLICT");
  assert.equal((await itemDetail(o, first.item.id)).item.title, "Revised");
  const counts = (
    await admin.query(
      "SELECT (SELECT count(*) FROM meeting_occurrences WHERE organization_id=$1) AS meetings,(SELECT count(*) FROM work_tasks WHERE organization_id=$1) AS tasks",
      [o.organization.id],
    )
  ).rows[0];
  assert.deepEqual(counts, { meetings: "0", tasks: "0" });
});

test("AG02/03: stable intention, new placements, exact versions, rollback after common writer, replay and revoked historical ACL", async () => {
  const o = await organization(),
    actor = await user(),
    m = await member(o, actor);
  const participants = [{ memberId: m.id, access: "EDIT" }];
  const sourceId = await meeting(o, participants, "Source meeting"),
    targetId = await meeting(o, participants, "Destination meeting");
  const parked = await intention(o, actor, {
    title: "Move once",
    description: "Content survives placements",
  });
  const first = await schedule(o, parked, sourceId, actor);
  assert.equal(first.result.item.id, parked.item.id);
  assert.equal(first.result.item.circleId, o.rootCircle.id);
  assert.equal(first.result.placement.presenterId, m.id);
  assert.equal(
    first.result.placement.meetingVersion,
    first.body.expectedTargetVersion + 1,
  );
  assert.deepEqual(
    data(
      await call(
        "POST",
        o.base + `/meeting-agenda-items/${parked.item.id}/actions/schedule`,
        first.body,
        actor,
        first.version,
        first.key,
      ),
    ),
    first.result,
  );
  await currentAcl(o, sourceId, m.id, "DENY");
  assert.equal(
    (
      await call(
        "POST",
        o.base + `/meeting-agenda-items/${parked.item.id}/actions/schedule`,
        first.body,
        actor,
        first.version,
        first.key,
      )
    ).statusCode,
    404,
  );
  await currentAcl(o, sourceId, m.id, "EDIT");
  let current = await itemDetail(o, parked.item.id, actor);
  const source = await detail(o, sourceId, actor),
    target = await detail(o, targetId, actor);
  const body = {
    targetMeetingId: targetId,
    expectedSourceVersion: source.meeting.version,
    expectedTargetVersion: target.meeting.version,
  };
  const before = await snapshot(o);
  const failed = await call(
    "POST",
    o.base + "/test-only-agenda-rollback",
    { itemId: parked.item.id, ...body },
    actor,
    current.item.version,
  );
  assert.equal(failed.statusCode, 500, failed.body);
  assert.deepEqual(
    await snapshot(o),
    before,
    "item/placement/meeting/event/audit/outbox/idempotency all roll back",
  );
  const stale = await call(
    "POST",
    o.base + `/meeting-agenda-items/${parked.item.id}/actions/reschedule`,
    { ...body, expectedSourceVersion: source.meeting.version - 1 },
    actor,
    current.item.version,
  );
  assert.equal(stale.statusCode, 409);
  assert.deepEqual(await snapshot(o), before);
  const key = randomUUID(),
    oldVersion = current.item.version;
  current = data(
    await call(
      "POST",
      o.base + `/meeting-agenda-items/${parked.item.id}/actions/reschedule`,
      body,
      actor,
      oldVersion,
      key,
    ),
  );
  assert.equal(current.item.id, parked.item.id);
  assert.notEqual(current.placement.id, first.result.placement.id);
  assert.equal(current.placement.meetingVersion, target.meeting.version + 1);
  assert.equal(
    (await detail(o, sourceId, actor)).meeting.version,
    source.meeting.version + 1,
  );
  const oldPlacement = (await detail(o, sourceId, actor)).agenda.find(
    (entry: any) => entry.id === first.result.placement.id,
  );
  assert.equal(oldPlacement.status, "TRANSFERRED");
  const newPlacement = (await detail(o, targetId, actor)).agenda.find(
    (entry: any) => entry.id === current.placement.id,
  );
  assert.equal(newPlacement.transferredFrom, oldPlacement.id);
  const after = await snapshot(o);
  assert.deepEqual(
    data(
      await call(
        "POST",
        o.base + `/meeting-agenda-items/${parked.item.id}/actions/reschedule`,
        body,
        actor,
        oldVersion,
        key,
      ),
    ),
    current,
  );
  assert.deepEqual(
    await snapshot(o),
    after,
    "same-key replay adds no placements, bumps or events",
  );
  await currentAcl(o, sourceId, m.id, "DENY");
  const revokedSource = await call(
    "POST",
    o.base + `/meeting-agenda-items/${parked.item.id}/actions/reschedule`,
    body,
    actor,
    oldVersion,
    key,
  );
  assert.equal(revokedSource.statusCode, 404, revokedSource.body);
  assert.ok(!revokedSource.body.includes("Source meeting"));
  await currentAcl(o, sourceId, m.id, "EDIT");
  await currentAcl(o, targetId, m.id, "DENY");
  assert.equal(
    (
      await call(
        "POST",
        o.base + `/meeting-agenda-items/${parked.item.id}/actions/reschedule`,
        body,
        actor,
        oldVersion,
        key,
      )
    ).statusCode,
    404,
  );
});

test("AG04: skipped/closed and cancelled intentions need rescheduling; later placement cannot rewrite report snapshots", async () => {
  const o = await organization(),
    source = await meeting(o),
    target = await meeting(o);
  const original = await intention(o),
    scheduled = (await schedule(o, original, source)).result;
  let d = await detail(o, source);
  d = data(
    await call(
      "POST",
      o.base + `/meetings/${source}/actions/start`,
      {},
      o.owner,
      d.meeting.version,
    ),
  );
  data(
    await call(
      "POST",
      o.base +
        `/meetings/${source}/agenda/${scheduled.placement.id}/actions/skip`,
      {},
      o.owner,
      scheduled.placement.version,
    ),
  );
  d = await detail(o, source);
  data(
    await call(
      "POST",
      o.base + `/meetings/${source}/actions/close`,
      {},
      o.owner,
      d.meeting.version,
    ),
  );
  const waiting = await itemDetail(o, original.item.id);
  assert.equal(waiting.item.state, "NEEDS_RESCHEDULE");
  const reports = async () =>
    (
      await admin.query(
        "SELECT version,snapshot::text FROM meeting_report_versions WHERE organization_id=$1 ORDER BY report_id,version",
        [o.organization.id],
      )
    ).rows;
  const before = await reports();
  assert.equal(before.length, 1);
  const moved = (await schedule(o, waiting, target)).result;
  assert.equal(moved.item.id, original.item.id);
  assert.notEqual(moved.placement.id, scheduled.placement.id);
  assert.deepEqual(await reports(), before);
  const cancelledMeeting = await meeting(o),
    cancelledItem = (await schedule(o, await intention(o), cancelledMeeting))
      .result;
  const cancelDetail = await detail(o, cancelledMeeting);
  data(
    await call(
      "POST",
      o.base + `/meetings/${cancelledMeeting}/actions/cancel`,
      { scope: "THIS", reason: "Synthetic cancellation" },
      o.owner,
      cancelDetail.meeting.version,
    ),
  );
  assert.equal(
    (await itemDetail(o, cancelledItem.item.id)).item.state,
    "NEEDS_RESCHEDULE",
  );
  assert.deepEqual(await reports(), before);
});

test("AG05/07: private parking is owner-only, cursor is actor/filter-bound, tenant/Guest/module checks precede replay", async () => {
  const o = await organization(),
    actor = await user();
  await member(o, actor);
  const privateItem = await intention(o, actor, {
    title: "Secret personal intention",
  });
  const first = await intention(o),
    second = await intention(o);
  const list = data(
    await call(
      "GET",
      o.base + "/meeting-agenda-items?state=PARKED&limit=1",
      undefined,
      o.owner,
    ),
  );
  assert.equal(list.items.length, 1);
  assert.equal(list.page.hasMore, true);
  assert.ok(list.page.nextCursor);
  const next = data(
    await call(
      "GET",
      o.base +
        "/meeting-agenda-items?state=PARKED&limit=1&cursor=" +
        encodeURIComponent(list.page.nextCursor),
      undefined,
      o.owner,
    ),
  );
  assert.deepEqual(
    new Set([...list.items, ...next.items].map((entry: any) => entry.item.id)),
    new Set([first.item.id, second.item.id]),
  );
  assert.equal(next.page.hasMore, false);
  assert.equal(
    (
      await call(
        "GET",
        o.base + "/meeting-agenda-items/" + privateItem.item.id,
        undefined,
        o.owner,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "GET",
        o.base +
          "/meeting-agenda-items?state=PARKED&limit=1&cursor=" +
          encodeURIComponent(list.page.nextCursor),
        undefined,
        actor,
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await call(
        "GET",
        o.base +
          "/meeting-agenda-items?state=ASSIGNED&limit=1&cursor=" +
          encodeURIComponent(list.page.nextCursor),
        undefined,
        o.owner,
      )
    ).statusCode,
    400,
  );
  const foreign = await organization(),
    foreignMeeting = await meeting(foreign);
  assert.equal(
    (
      await call(
        "POST",
        o.base + `/meeting-agenda-items/${first.item.id}/actions/schedule`,
        { targetMeetingId: foreignMeeting, expectedTargetVersion: 1 },
        o.owner,
        first.item.version,
      )
    ).statusCode,
    404,
  );
  const guest = await user();
  await member(o, guest, "GUEST");
  for (const [method, suffix, body] of [
    ["GET", "", undefined],
    ["GET", "/targets", undefined],
    ["GET", "/" + first.item.id, undefined],
    ["POST", "", { title: "Guest write" }],
  ] as const)
    assert.equal(
      (
        await call(
          method,
          o.base + "/meeting-agenda-items" + suffix,
          body,
          guest,
        )
      ).statusCode,
      404,
    );
  const key = randomUUID(),
    payload = { title: "Replay guarded create" };
  data(
    await call(
      "POST",
      o.base + "/meeting-agenda-items",
      payload,
      o.owner,
      undefined,
      key,
    ),
    201,
  );
  disabled.add(o.organization.id);
  try {
    assert.equal(
      (
        await call(
          "POST",
          o.base + "/meeting-agenda-items",
          payload,
          o.owner,
          undefined,
          key,
        )
      ).statusCode,
      403,
    );
  } finally {
    disabled.delete(o.organization.id);
  }
});

test("AG06: migration-shaped legacy identity keeps unknown authorship; adoption is explicit and unschedule uses meeting authority", async () => {
  const o = await organization(),
    newOwner = await user(),
    ownerMember = await member(o, newOwner),
    mid = await meeting(o);
  const id = randomUUID(),
    rich = fromPlainText("");
  // Synthetic post-migration fixture, not a claim that a read request migrates data.
  await admin.query(
    "INSERT INTO meeting_agenda_items(organization_id,id,title,description_rich,state,circle_id,expected_duration_minutes,source_kind,identity_coverage,creator_coverage) VALUES($1,$2,'Unknown historical author',$3,'ASSIGNED',$4,7,'LEGACY_UNKNOWN','LEGACY_PLACEMENT','UNKNOWN')",
    [o.organization.id, id, JSON.stringify(rich), o.rootCircle.id],
  );
  await admin.query(
    "INSERT INTO meeting_agenda(organization_id,id,meeting_id,title,presenter_id,duration_minutes,agenda_item_id,is_active) VALUES($1,$2,$3,'Unknown historical author',$4,7,$2,true)",
    [o.organization.id, id, mid, o.membership.id],
  );
  await admin.query(
    "UPDATE meeting_agenda_items SET current_placement_id=$2,last_placement_id=$2 WHERE organization_id=$1 AND id=$2",
    [o.organization.id, id],
  );
  const legacy = await itemDetail(o, id);
  assert.equal(legacy.item.id, id);
  assert.equal(legacy.placement.id, id);
  assert.equal(legacy.item.ownerId, null);
  assert.equal(legacy.item.creatorId, null);
  assert.equal(legacy.item.createdAt, null);
  assert.equal(legacy.coverage.creatorCoverage, "UNKNOWN");
  assert.equal(legacy.capabilities.unschedule, false);
  assert.equal(legacy.capabilities.adopt, true);
  assert.equal(
    (
      await call(
        "POST",
        o.base + `/meeting-agenda-items/${id}/actions/unschedule`,
        { reason: "Cannot infer owner" },
        o.owner,
        legacy.item.version,
      )
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await call(
        "POST",
        o.base + `/meeting-agenda-items/${id}/actions/adopt`,
        { ownerMemberId: ownerMember.id, reason: "" },
        o.owner,
        legacy.item.version,
      )
    ).statusCode,
    400,
  );
  const adopted = data(
    await call(
      "POST",
      o.base + `/meeting-agenda-items/${id}/actions/adopt`,
      { ownerMemberId: ownerMember.id, reason: "Explicit current owner" },
      o.owner,
      legacy.item.version,
    ),
  );
  assert.equal(adopted.item.ownerId, ownerMember.id);
  assert.equal(adopted.item.creatorId, null);
  assert.equal(adopted.item.adoptedBy, o.membership.id);
  assert.equal(adopted.coverage.creatorCoverage, "UNKNOWN");
  data(
    await call(
      "POST",
      o.base + `/meeting-agenda-items/${id}/actions/unschedule`,
      { reason: "Return to adopted owner" },
      o.owner,
      adopted.item.version,
    ),
  );
  assert.equal((await itemDetail(o, id, newOwner)).item.state, "PARKED");
  assert.equal(
    (
      await call(
        "GET",
        o.base + "/meeting-agenda-items/" + id,
        undefined,
        o.owner,
      )
    ).statusCode,
    404,
  );
});

test("AG03: unschedule and archive replay once; revoked source cannot expose cached meeting metadata", async () => {
  const o = await organization(),
    actor = await user(),
    m = await member(o, actor),
    mid = await meeting(o, [{ memberId: m.id, access: "EDIT" }]);
  const current = (await schedule(o, await intention(o, actor), mid, actor))
    .result;
  const path =
      o.base + `/meeting-agenda-items/${current.item.id}/actions/unschedule`,
    key = randomUUID(),
    payload = { reason: "Parking for later" };
  const removed = data(
    await call("POST", path, payload, actor, current.item.version, key),
  );
  assert.equal(removed.item.state, "PARKED");
  const after = await snapshot(o);
  assert.deepEqual(
    data(await call("POST", path, payload, actor, current.item.version, key)),
    removed,
  );
  assert.deepEqual(await snapshot(o), after);
  await currentAcl(o, mid, m.id, "DENY");
  const replay = await call(
    "POST",
    path,
    payload,
    actor,
    current.item.version,
    key,
  );
  assert.ok([403, 404].includes(replay.statusCode), replay.body);
  const redacted = await itemDetail(o, current.item.id, actor);
  assert.equal(redacted.coverage.historyRedacted, true);
  assert.equal(redacted.placement, undefined);
  const archivePath =
      o.base + `/meeting-agenda-items/${current.item.id}/actions/archive`,
    archiveKey = randomUUID(),
    archiveBody = { reason: "No longer needed" };
  const archived = data(
    await call(
      "POST",
      archivePath,
      archiveBody,
      actor,
      redacted.item.version,
      archiveKey,
    ),
  );
  assert.equal(archived.item.state, "ARCHIVED");
  assert.equal(archived.placement, undefined);
  const final = await snapshot(o);
  assert.deepEqual(
    data(
      await call(
        "POST",
        archivePath,
        archiveBody,
        actor,
        redacted.item.version,
        archiveKey,
      ),
    ),
    archived,
  );
  assert.deepEqual(await snapshot(o), final);
});
