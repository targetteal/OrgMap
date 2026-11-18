import { packSiblings, packEnclose } from "d3-hierarchy";
import type { StructureNode } from "./api";
export type StructureBranch = { node: StructureNode | null; children: StructureBranch[] };
export function structureForest(nodes: StructureNode[]) {
  const byId = new Map(nodes.map(node => [node.nodeId, {node, children: []} as StructureBranch]));
  const roots: StructureBranch[] = [];
  for (const item of byId.values()) {
    const parent = item.node!.parentNodeId && byId.get(item.node!.parentNodeId);
    if (parent) parent.children.push(item);
    else roots.push(item);
  }
  return roots.length === 1 ? roots[0] : {node: null, children: roots};
}
function descendantCount(branch: StructureBranch, seen = new Set<StructureBranch>()): number {
  if (seen.has(branch)) return 0;
  seen.add(branch);
  return branch.children.reduce((sum, child) => sum + 1 + descendantCount(child, seen), 0);
}
// Children fill 86% of a circle, shifted down 12%: the free height above
// them (`band`) holds the circle's curved name without touching children.
const FILL = .86, SHIFT = .12, BAND = 1 - FILL + SHIFT;
export function packedNodes(nodes: StructureNode[]) {
  if (!nodes.length) return [];
  const root = structureForest(nodes);
  const positioned: (StructureNode & {x:number; y:number; r:number; depth:number; band:number})[] = [];
  type Disk = { branch: StructureBranch; x: number; y: number; r: number; actualRadius: number };
  const place = (branch: StructureBranch, x: number, y: number, radius: number, depth: number) => {
    const hasChildren = branch.children.length > 0;
    if (branch.node) positioned.push({ ...branch.node, x, y, r: radius, depth, band: hasChildren ? radius * BAND : 0 });
    if (!hasChildren) return;
    // Roles share one size. Circles grow gently (square root, clamped) with
    // their contents so nested roles have room to be read, without letting a
    // large branch dwarf its siblings. The gap is packed and then removed.
    // Larger disks first lets small roles settle into the gaps instead of chaining.
    const children: Disk[] = branch.children.map(child => {
      const actualRadius = child.node?.kind === "CIRCLE" ? Math.min(2.6, Math.max(1.3, Math.sqrt(1 + descendantCount(child)) * .55)) : 1;
      return { branch: child, x: 0, y: 0, r: actualRadius + .045, actualRadius };
    }).sort((a, b) => b.r - a.r);
    packSiblings(children);
    const enclosure = packEnclose(children);
    if (!enclosure || !Number.isFinite(enclosure.r)) return;
    const factor = radius * FILL / enclosure.r;
    for (const child of children) place(child.branch, x + (child.x - enclosure.x) * factor, y + radius * SHIFT + (child.y - enclosure.y) * factor, child.actualRadius * factor, depth + (branch.node ? 1 : 0));
  };
  place(root, 450, 450, 445, 0);
  return positioned;
}
export function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
export function entityPath(node: StructureNode) {
  return `/${node.kind === "CIRCLE" ? "circles" : "roles"}/${node.entityId}`;
}
export function safeDestination(path: string) {
  return path !== "/" &&
    path.startsWith("/") &&
    !path.startsWith("//") &&
    !path.startsWith("/login") &&
    !path.startsWith("/register")
    ? path
    : "/structure";
}

export function structureReturnPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/structure';
  try {
    const url = new URL(value, 'https://orgmap.invalid');
    if (url.origin !== 'https://orgmap.invalid') return '/structure';
    if (url.pathname === '/structure/directory') {
      const viewId=url.searchParams.get('viewId');
      return '/structure/directory'+(viewId&&/^[a-zA-Z0-9_-]{1,120}$/.test(viewId)?'?viewId='+encodeURIComponent(viewId):'');
    }
    if (url.pathname !== '/structure') return '/structure';
    const view = url.searchParams.get('view');
    const savedView = url.searchParams.get('savedView');
    const params = new URLSearchParams();
    if (view && ['pack','hierarchy','network'].includes(view)) params.set('view', view);
    if (savedView && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(savedView)) params.set('savedView', savedView);
    return '/structure' + (params.size ? '?' + params.toString() : '');
  } catch { return '/structure'; }
}

export function platformEntityReturnPath(value: string | null): string | null {
  if (!value?.startsWith("/platform/")) return null;
  try {
    const url = new URL(value, "https://orgmap.invalid");
    if (url.origin !== "https://orgmap.invalid") return null;
    if (!["/platform/favorites", "/platform/search"].includes(url.pathname)) return null;
    const params = new URLSearchParams();
    const q = url.searchParams.get("q");
    const type = url.searchParams.get("type");
    if (url.pathname === "/platform/search") {
      if (q && q.length <= 200) params.set("q", q);
      if (type && /^[a-z][a-z0-9-]{0,49}$/.test(type)) params.set("type", type);
    }
    const focus = url.searchParams.get("focus");
    if (focus && /^resource-entry-(?:role|circle)-[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(focus)) params.set("focus", focus);
    return url.pathname + (params.size ? `?${params}` : "");
  } catch {
    return null;
  }
}
