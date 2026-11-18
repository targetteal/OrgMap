import type { Ctx } from "../../src/runtime.js";
import type { TraceabilityPort } from "../../src/traceability.js";
export type AgendaSourceKind = "TENSION" | "PROPOSAL" | "PROJECT" | "TASK" | "GOAL";
/** Provenance has the same tenant/ACL gate as the referenced canonical object.
 * A known agenda ID or participation never grants access to a private source. */
export async function readAgendaSource(ctx: Ctx, kind: string | undefined, sourceId: string | null | undefined, trace?: TraceabilityPort) {
  if (!trace || !sourceId) return null;
  if (kind === "TENSION") return trace.tension(ctx, sourceId);
  if (kind === "PROPOSAL" || kind === "PROJECT" || kind === "TASK" || kind === "GOAL") return trace.destination(ctx, kind, sourceId);
  return null;
}
