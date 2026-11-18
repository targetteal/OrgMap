import type { Ctx } from "./runtime.js";
import type { CredentialPolicy } from "./credential-policy-contract.js";
import {
  evaluateCredentialPassword,
  CREDENTIAL_EVALUATOR_VERSION,
} from "./credential-evaluator.js";
import { fail, uuid } from "./core.js";
import { verifyPassword } from "./password.js";

type Dependencies = {
  mfaReadiness(): Promise<boolean>;
  verifyOwnTotp(
    c: Ctx["c"],
    accountId: string,
    code: unknown,
  ): Promise<{ factorRevision: number; verifiedAt: Date }>;
  validateCredentialFederation(ctx: Ctx, session?: any): Promise<boolean>;
  checkTenantAuthentication(ctx: Ctx, session?: any): Promise<void>;
};
export type CredentialPolicyResolver = (
  ctx: Ctx,
) => Promise<CredentialPolicy | null>;
// Native OrgMap bound, not a recovered supplier setting.
export const CREDENTIAL_MFA_MAX_AGE_MS = 12 * 60 * 60 * 1000;
export function createCredentialPolicyServices(deps: Dependencies) {
  let resolver: CredentialPolicyResolver | undefined;
  function registerCredentialPolicyResolver(next: CredentialPolicyResolver) {
    if (resolver) throw Error("Credential policy resolver already registered");
    resolver = next;
  }
  function validatePolicy(policy: CredentialPolicy) {
    if (
      !policy ||
      typeof policy.policyId !== "string" ||
      !policy.policyId ||
      !Number.isSafeInteger(policy.revision) ||
      policy.revision < 1 ||
      typeof policy.complexity !== "boolean" ||
      typeof policy.mfaEnforced !== "boolean" ||
      !["LOW", "MEDIUM", "HIGH"].includes(policy.strength) ||
      ![null, 30, 90, 180, 365].includes(policy.expirationDays)
    )
      fail(503, "CREDENTIAL_POLICY_CONFIGURATION_REQUIRED");
  }
  async function credentialPolicyReadiness(ctx: Ctx, policy: CredentialPolicy) {
    validatePolicy(policy);
    const columns = (
      await ctx.c.query(
        "SELECT count(*)::int AS n FROM pg_attribute WHERE attrelid='accounts'::regclass AND attname IN ('credential_revision','credential_changed_at','mfa_revision') AND NOT attisdropped",
      )
    ).rows[0].n;
    const table = (
      await ctx.c.query("SELECT to_regclass('credential_attestations') AS name")
    ).rows[0].name;
    if (columns !== 3 || !table)
      fail(503, "CREDENTIAL_POLICY_CONFIGURATION_REQUIRED");
    if (policy.mfaEnforced && !(await deps.mfaReadiness()))
      fail(503, "MFA_CONFIGURATION_REQUIRED");
    // Exercise the real pinned estimator, never substitute hash metadata.
    evaluateCredentialPassword("fixture", policy);
    return { ready: true, evaluatorVersion: CREDENTIAL_EVALUATOR_VERSION };
  }
  async function policyFor(ctx: Ctx) {
    const policy = (await resolver?.(ctx)) ?? null;
    if (policy) validatePolicy(policy);
    return policy;
  }
  async function account(ctx: Ctx) {
    const a = (
      await ctx.c.query(
        "SELECT *,clock_timestamp() AS db_now FROM accounts WHERE id=$1 FOR UPDATE",
        [ctx.account.id],
      )
    ).rows[0];
    if (!a) fail(401, "UNAUTHENTICATED");
    return a;
  }
  const recent = (at: unknown, now: Date, max = CREDENTIAL_MFA_MAX_AGE_MS) => {
    const time = at ? +new Date(at as string) : NaN;
    return Number.isFinite(time) && time <= +now + 5000 && time >= +now - max;
  };
  async function federation(ctx: Ctx, value: any) {
    return (
      value?.auth_method === "FEDERATED" &&
      (await deps.validateCredentialFederation(ctx, value))
    );
  }
  function federatedMfa(session: any, now: Date) {
    const amr: unknown[] = Array.isArray(session?.auth_amr)
      ? session.auth_amr
      : [];
    return (
      (amr.includes("mfa") ||
        (amr.includes("pwd") &&
          (amr.includes("otp") || amr.includes("hwk")))) &&
      recent(session.auth_time, now)
    );
  }
  async function inspect(ctx: Ctx, policy: CredentialPolicy, a: any) {
    const att = (
      await ctx.c.query(
        "SELECT * FROM credential_attestations WHERE organization_id=$1 AND account_id=$2",
        [ctx.org.id, a.id],
      )
    ).rows[0];
    if (ctx.principal || !ctx.account.session_id) {
      await deps.checkTenantAuthentication(
        { ...ctx, principal: undefined },
        att?.method === "FEDERATED"
          ? att.provenance
          : { auth_method: "PASSWORD" },
      );
    }
    const reasons: string[] = [];
    if (
      !att ||
      String(att.credential_revision) !== String(a.credential_revision) ||
      String(att.email_revision) !== String(a.email_revision) ||
      String(att.credential_policy_input_revision) !== String(a.credential_policy_input_revision) ||
      att.policy_id !== policy.policyId ||
      String(att.policy_revision) !== String(policy.revision) ||
      att.evaluator_version !== CREDENTIAL_EVALUATOR_VERSION
    )
      reasons.push("PASSWORD_ATTESTATION_REQUIRED");
    if (att?.valid_until && new Date(att.valid_until) <= a.db_now)
      reasons.push("PASSWORD_EXPIRED");
    if (att?.method === "FEDERATED") {
      if (!(await federation(ctx, att.provenance)))
        reasons.push("FEDERATION_VERIFICATION_REQUIRED");
      if (
        !ctx.principal &&
        ctx.account.session_id &&
        !(await federation(ctx, ctx.account))
      )
        reasons.push("FEDERATION_VERIFICATION_REQUIRED");
    } else if (
      policy.expirationDays &&
      (!a.credential_changed_at ||
        +new Date(a.credential_changed_at) + policy.expirationDays * 86400000 <=
          +a.db_now)
    )
      reasons.push("PASSWORD_EXPIRED");
    if (policy.mfaEnforced) {
      const local =
        att?.mfa_factor_revision != null &&
        String(att.mfa_factor_revision) === String(a.mfa_revision) &&
        recent(att.mfa_verified_at, a.db_now);
      const federated =
        att?.method === "FEDERATED" && federatedMfa(att.provenance, a.db_now);
      if (!local && !federated) reasons.push("MFA_VERIFICATION_REQUIRED");
      if (!ctx.principal && ctx.account.session_id) {
        const sessionLocal =
          String(ctx.account.mfa_factor_revision) === String(a.mfa_revision) &&
          recent(ctx.account.mfa_verified_at, a.db_now);
        const sessionFederated =
          (await federation(ctx, ctx.account)) &&
          federatedMfa(ctx.account, a.db_now);
        if (!sessionLocal && !sessionFederated)
          reasons.push("MFA_VERIFICATION_REQUIRED");
      }
    }
    return { att, reasons: [...new Set(reasons)] };
  }
  async function credentialRequirements(ctx: Ctx) {
    const policy = await policyFor(ctx);
    if (!policy) return { required: false, policy: null, reasons: [] };
    const a = await account(ctx),
      result = await inspect(ctx, policy, a);
    return {
      required: result.reasons.length > 0,
      policy,
      reasons: result.reasons,
      evaluatorVersion: CREDENTIAL_EVALUATOR_VERSION,
    };
  }
  async function requireCredentialPolicy(ctx: Ctx) {
    const policy = await policyFor(ctx);
    if (!policy) {
      if (ctx.principal || !ctx.account.session_id)
        await deps.checkTenantAuthentication({ ...ctx, principal: undefined });
      return;
    }
    const result = await inspect(ctx, policy, await account(ctx));
    if (result.reasons.length) fail(403, "ORG_CREDENTIAL_REQUIREMENT_UNMET");
  }
  async function attestCredential(
    ctx: Ctx,
    input: { password?: string; totpCode?: string },
  ) {
    if (ctx.principal || !ctx.account.session_id) fail(403, "ACTION_DENIED");
    const policy = await policyFor(ctx);
    if (!policy) return { required: false, attested: false };
    await credentialPolicyReadiness(ctx, policy);
    const a = await account(ctx),
      now: Date = a.db_now;
    let method: "PASSWORD" | "FEDERATED" = "PASSWORD",
      provenance: any = null;
    let validUntil: Date | null = null;
    if (await federation(ctx, ctx.account)) {
      if (
        !(await federation(ctx, ctx.account)) ||
        !recent(ctx.account.auth_verified_at, now, 300000)
      )
        fail(401, "FEDERATION_VERIFICATION_REQUIRED");
      method = "FEDERATED";
      const s = ctx.account;
      provenance = {
        auth_method: s.auth_method,
        auth_organization_id: s.auth_organization_id,
        auth_connection_id: s.auth_connection_id,
        auth_issuer: s.auth_issuer,
        auth_subject: s.auth_subject,
        auth_verified_at: s.auth_verified_at,
        auth_amr: s.auth_amr ?? [],
        auth_time: s.auth_time,
      };
    } else {
      if (!a.password_enabled) fail(401, "FEDERATION_VERIFICATION_REQUIRED");
      if (
        typeof input.password !== "string" ||
        input.password.length > 1024 ||
        !(await verifyPassword(input.password, a.password_hash))
      )
        fail(401, "REAUTHENTICATION_REQUIRED");
      const result = evaluateCredentialPassword(
        input.password as string,
        policy,
        [a.email, a.display_name],
      );
      if (!result.passed) fail(403, "ORG_CREDENTIAL_REQUIREMENT_UNMET");
      if (policy.expirationDays) {
        if (!a.credential_changed_at)
          fail(403, "ORG_CREDENTIAL_REQUIREMENT_UNMET");
        validUntil = new Date(
          +new Date(a.credential_changed_at) + policy.expirationDays * 86400000,
        );
        if (validUntil <= now) fail(403, "ORG_CREDENTIAL_REQUIREMENT_UNMET");
      }
    }
    let mfaAt: Date | null = null,
      mfaRevision: number | null = null;
    if (policy.mfaEnforced) {
      if (input.totpCode !== undefined) {
        const proof = await deps.verifyOwnTotp(ctx.c, a.id, input.totpCode);
        mfaAt = proof.verifiedAt;
        mfaRevision = proof.factorRevision;
        await ctx.c.query(
          "UPDATE sessions SET mfa_verified_at=$2,mfa_factor_revision=$3 WHERE id=$1 AND account_id=$4",
          [ctx.account.session_id, mfaAt, mfaRevision, a.id],
        );
      } else if (
        String(ctx.account.mfa_factor_revision) === String(a.mfa_revision) &&
        recent(ctx.account.mfa_verified_at, now)
      ) {
        mfaAt = new Date(ctx.account.mfa_verified_at);
        mfaRevision = Number(a.mfa_revision);
      } else if (!(method === "FEDERATED" && federatedMfa(provenance, now)))
        fail(401, "MFA_VERIFICATION_REQUIRED");
    }
    await ctx.c.query(
      "INSERT INTO credential_attestations(organization_id,account_id,credential_revision,policy_id,policy_revision,evaluator_version,valid_until,method,provenance,mfa_verified_at,mfa_factor_revision,email_revision,credential_policy_input_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(organization_id,account_id) DO UPDATE SET credential_revision=EXCLUDED.credential_revision,policy_id=EXCLUDED.policy_id,policy_revision=EXCLUDED.policy_revision,evaluator_version=EXCLUDED.evaluator_version,evaluated_at=clock_timestamp(),valid_until=EXCLUDED.valid_until,method=EXCLUDED.method,provenance=EXCLUDED.provenance,mfa_verified_at=EXCLUDED.mfa_verified_at,mfa_factor_revision=EXCLUDED.mfa_factor_revision,email_revision=EXCLUDED.email_revision,credential_policy_input_revision=EXCLUDED.credential_policy_input_revision",
      [
        ctx.org.id,
        a.id,
        a.credential_revision,
        policy.policyId,
        policy.revision,
        CREDENTIAL_EVALUATOR_VERSION,
        validUntil,
        method,
        provenance,
        mfaAt,
        mfaRevision,
        a.email_revision,
        a.credential_policy_input_revision,
      ],
    );
    await ctx.c.query(
      "INSERT INTO account_events(id,account_id,action,resource_id,request_id) VALUES($1,$2,'OrganizationCredentialAttested',$3,$4)",
      [uuid(), a.id, ctx.org.id, ctx.requestId ?? uuid()],
    );
    return { attested: true, evaluatorVersion: CREDENTIAL_EVALUATOR_VERSION };
  }
  return {
    registerCredentialPolicyResolver,
    credentialPolicyReadiness,
    credentialRequirements,
    requireCredentialPolicy,
    attestCredential,
  };
}
