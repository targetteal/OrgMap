import { SUPPORTED_LOCALES } from "../../localization";

export type RegionalOption = { value: string; label: string };
export type RegionalGroup = { label: string; options: RegionalOption[] };

const capitalize = (text: string, locale: string) =>
  text ? text.charAt(0).toLocaleUpperCase(locale) + text.slice(1) : text;

/** Interface languages OrgMap ships; the current stored value is always kept as an option. */
export function localeOptions(uiLocale: string, current: string): RegionalOption[] {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([uiLocale], { type: "language" });
  } catch {
    names = null;
  }
  const label = (code: string) => {
    try {
      const name = names?.of(code);
      return name ? capitalize(name, uiLocale) : code;
    } catch {
      return code;
    }
  };
  const values: string[] = [...SUPPORTED_LOCALES];
  if (current && !values.includes(current)) values.unshift(current);
  return values.map((value) => ({ value, label: label(value) }));
}

/** "UTC−03:00" style offset for a zone at the current instant. */
export function timeZoneOffset(zone: string, at = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value;
    if (!part || part === "GMT") return "UTC";
    return part.replace(/^GMT/, "UTC").replace("-", "−");
  } catch {
    return "";
  }
}

const regionCodes: Record<string, string> = {
  Africa: "002",
  America: "019",
  Antarctica: "AQ",
  Asia: "142",
  Australia: "009",
  Pacific: "009",
  Europe: "150",
};

/**
 * IANA zones known to this browser (the server validates any zone Intl accepts),
 * grouped by continent and labelled "City (UTC±hh:mm)". The stored value stays selectable.
 */
export function timeZoneGroups(uiLocale: string, current: string, otherLabel: string): RegionalGroup[] {
  let zones: string[] = [];
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    zones = [];
  }
  if (current && !zones.includes(current)) zones = [current, ...zones];
  let regions: Intl.DisplayNames | null = null;
  try {
    regions = new Intl.DisplayNames([uiLocale], { type: "region" });
  } catch {
    regions = null;
  }
  const now = new Date();
  const grouped = new Map<string, RegionalOption[]>();
  for (const zone of zones) {
    const [prefix] = zone.split("/");
    const code = regionCodes[prefix];
    let group = otherLabel;
    if (code) {
      try {
        group = regions?.of(code) ?? otherLabel;
      } catch {
        group = otherLabel;
      }
    }
    const city = (zone.split("/").pop() ?? zone).replace(/_/g, " ");
    const offset = timeZoneOffset(zone, now);
    const list = grouped.get(group) ?? [];
    list.push({ value: zone, label: offset ? `${city} (${offset})` : city });
    grouped.set(group, list);
  }
  const collator = new Intl.Collator(uiLocale);
  return [...grouped.entries()]
    .sort(([a], [b]) => (a === otherLabel ? 1 : b === otherLabel ? -1 : collator.compare(a, b)))
    .map(([label, options]) => ({ label, options: options.sort((a, b) => collator.compare(a.label, b.label)) }));
}
