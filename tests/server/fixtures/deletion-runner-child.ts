import pg from 'pg';
import {OrganizationLedger} from '../../../server/ops/organization-ledger.js';
import {acquireOrganizationHostLease} from '../../../server/ops/organization-host-lease.js';
import {processStoppedOrganizationDeletion} from '../../../server/ops/organization-deletion-runner.js';
const names=['TEST_VERIFIER_URL','TEST_DRAIN_URL','TEST_CONFIRM_URL','TEST_BLOB_URL','TEST_FINALIZE_URL'];
const urls=names.map(n=>{const v=process.env[n];if(!v)throw Error('TEST_PRIVATE_URL_MISSING');return v;});
const pools=urls.map(connectionString=>new pg.Pool({connectionString}));
const [verifier,drain,confirmation,blob,finalizer]=pools;
const ledger=await OrganizationLedger.open(process.env.TEST_LEDGER_DIRECTORY!);const lease=await acquireOrganizationHostLease(ledger);
try{const result=await processStoppedOrganizationDeletion({ledger,lease,verifier,maintenance:drain,drain,confirmation,blob,finalizer,organizationId:process.env.TEST_ORG_ID!,jobId:process.env.TEST_JOB_ID!,leaseTtlSeconds:30});console.log(JSON.stringify({state:result.state,phase:result.phase}));}
finally{await lease.release();await Promise.all(pools.map(p=>p.end()));}
