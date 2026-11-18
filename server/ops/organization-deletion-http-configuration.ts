import pg from 'pg';
import type { OrganizationDeletionHttpOptions } from '../src/organization-deletion-http.js';
import { OrganizationLedger } from './organization-ledger.js';
import { createOrganizationDeletionReadiness } from './organization-deletion-readiness.js';
import { createOrganizationDeletionOperatorReceipt, readDeletionReceiptOperators } from './organization-deletion-operator-receipt.js';

/** Private local host configuration. No credential reaches bootstrap or UI. */
export async function configureOrganizationDeletionHttp(application:pg.Pool,environment:NodeJS.ProcessEnv=process.env):Promise<{options:OrganizationDeletionHttpOptions;close:()=>Promise<void>}|undefined> {
  const value=environment.ORGMAP_LIFECYCLE_ACCEPTANCE_DATABASE_URL;
  const reader=environment.ORGMAP_LIFECYCLE_RECEIPT_DATABASE_URL,operatorsFile=environment.ORGMAP_LIFECYCLE_RECEIPT_OPERATORS_FILE;
  if(!value&&!reader&&!operatorsFile)return undefined;
  if(!!reader!==!!operatorsFile)throw Error('DELETION_OPERATOR_CONFIGURATION_INCOMPLETE');
  const local=(input:string)=>{
    let url:URL;try{url=new URL(input);}catch{throw Error('DELETION_LOCAL_DATABASE_INVALID');}
    if(!['postgres:','postgresql:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.search||url.hash||url.pathname.length<2)throw Error('DELETION_LOCAL_DATABASE_REQUIRED');
    return url;
  };
  const options:OrganizationDeletionHttpOptions={},pools:pg.Pool[]=[];
  try {
    if(value) {
      if(!environment.ORGMAP_LIFECYCLE_LEDGER_DIRECTORY)throw Error('DELETION_MANAGED_HOST_REQUIRED');
      const url=local(value),ledger=await OrganizationLedger.open(environment.ORGMAP_LIFECYCLE_LEDGER_DIRECTORY);
      const acceptancePool=new pg.Pool({connectionString:url.href,max:2});pools.push(acceptancePool);
      options.acceptancePool=acceptancePool;options.assertReady=createOrganizationDeletionReadiness({ledger,application,acceptance:acceptancePool});
    }
    if(reader&&operatorsFile) {
      const url=local(reader),appUrl=local(application.options.connectionString??environment.DATABASE_URL??'');
      if(url.host!==appUrl.host||url.pathname!==appUrl.pathname)throw Error('DELETION_OPERATOR_DATABASE_MISMATCH');
      await readDeletionReceiptOperators(operatorsFile);
      const readerPool=new pg.Pool({connectionString:url.href,max:2});pools.push(readerPool);
      options.operatorReceipt=createOrganizationDeletionOperatorReceipt(readerPool,operatorsFile);
    }
    return {options,close:async()=>{await Promise.all(pools.map(pool=>pool.end()));}};
  } catch(error) {await Promise.all(pools.map(pool=>pool.end()));throw error;}
}
