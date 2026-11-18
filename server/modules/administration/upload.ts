import type { FastifyInstance } from "fastify";
import type { Ctx, ModuleRuntime } from "../../src/runtime.js";
import type { OrgPolicyRead } from "../../src/admission-contract.js";
import { body, fail, id, uuid, version } from "../../src/core.js";
export const UPLOAD_ALLOWLIST_KINDS = [
  "PNG",
  "PDF",
  "JSON",
  "UTF8_TEXT",
] as const;
export type AllowlistedFileKind = (typeof UPLOAD_ALLOWLIST_KINDS)[number];
export type UploadPolicy = Readonly<{
  schemaVersion: 1;
  policyId: string | null;
  revision: number;
  mode: "ANY" | "ALLOWLIST" | "DISABLED";
  allowedKinds: readonly AllowlistedFileKind[];
}>;
export interface UploadPolicyConsumer {
  validateChange(
    ctx: Ctx,
    input: { previous: UploadPolicy; next: UploadPolicy },
  ): Promise<void>;
}
type Configuration = Pick<UploadPolicy, "mode" | "allowedKinds">;
function configuration(input: unknown): Configuration {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !["mode", "allowedKinds"].includes(k))
  )
    fail(400, "INVALID_REQUEST");
  const value = input as Configuration;
  if (
    !["ANY", "ALLOWLIST", "DISABLED"].includes(value.mode) ||
    !Array.isArray(value.allowedKinds) ||
    value.allowedKinds.some((k) => !UPLOAD_ALLOWLIST_KINDS.includes(k)) ||
    new Set(value.allowedKinds).size !== value.allowedKinds.length
  )
    fail(422, "INVALID_UPLOAD_POLICY");
  if (value.mode === "ALLOWLIST" && !value.allowedKinds.length)
    fail(422, "UPLOAD_KINDS_REQUIRED");
  if (value.mode !== "ALLOWLIST" && value.allowedKinds.length)
    fail(422, "UPLOAD_KINDS_NOT_APPLICABLE");
  return {
    mode: value.mode,
    allowedKinds: Object.freeze([...value.allowedKinds].sort()),
  };
}
export async function readUploadPolicy(
  input: OrgPolicyRead,
): Promise<UploadPolicy> {
  const organizationId = id(input.organizationId);
  const context = (
    await input.c.query(
      "SELECT current_setting('orgmap.organization_id',true) AS organization_id, pg_current_xact_id_if_assigned() IS NOT NULL AS assigned_transaction",
    )
  ).rows[0];
  if (
    context?.organization_id !== organizationId ||
    context?.assigned_transaction !== true
  )
    fail(403, "UPLOAD_POLICY_CONTEXT_REQUIRED");
  const row = (
    await input.c.query(
      "SELECT id,version,configuration FROM administration_upload_policies WHERE organization_id=$1",
      [organizationId],
    )
  ).rows[0];
  return Object.freeze(
    row
      ? {
          schemaVersion: 1,
          policyId: row.id,
          revision: row.version,
          ...configuration(row.configuration),
        }
      : {
          schemaVersion: 1,
          policyId: null,
          revision: 0,
          mode: "ANY",
          allowedKinds: Object.freeze([]),
        },
  );
}
export function registerUploadPolicyAdministration(
  app: FastifyInstance,
  core: ModuleRuntime,
  authorize: (ctx: Ctx) => Promise<boolean>,
  consumer?: UploadPolicyConsumer,
) {
  const path =
    "/api/v1/organizations/:organizationId/administration/upload-policy";
  app.get(path, (r) =>
    core.tenant(r, false, async (ctx) => {
      if (!(await authorize(ctx))) fail(404, "RESOURCE_NOT_FOUND");
      return {
        policy: await readUploadPolicy({
          c: ctx.c,
          organizationId: ctx.org.id,
        }),
        supported: !!consumer,
      };
    }),
  );
  app.get(path + "/history", (r) =>
    core.tenant(r, false, async (ctx) => {
      if (!(await authorize(ctx))) fail(404, "RESOURCE_NOT_FOUND");
      return {
        items: (
          await ctx.c.query(
            "SELECT version,snapshot,created_at FROM administration_upload_policy_revisions WHERE organization_id=$1 ORDER BY version DESC",
            [ctx.org.id],
          )
        ).rows,
      };
    }),
  );
  app.put(path, (r) =>
    core.tenant(r, { mode: "authorization_write", authorize }, async (ctx) => {
      const config = configuration(body(r, ["mode", "allowedKinds"]));
      const previous = await readUploadPolicy({
        c: ctx.c,
        organizationId: ctx.org.id,
      });
      version(r, previous.revision);
      if (!consumer) fail(503, "POLICY_CONSUMER_UNAVAILABLE");
      const next: UploadPolicy = Object.freeze({
        schemaVersion: 1,
        policyId: previous.policyId ?? uuid(),
        revision: previous.revision + 1,
        ...config,
      });
      await consumer!.validateChange(ctx, { previous, next });
      await ctx.c.query(
        "INSERT INTO administration_upload_policies(organization_id,id,version,configuration) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id) DO UPDATE SET version=$3,configuration=$4",
        [ctx.org.id, next.policyId, next.revision, config],
      );
      await ctx.c.query(
        "INSERT INTO administration_upload_policy_revisions(organization_id,version,snapshot,actor_id) VALUES($1,$2,$3,$4)",
        [ctx.org.id, next.revision, next, ctx.account.id],
      );
      await core.changed(ctx, r, next.policyId!, "UploadPolicyChanged");
      return { policy: next, supported: true };
    }),
  );
}
