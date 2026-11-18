import type { Ctx } from "../../src/runtime.js";
import { transaction } from "../../src/db.js";
import { assertManagedWriter } from "../../src/managed-writer.js";
import { event, fail, Failure, uuid } from "../../src/core.js";
import type { ProjectOutputService } from "./project-output.js";
async function joined(ctx: Ctx, deliveryId: string) {
  return (await ctx.c.query("SELECT d.*,c.connection_id,c.board_id,c.list_id,c.enabled,c.version AS current_config_revision,g.state AS grant_state,n.state AS connection_state FROM interop_project_output_deliveries d JOIN interop_project_output_configs c ON c.organization_id=d.organization_id AND c.id=d.config_id JOIN interop_provider_grants g ON g.organization_id=c.organization_id AND g.id=c.connection_id JOIN interop_connections n ON n.organization_id=g.organization_id AND n.id=g.id WHERE d.organization_id=$1 AND d.id=$2 AND d.owner_member_id=$3 FOR UPDATE OF d", [ctx.org.id, deliveryId, ctx.member.id])).rows[0];
}
function current(row: any) { return !!row && row.enabled && row.config_revision === row.current_config_revision && row.connection_state !== "REVOKED" && row.grant_state === "AUTHORIZED"; }
export async function runProjectOutputDelivery(service: ProjectOutputService, organizationId: string, memberId: string): Promise<boolean> {
  await transaction(assertManagedWriter);
  const { core, work, scheduling } = service.options;
  const context = <T>(fn: (ctx: Ctx) => Promise<T>) => core.withWorkerContext(organizationId, memberId, fn);
  const claim = await context(async ctx => {
    await ctx.c.query("UPDATE interop_project_output_deliveries SET state=CASE WHEN io_started_at IS NULL THEN 'RETRY' ELSE 'OUTCOME_UNKNOWN' END,remote_effect_possible=remote_effect_possible OR io_started_at IS NOT NULL,last_error='PROCESSING_LEASE_EXPIRED',lease_token=NULL,lease_until=NULL,version=version+1 WHERE organization_id=$1 AND owner_member_id=$2 AND state='PROCESSING' AND lease_until<clock_timestamp()", [organizationId, memberId]);
    const next = (await ctx.c.query("SELECT id FROM interop_project_output_deliveries WHERE organization_id=$1 AND owner_member_id=$2 AND state IN ('PENDING','RETRY') AND available_at<=clock_timestamp() ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 1", [organizationId, memberId])).rows[0];
    if (!next) return null;
    const row = await joined(ctx, next.id);
    let allowed = current(row) && row.attempts < 5;
    if (allowed) { try { await work.authorizeDelivery(ctx, { taskId: row.task_id, projectId: row.project_id }); } catch (error) { if (!(error instanceof Failure)) throw error; allowed = false; } }
    if (!allowed) {
      await ctx.c.query("UPDATE interop_project_output_deliveries SET state='CANCELLED',last_error='RESOURCE_AUTHORIZATION_CHANGED',version=version+1 WHERE organization_id=$1 AND id=$2", [organizationId, row.id]);
      return { cancelled: true as const };
    }
    const token = uuid();
    await ctx.c.query("UPDATE interop_project_output_deliveries SET state='PROCESSING',attempts=attempts+1,lease_token=$3,lease_until=clock_timestamp()+interval '30 seconds',io_started_at=NULL,version=version+1 WHERE organization_id=$1 AND id=$2", [organizationId, row.id, token]);
    return { cancelled: false as const, row, token };
  });
  if (!claim) return false;
  if (claim.cancelled) return true;
  const guarded = <T>(fn: (ctx: Ctx) => Promise<T>) => context(async ctx => {
    const row = await joined(ctx, claim.row.id);
    if (!current(row) || row.state !== "PROCESSING" || row.lease_token !== claim.token) fail(409, "PROJECT_OUTPUT_CHANGED");
    await work.authorizeDelivery(ctx, { projectId: row.project_id, taskId: row.task_id });
    return fn(ctx);
  });
  let result: { kind: string; code?: string; retryAfterMs?: number; remoteId?: string };
  try {
    const key = await service.grants.key();
    const readiness = await service.grants.ready(claim.row.connection_id, guarded, key);
    if (readiness !== "READY") result = readiness === "RETRY" ? { kind: "RETRYABLE", code: "PROVIDER_REFRESH_IN_PROGRESS", retryAfterMs: 30000 } : { kind: "BLOCKED", code: "PROVIDER_REAUTHORIZATION_REQUIRED" };
    else {
      await guarded(async ctx => {
        await ctx.c.query("UPDATE interop_project_output_deliveries SET io_started_at=clock_timestamp(),lease_until=clock_timestamp()+interval '30 seconds' WHERE organization_id=$1 AND id=$2 AND lease_token=$3", [organizationId, claim.row.id, claim.token]);
      });
      result = await service.grants.protocol(organizationId, claim.row.connection_id, guarded, key).createCard({ listId: claim.row.list_id, title: claim.row.title, description: claim.row.description_plain, correlationId: claim.row.marker });
    }
  } catch (error) {
    if (!(error instanceof Failure)) throw error;
    result = { kind: "CANCELLED", code: error.code };
  }
  await context(async ctx => {
    const row = await joined(ctx, claim.row.id);
    if (!row || row.state !== "PROCESSING" || row.lease_token !== claim.token) return;
    let stillAllowed = current(row);
    if (stillAllowed) { try { await work.authorizeDelivery(ctx, { projectId: row.project_id, taskId: row.task_id }); } catch (error) { if (!(error instanceof Failure)) throw error; stillAllowed = false; } }
    const state = !stillAllowed || result.kind === "CANCELLED" ? "CANCELLED" : result.kind === "CONFIRMED" ? "CONFIRMED" : result.kind === "OUTCOME_UNKNOWN" ? "OUTCOME_UNKNOWN" : result.kind === "RETRYABLE" && row.attempts < 5 ? "RETRY" : "FAILED";
    const delay = Math.max(1000, Math.min(3600000, result.retryAfterMs ?? 30000));
    const updated = await ctx.c.query("UPDATE interop_project_output_deliveries SET state=$4,last_error=$5,remote_id=COALESCE($6,remote_id),remote_effect_possible=remote_effect_possible OR $7,lease_token=NULL,lease_until=NULL,available_at=clock_timestamp()+($8*interval '1 millisecond'),version=version+1 WHERE organization_id=$1 AND id=$2 AND lease_token=$3 RETURNING available_at", [organizationId, row.id, claim.token, state, state === "CONFIRMED" ? null : result.code ?? "RESOURCE_AUTHORIZATION_CHANGED", result.remoteId ?? null, state === "OUTCOME_UNKNOWN" || (state === "CANCELLED" && row.io_started_at !== null), delay]);
    await event(ctx.c, organizationId, ctx.account.id, row.id, "ProjectOutput" + state, uuid());
    if (state === "RETRY") await scheduling.schedule(ctx, { memberId, availableAt: new Date(updated.rows[0].available_at) });
  });
  return true;
}
