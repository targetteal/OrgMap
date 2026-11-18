import { digest, fail } from "../../src/core.js";
export type ScheduledTask = {
  id: string;
  version: number;
  starts_at: string | Date | null;
  ends_at: string | Date | null;
};
export type Dependency = {
  predecessor_id: string;
  successor_id: string;
  type: string;
  lag_minutes: number;
};
export function ordered(ids: string[], edges: Dependency[]) {
  const pending = new Set(ids),
    result: string[] = [];
  while (pending.size) {
    const next = [...pending]
      .filter(
        (id) =>
          !edges.some(
            (e) => e.successor_id === id && pending.has(e.predecessor_id),
          ),
      )
      .sort();
    if (!next.length) fail(422, "DEPENDENCY_CYCLE");
    for (const id of next) {
      pending.delete(id);
      result.push(id);
    }
  }
  return result;
}
/** Earliest bounds preserve existing durations; absent dates stay unknown. */
export function previewSchedule(tasks: ScheduledTask[], edges: Dependency[]) {
  const rows = new Map(tasks.map((t) => [t.id, t]));
  const dates = new Map<string, { start: number | null; end: number | null }>();
  const unknown: string[] = [];
  for (const id of ordered(
    tasks.map((t) => t.id),
    edges,
  )) {
    const t = rows.get(id)!;
    let start = t.starts_at ? +new Date(t.starts_at) : null,
      end = t.ends_at ? +new Date(t.ends_at) : null;
    const duration = start !== null && end !== null ? end - start : null;
    for (const e of edges.filter((e) => e.successor_id === id)) {
      const p = dates.get(e.predecessor_id);
      const source = e.type[0] === "F" ? p?.end : p?.start;
      if (source == null || duration === null || start === null) {
        unknown.push(`${e.predecessor_id}:${id}`);
        continue;
      }
      const bound =
        source + e.lag_minutes * 60000 - (e.type[1] === "F" ? duration : 0);
      start = Math.max(start, bound);
      end = start + duration;
    }
    dates.set(id, { start, end });
  }
  const changes = tasks
    .map((t) => {
      const d = dates.get(t.id)!;
      return {
        id: t.id,
        version: t.version,
        startsAt: d.start === null ? null : new Date(d.start).toISOString(),
        endsAt: d.end === null ? null : new Date(d.end).toISOString(),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const plan = {
    changes,
    unknown: unknown.sort(),
    edges: [...edges].sort((a, b) =>
      (a.predecessor_id + a.successor_id).localeCompare(
        b.predecessor_id + b.successor_id,
      ),
    ),
  };
  return { ...plan, planHash: digest(JSON.stringify(plan)) };
}
