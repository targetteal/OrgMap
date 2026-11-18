import type { PoolClient } from "pg";
import { digest, fail } from "./core.js";
import { verifyPassword } from "./password.js";
import type {
  AccountFederatedReauthenticationInput,
  AccountFederatedReauthenticationVerifier,
  AccountReauthentication,
  AccountReauthenticationCredentials,
} from "./account-security-contract.js";
import type { SessionProvenance } from "./enrollment-contract.js";

export function createAccountSecurityServices(deps: {
  verifyOwnTotp(c: PoolClient, accountId: string, code: unknown): Promise<{
    factorRevision: number; verifiedAt: Date;
  }>;
}) {
  let federatedVerifier: AccountFederatedReauthenticationVerifier | undefined;
  function registerAccountFederatedReauthenticationVerifier(
    verifier: AccountFederatedReauthenticationVerifier,
  ) {
    if (federatedVerifier || typeof verifier !== "function")
      throw Error("Invalid or duplicate Account federated reauthentication verifier");
    federatedVerifier = verifier;
  }
  async function verifyAccountFederatedReauthentication(
    input: AccountFederatedReauthenticationInput,
  ) {
    if (!federatedVerifier) fail(503, "FEDERATION_REAUTHENTICATION_UNAVAILABLE");
    return federatedVerifier!(input);
  }
  async function accountEmailRevision(c: PoolClient, accountId: string) {
    const row = (await c.query("SELECT email_revision FROM accounts WHERE id=$1", [accountId])).rows[0];
    if (!row) fail(404, "RESOURCE_NOT_FOUND");
    const revision = Number(row.email_revision);
    if (!Number.isSafeInteger(revision) || revision < 1)
      fail(503, "ACCOUNT_SECURITY_UNAVAILABLE");
    return revision;
  }
  async function assertAccountEmailRevision(c: PoolClient, accountId: string, expected: number) {
    if (!Number.isSafeInteger(expected) || expected < 1 ||
        await accountEmailRevision(c, accountId) !== expected)
      fail(403, "ACCOUNT_PROOF_STALE");
  }
  async function reauthenticateOwnAccount(
    c: PoolClient,
    a: any,
    session: any,
    credentials: AccountReauthenticationCredentials,
  ): Promise<AccountReauthentication> {
    const persisted = (await c.query(
      "SELECT *,clock_timestamp() AS db_now FROM sessions WHERE id=$1 AND account_id=$2 AND expires_at>clock_timestamp() FOR SHARE",
      [session.session_id, a.id],
    )).rows[0];
    if (!persisted) fail(401, "AUTHENTICATION_REQUIRED");
    const now: Date = persisted.db_now;
    let provenance: SessionProvenance;
    if (credentials.currentPassword !== undefined) {
      if (typeof credentials.currentPassword !== "string" ||
          !a.password_enabled ||
          credentials.currentPassword.length > 1024 ||
          !(await verifyPassword(credentials.currentPassword, a.password_hash)))
        fail(401, "REAUTHENTICATION_REQUIRED");
      provenance = { method: "PASSWORD" };
    } else {
      const verifiedAt = new Date(persisted.auth_verified_at);
      const authenticatedAt = persisted.auth_time ? new Date(persisted.auth_time) : null;
      if (persisted.auth_method !== "FEDERATED" ||
          !Number.isFinite(+verifiedAt) || +verifiedAt > +now ||
          +now - +verifiedAt > 300000 ||
          !authenticatedAt || !Number.isFinite(+authenticatedAt) ||
          +authenticatedAt > +now || +now - +authenticatedAt > 300000 ||
          !(await verifyAccountFederatedReauthentication({
            c, accountId: a.id, sessionId: persisted.id, now,
          })))
        fail(401, "REAUTHENTICATION_REQUIRED");
      provenance = {
        method: "FEDERATED",
        organizationId: persisted.auth_organization_id,
        connectionId: persisted.auth_connection_id,
        issuer: persisted.auth_issuer,
        subject: persisted.auth_subject,
        verifiedAt,
        amr: Array.isArray(persisted.auth_amr) ? persisted.auth_amr : [],
        ...(persisted.auth_time ? { authTime: new Date(persisted.auth_time) } : {}),
      };
    }
    const factor = (await c.query(
      "SELECT state FROM account_mfa_factors WHERE account_id=$1", [a.id],
    )).rows[0];
    const mfa = factor?.state === "ACTIVE"
      ? await deps.verifyOwnTotp(c, a.id, credentials.totpCode)
      : undefined;
    return {
      provenance,
      ...(mfa ? { mfa } : {}),
      binding: digest(JSON.stringify({
        method: provenance.method,
        organizationId: provenance.organizationId ?? null,
        connectionId: provenance.connectionId ?? null,
        issuer: provenance.issuer ?? null,
        subject: provenance.subject ?? null,
        credentialRevision: String(a.credential_revision),
        mfaRevision: String(a.mfa_revision),
      })),
    };
  }
  async function invalidateAccountEmailProofs(c: PoolClient, accountId: string, _oldEmailRevision: number) {
    // Tenant-bound intents use their issuance epoch in their own org-first UoW.
    // Only Account-global state is changed under this Account-first transaction.
    await c.query(
      "UPDATE password_recovery SET used_at=clock_timestamp(),command_key=NULL,command_hash=NULL WHERE account_id=$1 AND used_at IS NULL",
      [accountId],
    );
    await c.query(
      "UPDATE account_mail SET state='CANCELLED',token=NULL,lease_until=NULL,lease_token=NULL,last_error=NULL WHERE account_id=$1 AND state<>'DELIVERED'",
      [accountId],
    );
  }
  return {
    registerAccountFederatedReauthenticationVerifier,
    verifyAccountFederatedReauthentication,
    accountEmailRevision,
    assertAccountEmailRevision,
    reauthenticateOwnAccount,
    invalidateAccountEmailProofs,
  };
}
