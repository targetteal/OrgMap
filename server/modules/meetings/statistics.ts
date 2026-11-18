import type { FastifyInstance } from "fastify";
import type { Ctx, ModuleRuntime } from "../../src/runtime.js";
import { Failure, fail, id, digest } from "../../src/core.js";
import {
  access,
  supervisionExport,
  type MeetingReadPolicy,
} from "./service.js";
import { isMeetingGuest } from "./guest.js";
import type {
  MeetingMetric,
  MeetingStatistics,
  MeetingStatisticsInput,
  MeetingStatisticsPort,
  MeetingStatisticsSelection,
  MeetingStatisticsSelectionOptions,
  MeetingDistributionName,
} from "./statistics-contract.js";
export type * from "./statistics-contract.js";

const iso = (value: Date | string) => new Date(value).toISOString();
const inaccessible = (error: unknown) =>
  error instanceof Failure && [403, 404].includes(error.status);
const unknown = { key: null, label: "UNKNOWN" };

/** Only the owning first-close command calls this, after saveReportVersion, in the same UoW.
 * Replays are harmless; GET, report publication, restores and migrations never call it.
 * The migration baseline prevents this helper from manufacturing legacy observations.
 */
export async function captureFirstMeetingClose(
  ctx: Ctx,
  meetingId: string,
): Promise<void> {
  if (ctx.mode === "read") fail(403, "ACTION_DENIED");
  const row = (
    await ctx.c.query(
      `SELECT m.*,r.id AS report_id,v.version AS report_version,v.epoch AS report_epoch,
      v.snapshot AS close_snapshot,s.template_snapshot,e.name AS circle_label
     FROM meeting_occurrences m
     JOIN meeting_reports r ON r.organization_id=m.organization_id AND r.meeting_id=m.id
     JOIN meeting_report_versions v ON v.organization_id=r.organization_id AND v.report_id=r.id
       AND v.reason='Meeting closed'
     JOIN meeting_series s ON s.organization_id=m.organization_id AND s.id=m.series_id
     JOIN meeting_statistics_observation o ON o.organization_id=m.organization_id
     LEFT JOIN entities e ON e.organization_id=m.organization_id AND e.id=m.circle_id AND NOT e.archived
     WHERE m.organization_id=$1 AND m.id=$2 AND m.state='CLOSED'
       AND m.closed_at IS NOT NULL AND m.closed_at>=o.covered_from AND v.created_at>=o.covered_from
     ORDER BY v.version LIMIT 1`,
      [ctx.org.id, id(meetingId)],
    )
  ).rows[0];
  if (!row) fail(409, "MEETING_CLOSE_SNAPSHOT_UNAVAILABLE");
  const source = row.close_snapshot,
    meeting = source?.meeting;
  if (
    !meeting ||
    !Array.isArray(source.participants) ||
    !Array.isArray(source.agenda) ||
    !Array.isArray(source.actions)
  )
    fail(409, "MEETING_CLOSE_SNAPSHOT_UNAVAILABLE");
  // Only values captured at close enter the immutable statistical base. No later template lookup.
  const template = row.template_snapshot ?? {};
  const snapshot = {
    schema: 1,
    roster: source.participants.map((p: any) => ({
      memberId: p.memberId,
      access: p.access,
      attendance: p.attendance,
    })),
    agenda: source.agenda.map((a: any) => ({
      status: a.status,
      skipped: a.skipped === true,
    })),
    actions: source.actions.map((a: any) => ({ state: a.state })),
    facilitatorMemberId: meeting.facilitatorId ?? null,
    method: typeof meeting.method === "string" ? meeting.method : null,
    circle: { id: meeting.circleId ?? null, label: row.circle_label ?? null },
    template: {
      id: typeof template.templateId === "string" ? template.templateId : null,
      version: Number.isInteger(template.version) ? template.version : null,
      label:
        typeof template.name === "string"
          ? template.name
          : typeof template.templateName === "string"
            ? template.templateName
            : null,
    },
  };
  await ctx.c.query(
    `INSERT INTO meeting_first_close_snapshots
       (organization_id,meeting_id,report_id,report_version,report_epoch,occurrence_version,started_at,first_closed_at,snapshot)
     SELECT $1,$2,$3,$4,$5,$6,m.started_at,m.closed_at,$7
       FROM meeting_occurrences m WHERE m.organization_id=$1 AND m.id=$2
     ON CONFLICT(organization_id,meeting_id) DO NOTHING`,
    [
      ctx.org.id,
      row.id,
      row.report_id,
      row.report_version,
      row.report_epoch,
      meeting.version,
      JSON.stringify(snapshot),
    ],
  );
}

/** The same context, including 25 export months, has exactly one PG clock and settings selection. */
const clocks = new WeakMap<Ctx, Promise<{ asOf: string; timezone: string }>>();
export async function selectionClock(core: ModuleRuntime, ctx: Ctx) {
  let clock = clocks.get(ctx);
  if (!clock) {
    clock = (async () => {
      const settings = await core.organizationSettings(ctx);
      const timezone = settings.settings.timezone;
      if (
        typeof timezone !== "string" ||
        !(
          await ctx.c.query("SELECT 1 FROM pg_timezone_names WHERE name=$1", [
            timezone,
          ])
        ).rowCount
      )
        fail(503, "MODULE_CONFIGURATION_UNAVAILABLE");
      return {
        timezone,
        asOf: iso(
          (await ctx.c.query("SELECT clock_timestamp() AS at")).rows[0].at,
        ),
      };
    })();
    clocks.set(ctx, clock);
  }
  return clock;
}
export function createMeetingStatisticsPort(
  core: ModuleRuntime,
  policy?: MeetingReadPolicy,
): MeetingStatisticsPort {
  async function readableCircle(ctx: Ctx, circleId: string) {
    const port = core.foundationStructure();
    return port?.readStructureEntity
      ? port.readStructureEntity(ctx, circleId, "CIRCLE")
      : core.get(ctx.c, ctx.org.id, circleId, "CIRCLE");
  }
  async function computeSelection(
    ctx: Ctx,
    input: MeetingStatisticsInput,
    options: MeetingStatisticsSelectionOptions = {},
  ): Promise<MeetingStatisticsSelection> {
    // These guards also apply when an export invokes the port directly, outside HTTP.
    if (isMeetingGuest(ctx)) fail(404, "RESOURCE_NOT_FOUND");
    await core.assertModuleAvailable(ctx, "meetings");
    if (
      options.purpose === "private-export" &&
      !(await supervisionExport(ctx, policy))
    )
      fail(403, "ACTION_DENIED");
    if (
      !input ||
      typeof input.month !== "string" ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month) ||
      input.month.startsWith("0000")
    )
      fail(400, "INVALID_REQUEST");
    if (
      input.circleIds !== undefined &&
      (!Array.isArray(input.circleIds) || input.circleIds.length > 100)
    )
      fail(400, "INVALID_REQUEST");
    const circleIds = [...new Set((input.circleIds ?? []).map(id))].sort();
    for (const circleId of circleIds) await readableCircle(ctx, circleId);
    const { asOf, timezone } = await selectionClock(core, ctx);
    const period = (
      await ctx.c.query(
        `SELECT ($1::date::timestamp AT TIME ZONE $2) AS start,
        LEAST((($1::date + interval '1 month')::timestamp AT TIME ZONE $2),$3::timestamptz) AS finish,
        to_char($3::timestamptz AT TIME ZONE $2,'YYYY-MM') AS current_month`,
        [input.month + "-01", timezone, asOf],
      )
    ).rows[0];
    if (input.month > period.current_month) fail(400, "INVALID_REQUEST");
    const start = iso(period.start),
      end = iso(period.finish);
    const candidates = (
      await ctx.c.query(
        `SELECT id FROM meeting_occurrences WHERE organization_id=$1 AND start_at>=$2 AND start_at<$3
        AND ($4::uuid[]='{}'::uuid[] OR circle_id=ANY($4::uuid[])) ORDER BY start_at,id`,
        [ctx.org.id, start, end, circleIds],
      )
    ).rows;
    // Authorize before fetching snapshots or counting. Domain DENY/report overrides and supervision remain current.
    const authorized: any[] = [];
    for (const candidate of candidates) {
      try {
        const result = await access(
          ctx,
          candidate.id,
          "read",
          policy,
          options.purpose ?? "read",
        );
        if (!options.excludeSupervised || !result.supervised)
          authorized.push(result.m);
      } catch (error) {
        if (!inaccessible(error)) throw error;
      }
    }
    const authorizedMeetingIds = authorized.map((m) => m.id);
    const snapshots = (
      await ctx.c.query(
        "SELECT *,extract(epoch FROM (first_closed_at-started_at))::float8 AS duration_seconds FROM meeting_first_close_snapshots WHERE organization_id=$1 AND meeting_id=ANY($2::uuid[])",
        [ctx.org.id, authorizedMeetingIds],
      )
    ).rows;
    const byId = new Map(snapshots.map((s) => [s.meeting_id, s]));
    const marker = (
      await ctx.c.query(
        "SELECT covered_from FROM meeting_statistics_observation WHERE organization_id=$1",
        [ctx.org.id],
      )
    ).rows[0];
    const coveredFrom = marker ? iso(marker.covered_from) : null;
    const closed = authorized.filter((m) => m.state === "CLOSED");
    const confirmed = closed.filter((m) => m.closed_at != null);
    const known = closed.filter((m) => byId.has(m.id));
    const snapshotMissing = closed.length - known.length;
    const durations = known
      .map((m) => {
        const s = byId.get(m.id)!;
        if (!s.started_at || !s.first_closed_at) return null;
        const seconds = Number(s.duration_seconds);
        return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
      })
      .filter((n): n is number => n !== null);
    const durationMissing = closed.length - durations.length;
    const rosters = known
      .map((m) => byId.get(m.id)!.snapshot.roster)
      .filter(Array.isArray);
    const agendas = known
      .map((m) => byId.get(m.id)!.snapshot.agenda)
      .filter(Array.isArray);
    const actions = known
      .map((m) => byId.get(m.id)!.snapshot.actions)
      .filter(Array.isArray);
    const validRosters = rosters.filter((r: any[]) =>
      r.every(
        (p: any) =>
          ["READ", "EDIT", "DENY"].includes(p.access) &&
          ["PRESENT", "ABSENT", "INVITED"].includes(p.attendance),
      ),
    );
    const eligibleRoster = validRosters
      .flat()
      .filter((p: any) => p.access !== "DENY");
    const present = eligibleRoster.filter(
      (p: any) => p.attendance === "PRESENT",
    ).length;
    const validActions = actions.filter((a: any[]) =>
      a.every((x: any) => ["OPEN", "DONE"].includes(x.state)),
    );
    const allActions = validActions.flat();
    const doneActions = allActions.filter(
      (a: any) => a.state === "DONE",
    ).length;
    const validAgenda = agendas.filter((a: any[]) =>
      a.every((x: any) =>
        ["OPEN", "COMPLETED", "TRANSFERRED", "WITHDRAWN"].includes(x.status),
      ),
    );
    const allAgenda = validAgenda
      .flat()
      .filter((a: any) => a.status !== "WITHDRAWN");
    const doneAgenda = allAgenda.filter(
      (a: any) => a.status === "COMPLETED" && !a.skipped,
    ).length;
    const facilitatorIds = known
      .map((m) => byId.get(m.id)!.snapshot.facilitatorMemberId)
      .filter((v): v is string => typeof v === "string" && v.length > 0);
    const organizers = new Set(facilitatorIds).size;
    const observedPeriod = coveredFrom !== null && coveredFrom <= start;
    const hasPeriodObservation = coveredFrom !== null && coveredFrom < end;
    let coverageState: MeetingStatistics["coverage"]["state"] = observedPeriod
      ? "OBSERVED"
      : hasPeriodObservation || authorized.length > 0
        ? "PARTIAL"
        : "UNAVAILABLE";
    if (
      coverageState === "OBSERVED" &&
      (snapshotMissing ||
        durationMissing ||
        confirmed.length !== closed.length ||
        validRosters.length !== closed.length ||
        validAgenda.length !== closed.length ||
        validActions.length !== closed.length ||
        facilitatorIds.length !== closed.length)
    )
      coverageState = "PARTIAL";
    const populated = authorized.length > 0 || coverageState !== "UNAVAILABLE";
    const metric = (
      numerator: number,
      denominator: number | null,
      knownCount: number,
      unit: MeetingMetric["unit"],
      average = false,
    ): MeetingMetric => ({
      value:
        !populated || (closed.length > 0 && knownCount === 0)
          ? null
          : average
            ? denominator
              ? numerator / denominator
              : null
            : numerator,
      numerator,
      denominator,
      known: knownCount,
      eligible: closed.length,
      unit,
    });
    const durationTotal = durations.reduce((sum, n) => sum + n, 0);
    const distributions: MeetingStatistics["distributions"] = {
      state: [],
      method: [],
      circle: [],
      template: [],
    };
    const groups = new Map<
      MeetingDistributionName,
      Map<string, { key: string | null; label: string; count: number }>
    >();
    for (const name of ["state", "method", "circle", "template"] as const)
      groups.set(name, new Map());
    const add = (
      name: MeetingDistributionName,
      entry: { key: string | null; label: string },
    ) => {
      const map = groups.get(name)!;
      const key = JSON.stringify([entry.key, entry.label]);
      const previous = map.get(key);
      map.set(key, { ...entry, count: (previous?.count ?? 0) + 1 });
    };
    const circleVisibility = new Map<string, boolean>();
    for (const m of authorized) {
      add("state", { key: m.state, label: m.state });
      const s = byId.get(m.id)?.snapshot;
      add(
        "method",
        s?.method
          ? { key: s.method, label: s.method }
          : m.state !== "CLOSED" && m.method
            ? { key: m.method, label: m.method }
            : unknown,
      );
      const circle = s?.circle;
      let visible = circleVisibility.get(m.circle_id);
      if (visible === undefined) {
        try {
          await readableCircle(ctx, m.circle_id);
          visible = true;
        } catch (error) {
          if (!inaccessible(error)) throw error;
          visible = false;
        }
        circleVisibility.set(m.circle_id, visible);
      }
      // An absent historical label stays UNKNOWN; current names never overwrite old snapshots.
      add(
        "circle",
        visible && circle?.id && circle?.label
          ? { key: circle.id, label: circle.label }
          : unknown,
      );
      add(
        "template",
        s?.template?.id && s?.template?.label
          ? { key: s.template.id, label: s.template.label }
          : unknown,
      );
    }
    for (const name of groups.keys())
      distributions[name] = [...groups.get(name)!.values()].sort(
        (a, b) =>
          (a.key ?? "").localeCompare(b.key ?? "") ||
          a.label.localeCompare(b.label),
      );
    const count = (n: number) => (populated ? n : null);
    return {
      authorizedMeetingIds,
      statistics: {
        period: { month: input.month, start, end, asOf, timezone },
        selection: {
          basis: "AUTHORIZED_OCCURRENCES_BY_PLANNED_START",
          scopeHash: digest(
            JSON.stringify([
              ctx.org.id,
              ctx.member.id,
              input.month,
              circleIds,
              authorizedMeetingIds,
              timezone,
              asOf,
            ]),
          ),
        },
        counts: {
          observed: count(authorized.length),
          realized:
            confirmed.length !== closed.length ? null : count(confirmed.length),
          running: count(
            authorized.filter((m) => m.state === "RUNNING").length,
          ),
          cancelled: count(
            authorized.filter((m) => m.state === "CANCELLED").length,
          ),
        },
        metrics: {
          totalDuration: metric(
            durationTotal,
            null,
            durations.length,
            "SECONDS",
          ),
          averageDuration: metric(
            durationTotal,
            durations.length,
            durations.length,
            "SECONDS",
            true,
          ),
          averageParticipants: metric(
            present,
            validRosters.length,
            validRosters.length,
            "COUNT",
            true,
          ),
          attendanceRate: metric(
            present,
            eligibleRoster.length,
            validRosters.length,
            "RATIO",
            true,
          ),
          actionCompletionRate: metric(
            doneActions,
            allActions.length,
            validActions.length,
            "RATIO",
            true,
          ),
          agendaCompletionRate: metric(
            doneAgenda,
            allAgenda.length,
            validAgenda.length,
            "RATIO",
            true,
          ),
          activeOrganizers: metric(
            organizers,
            null,
            facilitatorIds.length,
            "COUNT",
          ),
        },
        distributions,
        coverage: {
          state: coverageState,
          coveredFrom,
          snapshotKnown: known.length,
          snapshotMissing,
          durationMissing,
          source: "NATIVE_OBSERVATION",
          estimated: false,
        },
      },
    };
  }
  return {
    computeSelection,
    compute: async (ctx, input) =>
      (await computeSelection(ctx, input)).statistics,
  };
}

export function registerMeetingStatistics(
  app: FastifyInstance,
  core: ModuleRuntime,
  policy?: MeetingReadPolicy,
) {
  const port = createMeetingStatisticsPort(core, policy);
  app.get("/api/v1/organizations/:organizationId/meetings/statistics", (r) =>
    core.tenant(r, { mode: "read" }, async (ctx) => {
      if (isMeetingGuest(ctx)) fail(404, "RESOURCE_NOT_FOUND");
      await core.assertModuleAvailable(ctx, "meetings");
      const query = r.query as Record<string, unknown>;
      if (
        Object.keys(query).some((k) => !["month", "circleId"].includes(k)) ||
        (query.month !== undefined && typeof query.month !== "string")
      )
        fail(400, "INVALID_REQUEST");
      const circles =
        query.circleId === undefined
          ? undefined
          : Array.isArray(query.circleId)
            ? query.circleId
            : [query.circleId];
      if (circles?.some((v) => typeof v !== "string"))
        fail(400, "INVALID_REQUEST");
      let month = query.month as string | undefined;
      if (month === undefined) {
        const { asOf, timezone } = await selectionClock(core, ctx);
        month = (
          await ctx.c.query(
            "SELECT to_char($1::timestamptz AT TIME ZONE $2,'YYYY-MM') AS month",
            [asOf, timezone],
          )
        ).rows[0].month;
      }
      return port.compute(ctx, {
        month: month!,
        circleIds: circles as string[] | undefined,
      });
    }),
  );
  return port;
}
