import { hostname } from 'node:os';
import type { Pool } from 'pg';
import type { OrganizationLedger } from './organization-ledger.js';
import { assertHostDatabaseBindingLocked,withStoppedHostWriters,type OrganizationHostLease } from './organization-host-lease.js';
import { BRANDING_GC_LOCK } from '../modules/administration/branding.js';
import type { ReservedBrandingStore } from '../modules/administration/branding-storage.js';

const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
/** Operator-only recovery. It does not publish images or remove bytes. Managed
 * writers must be stopped/reaped and the currently bound DB must be reconciled
 * with its external ledger. Neither elapsed time nor a missing lease is proof.
 */
export async function reconcileStoppedBrandingStages(input:{
  ledger:OrganizationLedger;lease:OrganizationHostLease;operator:Pool;storage:ReservedBrandingStore;
  organizationId:string;cursor?:string|null;limit?:number;
}){
  const {organizationId}=input,cursor=input.cursor??null,limit=input.limit??50;
  if(!uuid.test(organizationId)||(cursor!==null&&!uuid.test(cursor))||!Number.isInteger(limit)||limit<1||limit>500)throw Error('BRANDING_RECONCILIATION_INPUT_INVALID');
  return withStoppedHostWriters(input.ledger,input.lease,async locked=>{
    const c=await input.operator.connect();
    try{
      await c.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const role=(await c.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
      if(!role||(!role.rolsuper&&!role.rolbypassrls))throw Error('BRANDING_RECONCILIATION_OPERATOR_REQUIRED');
      await assertHostDatabaseBindingLocked(input.ledger,input.lease,c,locked);
      if(!(await c.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[organizationId])).rowCount)throw Error('BRANDING_RECONCILIATION_ORGANIZATION_NOT_FOUND');
      await c.query("SELECT set_config('orgmap.organization_id',$1,true)",[organizationId]);
      await c.query('SELECT pg_advisory_xact_lock($1)',[BRANDING_GC_LOCK]);
      const rows=(await c.query("SELECT * FROM administration_branding_stages WHERE organization_id=$1 AND state='WRITING' AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3 FOR UPDATE",[organizationId,cursor,limit])).rows;
      let retired=0,held=0;
      for(const stage of rows){
        // A PID that has been reused, a remote machine or EPERM fails closed.
        if(stage.writer_host!==hostname()){held++;continue;}
        let stopped=false;try{process.kill(stage.writer_pid,0);}catch(error:any){if(error.code==='ESRCH')stopped=true;}
        if(!stopped){held++;continue;}
        let state:'ABSENT'|'COMPLETE'|'MISMATCH';
        try{state=await input.storage.inspectReserved({key:stage.blob_key,sha256:stage.sha256,size:stage.size});}catch{held++;continue;}
        if(state==='MISMATCH'){held++;continue;}
        // Complete matching bytes or verified absence can be retired. Partial
        // and conflicting files remain WRITING for explicit operator review.
        await c.query("UPDATE administration_branding_stages SET state='ABANDONED',updated_at=clock_timestamp() WHERE id=$1 AND state='WRITING'",[stage.id]);
        await c.query("INSERT INTO administration_branding_gc(id,organization_id,purpose,blob_key,sha256,size,reason) VALUES($1,$2,$3,$4,$5,$6,'UNPUBLISHED') ON CONFLICT(id) DO NOTHING",[stage.id,organizationId,stage.purpose,stage.blob_key,stage.sha256,stage.size]);
        const ref=(await c.query('SELECT organization_id,purpose,blob_key,sha256,size FROM administration_branding_gc WHERE id=$1',[stage.id])).rows[0];
        if(!ref||ref.organization_id!==organizationId||ref.purpose!==stage.purpose||ref.blob_key!==stage.blob_key||ref.sha256!==stage.sha256||ref.size!==stage.size)throw Error('BRANDING_RECONCILIATION_GC_CONFLICT');
        retired++;
      }
      const nextCursor=rows.at(-1)?.id??null;
      const more=nextCursor!==null&&!!(await c.query("SELECT 1 FROM administration_branding_stages WHERE organization_id=$1 AND state='WRITING' AND id>$2 LIMIT 1",[organizationId,nextCursor])).rowCount;
      const remaining=(await c.query("SELECT count(*)::text AS n FROM administration_branding_stages WHERE organization_id=$1 AND state='WRITING'",[organizationId])).rows[0].n;
      await c.query('COMMIT');
      return {inspected:rows.length,retired,held,nextCursor:more?nextCursor:null,remainingWriting:remaining,complete:remaining==='0',bytesDeleted:false,published:false};
    }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
  });
}
