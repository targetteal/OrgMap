import { foundationDefaultAdmissionPolicy } from "../../server/src/admission.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../server/src/app.js";
import { pool, transaction } from "../../server/src/db.js";
import { createMeetings } from "../../server/modules/meetings/plugin.js";
import { Y } from "../../server/modules/meetings/realtime.js";
import { occurrences, rule } from "../../server/modules/meetings/calendar.js";
import { windowOpen } from "../../server/modules/meetings/domain.js";
import { createMeetingResourceAdapters } from "../../server/modules/meetings/platform.js";
import type { ResourceAction } from "../../server/modules/platform/ports.js";
import pg from "pg";
import { createMeetingCalendarPort } from "../../server/modules/meetings/calendar-port.js";
if (
  !/^\/orgmap_(?:meetings_)?test_[a-f0-9]+$/.test(
    new URL(process.env.DATABASE_URL ?? "postgres://invalid/orgmap").pathname,
  )
)
  throw Error(
    "Meetings tests require an exclusive disposable test database. Run server/modules/meetings/validate.ts.",
  );
const adapters = createMeetingResourceAdapters();
const moduleAvailability = new Map<string, boolean>();
const app = await buildApp([
  foundationDefaultAdmissionPolicy,
  async (_app, core) => {
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
        modules: {
          structure: true,
          meetings: moduleAvailability.get(ctx.org.id) ?? true,
        },
      },
    }));
  },
  createMeetings({
    validateMembers: async (ctx, ids) => {
      const r = await ctx.c.query(
        `SELECT id FROM members WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND status='ACTIVE'`,
        [ctx.org.id, ids],
      );
      return r.rowCount === new Set(ids).size;
    },
  }),
  async (app, core) => {
    app.get(
      "/api/v1/organizations/:organizationId/test-meeting-calendar",
      (r) =>
        core.tenant(r, { mode: "read" }, (ctx) =>
          createMeetingCalendarPort().list(ctx),
        ),
    );
    app.get(
      "/api/v1/organizations/:organizationId/test-meeting-resource/:kind/:rid/:action",
      (r) =>
        core.tenant(r, { mode: "read" }, async (ctx) => {
          const p = r.params as any,
            a = adapters[p.kind as "meeting" | "report"];
          return {
            allowed: await a.authorize(ctx, p.rid, p.action as ResourceAction),
            search: await a.search!(ctx, "", 100),
          };
        }),
    );
  },
]);
after(async () => {
  await app.close();
  await pool.end();
});
type User = { cookie: string; csrf: string; id: string };
const origin = "http://localhost:5173";
async function call(
  method: string,
  path: string,
  b: any = undefined,
  u?: User,
  v?: number,
  key = randomUUID(),
) {
  return app.inject({
    method: method as any,
    url: "/api/v1" + path,
    payload: b,
    headers: {
      origin,
      ...(u ? { cookie: u.cookie, "x-csrf-token": u.csrf } : {}),
      "idempotency-key": key,
      ...(v ? { "if-match": `"${v}"` } : {}),
    },
  });
}
function data(r: any, code?: number) {
  assert.ok(
    code ? r.statusCode === code : [200, 201].includes(r.statusCode),
    r.body,
  );
  return r.json().data;
}
async function user() {
  const r = await call("POST", "/auth/register", {
    email: randomUUID() + "@example.test",
    password: "a-secure-password-123",
    displayName: "Pessoa " + randomUUID().slice(0, 5),
  });
  const d = data(r);
  return {
    cookie: r.cookies[0].name + "=" + r.cookies[0].value,
    csrf: d.csrfToken,
    id: d.account.id,
  };
}
function content(snapshot: string) {
  const d = new Y.Doc();
  Y.applyUpdate(d, Buffer.from(snapshot, "base64"));
  const text = d.getText("notes").toString();
  d.destroy();
  return text;
}
function update(d: any, value: string) {
  let bytes: Uint8Array | undefined;
  const listener = (b: Uint8Array) => {
    bytes = b;
  };
  d.on("update", listener);
  d.getText("notes").insert(0, value);
  d.off("update", listener);
  return Buffer.from(bytes!).toString("base64");
}
test("civil recurrence: DST, month end, leap year, weekday and set position", () => {
  assert.equal(
    occurrences(
      "2027-03-14T02:30",
      "America/New_York",
      rule({ frequency: "ONCE" }),
    )[0].startAt,
    "2027-03-14T07:30:00Z",
  );
  assert.equal(
    occurrences(
      "2027-11-07T01:30",
      "America/New_York",
      rule({ frequency: "ONCE" }),
    )[0].startAt,
    "2027-11-07T05:30:00Z",
  );
  assert.deepEqual(
    occurrences(
      "2030-01-31T10:00",
      "UTC",
      rule({ frequency: "MONTHLY", count: 3 }),
    ).map((x) => x.localStart.slice(0, 10)),
    ["2030-01-31", "2030-03-31", "2030-05-31"],
  );
  assert.deepEqual(
    occurrences(
      "2028-02-29T10:00",
      "UTC",
      rule({ frequency: "YEARLY", count: 2 }),
    ).map((x) => x.localStart.slice(0, 10)),
    ["2028-02-29", "2032-02-29"],
  );
  assert.equal(
    occurrences(
      "2030-01-01T10:00",
      "UTC",
      rule({ frequency: "MONTHLY", byDay: [1], bySetPos: -1, count: 1 }),
    )[0].localStart.slice(0, 10),
    "2030-01-28",
  );
  assert.throws(() => rule({ frequency: "DAILY", interval: 0 }));
  assert.throws(() => occurrences("bad", "UTC", rule({ frequency: "ONCE" })));
  assert.equal(
    windowOpen(
      { first_published_at: "2030-01-01T00:00:00Z", window_days: 1 },
      Date.parse("2030-01-02T00:00:00Z"),
    ),
    false,
  );
  assert.equal(
    windowOpen({ first_published_at: "2000-01-01", window_days: 0 }),
    true,
  );
});
test("real PostgreSQL: meetings, ACL, concurrency, durable Yjs, report barrier and epochs", async () => {
  const a = await user(),
    b = await user();
  const A = data(
      await call("POST", "/organizations", { name: "Aurora Reuniões" }, a),
    ),
    B = data(
      await call("POST", "/organizations", { name: "Horizonte Reuniões" }, b),
    );
  const p = "/organizations/" + A.organization.id,
    q = "/organizations/" + B.organization.id;
  const member = data(
    await call("POST", p + "/members", { accountId: b.id }, a),
  ).membership;
  const created = data(
    await call(
      "POST",
      p + "/meeting-series",
      {
        title: "Decisões do círculo",
        circleId: A.rootCircle.id,
        localStart: "2030-01-31T10:00",
        timeZone: "America/Sao_Paulo",
        durationMinutes: 60,
        recurrence: { frequency: "MONTHLY", count: 3 },
        sections: [
          { id: "checkin", title: "Check-in", kind: "CHECKIN" },
          { id: "agenda", title: "Agenda", kind: "AGENDA" },
        ],
        participants: [{ memberId: member.id, access: "EDIT" }],
        policy: { notesOnlyNoter: false, windowDays: 7 },
      },
      a,
    ),
    201,
  );
  assert.equal(created.occurrenceIds.length, 3);
  const firstPage = data(
    await call("GET", p + "/meetings?limit=1", undefined, a),
  );
  assert.equal(firstPage.items.length, 1);
  assert.equal(firstPage.items[0].isParticipant, true);
  assert.equal(firstPage.page.hasMore, true);
  const secondPage = data(
    await call(
      "GET",
      p +
        "/meetings?limit=1&cursor=" +
        encodeURIComponent(firstPage.page.nextCursor),
      undefined,
      a,
    ),
  );
  assert.notEqual(firstPage.items[0].id, secondPage.items[0].id);
  assert.equal(
    (
      await call(
        "GET",
        q +
          "/meetings?limit=1&cursor=" +
          encodeURIComponent(firstPage.page.nextCursor),
        undefined,
        b,
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await call(
        "GET",
        p +
          "/meetings?limit=1&state=SCHEDULED&cursor=" +
          encodeURIComponent(firstPage.page.nextCursor),
        undefined,
        a,
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await call(
        "GET",
        p +
          "/meetings?limit=1&cursor=" +
          encodeURIComponent(firstPage.page.nextCursor + "tamper"),
        undefined,
        a,
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (await call("GET", p + "/meetings?limit=0", undefined, a)).statusCode,
    400,
  );
  const mid = created.occurrenceIds[0],
    route = p + "/meetings/" + mid;
  let d = data(await call("GET", route, undefined, a));
  assert.equal(
    (await call("GET", q + "/meetings/" + mid, undefined, b)).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "POST",
        route + "/collaboration/updates",
        {
          sectionId: "agenda",
          epoch: 1,
          updateId: randomUUID(),
          update: "AAA=",
        },
        b,
      )
    ).statusCode,
    409,
  );
  assert.equal(d.meeting.state, "SCHEDULED");
  assert.equal(
    (await call("POST", route + "/actions/start", {}, b, 1)).statusCode,
    403,
  );
  d = data(
    await call("POST", route + "/actions/start", {}, a, d.meeting.version),
  );
  assert.equal(d.meeting.state, "RUNNING");
  d = data(
    await call(
      "POST",
      route + "/agenda",
      {
        title: "Tensão importante",
        presenterId: member.id,
        durationMinutes: 7,
      },
      b,
      d.meeting.version,
    ),
  );
  const agenda = d.agenda[0];
  d = data(
    await call(
      "POST",
      route + `/agenda/${agenda.id}/actions/skip`,
      {},
      b,
      agenda.version,
    ),
  );
  assert.equal(d.agenda[0].status, "OPEN");
  assert.equal(d.agenda[0].skipped, true);
  // Offline edits from the same durable state converge when delivered in either order.
  const docA = new Y.Doc(),
    docB = new Y.Doc();
  const initial = d.documents.find((x: any) => x.sectionId === "agenda");
  Y.applyUpdate(docA, Buffer.from(initial.snapshot, "base64"));
  Y.applyUpdate(docB, Buffer.from(initial.snapshot, "base64"));
  const ua = update(docA, "A"),
    ub = update(docB, "B"),
    keyA = randomUUID(),
    keyB = randomUUID();
  const payloadA = {
      sectionId: "agenda",
      epoch: 1,
      updateId: keyA,
      update: ua,
    },
    payloadB = { sectionId: "agenda", epoch: 1, updateId: keyB, update: ub };
  const idemA = randomUUID(),
    idemB = randomUUID();
  const [ra, rb] = await Promise.all([
    call(
      "POST",
      route + "/collaboration/updates",
      payloadA,
      a,
      undefined,
      idemA,
    ),
    call(
      "POST",
      route + "/collaboration/updates",
      payloadB,
      b,
      undefined,
      idemB,
    ),
  ]);
  assert.equal(data(ra).durable, true);
  assert.equal(data(rb).durable, true);
  const ack = data(
    await call("POST", route + "/collaboration/updates", payloadA, a),
  );
  assert.equal(ack.sequence, data(ra).sequence);
  assert.equal(
    (
      await call(
        "POST",
        route + "/collaboration/updates",
        { ...payloadA, update: ub },
        a,
      )
    ).statusCode,
    409,
  );
  d = data(await call("GET", route, undefined, a));
  const durable = d.documents.find((x: any) => x.sectionId === "agenda");
  assert.equal(durable.sequence, 2);
  assert.match(content(durable.snapshot), /^(AB|BA)$/);
  // Noter-only restriction is checked for every update and before an idempotent replay.
  d = data(
    await call(
      "POST",
      route + "/actions/notetaker",
      { memberId: A.membership.id, notesOnlyNoter: true },
      a,
      d.meeting.version,
    ),
  );
  assert.equal(
    (await call("POST", route + "/collaboration/updates", payloadB, b))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await call(
        "POST",
        route + "/collaboration/updates",
        payloadB,
        b,
        undefined,
        idemB,
      )
    ).statusCode,
    403,
  );
  d = data(
    await call(
      "POST",
      route + "/actions/work-item",
      {
        title: "Pesquisar decisão",
        assigneeId: member.id,
        agendaId: agenda.id,
      },
      a,
      d.meeting.version,
    ),
  );
  assert.equal(d.actions.length, 1);
  assert.equal(d.agenda[0].status, "OPEN");
  // Close is a barrier and unique across different command keys.
  const closeVersion = d.meeting.version;
  const closes = await Promise.all([
    call("POST", route + "/actions/close", {}, a, closeVersion),
    call("POST", route + "/actions/close", {}, a, closeVersion),
  ]);
  for (const r of closes) assert.equal(r.statusCode, 200, r.body);
  d = data(closes[0]);
  const reportId = d.report.id;
  assert.equal(data(closes[1]).report.id, reportId);
  let history = data(
    await call("GET", route + "/report/versions", undefined, a),
  );
  assert.equal(history.items.length, 1);
  assert.equal(
    history.items[0].snapshot.documents.find(
      (x: any) => x.sectionId === "agenda",
    ).sequence,
    2,
  );
  d = data(
    await call(
      "POST",
      route + "/report/actions/publish",
      {},
      a,
      d.report.version,
    ),
  );
  const first = d.report.firstPublishedAt;
  const uc = update(docA, "C");
  data(
    await call(
      "POST",
      route + "/collaboration/updates",
      { sectionId: "agenda", epoch: 1, updateId: randomUUID(), update: uc },
      a,
    ),
  );
  d = data(
    await call(
      "POST",
      route + "/report/actions/publish",
      {},
      a,
      d.report.version,
    ),
  );
  assert.equal(d.report.firstPublishedAt, first);
  d = data(
    await call(
      "POST",
      route + "/report/actions/restore",
      { restoreVersion: 1, reason: "Restaurar fechamento original" },
      a,
      d.report.version,
    ),
  );
  assert.equal(d.report.epoch, 2);
  assert.equal(d.documents[0].epoch, 2);
  assert.equal(
    (await call("POST", route + "/collaboration/updates", payloadA, a))
      .statusCode,
    409,
  );
  assert.equal(
    (
      await call(
        "POST",
        route + "/collaboration/updates",
        payloadA,
        a,
        undefined,
        idemA,
      )
    ).statusCode,
    409,
  );
  history = data(await call("GET", route + "/report/versions", undefined, a));
  assert.equal(history.items.length, 4);
  assert.equal(history.items[0].version, 4);
  assert.equal(history.items[0].epoch, 2);
  // Window expiry enforced by server clock, even owner. Restore is explicit grant and epoch.
  await transaction(async (c) => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
      A.organization.id,
    ]);
    await c.query(
      `UPDATE meeting_reports SET first_published_at=clock_timestamp()-interval '8 days' WHERE organization_id=$1 AND id=$2`,
      [A.organization.id, reportId],
    );
  });
  assert.equal(
    (
      await call(
        "POST",
        route + "/collaboration/updates",
        { ...payloadA, epoch: 2, updateId: randomUUID() },
        a,
      )
    ).statusCode,
    403,
  );
  d = data(
    await call(
      "POST",
      route + "/report/actions/reopen",
      { reason: "Correção autorizada fora da janela" },
      a,
      d.report.version,
    ),
  );
  assert.equal(d.report.windowDays, 0);
  assert.equal(d.report.epoch, 3);
  // Platform search and per-report override never grant private access via owner/admin status.
  assert.equal(
    data(
      await call(
        "GET",
        p + `/test-meeting-resource/report/${reportId}/read`,
        undefined,
        b,
      ),
    ).allowed,
    true,
  );
  data(
    await call(
      "POST",
      route + "/report/actions/access",
      { memberId: member.id, canRead: true, canEdit: false },
      a,
      d.report.version,
    ),
  );
  assert.equal(
    data(
      await call(
        "GET",
        p + `/test-meeting-resource/report/${reportId}/attach`,
        undefined,
        b,
      ),
    ).allowed,
    false,
  );
  d = data(await call("GET", route, undefined, a));
  data(
    await call(
      "POST",
      route + "/report/actions/access",
      { memberId: member.id, canRead: false, canEdit: false },
      a,
      d.report.version,
    ),
  );
  const hidden = data(
    await call(
      "GET",
      p + `/test-meeting-resource/report/${reportId}/read`,
      undefined,
      b,
    ),
  );
  assert.equal(hidden.allowed, false);
  assert.equal(
    hidden.search.some((x: any) => x.id === reportId),
    false,
  );
  assert.equal((await call("GET", route, undefined, b)).statusCode, 404);
  d = data(await call("GET", route, undefined, a));
  // Closed placement is immutable history. LF06 schedules the same intention into a new placement.
  const next = created.occurrenceIds[1];
  assert.equal(
    (
      await call(
        "POST",
        route + `/agenda/${agenda.id}/actions/transfer`,
        { targetMeetingId: next },
        a,
        d.agenda[0].version,
      )
    ).statusCode,
    409,
  );
  const intention = data(
    await call(
      "GET",
      p + "/meeting-agenda-items/" + d.agenda[0].agendaItemId,
      undefined,
      b,
    ),
  );
  assert.equal(intention.item.state, "NEEDS_RESCHEDULE");
  const targetBefore = data(
    await call("GET", p + "/meetings/" + next, undefined, a),
  );
  data(
    await call(
      "POST",
      p + `/meeting-agenda-items/${intention.item.id}/actions/schedule`,
      {
        targetMeetingId: next,
        expectedTargetVersion: targetBefore.meeting.version,
      },
      b,
      intention.item.version,
    ),
  );
  d = data(await call("GET", route, undefined, a));
  assert.equal(d.agenda[0].status, "OPEN");
  const n = data(await call("GET", p + "/meetings/" + next, undefined, a));
  assert.equal(n.agenda[0].transferredFrom, agenda.id);
  assert.equal(n.agenda[0].agendaItemId, intention.item.id);
  // A current owner without a participant grant cannot read the private occurrence.
  let nn = data(
    await call(
      "POST",
      p + "/meetings/" + next + "/actions/participants",
      {
        participants: [
          { memberId: member.id, access: "EDIT", canManage: true },
        ],
      },
      a,
      n.meeting.version,
    ),
  );
  nn = data(
    await call(
      "POST",
      p + "/meetings/" + next + "/actions/participants",
      { participants: [{ memberId: A.membership.id, access: "DENY" }] },
      b,
      nn.meeting.version,
    ),
  );
  assert.equal(
    (await call("GET", p + "/meetings/" + next, undefined, a)).statusCode,
    404,
  );
  // RLS hides all meetings without context.
  await transaction(async (c) =>
    assert.equal(
      (await c.query("SELECT * FROM meeting_occurrences")).rowCount,
      0,
    ),
  );
  docA.destroy();
  docB.destroy();
});
test("recurrence edit scopes preserve performed identity and split FUTURE", async () => {
  const u = await user(),
    A = data(await call("POST", "/organizations", { name: "Séries" }, u)),
    p = "/organizations/" + A.organization.id;
  const c = data(
      await call(
        "POST",
        p + "/meeting-series",
        {
          title: "Série",
          circleId: A.rootCircle.id,
          localStart: "2031-03-01T10:00",
          timeZone: "UTC",
          durationMinutes: 60,
          recurrence: { frequency: "WEEKLY", count: 4 },
          sections: [{ id: "agenda", title: "Agenda", kind: "AGENDA" }],
          policy: {},
        },
        u,
      ),
      201,
    ),
    ids = c.occurrenceIds;
  let first = data(await call("GET", p + "/meetings/" + ids[0], undefined, u));
  first = data(
    await call(
      "POST",
      p + "/meetings/" + ids[0] + "/actions/start",
      {},
      u,
      first.meeting.version,
    ),
  );
  first = data(
    await call(
      "POST",
      p + "/meetings/" + ids[0] + "/actions/close",
      {},
      u,
      first.meeting.version,
    ),
  );
  let second = data(await call("GET", p + "/meetings/" + ids[1], undefined, u));
  const thisResult = data(
    await call(
      "POST",
      p + "/meetings/" + ids[1] + "/actions/reschedule",
      { scope: "THIS", title: "Exceção", localStart: "2031-03-09T11:00" },
      u,
      second.meeting.version,
    ),
  );
  assert.equal(thisResult.changed.length, 1);
  assert.equal(thisResult.meeting.id, ids[1]);
  second = data(await call("GET", p + "/meetings/" + ids[1], undefined, u));
  const all = data(
    await call(
      "POST",
      p + "/meetings/" + ids[1] + "/actions/reschedule",
      { scope: "ALL", title: "Alterada", localStart: "2031-03-01T12:00" },
      u,
      second.meeting.version,
    ),
  );
  assert.deepEqual(all.preserved, [ids[0]]);
  assert.equal(
    data(await call("GET", p + "/meetings/" + ids[0], undefined, u)).meeting
      .title,
    "Série",
  );
  second = data(await call("GET", p + "/meetings/" + ids[2], undefined, u));
  const future = data(
    await call(
      "POST",
      p + "/meetings/" + ids[2] + "/actions/reschedule",
      { scope: "FUTURE", title: "Nova série", localStart: "2031-03-17T14:00" },
      u,
      second.meeting.version,
    ),
  );
  assert.notEqual(future.seriesId, c.series.id);
  assert.equal(future.changed.length, 2);
  assert.equal(future.meeting.sequence, 3);
});
test("startNow creates the first occurrence already running", async () => {
  const u = await user(),
    A = data(
      await call("POST", "/organizations", { name: "Instantâneas" }, u),
    ),
    p = "/organizations/" + A.organization.id;
  const created = data(
      await call(
        "POST",
        p + "/meeting-series",
        {
          title: "Reunião instantânea",
          circleId: A.rootCircle.id,
          localStart: "2030-06-01T10:00",
          timeZone: "UTC",
          durationMinutes: 45,
          recurrence: { frequency: "ONCE" },
          sections: [
            { id: "checkin", title: "Check-in", kind: "CHECKIN" },
            { id: "agenda", title: "Agenda", kind: "AGENDA" },
          ],
          startNow: true,
        },
        u,
      ),
      201,
    ),
    route = p + "/meetings/" + created.occurrenceIds[0];
  let d = data(await call("GET", route, undefined, u));
  assert.equal(d.meeting.state, "RUNNING");
  assert.equal(d.meeting.currentStep, "checkin");
  assert.ok(d.meeting.startedAt);
  d = data(
    await call(
      "POST",
      route + "/actions/start",
      {},
      u,
      d.meeting.version,
    ),
  );
  assert.equal(d.meeting.state, "RUNNING");
  assert.equal(
    (
      await call("POST", p + "/meeting-series", {
        title: "Inválida",
        circleId: A.rootCircle.id,
        localStart: "2030-06-01T10:00",
        timeZone: "UTC",
        durationMinutes: 45,
        recurrence: { frequency: "ONCE" },
        sections: [{ id: "agenda", title: "Agenda", kind: "AGENDA" }],
        startNow: "yes",
      }, u)
    ).statusCode,
    400,
  );
});
test("two live websocket clients: synchronization, durable ACK, reconnect and immediate revocation", async () => {
  const a = await user(),
    b = await user(),
    A = data(
      await call("POST", "/organizations", { name: "Coedição ao vivo" }, a),
    ),
    p = "/organizations/" + A.organization.id;
  const member = data(
    await call("POST", p + "/members", { accountId: b.id }, a),
  ).membership;
  const c = data(
      await call(
        "POST",
        p + "/meeting-series",
        {
          title: "Duas pessoas",
          circleId: A.rootCircle.id,
          localStart: "2030-02-01T10:00",
          timeZone: "UTC",
          durationMinutes: 60,
          recurrence: { frequency: "ONCE" },
          sections: [{ id: "notes", title: "Notas", kind: "CUSTOM" }],
          participants: [{ memberId: member.id, access: "EDIT" }],
          policy: {},
        },
        a,
      ),
      201,
    ),
    mid = c.occurrenceIds[0],
    route = p + "/meetings/" + mid;
  let d = data(await call("GET", route, undefined, a));
  d = data(
    await call("POST", route + "/actions/start", {}, a, d.meeting.version),
  );
  const messages = (ws: any) => {
    const queue: any[] = [],
      waiters: { predicate: (x: any) => boolean; resolve: (x: any) => void }[] =
        [];
    ws.on("message", (raw: any) => {
      const m = JSON.parse(raw.toString()),
        i = waiters.findIndex((w) => w.predicate(m));
      if (i >= 0) waiters.splice(i, 1)[0].resolve(m);
      else queue.push(m);
    });
    return (predicate: (x: any) => boolean) =>
      new Promise<any>((resolve, reject) => {
        const i = queue.findIndex(predicate);
        if (i >= 0) return resolve(queue.splice(i, 1)[0]);
        const timer = setTimeout(
          () => reject(Error("WS message timeout: " + JSON.stringify(queue))),
          5000,
        );
        waiters.push({
          predicate,
          resolve: (v) => {
            clearTimeout(timer);
            resolve(v);
          },
        });
      });
  };
  const connect = async (u: User) => {
    const ticket = data(
      await call(
        "POST",
        route + "/collaboration/tickets",
        { sectionId: "notes", epoch: 1 },
        u,
      ),
    );
    const ws = await app.injectWS("/api/v1" + route + "/collaboration/socket", {
      headers: { cookie: u.cookie, origin },
    });
    const next = messages(ws);
    ws.send(JSON.stringify({ type: "hello", ticket: ticket.ticket }));
    await next((m) => m.type === "sync");
    return { ws, next };
  };
  const AClient = await connect(a),
    BClient = await connect(b);
  const doc = new Y.Doc(),
    change = update(doc, "Mensagem ao vivo"),
    updateId = randomUUID();
  AClient.ws.send(
    JSON.stringify({ type: "update", epoch: 1, updateId, update: change }),
  );
  const ack = await AClient.next((m) => m.type === "ack");
  assert.equal(ack.durable, true);
  assert.equal(ack.sequence, 1);
  const synced = await BClient.next(
    (m) => m.type === "sync" && m.document.sequence === 1,
  );
  assert.equal(content(synced.document.snapshot), "Mensagem ao vivo");
  AClient.ws.terminate();
  const reconnect = await connect(a);
  d = data(await call("GET", route, undefined, a));
  assert.equal(content(d.documents[0].snapshot), "Mensagem ao vivo");
  const expectClosed = (ws: any) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("Revoked socket remained open")),
        5000,
      );
      ws.once("close", () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  const closed = expectClosed(BClient.ws);
  d = data(
    await call(
      "POST",
      route + "/actions/participants",
      { participants: [{ memberId: member.id, access: "DENY" }] },
      a,
      d.meeting.version,
    ),
  );
  await closed;
  assert.equal(
    (
      await call(
        "POST",
        route + "/collaboration/updates",
        {
          sectionId: "notes",
          epoch: 1,
          updateId: randomUUID(),
          update: change,
        },
        b,
      )
    ).statusCode,
    404,
  );
  d = data(
    await call(
      "POST",
      route + "/actions/participants",
      { participants: [{ memberId: member.id, access: "EDIT" }] },
      a,
      d.meeting.version,
    ),
  );
  const suspendedClient = await connect(b),
    suspended = expectClosed(suspendedClient.ws);
  data(
    await call(
      "PATCH",
      p + "/members/" + member.id,
      { status: "SUSPENDED" },
      a,
      1,
    ),
  );
  await suspended;
  assert.equal((await call("GET", route, undefined, b)).statusCode, 404);
  const noAck: string[] = [];
  reconnect.ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "ack") noAck.push(m.updateId);
  });
  const disabledClosed = expectClosed(reconnect.ws),
    disabledUpdateId = randomUUID();
  moduleAvailability.set(A.organization.id, false);
  reconnect.ws.send(
    JSON.stringify({
      type: "update",
      epoch: 1,
      updateId: disabledUpdateId,
      update: change,
    }),
  );
  const disabled = await reconnect.next((m) => m.type === "error");
  assert.equal(disabled.code, "MODULE_DISABLED");
  await disabledClosed;
  assert.deepEqual(noAck, []);
  const restoreDisabled = await call(
    "POST",
    route + "/report/actions/restore",
    { restoreVersion: 1, reason: "Module disabled test" },
    a,
    1,
  );
  assert.equal(restoreDisabled.statusCode, 403);
  assert.equal(restoreDisabled.json().error.code, "MODULE_DISABLED");
  moduleAvailability.set(A.organization.id, true);
  assert.equal(
    data(await call("GET", route, undefined, a)).documents[0].sequence,
    1,
  );
  doc.destroy();
});
test("Holacracy agenda guard, participant FUTURE snapshot and scoped cancellation preserve performed occurrences", async () => {
  const a = await user(),
    b = await user(),
    A = data(
      await call("POST", "/organizations", { name: "Escopos do processo" }, a),
    ),
    p = "/organizations/" + A.organization.id,
    member = data(
      await call("POST", p + "/members", { accountId: b.id }, a),
    ).membership;
  const created = data(
      await call(
        "POST",
        p + "/meeting-series",
        {
          title: "Governança",
          circleId: A.rootCircle.id,
          localStart: "2031-04-01T12:00",
          timeZone: "UTC",
          durationMinutes: 60,
          recurrence: { frequency: "WEEKLY", count: 3 },
          sections: [
            { id: "checkin", title: "Check-in", kind: "CHECKIN" },
            { id: "agenda", title: "Agenda", kind: "AGENDA" },
          ],
          method: "HOLACRACY",
          participants: [{ memberId: member.id, access: "EDIT" }],
          policy: {},
        },
        a,
      ),
      201,
    ),
    [one, two, three] = created.occurrenceIds;
  let d = data(
    await call("POST", p + "/meetings/" + one + "/actions/start", {}, a, 1),
  );
  d = data(
    await call(
      "POST",
      p + "/meetings/" + one + "/agenda",
      { title: "Processar tensão" },
      a,
      d.meeting.version,
    ),
  );
  const item = d.agenda[0];
  assert.equal(
    (
      await call(
        "POST",
        p + `/meetings/${one}/agenda/${item.id}/actions/complete`,
        {},
        a,
        item.version,
      )
    ).statusCode,
    409,
  );
  d = data(
    await call(
      "POST",
      p + "/meetings/" + one + "/actions/step",
      { sectionId: "agenda" },
      a,
      d.meeting.version,
    ),
  );
  d = data(
    await call(
      "POST",
      p + `/meetings/${one}/agenda/${item.id}/actions/skip`,
      {},
      a,
      item.version,
    ),
  );
  d = data(
    await call(
      "POST",
      p + "/meetings/" + one + "/actions/close",
      {},
      a,
      d.meeting.version,
    ),
  );
  const second = data(await call("GET", p + "/meetings/" + two, undefined, a));
  data(
    await call(
      "POST",
      p + "/meetings/" + two + "/actions/participants",
      {
        scope: "FUTURE",
        participants: [
          {
            memberId: member.id,
            access: "READ",
            participationRole: "OPTIONAL",
          },
        ],
      },
      a,
      second.meeting.version,
    ),
  );
  const preserved = data(
    await call("GET", p + "/meetings/" + one, undefined, a),
  );
  assert.equal(
    preserved.participants.find((x: any) => x.memberId === member.id).access,
    "EDIT",
  );
  const future = data(
    await call("GET", p + "/meetings/" + three, undefined, a),
  );
  assert.equal(
    future.participants.find((x: any) => x.memberId === member.id)
      .participationRole,
    "OPTIONAL",
  );
  assert.equal(
    future.participants.find((x: any) => x.memberId === member.id).access,
    "READ",
  );
  const cancelled = data(
    await call(
      "POST",
      p + "/meetings/" + three + "/actions/cancel",
      { scope: "ALL", reason: "Reorganizar o calendário" },
      a,
      future.meeting.version,
    ),
  );
  assert.equal(cancelled.cancelled.length, 2);
  assert.equal(
    data(await call("GET", p + "/meetings/" + one, undefined, a)).meeting.state,
    "CLOSED",
  );
  const events = data(
    await call("GET", p + "/test-meeting-calendar", undefined, a),
  );
  assert.equal(events.filter((x: any) => x.cancelled).length, 2);
  assert.equal(
    events.find((x: any) => x.uid === one + "@orgmap").cancelled,
    false,
  );
});
test("out-of-order CRDT persists pending structs; failed close rolls back snapshot, event and idempotency", async () => {
  const u = await user(),
    A = data(
      await call("POST", "/organizations", { name: "Barreira atômica" }, u),
    ),
    p = "/organizations/" + A.organization.id;
  const template = data(
    await call(
      "POST",
      p + "/meeting-templates",
      {
        name: "Processo v1",
        method: "CUSTOM",
        sections: [{ id: "notes", title: "Notas originais", kind: "CUSTOM" }],
      },
      u,
    ),
    201,
  ).template;
  const created = data(
      await call(
        "POST",
        p + "/meeting-series",
        {
          title: "Snapshot atômico",
          circleId: A.rootCircle.id,
          localStart: "2030-02-01T12:00",
          timeZone: "UTC",
          durationMinutes: 60,
          recurrence: { frequency: "ONCE" },
          templateId: template.id,
          policy: {},
        },
        u,
      ),
      201,
    ),
    mid = created.occurrenceIds[0],
    route = p + "/meetings/" + mid;
  data(
    await call(
      "POST",
      p + `/meeting-templates/${template.id}/actions/revise`,
      {
        name: "Processo v2",
        method: "CUSTOM",
        sections: [{ id: "different", title: "Outra etapa", kind: "AGENDA" }],
      },
      u,
      template.version,
    ),
  );
  let d = data(await call("GET", route, undefined, u));
  assert.equal(d.meeting.sections[0].title, "Notas originais");
  d = data(
    await call("POST", route + "/actions/start", {}, u, d.meeting.version),
  );
  const doc = new Y.Doc(),
    one = update(doc, "1"),
    two = update(doc, "2");
  data(
    await call(
      "POST",
      route + "/collaboration/updates",
      { sectionId: "notes", epoch: 1, updateId: randomUUID(), update: two },
      u,
    ),
  );
  data(
    await call(
      "POST",
      route + "/collaboration/updates",
      { sectionId: "notes", epoch: 1, updateId: randomUUID(), update: one },
      u,
    ),
  );
  d = data(await call("GET", route, undefined, u));
  assert.equal(content(d.documents[0].snapshot), "21");
  assert.equal(d.documents[0].sequence, 2);
  const calendar = data(
    await call("GET", p + "/test-meeting-calendar", undefined, u),
  );
  assert.equal(calendar.length, 1);
  assert.equal(calendar[0].uid, mid + "@orgmap");
  assert.equal(
    new Date(calendar[0].ends_at).getTime() -
      new Date(calendar[0].starts_at).getTime(),
    3600000,
  );
  const admin = new pg.Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const counts = () =>
    transaction(async (c) => {
      await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
        A.organization.id,
      ]);
      return (
        await c.query(
          "SELECT (SELECT count(*) FROM meeting_reports) AS reports,(SELECT count(*) FROM audit_events) AS audit,(SELECT count(*) FROM command_results) AS commands",
        )
      ).rows[0];
    });
  const before = await counts(),
    closeKey = randomUUID();
  try {
    await admin.query(
      `CREATE FUNCTION meetings_inject_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.organization_id='${A.organization.id}'::uuid THEN RAISE EXCEPTION 'test-only report failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER meetings_fail_snapshot BEFORE INSERT ON meeting_report_versions FOR EACH ROW EXECUTE FUNCTION meetings_inject_failure()`,
    );
    const failed = await call(
      "POST",
      route + "/actions/close",
      {},
      u,
      d.meeting.version,
      closeKey,
    );
    assert.equal(failed.statusCode, 500);
    assert.deepEqual(await counts(), before);
    assert.equal(
      data(await call("GET", route, undefined, u)).meeting.state,
      "RUNNING",
    );
  } finally {
    await admin.query(
      "DROP TRIGGER IF EXISTS meetings_fail_snapshot ON meeting_report_versions; DROP FUNCTION IF EXISTS meetings_inject_failure()",
    );
    await admin.end();
  }
  d = data(
    await call(
      "POST",
      route + "/actions/close",
      {},
      u,
      d.meeting.version,
      closeKey,
    ),
  );
  assert.equal(d.meeting.state, "CLOSED");
  assert.equal(d.report.version, 1);
  const versions = data(
    await call("GET", route + "/report/versions", undefined, u),
  );
  assert.equal(versions.items[0].snapshot.documents[0].sequence, 2);
  doc.destroy();
});
test("secretaries cancel a single occurrence and managers delete scheduled occurrences by scope", async () => {
  const a = await user(),
    b = await user(),
    A = data(
      await call("POST", "/organizations", { name: "Limpeza" }, a),
    ),
    p = "/organizations/" + A.organization.id,
    member = data(
      await call("POST", p + "/members", { accountId: b.id }, a),
    ).membership;
  const created = data(
      await call(
        "POST",
        p + "/meeting-series",
        {
          title: "Recorrente",
          circleId: A.rootCircle.id,
          localStart: "2031-05-04T10:00",
          timeZone: "UTC",
          durationMinutes: 30,
          recurrence: { frequency: "WEEKLY", count: 3 },
          sections: [{ id: "notes", title: "Notas", kind: "CUSTOM" }],
          method: "HOLACRACY",
          participants: [{ memberId: member.id, access: "EDIT" }],
          policy: {},
        },
        a,
      ),
      201,
    ),
    [one, two, three] = created.occurrenceIds;
  let d = data(await call("GET", p + "/meetings/" + one, undefined, a));
  data(
    await call(
      "POST",
      p + "/meetings/" + one + "/actions/notetaker",
      { memberId: member.id },
      a,
      d.meeting.version,
    ),
  );
  const asEditor = data(
    await call("GET", p + "/meetings/" + one, undefined, b),
  );
  assert.equal(
    (
      await call(
        "POST",
        p + "/meetings/" + one + "/actions/delete",
        { scope: "THIS" },
        b,
        asEditor.meeting.version,
      )
    ).statusCode,
    403,
  );
  const cancelled = data(
    await call(
      "POST",
      p + "/meetings/" + one + "/actions/cancel",
      { scope: "THIS", reason: "adiada" },
      b,
      asEditor.meeting.version,
    ),
  );
  assert.deepEqual(cancelled.cancelled, [one]);
  d = data(await call("GET", p + "/meetings/" + two, undefined, a));
  const deleted = data(
    await call(
      "POST",
      p + "/meetings/" + two + "/actions/delete",
      { scope: "THIS" },
      a,
      d.meeting.version,
    ),
  );
  assert.deepEqual(deleted.deleted, [two]);
  assert.equal(
    (await call("GET", p + "/meetings/" + two, undefined, a)).statusCode,
    404,
  );
  d = data(await call("GET", p + "/meetings/" + three, undefined, a));
  data(
    await call(
      "POST",
      p + "/meetings/" + three + "/actions/participants",
      {
        participants: [
          { memberId: member.id, access: "EDIT", canManage: true },
        ],
      },
      a,
      d.meeting.version,
    ),
  );
  const scoped = data(
    await call("GET", p + "/meetings/" + three, undefined, b),
  );
  const remainder = data(
    await call(
      "POST",
      p + "/meetings/" + three + "/actions/delete",
      { scope: "ALL" },
      b,
      scoped.meeting.version,
    ),
  );
  assert.deepEqual(remainder.deleted, [three]);
  const counts = await transaction(async (c) => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
      A.organization.id,
    ]);
    return (
      await c.query(
        "SELECT (SELECT count(*)::int FROM meeting_occurrences) AS occurrences,(SELECT count(*)::int FROM meeting_series) AS series,(SELECT count(*)::int FROM meeting_documents) AS documents,(SELECT count(*)::int FROM meeting_participants) AS participants",
      )
    ).rows[0];
  });
  assert.deepEqual(counts, {
    occurrences: 1,
    series: 1,
    documents: 1,
    participants: 2,
  });
  const single = data(
    await call(
      "POST",
      p + "/meeting-series",
      {
        title: "Avulsa",
        circleId: A.rootCircle.id,
        localStart: "2031-06-01T09:00",
        timeZone: "UTC",
        durationMinutes: 15,
        recurrence: { frequency: "ONCE" },
        sections: [{ id: "notes", title: "Notas", kind: "CUSTOM" }],
        method: "CUSTOM",
        participants: [],
        policy: {},
      },
      a,
    ),
    201,
  );
  d = data(
    await call("GET", p + "/meetings/" + single.occurrenceIds[0], undefined, a),
  );
  data(
    await call(
      "POST",
      p + "/meetings/" + single.occurrenceIds[0] + "/actions/delete",
      { scope: "THIS" },
      a,
      d.meeting.version,
    ),
  );
  const after = await transaction(async (c) => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
      A.organization.id,
    ]);
    return (
      await c.query(
        "SELECT (SELECT count(*)::int FROM meeting_occurrences) AS occurrences,(SELECT count(*)::int FROM meeting_series) AS series",
      )
    ).rows[0];
  });
  assert.deepEqual(after, { occurrences: 1, series: 1 });
  const custom = data(
      await call(
        "POST",
        p + "/meeting-series",
        {
          title: "Custom com escriba",
          circleId: A.rootCircle.id,
          localStart: "2031-06-02T09:00",
          timeZone: "UTC",
          durationMinutes: 15,
          recurrence: { frequency: "ONCE" },
          sections: [{ id: "notes", title: "Notas", kind: "CUSTOM" }],
          method: "CUSTOM",
          participants: [{ memberId: member.id, access: "EDIT" }],
          policy: {},
        },
        a,
      ),
      201,
    ),
    cEp = p + "/meetings/" + custom.occurrenceIds[0];
  d = data(await call("GET", cEp, undefined, a));
  data(
    await call(
      "POST",
      cEp + "/actions/notetaker",
      { memberId: member.id },
      a,
      d.meeting.version,
    ),
  );
  d = data(await call("GET", cEp, undefined, b));
  assert.equal(d.capabilities.secretaryOperation, true);
  d = data(
    await call("POST", cEp + "/actions/start", {}, b, d.meeting.version),
  );
  assert.equal(d.meeting.state, "RUNNING");
  d = data(
    await call("POST", cEp + "/actions/close", {}, b, d.meeting.version),
  );
  assert.equal(d.meeting.state, "CLOSED");
});
