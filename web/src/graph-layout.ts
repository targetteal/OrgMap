import { hierarchy, tree } from "d3-hierarchy";
import type { StructureNode } from "./api";
import { packedNodes, structureForest, type StructureBranch } from "./model";
export type GraphMode = "pack" | "hierarchy" | "network";
export type PlacedNode = StructureNode & {
  x: number;
  y: number;
  r: number;
  depth: number;
  /** Pack mode: free caption height above a circle's children. */
  band?: number;
};
export type Scene = {
  nodes: PlacedNode[];
  links: { source: PlacedNode; target: PlacedNode }[];
  bounds: { x: number; y: number; width: number; height: number };
};
type Branch = StructureBranch;
export function graphScene(
  nodes: StructureNode[],
  mode: GraphMode,
  collapsed: Set<string> = new Set(),
  aspect = 1,
): Scene {
  if (!nodes.length)
    return {
      nodes: [],
      links: [],
      bounds: { x: 0, y: 0, width: 900, height: 900 },
    };
  if (mode === "pack")
    return {
      nodes: packedNodes(nodes),
      links: [],
      bounds: { x: -8, y: -8, width: 916, height: 916 },
    };
  const root = structureForest(nodes);
  const depthOffset = root.node ? 0 : 1;
  const h = hierarchy(root, (d) =>
    d.node && collapsed.has(d.node.nodeId) ? [] : d.children,
  ).sort((a, b) => (a.data.node?.name ?? "").localeCompare(b.data.node?.name ?? "", "pt-BR"));
  let laid;
  if (mode === "hierarchy") laid = tree<Branch>().nodeSize([230, 175])(h);
  else {
    const radius = Math.max(300, h.leaves().length * 16, h.height * 190);
    laid = tree<Branch>()
      .size([2 * Math.PI, radius])
      .separation(
        (a, b) => (a.parent === b.parent ? 1 : 1.6) / Math.max(1, a.depth),
      )(h);
  }
  // The radial network is stretched toward the viewport aspect so wide
  // screens spread labels sideways and tall screens spread them vertically.
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const stretchX = mode === "network" ? Math.min(1.5, Math.max(1, ratio * .85)) : 1,
    stretchY = mode === "network" ? Math.min(1.6, Math.max(1, 1 / ratio)) : 1;
  const placed: PlacedNode[] = laid
    .descendants()
    .filter(n => n.data.node !== null)
    .map((n) => ({
      ...n.data.node!,
      x: mode === "network" ? Math.cos(n.x - Math.PI / 2) * n.y * stretchX : n.x,
      y: mode === "network" ? Math.sin(n.x - Math.PI / 2) * n.y * stretchY : n.y,
      r: mode === "network" ? (n.data.node!.kind === "ROLE" ? 13 : n.depth - depthOffset === 0 ? 34 : 24) : n.data.node!.kind === "CIRCLE" ? 36 : 23,
      depth: n.depth - depthOffset,
    }));
  const lookup = new Map(placed.map((n) => [n.nodeId, n]));
  const links = placed
    .filter((n) => n.parentNodeId && lookup.has(n.parentNodeId))
    .map((n) => ({ source: lookup.get(n.parentNodeId!)!, target: n }));
  // Network labels sit beside their nodes; keep room for them at the sides.
  const horizontal = mode === "hierarchy" ? 120 : 150,
    vertical = mode === "hierarchy" ? 65 : 65;
  const left = Math.min(...placed.map((n) => n.x)) - horizontal,
    right = Math.max(...placed.map((n) => n.x)) + horizontal,
    top = Math.min(...placed.map((n) => n.y)) - vertical,
    bottom = Math.max(...placed.map((n) => n.y)) + vertical;
  const width = Math.max(right - left, 400),
    height = Math.max(bottom - top, 200);
  return {
    nodes: placed,
    links,
    bounds: {
      x: (left + right - width) / 2,
      y: (top + bottom - height) / 2,
      width,
      height,
    },
  };
}
export function ancestorIds(nodes: StructureNode[], ids: Set<string>) {
  const lookup = new Map(nodes.map((n) => [n.nodeId, n]));
  const result = new Set(ids);
  for (const id of ids) {
    let parent = lookup.get(id)?.parentNodeId;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      result.add(parent);
      parent = lookup.get(parent)?.parentNodeId;
    }
  }
  return result;
}
/** Viewport aspect used to stretch the radial network, rounded so small
 * resizes do not relayout the graph. */
export function networkAspect(width: number, height: number) {
  return width > 0 && height > 0 ? Math.round((width / height) * 20) / 20 : 1;
}
