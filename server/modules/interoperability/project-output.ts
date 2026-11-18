import type { Ctx } from "../../src/runtime.js";
import type { FastifyInstance } from "fastify";
import { event, fail, id, uuid } from "../../src/core.js";
import type { ProjectOutputOptions, ProjectOutputIntegration, WorkTaskCreatedSignal } from "./project-output-contract.js";
import { ProjectOutputGrants } from "./project-output-grants.js";
import { registerProjectOutputRoutes } from "./project-output-routes.js";
import { runProjectOutputDelivery } from "./project-output-worker.js";
export async function cancelProjectOutputConfig(ctx: Ctx, configId: string, reason: string) {
  await ctx.c.query("UPDATE interop_project_output_deliveries SET state='CANCELLED',remote_effect_possible=remote_effect_possible OR io_started_at IS NOT NULL OR state='OUTCOME_UNKNOWN',last_error=$3,lease_token=NULL,lease_until=NULL,version=version+1 WHERE organization_id=$1 AND config_id=$2 AND state NOT IN ('CONFIRMED','CANCELLED')", [ctx.org.id, configId, reason]);
}
export async function revokeProjectOutputConnection(ctx: Ctx, connectionId: string) {
  await ctx.c.query("UPDATE interop_provider_grants SET state='REVOKED',authorization_revision=authorization_revision+1,version=version+1,access_encrypted=NULL,refresh_encrypted=NULL,refresh_lease=NULL,refresh_lease_until=NULL WHERE organization_id=$1 AND id=$2", [ctx.org.id, connectionId]);
  await ctx.c.query("UPDATE interop_provider_oauth_flows SET consumed_at=clock_timestamp() WHERE organization_id=$1 AND grant_id=$2 AND consumed_at IS NULL", [ctx.org.id, connectionId]);
  const configs = (await ctx.c.query("UPDATE interop_project_output_configs SET enabled=false,version=version+1 WHERE organization_id=$1 AND connection_id=$2 RETURNING id", [ctx.org.id, connectionId])).rows;
  for (const config of configs) await cancelProjectOutputConfig(ctx, config.id, "CONNECTION_REVOKED");
}
export class ProjectOutputService implements ProjectOutputIntegration {
  readonly grants: ProjectOutputGrants;
  constructor(readonly options: ProjectOutputOptions) {
    if (![options.work?.authorizeConfiguration, options.work?.captureCreatedTask, options.work?.authorizeDelivery, options.scheduling?.schedule, options.encryptionKey].every(fn => typeof fn === "function")) throw Error("PROJECT_OUTPUT_DEPENDENCY_REQUIRED");
    this.grants = new ProjectOutputGrants(options);
  }
  async authorizeConfiguration(ctx: Ctx, projectId: string) {
    if (ctx.principal || this.options.core.isGuest(ctx)) fail(403, "ACTION_DENIED");
    await this.options.work.authorizeConfiguration(ctx, { projectId });
  }
  async config(ctx: Ctx, projectId: string) {
    return (await ctx.c.query("SELECT * FROM interop_project_output_configs WHERE organization_id=$1 AND project_id=$2 FOR UPDATE", [ctx.org.id, projectId])).rows[0] ?? null;
  }
  metadata(row: any) { return row ? { id: row.id, projectId: row.project_id, provider: row.provider, connectionId: row.connection_id, boardId: row.board_id, listId: row.list_id, enabled: row.enabled, version: row.version, activatedAt: row.activated_at } : null; }
  async register(app: FastifyInstance, base: string) { await registerProjectOutputRoutes(app, base, this); }
  async onTaskCreated(ctx: Ctx, signal: WorkTaskCreatedSignal) {
    if (ctx.mode === "read" || signal.kind !== "WORK_TASK_CREATED") fail(400, "INVALID_PROJECT_OUTPUT_SIGNAL");
    id(signal.projectId); id(signal.taskId);
    if (!/T.*(Z|[+-]\d{2}:\d{2})$/.test(signal.occurredAt) || !Number.isFinite(+new Date(signal.occurredAt))) fail(400, "INVALID_PROJECT_OUTPUT_SIGNAL");
    const config = await this.config(ctx, signal.projectId);
    if (!config?.enabled || !config.activated_at || +new Date(signal.occurredAt) < +new Date(config.activated_at)) return;
    const task = await this.options.work.captureCreatedTask(ctx, signal);
    if (task.taskId !== signal.taskId || task.projectId !== signal.projectId || !Number.isSafeInteger(task.taskVersion) || task.taskVersion < 1 || typeof task.title !== "string" || !task.title.trim() || task.title.length > 200 || typeof task.descriptionPlain !== "string" || task.descriptionPlain.length > 16000) fail(422, "PROJECT_OUTPUT_SNAPSHOT_INVALID");
    const deliveryId = uuid();
    const queued = await ctx.c.query("INSERT INTO interop_project_output_deliveries(organization_id,id,config_id,config_revision,project_id,task_id,task_version,kind,owner_member_id,title,description_plain,occurred_at,marker) VALUES($1,$2,$3,$4,$5,$6,$7,'WORK_TASK_CREATED',$8,$9,$10,$11,$12) ON CONFLICT(organization_id,config_id,task_id,kind) DO NOTHING RETURNING id", [ctx.org.id, deliveryId, config.id, config.version, signal.projectId, signal.taskId, task.taskVersion, config.owner_member_id, task.title, task.descriptionPlain, signal.occurredAt, uuid()]);
    if (queued.rowCount) {
      await this.options.scheduling.schedule(ctx, { memberId: config.owner_member_id });
      await event(ctx.c, ctx.org.id, ctx.account.id, deliveryId, "ProjectTaskOutputQueued", ctx.requestId ?? uuid());
    }
  }
  async runDelivery(organizationId: string, memberId: string) { return runProjectOutputDelivery(this, organizationId, memberId); }
}
export function createProjectOutputIntegration(options: ProjectOutputOptions) { return new ProjectOutputService(options); }
