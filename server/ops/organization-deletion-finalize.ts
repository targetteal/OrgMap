import type {Pool} from 'pg';
import {withStoppedHostWriters,type OrganizationHostLease} from './organization-host-lease.js';
import {assertHostStorageBindingLocked} from './organization-storage-binding.js';
import {tombstoneSha256,type OrganizationLedger} from './organization-ledger.js';
import {createReservedBrandingStore} from '../modules/administration/branding-storage.js';
import {FilesystemBlobStore} from '../modules/platform/blob.js';

type Input={ledger:OrganizationLedger;lease:OrganizationHostLease;verifier:Pool;finalizer:Pool;organizationId:string;jobId:string;fence:string;leaseToken:string};
export type CompletionReceipt={schemaVersion:1;jobId:string;organizationId:string;primaryPurge:'COMPLETE';completedAt:string;localObjects:number;localBytes:number;remoteEffects:'UNKNOWN';backupCopies:'UNKNOWN';lastRetainedCopyExpiresAt:null;retainedTechnicalControls:string[]};
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const controls=['organization_tombstone','deletion_job','ledger','effect_outcomes','blob_removal_intents','revoked_session_provenance','account_command_tombstones'];
function validateReceipt(r:any,input:Input):CompletionReceipt {
 const expected=['backupCopies','completedAt','jobId','lastRetainedCopyExpiresAt','localBytes','localObjects','organizationId','primaryPurge','remoteEffects','retainedTechnicalControls','schemaVersion'];
 if(!r||typeof r!=='object'||Array.isArray(r)||JSON.stringify(Object.keys(r).sort())!==JSON.stringify(expected)||r.schemaVersion!==1||r.jobId!==input.jobId||r.organizationId!==input.organizationId||r.primaryPurge!=='COMPLETE'||typeof r.completedAt!=='string'||!Number.isFinite(Date.parse(r.completedAt))||!Number.isSafeInteger(r.localObjects)||r.localObjects<0||!Number.isSafeInteger(r.localBytes)||r.localBytes<0||r.remoteEffects!=='UNKNOWN'||r.backupCopies!=='UNKNOWN'||r.lastRetainedCopyExpiresAt!==null||JSON.stringify(r.retainedTechnicalControls)!==JSON.stringify(controls))throw Error('DELETION_FINALIZER_RECEIPT_INVALID');
 return r;
}
/** Local trusted supervisor; private login is not an app or user capability.
 * Filesystem and SQL have no shared transaction: stopped registered writers,
 * bound roots and advisory locks must remain held until COMMIT. */
export async function finalizeStoppedOrganization(input:Input):Promise<CompletionReceipt>{
 if(!uuid.test(input.organizationId)||!uuid.test(input.jobId)||!uuid.test(input.leaseToken)||!/^[1-9][0-9]{0,18}$/.test(input.fence))throw Error('DELETION_FINALIZER_INPUT_INVALID');
 return withStoppedHostWriters(input.ledger,input.lease,async locked=>{
  const verifier=await input.verifier.connect();
  try {
   const roots=await assertHostStorageBindingLocked(input.ledger,input.lease,verifier,locked);
   const snapshot=await locked.snapshot(),entry=snapshot.entries.find(e=>e.organizationId===input.organizationId);
   if(!entry||entry.jobId!==input.jobId||BigInt(entry.fence)>BigInt(input.fence))throw Error('DELETION_FINALIZER_LEDGER_MISMATCH');
   const c=await input.finalizer.connect();const locks:number[]=[];
   try {
    const endpointSql="SELECT current_database() AS name,coalesce(inet_server_addr()::text,'local') AS host,inet_server_port() AS port";
    const v=(await verifier.query(endpointSql)).rows[0],f=(await c.query(endpointSql)).rows[0];
    if(!v||!f||v.name!==f.name||v.host!==f.host||v.port!==f.port)throw Error('DELETION_FINALIZER_DATABASE_MISMATCH');
    const replay=(await c.query('SELECT public.orgmap_deletion_finalization_replay($1,$2,$3,$4) result',[input.organizationId,input.jobId,input.ledger.authorityId,tombstoneSha256(entry)])).rows[0]?.result;
    if(replay) return validateReceipt(replay,input);
    for(const lock of [730184,730409,730502]){await c.query('SELECT pg_advisory_lock($1)',[lock]);locks.push(lock);}
    await c.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    try {
     const binding=await assertHostStorageBindingLocked(input.ledger,input.lease,verifier,locked);
     if(binding.platform!==roots.platform||binding.branding!==roots.branding)throw Error('DELETION_FINALIZER_BINDING_CHANGED');
     const b=(await verifier.query('SELECT authority_id,instance_id,epoch::text FROM organization_runtime_identity WHERE singleton')).rows[0];
     const receipt=(await c.query('SELECT public.orgmap_deletion_drain_observe($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) id',[input.organizationId,input.jobId,input.fence,input.leaseToken,b.authority_id,b.instance_id,b.epoch,entry.fence,entry.acceptedAt,tombstoneSha256(entry),snapshot.sha256])).rows[0]?.id;
     if(!uuid.test(receipt))throw Error('DELETION_FINALIZER_DRAIN_INVALID');
     const args=[input.organizationId,input.jobId,input.fence,input.leaseToken,receipt];
     const manifest=(await c.query('SELECT public.orgmap_deletion_finalize_manifest($1,$2,$3,$4,$5) result',args)).rows[0]?.result;
     if(!manifest||!Array.isArray(manifest.refs)||!Number.isSafeInteger(manifest.objects)||manifest.objects!==manifest.refs.length||!Number.isSafeInteger(manifest.bytes)||manifest.bytes<0)throw Error('DELETION_FINALIZER_MANIFEST_INVALID');
     const branding=createReservedBrandingStore(roots.branding),platform=new FilesystemBlobStore(roots.platform);
     for(const ref of manifest.refs){
      if(!ref||!['ORG_BRANDING','PLATFORM'].includes(ref.namespace)||!uuid.test(ref.key)||!/^[a-f0-9]{64}$/.test(ref.sha256)||!Number.isSafeInteger(ref.size)||ref.size<1)throw Error('DELETION_FINALIZER_MANIFEST_INVALID');
      const state=ref.namespace==='ORG_BRANDING'?await branding.inspectReserved(ref):await platform.inspectChecked(ref);
      if(state!=='ABSENT')throw Error('DELETION_FINALIZER_LOCAL_OBJECT_PRESENT');
     }
     input.lease.assertHeld();await assertHostStorageBindingLocked(input.ledger,input.lease,verifier,locked);
     const result=validateReceipt((await c.query('SELECT public.orgmap_deletion_finalize($1,$2,$3,$4,$5) result',args)).rows[0]?.result,input);
     if(result.localObjects!==manifest.objects||result.localBytes!==manifest.bytes)throw Error('DELETION_FINALIZER_RECEIPT_INVALID');
     await c.query('COMMIT');return result;
    } catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}
   } finally {let bad=false;for(const lock of locks.reverse())try{if((await c.query('SELECT pg_advisory_unlock($1) unlocked',[lock])).rows[0]?.unlocked!==true)bad=true;}catch{bad=true;}c.release(bad);}
  } finally {verifier.release();}
 });
}
