import type { PoolClient } from "pg";
import type { SessionProvenance } from "./enrollment-contract.js";

/** The caller has locked the Account and revalidated its persisted live session. */
export type AccountFederatedReauthenticationInput = {
  c: PoolClient;
  accountId: string;
  sessionId: string;
  now: Date;
};

export type AccountFederatedReauthenticationVerifier = (
  input: AccountFederatedReauthenticationInput,
) => Promise<boolean>;

export type AccountReauthentication = {
  /** Stable primary-method/factor binding; never includes a password or OTP. */
  binding: string;
  provenance: SessionProvenance;
  mfa?: { factorRevision: number; verifiedAt: Date };
};

export type AccountReauthenticationCredentials = {
  currentPassword?: unknown;
  totpCode?: unknown;
};
