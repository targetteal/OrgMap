import { assertPlatformDispatchReady } from "../platform/dispatch-readiness.js";
import { transaction } from "../../src/db.js";
import { assertManagedWriter } from "../../src/managed-writer.js";
import { authorizeOrganizationEffect, recordOrganizationEffectOutcome } from "../../src/organization-effects.js";
import type { Ctx } from "../../src/runtime.js";
import { event, fail, uuid } from "../../src/core.js";
import { signWebhook } from "./webhook.js";
import type { DeliveryConfigurations, DeliveryResponseDispositionPort } from "./delivery.js";
export interface DeliverySchedulingPort {
  schedule(ctx: Ctx, options?: { availableAt: Date }): Promise<void>;
}
export type DeliveryWorkerContext = <T>(
  organizationId: string,
  memberId: string,
  fn: (ctx: Ctx) => Promise<T>,
) => Promise<T>;
/** Called by the durable dispatcher with a freshly authorized IAM worker context, never a cookie. */
export class InteroperabilityDeliveryWorker {
  constructor(
    private options: {
      withContext: DeliveryWorkerContext;
      configuration: DeliveryConfigurations;
      scheduling?: DeliverySchedulingPort;
      responseDisposition?: DeliveryResponseDispositionPort;
    },
  ) {}
  async runDelivery(organizationId: string, memberId: string) {
    await transaction(assertManagedWriter);
    await assertPlatformDispatchReady();
    const claim = await this.options.withContext(
      organizationId,
      memberId,
      async (ctx) => {
        if (ctx.member.org_role !== "OWNER") fail(403, "ACTION_DENIED");
        await ctx.c.query(
          "UPDATE interop_deliveries SET state='FAILED',last_error='LEASE_EXHAUSTED',lease_token=NULL,lease_until=NULL,version=version+1 WHERE organization_id=$1 AND owner_member_id=$2 AND state='SENDING' AND attempts>=5 AND lease_until<clock_timestamp()",
          [organizationId, memberId],
        );
        const row = (
          await ctx.c.query(
            "SELECT d.* FROM interop_deliveries d JOIN interop_connections c ON c.organization_id=d.organization_id AND c.id=d.connection_id WHERE d.organization_id=$1 AND d.owner_member_id=$2 AND c.state<>'REVOKED' AND d.attempts<5 AND d.available_at<=clock_timestamp() AND (d.state IN ('PENDING','FAILED') OR (d.state='SENDING' AND d.lease_until<clock_timestamp())) ORDER BY d.available_at,d.id FOR UPDATE OF d SKIP LOCKED LIMIT 1",
            [organizationId, memberId],
          )
        ).rows[0];
        if (!row) return null;
        const prior = (await ctx.c.query("SELECT id,state,lifecycle_fence::text AS fence,effect_token FROM organization_effects WHERE organization_id=$1 AND owner='INTEROP' AND effect_key=$2 AND state IN ('AUTHORIZED','CONFIRMED','OUTCOME_UNKNOWN')", [organizationId, "delivery:" + row.id])).rows[0];
        if (prior) {
          if (prior.state === "AUTHORIZED") await recordOrganizationEffectOutcome(ctx.c, {organizationId,id:prior.id,fence:prior.fence,token:prior.effect_token}, "OUTCOME_UNKNOWN");
          await ctx.c.query("UPDATE interop_deliveries SET state='OUTCOME_UNKNOWN',lease_token=NULL,lease_until=NULL,last_error='EFFECT_OUTCOME_UNRESOLVED',version=version+1 WHERE organization_id=$1 AND id=$2", [organizationId,row.id]);
          return null;
        }
        const configuration =
          this.options.configuration[organizationId + ":" + row.connection_id];
        if (!configuration || !configuration.secret) {
          const scheduled = await ctx.c.query(
            "UPDATE interop_deliveries SET state='FAILED',last_error='EXTERNAL_CONFIGURATION_REQUIRED',available_at=now()+interval '1 hour',version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING available_at",
            [organizationId, row.id],
          );
          if (this.options.scheduling)
            await this.options.scheduling.schedule(ctx, {
              availableAt: new Date(scheduled.rows[0].available_at),
            });
          return null;
        }
        const endpoint = new URL(configuration.endpoint);
        if (
          endpoint.username ||
          endpoint.password ||
          endpoint.hash ||
          (endpoint.protocol !== "https:" &&
            !(
              configuration.allowLocalHttp &&
              endpoint.protocol === "http:" &&
              ["localhost", "127.0.0.1"].includes(endpoint.hostname)
            ))
        )
          fail(400, "INSECURE_PROVIDER_URL");
        const token = uuid();
        await ctx.c.query(
          "UPDATE interop_deliveries SET state='SENDING',attempts=attempts+1,lease_token=$3,lease_until=now()+interval '30 seconds',version=version+1 WHERE organization_id=$1 AND id=$2",
          [organizationId, row.id, token],
        );
        return {
          id: row.id,
          connectionId: row.connection_id,
          eventId: row.event_id,
          payload: row.payload,
          token,
          attempt: row.attempts + 1,
          configuration,
        };
      },
    );
    if (!claim) return false;
    // A second current guard immediately before I/O catches queued revocations and suspension.
    const authorization = await this.options.withContext(
      organizationId, memberId, async (ctx) => {
        if (ctx.member.org_role !== "OWNER") fail(403, "ACTION_DENIED");
        return authorizeOrganizationEffect(ctx.c, {
          organizationId, owner:"INTEROP", effectKey:"delivery:" + claim.id, sourceLeaseToken:claim.token,
          validateSourceLease: async (c, token) => !!(await c.query(
            `SELECT 1 FROM interop_deliveries d JOIN interop_connections n ON n.organization_id=d.organization_id AND n.id=d.connection_id
             WHERE d.organization_id=$1 AND d.id=$2 AND d.lease_token=$3 AND d.lease_until>clock_timestamp() AND d.state='SENDING' AND n.state<>'REVOKED' FOR UPDATE OF d`,
            [organizationId,claim.id,token])).rowCount,
        });
      },
    );
    const bytes = Buffer.from(JSON.stringify(claim.payload)),
      timestamp = Math.floor(Date.now() / 1000);
    let delivered = false,
      disposition: "CONFIRMED" | "NOT_SENT" | "REJECTED" | "OUTCOME_UNKNOWN" = "OUTCOME_UNKNOWN",
      lastError: string | null = null;
    try {
      const response = await fetch(claim.configuration.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/vnd.orgmap.webhook+json",
          "X-OrgMap-Event-Id": claim.eventId,
          "X-OrgMap-Timestamp": String(timestamp),
          "X-OrgMap-Signature": signWebhook(
            claim.configuration.secret,
            claim.eventId,
            timestamp,
            bytes,
          ),
        },
        body: bytes,
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      delivered = response.ok;
      disposition = delivered ? "CONFIRMED" : this.options.responseDisposition?.({organizationId, connectionId:claim.connectionId, status:response.status}) === "REJECTED" ? "REJECTED" : "OUTCOME_UNKNOWN";
      lastError = delivered ? null : "REMOTE_HTTP_" + response.status;
      await response.body?.cancel();
    } catch (error) {
      const code = (error as any)?.cause?.code;
      disposition = ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(code) ? "NOT_SENT" : "OUTCOME_UNKNOWN";
      lastError = "REMOTE_DELIVERY_FAILED";
    }
    const recorded = await transaction(async (c) => {
      await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [organizationId]);
      return recordOrganizationEffectOutcome(c, authorization, disposition);
    });
    if (recorded.cutoverOccurred) return true;
    if (!recorded.recorded) { delivered = false; disposition = "OUTCOME_UNKNOWN"; lastError = "EFFECT_OUTCOME_UNRESOLVED"; }
    await this.options.withContext(organizationId, memberId, async (ctx) => {
      const row = (
        await ctx.c.query(
          "SELECT * FROM interop_deliveries WHERE organization_id=$1 AND id=$2 FOR UPDATE",
          [organizationId, claim.id],
        )
      ).rows[0];
      if (
        !row ||
        row.state === "REVOKED" ||
        row.lease_token !== claim.token ||
        row.attempts !== claim.attempt
      )
        return;
      const scheduled = await ctx.c.query(
        "UPDATE interop_deliveries SET state=$4,last_error=$5,lease_token=NULL,lease_until=NULL,available_at=now()+((power(2,attempts)+random())*interval '1 second'),version=version+1 WHERE organization_id=$1 AND id=$2 AND lease_token=$3 RETURNING available_at",
        [
          organizationId,
          claim.id,
          claim.token,
          delivered ? "DELIVERED" : (disposition === "NOT_SENT" || disposition === "REJECTED") ? "FAILED" : "OUTCOME_UNKNOWN",
          lastError,
        ],
      );
      await event(
        ctx.c,
        organizationId,
        ctx.account.id,
        claim.id,
        delivered
          ? "IntegrationDeliveryConfirmed"
          : "IntegrationDeliveryFailed",
        uuid(),
      );
      if (!delivered && (disposition === "NOT_SENT" || disposition === "REJECTED") && claim.attempt < 5 && this.options.scheduling)
        await this.options.scheduling.schedule(ctx, {
          availableAt: new Date(scheduled.rows[0].available_at),
        });
    });
    return true;
  }
}
