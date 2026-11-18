import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { pool } from './db.js';
import { assertManagedWriter } from './managed-writer.js';
import { body, fail, id, key } from './core.js';
import type { ModuleRuntime } from './runtime.js';
import { acceptOrganizationDeletion } from './organization-deletion-acceptance.js';
import { readOrganizationDeletionPreflight } from './organization-deletion-preflight.js';

/** Host configuration only. The private acceptance login is never the app
 * login. Readiness is the real OPS verifier, not an HTTP-provided flag. */
export type OrganizationDeletionHttpOptions = {
  acceptancePool?: Pool;
  assertReady?: () => Promise<void>;
  /** Private host capability; the actor ID comes only from core.auth. */
  operatorReceipt?: (accountId: string, jobId: string) => Promise<Record<string, unknown> | null>;
};
const phases = ['QUIESCE','INVENTORY','PURGE','BLOBS','FINALIZE','COMPLETED'];
const states = ['PENDING','RUNNING','FAILED','COMPLETED'];
const controls = ['organization_tombstone','deletion_job','ledger','effect_outcomes','blob_removal_intents','revoked_session_provenance','account_command_tombstones'];
const instant = (value:unknown) => value instanceof Date ? value.toISOString() : typeof value==='string'&&Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

/** Closed projection. Internal keys, hashes, lease tokens and error messages
 * never cross this boundary, including when an operator record is malformed. */
function receipt(row:any) {
  if(!states.includes(row.state)||!phases.includes(row.phase)||!instant(row.accepted_at))fail(503,'DELETION_STATUS_UNAVAILABLE');
  let localObjects:number|null=null,localBytes:number|null=null,completedAt:string|null=null;
  if(row.state==='COMPLETED'||row.phase==='COMPLETED') {
    const value=row.completion_receipt;
    if(row.state!=='COMPLETED'||row.phase!=='COMPLETED'||!value||value.schemaVersion!==1||value.jobId!==row.id||value.organizationId!==row.organization_id||value.primaryPurge!=='COMPLETE'||!Number.isSafeInteger(value.localObjects)||value.localObjects<0||!Number.isSafeInteger(value.localBytes)||value.localBytes<0||!instant(value.completedAt)||instant(value.completedAt)!==instant(row.completed_at)||value.remoteEffects!=='UNKNOWN'||value.backupCopies!=='UNKNOWN'||value.lastRetainedCopyExpiresAt!==null||JSON.stringify(value.retainedTechnicalControls)!==JSON.stringify(controls))fail(503,'DELETION_STATUS_UNAVAILABLE');
    localObjects=value.localObjects;localBytes=value.localBytes;completedAt=instant(value.completedAt);
  }
  return {
    jobId:row.id,organizationId:row.organization_id,state:row.state,phase:row.phase,
    acceptedAt:instant(row.accepted_at),completedAt,
    primaryPurge:completedAt?'COMPLETE':'PENDING',localObjects,localBytes,
    remoteEffects:'UNKNOWN',backupCopies:'UNKNOWN',lastRetainedCopyExpiresAt:null,
    needsOperator:row.state==='FAILED'||row.error_code!==null,
  };
}

export async function registerOrganizationDeletionRoutes(app:FastifyInstance,core:ModuleRuntime,options?:OrganizationDeletionHttpOptions,application:Pool=pool) {
  async function authenticate(request:FastifyRequest) {
    const c=await application.connect();
    try{return await core.auth(request,c);}finally{c.release();}
  }
  async function operational() {
    if(!options?.acceptancePool||!options.assertReady)return false;
    try{await options.assertReady();return true;}catch{return false;}
  }
  const route='/api/v1/organizations/:organizationId';
  app.get(route+'/deletion-preflight',async request=>{
    await authenticate(request);
    // OPS locks are acquired before the preflight takes Org/Account locks.
    const available=await operational();
    const result=await readOrganizationDeletionPreflight(application,{
      organizationId:id((request.params as any).organizationId),
      sessionToken:request.cookies.orgmap_session??'',
    },core.lifecycleAuthMethods());
    return core.envelope(request,{...result,available,canAccept:available&&result.canAccept,
      operationalReason:!available?'OPERATIONS_UNAVAILABLE':result.pendingFederatedSessions>500?'SESSION_RECONCILIATION_REQUIRED':result.continuityBlockedAccounts>0?'AUTH_CONTINUITY_REQUIRED':null,backupCopies:'UNKNOWN'});
  });
  app.post(route+'/deletion-requests',async(request,reply)=>{
    const actor=await authenticate(request),orgId=id((request.params as any).organizationId).toLowerCase();
    const input=body(request,['confirmationOrganizationId','confirmationName','currentPassword','totpCode']);
    if(id(input.confirmationOrganizationId).toLowerCase()!==orgId||typeof input.confirmationName!=='string'||!input.confirmationName||input.confirmationName.length>200)fail(400,'CONFIRMATION_INVALID');
    const expected=/^"([1-9][0-9]*)"$/.exec(String(request.headers['if-match']??''));
    if(!expected||!Number.isSafeInteger(Number(expected[1])))fail(428,'IF_MATCH_REQUIRED');
    if(input.currentPassword!==undefined&&(typeof input.currentPassword!=='string'||input.currentPassword.length>1024))fail(400,'INVALID_REQUEST');
    if(input.totpCode!==undefined&&(typeof input.totpCode!=='string'||!/^\d{6}$/.test(input.totpCode)))fail(400,'INVALID_REQUEST');
    const requestKey=key(request);
    if(!await operational())fail(503,'DELETION_OPERATIONS_UNAVAILABLE');
    const result=await acceptOrganizationDeletion(options!.acceptancePool!,{
      organizationId:orgId,sessionToken:request.cookies.orgmap_session??'',csrfToken:String(request.headers['x-csrf-token']??''),
      expectedVersion:Number(expected![1]),confirmationName:input.confirmationName,
      credentials:{currentPassword:input.currentPassword,totpCode:input.totpCode},idempotencyKey:requestKey,
    },core,core.lifecycleAuthMethods());
    const reauthenticationRequired=actor.auth_method==='FEDERATED'&&actor.auth_organization_id===orgId;
    if(reauthenticationRequired)reply.clearCookie('orgmap_session',{path:'/'});
    reply.code(202);
    return core.envelope(request,{jobId:result.jobId,state:'DELETION_PENDING',replayed:result.replayed===true,
      statusUrl:`/account/organization-deletions/${result.jobId}`,reauthenticationRequired});
  });
  async function accountRead<T>(request:FastifyRequest,fn:(c:import('pg').PoolClient,accountId:string)=>Promise<T>) {
    const c=await application.connect();let begun=false;
    try{
      await assertManagedWriter(c);await c.query('BEGIN ISOLATION LEVEL READ COMMITTED');begun=true;
      const actor=await core.auth(request,c);
      await c.query("SELECT set_config('orgmap.organization_id','',true),set_config('orgmap.account_id',$1,true)",[actor.id]);
      const result=await fn(c,actor.id);await c.query('COMMIT');return core.envelope(request,result);
    }catch(error){if(begun)await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
  }
  const columns='id,organization_id,state,phase,accepted_at,completed_at,error_code,completion_receipt';
  app.get('/api/v1/account/organization-deletions/:jobId',async request=>accountRead(request,async(c,accountId)=>{
    const jobId=id((request.params as any).jobId);
    let row=(await c.query(`SELECT ${columns} FROM organization_deletion_jobs j WHERE id=$1 AND initiator_account_id=$2`,[jobId,accountId])).rows[0];
    if(!row&&options?.operatorReceipt) {
      try { row=await options.operatorReceipt(accountId,jobId); }
      catch { fail(503,'DELETION_STATUS_UNAVAILABLE'); }
    }
    if(!row)fail(404,'RESOURCE_NOT_FOUND');return receipt(row);
  }));
  app.get('/api/v1/account/organization-deletions',async request=>accountRead(request,async(c,accountId)=>{
    const query=request.query as Record<string,string>;
    if(Object.keys(query).some(k=>k!=='cursor'))fail(400,'INVALID_REQUEST');
    let cursor:{at:string;id:string}|undefined;
    if(query.cursor!==undefined){
      if(typeof query.cursor!=='string'||query.cursor.length>256)fail(400,'INVALID_CURSOR');
      try{cursor=JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8'));}catch{fail(400,'INVALID_CURSOR');}
      if(!cursor||Object.keys(cursor).sort().join(',')!=='at,id'||typeof cursor.at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(cursor.at)||!instant(cursor.at))fail(400,'INVALID_CURSOR');
      id(cursor!.id);
    }
    const rows=(await c.query(`SELECT ${columns},to_char(accepted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at FROM organization_deletion_jobs j WHERE initiator_account_id=$1 AND ($2::timestamptz IS NULL OR (accepted_at,id)<($2::timestamptz,$3::uuid)) ORDER BY accepted_at DESC,id DESC LIMIT 51`,[accountId,cursor?.at??null,cursor?.id??null])).rows;
    const hasMore=rows.length>50,selected=rows.slice(0,50),last=selected.at(-1);
    return {items:selected.map(receipt),page:{hasMore,nextCursor:hasMore&&last?Buffer.from(JSON.stringify({at:last.cursor_at,id:last.id})).toString('base64url'):null}};
  }));
}
