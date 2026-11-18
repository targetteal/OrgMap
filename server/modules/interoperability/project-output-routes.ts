import type { FastifyInstance, FastifyRequest } from "fastify";
import { body, digest, fail, id, text, uuid, version } from "../../src/core.js";
import type { Ctx } from "../../src/runtime.js";
import type { ProjectOutputService } from "./project-output.js";
import { cancelProjectOutputConfig, revokeProjectOutputConnection } from "./project-output.js";
import { TrelloOAuthProtocol } from "./providers/trello-oauth.js";
import { openProviderToken, sealProviderToken } from "./providers/secrets.js";
const actor = (ctx: Ctx) => !ctx.principal && ctx.member.member_type !== "GUEST";
export async function registerProjectOutputRoutes(app: FastifyInstance, base: string, service: ProjectOutputService) {
  const { core } = service.options, grants = service.grants;
  const cookie = (reply: any, state: string, org: string) => reply.setCookie("orgmap_trello_flow", state, { path: "/", httpOnly: true, sameSite: "lax", secure: new URL(grants.app(org).callbackUri).protocol === "https:", maxAge: 300 });
  app.get(base + "/project-output/connections", r => core.tenant(r, { mode: "read", authorize: actor }, async ctx => ({ connections: (await ctx.c.query("SELECT g.id,g.provider,g.state,g.scopes,g.expires_at,g.version FROM interop_provider_grants g WHERE organization_id=$1 AND owner_member_id=$2 ORDER BY g.created_at", [ctx.org.id, ctx.member.id])).rows.map(row => grants.metadata(row)) })));
  app.post(base + "/project-output/trello/authorize", async (r, reply) => {
    const check = await core.tenant(r, { mode: "read", authorize: actor }, async ctx => ({ org: ctx.org.id }));
    const org = check.data.org, config = grants.app(org), key = await grants.key(), oauth = new TrelloOAuthProtocol(config);
    const result = await core.tenant(r, { mode: "authorization_write", authorize: actor, beforeReplay: async (ctx, prior) => {
      const state = new URL(prior.authorizationUrl).searchParams.get("state");
      const valid = await ctx.c.query("SELECT 1 FROM interop_provider_oauth_flows f JOIN interop_provider_grants g ON g.organization_id=f.organization_id AND g.id=f.grant_id WHERE f.organization_id=$1 AND f.state_hash=$2 AND g.owner_member_id=$3 AND f.grant_revision=g.authorization_revision AND f.consumed_at IS NULL AND f.expires_at>clock_timestamp()", [ctx.org.id, digest(state ?? ""), ctx.member.id]);
      if (!valid.rowCount) fail(409, "PROVIDER_AUTHORIZATION_EXPIRED");
    } }, async ctx => {
      const b = body(r, ["label", "connectionId"]);
      let grant: any;
      if (b.connectionId !== undefined) {
        grant = await grants.get(ctx, id(b.connectionId), false); version(r, grant.version);
        grant = (await ctx.c.query("UPDATE interop_provider_grants SET state=CASE WHEN state='AUTHORIZED' THEN state ELSE 'PENDING_CONSENT' END,authorization_revision=authorization_revision+1,version=version+1,refresh_lease=NULL,refresh_lease_until=NULL WHERE organization_id=$1 AND id=$2 RETURNING *", [ctx.org.id, grant.id])).rows[0];
        await ctx.c.query("UPDATE interop_connections SET state='CONFIGURED',version=version+1 WHERE organization_id=$1 AND id=$2", [ctx.org.id, grant.id]);
      } else {
        const connectionId = uuid();
        await ctx.c.query("INSERT INTO interop_connections(organization_id,id,provider,label,state) VALUES($1,$2,'TRELLO',$3,'CONFIGURED')", [ctx.org.id, connectionId, text(b.label ?? "Trello")]);
        grant = (await ctx.c.query("INSERT INTO interop_provider_grants(organization_id,id,owner_member_id,provider) VALUES($1,$2,$3,'TRELLO') RETURNING *", [ctx.org.id, connectionId, ctx.member.id])).rows[0];
      }
      const flow = oauth.begin();
      await ctx.c.query("INSERT INTO interop_provider_oauth_flows(organization_id,state_hash,grant_id,grant_revision,verifier_encrypted,expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '5 minutes')", [ctx.org.id, digest(flow.state), grant.id, grant.authorization_revision, sealProviderToken(key, grants.scope(grant), "PKCE_VERIFIER", flow.verifier)]);
      await core.changed(ctx, r, grant.id, "ProjectOutputConsentStarted");
      return { connectionId: grant.id, authorizationUrl: flow.authorizationUrl };
    });
    cookie(reply, new URL(result.data.authorizationUrl).searchParams.get("state")!, org);
    reply.header("Cache-Control", "no-store"); return result;
  });
  app.get(base + "/project-output/trello/callback", async (r, reply) => {
    const q = r.query as any;
    if (Object.keys(q).some(key => !["code", "state", "error", "error_description"].includes(key)) || q.error) fail(401, "TRELLO_AUTHORIZATION_FAILED");
    const state = text(q.state, 200), code = text(q.code, 4096);
    if (r.cookies.orgmap_trello_flow !== state) fail(401, "PROVIDER_BROWSER_STATE_INVALID");
    const authorized = await core.tenant(r, { mode: "read", authorize: actor }, async ctx => ctx.org.id);
    const org = authorized.data, key = await grants.key(), config = grants.app(org);
    const prepared = await core.tenant(r, { mode: "authorization_write", authorize: actor }, async ctx => {
      const flow = (await ctx.c.query("UPDATE interop_provider_oauth_flows SET consumed_at=clock_timestamp() WHERE organization_id=$1 AND state_hash=$2 AND consumed_at IS NULL AND expires_at>clock_timestamp() RETURNING *", [ctx.org.id, digest(state)])).rows[0];
      if (!flow) fail(401, "PROVIDER_AUTHORIZATION_EXPIRED");
      const row = await grants.get(ctx, flow.grant_id, false);
      if (row.authorization_revision !== flow.grant_revision || row.connection_state === "REVOKED") fail(401, "PROVIDER_AUTHORIZATION_EXPIRED");
      return { grantId: row.id, revision: row.authorization_revision, verifier: openProviderToken(key, grants.scope(row), "PKCE_VERIFIER", flow.verifier_encrypted) };
    });
    reply.clearCookie("orgmap_trello_flow", { path: "/" });
    const tokens = await new TrelloOAuthProtocol(config).exchange(code, prepared.data.verifier);
    const result = await core.tenant(r, { mode: "authorization_write", authorize: actor }, async ctx => {
      const row = await grants.get(ctx, prepared.data.grantId, false);
      if (row.authorization_revision !== prepared.data.revision || row.connection_state === "REVOKED") fail(401, "PROVIDER_AUTHORIZATION_EXPIRED");
      const next = await grants.saveTokens(ctx, row, tokens, key, "CONSENT");
      await core.changed(ctx, r, row.id, "ProjectOutputConsentConfirmed"); return { connection: grants.metadata(next) };
    });
    reply.header("Cache-Control", "no-store");
    return r.headers.accept?.includes("text/html") ? reply.redirect("/interoperability") : result;
  });
  app.post(base + "/project-output/connections/:connectionId/revoke", r => core.tenant(r, { mode: "authorization_write", authorize: actor }, async ctx => {
    const row = await grants.get(ctx, id((r.params as any).connectionId), false); version(r, row.version);
    await ctx.c.query("UPDATE interop_connections SET state='REVOKED',version=version+1 WHERE organization_id=$1 AND id=$2", [ctx.org.id, row.id]);
    await revokeProjectOutputConnection(ctx, row.id); await core.changed(ctx, r, row.id, "ProjectOutputConsentRevoked"); return { revoked: true };
  }));
  const project = (r: FastifyRequest) => id((r.params as any).projectId);
  app.get(base + "/project-output/projects/:projectId", r => core.tenant(r, { mode: "read", authorize: actor }, async ctx => {
    await service.authorizeConfiguration(ctx, project(r)); return { configuration: service.metadata(await service.config(ctx, project(r))) };
  }));
  app.put(base + "/project-output/projects/:projectId", async r => {
    const b = body(r, ["enabled", "provider", "connectionId", "boardId", "listId", "confirmDataSharing"]);
    if (typeof b.enabled !== "boolean" || (b.provider !== undefined && b.provider !== "TRELLO") || (b.enabled && b.confirmDataSharing !== true)) fail(400, "INVALID_REQUEST");
    const checked = await core.tenant(r, { mode: "read", authorize: actor }, async ctx => {
      await service.authorizeConfiguration(ctx, project(r));
      const current = await service.config(ctx, project(r)); version(r, current?.version ?? 0);
      const grant = b.enabled ? await grants.get(ctx, id(b.connectionId)) : null;
      return { org: ctx.org.id, grantId: grant?.id, grantRevision: grant?.authorization_revision };
    });
    if (b.enabled) {
      const key = await grants.key(); grants.app(checked.data.org);
      const context = <T>(fn: (ctx: Ctx) => Promise<T>) => core.tenant(r, { mode: "authorization_write", authorize: actor }, async ctx => { await service.authorizeConfiguration(ctx, project(r)); return fn(ctx); }).then(result => result.data);
      const ready = await grants.ready(checked.data.grantId!, context, key);
      if (ready !== "READY") fail(ready === "RETRY" ? 503 : 409, ready === "RETRY" ? "PROVIDER_REFRESH_IN_PROGRESS" : "PROVIDER_REAUTHORIZATION_REQUIRED");
      const probe = await grants.protocol(checked.data.org, checked.data.grantId!, context, key).probeList(text(b.listId, 100), text(b.boardId, 100));
      if (probe.kind !== "CONFIRMED") fail(probe.kind === "RETRYABLE" ? 503 : 409, "PROVIDER_DESTINATION_UNAVAILABLE");
    }
    return core.tenant(r, { mode: "authorization_write", authorize: actor }, async ctx => {
      await service.authorizeConfiguration(ctx, project(r));
      const current = await service.config(ctx, project(r)); version(r, current?.version ?? 0);
      if (!b.enabled && !current) fail(404, "RESOURCE_NOT_FOUND");
      if (b.enabled) {
        const grant = await grants.get(ctx, checked.data.grantId!);
        if (grant.authorization_revision !== checked.data.grantRevision) fail(409, "PROVIDER_GRANT_CHANGED");
      }
      if (current) await cancelProjectOutputConfig(ctx, current.id, "CONFIGURATION_CHANGED");
      const row = current
        ? (await ctx.c.query("UPDATE interop_project_output_configs SET enabled=$3,connection_id=COALESCE($4,connection_id),owner_member_id=CASE WHEN $3 THEN $5 ELSE owner_member_id END,board_id=COALESCE($6,board_id),list_id=COALESCE($7,list_id),version=version+1,activated_at=CASE WHEN $3 THEN clock_timestamp() ELSE activated_at END WHERE organization_id=$1 AND id=$2 RETURNING *", [ctx.org.id, current.id, b.enabled, b.enabled ? checked.data.grantId : null, ctx.member.id, b.enabled ? b.boardId : null, b.enabled ? b.listId : null])).rows[0]
        : (await ctx.c.query("INSERT INTO interop_project_output_configs(organization_id,id,project_id,provider,connection_id,owner_member_id,board_id,list_id,enabled,activated_at) VALUES($1,$2,$3,'TRELLO',$4,$5,$6,$7,true,clock_timestamp()) RETURNING *", [ctx.org.id, uuid(), project(r), checked.data.grantId, ctx.member.id, b.boardId, b.listId])).rows[0];
      await core.changed(ctx, r, row.id, "ProjectOutputConfigured"); return { configuration: service.metadata(row) };
    });
  });
  app.get(base + "/project-output/projects/:projectId/deliveries", r => core.tenant(r, { mode: "read", authorize: actor }, async ctx => {
    await service.authorizeConfiguration(ctx, project(r));
    const rows = (await ctx.c.query("SELECT id,task_id,task_version,state,attempts,remote_id,remote_effect_possible,last_error,version FROM interop_project_output_deliveries WHERE organization_id=$1 AND project_id=$2 ORDER BY created_at DESC", [ctx.org.id, project(r)])).rows;
    const visible = [];
    for (const row of rows) { try { await service.options.work.authorizeDelivery(ctx, { projectId: project(r), taskId: row.task_id }); visible.push({ id: row.id, taskId: row.task_id, taskVersion: row.task_version, state: row.state, attempts: row.attempts, remoteId: row.remote_id, remoteEffectPossible: row.remote_effect_possible, error: row.last_error, version: row.version }); } catch { /* No private task/count projection without current access. */ } }
    return { deliveries: visible };
  }));
  app.put(base + "/project-output/projects/:projectId/deliveries/:deliveryId/reconcile", async r => {
    body(r, []);
    const prepared = await core.tenant(r, { mode: "authorization_write", authorize: actor }, async ctx => {
      await service.authorizeConfiguration(ctx, project(r));
      const row = (await ctx.c.query("SELECT d.*,c.connection_id,c.list_id,c.enabled,c.version AS current_revision FROM interop_project_output_deliveries d JOIN interop_project_output_configs c ON c.organization_id=d.organization_id AND c.id=d.config_id WHERE d.organization_id=$1 AND d.project_id=$2 AND d.id=$3 FOR UPDATE OF d", [ctx.org.id, project(r), id((r.params as any).deliveryId)])).rows[0];
      if (!row) fail(404, "RESOURCE_NOT_FOUND"); version(r, row.version);
      if (row.state !== "OUTCOME_UNKNOWN" || !row.enabled || row.current_revision !== row.config_revision || (row.lease_token && +new Date(row.lease_until) > Date.now())) fail(409, "PROJECT_OUTPUT_NOT_RECONCILABLE");
      await service.options.work.authorizeDelivery(ctx, { projectId: row.project_id, taskId: row.task_id });
      const lease = uuid(); await ctx.c.query("UPDATE interop_project_output_deliveries SET lease_token=$3,lease_until=clock_timestamp()+interval '30 seconds' WHERE organization_id=$1 AND id=$2", [ctx.org.id, row.id, lease]);
      return { row, lease };
    });
    const { row, lease } = prepared.data, org = prepared.meta.organizationId, key = await grants.key();
    const context = <T>(fn: (ctx: Ctx) => Promise<T>) => core.withWorkerContext(org, row.owner_member_id, async ctx => {
      await service.options.work.authorizeDelivery(ctx, { projectId: row.project_id, taskId: row.task_id }); return fn(ctx);
    });
    const ready = await grants.ready(row.connection_id, context, key);
    if (ready !== "READY") fail(503, "PROVIDER_REAUTHORIZATION_REQUIRED");
    const found = await grants.protocol(org, row.connection_id, context, key).findCorrelation(row.list_id, row.marker);
    return core.tenant(r, { mode: "authorization_write", authorize: actor }, async ctx => {
      await service.authorizeConfiguration(ctx, project(r));
      await service.options.work.authorizeDelivery(ctx, { projectId: row.project_id, taskId: row.task_id });
      const current = (await ctx.c.query("SELECT d.*,c.enabled,c.version AS current_revision FROM interop_project_output_deliveries d JOIN interop_project_output_configs c ON c.organization_id=d.organization_id AND c.id=d.config_id WHERE d.organization_id=$1 AND d.id=$2 FOR UPDATE OF d", [ctx.org.id, row.id])).rows[0];
      if (!current || current.state !== "OUTCOME_UNKNOWN" || current.lease_token !== lease || !current.enabled || current.config_revision !== current.current_revision) fail(409, "PROJECT_OUTPUT_CHANGED");
      const matches = found.kind === "CONFIRMED" ? found.matches : [];
      const state = found.kind === "CONFIRMED" && matches.length === 1 ? "CONFIRMED" : "OUTCOME_UNKNOWN";
      await ctx.c.query("UPDATE interop_project_output_deliveries SET state=$3,remote_id=COALESCE($4,remote_id),last_error=$5,lease_token=NULL,lease_until=NULL,version=version+1 WHERE organization_id=$1 AND id=$2", [ctx.org.id, row.id, state, state === "CONFIRMED" ? matches[0] : null, state === "CONFIRMED" ? null : found.kind !== "CONFIRMED" ? "RECONCILIATION_UNAVAILABLE" : matches.length > 1 ? "REMOTE_DUPLICATE_MARKER" : "RECONCILIATION_NOT_FOUND"]);
      await core.changed(ctx, r, row.id, "ProjectOutputReconciled"); return { state, duplicateMarker: matches.length > 1 };
    });
  });
  app.put(base + "/project-output/projects/:projectId/deliveries/:deliveryId/resend", r => core.tenant(r, { mode: "authorization_write", authorize: actor }, async ctx => {
    const b = body(r, ["confirmDuplicateRisk"]); if (b.confirmDuplicateRisk !== true) fail(400, "DUPLICATION_RISK_CONFIRMATION_REQUIRED");
    await service.authorizeConfiguration(ctx, project(r));
    const row = (await ctx.c.query("SELECT d.*,c.enabled,c.version AS current_revision FROM interop_project_output_deliveries d JOIN interop_project_output_configs c ON c.organization_id=d.organization_id AND c.id=d.config_id WHERE d.organization_id=$1 AND d.project_id=$2 AND d.id=$3 FOR UPDATE OF d", [ctx.org.id, project(r), id((r.params as any).deliveryId)])).rows[0];
    if (!row) fail(404, "RESOURCE_NOT_FOUND"); version(r, row.version);
    if (row.state !== "OUTCOME_UNKNOWN" || !row.enabled || row.config_revision !== row.current_revision) fail(409, "PROJECT_OUTPUT_NOT_RECONCILABLE");
    await service.options.work.authorizeDelivery(ctx, { projectId: row.project_id, taskId: row.task_id });
    await ctx.c.query("UPDATE interop_project_output_deliveries SET state='RETRY',attempts=0,available_at=clock_timestamp(),lease_token=NULL,lease_until=NULL,io_started_at=NULL,remote_effect_possible=true,last_error='EXPLICIT_RESEND_DUPLICATION_RISK',version=version+1 WHERE organization_id=$1 AND id=$2", [ctx.org.id, row.id]);
    await service.options.scheduling.schedule(ctx, { memberId: row.owner_member_id }); await core.changed(ctx, r, row.id, "ProjectOutputResendAuthorized"); return { queued: true, remoteEffectPossible: true };
  }));
}
