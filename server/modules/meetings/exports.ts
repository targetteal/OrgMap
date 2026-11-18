import type { FastifyInstance } from "fastify";
import { Temporal } from "@js-temporal/polyfill";
import * as Y from "yjs";
import { fromPlainText, validateRichDocument } from "@orgmap/content";
import type { Ctx, ModuleRuntime } from "../../src/runtime.js";
import { body, fail, Failure, id, key, uuid } from "../../src/core.js";
import type { ResourceAccessPort } from "../platform/ports.js";
import type { ExportJobPort } from "../platform/export-jobs.js";
import type { ExportWorkbook } from "../platform/workbook.js";
import {
  access,
  snapshot,
  supervisionExport,
  type MeetingReadPolicy,
} from "./service.js";
import { createMeetingStatisticsPort, selectionClock } from "./statistics.js";
import {
  MEETING_METRIC_NAMES,
  type MeetingStatistics,
} from "./statistics-contract.js";
import {
  formatsByKind,
  meetingExportBudgets,
  type MeetingExportKind,
  type MeetingExportFormat,
  type MeetingExportRequest,
  type PdfBundlePayload,
  type MeetingExportRow,
  type ReportRenderDocument,
} from "./export-contract.js";

export interface MeetingExportResult {
  records: MeetingExportRow[] | MeetingStatistics[];
  coverage: string;
  estimated: false;
  workbook?: ExportWorkbook;
  documentPackage?: PdfBundlePayload;
}

export interface MeetingExportPorts {
  readPolicy?: MeetingReadPolicy;
  exportJobs?: ExportJobPort;
  /** Only installed, operational Platform serializers. Never derive this from HTTP input. */
  formatsByKind?:
    | Partial<Record<MeetingExportKind, readonly MeetingExportFormat[]>>
    | (() => Promise<
        Partial<Record<MeetingExportKind, readonly MeetingExportFormat[]>>
      >);
  /** Same current availability check in HTTP, standalone worker and download. */
  assertAvailable: (ctx: Ctx) => Promise<void>;
}
const base = "/api/v1/organizations/:organizationId/meetings/exports";
const iso = (value: unknown): string => new Date(value as string).toISOString();
const nullableIso = (value: unknown) => (value == null ? null : iso(value));
const isReport = (kind: MeetingExportKind) =>
  kind === "MEETING_REPORT_PDF" || kind === "MEETING_REPORT_BUNDLE";
const coverage =
  "Frozen authorized selection. Published source uses an explicit Published version. Current source contains durable acknowledged notes only; local and pending drafts are excluded. Names are captured at selection time. Later edits do not replace this snapshot; current access is revalidated.";
function nonguest(ctx: Ctx) {
  if (ctx.member.member_type === "GUEST" || ctx.member.status !== "ACTIVE")
    fail(404, "RESOURCE_NOT_FOUND");
}
async function privateIntent(
  ctx: Ctx,
  ports: MeetingExportPorts,
  includePrivate: boolean,
) {
  nonguest(ctx);
  if (includePrivate && !(await supervisionExport(ctx, ports.readPolicy)))
    fail(403, "PRIVATE_EXPORT_DENIED");
}
async function installed(
  ports: MeetingExportPorts,
  kind: MeetingExportKind,
  format: MeetingExportFormat,
) {
  const configured =
    typeof ports.formatsByKind === "function"
      ? await ports.formatsByKind()
      : ports.formatsByKind;
  return (
    !!ports.exportJobs &&
    (formatsByKind[kind] as readonly string[]).includes(format) &&
    configured?.[kind]?.includes(format) === true
  );
}
async function requireInstalled(
  ports: MeetingExportPorts,
  kind: MeetingExportKind,
  format: MeetingExportFormat,
) {
  if (!(await installed(ports, kind, format)))
    fail(503, "FORMAT_CONFIGURATION_REQUIRED");
}
export async function meetingExportCapabilities(
  ctx: Ctx,
  ports: MeetingExportPorts,
) {
  nonguest(ctx);
  await ports.assertAvailable(ctx);
  const available: Partial<Record<MeetingExportKind, MeetingExportFormat[]>> =
    {};
  for (const kind of Object.keys(formatsByKind) as MeetingExportKind[]) {
    const formats: MeetingExportFormat[] = [];
    for (const format of formatsByKind[kind])
      if (await installed(ports, kind, format)) formats.push(format);
    if (formats.length) available[kind] = [...formats];
  }
  return {
    schemaVersion: 1,
    formatsByKind: available,
    queueAvailable: !!ports.exportJobs,
    privateAvailable: await supervisionExport(ctx, ports.readPolicy),
    reportSources: ["PUBLISHED", "CURRENT_AUTHORIZED"],
    budgets: meetingExportBudgets,
  };
}
export function validateMeetingExportRequest(
  value: unknown,
): MeetingExportRequest {
  const b = value as MeetingExportRequest;
  if (
    !b ||
    typeof b !== "object" ||
    Array.isArray(b) ||
    Object.keys(b).some(
      (k) =>
        ![
          "kind",
          "format",
          "circleIds",
          "fromDate",
          "toDate",
          "endMonth",
          "includePrivate",
          "reportSource",
        ].includes(k),
    ) ||
    !Object.hasOwn(formatsByKind, b.kind) ||
    !(formatsByKind[b.kind] as readonly string[]).includes(b.format) ||
    (b.includePrivate !== undefined && typeof b.includePrivate !== "boolean") ||
    (b.reportSource !== undefined &&
      !["PUBLISHED", "CURRENT_AUTHORIZED"].includes(b.reportSource))
  )
    fail(400, "INVALID_REQUEST");
  if (
    b.circleIds !== undefined &&
    (!Array.isArray(b.circleIds) ||
      !b.circleIds.length ||
      b.circleIds.length > 100 ||
      new Set(b.circleIds).size !== b.circleIds.length)
  )
    fail(400, "INVALID_REQUEST");
  if (b.circleIds) b.circleIds.forEach(id);
  for (const date of [b.fromDate, b.toDate]) {
    if (date === undefined) continue;
    try {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        Temporal.PlainDate.from(date).toString() !== date
      )
        fail(400, "INVALID_REQUEST");
    } catch {
      fail(400, "INVALID_REQUEST");
    }
  }
  if (b.fromDate && b.toDate && b.fromDate >= b.toDate)
    fail(400, "INVALID_REQUEST");
  if (b.kind === "MEETING_MONTHLY_STATISTICS") {
    if (
      b.circleIds !== undefined ||
      b.fromDate !== undefined ||
      b.toDate !== undefined ||
      b.reportSource !== undefined
    )
      fail(400, "INVALID_REQUEST");
    if (b.endMonth !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(b.endMonth))
      fail(400, "INVALID_REQUEST");
  } else if (
    b.endMonth !== undefined ||
    (!isReport(b.kind) && b.reportSource !== undefined)
  )
    fail(400, "INVALID_REQUEST");
  return { ...b, circleIds: b.circleIds ? [...b.circleIds] : undefined };
}
export function meetingExportBounds(
  request: MeetingExportRequest,
  timezone: string,
) {
  const instant = (date: string) =>
    Temporal.PlainDate.from(date)
      .toZonedDateTime(timezone)
      .toInstant()
      .toString();
  return {
    from: request.fromDate ? instant(request.fromDate) : null,
    until: request.toDate ? instant(request.toDate) : null,
  };
}
async function mayRead(
  ctx: Ctx,
  meetingId: string,
  ports: MeetingExportPorts,
  includePrivate: boolean,
) {
  try {
    const authorized = await access(
      ctx,
      meetingId,
      "read",
      ports.readPolicy,
      includePrivate ? "private-export" : "read",
    );
    return !authorized.supervised || includePrivate;
  } catch (e) {
    if (e instanceof Failure && [403, 404].includes(e.status)) return false;
    throw e;
  }
}
function documentBody(doc: any) {
  if (doc.pending === true) fail(409, "PENDING_UPDATES_REQUIRE_RESOLUTION");
  if (doc.document) return validateRichDocument(doc.document);
  // Legacy ytext is literal text. Never reinterpret HTML or Markdown.
  const ydoc = new Y.Doc();
  try {
    Y.applyUpdate(ydoc, Buffer.from(doc.snapshot, "base64"));
    return fromPlainText(ydoc.getText("notes").toString());
  } finally {
    ydoc.destroy();
  }
}
async function renderDocument(
  ctx: Ctx,
  m: any,
  report: any,
  source: "PUBLISHED" | "CURRENT_AUTHORIZED",
  capturedAt: string,
  timezone: string,
  ports: MeetingExportPorts,
): Promise<ReportRenderDocument | null> {
  if (!report) return null;
  const published = (
    await ctx.c.query(
      "SELECT version,epoch,snapshot FROM meeting_report_versions WHERE organization_id=$1 AND report_id=$2 AND publication_status='PUBLISHED' ORDER BY version DESC LIMIT 1",
      [ctx.org.id, report.id],
    )
  ).rows[0];
  if (source === "PUBLISHED" && !published) return null;
  const frozen =
    source === "PUBLISHED" ? published.snapshot : await snapshot(ctx, m.id);
  const visibleActions=[];
  for(const action of frozen.actions){
    if(action.targetKind&&action.targetId&&!await ports.readPolicy?.outcomes?.read(ctx,{kind:action.targetKind,id:action.targetId}))continue;
    visibleActions.push(action);
  }
  const meeting = frozen.meeting;
  const circle = (
    await ctx.c.query(
      "SELECT name FROM entities WHERE organization_id=$1 AND id=$2 AND kind='CIRCLE' AND NOT archived",
      [ctx.org.id, meeting.circleId],
    )
  ).rows[0];
  if (!circle) fail(404, "RESOURCE_NOT_FOUND");
  const roster = [];
  for (const p of frozen.participants) {
    if (p.access === "DENY") continue;
    const member = (
      await ctx.c.query(
        "SELECT a.display_name FROM members m JOIN accounts a ON a.id=m.account_id WHERE m.organization_id=$1 AND m.id=$2",
        [ctx.org.id, p.memberId],
      )
    ).rows[0];
    roster.push({
      memberId: p.memberId,
      label: member?.display_name ?? p.memberId,
      attendance: p.attendance,
      participationRole: p.participationRole ?? "REQUIRED",
    });
  }
  const docs = new Map<string, any>(
    frozen.documents.map((d: any) => [d.sectionId, d]),
  );
  const sections = meeting.sections.map((section: any) => {
    const doc = docs.get(section.id);
    if (!doc) fail(422, "REPORT_SNAPSHOT_INCOMPLETE");
    return { id: section.id, heading: section.title, body: documentBody(doc) };
  });
  return {
    schemaVersion: 1,
    ref: {
      reportId: report.id,
      meetingId: m.id,
      reportVersion:
        source === "PUBLISHED" ? published.version : report.version,
      publishedVersion: published?.version ?? null,
      epoch: source === "PUBLISHED" ? published.epoch : report.epoch,
      notesSeq: Object.fromEntries(
        frozen.documents.map((d: any) => [d.sectionId, d.sequence]),
      ),
    },
    title: meeting.title,
    circle: { id: meeting.circleId, label: circle.name },
    state: source === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
    meeting: {
      plannedStart: iso(meeting.startAt),
      actualStart: nullableIso(meeting.startedAt),
      actualEnd: nullableIso(meeting.closedAt),
      timezone,
    },
    sections,
    roster,
    agenda: frozen.agenda.map((a: any) => ({
      id: a.id,
      title: a.title,
      presenterId: a.presenterId,
      durationMinutes: a.durationMinutes,
      status: a.status,
      skipped: a.skipped,
    })),
    actions: visibleActions.map((a: any) => ({
      id: a.id,
      agendaId: a.agendaId ?? null,
      title: a.title,
      assigneeId: a.assigneeId,
      state: a.state,
    })),
    capturedAt,
    coverage,
  };
}
function rowsWorkbook(rows: MeetingExportRow[]): ExportWorkbook {
  const columns: (keyof MeetingExportRow)[] = [
    "meetingId",
    "title",
    "circleId",
    "circleLabel",
    "type",
    "status",
    "plannedStart",
    "plannedEnd",
    "actualStart",
    "actualEnd",
    "agendaCount",
    "meetingUrl",
    "reportUrl",
  ];
  return {
    sheets: [
      {
        name: "Reuniões",
        columns,
        rows: rows.map((row) => columns.map((column) => row[column])),
      },
    ],
  };
}
async function frozenSelection(
  ctx: Ctx,
  selectionId: string,
  ports: MeetingExportPorts,
  intent: boolean,
) {
  nonguest(ctx);
  await ports.assertAvailable(ctx);
  const row = (
    await ctx.c.query(
      "SELECT * FROM meeting_export_selections WHERE organization_id=$1 AND id=$2 AND owner_id=$3 AND account_id=$4",
      [ctx.org.id, id(selectionId), ctx.member.id, ctx.account.id],
    )
  ).rows[0];
  if (!row) fail(404, "RESOURCE_NOT_FOUND");
  if (row.include_private !== intent) fail(403, "EXPORT_INTENT_REQUIRED");
  await privateIntent(ctx, ports, intent);
  // Revalidate the entire frozen population. Revocation fails the selection, never a row filter.
  for (const meetingId of row.authorized_ids) {
    if (!(await mayRead(ctx, meetingId, ports, intent)))
      fail(404, "RESOURCE_NOT_FOUND");
  }
  for (const ref of row.report_refs as ReportRenderDocument["ref"][]) {
    const report = (
      await ctx.c.query(
        "SELECT id FROM meeting_reports WHERE organization_id=$1 AND id=$2 AND meeting_id=$3",
        [ctx.org.id, ref.reportId, ref.meetingId],
      )
    ).rows[0];
    if (!report) fail(404, "RESOURCE_NOT_FOUND");
    if (row.report_source === "PUBLISHED") {
      const version = (
        await ctx.c.query(
          "SELECT epoch FROM meeting_report_versions WHERE organization_id=$1 AND report_id=$2 AND version=$3 AND publication_status='PUBLISHED'",
          [ctx.org.id, ref.reportId, ref.reportVersion],
        )
      ).rows[0];
      if (!version || version.epoch !== ref.epoch)
        fail(404, "RESOURCE_NOT_FOUND");
    }
  }
  // Frozen artifacts remain usable only while all included outcome targets
  // remain readable. Revalidate against live ownership rather than snapshot.
  for(const doc of row.frozen_payload?.documentPackage?.documents??[]){
    for(const action of doc.actions??[]){
      const current=(await ctx.c.query('SELECT target_kind,target_id FROM meeting_actions WHERE organization_id=$1 AND meeting_id=$2 AND id=$3',[ctx.org.id,doc.ref.meetingId,action.id])).rows[0];
      if(!current)fail(404,'RESOURCE_NOT_FOUND');
      if(current.target_kind&&(!ports.readPolicy?.outcomes||!await ports.readPolicy.outcomes.read(ctx,{kind:current.target_kind,id:current.target_id})))fail(404,'RESOURCE_NOT_FOUND');
    }
  }
  return row;
}
export function createMeetingExportResourceAdapter(
  ports: MeetingExportPorts,
): ResourceAccessPort {
  return {
    supportsPrivateExport: typeof ports.readPolicy?.oversight === "function",
    exportKinds: Object.keys(formatsByKind),
    authorize: async (ctx, rid, action) => {
      if (action !== "export" && action !== "export-private") return false;
      try {
        await frozenSelection(ctx, rid, ports, action === "export-private");
        return true;
      } catch (e) {
        if (e instanceof Failure && [403, 404].includes(e.status)) return false;
        throw e;
      }
    },
    export: async (ctx, ids, kind, options): Promise<MeetingExportResult> => {
      if (ids.length !== 1) fail(400, "INVALID_EXPORT_SELECTION");
      const selection = await frozenSelection(
        ctx,
        ids[0],
        ports,
        options?.includePrivate === true,
      );
      if (kind !== selection.kind || options?.format !== selection.format)
        fail(400, "INVALID_EXPORT_KIND");
      return selection.frozen_payload as MeetingExportResult;
    },
  };
}
export async function registerMeetingExports(
  app: FastifyInstance,
  core: ModuleRuntime,
  ports: MeetingExportPorts,
) {
  app.get(base + "/capabilities", (r) =>
    core.tenant(r, { mode: "read" }, (ctx) =>
      meetingExportCapabilities(ctx, ports),
    ),
  );
  app.post(base, async (r, reply) =>
    reply.code(202).send(
      await core.tenant(
        r,
        {
          mode: "write",
          authorize: async (ctx) => {
            nonguest(ctx);
            await ports.assertAvailable(ctx);
            const request = validateMeetingExportRequest(
              body(r, [
                "kind",
                "format",
                "circleIds",
                "fromDate",
                "toDate",
                "endMonth",
                "includePrivate",
                "reportSource",
              ]),
            );
            await requireInstalled(ports, request.kind, request.format);
            await privateIntent(ctx, ports, request.includePrivate === true);
            const prior = (
              await ctx.c.query(
                "SELECT id,include_private FROM meeting_export_selections WHERE organization_id=$1 AND account_id=$2 AND command_key=$3",
                [ctx.org.id, ctx.account.id, key(r)],
              )
            ).rows[0];
            if (prior)
              await frozenSelection(
                ctx,
                prior.id,
                ports,
                prior.include_private,
              );
            return true;
          },
        },
        async (ctx) => {
          const request = validateMeetingExportRequest(r.body),
            selectionId = uuid();
          const clock = await selectionClock(core, ctx),
            timezone = clock.timezone;
          let asOf = clock.asOf;
          const source = request.reportSource ?? "PUBLISHED",
            intent = request.includePrivate === true;
          const authorizedIds: string[] = [],
            refs: ReportRenderDocument["ref"][] = [];
          let result: MeetingExportResult,
            excludedUnpublished = 0;
          if (request.kind === "MEETING_MONTHLY_STATISTICS") {
            const statistics = createMeetingStatisticsPort(
              core,
              ports.readPolicy,
            );
            const end =
              request.endMonth ??
              Temporal.Instant.from(asOf)
                .toZonedDateTimeISO(timezone)
                .toPlainDate()
                .toPlainYearMonth()
                .toString();
            const records = [];
            for (let i = 24; i >= 0; i--) {
              const month = Temporal.PlainYearMonth.from(end)
                .subtract({ months: i })
                .toString();
              const selected = await statistics.computeSelection(
                ctx,
                { month },
                intent
                  ? { purpose: "private-export" }
                  : { excludeSupervised: true },
              );
              records.push(selected.statistics);
              for (const mid of selected.authorizedMeetingIds)
                if (!authorizedIds.includes(mid)) authorizedIds.push(mid);
            }
            asOf = records[0].period.asOf;
            const columns = [
              "month",
              "timezone",
              "asOf",
              "observed",
              "realized",
              "running",
              "cancelled",
              ...MEETING_METRIC_NAMES.flatMap((name) => [
                name,
                name + "Numerator",
                name + "Denominator",
                name + "Known",
                name + "Eligible",
              ]),
              "coverage",
              "coveredFrom",
              "snapshotKnown",
              "snapshotMissing",
              "durationMissing",
            ];
            result = {
              records,
              estimated: false,
              coverage:
                "25 organization-civil months, endMonth-24 through endMonth. Native LF07 metrics and denominators; null and unavailable coverage are preserved. Current authorized population; private expansion requires explicit intent and current policy. No fabricated history.",
              workbook: {
                sheets: [
                  {
                    name: "Estatísticas",
                    columns,
                    rows: records.map((s) => [
                      s.period.month,
                      s.period.timezone,
                      s.period.asOf,
                      s.counts.observed,
                      s.counts.realized,
                      s.counts.running,
                      s.counts.cancelled,
                      ...MEETING_METRIC_NAMES.flatMap((name) => {
                        const m = s.metrics[name];
                        return [
                          m.value,
                          m.numerator,
                          m.denominator,
                          m.known,
                          m.eligible,
                        ];
                      }),
                      s.coverage.state,
                      s.coverage.coveredFrom,
                      s.coverage.snapshotKnown,
                      s.coverage.snapshotMissing,
                      s.coverage.durationMissing,
                    ]),
                  },
                ],
              },
            };
          } else {
            for (const cid of request.circleIds ?? [])
              await core.get(ctx.c, ctx.org.id, cid, "CIRCLE");
            const bounds = meetingExportBounds(request, timezone);
            const candidates = (
              await ctx.c.query(
                "SELECT m.*,e.name AS circle_label FROM meeting_occurrences m JOIN entities e ON e.organization_id=m.organization_id AND e.id=m.circle_id AND NOT e.archived WHERE m.organization_id=$1 AND m.state='CLOSED' AND ($2::uuid[] IS NULL OR m.circle_id=ANY($2::uuid[])) AND ($3::timestamptz IS NULL OR m.start_at >= $3) AND ($4::timestamptz IS NULL OR m.start_at < $4) ORDER BY m.start_at,m.id",
                [
                  ctx.org.id,
                  request.circleIds ?? null,
                  bounds.from,
                  bounds.until,
                ],
              )
            ).rows;
            const rows: MeetingExportRow[] = [],
              documents: ReportRenderDocument[] = [];
            for (const m of candidates) {
              if (!(await mayRead(ctx, m.id, ports, intent))) continue;
              authorizedIds.push(m.id);
              const report = (
                await ctx.c.query(
                  "SELECT * FROM meeting_reports WHERE organization_id=$1 AND meeting_id=$2",
                  [ctx.org.id, m.id],
                )
              ).rows[0];
              if (isReport(request.kind)) {
                const doc = await renderDocument(
                  ctx,
                  m,
                  report,
                  source,
                  asOf,
                  timezone,
                  ports,
                );
                if (doc) {
                  documents.push(doc);
                  refs.push(doc.ref);
                } else excludedUnpublished++;
                if (documents.length > meetingExportBudgets.maxReports)
                  fail(422, "EXPORT_TOO_MANY_REPORTS");
              } else {
                const count = (
                  await ctx.c.query(
                    "SELECT count(*)::int AS count FROM meeting_agenda WHERE organization_id=$1 AND meeting_id=$2",
                    [ctx.org.id, m.id],
                  )
                ).rows[0].count;
                const url = `/meetings/${m.id}`;
                rows.push({
                  meetingId: m.id,
                  title: m.title,
                  circleId: m.circle_id,
                  circleLabel: m.circle_label,
                  type: m.method,
                  status: "CLOSED",
                  plannedStart: iso(m.start_at),
                  plannedEnd: new Date(
                    new Date(m.start_at).getTime() + m.duration_minutes * 60000,
                  ).toISOString(),
                  actualStart: nullableIso(m.started_at),
                  actualEnd: nullableIso(m.closed_at),
                  agendaCount: count,
                  meetingUrl: url,
                  reportUrl: report ? url : null,
                });
              }
            }
            if (request.kind === "MEETING_REPORT_PDF" && documents.length !== 1)
              fail(
                422,
                documents.length
                  ? "EXPORT_REQUIRES_SINGLE_REPORT"
                  : "NO_ELIGIBLE_REPORT",
              );
            result = isReport(request.kind)
              ? {
                  records: [],
                  coverage,
                  estimated: false,
                  documentPackage: {
                    schema: "orgmap-meeting-pdf-bundle-v1",
                    documents,
                    selectionId,
                    asOf,
                    timezone,
                    reportSource: source,
                    coverage,
                    notices: [
                      ...(documents.length
                        ? []
                        : ["EMPTY_AUTHORIZED_SELECTION" as const]),
                      ...(excludedUnpublished
                        ? ["NO_PUBLISHED_REPORT" as const]
                        : []),
                    ],
                  },
                }
              : {
                  records: rows,
                  coverage:
                    "Closed performed meetings only. Frozen planned and actual timestamps, nulls, agenda counts and local URLs. No scheduled, running or cancelled occurrences.",
                  estimated: false,
                  workbook: rowsWorkbook(rows),
                };
          }
          if (Buffer.byteLength(JSON.stringify(result)) > 5 * 1024 * 1024)
            fail(413, "EXPORT_TOO_LARGE");
          await ctx.c.query(
            "INSERT INTO meeting_export_selections(organization_id,id,owner_id,account_id,command_key,kind,format,include_private,report_source,filters,authorized_ids,report_refs,timezone,as_of,frozen_payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
            [
              ctx.org.id,
              selectionId,
              ctx.member.id,
              ctx.account.id,
              key(r),
              request.kind,
              request.format,
              intent,
              source,
              JSON.stringify(request),
              authorizedIds,
              JSON.stringify(refs),
              timezone,
              asOf,
              JSON.stringify(result),
            ],
          );
          const job = await ports.exportJobs!.enqueue(ctx, {
            resourceType: "meeting-export",
            resourceIds: [selectionId],
            exportKind: request.kind,
            format: request.format,
            includePrivate: intent,
            requestId: r.id,
          });
          await core.changed(
            ctx,
            r,
            selectionId,
            intent ? "MeetingPrivateExportRequested" : "MeetingExportRequested",
          );
          return {
            job,
            selectionSummary: {
              id: selectionId,
              kind: request.kind,
              format: request.format,
              meetings: authorizedIds.length,
              reports: refs.length,
              months: request.kind === "MEETING_MONTHLY_STATISTICS" ? 25 : 0,
              excludedUnpublished,
              reportSource: source,
              timezone,
              asOf,
            },
            jobsPath: "/platform/jobs",
          };
        },
      ),
    ),
  );
}
