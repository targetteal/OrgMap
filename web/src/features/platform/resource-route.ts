import type { Bootstrap } from "../../api";
import { resourceDestination as canonicalResourceDestination } from "./resource-destination";

/** Compatibility entry point for shell notifications; the route policy is shared with search and favorites. */
export function resourceDestination(bootstrap: Bootstrap | null, type: string, id: string) {
  return canonicalResourceDestination(type, id, undefined, bootstrap) ?? "/platform/search";
}
