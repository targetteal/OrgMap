import type { PoolClient } from "pg";
import type { Ctx } from "./runtime.js";
export type OrgPolicyRead = Readonly<{ c: PoolClient; organizationId: string }>;
export type AdmissionPolicy = Readonly<{
  schemaVersion: 1;
  policyId: string | null;
  revision: number;
  registrationMode: "OPEN" | "DOMAIN_RESTRICTED" | "DISABLED";
  allowedDomains: readonly string[];
  membersMayInvite: boolean;
  limitMemberInvitesToDomains: boolean;
  invitationLinkEnabled: boolean;
}>;
export interface AdmissionPolicyProvider {
  resolve(input: OrgPolicyRead): Promise<AdmissionPolicy>;
}
export interface AdmissionPolicyConsumer {
  validateChange(
    ctx: Ctx,
    input: { previous: AdmissionPolicy; next: AdmissionPolicy },
  ): Promise<void>;
}
export const defaultAdmissionPolicy = (): AdmissionPolicy => ({
  schemaVersion: 1,
  policyId: null,
  revision: 0,
  registrationMode: "DISABLED",
  allowedDomains: [],
  membersMayInvite: false,
  limitMemberInvitesToDomains: false,
  invitationLinkEnabled: false,
});
/** Explicit standalone/test provider. Production composition registers Admin instead. */
export const createFoundationDefaultAdmissionPolicyProvider =
  (): AdmissionPolicyProvider => ({
    resolve: async () => defaultAdmissionPolicy(),
  });
