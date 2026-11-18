import type { Pool, PoolClient } from 'pg';
import { assertHostDatabaseBindingLocked, type OrganizationHostLease } from './organization-host-lease.js';
import { canonicalTombstone, tombstoneSha256, validateTombstone, type OrganizationLedger } from './organization-ledger.js';

type Target = { name: string; host: string; port: number | null };
async function target(c: Pick<PoolClient,'query'>): Promise<Target> {
 const row=(await c.query("SELECT current_database() AS name,coalesce(inet_server_addr()::text,'local') AS host,inet_server_port() AS port")).rows[0];
 if(typeof row?.name!=='string'||typeof row.host!=='string'||(row.port!==null&&typeof row.port!=='number'))throw Error('LEDGER_CONFIRM_TARGET_INVALID');
 return {name:row.name,host:row.host,port:row.port};
}

/** Trusted local supervisor only. The ledger lock precedes all DB locks. The
 * append is durable before SQL confirmation; a SQL failure leaves the same
 * immutable record for the next exact retry. This grants no teardown capability. */
export async function confirmOrganizationLedger(input: {
 ledger: OrganizationLedger; lease: OrganizationHostLease; verifier: Pool; confirmation: Pool;
 organizationId: string; jobId: string;
}): Promise<{organizationId:string;jobId:string;recordSha256:string;authorityId:string}> {
 const {ledger,lease,verifier,confirmation,organizationId,jobId}=input;
 const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
 if(!uuid.test(organizationId)||!uuid.test(jobId))throw Error('LEDGER_CONFIRM_INPUT_INVALID');
 lease.assertHeld();
 return ledger.withExclusive(async locked=>{
  const read=await verifier.connect();
  try {
   const binding=await assertHostDatabaseBindingLocked(ledger,lease,read,locked), readTarget=await target(read);
   const c=await confirmation.connect();
   try {
    if(JSON.stringify(await target(c))!==JSON.stringify(readTarget))throw Error('LEDGER_CONFIRM_TARGET_MISMATCH');
    await c.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    try {
     const row=(await c.query('SELECT public.orgmap_ledger_confirmation_read($1,$2,$3) AS result',[organizationId,jobId,binding.authorityId])).rows[0]?.result;
     const entry=validateTombstone({organizationId:row?.organizationId,jobId:row?.jobId,fence:row?.fence,acceptedAt:row?.acceptedAt});
     if(entry.organizationId!==organizationId || entry.jobId!==jobId || binding.authorityId!==ledger.authorityId)throw Error('LEDGER_CONFIRM_ENTRY_MISMATCH');
     const hash=tombstoneSha256(entry);
     if(row.ledgerState==='CONFIRMED' && row.recordSha256!==hash)throw Error('LEDGER_CONFIRM_CONFLICT');
     await locked.confirm(entry);
     const snapshot=await locked.snapshot(), stored=snapshot.entries.find(value=>value.organizationId===organizationId);
     if(!stored || canonicalTombstone(stored)!==canonicalTombstone(entry))throw Error('LEDGER_CONFIRM_ENTRY_MISMATCH');
     await c.query('SELECT public.orgmap_ledger_confirmation_commit($1,$2,$3,$4,$5,$6)',[organizationId,jobId,binding.authorityId,entry.fence,entry.acceptedAt,hash]);
     await c.query('COMMIT');
     return {organizationId,jobId,recordSha256:hash,authorityId:binding.authorityId};
    } catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}
   } finally {c.release();}
  } finally {read.release();}
 });
}
