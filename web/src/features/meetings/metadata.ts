import type { FeatureDefinition } from "../../feature-contract";
import { matchesMeetingRoute, resolveMeetingRoute } from "./routes";

export const meetingsMetadata = {
  id: "meetings",
  module: "meetings",
  label: "Reuniões",
  matches: matchesMeetingRoute,
  collapseSidebar: (path: string) => !!resolveMeetingRoute(path)?.id && !path.includes("classic=1"),
} satisfies Pick<FeatureDefinition, "id" | "module" | "label" | "matches" | "collapseSidebar">;
