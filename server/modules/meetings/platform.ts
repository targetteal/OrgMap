import type { ResourceAccessPort, ResourceAction } from "../platform/ports.js";
import type { Ctx } from "../../src/runtime.js";
import { Failure, fail, id, camel } from "../../src/core.js";
import {
  access,
  detail,
  supervisionRead,
  supervisionExport,
  type MeetingReadPolicy,
  type MeetingExportIntent,
} from "./service.js";
import { isMeetingGuest, guestReport, guestMeetingIds } from "./guest.js";
import { windowOpen } from "./domain.js";
export interface MeetingResourceAdapter extends ResourceAccessPort {
  authorize(
    ctx: Ctx,
    id: string,
    action: ResourceAction,
    intent?: MeetingExportIntent,
  ): Promise<boolean>;
  export(
    ctx: Ctx,
    ids: string[],
    kind: string,
    intent?: MeetingExportIntent,
  ): Promise<{ records: unknown[]; coverage: string; estimated: boolean }>;
}
async function allowed(
  ctx: Ctx,
  mid: string,
  action: ResourceAction,
  policy?: MeetingReadPolicy,
  intent?: MeetingExportIntent,
) {
  try {
    if (isMeetingGuest(ctx) && action !== "read") return false;
    const privateExport =
      action === "export-private" ||
      (action === "export" && intent?.includePrivate === true);
    if (privateExport && !(await supervisionExport(ctx, policy))) return false;
    const { m, p, report, supervised } = await access(
      ctx,
      mid,
      "read",
      policy,
      privateExport ? "private-export" : "read",
    );
    if (supervised)
      return (
        action === "read" ||
        ((action === "export-private" ||
          (action === "export" && intent?.includePrivate === true)) &&
          (await policy?.oversight?.(ctx, "privateOperationalExport")) === true)
      );
    if (action === "export-private")
      return (
        ctx.member.org_role === "OWNER" &&
        (await policy?.oversight?.(ctx, "privateOperationalExport")) === true
      );
    if (action === "read" || action === "export" || action === "follow")
      return true;
    if (action === "comment" || action === "attach")
      return (
        m.state !== "CANCELLED" &&
        p.access === "EDIT" &&
        report?.effective_can_edit !== false &&
        windowOpen(report)
      );
    return false;
  } catch (e) {
    if (e instanceof Failure && [403, 404].includes(e.status)) return false;
    throw e;
  }
}
/** Domain adapters: platform supplies the authorized tenant transaction, never table names. */
export function createMeetingResourceAdapters(policy?: MeetingReadPolicy): {
  meeting: MeetingResourceAdapter;
  report: MeetingResourceAdapter;
} {
  const meeting: MeetingResourceAdapter = {
    supportsPrivateExport: typeof policy?.oversight === "function",
    authorize: (ctx, rid, action, intent) =>
      allowed(ctx, id(rid), action, policy, intent),
    lookup: async (ctx, rid) => {
      try {
        const { m } = await access(ctx, id(rid), "read", policy);
        return { id: m.id, title: m.title };
      } catch (error) {
        if (error instanceof Failure && [403, 404].includes(error.status)) return null;
        throw error;
      }
    },
    search: async (ctx, query, limit) => {
      if (isMeetingGuest(ctx)) {
        if (!policy?.guestAccess) return [];
        const ids = await guestMeetingIds(ctx, policy.guestAccess);
        const rows = (
          await ctx.c.query(
            "SELECT id,title,state FROM meeting_occurrences WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND title ILIKE $3 ORDER BY start_at,id",
            [ctx.org.id, ids, "%" + query.replace(/[\\%_]/g, "\\$&") + "%"],
          )
        ).rows;
        const out = [];
        for (const row of rows) {
          if (await allowed(ctx, row.id, "read", policy))
            out.push({
              type: "meeting",
              id: row.id,
              title: row.title,
              description: row.state,
            });
          if (out.length >= Math.min(Math.max(limit, 1), 100)) break;
        }
        return out;
      }
      const rows = (
        await ctx.c.query(
          `SELECT m.id,m.title,m.state FROM meeting_occurrences m LEFT JOIN meeting_participants p ON p.organization_id=m.organization_id AND p.meeting_id=m.id AND p.member_id=$2 WHERE m.organization_id=$1 AND (p.access IN ('READ','EDIT') OR (p.member_id IS NULL AND $5)) AND m.title ILIKE $3 ORDER BY m.start_at,m.id LIMIT $4`,
          [
            ctx.org.id,
            ctx.member.id,
            "%" + query.replace(/[\\%_]/g, "\\$&") + "%",
            Math.min(Math.max(limit, 1), 100),
            await supervisionRead(ctx, policy),
          ],
        )
      ).rows;
      const items = [];
      for (const m of rows)
        if (await allowed(ctx, m.id, "read", policy))
          items.push({
            type: "meeting",
            id: m.id,
            title: m.title,
            description: m.state,
          });
      return items;
    },
    export: async (ctx, ids, kind, intent) => {
      if (isMeetingGuest(ctx)) fail(403, "ACTION_DENIED");
      if (kind !== "RESOURCES") fail(422, "UNSUPPORTED_EXPORT_KIND");
      const records = [];
      for (const mid of ids) {
        if (!(await allowed(ctx, id(mid), "export", policy, intent)))
          fail(404, "RESOURCE_NOT_FOUND");
        records.push({
          schema: "orgmap-meeting-v1",
          ...(await detail(
            ctx,
            mid,
            policy,
            intent?.includePrivate === true ? "private-export" : "read",
          )),
        });
      }
      return {
        records,
        coverage:
          "Explicit meeting IDs and their current authorized meeting/participants/agenda/actions/notes; no provider synchronization or transcript.",
        estimated: false,
      };
    },
  };
  const reportMeeting = async (ctx: Ctx, rid: string) => {
    const row = (
      await ctx.c.query(
        "SELECT meeting_id FROM meeting_reports WHERE organization_id=$1 AND id=$2",
        [ctx.org.id, id(rid)],
      )
    ).rows[0];
    return row?.meeting_id as string | undefined;
  };
  const report: MeetingResourceAdapter = {
    supportsPrivateExport: typeof policy?.oversight === "function",
    authorize: async (ctx, rid, action, intent) => {
      if (isMeetingGuest(ctx)) {
        if (action !== "read") return false;
        try {
          await guestReport(ctx, rid, policy);
          return true;
        } catch (e) {
          if (e instanceof Failure && [403, 404].includes(e.status))
            return false;
          throw e;
        }
      }
      const mid = await reportMeeting(ctx, rid);
      return mid ? allowed(ctx, mid, action, policy, intent) : false;
    },
    lookup: async (ctx, rid) => {
      try {
        const reportId = id(rid);
        if (isMeetingGuest(ctx)) {
          const result = await guestReport(ctx, reportId, policy);
          return { id: result.report.id, title: result.snapshot.meeting.title,destination:'/meetings/reports?reportId='+encodeURIComponent(result.report.id) };
        }
        const mid = await reportMeeting(ctx, reportId);
        if (!mid) return null;
        const { m } = await access(ctx, mid, "read", policy);
        return { id: reportId, title: m.title,destination:'/meetings/'+encodeURIComponent(mid!) };
      } catch (error) {
        if (error instanceof Failure && [403, 404].includes(error.status)) return null;
        throw error;
      }
    },
    search: async (ctx, query, limit) => {
      if (isMeetingGuest(ctx)) {
        if (!policy?.guestAccess) return [];
        const ids = await policy.guestAccess.guestResourceIds(ctx, {
            context: "meetings",
            kind: "report",
            action: "read",
          }),
          out = [];
        for (const rid of ids) {
          try {
            const r = await guestReport(ctx, rid, policy);
            if (
              r.snapshot.meeting.title
                .toLocaleLowerCase()
                .includes(query.toLocaleLowerCase())
            )
              out.push({
                type: "report",
                id: rid,
                title: r.snapshot.meeting.title,
                description: r.report.state,
              });
          } catch (e) {
            if (!(e instanceof Failure && [403, 404].includes(e.status)))
              throw e;
          }
          if (out.length >= Math.min(Math.max(limit, 1), 100)) break;
        }
        return out;
      }

      const rows = (
        await ctx.c.query(
          `SELECT r.id,r.meeting_id,r.state,m.title FROM meeting_reports r JOIN meeting_occurrences m ON m.organization_id=r.organization_id AND m.id=r.meeting_id LEFT JOIN meeting_participants p ON p.organization_id=m.organization_id AND p.meeting_id=m.id AND p.member_id=$2 WHERE r.organization_id=$1 AND (p.access IN ('READ','EDIT') OR (p.member_id IS NULL AND $5)) AND m.title ILIKE $3 ORDER BY m.start_at,r.id LIMIT $4`,
          [
            ctx.org.id,
            ctx.member.id,
            "%" + query.replace(/[\\%_]/g, "\\$&") + "%",
            Math.min(Math.max(limit, 1), 100),
            await supervisionRead(ctx, policy),
          ],
        )
      ).rows;
      const items = [];
      for (const r of rows)
        if (await allowed(ctx, r.meeting_id, "read", policy))
          items.push({
            type: "report",
            id: r.id,
            title: r.title,
            description: r.state,
          });
      return items;
    },
    export: async (ctx, ids, kind, intent) => {
      if (isMeetingGuest(ctx)) fail(403, "ACTION_DENIED");
      if (kind !== "RESOURCES") fail(422, "UNSUPPORTED_EXPORT_KIND");
      const records = [];
      for (const rid of ids) {
        const mid = await reportMeeting(ctx, rid);
        if (!mid || !(await allowed(ctx, mid, "export", policy, intent)))
          fail(404, "RESOURCE_NOT_FOUND");
        const { report } = await access(
          ctx,
          mid!,
          "read",
          policy,
          intent?.includePrivate === true ? "private-export" : "read",
        );
        const versions = (
          await ctx.c.query(
            "SELECT * FROM meeting_report_versions WHERE organization_id=$1 AND report_id=$2 ORDER BY version",
            [ctx.org.id, rid],
          )
        ).rows.map(camel);
        records.push({
          schema: "orgmap-report-v1",
          report: camel(report),
          versions,
        });
      }
      return {
        records,
        coverage:
          "Explicit report IDs with authorized immutable versions; live notes may be newer than last published snapshot.",
        estimated: false,
      };
    },
  };
  return { meeting, report };
}
