import { Temporal } from "@js-temporal/polyfill";
import { fail, text } from "../../src/core.js";
export type Rule = {
  frequency: "ONCE" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count: number;
  until?: string;
  byDay?: number[];
  bySetPos?: number;
};
export function rule(value: any): Rule {
  if (
    !value ||
    Object.keys(value).some(
      (k) =>
        ![
          "frequency",
          "interval",
          "count",
          "until",
          "byDay",
          "bySetPos",
        ].includes(k),
    )
  )
    fail(400, "INVALID_RECURRENCE");
  if (
    !["ONCE", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(value.frequency)
  )
    fail(400, "INVALID_RECURRENCE");
  const r = {
    ...value,
    interval: value.interval ?? 1,
    count: value.frequency === "ONCE" ? 1 : (value.count ?? 20),
  };
  if (
    !Number.isInteger(r.interval) ||
    r.interval < 1 ||
    r.interval > 100 ||
    !Number.isInteger(r.count) ||
    r.count < 1 ||
    r.count > 366
  )
    fail(400, "INVALID_RECURRENCE");
  if (
    r.byDay !== undefined &&
    (!Array.isArray(r.byDay) ||
      !r.byDay.length ||
      r.byDay.some((n: any) => !Number.isInteger(n) || n < 1 || n > 7))
  )
    fail(400, "INVALID_RECURRENCE");
  if (
    r.bySetPos !== undefined &&
    (!r.byDay ||
      !Number.isInteger(r.bySetPos) ||
      r.bySetPos === 0 ||
      Math.abs(r.bySetPos) > 5)
  )
    fail(400, "INVALID_RECURRENCE");
  if (r.bySetPos !== undefined && !["MONTHLY", "YEARLY"].includes(r.frequency))
    fail(400, "INVALID_RECURRENCE");
  if (r.until) {
    try {
      Temporal.PlainDateTime.from(r.until);
    } catch {
      fail(400, "INVALID_RECURRENCE");
    }
  }
  return r;
}
export function occurrences(
  local: string,
  zone: string,
  recurrence: Rule,
): { localStart: string; startAt: string; sequence: number }[] {
  try {
    if (!/^(?:UTC|GMT|[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)+)$/.test(zone))
      fail(400, "INVALID_TIME_ZONE");
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(local))
      fail(400, "INVALID_LOCAL_START");
    const start = Temporal.PlainDateTime.from(local),
      result: { localStart: string; startAt: string; sequence: number }[] = [];
    const anchor = start.toPlainDate();
    // Iterate civil days, preserving day-of-month and leap-day rather than clamping.
    for (let d = 0; d < 146100 && result.length < recurrence.count; d++) {
      const date = anchor.add({ days: d }),
        months = (date.year - anchor.year) * 12 + date.month - anchor.month;
      let match = false;
      switch (recurrence.frequency) {
        case "ONCE":
          match = d === 0;
          break;
        case "DAILY":
          match =
            d % recurrence.interval === 0 &&
            (!recurrence.byDay || recurrence.byDay.includes(date.dayOfWeek));
          break;
        case "WEEKLY":
          match =
            Math.floor((d + anchor.dayOfWeek - 1) / 7) % recurrence.interval ===
              0 &&
            (recurrence.byDay ?? [anchor.dayOfWeek]).includes(date.dayOfWeek);
          break;
        case "MONTHLY":
          match =
            months % recurrence.interval === 0 &&
            (recurrence.byDay
              ? recurrence.byDay.includes(date.dayOfWeek)
              : date.day === anchor.day);
          break;
        case "YEARLY":
          match =
            (date.year - anchor.year) % recurrence.interval === 0 &&
            date.month === anchor.month &&
            (recurrence.byDay
              ? recurrence.byDay.includes(date.dayOfWeek)
              : date.day === anchor.day);
          break;
      }
      if (
        match &&
        recurrence.bySetPos &&
        ["MONTHLY", "YEARLY"].includes(recurrence.frequency)
      ) {
        const candidates: number[] = [];
        for (let day = 1; day <= date.daysInMonth; day++)
          if (recurrence.byDay!.includes(date.with({ day }).dayOfWeek))
            candidates.push(day);
        match =
          date.day ===
          candidates[
            recurrence.bySetPos > 0
              ? recurrence.bySetPos - 1
              : candidates.length + recurrence.bySetPos
          ];
      }
      const civil = date.toPlainDateTime(start.toPlainTime());
      if (
        recurrence.until &&
        Temporal.PlainDateTime.compare(
          civil,
          Temporal.PlainDateTime.from(recurrence.until),
        ) > 0
      )
        break;
      if (match)
        result.push({
          localStart: civil.toString(),
          startAt: civil
            .toZonedDateTime(text(zone), { disambiguation: "compatible" })
            .toInstant()
            .toString(),
          sequence: result.length + 1,
        });
      if (recurrence.frequency === "ONCE") break;
    }
    if (!result.length) fail(422, "EMPTY_RECURRENCE");
    if (result.length < recurrence.count && !recurrence.until)
      fail(422, "RECURRENCE_HORIZON_EXCEEDED");
    return result;
  } catch (e: any) {
    if (e.status) throw e;
    return fail(400, "INVALID_CALENDAR");
  }
}
