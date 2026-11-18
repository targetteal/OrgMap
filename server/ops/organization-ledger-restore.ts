import type { PoolClient } from 'pg';
import type { OrganizationLedgerSnapshot } from './organization-ledger.js';
/** Apply confirmed tombstones to an isolated restore. Caller owns transaction and operator authority. No content purge. */
export async function reconcileRestoredOrganizationLedger(c: Pick<PoolClient,'query'>, ledger: OrganizationLedgerSnapshot) {
  let closed=0, absent=0, missingJobs=0, blockedJobs=0;
  const jobsExist=!!(await c.query("SELECT to_regclass('public.organization_deletion_jobs') AS name")).rows[0]?.name;
  for(const entry of ledger.entries) {
    const org=(await c.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[entry.organizationId])).rows[0];
    if(!org) {absent++;continue;}
    const lifecycle=(await c.query('SELECT state,fence::text AS fence FROM organization_lifecycle WHERE organization_id=$1 FOR UPDATE',[entry.organizationId])).rows[0];
    if(!lifecycle) throw Error('LIFECYCLE_RESTORE_STATE_MISSING');
    if(lifecycle.state==='ACTIVE') {
      if(lifecycle.fence!=='1'||entry.fence!=='2') throw Error('LIFECYCLE_RESTORE_FENCE_MISMATCH');
      await c.query("UPDATE organization_lifecycle SET state='DELETION_PENDING',fence=2 WHERE organization_id=$1",[entry.organizationId]);
    } else if(!['DELETION_PENDING','PURGING','DELETED'].includes(lifecycle.state)||BigInt(lifecycle.fence)<BigInt(entry.fence)) throw Error('LIFECYCLE_RESTORE_FENCE_MISMATCH');
    if(jobsExist && lifecycle.state!=='DELETED') {
      const job=(await c.query('SELECT id,accepted_fence::text AS accepted_fence FROM organization_deletion_jobs WHERE organization_id=$1 FOR UPDATE',[entry.organizationId])).rows[0];
      if(job) {
        if(job.id!==entry.jobId||job.accepted_fence!==entry.fence) throw Error('LIFECYCLE_RESTORE_JOB_MISMATCH');
        await c.query("UPDATE organization_deletion_jobs SET state='PENDING',ledger_state='PENDING',ledger_authority_id=NULL,ledger_record_sha256=NULL,lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE organization_id=$1",[entry.organizationId]);
        blockedJobs++;
      } else missingJobs++;
    } else if(!jobsExist && lifecycle.state!=='DELETED') missingJobs++;
    closed++;
  }
  return {closed,absent,missingJobs,blockedJobs,pendingRecovery:missingJobs?'RECOVERY_JOB_MISSING' as const:blockedJobs?'RECOVERY_JOB_RECONCILIATION_REQUIRED' as const:'NONE' as const,backupCopies:'UNKNOWN' as const};
}
