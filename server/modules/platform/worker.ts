import { assertPlatformDispatchReady } from "./dispatch-readiness.js";
import { transaction } from "../../src/db.js";
import { assertManagedWriter } from "../../src/managed-writer.js";
import { authorizeOrganizationEffect, recordOrganizationEffectOutcome, type EffectAuthorization } from "../../src/organization-effects.js";
import { SmtpDeliveryError } from "../../src/smtp.js";
import type { Ctx } from "../../src/runtime.js";
import { uuid, fail, event } from "../../src/core.js";
import { ResourceRegistry, type NotificationMailContent } from "./ports.js";
import { FilesystemBlobStore } from "./blob.js";
import { encodeTransfer, planHash, type TransferDocument } from "./transfer.js";
import { effectivePreference, notificationStillFollowed } from "./notifications.js";
import {renderNotificationMail} from './notification-mail.js';
import type { ScopedDeliveryBridge } from "./scoped-delivery.js";
import type { DeliveryScope } from "./delivery-metadata.js";
import type { ReportPackageSerializer } from "./report-runtime.js";
import { encodeWorkbook } from "./workbook.js";
import { serializePublicationExport } from "./publication-export.js";
import {
  classifyWorkerError,
  emitWorkerDiagnostic,
  type WorkerDiagnostic,
} from "./diagnostics.js";

/** Composition must acquire foundation authorization guard, recheck ACTIVE membership and install RLS.
 * A fresh transaction is required for every call; do not pass a cached Ctx or an unchecked worker principal.
 * Foundation supplies this port rather than platform querying its identity tables. */
export type WorkerContextPort = <T>(
  organizationId: string,
  memberId: string,
  fn: (ctx: Ctx) => Promise<T>,
) => Promise<T>;
export type NotificationInlineBrand = { content: Uint8Array; contentType: "image/png"; cid: string };
export type NotificationBrandingPort = (ctx: Ctx) => Promise<NotificationInlineBrand | null>;
export interface NotificationTransport {
  send(input: { id: string; email: string; event: string; inlineBrand?: NotificationInlineBrand | null; content?: NotificationMailContent }): Promise<void>;
}
export class PlatformWorker {
  constructor(
    private options: {
      withContext: WorkerContextPort;
      registry: ResourceRegistry;
      blobs: FilesystemBlobStore;
      transport?: NotificationTransport;
      notificationBranding?: NotificationBrandingPort;
      leaseMs?: number;
      onDiagnostic?: (value: WorkerDiagnostic) => void;
      scopedDeliveries?: ScopedDeliveryBridge;
      reportPackages?: ReportPackageSerializer;
    },
  ) {}
  configureScopedDeliveries(bridge: ScopedDeliveryBridge) {
    if (this.options.scopedDeliveries)
      throw Error("SCOPED_DELIVERIES_ALREADY_CONFIGURED");
    this.options.scopedDeliveries = bridge;
  }
  private async jobAllowed(ctx: Ctx, j: any) {
    for (const rid of j.resource_ids)
      await this.options.registry.require(
        ctx,
        { type: j.resource_type, id: rid },
        j.kind === "EXPORT"
          ? j.include_private
            ? "export-private"
            : "export"
          : "import",
      );
  }
  async runJob(organizationId: string, ownerId: string, scope?: DeliveryScope) {
    await transaction(assertManagedWriter);
    await assertPlatformDispatchReady();
    if (
      scope &&
      (scope.organizationId !== organizationId || scope.memberId !== ownerId)
    )
      throw new Error("DISPATCH_SCOPE_MISMATCH");
    if (
      scope &&
      this.options.scopedDeliveries &&
      !(await this.options.scopedDeliveries.hasDueJobs(scope))
    )
      return false;
    const { withContext, registry, blobs } = this.options;
    const claim = await withContext(organizationId, ownerId, async (ctx) => {
      await ctx.c.query(
        "UPDATE platform_jobs SET state='FAILED',error_code='LEASE_EXHAUSTED',lease_token=NULL,lease_until=NULL,version=version+1 WHERE organization_id=$1 AND owner_id=$2 AND state='RUNNING' AND attempts>=5 AND lease_until<now()",
        [organizationId, ownerId],
      );
      const j = (
        await ctx.c.query(
          "SELECT * FROM platform_jobs WHERE organization_id=$1 AND owner_id=$2 AND attempts<5 AND ((state='PENDING' AND available_at<=now()) OR (state='RUNNING' AND lease_until<now())) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1",
          [organizationId, ownerId],
        )
      ).rows[0];
      if (!j) return null;
      const token = uuid();
      await ctx.c.query(
        "UPDATE platform_jobs SET state='RUNNING',attempts=attempts+1,lease_token=$3,lease_until=now()+($4::int*interval '1 millisecond'),version=version+1 WHERE organization_id=$1 AND id=$2",
        [organizationId, j.id, token, this.options.leaseMs ?? 60000],
      );
      return {
        id: j.id,
        token,
        attempt: j.attempts + 1,
        requestId: j.request_id ?? null,
      };
    });
    if (!claim) return false;
    let stage = "RESOURCE_AUTHORIZATION",
      freshBlob: string | undefined;
    try {
      await withContext(organizationId, ownerId, async (ctx) => {
        const j = (
          await ctx.c.query(
            "SELECT * FROM platform_jobs WHERE organization_id=$1 AND id=$2 AND state='RUNNING' AND lease_token=$3 FOR UPDATE",
            [organizationId, claim.id, claim.token],
          )
        ).rows[0];
        if (!j) return;
        await this.jobAllowed(ctx, j);
        const adapter = registry.get(j.resource_type)!;
        let result;
        if (j.kind === "EXPORT") {
          stage = "EXPORT_ADAPTER";
          if (!adapter.export) fail(422, "ADAPTER_REQUIRED");
          const exported = await adapter.export!(
            ctx,
            j.resource_ids,
            j.export_kind,
            { includePrivate: j.include_private === true, format: j.format },
          );
          const doc: TransferDocument = {
            schemaVersion: "orgmap-transfer-v1",
            resourceType: j.resource_type,
            kind: j.export_kind,
            records: exported.records,
            manifest: {
              coverage: exported.coverage,
              estimated: exported.estimated,
              recordCount: exported.records.length,
            },
          };
          stage = "EXPORT_SERIALIZATION";
          if (j.resource_type === "publication-export") {
            if (j.export_kind !== "PUBLICATIONS" || j.format !== "ZIP" || j.resource_ids.length !== 1 || !exported.publicationPackage)
              fail(422, "INVALID_PUBLICATION_EXPORT");
            doc.manifest.recordCount = exported.publicationPackage!.groups.reduce((count, group) => count + group.posts.length, 0);
          }
          const bytes =
            j.resource_type === "publication-export"
              ? serializePublicationExport(j.resource_ids[0], exported.publicationPackage!)
              : j.format === "PDF" || j.format === "ZIP"
              ? await (async () => {
                  if (!this.options.reportPackages)
                    fail(503, "FORMAT_CONFIGURATION_REQUIRED");
                  if (
                    j.resource_type !== "meeting-export" ||
                    !exported.documentPackage
                  )
                    fail(422, "INVALID_REPORT_PACKAGE");
                  return this.options.reportPackages!.serialize(
                    exported.documentPackage!,
                    j.format,
                  );
                })()
              : exported.workbook && (j.format === "XLSX" || j.format === "CSV")
                ? encodeWorkbook(exported.workbook, j.format)
                : encodeTransfer(doc, j.format);
          if (bytes.length > 5 * 1024 * 1024) fail(413, "EXPORT_TOO_LARGE");
          stage = "ARTIFACT_WRITE";
          const blob = await blobs.put(bytes),
            artifactId = uuid();
          freshBlob = blob.key;
          await ctx.c.query(
            "INSERT INTO platform_artifacts(organization_id,id,job_id,blob_key,sha256,size,manifest) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [
              organizationId,
              artifactId,
              j.id,
              blob.key,
              blob.sha256,
              blob.size,
              doc.manifest,
            ],
          );
          result = { artifactId, manifest: doc.manifest };
        } else {
          stage = "IMPORT_VALIDATION";
          if (!adapter.validateImport || !adapter.applyImport)
            fail(422, "ADAPTER_REQUIRED");
          // Domain revalidation under the current guard is mandatory after queue time.
          const valid = await adapter.validateImport!(
            ctx,
            j.input.document.records,
            j.export_kind,
          );
          if (planHash(valid.plan) !== planHash(j.input.plan))
            fail(409, "IMPORT_PLAN_CHANGED");
          stage = "IMPORT_APPLY";
          result = await adapter.applyImport!(ctx, valid.plan, j.export_kind);
        }
        stage = "COMPLETION";
        await event(
          ctx.c,
          organizationId,
          ctx.account.id,
          j.id,
          "JobCompleted",
          uuid(),
        );
        await ctx.c.query(
          "UPDATE platform_jobs SET state='COMPLETED',result=$4,error_code=NULL,lease_token=NULL,lease_until=NULL,version=version+1 WHERE organization_id=$1 AND id=$2 AND lease_token=$3",
          [organizationId, j.id, claim.token, result],
        );
      });
    } catch (error) {
      // The blob key was freshly created by this attempt; committed artifacts are never removed here.
      if (freshBlob) await blobs.remove(freshBlob);
      const failure = classifyWorkerError(error),
        traceId = uuid();
      let recorded = false;
      await withContext(organizationId, ownerId, async (ctx) => {
        const updated = await ctx.c.query(
          "UPDATE platform_jobs SET state=CASE WHEN attempts>=5 OR NOT $5 THEN 'FAILED' ELSE 'PENDING' END,error_code=$4,available_at=now()+((power(2,attempts)+random())*interval '1 second'),lease_token=NULL,lease_until=NULL,version=version+1 WHERE organization_id=$1 AND id=$2 AND lease_token=$3 RETURNING id",
          [
            organizationId,
            claim.id,
            claim.token,
            failure.code,
            failure.retryable,
          ],
        );
        if (updated.rowCount) {
          await ctx.c.query(
            "INSERT INTO platform_job_attempts(organization_id,id,job_id,trace_id,request_id,attempt,stage,error_code,retryable) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
            [
              organizationId,
              uuid(),
              claim.id,
              traceId,
              claim.requestId,
              claim.attempt,
              stage,
              failure.code,
              failure.retryable,
            ],
          );
          recorded = true;
        }
      });
      if (recorded)
        emitWorkerDiagnostic(
          {
            event: "platform.job.failure",
            organizationId,
            jobId: claim.id,
            requestId: claim.requestId,
            traceId,
            attempt: claim.attempt,
            stage,
            code: failure.code,
            retryable: failure.retryable,
          },
          this.options.onDiagnostic,
        );
    }
    return true;
  }
  async heartbeat(
    organizationId: string,
    ownerId: string,
    jobId: string,
    token: string,
  ) {
    await transaction(assertManagedWriter);
    return this.options.withContext(
      organizationId,
      ownerId,
      async (ctx) =>
        (
          await ctx.c.query(
            "UPDATE platform_jobs SET lease_until=now()+interval '60 seconds' WHERE organization_id=$1 AND id=$2 AND owner_id=$3 AND lease_token=$4 AND state='RUNNING' RETURNING id",
            [organizationId, jobId, ownerId, token],
          )
        ).rowCount === 1,
    );
  }
  async runDelivery(
    organizationId: string,
    recipientId: string,
    scope?: DeliveryScope,
  ) {
    await transaction(assertManagedWriter);
    await assertPlatformDispatchReady();
    if (
      scope &&
      (scope.organizationId !== organizationId ||
        scope.memberId !== recipientId)
    )
      throw new Error("DISPATCH_SCOPE_MISMATCH");
    if (scope && this.options.scopedDeliveries)
      return this.options.scopedDeliveries.run(scope);
    const { withContext, registry, transport } = this.options;
    const d = await withContext(organizationId, recipientId, async (ctx) => {
      await ctx.c.query(
        "UPDATE platform_deliveries SET state='FAILED',lease_token=NULL,lease_until=NULL WHERE organization_id=$1 AND recipient_id=$2 AND state='PENDING' AND attempts>=5 AND lease_until<now()",
        [organizationId, recipientId],
      );
      const row = (
        await ctx.c.query(
          "SELECT * FROM platform_deliveries WHERE organization_id=$1 AND recipient_id=$2 AND state='PENDING' AND attempts<5 AND available_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1",
          [organizationId, recipientId],
        )
      ).rows[0];
      if (!row) return null;
      const token = uuid();
      await ctx.c.query(
        "UPDATE platform_deliveries SET lease_token=$3,lease_until=now()+interval '60 seconds',attempts=attempts+1 WHERE organization_id=$1 AND id=$2",
        [organizationId, row.id, token],
      );
      return { ...row, token };
    });
    if (!d) return false;
    let effect: EffectAuthorization | undefined;
    try {
      const outgoing = await withContext(
        organizationId,
        recipientId,
        async (ctx) => {
          const current = (
            await ctx.c.query(
              "SELECT lease_token FROM platform_deliveries WHERE organization_id=$1 AND id=$2",
              [organizationId, d.id],
            )
          ).rows[0];
          if (current?.lease_token !== d.token) return null;
          const allowed = await registry.notificationAllowed(
              ctx,
              { type: d.resource_type, id: d.resource_id },
            ),
            pref = await effectivePreference(
              ctx,
              recipientId,
              d.event,
              d.channel,
              registry,
            );
          const stillFollowing = await notificationStillFollowed(ctx,d,registry);
          if (!allowed || !pref.enabled || !stillFollowing) {
            await ctx.c.query(
              "UPDATE platform_deliveries SET state='SUPPRESSED',lease_token=NULL,lease_until=NULL WHERE organization_id=$1 AND id=$2",
              [organizationId, d.id],
            );
            return null;
          }
          if (d.channel === "IN_APP") {
            await ctx.c.query(
              "UPDATE platform_deliveries SET state='DELIVERED',lease_token=NULL,lease_until=NULL WHERE organization_id=$1 AND id=$2",
              [organizationId, d.id],
            );
            return null;
          }
          const prior = (await ctx.c.query("SELECT id,state,lifecycle_fence::text AS fence,effect_token FROM organization_effects WHERE organization_id=$1 AND owner='PLATFORM' AND effect_key=$2 AND state IN ('AUTHORIZED','CONFIRMED','OUTCOME_UNKNOWN')", [organizationId,"delivery:"+d.id])).rows[0];
          if (prior) {
            if (prior.state === "AUTHORIZED") await recordOrganizationEffectOutcome(ctx.c,{organizationId,id:prior.id,fence:prior.fence,token:prior.effect_token},"OUTCOME_UNKNOWN");
            await ctx.c.query("UPDATE platform_deliveries SET state='OUTCOME_UNKNOWN',lease_token=NULL,lease_until=NULL WHERE organization_id=$1 AND id=$2 AND lease_token=$3", [organizationId,d.id,d.token]);
            return null;
          }
          if (!transport) throw new SmtpDeliveryError("NOT_SENT", "SMTP configuration required");
          const inlineBrand = this.options.notificationBranding ? await this.options.notificationBranding(ctx) : null;
          const authorization = await authorizeOrganizationEffect(ctx.c, {
            organizationId, owner: "PLATFORM", effectKey: "delivery:" + d.id, sourceLeaseToken: d.token,
            validateSourceLease: async (c, token) => !!(await c.query(
              "SELECT 1 FROM platform_deliveries WHERE organization_id=$1 AND id=$2 AND recipient_id=$3 AND lease_token=$4 AND state='PENDING' AND lease_until>clock_timestamp() FOR UPDATE",
              [organizationId, d.id, recipientId, token])).rowCount,
          });
          const content = await registry.get(d.resource_type)?.notificationMail?.(ctx, d.resource_id, d.event) ?? await renderNotificationMail(ctx,registry,d);
          return { id: d.id, email: ctx.account.email, event: d.event, inlineBrand, content, authorization };
        },
      );
      // Authorized copy is resolved before committing the fenced external effect.
      if (outgoing) {
        effect = outgoing.authorization;
        await transport!.send(outgoing);
        const recorded = await transaction(async (c) => {
          await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [organizationId]);
          return recordOrganizationEffectOutcome(c, effect!, "CONFIRMED");
        });
        effect = undefined;
        if (recorded.cutoverOccurred) return true;
        await withContext(organizationId, recipientId, async (ctx) => {
          await ctx.c.query(
            "UPDATE platform_deliveries SET state=$4,lease_token=NULL,lease_until=NULL WHERE organization_id=$1 AND id=$2 AND lease_token=$3",
            [organizationId, d.id, d.token, recorded.recorded ? "DELIVERED" : "OUTCOME_UNKNOWN"],
          );
        });
      }
    } catch (error) {
      const duplicate = (error as any)?.code === "23505" && (error as any)?.constraint === "organization_effects_no_unsafe_retry";
      const disposition = error instanceof SmtpDeliveryError ? error.disposition : "OUTCOME_UNKNOWN";
      if (effect) {
        await transaction(async (c) => {
          await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [organizationId]);
          await recordOrganizationEffectOutcome(c, effect!, disposition);
        });
      }
      const unknown = duplicate || (!!effect && disposition === "OUTCOME_UNKNOWN");
      await withContext(organizationId, recipientId, async (ctx) => {
        await ctx.c.query(
          "UPDATE platform_deliveries SET state=CASE WHEN $4 THEN 'OUTCOME_UNKNOWN' WHEN attempts>=5 THEN 'FAILED' ELSE 'PENDING' END,available_at=now()+((power(2,attempts)+random())*interval '1 second'),lease_token=NULL,lease_until=NULL WHERE organization_id=$1 AND id=$2 AND lease_token=$3",
          [organizationId, d.id, d.token, unknown],
        );
      });
    }
    return true;
  }
}
