import { assertPlatformDispatchReady } from "../platform/dispatch-readiness.js";
import { transaction } from "../../src/db.js";
import { authorizeOrganizationEffect, recordOrganizationEffectOutcome } from "../../src/organization-effects.js";
import type { FastifyInstance } from "fastify";
import type { ModuleRuntime } from "../../src/runtime.js";
import { body, camel, fail, id, uuid, version } from "../../src/core.js";
import { signWebhook } from "./webhook.js";
import type { DeliverySchedulingPort } from "./delivery-worker.js";
/** Server-owned adapter contract; never selected by request body or remote headers. */
export type DeliveryResponseDispositionPort = (input: { organizationId: string; connectionId: string; status: number }) => "REJECTED" | "OUTCOME_UNKNOWN";
export type DeliveryConfigurations = Record<
  string,
  { endpoint: string; secret: string; allowLocalHttp?: boolean }
>;
export async function registerDeliveries(
  app: FastifyInstance,
  core: ModuleRuntime,
  base: string,
  configuration: DeliveryConfigurations,
  scheduling?: DeliverySchedulingPort,
  responseDisposition?: DeliveryResponseDispositionPort,
) {
  app.get(base + "/connections/:connectionId/deliveries", (r) =>
    core.tenant(
      r,
      { mode: "read", authorize: (ctx) => ctx.member.org_role === "OWNER" },
      async (ctx) => ({
        items: (
          await ctx.c.query(
            "SELECT id,event_id,state,attempts,version,last_error,lease_until FROM interop_deliveries WHERE organization_id=$1 AND connection_id=$2 ORDER BY id LIMIT 100",
            [ctx.org.id, id((r.params as any).connectionId)],
          )
        ).rows.map(camel),
      }),
    ),
  );
  app.post(base + "/connections/:connectionId/deliveries", (r) =>
    core.tenant(r, true, async (ctx) => {
      const connectionId = id((r.params as any).connectionId);
      if (!configuration[ctx.org.id + ":" + connectionId])
        fail(503, "EXTERNAL_CONFIGURATION_REQUIRED");
      const b = body(r, ["calendarEventId"]);
      const connection = (
        await ctx.c.query(
          "SELECT * FROM interop_connections WHERE organization_id=$1 AND id=$2 AND state<>'REVOKED'",
          [ctx.org.id, connectionId],
        )
      ).rows[0];
      if (!connection) fail(404, "RESOURCE_NOT_FOUND");
      const e = (
        await ctx.c.query(
          "SELECT * FROM interop_calendar_events WHERE organization_id=$1 AND id=$2",
          [ctx.org.id, id(b.calendarEventId)],
        )
      ).rows[0];
      if (!e) fail(404, "RESOURCE_NOT_FOUND");
      if (e.source !== "LOCAL") fail(409, "SYNC_LOOP_PREVENTED");
      const eventId = e.id + ":" + e.sequence,
        payload = {
          command: "calendar.upsert",
          origin: "orgmap",
          data: {
            uid: e.uid,
            sequence: e.sequence,
            summary: e.summary,
            startsAt: e.starts_at,
            endsAt: e.ends_at,
            cancelled: e.cancelled,
          },
        };
      const row = (
        await ctx.c.query(
          "INSERT INTO interop_deliveries(organization_id,id,connection_id,event_id,payload,owner_member_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(organization_id,connection_id,event_id) DO UPDATE SET event_id=excluded.event_id RETURNING id,state,version",
          [ctx.org.id, uuid(), connectionId, eventId, payload, ctx.member.id],
        )
      ).rows[0];
      await core.changed(ctx, r, row.id, "IntegrationDeliveryQueued");
      if (scheduling) await scheduling.schedule(ctx);
      return { delivery: camel(row) };
    }),
  );
  app.put(
    base + "/connections/:connectionId/deliveries/:deliveryId/dispatch",
    async (r) => {
      await assertPlatformDispatchReady();
      const prepared = await core.tenant(r, true, async (ctx) => {
        const connectionId = id((r.params as any).connectionId),
          deliveryId = id((r.params as any).deliveryId),
          config = configuration[ctx.org.id + ":" + connectionId];
        if (!config) fail(503, "EXTERNAL_CONFIGURATION_REQUIRED");
        const endpoint = new URL(config.endpoint);
        if (
          endpoint.protocol !== "https:" &&
          !(
            config.allowLocalHttp &&
            endpoint.protocol === "http:" &&
            ["localhost", "127.0.0.1"].includes(endpoint.hostname)
          )
        )
          fail(400, "INSECURE_PROVIDER_URL");
        if (endpoint.username || endpoint.password || endpoint.hash)
          fail(400, "INVALID_PROVIDER_URL");
        const row = (
          await ctx.c.query(
            "SELECT d.* FROM interop_deliveries d JOIN interop_connections c ON c.organization_id=d.organization_id AND c.id=d.connection_id WHERE d.organization_id=$1 AND d.id=$2 AND d.connection_id=$3 AND c.state<>'REVOKED'",
            [ctx.org.id, deliveryId, connectionId],
          )
        ).rows[0];
        if (!row) fail(404, "RESOURCE_NOT_FOUND");
        version(r, row.version);
        if (
          row.state === "DELIVERED" ||
          row.state === "REVOKED" ||
          row.state === "OUTCOME_UNKNOWN" ||
          row.attempts >= 5 ||
          (row.state === "SENDING" &&
            new Date(row.lease_until).getTime() > Date.now())
        )
          fail(409, "DELIVERY_NOT_DISPATCHABLE");
        const prior = (await ctx.c.query("SELECT id,state,lifecycle_fence::text AS fence,effect_token FROM organization_effects WHERE organization_id=$1 AND owner='INTEROP' AND effect_key=$2 AND state IN ('AUTHORIZED','CONFIRMED','OUTCOME_UNKNOWN')", [ctx.org.id,"delivery:"+row.id])).rows[0];
        if (prior) {
          if (prior.state === "AUTHORIZED") await recordOrganizationEffectOutcome(ctx.c,{organizationId:ctx.org.id,id:prior.id,fence:prior.fence,token:prior.effect_token},"OUTCOME_UNKNOWN");
          const stopped = (await ctx.c.query("UPDATE interop_deliveries SET state='OUTCOME_UNKNOWN',last_error='EFFECT_OUTCOME_UNRESOLVED',lease_token=NULL,lease_until=NULL,version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING id,state,version,attempts,last_error", [ctx.org.id,row.id])).rows[0];
          return { blocked: true as const, delivery:camel(stopped) };
        }
        const lease = uuid();
        await ctx.c.query(
          "UPDATE interop_deliveries SET state='SENDING',attempts=attempts+1,version=version+1,lease_token=$3,lease_until=now()+interval '30 seconds' WHERE organization_id=$1 AND id=$2",
          [ctx.org.id, row.id, lease],
        );
        const authorization = await authorizeOrganizationEffect(ctx.c, {
          organizationId:ctx.org.id, owner:"INTEROP", effectKey:"delivery:"+row.id, sourceLeaseToken:lease,
          validateSourceLease:async(c,token)=>!!(await c.query(
            "SELECT 1 FROM interop_deliveries WHERE organization_id=$1 AND id=$2 AND lease_token=$3 AND state='SENDING' AND lease_until>clock_timestamp() FOR UPDATE",
            [ctx.org.id,row.id,token])).rowCount,
        });
        return {
          blocked: false as const, authorization, lease,
          payload: row.payload,
          eventId: row.event_id,
          id: row.id,
          connectionId,
          attempt: row.attempts + 1,
        };
      });
      if (prepared.data.blocked) return prepared;
      const config =
          configuration[
            prepared.meta.organizationId + ":" + prepared.data.connectionId
          ],
        bytes = Buffer.from(JSON.stringify(prepared.data.payload)),
        timestamp = Math.floor(Date.now() / 1000);
      let delivered = false,
        disposition: "CONFIRMED" | "NOT_SENT" | "REJECTED" | "OUTCOME_UNKNOWN" = "OUTCOME_UNKNOWN",
        lastError: string | null = null;
      try {
        const response = await fetch(config.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/vnd.orgmap.webhook+json",
            "X-OrgMap-Event-Id": prepared.data.eventId,
            "X-OrgMap-Timestamp": String(timestamp),
            "X-OrgMap-Signature": signWebhook(
              config.secret,
              prepared.data.eventId,
              timestamp,
              bytes,
            ),
          },
          body: bytes,
          redirect: "error",
          signal: AbortSignal.timeout(10000),
        });
        delivered = response.ok;
        disposition = delivered ? "CONFIRMED" : responseDisposition?.({ organizationId:prepared.meta.organizationId, connectionId:prepared.data.connectionId, status:response.status }) === "REJECTED" ? "REJECTED" : "OUTCOME_UNKNOWN";
        lastError = delivered ? null : "REMOTE_HTTP_" + response.status;
        await response.body?.cancel();
      } catch (error) {
        const code = (error as any)?.cause?.code;
        disposition = ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(code) ? "NOT_SENT" : "OUTCOME_UNKNOWN";
        lastError = "REMOTE_DELIVERY_FAILED";
      }
      const recorded = await transaction(async (c) => {
        await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [prepared.meta.organizationId]);
        return recordOrganizationEffectOutcome(c, prepared.data.authorization, disposition);
      });
      if (recorded.cutoverOccurred) fail(404,"RESOURCE_NOT_FOUND");
      if (!recorded.recorded) { delivered=false; disposition="OUTCOME_UNKNOWN"; lastError="EFFECT_OUTCOME_UNRESOLVED"; }
      // Revalidate account/membership/connection after network I/O; never overwrite a revocation.
      return core.tenant(r, { mode: "write" }, async (ctx) => {
        const row = (
          await ctx.c.query(
            "SELECT * FROM interop_deliveries WHERE organization_id=$1 AND id=$2",
            [ctx.org.id, prepared.data.id],
          )
        ).rows[0];
        if (row.state === "REVOKED")
          return {
            delivery: { id: row.id, state: "REVOKED", version: row.version },
          };
        if (row.state !== "SENDING" || row.attempts !== prepared.data.attempt || row.lease_token !== prepared.data.lease)
          fail(409, "DELIVERY_LEASE_CHANGED");
        const updated = (
          await ctx.c.query(
            "UPDATE interop_deliveries SET state=$3,last_error=$4,lease_until=NULL,lease_token=NULL,version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING id,state,version,attempts,last_error",
            [ctx.org.id, row.id, delivered ? "DELIVERED" : (disposition === "NOT_SENT" || disposition === "REJECTED") ? "FAILED" : "OUTCOME_UNKNOWN", lastError],
          )
        ).rows[0];
        await core.changed(
          ctx,
          r,
          row.id,
          delivered
            ? "IntegrationDeliveryConfirmed"
            : "IntegrationDeliveryFailed",
        );
        return { delivery: camel(updated) };
      });
    },
  );
}
