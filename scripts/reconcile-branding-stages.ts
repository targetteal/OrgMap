/** Explicit local operator command; never adopts a DB or stops another writer. */
import pg from 'pg';
import { OrganizationLedger } from '../server/ops/organization-ledger.js';
import { acquireOrganizationHostLease } from '../server/ops/organization-host-lease.js';
import { reconcileStoppedBrandingStages } from '../server/ops/branding-stage-reconciliation.js';
import { createReservedBrandingStore } from '../server/modules/administration/branding-storage.js';
const option=(name:string)=>process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3);
const directory=process.env.ORGMAP_LIFECYCLE_LEDGER_DIRECTORY,url=process.env.MIGRATION_DATABASE_URL,storageDirectory=process.env.ORGMAP_BRANDING_DIRECTORY,organizationId=option('organization');
if(!directory||!url||!storageDirectory||!organizationId)throw Error('EXPLICIT_RECONCILIATION_CONFIGURATION_REQUIRED');
const parsed=new URL(url);if(!['postgres:','postgresql:'].includes(parsed.protocol)||!['127.0.0.1','localhost','[::1]'].includes(parsed.hostname))throw Error('LOCAL_DATABASE_REQUIRED');
const ledger=await OrganizationLedger.open(directory),lease=await acquireOrganizationHostLease(ledger),operator=new pg.Pool({connectionString:parsed.href});
try{
  const result=await reconcileStoppedBrandingStages({ledger,lease,operator,storage:createReservedBrandingStore(storageDirectory),organizationId,cursor:option('cursor'),limit:option('limit')===undefined?undefined:Number(option('limit'))});
  console.log(JSON.stringify(result));if(!result.complete)process.exitCode=2;
}finally{await operator.end();await lease.release();}
