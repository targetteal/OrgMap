import { fail, id, text, uuid } from "../../src/core.js";

export type ProjectChecklist = { id: string; title: string; items: { id: string; text: string; done: boolean }[] };
export type FieldDefinition = { id: string; name: string; type: "TEXT" | "NUMBER" | "SELECT" | "DATE"; options: string[] };
export type ExternalLink = { id: string; title: string; url: string };
export type PlanningIntent = { recurrence: "WEEKLY" | "MONTHLY" | null; reminderLocal: string | null };
export function projectSectionName(value: unknown): string {
  if (typeof value !== "string") fail(400,"INVALID_PROJECT_SECTION");
  const result=(value as string).trim().normalize("NFC");
  if (Array.from(result).length>200 || /\p{Cc}/u.test(result))fail(400,"INVALID_PROJECT_SECTION");
  return result;
}
/** A durable local reference only. No scheduler, job, notification or recurrence is created. */
export function planningIntent(value: unknown): PlanningIntent {
  const intent = closedRecord(value, ["recurrence", "reminderLocal"], "INVALID_PLANNING_INTENT");
  const recurrence = intent.recurrence ?? null, reminderLocal = intent.reminderLocal ?? null;
  if (![null, "WEEKLY", "MONTHLY"].includes(recurrence)) fail(400, "INVALID_PLANNING_INTENT");
  if (reminderLocal !== null) {
    if (typeof reminderLocal !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(reminderLocal) || !Number.isFinite(Date.parse(reminderLocal + ":00Z")) || new Date(reminderLocal + ":00Z").toISOString().slice(0,16) !== reminderLocal) fail(400, "INVALID_PLANNING_INTENT");
  }
  return { recurrence, reminderLocal };
}
export function externalLinks(value: unknown): ExternalLink[] {
  if (!Array.isArray(value) || value.length > 100) fail(400, "INVALID_EXTERNAL_LINKS");
  const seen = new Set<string>();
  return (value as unknown[]).map(raw => {
    const link = closedRecord(raw, ["id", "title", "url"]), key = id(link.id).toLowerCase();
    if (seen.has(key) || typeof link.url !== "string" || link.url.length > 4000 || /[\p{Cc}]/u.test(link.url)) fail(400, "INVALID_EXTERNAL_LINKS");
    seen.add(key);
    let url: URL; try { url = new URL(link.url); } catch { return fail(400, "INVALID_EXTERNAL_LINKS"); }
    if (!["http:", "https:"].includes(url!.protocol) || !url!.hostname || url!.username || url!.password) fail(400, "INVALID_EXTERNAL_LINKS");
    return { id: key, title: text(link.title), url: url!.href };
  });
}
export function closedRecord(value: unknown, keys: readonly string[], code = "INVALID_PROJECT_CONTENT"): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) fail(400, code);
  return value as Record<string, any>;
}
export function projectChecklists(value: unknown): ProjectChecklist[] {
  if (!Array.isArray(value) || value.length > 50) fail(400, "INVALID_PROJECT_CHECKLISTS");
  const ids = new Set<string>();
  const identity = (value: unknown) => { const key = id(value).toLowerCase(); if (ids.has(key)) fail(400, "DUPLICATE_CHECKLIST_ID"); ids.add(key); return key; };
  let total = 0;
  return (value as unknown[]).map(raw => {
    const c = closedRecord(raw, ["id", "title", "items"]);
    if (!Array.isArray(c.items) || (total += c.items.length) > 1000) fail(400, "INVALID_PROJECT_CHECKLISTS");
    return { id: identity(c.id), title: text(c.title), items: c.items.map((raw: unknown) => {
      const i = closedRecord(raw, ["id", "text", "done"]);
      if (typeof i.done !== "boolean") fail(400, "INVALID_PROJECT_CHECKLISTS");
      return { id: identity(i.id), text: text(i.text, 1000), done: i.done };
    }) };
  });
}
export function freshProjectChecklists(value: ProjectChecklist[], reset: boolean): ProjectChecklist[] {
  return value.map(c => ({ ...c, id: uuid(), items: c.items.map(i => ({ ...i, id: uuid(), done: reset ? false : i.done })) }));
}
export function fieldDefinitions(value: unknown): FieldDefinition[] {
  if (!Array.isArray(value) || value.length > 20) fail(400, "INVALID_FIELD_DEFINITIONS");
  const ids = new Set<string>(), names = new Set<string>();
  return (value as unknown[]).map(raw => {
    const f = closedRecord(raw, ["id", "name", "type", "options"], "INVALID_FIELD_DEFINITIONS");
    const key = id(f.id).toLowerCase(), name = text(f.name, 80).normalize("NFC");
    if (ids.has(key) || names.has(name.toLocaleLowerCase()) || !["TEXT", "NUMBER", "SELECT", "DATE"].includes(f.type) || !Array.isArray(f.options ?? []) || (f.options ?? []).length > 100) fail(400, "INVALID_FIELD_DEFINITIONS");
    ids.add(key); names.add(name.toLocaleLowerCase());
    const options = (f.options ?? []).map((o: unknown) => text(o, 200));
    if (new Set(options).size !== options.length || (f.type === "SELECT" ? !options.length : options.length > 0)) fail(400, "INVALID_FIELD_DEFINITIONS");
    return { id: key, name, type: f.type, options };
  });
}
export function validFieldValue(field: FieldDefinition, value: unknown): boolean {
  if (value === null) return true;
  if (field.type === "NUMBER") return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
  if (typeof value !== "string") return false;
  if (field.type === "SELECT") return field.options.includes(value);
  if (field.type === "DATE") return /^\d{4}-\d\d-\d\d$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  return value.length <= 1000 && !/[\r\n]/.test(value);
}
