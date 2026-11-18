import { Temporal } from "@js-temporal/polyfill";
/** Calendar keys are civil dates in the saved account time zone, never a parsed display label. */
export function meetingWeek(anchor: string): string[] {
  const date = Temporal.PlainDate.from(anchor),
    first = date.subtract({ days: date.dayOfWeek - 1 });
  return Array.from({ length: 7 }, (_, days) => first.add({ days }).toString());
}
export const shiftMeetingWeek = (anchor: string, weeks: number) =>
  Temporal.PlainDate.from(anchor)
    .add({ days: weeks * 7 })
    .toString();
export function meetingWeekBounds(anchor: string, timeZone: string) {
  const first = Temporal.PlainDate.from(meetingWeek(anchor)[0]),
    last = first.add({ days: 7 });
  return {
    from: first
      .toZonedDateTime({ timeZone, plainTime: "00:00" })
      .toInstant()
      .toString(),
    until: last
      .toZonedDateTime({ timeZone, plainTime: "00:00" })
      .toInstant()
      .toString(),
  };
}
