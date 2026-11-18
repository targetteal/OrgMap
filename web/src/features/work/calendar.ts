import {
  dateAtInstant,
  parseDateOnly,
  parseInstant,
  type RegionalPreferences,
} from "../../../../packages/i18n/index.js";
type DatedTask = { startsAt: string | null; endsAt: string | null };
export function shiftWorkDay(day: string, delta: number) {
  const date = new Date(day + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}
export function workTaskOnDay(
  task: DatedTask,
  day: string,
  prefs: RegionalPreferences,
) {
  const start = task.startsAt ? dateAtInstant(task.startsAt, prefs) : null,
    end = task.endsAt ? dateAtInstant(task.endsAt, prefs) : null;
  return start && end
    ? start <= day && end >= day
    : start === day || end === day;
}
export function workTaskHour(
  task: DatedTask,
  day: string,
  prefs: RegionalPreferences,
) {
  if (task.startsAt && dateAtInstant(task.startsAt, prefs) !== day) return 0;
  const instant = task.startsAt ?? task.endsAt;
  if (!instant) return null;
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: prefs.timeZone,
      hour: "numeric",
      hourCycle: "h23",
    }).format(new Date(instant)),
  );
}
/** A civil minute in the account zone, never the browser zone. */
export function workDateTimeValue(
  instant: string | null | undefined,
  prefs: RegionalPreferences,
) {
  if (!instant || !parseInstant(instant)) return "";
  const parts = new Intl.DateTimeFormat("en-US-u-nu-latn", {
    timeZone: prefs.timeZone,
    calendar: "gregory",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
/** A DST gap has no candidate; an overlap has two. Choosing one is explicit in the form. */
export function workDateTimeCandidates(
  value: string,
  prefs: RegionalPreferences,
): string[] {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ||
    !parseDateOnly(value.slice(0, 10)) ||
    Number(value.slice(11, 13)) > 23 ||
    Number(value.slice(14, 16)) > 59
  )
    return [];
  const wall = Date.parse(value + ":00Z"),
    offsets = new Set<number>();
  // Sample both sides of a transition, including half-hour changes and date-line jumps.
  for (let h = -48; h <= 48; h += 6) {
    const probe = wall + h * 3600000;
    offsets.add(
      Date.parse(
        workDateTimeValue(new Date(probe).toISOString(), prefs) + ":00Z",
      ) - probe,
    );
  }
  return [
    ...new Set(
      [...offsets]
        .map((offset) => new Date(wall - offset).toISOString())
        .filter((instant) => workDateTimeValue(instant, prefs) === value),
    ),
  ].sort();
}
export function workDateTimeFromForm(
  form: FormData,
  name: "startsAt" | "endsAt",
  prefs: RegionalPreferences,
) {
  const value = String(form.get(name) ?? "");
  if (!value) return null;
  const candidates = workDateTimeCandidates(value, prefs),
    original = String(form.get(name + "Original") ?? ""),
    chosen = String(form.get(name + "Choice") ?? "");
  // An unchanged minute retains the original seconds and database microseconds.
  if (
    original &&
    parseInstant(original) &&
    workDateTimeValue(original, prefs) === value &&
    (!chosen ||
      chosen === new Date(original).toISOString() ||
      chosen ===
        new Date(Math.floor(+new Date(original) / 60000) * 60000).toISOString())
  )
    return original;
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1 && candidates.includes(chosen)) return chosen;
  throw new Error(
    candidates.length ? "WORK_AMBIGUOUS_LOCAL_TIME" : "WORK_INVALID_LOCAL_TIME",
  );
}
