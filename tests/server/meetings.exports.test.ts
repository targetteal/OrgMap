import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../server/src/app.js";
import { pool, transaction } from "../../server/src/db.js";
import { foundationDefaultAdmissionPolicy } from "../../server/src/admission.js";
import { createMeetings } from "../../server/modules/meetings/plugin.js";
import { createMeetingResourceAdapters } from "../../server/modules/meetings/platform.js";
import {
  createMeetingExportResourceAdapter,
  validateMeetingExportRequest,
  meetingExportBounds,
  type MeetingExportPorts,
} from "../../server/modules/meetings/exports.js";
import { fail } from "../../server/src/core.js";
import * as Y from "yjs";
import { meetingExportMessages } from "../../web/src/features/meetings/exports-messages.js";

if (
  !/^\/orgmap_(?:meetings_)?test_[a-f0-9]+$/.test(
    new URL(process.env.DATABASE_URL ?? "postgres://invalid/orgmap").pathname,
  )
)
  throw Error("Disposable Meetings database required");
const enabled = new Map<string, boolean>(),
  privateFlags = new Map<string, boolean>(),
  readFlags = new Map<string, boolean>();
// TEST-ONLY enqueue/capability fixture. This proves domain selection/ACL, not PDF/XLSX/ZIP artifacts.
const enqueued: { selectionId: string; id: string }[] = [];
const installed: MeetingExportPorts["formatsByKind"] = {
  MEETING_ROWS: ["XLSX"],
  MEETING_REPORT_PDF: ["PDF"],
  MEETING_REPORT_BUNDLE: ["ZIP"],
  MEETING_MONTHLY_STATISTICS: ["XLSX"],
};
const fixtureJobs: NonNullable<MeetingExportPorts["exportJobs"]> = {
  async enqueue(ctx, input) {
    const id = randomUUID();
    enqueued.push({ selectionId: input.resourceIds[0], id });
    assert.equal(ctx.mode, "write");
    return { id, state: "PENDING", version: 1 };
  },
};
const policy = {
  oversight: async (ctx: any, action: string) =>
    action === "readMeeting"
      ? readFlags.get(ctx.org.id) === true
      : action === "privateOperationalExport" &&
        privateFlags.get(ctx.org.id) === true,
};
const app = await buildApp([
  foundationDefaultAdmissionPolicy,
  async (_app, core) => {
    core.registerModuleScope({
      module: "meetings",
      routePrefixes: [],
      resourceTypes: ["meeting", "report", "meeting-export"],
    });
    core.registerOrganizationSettings(async (ctx) => ({
      version: 1,
      settings: {
        name: ctx.org.name,
        locale: ctx.org.locale,
        timezone: ctx.org.time_zone,
        modules: { structure: true, meetings: enabled.get(ctx.org.id) ?? true },
      },
    }));
  },
  createMeetings({
    exports: { formatsByKind: installed, exportJobs: fixtureJobs },
    readPolicy: policy,
    validateMembers: async (ctx, ids) =>
      (
        await ctx.c.query(
          "SELECT id FROM members WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND status='ACTIVE'",
          [ctx.org.id, ids],
        )
      ).rowCount === new Set(ids).size,
  }),
  async (app, core) => {
    const ports: MeetingExportPorts = {
      readPolicy: policy,
      formatsByKind: installed,
      assertAvailable: (ctx) => core.assertModuleAvailable(ctx, "meetings"),
      exportJobs: fixtureJobs,
    };
    const adapter = createMeetingExportResourceAdapter(ports);
    app.get(
      "/api/v1/organizations/:organizationId/test-export/:selectionId",
      (r) =>
        core.tenant(r, { mode: "read" }, async (ctx) => {
          const rid = (r.params as any).selectionId,
            includePrivate = (r.query as any).private === "true";
          if (
            !(await adapter.authorize(
              ctx,
              rid,
              includePrivate ? "export-private" : "export",
            ))
          )
            fail(404, "RESOURCE_NOT_FOUND");
          const row = (
            await ctx.c.query(
              "SELECT kind,format FROM meeting_export_selections WHERE organization_id=$1 AND id=$2",
              [ctx.org.id, rid],
            )
          ).rows[0];
          return adapter.export!(ctx, [rid], row.kind, {
            includePrivate,
            format: row.format,
          });
        }),
    );
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
  payload: any = undefined,
  user?: User,
  version?: number,
  commandKey = randomUUID(),
) {
  return app.inject({
    method: method as any,
    url: "/api/v1" + path,
    payload,
    headers: {
      origin: "http://localhost:5173",
      "idempotency-key": commandKey,
      ...(user ? { cookie: user.cookie, "x-csrf-token": user.csrf } : {}),
      ...(version !== undefined ? { "if-match": `"${version}"` } : {}),
    },
  });
}
function data(response: any, status = 200): any {
  assert.equal(response.statusCode, status, response.body);
  return response.json().data;
}
async function user(): Promise<User> {
  const response = await call("POST", "/auth/register", {
    email: randomUUID() + "@example.test",
    password: "meeting-export-fixture-123",
    displayName: "Équipe 日本語",
  });
  const d = data(response, 201);
  return {
    id: d.account.id,
    cookie: response.cookies[0].name + "=" + response.cookies[0].value,
    csrf: d.csrfToken,
  };
}
async function setup() {
  const owner = await user(),
    org = data(
      await call(
        "POST",
        "/organizations",
        { name: "Exports source fixture" },
        owner,
      ),
      201,
    );
  return { owner, org, p: "/organizations/" + org.organization.id };
}
async function meeting(
  p: string,
  circleId: string,
  owner: User,
  title = "Reunião 日本語",
  date = "2026-03-08T12:00",
) {
  const created = data(
    await call(
      "POST",
      p + "/meeting-series",
      {
        title,
        circleId,
        localStart: date,
        timeZone: "America/New_York",
        durationMinutes: 60,
        recurrence: { frequency: "ONCE" },
        sections: [{ id: "notes", title: "Notas — 議事録", kind: "CUSTOM" }],
        policy: {},
      },
      owner,
    ),
    201,
  );
  const route = p + "/meetings/" + created.occurrenceIds[0];
  return { route, id: created.occurrenceIds[0] };
}
async function note(route: string, actor: User, doc: Y.Doc, value: string) {
  const before = Y.encodeStateVector(doc);
  doc.getText("notes").insert(doc.getText("notes").length, value);
  const result = data(
    await call(
      "POST",
      route + "/collaboration/updates",
      {
        sectionId: "notes",
        epoch: 1,
        updateId: randomUUID(),
        update: Buffer.from(Y.encodeStateAsUpdate(doc, before)).toString(
          "base64",
        ),
      },
      actor,
    ),
  );
  assert.equal(result.durable, true);
}
async function close(route: string, actor: User) {
  let d = data(await call("GET", route, undefined, actor));
  if (d.meeting.state === "SCHEDULED")
    d = data(
      await call(
        "POST",
        route + "/actions/start",
        {},
        actor,
        d.meeting.version,
      ),
    );
  return data(
    await call("POST", route + "/actions/close", {}, actor, d.meeting.version),
  );
}
const bundle = { kind: "MEETING_REPORT_BUNDLE", format: "ZIP" };
const sourceText = (result: any) =>
  result.documentPackage.documents[0].sections[0].body.doc.content
    .map((p: any) => p.content?.map((x: any) => x.text ?? "").join("") ?? "")
    .join("\n");

test("closed request combinations, civil DST bounds and unavailable format do not enqueue", async () => {
  for (const request of [
    { kind: "MEETING_ROWS", format: "PDF" },
    { ...bundle, arbitrary: true },
    {
      kind: "MEETING_MONTHLY_STATISTICS",
      format: "XLSX",
      fromDate: "2026-01-01",
    },
    { kind: "MEETING_ROWS", format: "XLSX", reportSource: "PUBLISHED" },
    { ...bundle, fromDate: "2026-02-30" },
  ])
    assert.throws(() => validateMeetingExportRequest(request));
  assert.deepEqual(
    meetingExportBounds(
      { ...bundle, fromDate: "2026-03-08", toDate: "2026-03-09" } as any,
      "America/New_York",
    ),
    { from: "2026-03-08T05:00:00Z", until: "2026-03-09T04:00:00Z" },
  );
  const { owner, p } = await setup(),
    before = enqueued.length;
  delete installed.MEETING_REPORT_BUNDLE;
  try {
    const capabilities = data(
      await call("GET", p + "/meetings/exports/capabilities", undefined, owner),
    );
    assert.equal(capabilities.formatsByKind.MEETING_REPORT_BUNDLE, undefined);
    const rejected = await call("POST", p + "/meetings/exports", bundle, owner);
    assert.equal(rejected.statusCode, 503);
    assert.equal(rejected.json().error.code, "FORMAT_CONFIGURATION_REQUIRED");
    assert.equal(enqueued.length, before);
  } finally {
    installed.MEETING_REPORT_BUNDLE = ["ZIP"];
  }
  const empty = data(
    await call("POST", p + "/meetings/exports", bundle, owner),
    202,
  );
  const output = data(
    await call(
      "GET",
      p + "/test-export/" + empty.selectionSummary.id,
      undefined,
      owner,
    ),
  );
  assert.deepEqual(output.documentPackage.documents, []);
  assert.deepEqual(output.documentPackage.notices, [
    "EMPTY_AUTHORIZED_SELECTION",
  ]);
  assert.equal(
    (
      await call(
        "POST",
        p + "/meetings/exports",
        { kind: "MEETING_REPORT_PDF", format: "PDF" },
        owner,
      )
    ).statusCode,
    422,
  );
  assert.deepEqual(
    createMeetingResourceAdapters().meeting.exportKinds,
    undefined,
  );
});
test("published ref and current ACKed snapshot freeze independently; replay does not enqueue twice", async () => {
  const { owner, org, p } = await setup(),
    m = await meeting(p, org.rootCircle.id, owner);
  let d = data(await call("POST", m.route + "/actions/start", {}, owner, 1));
  const doc = new Y.Doc();
  await note(m.route, owner, doc, "<b>literal 日本語</b>");
  d = await close(m.route, owner);
  const unpublished = data(
    await call("POST", p + "/meetings/exports", bundle, owner),
    202,
  );
  assert.equal(unpublished.selectionSummary.excludedUnpublished, 1);
  d = data(
    await call(
      "POST",
      m.route + "/report/actions/publish",
      {},
      owner,
      d.report.version,
    ),
  );
  await note(m.route, owner, doc, " durable update");
  const commandKey = randomUUID(),
    request = {
      ...bundle,
      circleIds: [org.rootCircle.id],
      fromDate: "2026-03-08",
      toDate: "2026-03-09",
    };
  const first = data(
      await call(
        "POST",
        p + "/meetings/exports",
        request,
        owner,
        undefined,
        commandKey,
      ),
      202,
    ),
    before = enqueued.length;
  const replay = data(
    await call(
      "POST",
      p + "/meetings/exports",
      request,
      owner,
      undefined,
      commandKey,
    ),
    202,
  );
  assert.equal(replay.job.id, first.job.id);
  assert.equal(enqueued.length, before);
  const frozenPublished = data(
    await call(
      "GET",
      p + "/test-export/" + first.selectionSummary.id,
      undefined,
      owner,
    ),
  );
  assert.equal(sourceText(frozenPublished), "<b>literal 日本語</b>");
  assert.equal(frozenPublished.documentPackage.documents[0].state, "PUBLISHED");
  assert.equal(
    frozenPublished.documentPackage.documents[0].ref.notesSeq.notes,
    1,
  );
  const current = data(
    await call(
      "POST",
      p + "/meetings/exports",
      { ...request, reportSource: "CURRENT_AUTHORIZED" },
      owner,
    ),
    202,
  );
  const currentOutput = data(
    await call(
      "GET",
      p + "/test-export/" + current.selectionSummary.id,
      undefined,
      owner,
    ),
  );
  assert.equal(
    sourceText(currentOutput),
    "<b>literal 日本語</b> durable update",
  );
  assert.equal(currentOutput.documentPackage.documents[0].state, "DRAFT");
  assert.equal(
    currentOutput.documentPackage.documents[0].ref.notesSeq.notes,
    2,
  );
  doc.getText("notes").insert(0, "LOCAL UNSENT ");
  assert.ok(!sourceText(currentOutput).includes("LOCAL UNSENT"));
  d = data(await call("GET", m.route, undefined, owner));
  data(
    await call(
      "POST",
      m.route + "/report/actions/publish",
      {},
      owner,
      d.report.version,
    ),
  );
  assert.deepEqual(
    data(
      await call(
        "GET",
        p + "/test-export/" + first.selectionSummary.id,
        undefined,
        owner,
      ),
    ),
    frozenPublished,
  );
  assert.deepEqual(
    data(
      await call(
        "GET",
        p + "/test-export/" + current.selectionSummary.id,
        undefined,
        owner,
      ),
    ),
    currentOutput,
  );
  doc.destroy();
});
test("rows include CLOSED only and preserve timestamps/nulls/counts; statistics freeze25months", async () => {
  const { owner, org, p } = await setup(),
    closed = await meeting(p, org.rootCircle.id, owner),
    scheduled = await meeting(p, org.rootCircle.id, owner, "Scheduled"),
    running = await meeting(p, org.rootCircle.id, owner, "Running"),
    canceled = await meeting(p, org.rootCircle.id, owner, "Canceled");
  let d = data(
    await call("POST", closed.route + "/actions/start", {}, owner, 1),
  );
  data(
    await call(
      "POST",
      closed.route + "/agenda",
      { title: "Agenda count" },
      owner,
      d.meeting.version,
    ),
  );
  await close(closed.route, owner);
  data(await call("POST", running.route + "/actions/start", {}, owner, 1));
  data(
    await call(
      "POST",
      canceled.route + "/actions/cancel",
      { scope: "THIS", reason: "Source fixture cancellation" },
      owner,
      1,
    ),
  );
  await transaction(async (c) => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
      org.organization.id,
    ]);
    await c.query(
      "UPDATE meeting_occurrences SET started_at=NULL WHERE organization_id=$1 AND id=$2",
      [org.organization.id, closed.id],
    );
  });
  const requested = data(
    await call(
      "POST",
      p + "/meetings/exports",
      { kind: "MEETING_ROWS", format: "XLSX" },
      owner,
    ),
    202,
  );
  const output = data(
    await call(
      "GET",
      p + "/test-export/" + requested.selectionSummary.id,
      undefined,
      owner,
    ),
  );
  assert.equal(output.records.length, 1);
  assert.equal(output.records[0].meetingId, closed.id);
  assert.equal(output.records[0].actualStart, null);
  assert.equal(output.records[0].agendaCount, 1);
  assert.equal(output.records[0].meetingUrl, "/meetings/" + closed.id);
  assert.equal(output.workbook.sheets[0].rows.length, 1);
  assert.ok(!JSON.stringify(output).includes(scheduled.id));
  const stats = data(
    await call(
      "POST",
      p + "/meetings/exports",
      {
        kind: "MEETING_MONTHLY_STATISTICS",
        format: "XLSX",
        endMonth: "2026-03",
      },
      owner,
    ),
    202,
  );
  const statsOutput = data(
    await call(
      "GET",
      p + "/test-export/" + stats.selectionSummary.id,
      undefined,
      owner,
    ),
  );
  assert.equal(statsOutput.records.length, 25);
  assert.equal(statsOutput.records[0].period.month, "2024-03");
  assert.equal(statsOutput.records[24].period.month, "2026-03");
  assert.equal(
    new Set(statsOutput.records.map((s: any) => s.period.asOf)).size,
    1,
  );
  assert.equal(
    new Set(statsOutput.records.map((s: any) => s.period.timezone)).size,
    1,
  );
  assert.equal(statsOutput.workbook.sheets[0].rows.length, 25);
});
test("revoking one frozen resource fails the whole selection and idempotent replay without leaking titles", async () => {
  const { owner, org, p } = await setup(),
    m = await meeting(p, org.rootCircle.id, owner, "Hidden after revocation");
  await close(m.route, owner);
  const request = { kind: "MEETING_ROWS", format: "XLSX" },
    commandKey = randomUUID();
  const selection = data(
    await call(
      "POST",
      p + "/meetings/exports",
      request,
      owner,
      undefined,
      commandKey,
    ),
    202,
  );
  const before = enqueued.length;
  await transaction(async (c) => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
      org.organization.id,
    ]);
    await c.query(
      "UPDATE meeting_participants SET access='DENY' WHERE organization_id=$1 AND meeting_id=$2",
      [org.organization.id, m.id],
    );
  });
  for (const response of [
    await call(
      "GET",
      p + "/test-export/" + selection.selectionSummary.id,
      undefined,
      owner,
    ),
    await call(
      "POST",
      p + "/meetings/exports",
      request,
      owner,
      undefined,
      commandKey,
    ),
  ]) {
    assert.equal(response.statusCode, 404, response.body);
    assert.ok(!response.body.includes("Hidden after revocation"));
  }
  assert.equal(enqueued.length, before);
});
test("private selection requires current OWNER flag and durable intent; moduleOFF fails replay and adapter", async () => {
  const { owner, org, p } = await setup(),
    facilitator = await user();
  data(
    await call("POST", p + "/members", { accountId: facilitator.id }, owner),
    201,
  );
  await transaction(async (c) => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
      org.organization.id,
    ]);
    await c.query(
      "UPDATE members SET org_role='OWNER' WHERE organization_id=$1 AND account_id=$2",
      [org.organization.id, facilitator.id],
    );
  });
  const m = await meeting(p, org.rootCircle.id, facilitator, "Private source");
  await close(m.route, facilitator);
  assert.equal((await call("GET", m.route, undefined, owner)).statusCode, 404);
  const request = {
      ...bundle,
      reportSource: "CURRENT_AUTHORIZED",
      includePrivate: true,
    },
    commandKey = randomUUID();
  readFlags.set(org.organization.id, true);
  data(await call("GET", m.route, undefined, owner));
  const normalDespiteOversight = data(
    await call(
      "POST",
      p + "/meetings/exports",
      { ...bundle, reportSource: "CURRENT_AUTHORIZED" },
      owner,
    ),
    202,
  );
  assert.equal(normalDespiteOversight.selectionSummary.reports, 0);
  const ordinaryStats = data(
    await call(
      "POST",
      p + "/meetings/exports",
      {
        kind: "MEETING_MONTHLY_STATISTICS",
        format: "XLSX",
        endMonth: "2026-03",
      },
      owner,
    ),
    202,
  );
  assert.equal(ordinaryStats.selectionSummary.meetings, 0);
  readFlags.set(org.organization.id, false);
  assert.equal(
    (await call("POST", p + "/meetings/exports", request, owner)).statusCode,
    403,
  );
  privateFlags.set(org.organization.id, true);
  const privateStats = data(
    await call(
      "POST",
      p + "/meetings/exports",
      {
        kind: "MEETING_MONTHLY_STATISTICS",
        format: "XLSX",
        endMonth: "2026-03",
        includePrivate: true,
      },
      owner,
    ),
    202,
  );
  assert.equal(privateStats.selectionSummary.meetings, 1);
  const selection = data(
    await call(
      "POST",
      p + "/meetings/exports",
      request,
      owner,
      undefined,
      commandKey,
    ),
    202,
  );
  assert.equal(selection.selectionSummary.reports, 1);
  assert.equal(
    (
      await call(
        "GET",
        p + "/test-export/" + selection.selectionSummary.id,
        undefined,
        owner,
      )
    ).statusCode,
    404,
  );
  data(
    await call(
      "GET",
      p + "/test-export/" + selection.selectionSummary.id + "?private=true",
      undefined,
      owner,
    ),
  );
  assert.equal((await call("GET", m.route, undefined, owner)).statusCode, 404);
  privateFlags.set(org.organization.id, false);
  assert.equal(
    (
      await call(
        "GET",
        p + "/test-export/" + selection.selectionSummary.id + "?private=true",
        undefined,
        owner,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "POST",
        p + "/meetings/exports",
        request,
        owner,
        undefined,
        commandKey,
      )
    ).statusCode,
    403,
  );
  privateFlags.set(org.organization.id, true);
  enabled.set(org.organization.id, false);
  assert.equal(
    (
      await call(
        "POST",
        p + "/meetings/exports",
        request,
        owner,
        undefined,
        commandKey,
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call(
        "GET",
        p + "/test-export/" + selection.selectionSummary.id + "?private=true",
        undefined,
        owner,
      )
    ).statusCode,
    404,
  );
  enabled.set(org.organization.id, true);
  await transaction(async (c) => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
      org.organization.id,
    ]);
    await c.query(
      "UPDATE members SET member_type='GUEST',org_role='MEMBER' WHERE organization_id=$1 AND account_id=$2",
      [org.organization.id, owner.id],
    );
  });
  assert.equal(
    (await call("POST", p + "/meetings/exports", request, owner)).statusCode,
    404,
  );
});

test("current source rejects unresolved durable pending structs; resolution permits same-key retry", async () => {
  const { owner, org, p } = await setup(),
    m = await meeting(p, org.rootCircle.id, owner);
  await close(m.route, owner);
  const doc = new Y.Doc();
  doc.getText("notes").insert(0, "one");
  const one = Y.encodeStateAsUpdate(doc),
    vector = Y.encodeStateVector(doc);
  doc.getText("notes").insert(3, "two");
  const two = Y.encodeStateAsUpdate(doc, vector);
  const send = async (update: Uint8Array) =>
    data(
      await call(
        "POST",
        m.route + "/collaboration/updates",
        {
          sectionId: "notes",
          epoch: 1,
          updateId: randomUUID(),
          update: Buffer.from(update).toString("base64"),
        },
        owner,
      ),
    );
  assert.equal((await send(two)).durable, true);
  const request = { ...bundle, reportSource: "CURRENT_AUTHORIZED" },
    commandKey = randomUUID(),
    before = enqueued.length;
  const denied = await call(
    "POST",
    p + "/meetings/exports",
    request,
    owner,
    undefined,
    commandKey,
  );
  assert.equal(denied.statusCode, 409, denied.body);
  assert.equal(denied.json().error.code, "PENDING_UPDATES_REQUIRE_RESOLUTION");
  assert.equal(enqueued.length, before);
  assert.equal((await send(one)).durable, true);
  const selected = data(
    await call(
      "POST",
      p + "/meetings/exports",
      request,
      owner,
      undefined,
      commandKey,
    ),
    202,
  );
  const output = data(
    await call(
      "GET",
      p + "/test-export/" + selected.selectionSummary.id,
      undefined,
      owner,
    ),
  );
  assert.equal(sourceText(output), "onetwo");
  assert.equal(output.documentPackage.documents[0].ref.notesSeq.notes, 2);
  doc.destroy();
});

test("foreign tenant and revoked report ACL cannot read a frozen report selection", async () => {
  const { owner, org, p } = await setup(),
    m = await meeting(p, org.rootCircle.id, owner);
  await close(m.route, owner);
  const selected = data(
      await call(
        "POST",
        p + "/meetings/exports",
        { ...bundle, reportSource: "CURRENT_AUTHORIZED" },
        owner,
      ),
      202,
    ),
    selectedId = selected.selectionSummary.id;
  const output = data(
      await call("GET", p + "/test-export/" + selectedId, undefined, owner),
    ),
    reportId = output.documentPackage.documents[0].ref.reportId;
  const otherOrg = data(
    await call("POST", "/organizations", { name: "Other tenant" }, owner),
    201,
  );
  assert.equal(
    (
      await call(
        "GET",
        "/organizations/" +
          otherOrg.organization.id +
          "/test-export/" +
          selectedId,
        undefined,
        owner,
      )
    ).statusCode,
    404,
  );
  await transaction(async (c) => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
      org.organization.id,
    ]);
    await c.query(
      "INSERT INTO meeting_report_access(organization_id,report_id,member_id,can_read,can_edit) SELECT $1,$2,id,false,false FROM members WHERE organization_id=$1 AND account_id=$3",
      [org.organization.id, reportId, owner.id],
    );
  });
  assert.equal(
    (await call("GET", p + "/test-export/" + selectedId, undefined, owner))
      .statusCode,
    404,
  );
});

test("export widget catalog has complete messages for all eight locales", () => {
  const expected = Object.keys(meetingExportMessages["pt-BR"]).sort();
  assert.equal(Object.keys(meetingExportMessages).length, 8);
  for (const messages of Object.values(meetingExportMessages)) {
    assert.deepEqual(Object.keys(messages).sort(), expected);
    for (const value of Object.values(messages)) assert.ok(value.trim());
  }
  assert.equal(meetingExportMessages["en-US"].exports, "Export meetings");
  assert.equal(meetingExportMessages["ja-JP"].exports, "会議をエクスポート");
});
