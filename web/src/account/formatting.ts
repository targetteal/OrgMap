export type RegionalPreferences = {
  locale: string;
  timeZone: string;
  dateFormat: string;
  reducedMotion: boolean;
  theme: string;
};
export function formatAccountDate(
  value: string | Date,
  preferences?: RegionalPreferences,
  includeTime = false,
) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  const locale = preferences?.locale ?? "pt-BR",
    zone = preferences?.timeZone ?? "America/Sao_Paulo";
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: zone,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const year = get("year"),
    month = get("month"),
    day = get("day");
  const format = preferences?.dateFormat ?? "DD/MM/YYYY";
  const result =
    format === "YYYY-MM-DD"
      ? `${year}-${month}-${day}`
      : format === "MM/DD/YYYY"
        ? `${month}/${day}/${year}`
        : `${day}/${month}/${year}`;
  return includeTime
    ? result +
        " " +
        new Intl.DateTimeFormat(locale, {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: zone,
        }).format(date)
    : result;
}
export function preferencesPayload(preferences: RegionalPreferences) {
  return {
    locale: preferences.locale,
    timeZone: preferences.timeZone,
    dateFormat: preferences.dateFormat,
    theme: preferences.theme,
    reducedMotion: preferences.reducedMotion,
  };
}
