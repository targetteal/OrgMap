import { fail } from "../../src/core.js";
export const workPriorities = [
  "NONE",
  "LOW",
  "MEDIUM",
  "HIGH",
  "URGENT",
] as const;
export type TaskProperties = {
  priority: (typeof workPriorities)[number];
  estimateMinutes: number | null;
  tags: string[];
};
/** Tags are task-local, ordered, NFC, trimmed and case-sensitive; no shared taxonomy or implicit discovery. */
export function taskProperties(
  raw: Record<string, unknown>,
  previous?: {
    priority: string;
    estimate_minutes: number | null;
    tags: string[];
  },
): TaskProperties {
  const priority =
    raw.priority === undefined ? (previous?.priority ?? "NONE") : raw.priority;
  if (
    typeof priority !== "string" ||
    !workPriorities.includes(priority as TaskProperties["priority"])
  )
    fail(400, "INVALID_TASK_PRIORITY");
  const estimate =
    raw.estimateMinutes === undefined
      ? (previous?.estimate_minutes ?? null)
      : raw.estimateMinutes;
  if (
    estimate !== null &&
    (typeof estimate !== "number" ||
      !Number.isInteger(estimate) ||
      estimate < 0 ||
      estimate > 525600)
  )
    fail(400, "INVALID_TASK_ESTIMATE");
  const value = raw.tags === undefined ? (previous?.tags ?? []) : raw.tags;
  if (!Array.isArray(value) || value.length > 20)
    fail(400, "INVALID_TASK_TAGS");
  const tags = (value as unknown[]).map((tag) => {
    if (typeof tag !== "string") return fail(400, "INVALID_TASK_TAGS");
    const normalized = tag.trim().normalize("NFC");
    if (
      !normalized ||
      Array.from(normalized).length > 50 ||
      /\p{Cc}/u.test(normalized)
    )
      return fail(400, "INVALID_TASK_TAGS");
    return normalized;
  });
  if (new Set(tags).size !== tags.length) fail(400, "DUPLICATE_TASK_TAG");
  return {
    priority: priority as TaskProperties["priority"],
    estimateMinutes: estimate as number | null,
    tags,
  };
}
