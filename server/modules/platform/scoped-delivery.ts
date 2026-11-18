import { assertPlatformDispatchReady } from "./dispatch-readiness.js";
import { transaction } from "../../src/db.js";
import { authorizeOrganizationEffect, recordOrganizationEffectOutcome, type EffectAuthorization } from "../../src/organization-effects.js";
import { SmtpDeliveryError } from "../../src/smtp.js";
import type { Ctx } from "../../src/runtime.js";
import { Failure } from "../../src/core.js";
import { ResourceRegistry, type ResourceRef } from "./ports.js";
import type {
  DeliveryMetadataPort,
  DeliveryScope,
} from "./delivery-metadata.js";
import type { NotificationTransport, NotificationBrandingPort } from "./worker.js";
import { effectivePreference, notificationStillFollowed } from "./notifications.js";
import {renderNotificationMail} from './notification-mail.js';
/** Host must enter original-resource/read guard, ACTIVE membership, org lock and RLS before fn. */
export type ReadResourceWorkerContextPort = <T>(
  organizationId: string,
  memberId: string,
  resource: ResourceRef,
  fn: (ctx: Ctx) => Promise<T>,
) => Promise<T>;
export interface ScopedDeliveryBridge {
  hasDueJobs(scope: DeliveryScope): Promise<boolean>;
  run(scope: DeliveryScope): Promise<boolean>;
}
export class ScopedDeliveryWorker implements ScopedDeliveryBridge {
  constructor(
    private options: {
      metadata: DeliveryMetadataPort;
      withReadResourceContext: ReadResourceWorkerContextPort;
      registry: ResourceRegistry;
      transport?: NotificationTransport;
      notificationBranding?: NotificationBrandingPort;
    },
  ) {}
  hasDueJobs(scope: DeliveryScope) {
    return this.options.metadata.hasDueJobs(scope);
  }
  async run(scope: DeliveryScope) {
    await assertPlatformDispatchReady();
    const { metadata, registry, withReadResourceContext, transport } =
      this.options;
    const claim = await metadata.claim(scope);
    if (!claim) return false;
    if (
      claim.scope.organizationId !== scope.organizationId ||
      claim.scope.memberId !== scope.memberId ||
      claim.scope.token !== scope.token
    )
      throw new Error("DELIVERY_CLAIM_SCOPE_MISMATCH");
    const guarded = <T>(fn: (ctx: Ctx) => Promise<T>) =>
      withReadResourceContext(
        scope.organizationId,
        scope.memberId,
        claim.resource,
        async (ctx) => {
          // Domain ACL intersects the original grant before any delivery/event/email read.
          await registry.require(ctx, claim.resource, "read");
          return fn(ctx);
        },
      );
    let effect: EffectAuthorization | undefined;
    try {
      const outgoing = await guarded(async (ctx) => {
        const d = (
          await ctx.c.query(
            "SELECT * FROM platform_deliveries WHERE organization_id=$1 AND recipient_id=$2 AND id=$3 AND lease_token=$4 AND state='PENDING' FOR UPDATE",
            [scope.organizationId, scope.memberId, claim.id, claim.token],
          )
        ).rows[0];
        if (!d) return null;
        if (
          d.resource_type !== claim.resource.type ||
          d.resource_id !== claim.resource.id
        )
          throw new Failure(404, "RESOURCE_NOT_FOUND");
        const preference = await effectivePreference(
          ctx,
          scope.memberId,
          d.event,
          d.channel,
          registry,
        );
        const follows = await notificationStillFollowed(ctx,d,registry);
        if (!preference.enabled || !follows) {
          await ctx.c.query(
            "UPDATE platform_deliveries SET state='SUPPRESSED',lease_token=NULL,lease_until=NULL WHERE organization_id=$1 AND id=$2 AND lease_token=$3",
            [scope.organizationId, claim.id, claim.token],
          );
          return null;
        }
        if (d.channel === "IN_APP") {
          await ctx.c.query(
            "UPDATE platform_deliveries SET state='DELIVERED',lease_token=NULL,lease_until=NULL WHERE organization_id=$1 AND id=$2 AND lease_token=$3",
            [scope.organizationId, claim.id, claim.token],
          );
          return null;
        }
        const prior = (await ctx.c.query("SELECT id,state,lifecycle_fence::text AS fence,effect_token FROM organization_effects WHERE organization_id=$1 AND owner='PLATFORM' AND effect_key=$2 AND state IN ('AUTHORIZED','CONFIRMED','OUTCOME_UNKNOWN')", [scope.organizationId,"delivery:"+d.id])).rows[0];
        if (prior) {
          if (prior.state === "AUTHORIZED") await recordOrganizationEffectOutcome(ctx.c,{organizationId:scope.organizationId,id:prior.id,fence:prior.fence,token:prior.effect_token},"OUTCOME_UNKNOWN");
          await ctx.c.query("UPDATE platform_deliveries SET state='OUTCOME_UNKNOWN',lease_token=NULL,lease_until=NULL WHERE organization_id=$1 AND id=$2 AND lease_token=$3", [scope.organizationId,d.id,claim.token]);
          return null;
        }
        if (!transport) throw new SmtpDeliveryError("NOT_SENT", "SMTP configuration required");
        const inlineBrand = this.options.notificationBranding ? await this.options.notificationBranding(ctx) : null;
        const authorization = await authorizeOrganizationEffect(ctx.c, {
          organizationId: scope.organizationId, owner: "PLATFORM", effectKey: "delivery:" + d.id,
          sourceLeaseToken: claim.token,
          validateSourceLease: async (c, token, fence) => !!(await c.query(
            `SELECT 1 FROM platform_deliveries d JOIN platform_worker_scopes s ON s.organization_id=d.organization_id AND s.member_id=d.recipient_id
             WHERE d.organization_id=$1 AND d.id=$2 AND d.recipient_id=$3 AND d.lease_token=$4 AND d.lifecycle_fence=$5::bigint AND d.lease_until>clock_timestamp()
               AND s.lease_token=$6 AND s.lifecycle_fence=$5::bigint AND s.lease_until>clock_timestamp() FOR UPDATE OF d,s`,
            [scope.organizationId, d.id, scope.memberId, token, fence, scope.token])).rowCount,
        });
        const content = await registry.get(d.resource_type)?.notificationMail?.(ctx, d.resource_id, d.event) ?? await renderNotificationMail(ctx,registry,d);
        return { id: d.id, email: ctx.account.email, event: d.event, inlineBrand, content, authorization };
      });
      if (outgoing) {
        effect = outgoing.authorization;
        await transport!.send(outgoing);
        const recorded = await transaction(async (c) => {
          await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [scope.organizationId]);
          return recordOrganizationEffectOutcome(c, effect!, "CONFIRMED");
        });
        effect = undefined;
        if (!recorded.cutoverOccurred) {
          if (!recorded.recorded) await metadata.finish(claim, "UNKNOWN");
          else {
            await guarded(async () => {});
            await metadata.finish(claim, "DELIVERED");
          }
        }
      }
    } catch (error) {
      const denied = error instanceof Failure && [403, 404].includes(error.status);
      const duplicate = (error as any)?.code === "23505" && (error as any)?.constraint === "organization_effects_no_unsafe_retry";
      const disposition = error instanceof SmtpDeliveryError ? error.disposition : "OUTCOME_UNKNOWN";
      if (effect) {
        await transaction(async (c) => {
          await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [scope.organizationId]);
          await recordOrganizationEffectOutcome(c, effect!, disposition);
        });
      }
      await metadata.finish(claim, denied ? "SUPPRESSED" : duplicate || (effect && disposition === "OUTCOME_UNKNOWN") ? "UNKNOWN" : "RETRY");
    }
    return true;
  }
}
