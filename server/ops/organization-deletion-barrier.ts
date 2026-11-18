import { checkpointQuiescenceAndInventoryWithinBarrier } from '../src/organization-deletion-driver.js';
import type { Pool } from 'pg';
import { withStoppedHostWriters, assertHostDatabaseBindingLocked, type OrganizationHostLease } from './organization-host-lease.js';
import { tombstoneSha256, type OrganizationLedger } from './organization-ledger.js';

/**
 * Private supervisor observation, not a QUIESCE authorization. The caller must
 * provide the dedicated non-app login in both lifecycle_maintenance and
 * lifecycle_drain groups. A receipt identifies only this DB transaction: it
 * cannot be used after COMMIT or after the ledger guard is released. Wiring a
 * future consumer requires an in-transaction port, not this returned value.
 *
 * Stopping registered local writers cannot prove that unregistered writers,
 * another host, or a remote transport have stopped. Deployments must enforce
 * writer registration for every programmatic entry point before this evidence
 * can contribute to enabling deletion.
 */
type DrainInput = {
 ledger: OrganizationLedger; lease: OrganizationHostLease; operator: Pool; drain: Pool;
 organizationId: string; jobId: string; fence: string; leaseToken: string;
};
export async function observeStoppedOrganizationEffects(input: DrainInput) {
 return runStoppedOrganizationBarrier(input, false);
}
/** Reconcile the three owner sources conservatively while the same guard is held. */
export async function reconcileStoppedOrganizationEffects(input: DrainInput) {
 return runStoppedOrganizationBarrier(input, true);
}
/** Explicit internal composition: host/ledger guards remain held until Q and
 * inventory/checkpoints commit. This does not authorize purge or completion. */
export async function checkpointStoppedOrganizationQuiescenceAndInventory(input: DrainInput & { actorAccountId: string }) {
 if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(input.actorAccountId)) throw Error('DELETION_DRAIN_INPUT_INVALID');
 return runStoppedOrganizationBarrier(input, true, input.actorAccountId);
}
async function runStoppedOrganizationBarrier(input: DrainInput, reconcile: boolean, actorAccountId?: string) {
 const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
 if(!uuid.test(input.organizationId)||!uuid.test(input.jobId)||!uuid.test(input.leaseToken)||!/^[1-9][0-9]{0,18}$/.test(input.fence)) throw Error('DELETION_DRAIN_INPUT_INVALID');
 return withStoppedHostWriters(input.ledger,input.lease,async locked=>{
  const verifier=await input.operator.connect();
  try {
   const binding=await assertHostDatabaseBindingLocked(input.ledger,input.lease,verifier,locked);
   const snapshot=await locked.snapshot();
   const entry=snapshot.entries.find(e=>e.organizationId===input.organizationId);
   if(!entry||entry.jobId!==input.jobId||BigInt(entry.fence)>BigInt(input.fence)) throw Error('DELETION_DRAIN_LEDGER_ENTRY_MISMATCH');
   const recordHash=tombstoneSha256(entry);
   const c=await input.drain.connect();
   try {
   const endpointSql="SELECT current_database() AS name,coalesce(inet_server_addr()::text,'local') AS host,inet_server_port() AS port";
   const verifierEndpoint=(await verifier.query(endpointSql)).rows[0];
   const drainEndpoint=(await c.query(endpointSql)).rows[0];
   if (!verifierEndpoint || !drainEndpoint || verifierEndpoint.name!==drainEndpoint.name || verifierEndpoint.host!==drainEndpoint.host || verifierEndpoint.port!==drainEndpoint.port) throw Error('DELETION_DRAIN_DATABASE_MISMATCH');
   await c.query('BEGIN ISOLATION LEVEL READ COMMITTED');
   if (actorAccountId) await c.query('SELECT public.interoperability_deletion_prepare_refresh($1,$2,$3,$4)',[input.organizationId,input.jobId,input.fence,input.leaseToken]);
   if(reconcile) for(const owner of ['iam','platform','interop']) await c.query('SELECT public.orgmap_deletion_drain_reconcile($1,$2,$3,$4,$5)',[input.organizationId,input.jobId,input.fence,input.leaseToken,owner]);
   const row=(await c.query('SELECT public.orgmap_deletion_drain_observe($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS id',[
    input.organizationId,input.jobId,input.fence,input.leaseToken,binding.authorityId,binding.instanceId,binding.epoch,entry.fence,entry.acceptedAt,recordHash,snapshot.sha256,
   ])).rows[0];
   if (actorAccountId) {
    for(let n=0;n<10000;n++) {
     const outcome=(await c.query('SELECT public.interoperability_deletion_outcomes_batch($1,$2,$3,$4,$5,500) AS result',[input.organizationId,input.jobId,input.fence,input.leaseToken,row.id])).rows[0]?.result;
     if (!outcome || typeof outcome.done!=='boolean' || !Number.isSafeInteger(outcome.recorded) || outcome.recorded<0) throw Error('DELETION_OUTCOME_RESULT_INVALID');
     if (outcome.done) break;
     if (n===9999 || outcome.recorded===0) throw Error('DELETION_OUTCOME_BATCH_LIMIT');
    }
    await checkpointQuiescenceAndInventoryWithinBarrier(c,{organizationId:input.organizationId,jobId:input.jobId,lifecycleFence:input.fence,leaseToken:input.leaseToken,actorAccountId},row.id);
    input.lease.assertHeld();
    await assertHostDatabaseBindingLocked(input.ledger,input.lease,verifier,locked);
    await c.query('SELECT public.orgmap_deletion_drain_assert($1,$2,$3,$4,$5)',[row.id,input.organizationId,input.jobId,input.fence,input.leaseToken]);
   }
   await c.query('COMMIT');
   return {receiptId:row.id as string,organizationId:input.organizationId,jobId:input.jobId,fence:input.fence,binding,ledgerSnapshotSha256:snapshot.sha256,scope:actorAccountId ? 'QUIESCENCE_AND_INVENTORY_ONLY' as const : 'LOCAL_STOPPED_WRITERS_OBSERVATION_ONLY' as const};
   } catch(error) { await c.query('ROLLBACK').catch(()=>{}); throw error; }
   finally { c.release(); }
  } finally { verifier.release(); }
 });
}
