import { domainToASCII } from "node:url";
import { isIP } from "node:net";
import type { Ctx } from "./runtime.js";
import type {
  AdmissionPolicy,
  AdmissionPolicyProvider,
  OrgPolicyRead,
} from "./admission-contract.js";
import type { InvitationAccessPlan } from "./guest-contract.js";
import { fail } from "./core.js";
import { createFoundationDefaultAdmissionPolicyProvider } from "./admission-contract.js";

/** TEST/FOUNDATION_DEFAULT harness, opt-in; never installed implicitly by buildApp. */
export const foundationDefaultAdmissionPolicy: import("./runtime.js").OrgMapModule =
  async (_app, core) => {
    core.registerAdmissionPolicyProvider(
      createFoundationDefaultAdmissionPolicyProvider(),
    );
  };

export function canonicalAdmissionDomain(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    /[\s@/:*\\]/u.test(value) ||
    value.endsWith(".")
  )
    fail(422, "INVALID_ADMISSION_DOMAIN");
  const ascii = domainToASCII(value as string).toLowerCase();
  if (
    [...(value as string)].some(
      (character) =>
        character.charCodeAt(0) < 128 && !/[a-z0-9.-]/i.test(character),
    )
  )
    fail(422, "INVALID_ADMISSION_DOMAIN");
  if (
    !ascii ||
    ascii.length > 253 ||
    isIP(ascii) ||
    !ascii.includes(".") ||
    ascii
      .split(".")
      .some(
        (label) =>
          !label ||
          label.length > 63 ||
          !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
      )
  )
    fail(422, "INVALID_ADMISSION_DOMAIN");
  return ascii;
}
/** Preserve the existing account-key normalization; domain eligibility is separate. */
export function normalizeAdmissionEmail(value: unknown): string {
  if (typeof value !== "string") fail(400, "INVALID_REQUEST");
  const email = (value as string).trim().toLowerCase();
  if ([...email].length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(email))
    fail(400, "INVALID_REQUEST");
  canonicalAdmissionDomain(email.slice(email.lastIndexOf("@") + 1));
  return email;
}
export function admissionDomainAllowed(policy: AdmissionPolicy, email: string) {
  return policy.allowedDomains.includes(
    canonicalAdmissionDomain(email.slice(email.lastIndexOf("@") + 1)),
  );
}
export function createAdmissionServices(deps: {
  validateGuestAccessPlan(
    ctx: Ctx,
    value: unknown,
  ): Promise<InvitationAccessPlan>;
}) {
  let provider: AdmissionPolicyProvider | undefined;
  let publicReady: ((ctx: Ctx) => Promise<void>) | undefined;
  let revokeLinks: ((ctx: Ctx) => Promise<unknown>) | undefined;
  let mailConfigured = false;
  function registerAdmissionMailTransport(config: {
    host: string;
    port: number;
  }) {
    if (
      mailConfigured ||
      !["127.0.0.1", "localhost", "::1"].includes(config.host) ||
      !Number.isInteger(config.port) ||
      config.port < 1 ||
      config.port > 65535
    )
      throw Error("Invalid or duplicate admission mail transport");
    mailConfigured = true;
  }
  function registerAdmissionPolicyProvider(value: AdmissionPolicyProvider) {
    if (provider || typeof value?.resolve !== "function")
      throw Error("Invalid or duplicate admission policy provider");
    provider = value;
  }
  function registerPublicAdmissionConsumer(value: {
    validatePublicAdmissionReady(ctx: Ctx): Promise<void>;
    revokeAdmissionLinks(ctx: Ctx): Promise<unknown>;
  }) {
    if (publicReady) throw Error("Duplicate public admission consumer");
    publicReady = value.validatePublicAdmissionReady;
    revokeLinks = value.revokeAdmissionLinks;
  }
  function validate(policy: AdmissionPolicy) {
    if (
      !policy ||
      policy.schemaVersion !== 1 ||
      !Number.isSafeInteger(policy.revision) ||
      policy.revision < 0 ||
      (policy.revision === 0
        ? policy.policyId !== null
        : typeof policy.policyId !== "string" || !policy.policyId) ||
      !["OPEN", "DOMAIN_RESTRICTED", "DISABLED"].includes(
        policy.registrationMode,
      ) ||
      !Array.isArray(policy.allowedDomains) ||
      policy.allowedDomains.length > 1000 ||
      [
        policy.membersMayInvite,
        policy.limitMemberInvitesToDomains,
        policy.invitationLinkEnabled,
      ].some((v) => typeof v !== "boolean")
    )
      fail(503, "POLICY_CONSUMER_UNAVAILABLE");
    for (const domain of policy.allowedDomains)
      if (canonicalAdmissionDomain(domain) !== domain)
        fail(422, "INVALID_ADMISSION_DOMAIN");
    if (new Set(policy.allowedDomains).size !== policy.allowedDomains.length)
      fail(422, "INVALID_ADMISSION_DOMAIN");
    if (
      (policy.registrationMode === "DOMAIN_RESTRICTED" ||
        policy.limitMemberInvitesToDomains) &&
      !policy.allowedDomains.length
    )
      fail(422, "ADMISSION_DOMAINS_REQUIRED");
    if (policy.invitationLinkEnabled && policy.registrationMode === "DISABLED")
      fail(422, "INVITATION_LINK_DISABLED");
  }
  async function resolveAdmissionPolicy(input: OrgPolicyRead) {
    const context = (
      await input.c.query(
        "SELECT current_setting('orgmap.organization_id',true) AS organization_id,pg_current_xact_id_if_assigned()::text AS transaction_id",
      )
    ).rows[0];
    if (
      context.organization_id !== input.organizationId ||
      !context.transaction_id
    )
      fail(403, "ADMISSION_CONTEXT_REQUIRED");
    if (!provider) fail(503, "POLICY_CONSUMER_UNAVAILABLE");
    const policy = await provider!.resolve(input);
    validate(policy);
    return policy;
  }
  function assertPublicAdmission(
    policy: AdmissionPolicy,
    email: string,
    source: "PUBLIC_JOIN" | "INVITATION_LINK",
  ) {
    validate(policy);
    let normalized: string;
    try {
      normalized = normalizeAdmissionEmail(email);
    } catch {
      return fail(404, "RESOURCE_NOT_FOUND");
    }
    if (
      policy.registrationMode === "DISABLED" ||
      (source === "INVITATION_LINK" && !policy.invitationLinkEnabled) ||
      (policy.registrationMode === "DOMAIN_RESTRICTED" &&
        !admissionDomainAllowed(policy, normalized!))
    )
      fail(404, "RESOURCE_NOT_FOUND");
  }
  async function assertInvitationAuthority(
    ctx: Ctx,
    input: { email: string; memberType: string; accessPlan: unknown },
  ) {
    const policy = await resolveAdmissionPolicy({
      c: ctx.c,
      organizationId: ctx.org.id,
    });
    if (ctx.member.status !== "ACTIVE" || ctx.member.member_type === "GUEST")
      fail(403, "ACTION_DENIED");
    if (!["MEMBER", "GUEST"].includes(input.memberType))
      fail(400, "INVALID_REQUEST");
    const email = normalizeAdmissionEmail(input.email);
    if (ctx.member.org_role !== "OWNER") {
      if (
        !policy.membersMayInvite ||
        input.memberType !== "MEMBER" ||
        !Array.isArray(input.accessPlan) ||
        input.accessPlan.length ||
        (policy.limitMemberInvitesToDomains &&
          !admissionDomainAllowed(policy, email))
      )
        fail(403, "ACTION_DENIED");
      return [];
    }
    return deps.validateGuestAccessPlan(ctx, input.accessPlan);
  }
  async function assertAdminAdd(ctx: Ctx) {
    await resolveAdmissionPolicy({ c: ctx.c, organizationId: ctx.org.id });
    if (
      ctx.member.status !== "ACTIVE" ||
      ctx.member.member_type === "GUEST" ||
      ctx.member.org_role !== "OWNER"
    )
      fail(403, "ACTION_DENIED");
  }
  async function assertScimAdmission(
    input: OrgPolicyRead,
    _source: {
      connectionId: string;
      externalId: string;
      mappingRevision: number;
    },
    _operation: "CREATE" | "REACTIVATE_SCIM",
  ) {
    // Called only inside the existing verified enrollment factory. It cannot mint
    // an intent or association; that factory owns mailbox/source/federation proof.
    await resolveAdmissionPolicy(input);
  }
  const admissionPolicyConsumer = {
    async validateChange(
      ctx: Ctx,
      input: { previous: AdmissionPolicy; next: AdmissionPolicy },
    ) {
      validate(input.next);
      const columns = (
        await ctx.c.query(
          "SELECT count(*)::int AS n FROM pg_attribute WHERE attrelid='invitations'::regclass AND attname IN ('first_name','last_name','personal_message') AND NOT attisdropped",
        )
      ).rows[0].n;
      if (columns !== 3) fail(503, "POLICY_CONSUMER_UNAVAILABLE");
      if (
        input.next.registrationMode !== "DISABLED" ||
        input.next.invitationLinkEnabled ||
        input.next.membersMayInvite
      ) {
        if (!publicReady) fail(503, "POLICY_CONSUMER_UNAVAILABLE");
        await publicReady!(ctx);
      }
      if (
        input.next.registrationMode === "DISABLED" ||
        !input.next.invitationLinkEnabled
      ) {
        if (!revokeLinks) fail(503, "POLICY_CONSUMER_UNAVAILABLE");
        await revokeLinks!(ctx);
      }
    },
  };
  return {
    registerAdmissionPolicyProvider,
    registerAdmissionMailTransport,
    isAdmissionMailConfigured: () => mailConfigured,
    registerPublicAdmissionConsumer,
    resolveAdmissionPolicy,
    assertPublicAdmission,
    assertInvitationAuthority,
    assertAdminAdd,
    assertScimAdmission,
    admissionPolicyConsumer,
  };
}
