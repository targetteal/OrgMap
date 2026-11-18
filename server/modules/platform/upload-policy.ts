import type { PoolClient } from "pg";
import type { Ctx, ModuleRuntime } from "../../src/runtime.js";
import { fail, uuid, Failure } from "../../src/core.js";
import { ResourceRegistry, type ResourceRef } from "./ports.js";
import { FilesystemBlobStore } from "./blob.js";
import {
  incomingFileBytes,
  UPLOAD_ALLOWLIST_KINDS,
  UPLOAD_MAX_BYTES,
  UPLOAD_CLASSIFIER_VERSION,
  type AllowlistedFileKind,
  type ValidatedIncomingFile,
} from "./incoming-file.js";
export type UploadPolicy = Readonly<{
  schemaVersion: 1;
  policyId: string | null;
  revision: number;
  mode: "ANY" | "ALLOWLIST" | "DISABLED";
  allowedKinds: readonly AllowlistedFileKind[];
}>;
export interface UploadPolicyProvider {
  resolve(input: {
    c: PoolClient;
    organizationId: string;
  }): Promise<UploadPolicy>;
}
export type UserAttachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  state: "READY";
};
function validatePolicy(p: UploadPolicy) {
  if (
    !p ||
    p.schemaVersion !== 1 ||
    !Number.isInteger(p.revision) ||
    p.revision < 0 ||
    !["ANY", "ALLOWLIST", "DISABLED"].includes(p.mode) ||
    !Array.isArray(p.allowedKinds) ||
    p.allowedKinds.some((k) => !UPLOAD_ALLOWLIST_KINDS.includes(k)) ||
    new Set(p.allowedKinds).size !== p.allowedKinds.length ||
    (p.mode === "ALLOWLIST"
      ? !p.allowedKinds.length
      : p.allowedKinds.length !== 0)
  )
    fail(503, "INVALID_UPLOAD_POLICY_PROVIDER");
  return p;
}
const serviceBindings = new WeakMap<
  object,
  { registry: ResourceRegistry; blobs: FilesystemBlobStore }
>();
export function assertIncomingUploadServiceBinding(
  service: object,
  registry: ResourceRegistry,
  blobs: FilesystemBlobStore,
) {
  const binding = serviceBindings.get(service);
  if (!binding || binding.registry !== registry || binding.blobs !== blobs)
    throw Error("UPLOAD_SERVICE_BINDING_MISMATCH");
}
export function createIncomingUploadService(options: {
  core: Pick<ModuleRuntime, "assertResourceAvailable">;
  registry: ResourceRegistry;
  blobs: FilesystemBlobStore;
  policyProvider?: UploadPolicyProvider;
}) {
  const assertInstalled = async (ctx: Ctx) => {
    const row = (
      await ctx.c.query(
        "SELECT count(*)::int AS n FROM pg_catalog.pg_attribute WHERE attrelid=to_regclass('public.platform_files') AND attname=ANY($1::text[]) AND NOT attisdropped",
        [
          [
            "upload_policy_revision",
            "classifier_version",
            "classified_kind",
            "validation_level",
          ],
        ],
      )
    ).rows[0];
    if (row.n !== 4) fail(503, "POLICY_CONSUMER_UNAVAILABLE");
  };
  const resolve = async (ctx: Ctx): Promise<UploadPolicy> => {
    if (!options.policyProvider) fail(503, "UPLOAD_POLICY_PROVIDER_UNBOUND");
    try {
      return validatePolicy(
        await options.policyProvider!.resolve({
          c: ctx.c,
          organizationId: ctx.org.id,
        }),
      );
    } catch (error) {
      if (error instanceof Failure) throw error;
      return fail(503, "UPLOAD_POLICY_PROVIDER_UNAVAILABLE");
    }
  };
  const assertUserAttachment = async (
    ctx: Ctx,
    input: { resource: ResourceRef; inspection: ValidatedIncomingFile },
  ) => {
    if (ctx.mode !== "write" && ctx.mode !== "authorization_write")
      fail(403, "WRITE_CONTEXT_REQUIRED");
    await options.core.assertResourceAvailable(ctx, input.resource.type);
    await options.registry.require(ctx, input.resource, "attach");
    incomingFileBytes(input.inspection); // verifies server-created identity, never trusts a DTO
    await assertInstalled(ctx);
    const policy = await resolve(ctx);
    if (
      policy.mode === "DISABLED" ||
      (policy.mode === "ALLOWLIST" &&
        (input.inspection.kind === "OPAQUE" ||
          !policy.allowedKinds.includes(input.inspection.kind)))
    )
      fail(403, "UPLOAD_POLICY_DENIED");
    return { policyRevision: policy.revision, decision: "ALLOW" as const };
  };
  const service = {
    assertUserAttachment,
    async capabilities(ctx: Ctx) {
      const technical = {
        hardMaxBytes: UPLOAD_MAX_BYTES,
        classifierVersion: UPLOAD_CLASSIFIER_VERSION,
        allowlistedKinds: UPLOAD_ALLOWLIST_KINDS,
        opaqueSupported: true,
        downloadOnly: true,
        coverage: ["USER_RESOURCE_ATTACHMENT"],
      };
      if (!options.policyProvider)
        return { operational: false, ...technical, policy: null };
      return { operational: true, ...technical, policy: await resolve(ctx) };
    },
    async validateChange(
      ctx: Ctx,
      input: { previous: UploadPolicy; next: UploadPolicy },
    ) {
      validatePolicy(input.next);
      if (!options.policyProvider) fail(503, "POLICY_CONSUMER_UNAVAILABLE");
      await assertInstalled(ctx);
    },
    /** Wrap the complete caller UoW/commit. Only this operation's fresh blobs are cleaned on failure. */
    async run<T>(
      operation: (
        ingest: (
          ctx: Ctx,
          input: { resource: ResourceRef; inspection: ValidatedIncomingFile },
        ) => Promise<UserAttachment>,
      ) => Promise<T>,
    ): Promise<T> {
      const created: string[] = [];
      let active = true;
      try {
        return await operation(async (ctx, input) => {
          if (!active) throw Error("UPLOAD_OPERATION_CLOSED");
          const decision = await assertUserAttachment(ctx, input),
            file = input.inspection;
          const blob = await options.blobs.put(incomingFileBytes(file));
          created.push(blob.key);
          const fileId = uuid();
          await ctx.c.query(
            "INSERT INTO platform_files(organization_id,id,resource_type,resource_id,owner_id,name,mime,size,sha256,state,blob_key,upload_policy_revision,classifier_version,classified_kind,validation_level) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'STAGED',$10,$11,$12,$13,$14)",
            [
              ctx.org.id,
              fileId,
              input.resource.type,
              input.resource.id,
              ctx.member.id,
              file.name,
              file.mediaType,
              blob.size,
              blob.sha256,
              blob.key,
              decision.policyRevision,
              file.classifierVersion,
              file.kind,
              file.validationLevel,
            ],
          );
          await ctx.c.query(
            "UPDATE platform_files SET state='READY' WHERE organization_id=$1 AND id=$2",
            [ctx.org.id, fileId],
          );
          return {
            id: fileId,
            name: file.name,
            mime: file.mediaType,
            size: blob.size,
            state: "READY",
          };
        });
      } catch (error) {
        await Promise.all(created.map((key) => options.blobs.remove(key)));
        throw error;
      } finally {
        active = false;
      }
    },
  };
  serviceBindings.set(service, {
    registry: options.registry,
    blobs: options.blobs,
  });
  return service;
}

export type IncomingUploadService = ReturnType<
  typeof createIncomingUploadService
>;
