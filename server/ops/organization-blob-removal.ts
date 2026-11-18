import type { Pool,PoolClient } from 'pg';
import { withStoppedHostWriters,type OrganizationHostLease } from './organization-host-lease.js';
import { assertHostStorageBindingLocked } from './organization-storage-binding.js';
import { tombstoneSha256,type OrganizationLedger } from './organization-ledger.js';
import { createReservedBrandingStore } from '../modules/administration/branding-storage.js';
import { FilesystemBlobStore } from '../modules/platform/blob.js';

type Input={ledger:OrganizationLedger;lease:OrganizationHostLease;verifier:Pool;maintenance:Pool;organizationId:string;jobId:string;fence:string;leaseToken:string;namespace:'PLATFORM'|'ORG_BRANDING';key:string};
type Row={authorityId:string;recordSha256:string;namespace:'PLATFORM'|'ORG_BRANDING';key:string;sha256:string;size:number;state:string;intent:boolean;referenced:boolean};
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
async function target(c:Pick<PoolClient,'query'>){const r=(await c.query("SELECT current_database() AS name,coalesce(inet_server_addr()::text,'local') AS host,inet_server_port() AS port")).rows[0];return JSON.stringify([r?.name,r?.host,r?.port]);}
/** Private local supervisor only. The caller supplies no store, hold or ownership
 * decision. A committed PREPARED intent is the sole basis for an absent-file
 * replay. The lock covers backup/GC; no remote host or external storage claim. */
export async function removeOrganizationBlob(input:Input):Promise<{state:'REMOVED'|'HELD';backupCopies:'UNKNOWN'}>{
 if(!uuid.test(input.organizationId)||!uuid.test(input.jobId)||!uuid.test(input.leaseToken)||!uuid.test(input.key)||!/^[1-9][0-9]{0,18}$/.test(input.fence)||!['PLATFORM','ORG_BRANDING'].includes(input.namespace))throw Error('BLOB_REMOVAL_INPUT_INVALID');
 const args=[input.organizationId,input.jobId,input.fence,input.leaseToken,input.namespace,input.key];
 return withStoppedHostWriters(input.ledger,input.lease,async locked=>{
  const verifier=await input.verifier.connect();
  try {
   const roots=await assertHostStorageBindingLocked(input.ledger,input.lease,verifier,locked);
   const snapshot=await locked.snapshot(),entry=snapshot.entries.find(x=>x.organizationId===input.organizationId);
   if(!entry||entry.jobId!==input.jobId||BigInt(entry.fence)>BigInt(input.fence))throw Error('BLOB_REMOVAL_LEDGER_MISMATCH');
   const c=await input.maintenance.connect();let locks:number[]=[];
   try {
    if(await target(c)!==await target(verifier))throw Error('BLOB_REMOVAL_DATABASE_MISMATCH');
    for(const lock of [730184,730409,730502]){await c.query('SELECT pg_advisory_lock($1)',[lock]);locks.push(lock);}
    async function inTx<T>(fn:()=>Promise<T>):Promise<T>{await c.query('BEGIN ISOLATION LEVEL READ COMMITTED');try{const result=await fn();await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}}
    const validate=async():Promise<Row>=>{
      const row=(await c.query('SELECT public.orgmap_blob_removal_validate($1,$2,$3,$4,$5,$6) AS result',args)).rows[0]?.result;
      if(!row||row.authorityId!==input.ledger.authorityId||row.recordSha256!==tombstoneSha256(entry)||row.namespace!==input.namespace||row.key!==input.key||typeof row.sha256!=='string'||!/^[a-f0-9]{64}$/.test(row.sha256)||!Number.isSafeInteger(row.size)||row.size<0||typeof row.intent!=='boolean'||typeof row.referenced!=='boolean')throw Error('BLOB_REMOVAL_MANIFEST_INVALID');
      return row;
    };
    let row=await inTx(validate);
    const finish=async(result:'REMOVED'|'HELD')=>inTx(async()=>{await c.query('SELECT public.orgmap_blob_removal_finish($1,$2,$3,$4,$5,$6,$7)',[...args,result]);});
    if(row.state==='REMOVED')return {state:'REMOVED',backupCopies:'UNKNOWN'} as const;
    if(row.state!=='PENDING')return {state:'HELD',backupCopies:'UNKNOWN'} as const;
    if(row.referenced){await finish('HELD');return {state:'HELD',backupCopies:'UNKNOWN'} as const;}
    const branding=input.namespace==='ORG_BRANDING'?createReservedBrandingStore(roots.branding):null;
    const platform=input.namespace==='PLATFORM'?new FilesystemBlobStore(roots.platform):null;
    const ref={key:row.key,sha256:row.sha256,size:row.size};
    let inspected:'ABSENT'|'COMPLETE'|'MISMATCH';try{inspected=branding?await branding.inspectReserved(ref):await platform!.inspectChecked(ref);}catch{await finish('HELD');return {state:'HELD',backupCopies:'UNKNOWN'} as const;}
    if(inspected==='MISMATCH'||(!row.intent && inspected==='ABSENT')){await finish('HELD');return {state:'HELD',backupCopies:'UNKNOWN'} as const;}
    if(!row.intent)await inTx(async()=>{await c.query('SELECT public.orgmap_blob_removal_prepare($1,$2,$3,$4,$5,$6)',args);});
    // Hold Org/job from validate through unlink and finish, blocking reclaim.
    // If the lease expires during I/O, finish fails and the earlier committed
    // intent remains for recovery; no removal receipt is fabricated.
    return await inTx(async()=>{
     row=await validate();
     if(!row.intent||row.referenced||row.state!=='PENDING')throw Error('BLOB_REMOVAL_INTENT_INVALID');
     const live=await assertHostStorageBindingLocked(input.ledger,input.lease,verifier,locked);
     if(live.platform!==roots.platform||live.branding!==roots.branding)throw Error('BLOB_REMOVAL_BINDING_CHANGED');
     try{if(branding)await branding.removeChecked(ref);else await platform!.removeChecked(ref);}
     catch{await c.query('SELECT public.orgmap_blob_removal_finish($1,$2,$3,$4,$5,$6,$7)',[...args,'HELD']);return {state:'HELD',backupCopies:'UNKNOWN'} as const;}
     await c.query('SELECT public.orgmap_blob_removal_finish($1,$2,$3,$4,$5,$6,$7)',[...args,'REMOVED']);return {state:'REMOVED',backupCopies:'UNKNOWN'} as const;
    });
   } finally {let unlockFailed=false;for(const lock of locks.reverse())try{const result=await c.query('SELECT pg_advisory_unlock($1) AS unlocked',[lock]);if(result.rows[0]?.unlocked!==true)unlockFailed=true;}catch{unlockFailed=true;}c.release(unlockFailed);}
  } finally {verifier.release();}
 });
}
