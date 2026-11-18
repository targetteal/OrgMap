import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { registeredDeletionParticipants } from '../src/organization-deletion-registry.js';
import { runPrivateDeletionPurgeBatch } from '../src/organization-deletion-driver.js';
import { withStoppedHostWriters, assertHostDatabaseBindingLocked, type OrganizationHostLease } from './organization-host-lease.js';
import { assertHostStorageBindingLocked } from './organization-storage-binding.js';
import { confirmOrganizationLedger } from './organization-ledger-confirmation.js';
import { checkpointStoppedOrganizationQuiescenceAndInventory } from './organization-deletion-barrier.js';
import { claimDeletionJob, heartbeatDeletionJob, yieldDeletionJob, type DeletionJobLease } from './organization-deletion-jobs.js';
import { advanceStoppedInventoryToPurge, advanceStoppedPurgeToBlobs } from './organization-deletion-transitions.js';
import { removeOrganizationBlob } from './organization-blob-removal.js';
import { finalizeStoppedOrganization } from './organization-deletion-finalize.js';
import { tombstoneSha256, type OrganizationLedger } from './organization-ledger.js';

type Input={ledger:OrganizationLedger;lease:OrganizationHostLease;verifier:Pool;maintenance:Pool;drain:Pool;confirmation:Pool;blob:Pool;finalizer:Pool;organizationId:string;jobId:string;leaseTtlSeconds?:number};
type Job={organizationId:string;jobId:string;fence:string;phase:string;state:string;actorAccountId:string;ledgerState:string;ledgerAuthorityId:string|null;ledgerRecordSha256:string|null;acceptedFence:string;acceptedAt:string};
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const endpoint="SELECT current_database() AS name,coalesce(inet_server_addr()::text,'local') AS host,inet_server_port() AS port";

/** Caller supplies only private infrastructure, never participants, phase or proof. */
export async function processStoppedOrganizationDeletion(input:Input):Promise<{state:string;phase:string;receipt?:unknown}> {
 if(!uuid.test(input.organizationId)||!uuid.test(input.jobId))throw Error('DELETION_RUNNER_INPUT_INVALID');
 const ttl=input.leaseTtlSeconds??300;
 if(!Number.isInteger(ttl)||ttl<5||ttl>300)throw Error('DELETION_LEASE_TTL_INVALID');
 const participants=registeredDeletionParticipants();
 // Bind every pool before it can touch the job; the stopped-host guard prevents joins.
 const readJob=()=>withStoppedHostWriters(input.ledger,input.lease,async locked=>{
  const v=await input.verifier.connect();try{
   await assertHostDatabaseBindingLocked(input.ledger,input.lease,v,locked);await assertHostStorageBindingLocked(input.ledger,input.lease,v,locked);
   const target=JSON.stringify((await v.query(endpoint)).rows[0]);
   for(const pool of [input.maintenance,input.drain,input.confirmation,input.blob,input.finalizer]){const c=await pool.connect();try{if(JSON.stringify((await c.query(endpoint)).rows[0])!==target)throw Error('DELETION_RUNNER_DATABASE_MISMATCH');}finally{c.release();}}
   const c=await input.drain.connect();try{
    const job=(await c.query('SELECT public.orgmap_deletion_supervisor_job($1,$2) result',[input.organizationId,input.jobId])).rows[0]?.result as Job;
    if(!job||job.organizationId!==input.organizationId||job.jobId!==input.jobId||!uuid.test(job.actorAccountId)||!/^[1-9][0-9]{0,18}$/.test(job.fence)||!['QUIESCE','INVENTORY','PURGE','BLOBS','COMPLETED'].includes(job.phase)||!['PENDING','CONFIRMED'].includes(job.ledgerState))throw Error('DELETION_RUNNER_JOB_INVALID');
    if(job.ledgerState==='CONFIRMED'){
     const snapshot=await locked.snapshot(),entry=snapshot.entries.find(e=>e.organizationId===job.organizationId);
     if(!entry||entry.jobId!==job.jobId||entry.fence!==job.acceptedFence||new Date(entry.acceptedAt).getTime()!==new Date(job.acceptedAt).getTime()||job.ledgerAuthorityId!==input.ledger.authorityId||job.ledgerRecordSha256!==tombstoneSha256(entry))throw Error('DELETION_RUNNER_LEDGER_MISMATCH');
    }
    return job;
   }finally{c.release();}
  }finally{v.release();}
 });
 let job=await readJob();
 if(job.phase==='COMPLETED')return {state:'COMPLETED',phase:'COMPLETED',receipt:await finalizeStoppedOrganization({...input,fence:job.fence,leaseToken:randomUUID()})};
 if(job.ledgerState==='PENDING')await confirmOrganizationLedger({...input,organizationId:input.organizationId,jobId:input.jobId});
 job=await readJob();let lease:DeletionJobLease|undefined;
 const claim=()=>claimDeletionJob(input.maintenance,{organizationId:input.organizationId,jobId:input.jobId,fence:job.fence,ttlSeconds:ttl});
 const renew=async()=>{if(!lease)throw Error('DELETION_RUNNER_LEASE_MISSING');await heartbeatDeletionJob(input.maintenance,lease,ttl);};
 const common=()=>{if(!lease)throw Error('DELETION_RUNNER_LEASE_MISSING');return {...input,fence:lease.fence,leaseToken:lease.token};};
 try {
  lease=await claim();
  if(lease.phase==='QUIESCE'){
   await checkpointStoppedOrganizationQuiescenceAndInventory({...common(),operator:input.verifier,actorAccountId:job.actorAccountId});
   job=await readJob();
  }
  if(job.phase==='INVENTORY'){
   await renew();await advanceStoppedInventoryToPurge({...common(),operator:input.verifier});lease=undefined;
   job=await readJob();lease=await claim();
  }
  if(job.phase==='PURGE'){
   const ordered=[...participants.filter(p=>p.contextId!=='foundation'),...participants.filter(p=>p.contextId==='foundation')];
   let total=0;
   for(const participant of ordered){for(;;){if(++total>10000)throw Error('DELETION_RUNNER_BATCH_LIMIT');await renew();const p=await withStoppedHostWriters(input.ledger,input.lease,async locked=>{const v=await input.verifier.connect();try{await assertHostStorageBindingLocked(input.ledger,input.lease,v,locked);return await runPrivateDeletionPurgeBatch(input.maintenance,{organizationId:job.organizationId,jobId:job.jobId,lifecycleFence:lease!.fence,leaseToken:lease!.token,actorAccountId:job.actorAccountId},participant.contextId,500);}finally{v.release();}});if(p.done)break;}}
   await renew();await advanceStoppedPurgeToBlobs({...common(),operator:input.verifier});job=await readJob();
  }
  if(job.phase!=='BLOBS')throw Error('DELETION_RUNNER_PHASE_INVALID');
  let ns:string|null=null,key:string|null=null;
  for(let page=0;page<10000;page++){
   await renew();const c=await input.maintenance.connect();let rows:any[];
   try{await c.query('BEGIN ISOLATION LEVEL READ COMMITTED');await c.query('SELECT pg_advisory_xact_lock(730184)');rows=(await c.query('SELECT public.orgmap_deletion_supervisor_blobs($1,$2,$3,$4,$5,$6) result',[job.organizationId,job.jobId,lease!.fence,lease!.token,ns,key])).rows[0].result;if(!Array.isArray(rows)||rows.length>200)throw Error('DELETION_RUNNER_PAGE_INVALID');await c.query('COMMIT');}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
   for(const ref of rows){if(!ref||!['ORG_BRANDING','PLATFORM'].includes(ref.namespace)||!uuid.test(ref.key)||!['PENDING','REMOVED','HELD'].includes(ref.state))throw Error('DELETION_RUNNER_PAGE_INVALID');ns=ref.namespace;key=ref.key;if(ref.state==='HELD'){await yieldDeletionJob(input.maintenance,lease!);lease=undefined;return {state:'HELD',phase:'BLOBS'};}if(ref.state==='PENDING'){await renew();const result=await removeOrganizationBlob({...common(),maintenance:input.blob,namespace:ref.namespace,key:ref.key});if(result.state==='HELD'){await yieldDeletionJob(input.maintenance,lease!);lease=undefined;return {state:'HELD',phase:'BLOBS'};}}}
   if(rows.length<200){await renew();const receipt=await finalizeStoppedOrganization({...common(),finalizer:input.finalizer});lease=undefined;return {state:'COMPLETED',phase:'COMPLETED',receipt};}
  }
  throw Error('DELETION_RUNNER_PAGE_LIMIT');
 }catch(error){if(lease)await yieldDeletionJob(input.maintenance,lease,'SUPERVISOR_FAILED').catch(()=>{});throw error;}
}
