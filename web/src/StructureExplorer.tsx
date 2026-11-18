import { StructureCreateMenu } from "./StructureCreateMenu";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { useAccessibility } from "./accessibility";
import { toPlainText } from "../../packages/content";
import {
  CircleDot,
  List,
  Waypoints,
  Filter,
  Search,
  X,
  Settings2,
  Plus,
  Minus,
  Maximize,
  Lock,
  Unlock,
  Map as MapIcon,
  Info,
  RotateCcw,
  Bookmark,
} from "lucide-react";
import type { FeatureContext } from "./feature-contract";
import type { StructureNode } from "./api";
import {governanceVocabulary} from './governance-vocabulary';
import {
  StructureViews,
  type SavedStructureView,
  type StructureViewConfig,
  type ViewGraph,
} from "./StructureViews";
import { errorMessage } from "./api";
import {StructureIcon} from "./StructureIcon";
import { Button, Notice } from "./ui";
import { entityPath, structureReturnPath, initials } from "./model";
import {
  graphScene,
  ancestorIds,
  networkAspect,
  type GraphMode,
  type PlacedNode,
} from "./graph-layout";
import "./structure-explorer.css";
type Quick =
  "none" | "my-roles" | "my-circles" | "no-purpose" | "members-no-role";
export type ExplorerSnapshot = {
  selectedViewId?: string;
  appliedConfig?: StructureViewConfig;
  savedMatchIds?: string[];
  savedCoverage?: ViewGraph["coverage"];
  mode: GraphMode;
  quick: Quick;
  memberFilter: string;
  circleFilter: string;
  kindFilter: string;
  query: string;
  highlight: "none" | "mine" | "vacant";
  directoryCollapsed?: string[];
  directoryScrollTop?: number;
  searchOpen?: boolean;
  labels: boolean;
  avatars: boolean;
  minimap: boolean;
  locked: boolean;
  collapsed: string[];
  scale: number;
  focusedCircle?: string | null;
  pan: { x: number; y: number };
};
// Map labels follow DESIGN.md: 7.5–16px on screen, full name, curved margin.
// Anything that cannot be drawn at the legible floor is omitted, not shrunk.
const MAP_LABEL_MIN = 7.5;
function labelWidth(line: string) {
  return [...line].reduce((sum, ch) => sum + (/[MW@%]/.test(ch) ? .95 : /[ilI., ]/.test(ch) ? .3 : .6), 0);
}
function labelRows(name: string) {
  const words = name.trim().split(/\s+/);
  const options = [[name.trim()]];
  for (let count=2;count<=Math.min(3,words.length);count++) {
    const rows: string[]=[];let row="",remainingLength=name.length,remainingRows=count;
    for(const word of words){const target=remainingLength/remainingRows;if(row && row.length+word.length+1>target && remainingRows>1){rows.push(row);remainingLength-=row.length+1;remainingRows--;row=word;}else row=row?row+" "+word:word;}
    if(row)rows.push(row);options.push(rows);
  }
  return options;
}
type PackLabel = { lines: string[]; font: number; y: number };
function fitPackLabel(node: PlacedNode, screenScale: number, centerY = node.y, bottom = Infinity, maxPx = 16, inset = .92): PackLabel | null {
  const radius = node.r * inset;
  let best: PackLabel | null = null;
  for (const lines of labelRows(node.name)) {
    const longest = Math.max(...lines.map(labelWidth));
    // Bound the text block by the circular chord at its furthest vertical edge.
    for (let trial = Math.min(maxPx / screenScale, radius * .42); trial * screenScale >= MAP_LABEL_MIN; trial -= .25 / screenScale) {
      const half = trial * (lines.length * .6 + .15);
      if (centerY + half > bottom) continue;
      const edge = Math.abs(centerY - node.y) + half;
      const chord = edge < radius ? 2 * Math.sqrt(radius * radius - edge * edge) : 0;
      if (longest * trial <= chord) { if (!best || trial > best.font) best = { lines, font: trial, y: centerY }; break; }
    }
  }
  return best;
}
function PackLabelText({node, label, opacity}: {node: PlacedNode; label: PackLabel; opacity: number}) {
  const {lines, font, y} = label;
  return <text className="mare-fitted-label" x={node.x} y={y} textAnchor="middle" dominantBaseline="middle" pointerEvents="none" opacity={opacity} style={{fontSize:font}} aria-hidden="true">{lines.map((line,i)=><tspan key={i} x={node.x} dy={i===0 ? -(lines.length-1)*.6*font : 1.2*font}>{line}</tspan>)}</text>;
}
/** A circle with contents names itself along its inner top edge, inside the
 * band that the pack layout keeps free of children. */
function CircleArcLabel({node, screenScale, opacity, pathId}: {node: PlacedNode; screenScale: number; opacity: number; pathId: string}) {
  const band = node.band ?? node.r * .26;
  const arcFont = (span: number) => Math.min(18 / screenScale, node.r * .13, band * .5, 2 * span * node.r * .86 * .92 / Math.max(1, labelWidth(node.name)));
  // A longer arc gives long names room before giving up on the curved form.
  const span = arcFont(1.05) * screenScale >= MAP_LABEL_MIN ? 1.05 : 1.45;
  const font = arcFont(span);
  if (font * screenScale < MAP_LABEL_MIN) {
    // Too small for the curved band: when possible, name the circle across its
    // centre with a halo. Its children are then unnamed texture, so nothing competes.
    const label = fitPackLabel(node, screenScale, node.y, Infinity, 13, .9);
    if (!label) return null;
    return <g pointerEvents="none" aria-hidden="true" opacity={opacity} className="mare-circle-badge" style={{["--sx-halo" as string]:`var(--mare-map-level-${Math.min(5, node.depth + 1)})`}}><PackLabelText node={node} label={label} opacity={1}/></g>;
  }
  const baseline = node.r - Math.max(3 / screenScale, node.r * .025) - font * .78;
  const dx = baseline * Math.sin(span), dy = baseline * Math.cos(span);
  return <g pointerEvents="none" aria-hidden="true" opacity={opacity}>
    <path id={pathId} d={`M${node.x - dx},${node.y - dy} A${baseline},${baseline} 0 0 1 ${node.x + dx},${node.y - dy}`} fill="none" stroke="none"/>
    <text className="mare-fitted-label mare-arc-label" style={{fontSize:font}}><textPath href={"#" + pathId} startOffset="50%" textAnchor="middle">{node.name}</textPath></text>
  </g>;
}
type NetworkLabel = { node: PlacedNode; x: number; y: number; anchor: "start" | "middle" | "end"; font: number };
/** Place network labels outward from the root, in priority order (root,
 * circles by depth, then roles), skipping any that would collide on screen. */
function networkLabels(nodes: PlacedNode[], screenScale: number, always?: string | null, view?: {x1:number;y1:number;x2:number;y2:number}): NetworkLabel[] {
  const root = nodes.find(n => n.depth === 0) ?? nodes[0];
  if (!root) return [];
  const rank = (n: PlacedNode) => (n.kind === "ROLE" ? 100 : 0) + n.depth;
  const order = [...nodes].sort((a, b) => (a.nodeId === always ? -1 : b.nodeId === always ? 1 : rank(a) - rank(b)));
  const boxes: {x1:number;y1:number;x2:number;y2:number}[] = [];
  const discs = nodes.map(n => ({id: n.nodeId, x: n.x * screenScale, y: n.y * screenScale, r: n.r * screenScale + 2}));
  const result: NetworkLabel[] = [];
  for (const n of order) {
    const font = n.kind === "ROLE" ? 12 : n.depth === 0 ? 14 : 13;
    const w = labelWidth(n.name) * font * .9 + 6, h = font * 1.3;
    const cx = n.x * screenScale, cy = n.y * screenScale, gap = n.r * screenScale + 5;
    const angle = n === root ? Math.PI / 2 : Math.atan2(n.y - root.y, n.x - root.x);
    const candidates: [number, number, NetworkLabel["anchor"]][] = [];
    const dx = Math.cos(angle), dy = Math.sin(angle);
    if (Math.abs(dx) > .38) candidates.push([cx + dx * gap, cy + dy * gap * .6, dx > 0 ? "start" : "end"]);
    else candidates.push([cx + dx * gap * .4, cy + dy * (gap + h / 2), "middle"]);
    if (n.kind === "CIRCLE") candidates.push([cx, cy + gap + h / 2, "middle"], [cx, cy - gap - h / 2, "middle"], [cx + gap, cy, "start"], [cx - gap, cy, "end"], [cx + gap * .7, cy + gap * .7 + h / 2, "start"], [cx - gap * .7, cy + gap * .7 + h / 2, "end"], [cx + gap * .7, cy - gap * .7 - h / 2, "start"], [cx - gap * .7, cy - gap * .7 - h / 2, "end"]);
    for (const [x, y, anchor] of candidates) {
      const x1 = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2, box = {x1, y1: y - h / 2, x2: x1 + w, y2: y + h / 2};
      const outside = !!view && (box.x1 < view.x1 || box.x2 > view.x2 || box.y1 < view.y1 || box.y2 > view.y2);
      const hits = n.nodeId !== always && (outside || boxes.some(o => box.x1 < o.x2 + 2 && box.x2 + 2 > o.x1 && box.y1 < o.y2 + 1 && box.y2 + 1 > o.y1) ||
        discs.some(d => d.id !== n.nodeId && Math.hypot(Math.max(box.x1, Math.min(d.x, box.x2)) - d.x, Math.max(box.y1, Math.min(d.y, box.y2)) - d.y) < d.r));
      if (hits) continue;
      boxes.push(box);
      result.push({node: n, x: x / screenScale, y: y / screenScale, anchor, font: font / screenScale});
      break;
    }
  }
  return result;
}
function urlMode(path: string): GraphMode | undefined {
  const value = new URLSearchParams(path.split("?")[1] ?? "").get("view");
  return value === "pack" || value === "hierarchy" || value === "network"
    ? value
    : undefined;
}
export function StructureExplorer({
  context,
  onCreateCircle,
  initialState,
  onStateChange,
}: {
  context: FeatureContext;
  onCreateCircle?: () => void;
  initialState?: ExplorerSnapshot;
  onStateChange?: (state: ExplorerSnapshot) => void;
}) {
  const { structure, members, bootstrap, navigate } = context;
  const { effectiveReducedMotion } = useAccessibility();
  const vocabulary=governanceVocabulary(bootstrap);
  const lockTooltipId = useId();
  const arcIdPrefix = "sx-arc-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const requestedMode = urlMode(context.path) ?? initialState?.mode ?? "pack";
  const initialMode = bootstrap.governanceModel && requestedMode === "hierarchy" ? "pack" : requestedMode;
  const compatible = initialState?.mode === initialMode;
  const [mode, setMode] = useState<GraphMode>(initialMode),
    [popup, setPopup] = useState<
      "filter" | "highlight" | "options" | "search" | "legend" | "views" | null
    >(context.selectedEntity ? null : initialState?.searchOpen ? "search" : null);
  const [quick, setQuick] = useState<Quick>(initialState?.quick ?? "none"),
    [memberFilter, setMemberFilter] = useState(
      initialState?.memberFilter ?? "",
    ),
    [circleFilter, setCircleFilter] = useState(
      initialState?.circleFilter ?? "",
    ),
    [kindFilter, setKindFilter] = useState(initialState?.kindFilter ?? ""),
    [query, setQuery] = useState(initialState?.query ?? ""),
    [highlight, setHighlight] = useState<"none" | "mine" | "vacant">(
      initialState?.highlight ?? "none",
    );
  const [labels, setLabels] = useState(initialState?.labels ?? true),
    [avatars, setAvatars] = useState(initialState?.avatars ?? true),
    [minimap, setMinimap] = useState(initialState?.minimap ?? false),
    [locked, setLocked] = useState(initialState?.locked ?? false),
    [collapsed, setCollapsed] = useState<Set<string>>(
      new Set(compatible ? (initialState?.collapsed ?? []) : []),
    ),
    [scale, setScale] = useState(compatible ? (initialState?.scale ?? 1) : 1),
    [pan, setPan] = useState(
      compatible ? (initialState?.pan ?? { x: 0, y: 0 }) : { x: 0, y: 0 },
    );
  const [selectedViewId, setSelectedViewId] = useState(
      initialState?.selectedViewId ?? "",
    ),
    [appliedConfig, setAppliedConfig] = useState<
      StructureViewConfig | undefined
    >(initialState?.appliedConfig),
    [savedMatchIds, setSavedMatchIds] = useState<Set<string> | null>(
      initialState?.savedMatchIds ? new Set(initialState.savedMatchIds) : null,
    ),
    [viewLoadError, setViewLoadError] = useState(""),
    [viewLoading, setViewLoading] = useState(false);
  const lastValidatedView = useRef("");
  const popupTrigger = useRef<HTMLElement | null>(null);
  const [inspectedNode, setInspectedNode] = useState<string | null>(null);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [focusedCircle, setFocusedCircle] = useState<string | null>(() => (compatible ? initialState?.focusedCircle : null) ?? structure.nodes.find(node => node.entityId === bootstrap.rootCircleId)?.nodeId ?? null);
  const cameraAnimation = useRef<{
    frameId: number;
    targetScale: number;
    targetPan: { x: number; y: number };
  } | null>(null);
  useLayoutEffect(() => () => {
    if (cameraAnimation.current) cancelAnimationFrame(cameraAnimation.current.frameId);
    cameraAnimation.current = null;
  }, []);
  useLayoutEffect(() => {
    const animation = cameraAnimation.current;
    if (!effectiveReducedMotion || !animation) return;
    cancelAnimationFrame(animation.frameId);
    cameraAnimation.current = null;
    setScale(animation.targetScale);
    setPan(animation.targetPan);
  }, [effectiveReducedMotion]);
  const pointerFocus = useRef(false);
  const cameraInitialized = useRef<GraphMode | null>(initialState && compatible ? initialMode : null);
  const [savedCoverage, setSavedCoverage] = useState(initialState?.savedCoverage);
  const requestedViewId =
    new URLSearchParams(context.path.split("?")[1] ?? "").get("savedView") ??
    "";
  function applySavedView(view: SavedStructureView, graph: ViewGraph, navigateToView = true) {
    const c = view.config,
      p = c.presentation;
    setSelectedViewId(view.id);
    setAppliedConfig(c);
    setSavedMatchIds(new Set(graph.entities.map((e) => e.id)));
    setSavedCoverage(graph.coverage);
    setQuery(c.query);
    setKindFilter(c.kind === "ALL" ? "" : c.kind);
    setCircleFilter(c.rootId ?? "");
    setMemberFilter(c.memberId ?? "");
    setQuick(p?.quick ?? "none");
    setHighlight(p?.highlight ?? "none");
    setLabels(p?.labels ?? true);
    setAvatars(p?.avatars ?? true);
    setMinimap(p?.minimap ?? false);
    if (navigateToView) setPopup(null);
    setViewLoadError("");
    lastValidatedView.current = view.id;
    const next =
      c.view === "PACK"
        ? "pack"
        : c.view === "NETWORK"
          ? "network"
          : "hierarchy";
    setMode(next);
    if (navigateToView) {
      setCollapsed(new Set());
      setScale(1);
      setPan({ x: 0, y: 0 });
      navigate(
        c.view === "DIRECTORY"
          ? "/structure/directory?viewId=" + encodeURIComponent(view.id)
          : "/structure?view=" +
              next +
              "&savedView=" +
              encodeURIComponent(view.id),
      );
    }
  }
  useEffect(() => {
    if (!requestedViewId || lastValidatedView.current === requestedViewId)
      return;
    const controller = new AbortController();
    setViewLoading(true);
    setViewLoadError("");
    const base =
      "/organizations/" + context.organizationId + "/structure-advanced";
    Promise.all([
      context.api<SavedStructureView>(
        base + "/views/" + encodeURIComponent(requestedViewId),
        { signal: controller.signal },
      ),
      context.api<ViewGraph>(
        base + "/graph?viewId=" + encodeURIComponent(requestedViewId),
        { signal: controller.signal },
      ),
    ])
      .then(([view, graph]) => {
        if (controller.signal.aborted) return;
        if (bootstrap.governanceModel && view.data.config.view === 'TREE') {
          setViewLoadError('Esta visualização não está disponível no modelo atual da organização.');
          return;
        }
        // The drawer mounts a second explorer from the current session snapshot.
        // Revalidate the saved view without replacing its unsaved filters or camera;
        // the existing graph?config effect rechecks that live recorte separately.
        if (context.selectedEntity && initialState?.selectedViewId === view.data.id && initialState.appliedConfig) {
          lastValidatedView.current = view.data.id;
          return;
        }
        applySavedView(view.data, graph.data, !context.selectedEntity);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setViewLoadError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setViewLoading(false);
      });
    return () => controller.abort();
  }, [requestedViewId, context.organizationId, context.api]);
  const currentConfig: StructureViewConfig = {
    ...appliedConfig,
    view: mode === "pack" ? "PACK" : mode === "network" ? "NETWORK" : "TREE",
    query,
    kind: kindFilter === "CIRCLE" || kindFilter === "ROLE" ? kindFilter : "ALL",
    rootId: circleFilter || null,
    memberId: memberFilter || null,
    flag: appliedConfig?.flag ?? null,
    maxDepth: appliedConfig?.maxDepth ?? 100,
    presentation: { quick, highlight, labels, avatars, minimap },
  };
  const serializedConfig = JSON.stringify(currentConfig);
  const appliedConfigJson = JSON.stringify(appliedConfig);
  useEffect(() => {
    if (!appliedConfig) return;
    const controller = new AbortController();
    setViewLoading(true);
    setViewLoadError("");
    context.api<ViewGraph>(
      `/organizations/${context.organizationId}/structure-advanced/graph?config=` +
        encodeURIComponent(serializedConfig),
      { signal: controller.signal },
    ).then((response) => {
      if (!controller.signal.aborted) {
        setSavedMatchIds(new Set(response.data.entities.map((entity) => entity.id)));
        setSavedCoverage(response.data.coverage);
      }
    }).catch((error) => {
      if (!controller.signal.aborted) setViewLoadError(errorMessage(error));
    }).finally(() => {
      if (!controller.signal.aborted) setViewLoading(false);
    });
    return () => controller.abort();
  }, [serializedConfig, appliedConfigJson, context.organizationId, context.api]);
  useEffect(() => {
    onStateChange?.({
      selectedViewId,
      appliedConfig,
      savedMatchIds: savedMatchIds ? [...savedMatchIds] : undefined,
      savedCoverage,
      mode,
      quick,
      memberFilter,
      circleFilter,
      kindFilter,
      query,
      searchOpen: context.selectedEntity ? initialState?.searchOpen : popup === "search",
      highlight,
      labels,
      avatars,
      minimap,
      locked,
      collapsed: [...collapsed],
      scale,
      focusedCircle,
      pan,
    });
  }, [
    selectedViewId,
    appliedConfig,
    savedMatchIds,
    savedCoverage,
    mode,
    quick,
    memberFilter,
    circleFilter,
    kindFilter,
    query,
    popup,
    highlight,
    labels,
    avatars,
    minimap,
    locked,
    collapsed,
    scale,
    pan,
    onStateChange,
    focusedCircle,
  ]);
  useEffect(() => {
    const requested = urlMode(context.path);
    const value = bootstrap.governanceModel && requested === "hierarchy" ? "pack" : requested;
    if (value && value !== mode) {
      setMode(value);
      setScale(1);
      setPan({ x: 0, y: 0 });
      setCollapsed(new Set());
    }
  }, [context.path]);
  const drag = useRef<{
    x: number;
    y: number;
    startX: number;
    startY: number;
    width: number;
    height: number;
  } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 900, height: 900 });
  const [viewportMeasured, setViewportMeasured] = useState(false);
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width && rect.height) {
        setViewportMeasured(true);
        setViewportSize((previous) =>
          previous.width === rect.width && previous.height === rect.height
            ? previous
            : { width: rect.width, height: rect.height },
        );
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const active = (r: { startsAt: string; endsAt?: string | null }) =>
    (!r.startsAt || Date.parse(r.startsAt) <= Date.now()) &&
    (!r.endsAt || Date.parse(r.endsAt) > Date.now());
  const occupancies = structure.occupancies.filter(active),
    memberships = structure.memberships.filter(active),
    myId = bootstrap.membership.id;
  const myRoles = new Set(
    occupancies.filter((o) => o.memberId === myId).map((o) => o.roleId),
  );
  const myCircles = new Set([
    ...memberships.filter((m) => m.memberId === myId).map((m) => m.circleId),
    ...occupancies.filter((o) => o.memberId === myId).map((o) => o.circleId),
  ]);
  const circles = structure.nodes.filter((n) => n.kind === "CIRCLE");
  const purposes = new Map(
    [...structure.circles, ...structure.roles].map((e) => [e.id, e.purpose]),
  );
  const matches = useMemo(
    () =>
      new Set(
        structure.nodes
          .filter((n) => {
            if (savedMatchIds && !savedMatchIds.has(n.entityId)) return false;
            if (
              query &&
              !n.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())
            )
              return false;
            if (kindFilter && n.kind !== kindFilter) return false;
            if (
              memberFilter &&
              !occupancies.some(
                (o) =>
                  o.memberId === memberFilter &&
                  (o.roleId === n.entityId || o.circleId === n.entityId),
              ) &&
              !memberships.some(
                (m) => m.memberId === memberFilter && m.circleId === n.entityId,
              )
            )
              return false;
            if (circleFilter) {
              const chosen = structure.nodes.find(
                (p) => p.entityId === circleFilter,
              );
              if (!chosen) return false;
              let current: StructureNode | undefined = n;
              let belongs = false;
              const seen = new Set<string>();
              while (current && !seen.has(current.nodeId)) {
                seen.add(current.nodeId);
                if (current.nodeId === chosen.nodeId) {
                  belongs = true;
                  break;
                }
                current = structure.nodes.find(
                  (p) => p.nodeId === current!.parentNodeId,
                );
              }
              if (!belongs) return false;
            }
            if (quick === "my-roles")
              return n.kind === "ROLE" && myRoles.has(n.entityId);
            if (quick === "my-circles")
              return n.kind === "CIRCLE" && myCircles.has(n.entityId);
            if (quick === "no-purpose")
              return n.kind === "ROLE" && !purposes.get(n.entityId)?.trim();
            if (quick === "members-no-role")
              return (
                n.kind === "CIRCLE" &&
                memberships.some(
                  (m) =>
                    m.circleId === n.entityId &&
                    !occupancies.some(
                      (o) =>
                        o.memberId === m.memberId && o.circleId === n.entityId,
                    ),
                )
              );
            return true;
          })
          .map((n) => n.nodeId),
      ),
    [
      structure,
      query,
      kindFilter,
      memberFilter,
      circleFilter,
      quick,
      myId,
      savedMatchIds,
    ],
  );
  const filtered =
    !!savedMatchIds ||
    quick !== "none" ||
    !!memberFilter ||
    !!circleFilter ||
    !!kindFilter ||
    !!query;
  const ancestry = ancestorIds(structure.nodes, matches);
  const aspect = mode === "network" ? networkAspect(viewportSize.width, viewportSize.height) : 1;
  const scene = useMemo(
    () => graphScene(structure.nodes, mode, collapsed, aspect),
    [structure.nodes, mode, collapsed, aspect],
  );
  const parentNodeIds = useMemo(
    () => new Set(scene.nodes.map((node) => node.parentNodeId).filter(Boolean)),
    [scene.nodes],
  );
  const naturalBounds = scene.bounds;
  // Keep small graphs at readable native scale instead of shrinking them into a large square.
  const fittedWidth = Math.max(naturalBounds.width, viewportSize.width,
    mode === "network" && scene.nodes.length ?
      (Math.max(...scene.nodes.map(n => n.x)) - Math.min(...scene.nodes.map(n => n.x))) /
      Math.max(0.1, 1 - 160 / viewportSize.width) : 0);
  const fittedHeight = Math.max(naturalBounds.height, viewportSize.height);
  const b = mode === "pack" ? naturalBounds : {
    x: naturalBounds.x - (fittedWidth - naturalBounds.width) / 2,
    y: naturalBounds.y - (fittedHeight - naturalBounds.height) / 2,
    width: fittedWidth,
    height: fittedHeight,
  };
  // Expand the viewBox to the viewport aspect ratio at the same center and
  // scale as SVG's default xMidYMid meet transform. There is no letterboxing
  // left for pointer conversion or root alignment to accidentally ignore.
  function cameraSize(zoom: number) {
    const pixelsPerUnit = Math.max(0.001, Math.min(
      viewportSize.width / (b.width / zoom),
      viewportSize.height / (b.height / zoom),
    ));
    return { width: viewportSize.width / pixelsPerUnit, height: viewportSize.height / pixelsPerUnit, pixelsPerUnit };
  }
  const size = cameraSize(scale);
  const camera = {
    x: b.x + b.width / 2 + pan.x - size.width / 2,
    y: b.y + b.height / 2 + pan.y - size.height / 2,
    width: size.width,
    height: size.height,
  };
  const screenScale = size.pixelsPerUnit;
  function stopCameraAnimation() {
    if (!cameraAnimation.current) return;
    cancelAnimationFrame(cameraAnimation.current.frameId);
    cameraAnimation.current = null;
  }
  function animateCamera(targetScale: number, targetPan: { x: number; y: number }, duration = 240) {
    stopCameraAnimation();
    if (effectiveReducedMotion || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setScale(targetScale);
      setPan(targetPan);
      return;
    }
    const fromScale = scale, fromPan = pan, start = performance.now();
    const animation = { frameId: 0, targetScale, targetPan };
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = t * t * t * (t * (t * 6 - 15) + 10);
      setScale(Math.exp(Math.log(fromScale) + (Math.log(targetScale) - Math.log(fromScale)) * eased));
      setPan({
        x: fromPan.x + (targetPan.x - fromPan.x) * eased,
        y: fromPan.y + (targetPan.y - fromPan.y) * eased,
      });
      if (t < 1) animation.frameId = requestAnimationFrame(frame);
      else cameraAnimation.current = null;
    };
    animation.frameId = requestAnimationFrame(frame);
    cameraAnimation.current = animation;
  }
  function reset(overview = false, animated = false) {
    stopCameraAnimation();
    // A fitted 15-node tree used to shrink 12px labels to ~6px. Start at a
    // reading scale, with the root visible; overview remains an explicit action.
    const nextScale = mode === "hierarchy" && !overview
      ? Math.max(1, b.width / viewportSize.width, b.height / viewportSize.height)
      : 1;
    const root = scene.nodes.find(node => !node.parentNodeId) ?? scene.nodes[0];
    const nextCamera = cameraSize(nextScale);
    const targetPan = mode === "hierarchy" && !overview && root ? {
      x: root.x - (b.x + b.width / 2),
      y: root.y - 80 / nextCamera.pixelsPerUnit + nextCamera.height / 2 - (b.y + b.height / 2),
    } : { x: 0, y: 0 };
    if(animated)animateCamera(nextScale,targetPan,520);else{setScale(nextScale);setPan(targetPan);}
    if(overview)setFocusedCircle(root?.nodeId??null);
  }
  useEffect(() => {
    if (!viewportMeasured || cameraInitialized.current === mode || !scene.nodes.length) return;
    cameraInitialized.current = mode;
    reset();
  }, [mode, scene.nodes.length, viewportSize.width, viewportSize.height, viewportMeasured]);
  function inspectNode(node: PlacedNode, reveal = false) {
    setInspectedNode(node.nodeId);
    if (!reveal) return;
    stopCameraAnimation();
    const outside = node.x < camera.x + 100 / screenScale || node.x > camera.x + camera.width - 100 / screenScale || node.y < camera.y + 60 / screenScale || node.y > camera.y + camera.height - 60 / screenScale;
    const target = mode === "pack" && node.kind === "ROLE" ? Math.max(scale, scale * 100 / Math.max(1, node.r * 2 * screenScale)) : scale;
    if (outside || target > scale) {
      setScale(Math.min(4096, target));
      setPan({ x: node.x - (b.x + b.width / 2), y: node.y - (b.y + b.height / 2) });
    }
  }
  function changeMode(value: GraphMode) {
    if (value === mode) {
      setPopup(null);
      return;
    }
    setMode(value);
    navigate("/structure?view=" + value);
    setCollapsed(new Set());
    setPopup(null);
    reset();
  }
  const closePopup = () => {
    setPopup(null);
    popupTrigger.current?.focus();
  };
  const toggle = (value: typeof popup, trigger?: HTMLElement) => {
    if (popup === value) { closePopup(); return; }
    popupTrigger.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setPopup(value);
  };
  function clearFilters() {
    setSavedMatchIds(null);
    setSavedCoverage(undefined);
    setAppliedConfig(undefined);
    setSelectedViewId("");
    lastValidatedView.current = "";
    if (requestedViewId) navigate("/structure?view=" + mode);
    setQuick("none");
    setMemberFilter("");
    setCircleFilter("");
    setKindFilter("");
    setQuery("");
  }
  function pointerDown(e: PointerEvent<SVGSVGElement>) {
    pointerFocus.current = true;
    if (locked || (e.target as Element).closest("[data-node]")) return;
    stopCameraAnimation();
    const rect = e.currentTarget.getBoundingClientRect();
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      startX: pan.x,
      startY: pan.y,
      width: rect.width,
      height: rect.height,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function pointerMove(e: PointerEvent<SVGSVGElement>) {
    if (!drag.current) return;
    const d = drag.current;
    setPan({
      x: d.startX - ((e.clientX - d.x) * camera.width) / d.width,
      y: d.startY - ((e.clientY - d.y) * camera.height) / d.height,
    });
  }
  const nodeMembers = (node: PlacedNode) => {
    const ids = new Set(
      occupancies
        .filter((o) =>
          node.kind === "ROLE"
            ? o.roleId === node.entityId
            : o.circleId === node.entityId,
        )
        .map((o) => o.memberId),
    );
    if (node.kind === "CIRCLE")
      memberships
        .filter((m) => m.circleId === node.entityId)
        .forEach((m) => ids.add(m.memberId));
    return members.filter((m) => ids.has(m.id));
  };
  type Chip = { key: string; x: number; y: number; r: number; text: string };
  /** Name first, people second: each gets its own region inside a role. */
  function packLayout(n: PlacedNode): { arc: boolean; label: PackLabel | null; chips: Chip[] } {
    const hasChildren = parentNodeIds.has(n.nodeId);
    if (n.kind === "CIRCLE" && hasChildren) {
      if (n.depth > 0) return { arc: true, label: null, chips: [] };
      const band = n.band ?? n.r * .26;
      return { arc: false, label: fitPackLabel(n, screenScale, n.y - n.r + band * .62, n.y - n.r + band, 24, .95), chips: [] };
    }
    const people = avatars && n.kind === "ROLE" ? nodeMembers(n) : [];
    if (people.length) {
      const chipR = Math.min(12, Math.max(8, n.r * screenScale * .15)) / screenScale, gap = 3 / screenScale, chipY = n.y + n.r * .5;
      const label = chipR <= n.r * .19 ? fitPackLabel(n, screenScale, n.y - n.r * .12, chipY - chipR - gap) : null;
      const half = Math.sqrt(Math.max(0, (n.r * .94 - chipR) ** 2 - (n.r * .5) ** 2));
      const count = label ? Math.min(people.length, 4, Math.floor((2 * half) / (2 * chipR + gap)) + 1) : 0;
      if (label && count > 0) {
        const shown = people.length > count ? count - 1 : count;
        const texts = [...people.slice(0, shown).map(m => ({ key: m.id, text: initials(m.displayName) })), ...(shown < people.length ? [{ key: "more", text: "+" + (people.length - shown) }] : [])];
        return { arc: false, label, chips: texts.map((item, i) => ({ ...item, x: n.x + (i - (texts.length - 1) / 2) * (2 * chipR + gap), y: chipY, r: chipR })) };
      }
    }
    return { arc: false, label: fitPackLabel(n, screenScale), chips: [] };
  }
  function highlighted(n: PlacedNode) {
    if (highlight === "mine")
      return n.kind === "ROLE"
        ? myRoles.has(n.entityId)
        : myCircles.has(n.entityId);
    if (highlight === "vacant")
      return (
        n.kind === "ROLE" && !occupancies.some((o) => o.roleId === n.entityId)
      );
    return false;
  }
  function opacity(n: PlacedNode) {
    return !filtered || matches.has(n.nodeId)
      ? 1
      : ancestry.has(n.nodeId)
        ? 0.5
        : 0.13;
  }
  function activate(n: PlacedNode) {
    if (mode === "pack" && n.kind === "CIRCLE" && focusedCircle !== n.nodeId) {
      const ancestors = focusedCircle ? ancestorIds(structure.nodes, new Set([focusedCircle])) : new Set<string>();
      const duration = ancestors.has(n.nodeId) ? 520 : 720;
      const targetScale = Math.max(1, Math.min(4096, Math.min(cameraSize(1).width, cameraSize(1).height) / (n.r * 2.2)));
      const targetPan = { x: n.x - (b.x + b.width / 2), y: n.y - (b.y + b.height / 2) };
      setFocusedCircle(n.nodeId);
      setInspectedNode(null);
      animateCamera(targetScale,targetPan,duration);
      return;
    }
    navigate(entityPath(n) + "?from=" + encodeURIComponent(structureReturnPath(context.path)));
  }
  const inspected = scene.nodes.find(n => n.nodeId === inspectedNode);
  const inspectedDefinition = inspected && (inspected.kind === "CIRCLE" ? structure.circles : structure.roles).find(item => item.id === inspected.entityId);
  const currentNode = scene.nodes.find(n => n.entityId === context.selectedEntity?.entityId) ?? scene.nodes.find(n => n.nodeId === focusedCircle);
  const breadcrumb: PlacedNode[] = [];
  let crumb = currentNode ?? scene.nodes.find(n => !n.parentNodeId);
  const crumbSeen = new Set<string>();
  while (crumb && !crumbSeen.has(crumb.nodeId)) { crumbSeen.add(crumb.nodeId); breadcrumb.unshift(crumb); if (structure.nodes.find(node => node.nodeId === crumb?.nodeId)?.pathRedacted) break; crumb = scene.nodes.find(n => n.nodeId === crumb?.parentNodeId); }
  const empty = context.bootstrap.membership.memberType !== "GUEST" && structure.nodes.length === 1 && structure.nodes[0].entityId === context.bootstrap.rootCircleId;
  const packLayouts = new Map(mode === "pack" && !empty ? scene.nodes.map(n => [n.nodeId, packLayout(n)] as const) : []);
  return (
    <>
      <div className={"sx-explorer sx-mode-" + mode}>
        <nav className="mare-map-breadcrumb" aria-label="Caminho da estrutura">{breadcrumb.map((node, index) => <span key={node.nodeId}>{index > 0 && <span aria-hidden="true"> / </span>}{index === breadcrumb.length - 1 ? <span aria-current="location">{node.name}</span> : <button onClick={() => activate(node)}>{node.name}</button>}</span>)}</nav>
        <div className="sx-toolbar">
          {bootstrap.membership.memberType !== "GUEST" && bootstrap.modules.governance !== false && <StructureCreateMenu navigate={navigate} circleId={currentNode?.kind === "CIRCLE" ? currentNode.entityId : undefined}/>}
          <div
            className="sx-modes"
            role="group"
            aria-label="Visualização da estrutura"
          >
            {(
              [
                { value: "pack", label: "Círculos", Icon: StructureIcon },
                { value: "network", label: "Rede", Icon: Waypoints },
              ] as const
            ).map(({ value, label, Icon }) => (
              <Button
                key={value}
                title={label}
                className={mode === value ? "view-pill" : ""}
                pressed={mode === value}
                onClick={() => changeMode(value)}
              >
                <Icon size={16} />
                <span>{label}</span>
              </Button>
            ))}
            <Button title="Lista" onClick={() => navigate("/structure/directory")}><List size={16}/><span>Lista</span></Button>
          </div>
          <div className="toolbar-spacer" />
          <div className="sx-toolbar-actions">
          <Button ariaLabel="Opções da visualização" title="Opções da visualização" onClick={event => toggle("options", event.currentTarget)}><Settings2 size={17}/><span className="sx-control-label">Opções</span></Button>
          {bootstrap.membership.memberType !== 'GUEST' && <Button title="Visualizações salvas" ariaLabel="Visualizações salvas" expanded={popup === 'views'} onClick={event => toggle('views', event.currentTarget)}><Bookmark size={16}/><span className="sx-control-label">Vistas</span></Button>}
          <Button
            className={filtered ? "sx-filter-active" : ""}
            expanded={popup === "filter"}
            onClick={event => toggle("filter", event.currentTarget)}
            title="Filtrar"
          >
            <Filter size={16} />
            <span className="sx-control-label">Filtrar</span>
          </Button>
          <Button onClick={event => toggle("search", event.currentTarget)} title="Pesquisar no gráfico" ariaLabel="Pesquisar no gráfico" expanded={popup === 'search'}>
            <Search size={16} />
            <span className="sx-control-label sx-mobile-search-label">Buscar</span>
          </Button>
          </div>
        </div>
        {viewLoading && (
          <div className="sx-filter-summary" role="status">
            Carregando visualização salva…
          </div>
        )}
        {viewLoadError && (
          <Notice>
            {viewLoadError}
            <Button
              onClick={() => {
                clearFilters();
                setViewLoadError("");
              }}
            >
              Voltar à organização
            </Button>
          </Notice>
        )}
        {filtered && (
          <div className="sx-filter-summary" role="status">
            {matches.size}{" "}
            {matches.size === 1 ? "correspondência" : "correspondências"} ·
            contexto preservado
            <Button onClick={clearFilters}>
              Limpar filtros <X size={12} />
            </Button>
          </div>
        )}
        {(!structure.coverage.complete || savedCoverage?.complete === false) && (
          <Notice>
            Estrutura parcial. Os resultados não cobrem toda a estrutura.
            {savedCoverage?.depthLimited && " A visualização atingiu o limite de profundidade configurado."}
            {" Abra um círculo ou ajuste os filtros para continuar explorando."}
          </Notice>
        )}
        {popup && (
          <div
            className={"sx-popover sx-" + popup}
            role="region"
            onKeyDown={event => {
              if (event.key !== 'Escape' || event.defaultPrevented || (event.target as Element).closest('dialog')) return;
              event.preventDefault(); event.stopPropagation(); closePopup();
            }}
            aria-label={
              popup === "filter"
                ? "Filtros da estrutura"
                : popup === "views"
                  ? "Visualizações salvas"
                : popup === "highlight"
                  ? "Destaques da estrutura"
                  : "Opções do gráfico"
            }
          >
            <div className="sx-popover-heading">
              <strong>
                {popup === "filter"
                  ? "Filtros"
                  : popup === "views"
                    ? "Visualizações salvas"
                  : popup === "highlight"
                    ? "Destacar"
                    : popup === "search"
                      ? "Pesquisar no gráfico"
                      : popup === "legend"
                        ? "Legenda"
                        : "Opções da visualização"}
              </strong>
              <Button title="Fechar opções" onClick={closePopup}>
                <X size={16} />
              </Button>
            </div>
            {popup === "views" && bootstrap.membership.memberType !== 'GUEST' && <StructureViews
              context={context} currentConfig={currentConfig} selectedId={selectedViewId}
              onSelected={setSelectedViewId} onApply={applySavedView}
              isCompatible={view => !(bootstrap.governanceModel && view.config.view === 'TREE')}
              onDeleted={() => { lastValidatedView.current = ''; if (requestedViewId) navigate('/structure?view=' + mode); }}
            />}
            {popup === "filter" && (
              <>
                <p className="muted">Filtros rápidos</p>
                <div className="sx-quick-filters">
                  {(
                    [
                      { value: "my-roles", label: "Meus papéis" },
                      { value: "my-circles", label: "Meus círculos" },
                      { value: "no-purpose", label: "Papéis sem propósito" },
                      {
                        value: "members-no-role",
                        label: "Círculos com membros sem papéis",
                      },
                    ] as const
                  ).map((f) => (
                    <Button
                      key={f.value}
                      className={quick === f.value ? "sx-filter-active" : ""}
                      onClick={() =>
                        setQuick((q) => (q === f.value ? "none" : f.value))
                      }
                    >
                      {f.label}
                    </Button>
                  ))}
                </div>
                <div className="sx-filter-fields">
                  <label className="field">
                    Membro
                    <select
                      value={memberFilter}
                      onChange={(e) => setMemberFilter(e.target.value)}
                    >
                      <option value="">Todos os membros</option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Tipo
                    <select
                      value={kindFilter}
                      onChange={(e) => setKindFilter(e.target.value)}
                    >
                      <option value="">Círculos e papéis</option>
                      <option value="CIRCLE">Círculos</option>
                      <option value="ROLE">Papéis</option>
                    </select>
                  </label>
                  <label className="field">
                    Círculo
                    <select
                      value={circleFilter}
                      onChange={(e) => setCircleFilter(e.target.value)}
                    >
                      <option value="">Toda a organização</option>
                      {circles.map((c) => (
                        <option key={c.entityId} value={c.entityId}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <Button onClick={clearFilters}>
                  <RotateCcw size={14} />
                  Limpar filtros
                </Button>
              </>
            )}
            {popup === "highlight" && (
              <>
                <Button
                  className={highlight === "none" ? "sx-filter-active" : ""}
                  onClick={() => {
                    clearFilters();
                    setHighlight("none");
                  }}
                >
                  Organização <small>Padrão</small>
                </Button>
                <Button
                  className={highlight === "mine" ? "sx-filter-active" : ""}
                  onClick={() => setHighlight("mine")}
                >
                  Meus papéis e círculos
                </Button>
                <Button
                  className={highlight === "vacant" ? "sx-filter-active" : ""}
                  onClick={() => setHighlight("vacant")}
                >
                  Papéis vagos
                </Button>
                <p className="muted">
                  Destaques baseados nas relações atuais da organização.
                </p>
              </>
            )}
            {popup === "search" && (
              <>
                <input
                  aria-label="Pesquisar no gráfico"
                  autoFocus
                  placeholder="Pesquisar"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <div className="sx-search-list">
                  {structure.nodes
                    .filter((n) =>
                      n.name
                        .toLocaleLowerCase()
                        .includes(query.toLocaleLowerCase()),
                    )
                    .map((n) => (
                      <button type="button" data-node={n.nodeId} data-structure-search-node={n.nodeId}
                        key={n.nodeId}
                        onClick={() => { const placed = scene.nodes.find(node => node.nodeId === n.nodeId); if (placed) activate(placed); }}
                      >
                        {n.name}
                      </button>
                    ))}
                </div>
              </>
            )}
            {popup === "options" && (
              <>
                <label className="sx-checkbox"><input type="checkbox" checked={highlight === "mine"} onChange={event => setHighlight(event.target.checked ? "mine" : "none")}/>Destacar meus papéis e círculos</label>
                <label className="sx-checkbox"><input type="checkbox" checked={highlight === "vacant"} onChange={event => setHighlight(event.target.checked ? "vacant" : "none")}/>Destacar papéis vagos</label>
                <label className="sx-checkbox">
                  <input
                    type="checkbox"
                    checked={labels}
                    onChange={(e) => setLabels(e.target.checked)}
                  />
                  Exibir nomes
                </label>
                <label className="sx-checkbox">
                  <input
                    type="checkbox"
                    disabled={mode === "network"}
                    checked={avatars}
                    onChange={(e) => setAvatars(e.target.checked)}
                  />
                  {mode === "network"
                    ? "Membros (disponível em círculos e hierarquia)"
                    : "Exibir membros"}
                </label>
                <label className="sx-checkbox">
                  <input
                    type="checkbox"
                    checked={minimap}
                    onChange={(e) => setMinimap(e.target.checked)}
                  />
                  Exibir minimapa
                </label>
                <p className="muted">
                  Os destaques usam as relações atuais desta organização.
                </p>
                <Button
                  onClick={() => {
                    setLabels(true);
                    setAvatars(true);
                    setMinimap(false);
                    setHighlight("none");
                    clearFilters();
                    reset();
                  }}
                >
                  Restaurar padrão
                </Button>
              </>
            )}
            {popup === "legend" && (
              <>
                <p>
                  <i className="sx-dot sx-circle-dot" /> {vocabulary.circle}{" "}
                  <i className="sx-dot sx-role-dot" /> {vocabulary.role}
                </p>
                <p>
                  Arraste o fundo para mover. Use + e − para aproximar e
                  afastar. Abra uma entidade com Enter ou clique.
                </p>
                {highlight !== "none" && (
                  <p>
                    <i className="sx-dot sx-highlight-dot" />
                    {highlight === "mine"
                      ? "Meus papéis e círculos"
                      : "Papéis vagos"}
                  </p>
                )}
              </>
            )}
          </div>
        )}
        <div
          className="sx-canvas"
          onClick={() => {
            if (popup && popup !== "search") setPopup(null);
          }}
        >
          <svg
            ref={svg}
            className={"sx-graph " + (locked ? "sx-locked" : "")}
            viewBox={`${camera.x} ${camera.y} ${camera.width} ${camera.height}`}
            role="group"
            aria-label={`Estrutura: ${mode === "pack" ? vocabulary.structure : mode === "hierarchy" ? "hierarquia" : "rede"}`}
            tabIndex={0}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={() => {
              pointerFocus.current = false;
              drag.current = null;
            }}
            onPointerCancel={() => {
              pointerFocus.current = false;
              drag.current = null;
            }}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (
                [
                  "ArrowLeft",
                  "ArrowRight",
                  "ArrowUp",
                  "ArrowDown",
                  "+",
                  "-",
                  "0",
                ].includes(e.key)
              )
                e.preventDefault();
              if (["+", "-", "0", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) stopCameraAnimation();
              if (e.key === "+") setScale((s) => Math.min(4096, s * 1.3));
              if (e.key === "-") setScale((s) => Math.max(0.25, s / 1.3));
              if (e.key === "0") reset();
              if (!locked) {
                if (e.key === "ArrowLeft")
                  setPan((p) => ({ ...p, x: p.x - 50 }));
                if (e.key === "ArrowRight")
                  setPan((p) => ({ ...p, x: p.x + 50 }));
                if (e.key === "ArrowUp") setPan((p) => ({ ...p, y: p.y - 50 }));
                if (e.key === "ArrowDown")
                  setPan((p) => ({ ...p, y: p.y + 50 }));
              }
            }}
          >
            {scene.links.map((l) => (
              <path
                key={l.target.nodeId}
                className={"sx-edge" + (mode === "network" && l.target.kind === "ROLE" ? " sx-edge-role" : "")}
                d={
                  mode === "hierarchy"
                    ? `M${l.source.x},${l.source.y + 40} V${(l.source.y + l.target.y) / 2} H${l.target.x} V${l.target.y - 40}`
                    : `M${l.source.x},${l.source.y} L${l.target.x},${l.target.y}`
                }
              />
            ))}
            {scene.nodes.map((n) => (
              <g
                key={n.nodeId}
                data-node={n.nodeId}
                role="link"
                tabIndex={0}
                aria-label={`${vocabulary.entity(n.kind)}: ${n.name}`}
                className={
                  "sx-node " +
                  (highlighted(n) ? "sx-highlighted " : "") +
                  (n.entityId === context.selectedEntity?.entityId ? "sx-selected " : "") +
                  (mode === "network" ? "sx-network-node" : "")
                }
                style={{ opacity: opacity(n) }}
                onMouseEnter={() => { if (tooltipTimer.current) clearTimeout(tooltipTimer.current); tooltipTimer.current = setTimeout(() => inspectNode(n), 220); }}
                onMouseLeave={event => { if (tooltipTimer.current) clearTimeout(tooltipTimer.current); if (document.activeElement !== event.currentTarget) setInspectedNode(null); }}
                onFocus={() => { const fromPointer=pointerFocus.current;pointerFocus.current=false;inspectNode(n,!fromPointer); }}
                onBlur={() => setInspectedNode(null)}
                aria-describedby={inspectedNode === n.nodeId ? "structure-node-tooltip" : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  activate(n);
                }}
                onKeyDown={(e) => {
                  pointerFocus.current = false;
                  if (e.key === "Escape") setInspectedNode(null);
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    activate(n);
                  }
                }}
              >
                {mode === "hierarchy" ? (
                  <>
                    <rect
                      x={n.x - 97}
                      y={n.y - 40}
                      width={194}
                      height={80}
                      rx={2}
                      className="sx-hierarchy-card"
                    />
                    <text x={n.x - 85} y={n.y - 20} className="sx-card-kind">
                      {vocabulary.entity(n.kind).toLocaleUpperCase('pt-BR')}
                    </text>
                    {labels && (
                      <foreignObject
                        x={n.x - 85}
                        y={n.y - 11}
                        width={170}
                        height={36}
                      >
                        <div className="sx-card-label">{n.name}</div>
                      </foreignObject>
                    )}
                    {avatars &&
                      nodeMembers(n)
                        .slice(0, 4)
                        .map((m, i) => (
                          <g key={m.id}>
                            <circle
                              cx={n.x - 78 + i * 20}
                              cy={n.y + 26}
                              r={9}
                              fill="var(--mare-subtle)"
                            />
                            <text
                              x={n.x - 78 + i * 20}
                              y={n.y + 29}
                              textAnchor="middle"
                              className="sx-avatar-text"
                            >
                              {initials(m.displayName)}
                            </text>
                          </g>
                        ))}
                  </>
                ) : (
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={n.r}
                    style={n.kind === "CIRCLE" ? { fill: `var(--mare-map-level-${Math.min(5, n.depth + (mode === "network" ? 2 : 1))})` } : undefined}
                    className={
                      mode === "network"
                        ? n.kind === "CIRCLE" ? "sx-network-circle sx-network-group" : "sx-network-circle"
                        : n.kind === "ROLE"
                          ? "sx-pack-role" + (labels && !packLayouts.get(n.nodeId)?.label ? " sx-pack-quiet" : "")
                          : n.depth === 0
                            ? "sx-pack-root"
                            : "sx-pack-circle"
                    }
                  />
                )}
                {mode !== "hierarchy" && <circle cx={n.x} cy={n.y} r={n.r + 3.5 / screenScale} className="sx-focus-ring" aria-hidden="true"/>}
                <title>{n.name}</title>
              </g>
            ))}
            {mode === "pack" && !empty && scene.nodes.map(n => {
              const layout = packLayouts.get(n.nodeId)!;
              const fade = opacity(n);
              return <g key={"content" + n.nodeId} pointerEvents="none" aria-hidden="true">
                {labels && layout.arc && <CircleArcLabel node={n} screenScale={screenScale} opacity={fade} pathId={arcIdPrefix + "-" + n.nodeId.replace(/[^a-zA-Z0-9_-]/g, "")}/>}
                {labels && layout.label && <PackLabelText node={n} label={layout.label} opacity={fade}/>}
                {layout.chips.length > 0 && <g className="sx-member-chips" opacity={fade}>{layout.chips.map(chip => <g key={chip.key}><circle cx={chip.x} cy={chip.y} r={chip.r} className="sx-member-chip"/><text x={chip.x} y={chip.y} textAnchor="middle" dominantBaseline="central" className="sx-member-chip-text" style={{fontSize: chip.r * (chip.text.length > 2 ? .78 : .92)}}>{chip.text}</text></g>)}</g>}
              </g>;
            })}
            {mode === "network" && labels && networkLabels(scene.nodes, screenScale, inspectedNode, {x1: camera.x * screenScale + 4, y1: camera.y * screenScale + 4, x2: (camera.x + camera.width) * screenScale - 60, y2: (camera.y + camera.height) * screenScale - 4}).map(label => <text key={"label" + label.node.nodeId} className={"sx-network-text" + (label.node.kind === "CIRCLE" ? " sx-network-text-group" : "") + (label.node.nodeId === inspectedNode ? " sx-network-text-active" : "")} x={label.x} y={label.y} textAnchor={label.anchor} dominantBaseline="central" pointerEvents="none" aria-hidden="true" opacity={opacity(label.node)} style={{fontSize: label.font, strokeWidth: 3.5 / screenScale}}>{label.node.name}</text>)}
            {mode === "hierarchy" &&
              scene.nodes
                .filter((n) =>
                  structure.nodes.some((c) => c.parentNodeId === n.nodeId),
                )
                .map((n) => (
                  <g
                    key={"collapse" + n.nodeId}
                    role="button"
                    tabIndex={0}
                    data-node={n.nodeId}
                    aria-label={`${collapsed.has(n.nodeId) ? "Expandir" : "Recolher"} ${n.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setCollapsed((old) => {
                        const next = new Set(old);
                        if (next.has(n.nodeId)) next.delete(n.nodeId);
                        else next.add(n.nodeId);
                        return next;
                      });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setCollapsed((old) => {
                          const next = new Set(old);
                          if (next.has(n.nodeId)) next.delete(n.nodeId);
                          else next.add(n.nodeId);
                          return next;
                        });
                      }
                    }}
                  >
                    <circle cx={n.x} cy={n.y + 48} r={10} fill="var(--mare-primary)" />
                    <text
                      x={n.x}
                      y={n.y + 52}
                      fill="white"
                      fontSize={14}
                      textAnchor="middle"
                    >
                      {collapsed.has(n.nodeId) ? "+" : "−"}
                    </text>
                  </g>
                ))}
          </svg>
          {inspectedNode && <div id="structure-node-tooltip" role="tooltip" className="sx-node-tooltip">
            <strong>{scene.nodes.find(n => n.nodeId === inspectedNode)?.name}</strong>
            <span>{inspected?.kind === "CIRCLE" ? "Círculo" : "Papel"}</span>
            <span><b>Propósito:</b> {inspectedDefinition?.purposeRich ? toPlainText(inspectedDefinition.purposeRich) : inspectedDefinition?.purpose || "Não definido"}</span>
            <span><b>Responsabilidades:</b> {inspectedDefinition?.responsibilities?.length ? inspectedDefinition.responsibilities.map(item => item.richText ? toPlainText(item.richText) : item.text).join("; ") : "Nenhuma definida"}</span>
          </div>}
          {empty && mode === "pack" && (
            <div className="sx-empty">
              <h3>A estrutura começa aqui</h3>
              <p>Crie o primeiro círculo ou papel da sua organização.</p>
              {bootstrap.capabilities["structure.direct"] && onCreateCircle && (
                <Button className="primary" onClick={onCreateCircle}>
                  <Plus size={16} />
                  Criar {vocabulary.circle.toLocaleLowerCase('pt-BR')}
                </Button>
              )}
            </div>
          )}
        </div>
        <div className="sx-map-controls">
          <div className="sx-zoom">
            <Button title="Ver toda a estrutura" onClick={() => reset(true, true)}>
              <Maximize size={16} />
            </Button>
            <Button
              title="Aumentar zoom"
              onClick={() => animateCamera(Math.min(4096, scale * 1.3),pan)}
            >
              <Plus size={16} />
            </Button>
            <Button
              title="Diminuir zoom"
              onClick={() => animateCamera(Math.max(.25, scale / 1.3),pan)}
            >
              <Minus size={16} />
            </Button>
            <Button
              title="Alternar minimapa"
              onClick={() => setMinimap((v) => !v)}
            >
              <MapIcon size={16} />
            </Button>
            <div className="sx-map-lock">
              <button
                type="button"
                aria-label={locked ? "Liberar movimento do mapa" : "Fixar posição do mapa"}
                aria-pressed={locked}
                aria-describedby={lockTooltipId}
                onClick={() => setLocked((v) => !v)}
              >
                {locked ? <Lock size={16} /> : <Unlock size={16} />}
              </button>
              <div id={lockTooltipId} className="sx-control-tooltip" role="tooltip">
                <strong>{locked ? "Liberar movimento do mapa" : "Fixar posição do mapa"}</strong>
                <span>{locked ? "Volte a mover o mapa ao arrastar." : "Evite mover o mapa sem querer ao arrastar."} O zoom continua disponível.</span>
              </div>
            </div>
            {mode !== "pack" && <Button title="Legenda do gráfico" onClick={event => toggle("legend", event.currentTarget)}>
              <Info size={16} />
            </Button>}
          </div>
          {minimap && (
            <svg
              className="sx-minimap"
              viewBox={`${b.x} ${b.y} ${b.width} ${b.height}`}
              role="button"
              tabIndex={0}
              aria-label="Minimapa: clique para centralizar"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const ratio = Math.min(r.width / b.width, r.height / b.height);
                const x =
                  (e.clientX - r.left - (r.width - b.width * ratio) / 2) /
                    ratio +
                  b.x;
                const y =
                  (e.clientY - r.top - (r.height - b.height * ratio) / 2) /
                    ratio +
                  b.y;
                setPan({
                  x: x - (b.x + b.width / 2),
                  y: y - (b.y + b.height / 2),
                });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") reset();
              }}
            >
              {scene.links.map((l) => (
                <line
                  key={l.target.nodeId}
                  x1={l.source.x}
                  y1={l.source.y}
                  x2={l.target.x}
                  y2={l.target.y}
                  stroke="var(--mare-map-stroke)"
                  strokeWidth={2}
                />
              ))}
              {scene.nodes.map((n) =>
                mode === "hierarchy" ? (
                  <rect
                    key={n.nodeId}
                    x={n.x - 97}
                    y={n.y - 40}
                    width={194}
                    height={80}
                    fill="var(--mare-map-level-2)"
                  />
                ) : (
                  <circle
                    key={n.nodeId}
                    cx={n.x}
                    cy={n.y}
                    r={n.r}
                    fill={n.kind === "ROLE" ? "var(--mare-primary)" : "var(--mare-map-level-1)"}
                    stroke="white"
                    strokeWidth={2}
                  />
                ),
              )}
              <rect
                x={camera.x}
                y={camera.y}
                width={camera.width}
                height={camera.height}
                fill="none"
                stroke="var(--mare-primary)"
                strokeWidth={Math.max(2, b.width / 200)}
              />
            </svg>
          )}
        </div>

      </div>
    </>
  );
}
