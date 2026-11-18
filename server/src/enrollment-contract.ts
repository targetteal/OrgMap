import type { MemberType } from "./guest-contract.js";
import type { PoolClient } from "pg";
import type { Ctx } from "./runtime.js";
export type EnrollmentSource = { connectionId: string; externalId: string };
export type EnrollmentProfile = {
  userName: string;
  email: string;
  displayName?: string;
  requestedMemberType?: MemberType;
  identity: {
    issuer: string;
    claim: string;
    value: string;
    mappingRevision: number;
  };
};
export type EnrollmentState =
  "PENDING_ENROLLMENT" | "ACTIVE" | "SUSPENDED" | "CANCELLED";
/** Safe SCIM projection. Never reveal Account existence, ID or whether a global email was occupied. */
export type EnrollmentProjection = {
  enrollmentId: string;
  provisioningState: EnrollmentState;
  memberType?: MemberType;
  active: boolean;
  version: number;
};
export type VerifiedEnrollmentFederation = {
  amr?: readonly string[];
  authTime?: Date;
  organizationId: string;
  connectionId: string;
  issuer: string;
  subject: string;
  claims: Record<string, unknown>;
  verifiedAt: Date;
};
export type SessionProvenance = {
  amr?: readonly string[];
  authTime?: Date;
  method: "PASSWORD" | "FEDERATED" | "LEGACY";
  organizationId?: string;
  connectionId?: string;
  issuer?: string;
  subject?: string;
  verifiedAt?: Date;
};
/** Implemented by the protocol owner; every operation uses the supplied tenant transaction. */
export interface ProvisionedEnrollmentAuthority {
  validateSource(
    ctx: Ctx,
    source: EnrollmentSource,
    profile: EnrollmentProfile,
  ): Promise<void>;
  revalidateSource(
    c: PoolClient,
    organizationId: string,
    source: EnrollmentSource,
    profile: EnrollmentProfile,
  ): Promise<boolean>;
  verifyFederationProof(
    c: PoolClient,
    opaqueProof: unknown,
  ): Promise<VerifiedEnrollmentFederation | null>;
  bindFederatedIdentity(
    c: PoolClient,
    input: {
      organizationId: string;
      connectionId: string;
      accountId: string;
      issuer: string;
      subject: string;
    },
  ): Promise<void>;
  authenticationPolicy?(
    ctx: Ctx,
  ): Promise<{ mode: "ANY" | "SSO_REQUIRED"; connectionIds: string[] }>;
  validateSessionProvenance?(
    ctx: Ctx,
    provenance: SessionProvenance,
  ): Promise<boolean>;
}
