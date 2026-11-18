import type { Bootstrap } from "../../api";
import { guestRouteAvailable } from "../../guest-navigation";
import { platformEntityReturnPath } from "../../model";

/** Build local routes only; access is always rechecked by the destination. */
export function resourcePanelDestination(type: string, id: string): string | null {
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id) ||
      !/^[a-z][a-z0-9-]{0,49}$/.test(type)) return null;
  return "/platform/resource/" + encodeURIComponent(type) + "/" + encodeURIComponent(id);
}
export function resourceDestination(type: string, id: string, from?: string, bootstrap?: Bootstrap | null): string | null {
  const panel = resourcePanelDestination(type, id);
  if (!panel) return null;
  const paths: Record<string, string> = {
    circle: "/circles/",
    role: "/roles/",
    member: "/members/",
    project: "/projects/",
    task: "/projects/tasks/",
    goal: "/goals/",
    "key-result": "/goals/key-results/",
    proposal: "/structure/proposals/",
    agreement: "/structure/working-agreements/",
    meeting: "/meetings/",
  };
  if(type === "invitation"){
    if(bootstrap?.membership.memberType==='GUEST')return panel;
    const query=new URLSearchParams({invitationId:id});
    if(bootstrap?.organization?.id)query.set("organizationId",bootstrap.organization.id);
    return "/organization-invitations?"+query;
  }
  const destination = type === "tension" ? "/structure/tensions?tensionId=" + encodeURIComponent(id)
    : Object.hasOwn(paths, type) ? paths[type] + encodeURIComponent(id) : panel;
  if (bootstrap && !guestRouteAvailable(bootstrap, destination)) return panel;
  if ((type === "role" || type === "circle") && from) {
    const source = platformEntityReturnPath(from);
    if (source) {
      const origin = new URL(source, "https://orgmap.invalid");
      if (!origin.searchParams.has("focus")) origin.searchParams.set("focus", `resource-entry-${type}-${id}`);
      return destination + "?from=" + encodeURIComponent(origin.pathname + origin.search);
    }
  }
  return destination;
}
