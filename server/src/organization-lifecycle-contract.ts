/** LF04 state only. A state does not grant maintenance authority. */
export type OrganizationLifecycleState =
  | "ACTIVE" | "DELETION_PENDING" | "PURGING" | "DELETED";
export type OrganizationLifecycle = {
  state: OrganizationLifecycleState;
  // PostgreSQL bigint is intentionally represented as a decimal string.
  fence: string;
};

/** Interop reports actual, verified bindings, not invitations or email claims.
 * All readers run under Account locks; they must not lock any organization.
 */
export interface LifecycleFederatedMethod {
  organizationId: string;
  kind: "OIDC" | "SAML";
  enabled: boolean;
  verified: boolean;
}
export interface LifecycleAuthMethodsPort {
  /** Discover all Accounts dependent on this organization under its lock. */
  affectedAccountIds(c: import("pg").PoolClient, organizationId: string): Promise<readonly string[]>;
  /** Include only real identity bindings; configuration and member/connection status matter. */
  methodsForAccount(c: import("pg").PoolClient, accountId: string): Promise<readonly LifecycleFederatedMethod[]>;
}

export type OrganizationDeletionPhase = "QUIESCE" | "INVENTORY" | "PURGE";
/** Internal inventory only; never an HTTP DTO or permission to delete shared bytes. */
export type OrganizationDeletionBlobReference = {
  namespace: 'PLATFORM' | 'ORG_BRANDING';
  key: string;
  sha256: string;
  size: number;
};
/** Type-level brand only; the future runner must enforce authenticity at runtime. */
declare const maintenanceContextBrand: unique symbol;
export interface OrganizationDeletionContext {
  readonly [maintenanceContextBrand]: true;
  readonly c: import("pg").PoolClient;
  readonly organizationId: string;
  readonly jobId: string;
  readonly lifecycleFence: string;
  readonly leaseToken: string;
  readonly actorAccountId: string;
}
export interface OrganizationTeardownParticipant {
  readonly contextId: string;
  readonly version: number;
  describe(): { readonly ownedSets: readonly string[]; readonly after: readonly string[] };
  runBatch(context: OrganizationDeletionContext, input: {
    readonly phase: OrganizationDeletionPhase;
    readonly cursor: string | null;
    readonly limit: number;
  }): Promise<{ nextCursor: string | null; done: boolean; counts: Record<string, number>; blobReferences?: readonly OrganizationDeletionBlobReference[] }>;
}
