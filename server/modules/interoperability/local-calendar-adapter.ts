import type { InteroperabilityPorts } from "./ports.js";
import { fail, text, uuid } from "../../src/core.js";
import { validInstant } from "./calendar.js";
export const localCalendarAdapter: NonNullable<
  InteroperabilityPorts["externalChange"]
> = {
  async apply(ctx, input) {
    const b = input.data as any;
    if (
      !b ||
      typeof b !== "object" ||
      Array.isArray(b) ||
      Object.keys(b).some(
        (k) =>
          ![
            "uid",
            "sequence",
            "summary",
            "startsAt",
            "endsAt",
            "cancelled",
          ].includes(k),
      ) ||
      !Number.isSafeInteger(b.sequence) ||
      b.sequence < 0 ||
      typeof b.cancelled !== "boolean"
    )
      fail(400, "INVALID_CALENDAR_CHANGE");
    const start = validInstant(b.startsAt),
      end = validInstant(b.endsAt);
    if (end <= start) fail(400, "INVALID_INTERVAL");
    const uid = text(b.uid, 255),
      source = "connection:" + input.connectionId;
    const prior = (
      await ctx.c.query(
        "SELECT * FROM interop_calendar_events WHERE organization_id=$1 AND uid=$2",
        [ctx.org.id, uid],
      )
    ).rows[0];
    if (prior && (prior.source !== source || b.sequence <= prior.sequence))
      fail(409, "CALENDAR_SOURCE_OR_SEQUENCE_CONFLICT");
    await ctx.c.query(
      `INSERT INTO interop_calendar_events(organization_id,id,uid,sequence,summary,starts_at,ends_at,source,cancelled) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(organization_id,uid) DO UPDATE SET sequence=excluded.sequence,summary=excluded.summary,starts_at=excluded.starts_at,ends_at=excluded.ends_at,cancelled=excluded.cancelled,version=interop_calendar_events.version+1`,
      [
        ctx.org.id,
        prior?.id ?? uuid(),
        uid,
        b.sequence,
        text(b.summary, 1000),
        start,
        end,
        source,
        b.cancelled,
      ],
    );
  },
};
