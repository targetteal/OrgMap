import { fail } from "../../src/core.js";
export type CalendarEvent = {
  uid: string;
  sequence: number;
  summary: string;
  starts_at: Date | string;
  ends_at: Date | string;
  cancelled: boolean;
};
const escape = (s: string) =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
const date = (v: Date | string) =>
  new Date(v)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
// RFC5545 lines fold at 75 octets, never in the middle of a UTF-8 character.
function fold(line: string) {
  let out = "",
    part = "";
  for (const ch of line) {
    if (Buffer.byteLength(part + ch) > 75) {
      out += part + "\r\n";
      part = " ";
    }
    part += ch;
  }
  return out + part;
}
export function calendar(events: CalendarEvent[], stamp = new Date()) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OrgMap//Calendar//PT",
    "CALSCALE:GREGORIAN",
  ];
  for (const e of events)
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escape(e.uid)}`,
      `SEQUENCE:${e.sequence}`,
      `DTSTAMP:${date(stamp)}`,
      `DTSTART:${date(e.starts_at)}`,
      `DTEND:${date(e.ends_at)}`,
      `SUMMARY:${escape(e.summary)}`,
      `STATUS:${e.cancelled ? "CANCELLED" : "CONFIRMED"}`,
      "END:VEVENT",
    );
  return [...lines, "END:VCALENDAR"].map(fold).join("\r\n") + "\r\n";
}
export function validInstant(v: unknown) {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(v) ||
    !Number.isFinite(Date.parse(v))
  )
    fail(400, "INVALID_INSTANT");
  return new Date(v as string);
}
