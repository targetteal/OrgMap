import type { Pool } from 'pg';
import { digest, fail, id } from './core.js';
import { assertManagedWriter } from './managed-writer.js';
import { hasIndependentLoginMethod, lockActiveOrganization } from './organization-lifecycle.js';
import type { LifecycleAuthMethodsPort } from './organization-lifecycle-contract.js';

/** Informative snapshot only. No password, receipt, mutation or authorization
 * to cut; acceptance independently revalidates all conditions. */
export async function readOrganizationDeletionPreflight(pool:Pool,input:{organizationId:string;sessionToken:string;expectedVersion?:number},methods:LifecycleAuthMethodsPort|undefined):Promise<{organizationVersion:number;dependentAccounts:number;continuityBlockedAccounts:number;pendingFederatedSessions:number;canAccept:boolean}> {
 if(!methods)fail(503,'AUTH_CONTINUITY_UNAVAILABLE');
 const orgId=id(input.organizationId).toLowerCase();
 if(typeof input.sessionToken!=='string'||!input.sessionToken)fail(401,'UNAUTHENTICATED');
 const c=await pool.connect();
 try {
  await assertManagedWriter(c);
  await c.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  try {
   await c.query("SELECT set_config('orgmap.organization_id',$1,true)",[orgId]);
   const org=await lockActiveOrganization(c,orgId), tokenHash=digest(input.sessionToken);
   const discovered=(await c.query('SELECT id,account_id FROM sessions WHERE token_hash=$1 AND expires_at>clock_timestamp()',[tokenHash])).rows[0];
   if(!discovered)fail(401,'UNAUTHENTICATED');
   const affected=[...new Set((await methods!.affectedAccountIds(c,orgId)).map(v=>id(v).toLowerCase()))];
   const sessionAccounts=(await c.query("SELECT DISTINCT account_id FROM sessions WHERE auth_method='FEDERATED' AND auth_organization_id=$1 AND deletion_revoked_at IS NULL",[orgId])).rows.map(row=>id(row.account_id).toLowerCase());
   const accountIds=[...new Set([...affected,...sessionAccounts,id(discovered.account_id).toLowerCase()])].sort();
   const accounts=(await c.query('SELECT * FROM accounts WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[accountIds])).rows;
   if(accounts.length!==accountIds.length)fail(503,'AUTH_CONTINUITY_UNAVAILABLE');
   const sessions=(await c.query("SELECT account_id FROM sessions WHERE auth_method='FEDERATED' AND auth_organization_id=$1 AND deletion_revoked_at IS NULL",[orgId])).rows;
   if(sessions.some(row=>!accountIds.includes(id(row.account_id).toLowerCase())))fail(503,'SESSION_DISCOVERY_CHANGED');
   const session=(await c.query('SELECT id FROM sessions WHERE token_hash=$1 AND id=$2 AND account_id=$3 AND expires_at>clock_timestamp() FOR SHARE',[tokenHash,discovered.id,discovered.account_id])).rows[0];
   if(!session)fail(401,'UNAUTHENTICATED');
   const owner=(await c.query("SELECT id FROM members WHERE organization_id=$1 AND account_id=$2 AND status='ACTIVE' AND org_role='OWNER' AND member_type='MEMBER'",[orgId,discovered.account_id])).rows[0];
   if(!owner)fail(403,'ACTION_DENIED');
   if(input.expectedVersion!==undefined&&(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion!==org.version))fail(409,'VERSION_CONFLICT');
   let dependentAccounts=0,continuityBlockedAccounts=0;
   for(const account of accounts){
    if(!affected.includes(id(account.id).toLowerCase()))continue;
    const bindings=await methods!.methodsForAccount(c,account.id);
    if(!bindings.some(m=>id(m.organizationId).toLowerCase()===orgId&&(m.kind==='OIDC'||m.kind==='SAML')&&m.enabled===true&&m.verified===true))continue;
    dependentAccounts++;
    if(account.password_enabled===true)continue;
    const others=[...new Set(bindings.map(m=>id(m.organizationId).toLowerCase()).filter(v=>v!==orgId))];
    const active=others.length?(await c.query("SELECT organization_id FROM organization_lifecycle WHERE organization_id=ANY($1::uuid[]) AND state='ACTIVE'",[others])).rows.map(row=>String(row.organization_id).toLowerCase()):[];
    if(!hasIndependentLoginMethod(false,orgId,bindings,new Set(active)))continuityBlockedAccounts++;
   }
   const result={organizationVersion:org.version,dependentAccounts,continuityBlockedAccounts,pendingFederatedSessions:sessions.length,canAccept:continuityBlockedAccounts===0&&sessions.length<=500};
   await c.query('COMMIT');return result;
  }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}
 }finally{c.release();}
}
