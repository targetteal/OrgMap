import { domainToASCII } from "node:url";
import { isIP } from "node:net";
import type {
  OrgPolicyRead,
  AdmissionPolicy,
  AdmissionPolicyConsumer,
} from "../../src/admission-contract.js";
export type {
  OrgPolicyRead,
  AdmissionPolicy,
  AdmissionPolicyConsumer,
} from "../../src/admission-contract.js";
import type { FastifyInstance } from "fastify";
import type { Ctx, ModuleRuntime } from "../../src/runtime.js";
import { body, fail, id, uuid, version } from "../../src/core.js";
const keys = [
  "registrationMode",
  "allowedDomains",
  "membersMayInvite",
  "limitMemberInvitesToDomains",
  "invitationLinkEnabled",
];
/** Exact canonical IDNA domain; never email/address/URL/wildcard or authority proof. */
export function canonicalAdmissionDomain(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    /[\s\u0000-\u001f\u007f/@:#?*%\\]/u.test(value) ||
    value.endsWith(".")
  )
    fail(422, "INVALID_ADMISSION_DOMAIN");
  const ascii = domainToASCII(value as string).toLowerCase();
  if (
    !ascii ||
    ascii.length > 253 ||
    isIP(ascii) ||
    ascii.endsWith(".") ||
    ascii.split(".").length < 2 ||
    ascii
      .split(".")
      .some(
        (label) =>
          label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
      )
  )
    fail(422, "INVALID_ADMISSION_DOMAIN");
  return ascii;
}
type Configuration = Pick<
  AdmissionPolicy,
  | "registrationMode"
  | "allowedDomains"
  | "membersMayInvite"
  | "limitMemberInvitesToDomains"
  | "invitationLinkEnabled"
>;
function configuration(input: unknown): Configuration {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !keys.includes(k))
  )
    fail(400, "INVALID_REQUEST");
  const value = input as Configuration;
  if (
    !["OPEN", "DOMAIN_RESTRICTED", "DISABLED"].includes(
      value.registrationMode,
    ) ||
    !Array.isArray(value.allowedDomains) ||
    value.allowedDomains.length > 100 ||
    [
      value.membersMayInvite,
      value.limitMemberInvitesToDomains,
      value.invitationLinkEnabled,
    ].some((v) => typeof v !== "boolean")
  )
    fail(422, "INVALID_ADMISSION_POLICY");
  const domains = value.allowedDomains.map(canonicalAdmissionDomain);
  if (new Set(domains).size !== domains.length)
    fail(422, "DUPLICATE_ADMISSION_DOMAIN");
  if (
    (value.registrationMode === "DOMAIN_RESTRICTED" ||
      value.limitMemberInvitesToDomains) &&
    !domains.length
  )
    fail(422, "ADMISSION_DOMAINS_REQUIRED");
  if (value.registrationMode === "DISABLED" && value.invitationLinkEnabled)
    fail(422, "ADMISSION_LINK_DISABLED");
  return {
    registrationMode: value.registrationMode,
    allowedDomains: Object.freeze(domains.sort()),
    membersMayInvite: value.membersMayInvite,
    limitMemberInvitesToDomains: value.limitMemberInvitesToDomains,
    invitationLinkEnabled: value.invitationLinkEnabled,
  };
}
export async function readAdmissionPolicy(
  input: OrgPolicyRead,
): Promise<AdmissionPolicy> {
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
    fail(403, "ADMISSION_CONTEXT_REQUIRED");
  const row = (
    await input.c.query(
      "SELECT id,version,configuration FROM administration_admission_policies WHERE organization_id=$1",
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
          registrationMode: "DISABLED",
          allowedDomains: Object.freeze([]),
          membersMayInvite: false,
          limitMemberInvitesToDomains: false,
          invitationLinkEnabled: false,
        },
  );
}
export function registerAdmissionPolicyAdministration(
  app: FastifyInstance,
  core: ModuleRuntime,
  authorize: (ctx: Ctx) => Promise<boolean>,
  consumer?: AdmissionPolicyConsumer,
) {
  const path =
    "/api/v1/organizations/:organizationId/administration/admission-policy";
  app.get(path, (r) =>
    core.tenant(r, false, async (ctx) => {
      if (!(await authorize(ctx))) fail(404, "RESOURCE_NOT_FOUND");
      return {
        policy: await readAdmissionPolicy({
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
            "SELECT version,snapshot,created_at FROM administration_admission_policy_revisions WHERE organization_id=$1 ORDER BY version DESC",
            [ctx.org.id],
          )
        ).rows,
      };
    }),
  );
  app.put(path, (r) =>
    core.tenant(r, { mode: "authorization_write", authorize }, async (ctx) => {
      const config = configuration(body(r, keys));
      const previous = await readAdmissionPolicy({
        c: ctx.c,
        organizationId: ctx.org.id,
      });
      version(r, previous.revision);
      if (!consumer) fail(503, "POLICY_CONSUMER_UNAVAILABLE");
      const next: AdmissionPolicy = Object.freeze({
        schemaVersion: 1,
        policyId: previous.policyId ?? uuid(),
        revision: previous.revision + 1,
        ...config,
      });
      await consumer!.validateChange(ctx, { previous, next });
      await ctx.c.query(
        "INSERT INTO administration_admission_policies(organization_id,id,version,configuration) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id) DO UPDATE SET version=$3,configuration=$4",
        [ctx.org.id, next.policyId, next.revision, config],
      );
      await ctx.c.query(
        "INSERT INTO administration_admission_policy_revisions(organization_id,version,snapshot,actor_id) VALUES($1,$2,$3,$4)",
        [ctx.org.id, next.revision, next, ctx.account.id],
      );
      await core.changed(ctx, r, next.policyId!, "AdmissionPolicyChanged");
      return { policy: next, supported: true };
    }),
  );
}
