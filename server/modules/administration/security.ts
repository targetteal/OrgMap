import type { FastifyInstance } from "fastify";
import type { Ctx, ModuleRuntime } from "../../src/runtime.js";
import type { CredentialPolicy } from "../../src/credential-policy-contract.js";
import { body, fail, uuid, version } from "../../src/core.js";
export type CredentialConfiguration = Omit<
  CredentialPolicy,
  "policyId" | "revision"
>;
export type CredentialPolicyReadiness = (
  ctx: Ctx,
  policy: CredentialPolicy,
) => Promise<{ ready: boolean; evaluatorVersion?: string }>;
const defaults: CredentialConfiguration = {
  complexity: false,
  strength: "LOW",
  expirationDays: null,
  mfaEnforced: false,
};
function configuration(input: unknown): CredentialConfiguration {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (k) =>
        !["complexity", "strength", "expirationDays", "mfaEnforced"].includes(
          k,
        ),
    )
  )
    fail(400, "INVALID_REQUEST");
  const v = input as CredentialConfiguration;
  if (
    typeof v.complexity !== "boolean" ||
    typeof v.mfaEnforced !== "boolean" ||
    !["LOW", "MEDIUM", "HIGH"].includes(v.strength) ||
    ![null, 30, 90, 180, 365].includes(v.expirationDays)
  )
    fail(422, "INVALID_CREDENTIAL_POLICY");
  return {
    complexity: v.complexity,
    strength: v.strength,
    expirationDays: v.expirationDays,
    mfaEnforced: v.mfaEnforced,
  };
}
async function row(ctx: Ctx) {
  return (
    await ctx.c.query(
      "SELECT id,version,enabled,configuration FROM administration_credential_policies WHERE organization_id=$1",
      [ctx.org.id],
    )
  ).rows[0];
}
/** No plaintext credentials or attestations are stored/read here. Root binds this to core. */
export async function readCredentialPolicy(
  ctx: Ctx,
): Promise<CredentialPolicy | null> {
  const current = await row(ctx);
  return current?.enabled
    ? {
        policyId: current.id,
        revision: current.version,
        ...configuration(current.configuration),
      }
    : null;
}
export function registerCredentialPolicyAdministration(
  app: FastifyInstance,
  core: ModuleRuntime,
  authorize: (ctx: Ctx) => Promise<boolean>,
  readiness?: CredentialPolicyReadiness,
) {
  const path =
    "/api/v1/organizations/:organizationId/administration/security-policy";
  const present = (current: any) => ({
    id: current?.id ?? null,
    version: current?.version ?? 0,
    enabled: current?.enabled ?? false,
    configuration: current?.configuration ?? { ...defaults },
    supported: !!readiness,
    state: !readiness
      ? "CONFIGURATION_REQUIRED"
      : current?.enabled
        ? "ACTIVE"
        : "DISABLED",
  });
  app.get(path, (r) =>
    core.tenant(r, false, async (ctx) => {
      if (!(await authorize(ctx))) fail(404, "RESOURCE_NOT_FOUND");
      return present(await row(ctx));
    }),
  );
  app.get(path + "/history", (r) =>
    core.tenant(r, false, async (ctx) => {
      if (!(await authorize(ctx))) fail(404, "RESOURCE_NOT_FOUND");
      return {
        items: (
          await ctx.c.query(
            "SELECT version,snapshot,created_at FROM administration_credential_policy_revisions WHERE organization_id=$1 ORDER BY version DESC",
            [ctx.org.id],
          )
        ).rows,
      };
    }),
  );
  app.put(path, (r) =>
    core.tenant(r, { mode: "write", authorize }, async (ctx) => {
      const input = body(r, ["enabled", "configuration"]);
      if (typeof input.enabled !== "boolean")
        fail(422, "INVALID_CREDENTIAL_POLICY");
      const candidate = configuration(input.configuration);
      const current = await row(ctx);
      version(r, current?.version ?? 0);
      const id = current?.id ?? uuid(),
        nextVersion = (current?.version ?? 0) + 1;
      if (input.enabled) {
        if (!readiness) fail(503, "CREDENTIAL_POLICY_CONFIGURATION_REQUIRED");
        const result = await readiness!(ctx, {
          policyId: id,
          revision: nextVersion,
          ...candidate,
        });
        if (result?.ready !== true)
          fail(503, "CREDENTIAL_POLICY_CONFIGURATION_REQUIRED");
      }
      const saved = (
        await ctx.c.query(
          "INSERT INTO administration_credential_policies(organization_id,id,enabled,configuration) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id) DO UPDATE SET enabled=$3,configuration=$4,version=administration_credential_policies.version+1 RETURNING id,version,enabled,configuration",
          [ctx.org.id, id, input.enabled, candidate],
        )
      ).rows[0];
      await ctx.c.query(
        "INSERT INTO administration_credential_policy_revisions(organization_id,version,snapshot,actor_id) VALUES($1,$2,$3,$4)",
        [
          ctx.org.id,
          saved.version,
          { enabled: saved.enabled, configuration: saved.configuration },
          ctx.account.id,
        ],
      );
      await core.changed(ctx, r, saved.id, "CredentialPolicyChanged");
      return present(saved);
    }),
  );
}
