import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {reconcileRestoredOrganizationLedger} from '../../server/ops/organization-ledger-restore.js';
const entry=(id:string,fence='2')=>({organizationId:id,jobId:randomUUID(),fence,acceptedAt:'2026-10-30T12:00:00.000Z'});
const snapshot=(entries:any[])=>({format:'orgmap-organization-ledger-v1' as const,authorityId:randomUUID(),entries,sha256:'a'.repeat(64)});
test('restored tombstone closes only its organization without fabricating a deletion job',async()=>{
 const a=randomUUID(),b=randomUUID(),state=new Map([[a,{state:'ACTIVE',fence:'1'}],[b,{state:'ACTIVE',fence:'1'}]]);let writes=0;
 const c={query:async(sql:string,args:any[]=[])=>{if(sql.includes('to_regclass'))return {rows:[{name:'organization_deletion_jobs'}]};if(sql.startsWith('SELECT id FROM organizations'))return {rows:state.has(args[0])?[{id:args[0]}]:[]};if(sql.startsWith('SELECT state,fence'))return {rows:[state.get(args[0])]};if(sql.startsWith('UPDATE organization_lifecycle')){state.set(args[0],{state:'DELETION_PENDING',fence:'2'});writes++;return {rows:[]};}if(sql.startsWith('SELECT id,accepted_fence'))return {rows:[]};throw Error(sql);}} as any;
 const result=await reconcileRestoredOrganizationLedger(c,snapshot([entry(a)]));assert.deepEqual(result,{closed:1,absent:0,missingJobs:1,blockedJobs:0,pendingRecovery:'RECOVERY_JOB_MISSING',backupCopies:'UNKNOWN'});assert.equal(state.get(a)?.state,'DELETION_PENDING');assert.equal(state.get(b)?.state,'ACTIVE');assert.equal(writes,1);
});
test('incompatible fence fails closed instead of fabricating transitions',async()=>{
 const org=randomUUID(),c={query:async(sql:string)=>sql.includes('to_regclass')?{rows:[{name:null}]}:sql.startsWith('SELECT id FROM organizations')?{rows:[{id:org}]}:sql.startsWith('SELECT state,fence')?{rows:[{state:'ACTIVE',fence:'1'}]}:Promise.reject(Error('unexpected mutation'))} as any;
 await assert.rejects(reconcileRestoredOrganizationLedger(c,snapshot([entry(org,'3')])),/FENCE_MISMATCH/);
});
test('restored compatible job is blocked pending ledger reconciliation without purging',async()=>{
 const org=randomUUID(),t=entry(org);let update='';const c={query:async(sql:string)=>{if(sql.includes('to_regclass'))return {rows:[{name:'organization_deletion_jobs'}]};if(sql.startsWith('SELECT id FROM organizations'))return {rows:[{id:org}]};if(sql.startsWith('SELECT state,fence'))return {rows:[{state:'DELETION_PENDING',fence:'2'}]};if(sql.startsWith('SELECT id,accepted_fence'))return {rows:[{id:t.jobId,accepted_fence:'2'}]};if(sql.startsWith('UPDATE organization_deletion_jobs')){update=sql;return {rows:[]};}throw Error(sql);}} as any;
 const result=await reconcileRestoredOrganizationLedger(c,snapshot([t]));assert.equal(result.blockedJobs,1);assert.equal(result.pendingRecovery,'RECOVERY_JOB_RECONCILIATION_REQUIRED');assert.match(update,/state='PENDING'/);assert.match(update,/ledger_state='PENDING'/);assert.match(update,/lease_token=NULL/);
});
