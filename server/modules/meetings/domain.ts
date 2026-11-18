import { fail, id, text } from "../../src/core.js";
export type Section = {
  id: string;
  title: string;
  kind: "CHECKIN" | "AGENDA" | "PROJECTS" | "CUSTOM" | "CHECKOUT";
};
export function sections(v: any): Section[] {
  if (!Array.isArray(v) || !v.length || v.length > 30)
    fail(400, "INVALID_SECTIONS");
  const a: Section[] = v.map((s: any) => {
    if (
      !s ||
      Object.keys(s).some((k) => !["id", "title", "kind"].includes(k)) ||
      !["CHECKIN", "AGENDA", "PROJECTS", "CUSTOM", "CHECKOUT"].includes(s.kind)
    )
      fail(400, "INVALID_SECTIONS");
    return { id: text(s.id, 60), title: text(s.title, 160), kind: s.kind };
  });
  if (new Set(a.map((s) => s.id)).size !== a.length)
    fail(400, "INVALID_SECTIONS");
  return a;
}
export function integer(v: any, min: number, max: number) {
  if (!Number.isInteger(v) || v < min || v > max) fail(400, "INVALID_REQUEST");
  return v as number;
}
export function bool(v: any) {
  if (typeof v !== "boolean") fail(400, "INVALID_REQUEST");
  return v;
}
export function participants(v: any) {
  if (!Array.isArray(v) || v.length > 500) fail(400, "INVALID_PARTICIPANTS");
  const a: {
    memberId: string;
    access: string;
    canManage: boolean;
    canPublish: boolean;
    canRestore: boolean;
    participationRole: string;
    origin: string;
  }[] = v.map((p: any) => {
    if (
      !p ||
      Object.keys(p).some(
        (k) =>
          ![
            "memberId",
            "access",
            "canManage",
            "canPublish",
            "canRestore",
            "participationRole",
          ].includes(k),
      ) ||
      !["READ", "EDIT", "DENY"].includes(p.access) ||
      !["REQUIRED", "OPTIONAL"].includes(p.participationRole ?? "REQUIRED")
    )
      fail(400, "INVALID_PARTICIPANTS");
    return {
      memberId: id(p.memberId),
      access: p.access,
      canManage: bool(p.canManage ?? false),
      canPublish: bool(p.canPublish ?? false),
      canRestore: bool(p.canRestore ?? false),
      participationRole: p.participationRole ?? "REQUIRED",
      origin: "DIRECT",
    };
  });
  if (new Set(a.map((p) => p.memberId)).size !== a.length)
    fail(400, "INVALID_PARTICIPANTS");
  return a;
}
export function policy(v: any) {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !["notesOnlyNoter", "windowDays"].includes(k))
  )
    fail(400, "INVALID_POLICY");
  return {
    notesOnlyNoter: bool(v.notesOnlyNoter ?? false),
    windowDays: integer(v.windowDays ?? 7, 0, 3650),
    dstGap: "SHIFT_FORWARD",
    dstAmbiguous: "EARLIER",
    monthEnd: "SKIP",
  };
}
export function windowOpen(report: any, now = Date.now()) {
  return (
    !report?.first_published_at ||
    report.window_days === 0 ||
    now <
      new Date(report.first_published_at).getTime() +
        report.window_days * 86400000
  );
}
