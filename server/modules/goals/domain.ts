import { fail } from "../../src/core.js";
import { Temporal } from "@js-temporal/polyfill";
export function currentMonthWindow(zone: string, asOf: string) {
  const today = Temporal.Instant.from(asOf).toZonedDateTimeISO(zone).toPlainDate();
  const start = today.with({day:1});
  return {startsOn:start.toString(),endsOn:start.add({months:1}).subtract({days:1}).toString()};
}
/** Inclusive interval: [start, start + N calendar months), with constrained month end. */
export function calendarPeriodEnd(start: unknown, frequency: unknown): string {
  const civil = date(start);
  if (typeof frequency !== "number" || !Number.isInteger(frequency) || frequency < 1 || frequency > 120)
    fail(400, "INVALID_REQUEST");
  try {
    return date(Temporal.PlainDate.from(civil).add({months:frequency as number}, {overflow:"constrain"}).subtract({days:1}).toString());
  } catch { return fail(400,"INVALID_REQUEST"); }
}
export const FORMULA = "orgmap-progress-v1";
export function decimal(value: unknown): number {
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(value)
  )
    fail(400, "INVALID_REQUEST");
  const n = Number(value);
  if (!Number.isFinite(n)) fail(400, "INVALID_REQUEST");
  return n;
}
export function choice<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T {
  if (typeof value !== "string" || !allowed.includes(value as T))
    fail(400, "INVALID_REQUEST");
  return value as T;
}
export function bool(value: unknown): boolean {
  if (typeof value !== "boolean") fail(400, "INVALID_REQUEST");
  return value as boolean;
}
export function date(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value + "T00:00:00Z")) ||
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value
  )
    fail(400, "INVALID_REQUEST");
  return value as string;
}
export type Progress = {
  raw: number | null;
  display: number | null;
  reason: string | null;
  formulaVersion: string;
};
/** Keep six-place input precision through subtraction, including large baselines. */
function units(value: unknown): bigint {
  decimal(value);
  const [whole, fraction = ""] = (value as string).split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}
export function progress(
  initial: unknown,
  current: unknown,
  target: unknown,
): Progress {
  const a = units(initial),
    b = units(current),
    c = units(target);
  if (c <= 0n || c === a) fail(422, "DOMAIN_INVARIANT");
  const raw = Number(100n * (b - a)) / Number(c - a);
  return {
    raw,
    display: Math.min(100, Math.max(0, raw)),
    reason: null,
    formulaVersion: FORMULA,
  };
}
export type Contributor = {
  id: string;
  progress: number | null;
  weight: string;
  excluded?: boolean;
  archived?: boolean;
};
export function average(items: Contributor[]): number | null {
  const active = items.filter(
    (x) => !x.excluded && !x.archived && decimal(x.weight) > 0,
  );
  const denominator = active.reduce((s, x) => s + decimal(x.weight), 0);
  if (!denominator || active.some((x) => x.progress === null)) return null;
  return (
    active.reduce((s, x) => s + x.progress! * decimal(x.weight), 0) /
    denominator
  );
}
export function aggregate(
  source: string,
  manual: string,
  kr: Contributor[],
  children: Contributor[],
  krWeight: string,
  childWeight: string,
): Progress {
  const k = decimal(krWeight),
    c = decimal(childWeight);
  if (source === "BOTH" && Math.abs(k + c - 100) > 1e-9)
    fail(422, "DOMAIN_INVARIANT");
  const a = average(kr),
    b = average(children);
  let raw: number | null =
    source === "MANUAL"
      ? decimal(manual)
      : source === "KEY_RESULTS"
        ? a
        : source === "CHILD_GOALS"
          ? b
          : (k > 0 && a === null) || (c > 0 && b === null)
            ? null
            : ((a ?? 0) * k + (b ?? 0) * c) / 100;
  return {
    raw,
    display: raw === null ? null : Math.min(100, Math.max(0, raw)),
    reason: raw === null ? "NO_KNOWN_CONTRIBUTORS" : null,
    formulaVersion: FORMULA,
  };
}
