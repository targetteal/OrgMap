import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { OrganizationLedger } from '../../server/ops/organization-ledger.js';
import { acquireOrganizationHostLease, provisionFreshHostBinding } from '../../server/ops/organization-host-lease.js';
import { confirmOrganizationLedger } from '../../server/ops/organization-ledger-confirmation.js';
import { claimDeletionJob, heartbeatDeletionJob, yieldDeletionJob } from '../../server/ops/organization-deletion-jobs.js';

test('deletion job leases serialize claimants, bind fence and preserve checkpoints',async()=>{
 const adminUrl=new URL(process.env.MIGRATION_DATABASE_URL??'postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap');
 const runtimeUrl=new URL(process.env.DATABASE_URL??'postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap');
 if(!['127.0.0.1','localhost','[::1]'].includes(adminUrl.hostname)||adminUrl.host!==runtimeUrl.host||adminUrl.pathname!==runtimeUrl.pathname)throw Error('MATCHING_LOCAL_DATABASE_SOURCES_REQUIRED');
 const directory=await mkdtemp(join(tmpdir(),'orgmap-job-lease-')),ledger=await OrganizationLedger.initialize(join(directory,'ledger'));
 const admin=new pg.Pool({connectionString:adminUrl.href}),role='orgmap_job_lease_test_'+randomBytes(8).toString('hex'),password=randomBytes(32).toString('hex');
 let database='',lease:Awaited<ReturnType<typeof acquireOrganizationHostLease>>|undefined,source:pg.Pool|undefined,worker:pg.Pool|undefined,app:pg.Pool|undefined,roleCreated=false;
 try {
  lease=await acquireOrganizationHostLease(ledger);
  try{database=(await provisionFreshHostBinding(ledger,lease,adminUrl.href)).database;}catch(e){const m=e instanceof Error&&/^HOST_INSTALL_RECOVERY_REQUIRED:(orgmap_fresh_[a-f0-9]{32})$/.exec(e.message);if(m)database=m[1];throw e;}
  await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'`);roleCreated=true;
  await admin.query(`GRANT orgmap_lifecycle_maintenance,orgmap_lifecycle_ledger_confirm TO "${role}"`);
  const u=new URL(adminUrl);u.pathname='/'+database;source=new pg.Pool({connectionString:u.href});
  const w=new URL(u);w.username=role;w.password=password;worker=new pg.Pool({connectionString:w.href});
  const aurl=new URL(runtimeUrl);aurl.pathname='/'+database;app=new pg.Pool({connectionString:aurl.href});
  const org=randomUUID(),other=randomUUID(),account=randomUUID(),job=randomUUID(),otherJob=randomUUID();
  await source.query("INSERT INTO accounts(id,email,display_name,password_hash) VALUES($1,$2,'Fixture','fixture')",[account,randomUUID()+'@example.test']);
  await source.query("INSERT INTO organizations(id,name,locale,time_zone) VALUES($1,'A','pt-BR','UTC'),($2,'B','pt-BR','UTC')",[org,other]);
  const c=await source.connect();try{await c.query('BEGIN');for(const id of [org,other]){await c.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[id]);await c.query("UPDATE organization_lifecycle SET state='DELETION_PENDING',fence=2 WHERE organization_id=$1",[id]);}await c.query('COMMIT');}finally{c.release();}
  for(const [id,j] of [[org,job],[other,otherJob]])await source.query("INSERT INTO organization_deletion_jobs(organization_id,id,initiator_account_id,request_key,request_hash,accepted_fence,lifecycle_fence) VALUES($1,$2,$3,'fixture',$4,2,2)",[id,j,account,'a'.repeat(64)]);
  const input={organizationId:org,jobId:job,fence:'2',ttlSeconds:5};
  await assert.rejects(claimDeletionJob(worker,input),/DELETION_JOB_CLAIM_INVALID/);
  await assert.rejects(app.query('SELECT orgmap_deletion_job_claim($1,$2,2,5)',[org,job]),/permission denied/);
  await assert.rejects(source.query('SELECT orgmap_deletion_job_claim($1,$2,2,5)',[org,job]),/DELETION_MAINTENANCE_AUTHORITY_REQUIRED/);
  await confirmOrganizationLedger({ledger,lease,verifier:source,confirmation:worker,organizationId:org,jobId:job});
  await confirmOrganizationLedger({ledger,lease,verifier:source,confirmation:worker,organizationId:other,jobId:otherJob});
  await assert.rejects(worker.query('SELECT orgmap_deletion_job_claim($1,$2,2,301)',[org,job]),/DELETION_LEASE_TTL_INVALID/);
  const snapshot=await worker.connect();try{await snapshot.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await snapshot.query('SELECT 1');await assert.rejects(snapshot.query('SELECT orgmap_deletion_job_claim($1,$2,2,5)',[org,job]),/DELETION_READ_COMMITTED_REQUIRED/);}finally{await snapshot.query('ROLLBACK');snapshot.release();}
  const pgBefore=(await source.query('SELECT clock_timestamp() AS now')).rows[0].now as Date;
  const [a,b]=await Promise.allSettled([claimDeletionJob(worker,input),claimDeletionJob(worker,input)]);
  assert.equal([a,b].filter(x=>x.status==='fulfilled').length,1);
  assert.match(String((a.status==='rejected'?a:b as PromiseRejectedResult).reason),/DELETION_JOB_LEASE_HELD/);
  const first=(a.status==='fulfilled'?a.value:(b as PromiseFulfilledResult<Awaited<ReturnType<typeof claimDeletionJob>>>).value);
  assert.equal(first.phase,'QUIESCE');
  const pgAfter=(await source.query('SELECT clock_timestamp() AS now')).rows[0].now as Date;
  assert.ok(Date.parse(first.leaseUntil)>=pgBefore.getTime()+5000 && Date.parse(first.leaseUntil)<=pgAfter.getTime()+5000);
  const otherLease=await claimDeletionJob(worker,{organizationId:other,jobId:otherJob,fence:'2',ttlSeconds:60});
  await source.query("INSERT INTO organization_deletion_progress(job_id,context_id,phase,cursor,done) VALUES($1,'foundation','INVENTORY','checkpoint',false)",[job]);
  // Simulate a dead claimant deterministically with DB clock, never elapsed sleeps.
  await source.query("UPDATE organization_deletion_jobs SET phase='INVENTORY',lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[job]);
  await assert.rejects(heartbeatDeletionJob(worker,first,60),/DELETION_MAINTENANCE_LEASE_INVALID/);
  await assert.rejects(yieldDeletionJob(worker,first),/DELETION_MAINTENANCE_LEASE_INVALID/);
  const reclaimed=await claimDeletionJob(worker,input);assert.notEqual(reclaimed.token,first.token);assert.equal(reclaimed.phase,'INVENTORY');
  await assert.rejects(heartbeatDeletionJob(worker,first,60),/DELETION_MAINTENANCE_LEASE_INVALID/);
  await assert.rejects(yieldDeletionJob(worker,first),/DELETION_MAINTENANCE_LEASE_INVALID/);
  const expires=await heartbeatDeletionJob(worker,reclaimed,60);assert.ok(Date.parse(expires)>pgAfter.getTime()+55000);
  await yieldDeletionJob(worker,reclaimed,'WORKER_FAILED');
  let state=(await source.query('SELECT state,phase,lease_token,lease_fence,error_code FROM organization_deletion_jobs WHERE id=$1',[job])).rows[0];
  assert.equal(state.state,'FAILED');assert.equal(state.phase,'INVENTORY');assert.equal(state.lease_token,null);assert.equal(state.lease_fence,null);assert.equal(state.error_code,'WORKER_FAILED');
  const resumed=await claimDeletionJob(worker,{...input,ttlSeconds:60});assert.equal(resumed.phase,'INVENTORY');
  assert.equal((await source.query("SELECT cursor FROM organization_deletion_progress WHERE job_id=$1 AND context_id='foundation'",[job])).rows[0].cursor,'checkpoint');
  const owner=await source.connect();try{await owner.query('BEGIN');await owner.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[org]);await owner.query("UPDATE organization_lifecycle SET state='PURGING',fence=3 WHERE organization_id=$1",[org]);await owner.query('UPDATE organization_deletion_jobs SET lifecycle_fence=3 WHERE id=$1',[job]);await owner.query('COMMIT');}finally{owner.release();}
  await assert.rejects(heartbeatDeletionJob(worker,resumed,60),/DELETION_MAINTENANCE_LEASE_INVALID/);
  await assert.rejects(worker.query('SELECT orgmap_assert_deletion_maintenance($1,$2,3,$3)',[org,job,resumed.token]),/DELETION_MAINTENANCE_LEASE_INVALID/);
  const fresh=await claimDeletionJob(worker,{...input,fence:'3',ttlSeconds:60});assert.notEqual(fresh.token,resumed.token);
  await yieldDeletionJob(worker,fresh);
  state=(await source.query('SELECT state,phase FROM organization_deletion_jobs WHERE id=$1',[job])).rows[0];assert.equal(state.state,'PENDING');assert.equal(state.phase,'INVENTORY');
  const otherState=(await source.query('SELECT state,lease_token FROM organization_deletion_jobs WHERE id=$1',[otherJob])).rows[0];assert.equal(otherState.state,'RUNNING');assert.equal(otherState.lease_token,otherLease.token);
  await yieldDeletionJob(worker,otherLease);
 }finally{
  await app?.end();await worker?.end();await source?.end();await lease?.release();
  if(database){if(!/^orgmap_fresh_[a-f0-9]{32}$/.test(database))throw Error('UNEXPECTED_DATABASE');await admin.query(`DROP DATABASE "${database}"`);}
  if(roleCreated)await admin.query(`DROP ROLE "${role}"`);
  await admin.end();await rm(directory,{recursive:true,force:true});
 }
});
