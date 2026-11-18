import type { Pool } from 'pg';
import { withStoppedHostWriters, assertHostDatabaseBindingLocked, type OrganizationHostLease } from './organization-host-lease.js';
import { tombstoneSha256, type OrganizationLedger } from './organization-ledger.js';
import { assertHostStorageBindingLocked } from './organization-storage-binding.js';
import { assertLiveDeletionTableInventory } from '../src/organization-deletion-catalog.js';
import { inspectDeletionRegistry, registeredDeletionParticipants } from '../src/organization-deletion-registry.js';

type TransitionInput={ledger:OrganizationLedger;lease:OrganizationHostLease;operator:Pool;drain:Pool;organizationId:string;jobId:string;fence:string;leaseToken:string};
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
/** Private supervisor only. Host and ledger guard remain held through COMMIT.
 * A new drain receipt is issued on the same connection and transaction as the
 * phase change; no previous receipt, body-provided done flag or fake context. */
async function transition(input:TransitionInput,phase:'PURGE'|'BLOBS') {
 if(!uuid.test(input.organizationId)||!uuid.test(input.jobId)||!uuid.test(input.leaseToken)||!/^[1-9][0-9]{0,18}$/.test(input.fence))throw Error('DELETION_TRANSITION_INPUT_INVALID');
 const inspection=inspectDeletionRegistry();if(inspection.missing.length||registeredDeletionParticipants().length!==9)throw Error('DELETION_REGISTRY_INCOMPLETE');
 return withStoppedHostWriters(input.ledger,input.lease,async locked=>{
  const verifier=await input.operator.connect();
  try {
   const binding=await assertHostDatabaseBindingLocked(input.ledger,input.lease,verifier,locked);
   await assertHostStorageBindingLocked(input.ledger,input.lease,verifier,locked);
   const snapshot=await locked.snapshot(),entry=snapshot.entries.find(e=>e.organizationId===input.organizationId);
   if(!entry||entry.jobId!==input.jobId||BigInt(entry.fence)>BigInt(input.fence))throw Error('DELETION_TRANSITION_LEDGER_MISMATCH');
   const c=await input.drain.connect();
   try {
    const endpointSql="SELECT current_database() AS name,coalesce(inet_server_addr()::text,'local') AS host,inet_server_port() AS port";
    const a=(await verifier.query(endpointSql)).rows[0],b=(await c.query(endpointSql)).rows[0];
    if(!a||!b||a.name!==b.name||a.host!==b.host||a.port!==b.port)throw Error('DELETION_DRAIN_DATABASE_MISMATCH');
    await c.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    try {
     await c.query('SELECT pg_advisory_xact_lock(730184)');
     await assertLiveDeletionTableInventory(c);
     const receipt=(await c.query('SELECT public.orgmap_deletion_drain_observe($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS id',[
      input.organizationId,input.jobId,input.fence,input.leaseToken,binding.authorityId,binding.instanceId,binding.epoch,entry.fence,entry.acceptedAt,tombstoneSha256(entry),snapshot.sha256,
     ])).rows[0]?.id;
     if(!uuid.test(receipt))throw Error('DELETION_DRAIN_RECEIPT_INVALID');
     const args=[input.organizationId,input.jobId,input.fence,input.leaseToken,receipt];
     const result=phase==='PURGE'?(await c.query('SELECT public.orgmap_deletion_inventory_to_purge($1,$2,$3,$4,$5) AS result',args)).rows[0]?.result:
      (await c.query('SELECT public.orgmap_deletion_purge_to_blobs($1,$2,$3,$4,$5) AS result',args)).rows[0]?.result;
     if(phase==='PURGE' && (!result||result.phase!=='PURGE'||typeof result.fence!=='string'||BigInt(result.fence)!==BigInt(input.fence)+1n||!/^[a-f0-9]{64}$/.test(result.manifestSha256)||!Number.isSafeInteger(result.manifestCount)||result.manifestCount<0))throw Error('DELETION_TRANSITION_RESULT_INVALID');
     input.lease.assertHeld();await assertHostDatabaseBindingLocked(input.ledger,input.lease,verifier,locked);await assertHostStorageBindingLocked(input.ledger,input.lease,verifier,locked);
     await c.query('COMMIT');return result;
    }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}
   } finally {c.release();}
  } finally {verifier.release();}
 });
}
export async function advanceStoppedInventoryToPurge(input:TransitionInput) {return transition(input,'PURGE');}
/** Advance only after independent owner, mixed, manifest and drain checks. */
export async function advanceStoppedPurgeToBlobs(input:TransitionInput) {return transition(input,'BLOBS');}
