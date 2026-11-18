export type {
  EnrollmentSource as ProvisioningSource,
  EnrollmentProfile as ProvisioningProfile,
  EnrollmentProjection as ProvisioningProjection,
  VerifiedEnrollmentFederation as VerifiedProvisioningIdentity,
  ProvisionedEnrollmentAuthority as ProvisioningAuthority,
} from "../../src/enrollment-contract.js";
/** Trusted server mapping. SCIM callers never choose identity claims or Account IDs. */
export type EnrollmentConfiguration = Record<
  string,
  {
    requestedMemberType?: "MEMBER" | "GUEST";
    issuer: string;
    claim: string;
    mappingRevision: number;
    externalIdToValue: Record<string, string>;
    ssoRequired?: boolean;
  }
>;
