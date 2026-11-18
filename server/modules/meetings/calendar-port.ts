import type { CalendarEvent } from "../interoperability/calendar.js";
import {
  access,
  supervisionExport,
  type MeetingReadPolicy,
  type MeetingExportIntent,
} from "./service.js";
import { isMeetingGuest } from "./guest.js";
import { Failure, fail } from "../../src/core.js";
/** Called in interop's authenticated tenant transaction. No title from a hidden meeting leaves this context. */
export type MeetingCalendarPort = {
  list(
    ctx: import("../../src/runtime.js").Ctx,
    intent?: MeetingExportIntent,
  ): Promise<CalendarEvent[]>;
};
export function createMeetingCalendarPort(
  policy?: MeetingReadPolicy,
): MeetingCalendarPort {
  return {
    list: async (ctx, intent) => {
      if (isMeetingGuest(ctx)) fail(403, "ACTION_DENIED");
      if (
        intent?.includePrivate === true &&
        !(await supervisionExport(ctx, policy))
      )
        fail(403, "ACTION_DENIED");
      const includeSupervised =
        intent?.includePrivate === true &&
        (await supervisionExport(ctx, policy));
      const rows = (
        await ctx.c.query(
          `SELECT m.* FROM meeting_occurrences m LEFT JOIN meeting_participants p ON p.organization_id=m.organization_id AND p.meeting_id=m.id AND p.member_id=$2 WHERE m.organization_id=$1 AND (p.access IN ('READ','EDIT') OR (p.member_id IS NULL AND $3)) ORDER BY m.start_at,m.id`,
          [ctx.org.id, ctx.member.id, includeSupervised],
        )
      ).rows;
      const events = [];
      for (const m of rows) {
        try {
          await access(
            ctx,
            m.id,
            "read",
            policy,
            intent?.includePrivate === true ? "private-export" : "read",
          );
          events.push({
            uid: m.id + "@orgmap",
            sequence: m.version,
            summary: m.title,
            starts_at: new Date(m.start_at).toISOString(),
            ends_at: new Date(
              new Date(m.start_at).getTime() + m.duration_minutes * 60000,
            ).toISOString(),
            cancelled: m.state === "CANCELLED",
          });
        } catch (e) {
          if (e instanceof Failure && [403, 404].includes(e.status)) continue;
          throw e;
        }
      }
      return events;
    },
  };
}
