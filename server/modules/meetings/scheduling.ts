import type { FastifyInstance } from "fastify";
import type { ModuleRuntime, Ctx } from "../../src/runtime.js";
import { body, id, text, version, uuid, fail, camel } from "../../src/core.js";
import { releaseMeetingAgenda } from "./agenda-items.js";
import { integer } from "./domain.js";
import { rule, occurrences } from "./calendar.js";
import {
  access as domainAccess,
  insertOccurrence,
  authorizeMeetingScope as domainScope,
} from "./service.js";
import type { MeetingReadPolicy } from "./service.js";
import { publishMeetingScheduled } from "./notifications.js";
export async function registerScheduling(
  app: FastifyInstance,
  core: ModuleRuntime,
  policy?: MeetingReadPolicy,
) {
  const access = (ctx: Ctx, mid: string, action = "read") =>
    domainAccess(ctx, mid, action, policy);
  const authorizeMeetingScope = (ctx: Ctx, mid: string, scope: unknown) =>
    domainScope(ctx, mid, scope, policy);
  app.post(
    "/api/v1/organizations/:organizationId/meetings/:meetingId/actions/cancel",
    (r) => {
      const mid = id((r.params as any).meetingId);
      return core.tenant(
        r,
        {
          mode: "write",
          authorize: async (ctx) => {
            if ((r.body as any)?.scope === "THIS")
              await access(ctx, mid, "secretaryOperation");
            else await authorizeMeetingScope(ctx, mid, (r.body as any)?.scope);
            return true;
          },
        },
        async (ctx) => {
          const b = body(r, ["scope", "reason"]);
          const { m } = await access(
            ctx,
            mid,
            b.scope === "THIS" ? "secretaryOperation" : "manage",
          );
          version(r, m.version);
          const reason = text(b.reason, 1000);
          if (
            !["THIS", "FUTURE", "ALL"].includes(b.scope) ||
            m.state !== "SCHEDULED"
          )
            fail(409, "STATE_CONFLICT");
          const rows =
            b.scope === "THIS"
              ? [m]
              : (
                  await ctx.c.query(
                    `SELECT * FROM meeting_occurrences WHERE organization_id=$1 AND series_id=$2 AND state='SCHEDULED' AND start_at>clock_timestamp() AND ($3='ALL' OR sequence>=$4)`,
                    [ctx.org.id, m.series_id, b.scope, m.sequence],
                  )
                ).rows;
          for (const row of rows) {
            await access(
              ctx,
              row.id,
              b.scope === "THIS" ? "secretaryOperation" : "manage",
            );
            await ctx.c.query(
              `UPDATE meeting_occurrences SET state='CANCELLED',version=version+1 WHERE organization_id=$1 AND id=$2`,
              [ctx.org.id, row.id],
            );
            await releaseMeetingAgenda(ctx, row.id);
          }
          await core.changed(ctx, r, m.id, "MeetingCancelled");
          return { cancelled: rows.map((x) => x.id), reason };
        },
      );
    },
  );
  app.post(
    "/api/v1/organizations/:organizationId/meetings/:meetingId/actions/delete",
    (r) => {
      const mid = id((r.params as any).meetingId);
      return core.tenant(
        r,
        {
          mode: "write",
          authorize: async (ctx) => {
            await authorizeMeetingScope(ctx, mid, (r.body as any)?.scope);
            return true;
          },
        },
        async (ctx) => {
          const { m } = await access(ctx, mid, "manage"),
            b = body(r, ["scope", "reason"]);
          version(r, m.version);
          if (
            !["THIS", "FUTURE", "ALL"].includes(b.scope) ||
            m.state !== "SCHEDULED"
          )
            fail(409, "STATE_CONFLICT");
          const rows =
            b.scope === "THIS"
              ? [m]
              : (
                  await ctx.c.query(
                    `SELECT * FROM meeting_occurrences WHERE organization_id=$1 AND series_id=$2 AND state='SCHEDULED' AND start_at>clock_timestamp() AND ($3='ALL' OR sequence>=$4)`,
                    [ctx.org.id, m.series_id, b.scope, m.sequence],
                  )
                ).rows;
          for (const row of rows) await deleteOccurrence(ctx, row.id);
          for (const row of rows)
            await ctx.c.query(
              `DELETE FROM meeting_series WHERE organization_id=$1 AND id=$2 AND NOT EXISTS(SELECT 1 FROM meeting_occurrences WHERE organization_id=$1 AND series_id=$2) AND NOT EXISTS(SELECT 1 FROM meeting_series s WHERE s.organization_id=$1 AND s.split_from=$2)`,
              [ctx.org.id, row.series_id],
            );
          await core.changed(ctx, r, m.id, "MeetingDeleted");
          return { deleted: rows.map((x) => x.id) };
        },
      );
    },
  );
  app.post(
    "/api/v1/organizations/:organizationId/meetings/:meetingId/actions/reschedule",
    (r) => {
      const mid = id((r.params as any).meetingId);
      return core.tenant(
        r,
        {
          mode: "write",
          authorize: async (ctx) => {
            if ((r.body as any)?.scope === 'THIS') await access(ctx, mid, 'secretaryOperation');
            else await authorizeMeetingScope(ctx, mid, (r.body as any)?.scope);
            return true;
          },
        },
        async (ctx) => {
          const { m } = await access(ctx, mid, (r.body as any)?.scope === 'THIS' ? 'secretaryOperation' : 'manage'),
            b = body(r, [
              "scope",
              "title",
              "localStart",
              "timeZone",
              "durationMinutes",
              "recurrence",
            ]);
          version(r, m.version);
          if (
            !["THIS", "FUTURE", "ALL"].includes(b.scope) ||
            m.state !== "SCHEDULED"
          )
            fail(409, "STATE_CONFLICT");
          const series = (
            await ctx.c.query(
              "SELECT * FROM meeting_series WHERE organization_id=$1 AND id=$2",
              [ctx.org.id, m.series_id],
            )
          ).rows[0];
          const all = (
            await ctx.c.query(
              "SELECT * FROM meeting_occurrences WHERE organization_id=$1 AND series_id=$2 ORDER BY sequence",
              [ctx.org.id, m.series_id],
            )
          ).rows;
          const now = Date.now(),
            selected = all.filter((x) =>
              b.scope === "THIS"
                ? x.id === mid
                : b.scope === "FUTURE"
                  ? x.sequence >= m.sequence
                  : true,
            );
          const affected = selected.filter(
            (x) =>
              x.state === "SCHEDULED" && new Date(x.start_at).getTime() > now,
          );
          if (!affected.length) fail(409, "NO_FUTURE_OCCURRENCES");
          for (const x of affected) await access(ctx, x.id, b.scope === 'THIS' ? 'secretaryOperation' : 'manage');
          const local = text(
              b.localStart ??
                (b.scope === "ALL" ? series.local_start : m.local_start),
            ),
            zone = text(b.timeZone ?? m.time_zone),
            duration = integer(
              b.durationMinutes ?? m.duration_minutes,
              1,
              10080,
            ),
            title = text(b.title ?? m.title);
          const recurrence =
            b.scope === "THIS"
              ? rule({ frequency: "ONCE" })
              : rule(
                  b.recurrence ?? {
                    ...series.recurrence,
                    count: b.scope === "FUTURE" ? selected.length : all.length,
                  },
                );
          const os = occurrences(local, zone, recurrence);
          let sid = series.id;
          if (b.scope === "FUTURE") {
            sid = uuid();
            await ctx.c.query(
              `INSERT INTO meeting_series(organization_id,id,title,circle_id,local_start,time_zone,duration_minutes,recurrence,template_snapshot,participants,policy,split_from) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
              [
                ctx.org.id,
                sid,
                title,
                series.circle_id,
                local,
                zone,
                duration,
                JSON.stringify(recurrence),
                JSON.stringify(series.template_snapshot),
                JSON.stringify(series.participants),
                JSON.stringify(series.policy),
                series.id,
              ],
            );
          } else if (b.scope === "ALL")
            await ctx.c.query(
              "UPDATE meeting_series SET title=$3,local_start=$4,time_zone=$5,duration_minutes=$6,recurrence=$7,version=version+1 WHERE organization_id=$1 AND id=$2",
              [
                ctx.org.id,
                sid,
                title,
                local,
                zone,
                duration,
                JSON.stringify(recurrence),
              ],
            );
          const changed: string[] = [],
            preserved: string[] = [],
            notifyIds: string[] = [];
          for (let i = 0; i < selected.length; i++) {
            const x = selected[i],
              o = os[i];
            if (!affected.some((a) => a.id === x.id)) {
              preserved.push(x.id);
              continue;
            }
            if (o) {
              await ctx.c.query(
                "UPDATE meeting_occurrences SET series_id=$3,title=$4,start_at=$5,local_start=$6,time_zone=$7,duration_minutes=$8,version=version+1 WHERE organization_id=$1 AND id=$2",
                [
                  ctx.org.id,
                  x.id,
                  sid,
                  title,
                  o.startAt,
                  o.localStart,
                  zone,
                  duration,
                ],
              );
              if(x.title!==title || +new Date(x.start_at)!==+new Date(o.startAt) || x.duration_minutes!==duration || x.time_zone!==zone)notifyIds.push(x.id);
            } else {
              await ctx.c.query(
                `UPDATE meeting_occurrences SET state='CANCELLED',version=version+1 WHERE organization_id=$1 AND id=$2`,
                [ctx.org.id, x.id],
              );
              await releaseMeetingAgenda(ctx, x.id);
            }
            changed.push(x.id);
          }
          if (b.scope !== "THIS")
            for (let i = selected.length; i < os.length; i++) {
              const inserted = await insertOccurrence(
                  ctx,
                  {
                    ...series,
                    id: sid,
                    title,
                    time_zone: zone,
                    duration_minutes: duration,
                  },
                  {
                    ...os[i],
                    sequence:
                      Math.max(...all.map((x) => x.sequence)) +
                      i -
                      selected.length +
                      1,
                  },
                );
              changed.push(inserted);notifyIds.push(inserted);
            }
          await core.changed(ctx, r, sid, "MeetingSeriesRescheduled");
          await publishMeetingScheduled(core,ctx,notifyIds);
          return {
            scope: b.scope,
            seriesId: sid,
            changed,
            preserved,
            meeting: (
              await ctx.c.query(
                "SELECT * FROM meeting_occurrences WHERE organization_id=$1 AND id=$2",
                [ctx.org.id, mid],
              )
            ).rows.map(camel)[0],
          };
        },
      );
    },
  );
}
async function deleteOccurrence(ctx: Ctx, meetingId: string) {
  if (
    (
      await ctx.c.query(
        "SELECT 1 FROM meeting_reports WHERE organization_id=$1 AND meeting_id=$2",
        [ctx.org.id, meetingId],
      )
    ).rowCount
  )
    fail(409, "STATE_CONFLICT");
  await releaseMeetingAgenda(ctx, meetingId);
  const org = ctx.org.id,
    q = (sql: string) => ctx.c.query(sql, [org, meetingId]);
  await q(
    "UPDATE meeting_agenda_items i SET current_placement_id=NULL FROM meeting_agenda a WHERE i.organization_id=$1 AND a.organization_id=i.organization_id AND a.meeting_id=$2 AND i.current_placement_id=a.id",
  );
  await q(
    "UPDATE meeting_agenda_items i SET last_placement_id=NULL FROM meeting_agenda a WHERE i.organization_id=$1 AND a.organization_id=i.organization_id AND a.meeting_id=$2 AND i.last_placement_id=a.id",
  );
  await q(
    "UPDATE meeting_agenda SET transferred_from=NULL WHERE organization_id=$1 AND transferred_from IN (SELECT id FROM meeting_agenda WHERE organization_id=$1 AND meeting_id=$2)",
  );
  await q(
    "DELETE FROM meeting_actions WHERE organization_id=$1 AND meeting_id=$2",
  );
  for (const t of [
    "meeting_o2_treatments",
    "meeting_o2_processes",
    "meeting_o2_panels",
    "meeting_o2_reviews",
  ])
    await q(
      `DELETE FROM ${t} WHERE organization_id=$1 AND meeting_id=$2`,
    );
  await q(
    "DELETE FROM meeting_agenda WHERE organization_id=$1 AND meeting_id=$2",
  );
  for (const t of ["meeting_updates", "meeting_tickets"])
    await q(
      `DELETE FROM ${t} WHERE organization_id=$1 AND meeting_id=$2`,
    );
  await q(
    "DELETE FROM meeting_documents WHERE organization_id=$1 AND meeting_id=$2",
  );
  await q(
    "DELETE FROM meeting_participants WHERE organization_id=$1 AND meeting_id=$2",
  );
  await q(
    "DELETE FROM meeting_occurrences WHERE organization_id=$1 AND id=$2",
  );
}
