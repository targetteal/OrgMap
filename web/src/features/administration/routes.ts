export const administrationTabs = [
  "settings",
  "policies",
  "fields",
  "templates",
  "groups",
  "profiles",
  "pages",
  "grants",
] as const;
export type AdministrationTab = (typeof administrationTabs)[number];
/** FeatureContext.path includes query; hash may be supplied separately by the shell. */
export function resolveAdministrationRoute(
  path: string,
): AdministrationTab | null {
  const pathname = path.split(/[?#]/, 1)[0];
  if (pathname === "/administration" || pathname === "/administration/")
    return "settings";
  const match = /^\/administration\/([^/]+)\/?$/.exec(pathname);
  return match && administrationTabs.includes(match[1] as AdministrationTab)
    ? (match[1] as AdministrationTab)
    : null;
}
export const matchesAdministrationRoute = (path: string) =>
  resolveAdministrationRoute(path) !== null;
