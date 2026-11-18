import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { buildApp } from "../../server/src/app.js";
import { pool } from "../../server/src/db.js";
import { foundationDefaultAdmissionPolicy } from "../../server/src/admission.js";
import { createMeetings } from "../../server/modules/meetings/plugin.js";
import { createMeetingRuntimePorts } from "../../server/modules/meetings/guest.js";
import {
  createMeetingStatisticsPort,
  registerMeetingStatistics,
} from "../../server/modules/meetings/statistics.js";
import type { MeetingStatistics } from "../../server/modules/meetings/statistics-contract.js";
if (
  !/^\/orgmap_meetings_test_[a-f0-9]+$/.test(
    new URL(process.env.DATABASE_URL!).pathname,
  )
)
  throw Error("Exclusive meetings DB required");
const admin = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
const disabled = new Set<string>(),
  supervised = new Set<string>();
const app = await buildApp([
  foundationDefaultAdmissionPolicy,
  async (app, core) => {
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
        modules: { structure: true, meetings: !disabled.has(ctx.org.id) },
      },
    }));
    const ports = createMeetingRuntimePorts(core, {
      readPolicy: {
        oversight: async (ctx, action) =>
          action === "readMeeting" && supervised.has(ctx.org.id),
      },
      validateMembers: async (ctx, ids) =>
        (
          await ctx.c.query(
            "SELECT id FROM members WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND status='ACTIVE'",
            [ctx.org.id, ids],
          )
        ).rowCount === new Set(ids).size,
    });
    await createMeetings(ports)(app, core);
    // This standalone test owns its binding, and also works once root installs the same binding.
    if (
      !app.hasRoute({
        method: "GET",
        url: "/api/v1/organizations/:organizationId/meetings/statistics",
      })
    )
      registerMeetingStatistics(app, core, ports.readPolicy);
    const statistics = createMeetingStatisticsPort(core, ports.readPolicy);
    app.get(
      "/api/v1/organizations/:organizationId/test-statistics-same-clock",
      (r) =>
        core.tenant(r, { mode: "read" }, async (ctx) => ({
          a: await statistics.computeSelection(ctx, { month: "2024-02" }),
          b: await statistics.computeSelection(ctx, { month: "2024-03" }),
        })),
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
  user?: User,
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
      ...(user ? { cookie: user.cookie, "x-csrf-token": user.csrf } : {}),
      ...(version ? { "if-match": `"${version}"` } : {}),
    },
  });
}
function data(response: any, status = 200): any {
  assert.equal(response.statusCode, status, response.body);
  return response.json().data;
}
async function user(): Promise<User> {
  const r = await call("POST", "/auth/register", {
    email: randomUUID() + "@example.test",
    password: "statistics-synthetic-password-123",
    displayName: "Synthetic statistics",
  });
  const d = data(r, 201);
  return {
    cookie: r.cookies[0].name + "=" + r.cookies[0].value,
    csrf: d.csrfToken,
    id: d.account.id,
  };
}
async function organization(zone = "UTC") {
  const owner = await user(),
    o = data(
      await call(
        "POST",
        "/organizations",
        { name: "Synthetic statistics", timeZone: zone },
        owner,
      ),
      201,
    );
  return { ...o, owner, base: "/organizations/" + o.organization.id };
}
async function historicalCoverage(org: string, from = "2020-01-01T00:00:00Z") {
  // Explicit synthetic retained-observation fixture; production migration never backfills this.
  await admin.query(
    "ALTER TABLE meeting_statistics_observation DISABLE TRIGGER meeting_statistics_observation_immutable",
  );
  try {
    await admin.query(
      "UPDATE meeting_statistics_observation SET covered_from=$2 WHERE organization_id=$1",
      [org, from],
    );
  } finally {
    await admin.query(
      "ALTER TABLE meeting_statistics_observation ENABLE TRIGGER meeting_statistics_observation_immutable",
    );
  }
}
async function meeting(
  o: any,
  start = "2024-02-10T12:00:00Z",
  participants: any[] = [],
) {
  return data(
    await call(
      "POST",
      o.base + "/meeting-series",
      {
        title: "Synthetic meeting",
        circleId: o.rootCircle.id,
        localStart: start.replace(/\.\d{3}Z$/, "Z").replace(/Z$/, ""),
        timeZone: "UTC",
        durationMinutes: 60,
        recurrence: { frequency: "ONCE" },
        sections: [{ id: "agenda", kind: "AGENDA", title: "Agenda" }],
        participants,
        policy: { windowDays: 7, notesOnlyNoter: false },
      },
      o.owner,
    ),
    201,
  ).occurrenceIds[0] as string;
}
async function detail(o: any, mid: string) {
  return data(
    await call("GET", o.base + "/meetings/" + mid, undefined, o.owner),
  );
}
async function start(o: any, mid: string) {
  const d = await detail(o, mid);
  return data(
    await call(
      "POST",
      o.base + "/meetings/" + mid + "/actions/start",
      {},
      o.owner,
      d.meeting.version,
    ),
  );
}
async function close(o: any, mid: string, key = randomUUID()) {
  const d = await detail(o, mid);
  return {
    result: data(
      await call(
        "POST",
        o.base + "/meetings/" + mid + "/actions/close",
        {},
        o.owner,
        d.meeting.version,
        key,
      ),
    ),
    version: d.meeting.version,
    key,
  };
}
async function stats(
  o: any,
  month = "2024-02",
  user = o.owner,
): Promise<MeetingStatistics> {
  return data(
    await call(
      "GET",
      o.base + "/meetings/statistics?month=" + month,
      undefined,
      user,
    ),
  );
}
async function addMember(o: any, u: User, type = "MEMBER", plan?: any[]) {
  return data(
    await call(
      "POST",
      o.base + "/members",
      {
        accountId: u.id,
        ...(type === "GUEST"
          ? { memberType: type, accessPlan: plan ?? [] }
          : {}),
      },
      o.owner,
    ),
    201,
  ).membership;
}

test("MS01/MS03: native formulas, historical roster, weighted denominators and raw seconds", async () => {
  const o = await organization();
  await historicalCoverage(o.organization.id);
  const absentUser = await user(),
    invitedUser = await user(),
    deniedUser = await user();
  const absent = await addMember(o, absentUser),
    invited = await addMember(o, invitedUser),
    denied = await addMember(o, deniedUser);
  const first = await meeting(o, undefined, [
    { memberId: absent.id, access: "READ" },
    { memberId: invited.id, access: "READ" },
    { memberId: denied.id, access: "DENY" },
  ]);
  await start(o, first);
  await admin.query(
    "UPDATE meeting_occurrences SET started_at=clock_timestamp()-interval '600.123456 seconds' WHERE organization_id=$1 AND id=$2",
    [o.organization.id, first],
  );
  await admin.query(
    "UPDATE meeting_participants SET attendance=CASE WHEN member_id=$3 THEN 'ABSENT' WHEN member_id=$4 THEN 'INVITED' ELSE 'PRESENT' END WHERE organization_id=$1 AND meeting_id=$2",
    [o.organization.id, first, absent.id, invited.id],
  );
  for (const [status, skipped] of [
    ["COMPLETED", false],
    ["OPEN", false],
    ["TRANSFERRED", false],
    ["OPEN", true],
    ["WITHDRAWN", false],
  ]) {
    const itemId = randomUUID();
    await admin.query(
      `INSERT INTO meeting_agenda_items(organization_id,id,title,description_rich,state,source_kind,identity_coverage,creator_coverage)
       VALUES($1,$2,'Synthetic agenda','{"format":"orgmap-richtext","version":1,"doc":{"type":"doc","content":[{"type":"paragraph"}]}}','ASSIGNED','MANUAL','NATIVE','KNOWN')`,
      [o.organization.id, itemId],
    );
    await admin.query(
      "INSERT INTO meeting_agenda(organization_id,id,meeting_id,title,presenter_id,duration_minutes,status,skipped,agenda_item_id) VALUES($1,$2,$3,'Synthetic agenda',$4,1,$5,$6,$7)",
      [
        o.organization.id,
        randomUUID(),
        first,
        o.membership.id,
        status,
        skipped,
        itemId,
      ],
    );
  }
  for (const state of ["DONE", "OPEN"])
    await admin.query(
      "INSERT INTO meeting_actions(organization_id,id,meeting_id,title,assignee_id,state) VALUES($1,$2,$3,'Synthetic action',$4,$5)",
      [o.organization.id, randomUUID(), first, o.membership.id, state],
    );
  await close(o, first);
  const second = await meeting(o);
  await start(o, second);
  await admin.query(
    "UPDATE meeting_occurrences SET started_at=NULL WHERE organization_id=$1 AND id=$2",
    [o.organization.id, second],
  );
  await admin.query(
    "UPDATE meeting_participants SET attendance='PRESENT' WHERE organization_id=$1 AND meeting_id=$2",
    [o.organization.id, second],
  );
  await close(o, second);
  const legacy = await meeting(o);
  await admin.query(
    "UPDATE meeting_occurrences SET state='CLOSED',closed_at=clock_timestamp() WHERE organization_id=$1 AND id=$2",
    [o.organization.id, legacy],
  );
  await meeting(o);
  const running = await meeting(o);
  await start(o, running);
  const cancelled = await meeting(o);
  const cd = await detail(o, cancelled);
  data(
    await call(
      "POST",
      o.base + "/meetings/" + cancelled + "/actions/cancel",
      { scope: "THIS", reason: "Synthetic" },
      o.owner,
      cd.meeting.version,
    ),
  );
  await admin.query(
    "UPDATE members SET status='SUSPENDED' WHERE organization_id=$1 AND id=$2",
    [o.organization.id, absent.id],
  );
  const s = await stats(o),
    raw = Number(
      (
        await admin.query(
          "SELECT extract(epoch FROM(first_closed_at-started_at)) AS seconds FROM meeting_first_close_snapshots WHERE organization_id=$1 AND meeting_id=$2",
          [o.organization.id, first],
        )
      ).rows[0].seconds,
    );
  assert.deepEqual(s.counts, {
    observed: 6,
    realized: 3,
    running: 1,
    cancelled: 1,
  });
  assert.equal(s.metrics.totalDuration.value, raw);
  assert.equal(s.metrics.totalDuration.numerator, raw);
  assert.equal(s.metrics.totalDuration.unit, "SECONDS");
  assert.equal(s.metrics.averageDuration.value, raw);
  assert.equal(s.metrics.averageDuration.denominator, 1);
  assert.equal(s.metrics.averageDuration.eligible, 3);
  assert.equal(s.metrics.averageParticipants.numerator, 2);
  assert.equal(s.metrics.averageParticipants.denominator, 2);
  assert.equal(s.metrics.averageParticipants.value, 1);
  assert.equal(s.metrics.attendanceRate.numerator, 2);
  assert.equal(s.metrics.attendanceRate.denominator, 4);
  assert.equal(s.metrics.attendanceRate.value, 0.5);
  assert.equal(s.metrics.actionCompletionRate.numerator, 1);
  assert.equal(s.metrics.actionCompletionRate.denominator, 2);
  assert.equal(s.metrics.actionCompletionRate.value, 0.5);
  assert.equal(s.metrics.agendaCompletionRate.numerator, 1);
  assert.equal(s.metrics.agendaCompletionRate.denominator, 4);
  assert.equal(s.metrics.agendaCompletionRate.value, 0.25);
  assert.equal(s.metrics.activeOrganizers.value, 1);
  assert.equal(s.coverage.snapshotKnown, 2);
  assert.equal(s.coverage.snapshotMissing, 1);
  assert.equal(s.coverage.durationMissing, 2);
  assert.equal(s.coverage.state, "PARTIAL");
  assert.ok(!JSON.stringify(s).includes(absent.id));
  assert.equal(
    s.distributions.state.reduce((sum, g) => sum + g.count, 0),
    6,
  );
  assert.equal(s.distributions.template[0].label, "UNKNOWN");
});

test("MS02: civil IANA boundaries, leap month, DST and a single PostgreSQL selection clock", async () => {
  for (const [zone, startAt, endAt] of [
    ["Pacific/Kiritimati", "2024-01-31T10:00:00Z", "2024-02-29T10:00:00Z"],
    ["America/New_York", "2024-02-01T05:00:00Z", "2024-03-01T05:00:00Z"],
  ]) {
    const o = await organization(zone);
    await historicalCoverage(o.organization.id);
    for (const t of [
      new Date(Date.parse(startAt) - 1000).toISOString(),
      startAt,
      new Date(Date.parse(endAt) - 1000).toISOString(),
      endAt,
    ])
      await meeting(o, t);
    const s = await stats(o);
    assert.equal(s.counts.observed, 2);
    assert.equal(s.period.start, new Date(startAt).toISOString());
    assert.equal(s.period.end, new Date(endAt).toISOString());
    assert.equal(s.period.timezone, zone);
    const same = data(
      await call(
        "GET",
        o.base + "/test-statistics-same-clock",
        undefined,
        o.owner,
      ),
    );
    assert.equal(same.a.statistics.period.asOf, same.b.statistics.period.asOf);
    assert.equal(
      same.a.statistics.period.timezone,
      same.b.statistics.period.timezone,
    );
    assert.equal(same.a.authorizedMeetingIds.length, 2);
    assert.equal(same.b.authorizedMeetingIds.length, 1);
    if (zone === "America/New_York") {
      assert.equal(same.b.statistics.period.start, "2024-03-01T05:00:00.000Z");
      assert.equal(same.b.statistics.period.end, "2024-04-01T04:00:00.000Z");
    }
  }
});

test("MS04: real baseline, unknown legacy, empty observed zero and JSON null roundtrip", async () => {
  const o = await organization();
  const baseline = (
    await admin.query(
      "SELECT covered_from FROM meeting_statistics_observation WHERE organization_id=$1",
      [o.organization.id],
    )
  ).rows[0];
  assert.ok(baseline);
  assert.equal(
    (
      await admin.query(
        "SELECT count(*) FROM meeting_first_close_snapshots WHERE organization_id=$1",
        [o.organization.id],
      )
    ).rows[0].count,
    "0",
  );
  const empty = await stats(o);
  assert.equal(empty.coverage.state, "UNAVAILABLE");
  assert.equal(empty.counts.observed, null);
  assert.equal(empty.metrics.totalDuration.value, null);
  assert.equal(empty.metrics.attendanceRate.value, null);
  assert.equal(
    JSON.parse(JSON.stringify(empty)).metrics.attendanceRate.value,
    null,
  );
  assert.equal(empty.coverage.estimated, false);
  const legacy = await meeting(o);
  await admin.query(
    "UPDATE meeting_occurrences SET state='CLOSED' WHERE organization_id=$1 AND id=$2",
    [o.organization.id, legacy],
  );
  const partial = await stats(o);
  assert.equal(partial.counts.observed, 1);
  assert.equal(partial.counts.realized, null);
  assert.equal(partial.coverage.state, "PARTIAL");
  assert.equal(partial.coverage.snapshotMissing, 1);
  assert.equal(partial.metrics.totalDuration.value, null);
  await historicalCoverage(o.organization.id);
  const observed = await stats(o, "2024-01");
  assert.equal(observed.coverage.state, "OBSERVED");
  assert.equal(observed.counts.observed, 0);
  assert.equal(observed.metrics.totalDuration.value, 0);
  assert.equal(observed.metrics.averageDuration.value, null);
  assert.equal(observed.metrics.attendanceRate.value, null);
  const current = data(
    await call("GET", o.base + "/meetings/statistics", undefined, o.owner),
  );
  assert.equal(current.period.end, current.period.asOf);
  assert.equal(current.period.timezone, "UTC");
  for (const query of [
    "month=2024-13",
    "month=2100-01",
    "month=2024-02&leak=true",
    "month[]=2024-02",
  ])
    assert.equal(
      (
        await call(
          "GET",
          o.base + "/meetings/statistics?" + query,
          undefined,
          o.owner,
        )
      ).statusCode,
      400,
    );
});

test("MS05: current tenant/ACL/Guest/module boundaries and no hidden metadata", async () => {
  const o = await organization(),
    foreign = await organization();
  await historicalCoverage(o.organization.id);
  const allowed = await meeting(o),
    hidden = await meeting(o),
    reportDenied = await meeting(o);
  await start(o, reportDenied);
  await close(o, reportDenied);
  await admin.query(
    "DELETE FROM meeting_participants WHERE organization_id=$1 AND meeting_id=$2 AND member_id=$3",
    [o.organization.id, hidden, o.membership.id],
  );
  const report = (await detail(o, reportDenied)).report;
  await admin.query(
    "INSERT INTO meeting_report_access(organization_id,report_id,member_id,can_read,can_edit) VALUES($1,$2,$3,false,false)",
    [o.organization.id, report.id, o.membership.id],
  );
  assert.equal((await stats(o)).counts.observed, 1);
  await meeting(foreign);
  assert.equal((await stats(o)).counts.observed, 1);
  assert.equal(
    (
      await call(
        "GET",
        o.base +
          "/meetings/statistics?month=2024-02&circleId=" +
          foreign.rootCircle.id,
        undefined,
        o.owner,
      )
    ).statusCode,
    404,
  );
  supervised.add(o.organization.id);
  assert.equal((await stats(o)).counts.observed, 2);
  supervised.delete(o.organization.id);
  await admin.query(
    "UPDATE meeting_participants SET access='DENY' WHERE organization_id=$1 AND meeting_id=$2 AND member_id=$3",
    [o.organization.id, allowed, o.membership.id],
  );
  assert.equal((await stats(o)).counts.observed, 0);
  await admin.query(
    "UPDATE meeting_participants SET access='EDIT' WHERE organization_id=$1 AND meeting_id=$2 AND member_id=$3",
    [o.organization.id, allowed, o.membership.id],
  );
  const guest = await user();
  await addMember(o, guest, "GUEST", [
    {
      resource: { context: "meetings", kind: "meeting", id: allowed },
      actions: ["read"],
    },
  ]);
  assert.equal(
    (await call("GET", o.base + "/meetings/" + allowed, undefined, guest))
      .statusCode,
    200,
  );
  const guestStats = await call(
    "GET",
    o.base + "/meetings/statistics?month=2024-02",
    undefined,
    guest,
  );
  assert.equal(guestStats.statusCode, 404);
  assert.ok(!guestStats.body.includes("snapshotKnown"));
  disabled.add(o.organization.id);
  assert.equal(
    (
      await call(
        "GET",
        o.base + "/meetings/statistics?month=2024-02",
        undefined,
        o.owner,
      )
    ).statusCode,
    403,
  );
  disabled.delete(o.organization.id);
});

test("MS06: close replay is one immutable base; publication/restore and later roster/actions cannot rewrite it", async () => {
  const o = await organization();
  await historicalCoverage(o.organization.id);
  const mid = await meeting(o);
  await start(o, mid);
  await admin.query(
    "UPDATE meeting_participants SET attendance='PRESENT' WHERE organization_id=$1 AND meeting_id=$2",
    [o.organization.id, mid],
  );
  const first = await close(o, mid);
  const before = await stats(o);
  data(
    await call(
      "POST",
      o.base + "/meetings/" + mid + "/actions/close",
      {},
      o.owner,
      first.version,
      first.key,
    ),
  );
  assert.equal(
    (
      await admin.query(
        "SELECT count(*) FROM meeting_first_close_snapshots WHERE organization_id=$1 AND meeting_id=$2",
        [o.organization.id, mid],
      )
    ).rows[0].count,
    "1",
  );
  await admin.query(
    "UPDATE meeting_participants SET attendance='ABSENT' WHERE organization_id=$1 AND meeting_id=$2",
    [o.organization.id, mid],
  );
  const published = data(
    await call(
      "POST",
      o.base + "/meetings/" + mid + "/report/actions/publish",
      {},
      o.owner,
      first.result.report.version,
    ),
  );
  data(
    await call(
      "POST",
      o.base + "/meetings/" + mid + "/report/actions/restore",
      { restoreVersion: 1, reason: "Synthetic restore" },
      o.owner,
      published.report.version,
    ),
  );
  const after = await stats(o);
  assert.deepEqual(after.metrics, before.metrics);
  assert.deepEqual(after.coverage, before.coverage);
  assert.deepEqual(after.distributions, before.distributions);
  await assert.rejects(
    () =>
      admin.query(
        "UPDATE meeting_first_close_snapshots SET snapshot='{}' WHERE organization_id=$1 AND meeting_id=$2",
        [o.organization.id, mid],
      ),
    /immutable/,
  );
});
