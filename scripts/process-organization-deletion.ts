import pg from 'pg';
import { OrganizationLedger } from '../server/ops/organization-ledger.js';
import { acquireOrganizationHostLease } from '../server/ops/organization-host-lease.js';
import { processStoppedOrganizationDeletion } from '../server/ops/organization-deletion-runner.js';

// Run only after the operator has stopped and, where necessary, explicitly
// reaped managed writers. This command never signals a process.
function required(name:string){const value=process.env[name];if(!value)throw Error(`MISSING_PRIVATE_CONFIGURATION:${name}`);return value;}
function localUrl(value:string):string {
 let url:URL;try{url=new URL(value);}catch{throw Error('DELETION_LOCAL_DATABASE_REQUIRED');}
 if(!['postgres:','postgresql:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.search||url.hash||url.pathname.length<2)throw Error('DELETION_LOCAL_DATABASE_REQUIRED');
 return url.href;
}
async function main(){
 const [organizationId,jobId,...extra]=process.argv.slice(2);
 if(!organizationId||!jobId||extra.length)throw Error('DELETION_RUNNER_INPUT_INVALID');
 const urls=['ORGMAP_DELETION_VERIFIER_URL','ORGMAP_DELETION_MAINTENANCE_URL','ORGMAP_DELETION_DRAIN_URL','ORGMAP_DELETION_CONFIRMATION_URL','ORGMAP_DELETION_BLOB_URL','ORGMAP_DELETION_FINALIZER_URL'].map(name=>localUrl(required(name)));
 const ledger=await OrganizationLedger.open(required('ORGMAP_LIFECYCLE_LEDGER_DIRECTORY'));
 const pools=urls.map(connectionString=>new pg.Pool({connectionString,max:2}));
 try {
  const lease=await acquireOrganizationHostLease(ledger);
  try {
   const [verifier,maintenance,drain,confirmation,blob,finalizer]=pools;
   console.log(JSON.stringify(await processStoppedOrganizationDeletion({ledger,lease,verifier,maintenance,drain,confirmation,blob,finalizer,organizationId,jobId})));
  } finally {await lease.release();}
 } finally {await Promise.all(pools.map(pool=>pool.end()));}
}
main().catch(()=>{console.error(JSON.stringify({code:'DELETION_SUPERVISOR_FAILED'}));process.exitCode=1;});
