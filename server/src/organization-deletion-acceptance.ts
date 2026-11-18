import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { assertManagedWriter } from "./managed-writer.js";
import { digest, fail, id } from "./core.js";
import { lockActiveOrganization, hasIndependentLoginMethod } from "./organization-lifecycle.js";
import type { LifecycleAuthMethodsPort } from "./organization-lifecycle-contract.js";
import type { AccountReauthenticationCredentials } from "./account-security-contract.js";
import type { createAccountSecurityServices } from "./account-security.js";

type SecurityServices = ReturnType<typeof createAccountSecurityServices>;

/** Preflight only, within a caller-owned READ COMMITTED transaction. The
 * result is not a receipt, authorization to cut, or an endpoint. Production
 * must wire the real services/Interop adapter and complete the cut in the same
 * transaction after a restricted authority wrapper exists. */
export async function preflightOrganizationDeletionAcceptance(c: PoolClient, input: {
  organizationId: string; sessionToken: string; csrfToken: string;
  expectedVersion: number; confirmationName: string; credentials: AccountReauthenticationCredentials;
}, security: SecurityServices, methods: LifecycleAuthMethodsPort | undefined): Promise<{ actorAccountId: string; sessionId: string; fence: string; accountIds: string[] }> {
  if (!methods) fail(503, "AUTH_CONTINUITY_UNAVAILABLE");
  const organizationId = id(input.organizationId).toLowerCase();
  await c.query("SELECT set_config('orgmap.organization_id',$1,true)",[organizationId]);
  const org = await lockActiveOrganization(c,organizationId);
  if (typeof input.sessionToken !== "string" || !input.sessionToken || typeof input.csrfToken !== "string") fail(401,"UNAUTHENTICATED");
  const tokenHash = digest(input.sessionToken);
  // This first read is discovery only; the session is revalidated under lock.
  const discovered = (await c.query("SELECT id,account_id FROM sessions WHERE token_hash=$1 AND expires_at>clock_timestamp()",[tokenHash])).rows[0];
  if (!discovered) fail(401,"UNAUTHENTICATED");
  const affected = [...new Set((await methods!.affectedAccountIds(c,organizationId)).map(value=>id(value).toLowerCase()))];
  const sessionAccounts = (await c.query("SELECT DISTINCT account_id FROM sessions WHERE auth_method='FEDERATED' AND auth_organization_id=$1 AND deletion_revoked_at IS NULL",[organizationId])).rows.map(row=>id(row.account_id).toLowerCase());
  const accountIds = [...new Set([...affected,...sessionAccounts,id(discovered.account_id).toLowerCase()])].sort();
  const accounts = (await c.query("SELECT * FROM accounts WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",[accountIds])).rows;
  if (accounts.length !== accountIds.length) fail(503,"AUTH_CONTINUITY_UNAVAILABLE");
  const currentSessions = (await c.query("SELECT DISTINCT account_id FROM sessions WHERE auth_method='FEDERATED' AND auth_organization_id=$1 AND deletion_revoked_at IS NULL",[organizationId])).rows;
  if (currentSessions.some(row => !accountIds.includes(id(row.account_id).toLowerCase()))) fail(503,"SESSION_DISCOVERY_CHANGED");
  const activeSessionCount = Number((await c.query("SELECT count(*)::int AS n FROM sessions WHERE auth_method='FEDERATED' AND auth_organization_id=$1 AND deletion_revoked_at IS NULL",[organizationId])).rows[0].n);
  // Atomic acceptance cannot split a cut across commits.
  if (activeSessionCount > 500) fail(503,"DELETION_SESSION_LIMIT_EXCEEDED");
  const session = (await c.query("SELECT *,id AS session_id FROM sessions WHERE token_hash=$1 AND id=$2 AND account_id=$3 AND expires_at>clock_timestamp() FOR SHARE",[tokenHash,discovered.id,discovered.account_id])).rows[0];
  if (!session) fail(401,"UNAUTHENTICATED");
  if (session.csrf !== input.csrfToken) fail(403,"CSRF_INVALID");
  const owner = (await c.query("SELECT id FROM members WHERE organization_id=$1 AND account_id=$2 AND status='ACTIVE' AND org_role='OWNER' AND member_type='MEMBER'",[organizationId,discovered.account_id])).rows[0];
  if (!owner) fail(403,"ACTION_DENIED");
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion !== org.version) fail(409,"VERSION_CONFLICT");
  if (input.confirmationName !== org.name) fail(400,"CONFIRMATION_INVALID");
  const actor = accounts.find(account=>account.id===discovered.account_id);
  if (!actor) fail(503,"AUTH_CONTINUITY_UNAVAILABLE");
  // Uses the real Account security service (password / registered federation / MFA).
  await security.reauthenticateOwnAccount(c,actor,session,input.credentials);
  for (const account of accounts) {
    if (!affected.includes(id(account.id).toLowerCase())) continue;
    const bindings = await methods!.methodsForAccount(c,account.id);
    const usesA = bindings.some(method=>id(method.organizationId).toLowerCase()===organizationId && (method.kind==='OIDC'||method.kind==='SAML') && method.enabled===true && method.verified===true);
    if (!usesA || account.password_enabled === true) continue;
    const others = [...new Set(bindings.map(method=>id(method.organizationId).toLowerCase()).filter(value=>value!==organizationId))];
    const active = others.length ? (await c.query("SELECT organization_id FROM organization_lifecycle WHERE organization_id=ANY($1::uuid[]) AND state='ACTIVE'",[others])).rows.map(row=>String(row.organization_id).toLowerCase()) : [];
    if (!hasIndependentLoginMethod(false,organizationId,bindings,new Set(active))) fail(409,"AUTH_CONTINUITY_REQUIRED");
  }
  const lifecycle = (await c.query("SELECT fence::text FROM organization_lifecycle WHERE organization_id=$1 AND state='ACTIVE'",[organizationId])).rows[0];
  if (!lifecycle) fail(404,"RESOURCE_NOT_FOUND");
  return { actorAccountId: actor.id, sessionId: session.id, fence: lifecycle.fence, accountIds };
}

/** Private service entry only. No HTTP registration or login provisioning.
 * The caller must supply the real Account security and Interop services and a
 * dedicated acceptance pool; SQL verifies the private login role. */
export async function acceptOrganizationDeletion(pool: Pool, input: {
 organizationId: string; sessionToken: string; csrfToken: string; expectedVersion: number;
 confirmationName: string; credentials: AccountReauthenticationCredentials; idempotencyKey: string;
}, security: SecurityServices, methods: LifecycleAuthMethodsPort | undefined): Promise<{jobId:string;fence:string;expiredSessions?:number;replayed?:boolean}> {
 if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.length<1 || input.idempotencyKey.length>128) fail(400,"IDEMPOTENCY_KEY_REQUIRED");
 const organizationId=id(input.organizationId).toLowerCase();
 const requestHash=digest(JSON.stringify({organizationId,expectedVersion:input.expectedVersion,confirmationName:input.confirmationName}));
 const c=await pool.connect();
 try {
  await assertManagedWriter(c);
  await c.query("BEGIN ISOLATION LEVEL READ COMMITTED");
  const replay=(await c.query("SELECT orgmap_acceptance_replay($1,$2,$3,$4,$5) AS result",[organizationId,digest(input.sessionToken),input.csrfToken,input.idempotencyKey,requestHash])).rows[0]?.result;
  if (replay) {
   if (typeof replay.jobId!=="string" || typeof replay.fence!=="string" || replay.replayed!==true) throw Error("DELETION_REPLAY_INVALID");
   await c.query("COMMIT");
   return replay;
  }
  const proof=await preflightOrganizationDeletionAcceptance(c,input,security,methods);
  const receipt=(await c.query("SELECT orgmap_acceptance_mint_receipt($1,$2,$3,$4,$5,$6::uuid[]) AS id",[organizationId,proof.actorAccountId,proof.sessionId,requestHash,proof.fence,proof.accountIds])).rows[0]?.id;
  if (typeof receipt!=="string") throw Error("DELETION_RECEIPT_INVALID");
  const job=randomUUID();
  const result=(await c.query("SELECT orgmap_acceptance_cut($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS result",[receipt,organizationId,proof.actorAccountId,proof.sessionId,requestHash,proof.fence,input.expectedVersion,input.confirmationName,input.idempotencyKey,job])).rows[0]?.result;
  if (!result || result.jobId!==job || typeof result.fence!=="string" || !Number.isSafeInteger(result.expiredSessions)) throw Error("DELETION_CUT_RESULT_INVALID");
  await c.query("COMMIT");
  return result;
 } catch(error) { await c.query("ROLLBACK").catch(()=>{}); throw error; }
 finally { c.release(); }
}
