import type { ModuleRuntime, AccountFederatedReauthenticationInput } from "../../src/runtime.js";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
/** Global Account UoW already holds Account→Session. Never takes an organization lock. */
export function registerAccountFederatedReauthentication(core: ModuleRuntime, trustedIssuer: (org: string, connection: string, provider: string) => string | undefined) {
  core.registerAccountFederatedReauthenticationVerifier(async ({ c, accountId, sessionId, now }: AccountFederatedReauthenticationInput) => {
    const session = (await c.query("SELECT * FROM sessions WHERE id=$1 AND account_id=$2 AND expires_at>clock_timestamp() FOR SHARE", [sessionId, accountId])).rows[0];
    if (!session || session.auth_method !== "FEDERATED" || !(now instanceof Date) || !Number.isFinite(+now)) return false;
    const verifiedAt = +new Date(session.auth_verified_at);
    const authenticatedAt = session.auth_time ? +new Date(session.auth_time) : NaN;
    if (!Number.isFinite(verifiedAt) || verifiedAt > +now || verifiedAt < +now - 300000 ||
      !Number.isFinite(authenticatedAt) || authenticatedAt > +now || authenticatedAt < +now - 300000 ||
      !uuid.test(session.auth_organization_id ?? "") || !uuid.test(session.auth_connection_id ?? "") || !session.auth_issuer || !session.auth_subject) return false;
    const previous = (await c.query("SELECT current_setting('orgmap.organization_id',true) AS value")).rows[0].value ?? "";
    try {
      await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [session.auth_organization_id]);
      const row = (await c.query("SELECT n.provider FROM interop_federated_identities i JOIN interop_connections n ON n.organization_id=i.organization_id AND n.id=i.connection_id JOIN members m ON m.organization_id=i.organization_id AND m.account_id=i.account_id JOIN organization_lifecycle l ON l.organization_id=i.organization_id AND l.state='ACTIVE' WHERE i.organization_id=$1 AND i.connection_id=$2 AND i.account_id=$3 AND i.issuer=$4 AND i.subject=$5 AND n.state<>'REVOKED' AND n.provider IN ('OIDC','SAML') AND m.status='ACTIVE'", [session.auth_organization_id, session.auth_connection_id, accountId, session.auth_issuer, session.auth_subject])).rows[0];
      return !!row && trustedIssuer(session.auth_organization_id, session.auth_connection_id, row.provider) === session.auth_issuer;
    } finally { await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [previous]); }
  });
}
