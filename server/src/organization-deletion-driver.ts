import type { Pool, PoolClient } from 'pg';
import { assertLiveDeletionTableInventory } from './organization-deletion-catalog.js';
import { registeredDeletionParticipants } from './organization-deletion-registry.js';
import { assertDeletionRegistryReady, assertRegisteredDeletionParticipant } from './organization-deletion-registry.js';
import type { OrganizationDeletionContext, OrganizationDeletionPhase, OrganizationTeardownParticipant } from './organization-lifecycle-contract.js';

const contexts = new Set(['foundation','structure','governance','work','goals','meetings','administration','platform','interoperability']);
const liveContexts = new WeakSet<object>();
/** Runtime liveness complements the private SQL authority; it never replaces it. */
export function assertLiveOrganizationDeletionContext(ctx: OrganizationDeletionContext): void {
  if (!liveContexts.has(ctx)) throw Error('DELETION_CONTEXT_EXPIRED_OR_FORGED');
}

type Target = { organizationId: string; jobId: string; lifecycleFence: string; leaseToken: string; actorAccountId: string };
type Progress = { cursor: string | null; done: boolean; counts: Record<string, number>; revision: string };

/** Internal batch transaction only. This does not request deletion, certify an I/O
 * drain, advance phases, remove bytes or declare a job completed. Those operations
 * require the full owner registry and authoritative final absence checks.
 */
export async function runOrganizationDeletionBatch(
  maintenance: Pool, participant: OrganizationTeardownParticipant, target: Target,
  input: { phase: OrganizationDeletionPhase; limit: number },
): Promise<Progress> {
  // The full registry, dependency verification and I/O barrier are not yet available.
  // Refuse even otherwise valid participants until those prerequisites are integrated.
  assertDeletionRegistryReady();
  assertRegisteredDeletionParticipant(participant);
  if (!contexts.has(participant.contextId) || !Number.isInteger(participant.version) || participant.version<1 ||
      !['QUIESCE','INVENTORY','PURGE'].includes(input.phase) || !Number.isInteger(input.limit) || input.limit<1 || input.limit>500)
    throw Error('DELETION_BATCH_INVALID');
  const c = await maintenance.connect();
  let ctx: OrganizationDeletionContext | undefined;
  try {
    await c.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    if (input.phase==='PURGE') await c.query('SELECT pg_advisory_xact_lock(730184)');
    const args = [target.organizationId,target.jobId,target.lifecycleFence,target.leaseToken,participant.contextId,input.phase];
    const prior = (await c.query('SELECT orgmap_deletion_read_progress($1,$2,$3,$4,$5,$6) AS progress',args)).rows[0]?.progress as Progress;
    if (!prior || typeof prior.revision!=='string' || !/^[1-9][0-9]*$/.test(prior.revision) || typeof prior.done!=='boolean' || (prior.cursor!==null && typeof prior.cursor!=='string'))
      throw Error('DELETION_PROGRESS_INVALID');
    if (prior.done) { await c.query('COMMIT'); return prior; }
    ctx = Object.freeze({ ...target,c }) as unknown as OrganizationDeletionContext;
    liveContexts.add(ctx);
    const result = await participant.runBatch(ctx,{phase:input.phase,cursor:prior.cursor,limit:input.limit});
    assertLiveOrganizationDeletionContext(ctx);
    if (!result || typeof result.done!=='boolean' || (result.nextCursor!==null && typeof result.nextCursor!=='string') ||
        (!result.done && result.nextCursor===null) || (result.nextCursor?.length??0)>4096 || !result.counts ||
        Object.entries(result.counts).some(([key,value])=>!/^[a-zA-Z][a-zA-Z0-9_]{0,99}$/.test(key) || !Number.isSafeInteger(value) || value<0))
      throw Error('DELETION_BATCH_RESULT_INVALID');
    const next = (await c.query('SELECT orgmap_deletion_checkpoint($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb) AS progress',[
      ...args,prior.revision,prior.cursor,result.nextCursor,result.done,JSON.stringify(result.counts),JSON.stringify(result.blobReferences??[]),
    ])).rows[0]?.progress as Progress;
    if (!next || next.revision!==(BigInt(prior.revision)+1n).toString()) throw Error('DELETION_CHECKPOINT_RESULT_INVALID');
    await c.query('COMMIT');
    return next;
  } catch (error) {
    await c.query('ROLLBACK').catch(()=>{});
    throw error;
  } finally {
    if (ctx) liveContexts.delete(ctx);
    c.release();
  }
}

/** Supervisor-only observation while host and ledger guards remain held. The
 * caller owns the transaction; this function never commits, advances a job
 * phase, removes bytes or asserts readiness for PURGE/FINALIZE. */
export async function checkpointQuiescenceAndInventoryWithinBarrier(
 c: PoolClient, target: Target, receiptId: string, maxBatches = 10000,
): Promise<void> {
 if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(receiptId) ||
     !Number.isInteger(maxBatches) || maxBatches<1 || maxBatches>10000) throw Error('DELETION_BARRIER_INVALID');
 await c.query("SELECT set_config('orgmap.deletion_drain_receipt',$1,true)",[receiptId]);
 const args=[target.organizationId,target.jobId,target.lifecycleFence,target.leaseToken];
 await c.query('SELECT public.orgmap_deletion_drain_assert($1,$2,$3,$4,$5)',[receiptId,...args]);
 const actor=(await c.query('SELECT public.orgmap_deletion_quiescence_initiator($1,$2,$3,$4) AS actor',args)).rows[0]?.actor;
 if (actor!==target.actorAccountId) throw Error('DELETION_ACTOR_MISMATCH');
 await assertLiveDeletionTableInventory(c);
 const participants=registeredDeletionParticipants();
 for (const participant of participants) {
  const prior=(await c.query("SELECT orgmap_deletion_read_progress($1,$2,$3,$4,$5,'QUIESCE') AS progress",[...args,participant.contextId])).rows[0]?.progress as Progress;
  if (!prior || !/^[1-9][0-9]*$/.test(prior.revision) || prior.cursor!==null || typeof prior.done!=='boolean') throw Error('DELETION_PROGRESS_INVALID');
  const ctx=Object.freeze({...target,c}) as unknown as OrganizationDeletionContext;
  liveContexts.add(ctx);
  try {
   const result=await participant.runBatch(ctx,{phase:'QUIESCE',cursor:null,limit:1});
   assertLiveOrganizationDeletionContext(ctx);
   if (!result?.done || result.nextCursor!==null || Object.keys(result.counts??{}).length!==0 || (result.blobReferences?.length??0)!==0)
    throw Error('DELETION_QUIESCE_RESULT_INVALID');
  } finally { liveContexts.delete(ctx); }
  {
   const next=(await c.query('SELECT public.orgmap_deletion_quiescence_checkpoint($1,$2,$3,$4,$5,$6) AS progress',[...args,participant.contextId,prior.revision])).rows[0]?.progress as Progress;
   if (!next || !next.done || next.revision!==(BigInt(prior.revision)+1n).toString()) throw Error('DELETION_CHECKPOINT_RESULT_INVALID');
  }
 }
 await c.query('SELECT public.orgmap_deletion_advance_inventory($1,$2,$3,$4)',args);
 let batches=0;
 for (const participant of participants) {
  for (;;) {
   if (++batches>maxBatches) throw Error('DELETION_INVENTORY_BATCH_LIMIT');
   const prior=(await c.query("SELECT orgmap_deletion_read_progress($1,$2,$3,$4,$5,'INVENTORY') AS progress",[...args,participant.contextId])).rows[0]?.progress as Progress;
   if (!prior || !/^[1-9][0-9]*$/.test(prior.revision) || typeof prior.done!=='boolean' || (prior.cursor!==null && typeof prior.cursor!=='string')) throw Error('DELETION_PROGRESS_INVALID');
   if (prior.done) break;
   const ctx=Object.freeze({...target,c}) as unknown as OrganizationDeletionContext;
   liveContexts.add(ctx);
   let result: Awaited<ReturnType<OrganizationTeardownParticipant['runBatch']>>;
   try { result=await participant.runBatch(ctx,{phase:'INVENTORY',cursor:prior.cursor,limit:500}); assertLiveOrganizationDeletionContext(ctx); }
   finally { liveContexts.delete(ctx); }
   if (!result || typeof result.done!=='boolean' || (result.nextCursor!==null && typeof result.nextCursor!=='string') ||
       (!result.done && result.nextCursor===null) || (result.nextCursor?.length??0)>4096 || !result.counts ||
       Object.entries(result.counts).some(([key,value])=>!/^[a-zA-Z][a-zA-Z0-9_]{0,99}$/.test(key) || !Number.isSafeInteger(value) || value<0)) throw Error('DELETION_BATCH_RESULT_INVALID');
   const next=(await c.query("SELECT orgmap_deletion_checkpoint($1,$2,$3,$4,$5,'INVENTORY',$6,$7,$8,$9,$10::jsonb,$11::jsonb) AS progress",[...args,participant.contextId,prior.revision,prior.cursor,result.nextCursor,result.done,JSON.stringify(result.counts),JSON.stringify(result.blobReferences??[])])).rows[0]?.progress as Progress;
   if (!next || next.revision!==(BigInt(prior.revision)+1n).toString()) throw Error('DELETION_CHECKPOINT_RESULT_INVALID');
   if (result.done) break;
  }
 }
 await c.query('SELECT public.orgmap_deletion_drain_assert($1,$2,$3,$4,$5)',[receiptId,...args]);
}

/** Private maintenance batch: fixed registry objects and dependencies only.
 * A persisted done flag is never accepted without an authoritative owner scan.
 * The public runner remains disabled; this is not a finalization API. */
export async function runPrivateDeletionPurgeBatch(
 maintenance: Pool, target: Target, owner: string, limit: number,
): Promise<Progress> {
 if (!Number.isInteger(limit) || limit<1 || limit>500) throw Error('DELETION_BATCH_INVALID');
 const participants=registeredDeletionParticipants();
 const participant=participants.find(item=>item.contextId===owner);
 if (!participant) throw Error('DELETION_PARTICIPANT_NOT_REGISTERED');
 assertRegisteredDeletionParticipant(participant);
 const c=await maintenance.connect(); let ctx: OrganizationDeletionContext|undefined;
 try {
  await c.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  await c.query('SELECT pg_advisory_xact_lock(730184)');
  const args=[target.organizationId,target.jobId,target.lifecycleFence,target.leaseToken];
  await c.query('SELECT public.orgmap_deletion_assert_schema_current($1,$2,$3,$4)',args);
  const actor=(await c.query('SELECT public.orgmap_deletion_purge_initiator($1,$2,$3,$4) actor',args)).rows[0]?.actor;
  if (actor!==target.actorAccountId) throw Error('DELETION_ACTOR_MISMATCH');
  for (const dependency of participant.describe().after) {
   if (!participants.some(item=>item.contextId===dependency)) throw Error('DELETION_DEPENDENCY_INVALID');
   const p=(await c.query("SELECT orgmap_deletion_read_progress($1,$2,$3,$4,$5,'PURGE') progress",[...args,dependency])).rows[0]?.progress as Progress;
   if (!p?.done) throw Error('DELETION_DEPENDENCY_INCOMPLETE');
   await c.query('SELECT public.orgmap_deletion_assert_owner_empty($1,$2,$3,$4,$5)',[...args,dependency]);
  }
  const prior=(await c.query("SELECT orgmap_deletion_read_progress($1,$2,$3,$4,$5,'PURGE') progress",[...args,owner])).rows[0]?.progress as Progress;
  if (!prior || !/^[1-9][0-9]*$/.test(prior.revision) || typeof prior.done!=='boolean' || (prior.cursor!==null && typeof prior.cursor!=='string')) throw Error('DELETION_PROGRESS_INVALID');
  if (!prior.done) {
   ctx=Object.freeze({...target,c}) as unknown as OrganizationDeletionContext; liveContexts.add(ctx);
   const result=await participant.runBatch(ctx,{phase:'PURGE',cursor:prior.cursor,limit});
   assertLiveOrganizationDeletionContext(ctx);
   if (!result || typeof result.done!=='boolean' || (result.nextCursor!==null && typeof result.nextCursor!=='string') ||
       (!result.done && result.nextCursor===null) || (result.nextCursor?.length??0)>4096 || !result.counts ||
       Object.entries(result.counts).some(([key,value])=>!/^[a-zA-Z][a-zA-Z0-9_]{0,99}$/.test(key) || !Number.isSafeInteger(value) || value<0)) throw Error('DELETION_BATCH_RESULT_INVALID');
   if (result.done) {
    await c.query('SELECT public.orgmap_deletion_assert_owner_empty($1,$2,$3,$4,$5)',[...args,owner]);
    if (owner==='foundation') await c.query('SELECT public.orgmap_deletion_assert_mixed_empty($1,$2,$3,$4)',args);
   }
   const next=(await c.query("SELECT orgmap_deletion_checkpoint($1,$2,$3,$4,$5,'PURGE',$6,$7,$8,$9,$10::jsonb,$11::jsonb) progress",[...args,owner,prior.revision,prior.cursor,result.nextCursor,result.done,JSON.stringify(result.counts),JSON.stringify(result.blobReferences??[])])).rows[0]?.progress as Progress;
   if (!next || next.revision!==(BigInt(prior.revision)+1n).toString()) throw Error('DELETION_CHECKPOINT_RESULT_INVALID');
   await c.query('COMMIT'); return next;
  }
  await c.query('SELECT public.orgmap_deletion_assert_owner_empty($1,$2,$3,$4,$5)',[...args,owner]);
  if (owner==='foundation') await c.query('SELECT public.orgmap_deletion_assert_mixed_empty($1,$2,$3,$4)',args);
  await c.query('COMMIT'); return prior;
 } catch(error) {await c.query('ROLLBACK').catch(()=>{});throw error;}
 finally {if(ctx) liveContexts.delete(ctx); c.release();}
}
