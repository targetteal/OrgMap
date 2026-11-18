/** Shell uses /meetings; source URLs remain aliases of the same feature. */
export const meetingBase = "/meetings";
export function resolveMeetingRoute(value: string) {
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  const url = new URL(value, "http://orgmap.local");
  const path = url.pathname
    .replace(/^\/app\/meeting(?=\/|$)/, meetingBase)
    .replace(/\/$/, "");
  const id = path.match(
    /^\/meetings\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
  )?.[1];
  if (
    !id &&
    ![
      "/meetings",
      "/meetings/reports",
      "/meetings/agenda-items",
      "/meetings/templates",
      "/meetings/statistics",
      "/meetings/exports",
    ].includes(path)
  )
    return null;
  return {
    path,
    id,
    sectionId: url.searchParams.get("step"),
    query: url.search,
    hash: url.hash,
  };
}
export const matchesMeetingRoute = (value: string) =>
  resolveMeetingRoute(value) !== null;
export function meetingHref(id?: string, sectionId?: string) {
  return (
    meetingBase +
    (id ? "/" + id : "") +
    (sectionId ? "?step=" + encodeURIComponent(sectionId) : "")
  );
}
