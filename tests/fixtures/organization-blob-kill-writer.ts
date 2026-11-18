import pg from 'pg';
import {OrganizationLedger} from '../../server/ops/organization-ledger.js';
import {acquireOrganizationHostLease} from '../../server/ops/organization-host-lease.js';
import {removeOrganizationBlob} from '../../server/ops/organization-blob-removal.js';
import {FilesystemBlobStore} from '../../server/modules/platform/blob.js';

if(!process.send)throw Error('FIXTURE_IPC_REQUIRED');
process.once('message',async(raw:any)=>{
 try {
  const ledger=await OrganizationLedger.open(raw.ledgerDirectory),lease=await acquireOrganizationHostLease(ledger);
  process.send!({type:'LEASE',token:lease.token});
  const original=FilesystemBlobStore.prototype.removeChecked;
  FilesystemBlobStore.prototype.removeChecked=async function(ref){await original.call(this,ref);process.send!({type:'UNLINK_DONE'});await new Promise(()=>{});};
  const verifier=new pg.Pool({connectionString:raw.verifierUrl}),maintenance=new pg.Pool({connectionString:raw.maintenanceUrl});
  await removeOrganizationBlob({ledger,lease,verifier,maintenance,...raw.target});
  throw Error('FIXTURE_EXPECTED_KILL');
 }catch(error){process.send!({type:'ERROR',message:error instanceof Error?error.message:'unknown'});process.exitCode=1;}
});
