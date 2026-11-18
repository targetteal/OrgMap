import type { FeatureDefinition, FeatureModule } from "./feature-contract";
export const moduleLinks = [
  {
    path: "/structure",
    module: "structure",
    label: "Estrutura",
    icon: "structure",
  },
  { path: "/goals", module: "goals", label: "Objetivos", icon: "goals" },
  {
    path: "/projects",
    module: "projects",
    label: "Projetos",
    icon: "projects",
  },
  {
    path: "/meetings",
    module: "meetings",
    label: "Reuniões",
    icon: "meetings",
  },
  { path: "/members", module: "members", label: "Membros", icon: "members" },
] as const;
export function canonicalRoute(value: string) {
  if (!value.startsWith("/") || value.startsWith("//")) return "/structure";
  const url = new URL(value, "http://orgmap.local");
  let path = url.pathname === "/" ? "/structure" : url.pathname;
  for (const [source, target] of [
    ["/app/meeting", "/meetings"],
    ["/app/structure", "/structure"],
    ["/app/members", "/members"],
    ["/app/goal", "/goals"],
    ["/app/project", "/projects"],
  ])
    if (path === source || path.startsWith(source + "/")) {
      path = target + path.slice(source.length);
      break;
    }
  if (path === "/proposals") path = "/structure/proposals";
  if (path === "/agreements") path = "/structure/working-agreements";
  if (path === "/settings/structure") path = "/structure/advanced";
  if (path === "/settings/members") path = "/administration/fields";
  if (path === "/structure/timetravel") path = "/structure/history";
  path = path
    .replace(/^\/structure\/circle\//, "/circles/")
    .replace(/^\/structure\/role\//, "/roles/");
  if(path==='/enrollment'||path==='/reset-password'){for(const key of ['token','code','enrollmentToken','recoveryToken','access_token','id_token','password','newPassword','secret'])url.searchParams.delete(key);url.hash='';}
  return path + url.search + url.hash;
}
export function routeParts(value: string) {
  const canonical = canonicalRoute(value),
    hashIndex = canonical.indexOf("#");
  const matchPath = hashIndex < 0 ? canonical : canonical.slice(0, hashIndex);
  return {
    canonical,
    matchPath,
    pathname: matchPath.split("?")[0],
    hash: hashIndex < 0 ? "" : canonical.slice(hashIndex),
  };
}
export function resolveRoute(
  value: string,
  features: Pick<FeatureDefinition, "id" | "module" | "matches">[],
): { id: string; module: FeatureModule } | null {
  const p = routeParts(value);
  const feature = features.find((f) => f.matches(p.matchPath));
  if (feature) return { id: feature.id, module: feature.module };
  if (
    ["/structure", "/structure/directory", "/structure/history"].includes(
      p.pathname,
    ) ||
    /^\/(?:circles|roles)\//.test(p.pathname)
  )
    return { id: "core-structure", module: "structure" };
  if (p.pathname === "/members" || p.pathname.startsWith("/members/"))
    return { id: "core-members", module: "members" };
  return null;
}

export class NavigationGate {
  private guards = new Map<symbol, () => string | null>();
  register(guard: () => string | null) {
    const id = Symbol();
    this.guards.set(id, guard);
    return () => {
      this.guards.delete(id);
    };
  }
  reason() {
    for (const guard of this.guards.values()) {
      const reason = guard();
      if (reason) return reason;
    }
    return null;
  }
  clear() {
    this.guards.clear();
  }
}
