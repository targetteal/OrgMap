import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, hostname } from 'node:os';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import pg from 'pg';
import { OrganizationLedger } from '../../server/ops/organization-ledger.js';
import { acquireOrganizationHostLease, assertHostDatabaseBindingLocked, provisionFreshHostBinding, joinOrganizationHostLease, withStoppedHostWriters } from '../../server/ops/organization-host-lease.js';
import { observeStoppedOrganizationEffects, reconcileStoppedOrganizationEffects } from '../../server/ops/organization-deletion-barrier.js';
import { reconcileStoppedBrandingStages } from '../../server/ops/branding-stage-reconciliation.js';
import { createReservedBrandingStore } from '../../server/modules/administration/branding-storage.js';
import { claimDeletionJob } from '../../server/ops/organization-deletion-jobs.js';

test('offline host drain observes a single bound tenant and refuses active writer or unresolved source',async()=>{
 const adminUrl=new URL(process.env.MIGRATION_DATABASE_URL??'postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap');
 const runtimeUrl=new URL(process.env.DATABASE_URL??'postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap');
 if(!['127.0.0.1','localhost','[::1]'].includes(adminUrl.hostname)||adminUrl.host!==runtimeUrl.host||adminUrl.pathname!==runtimeUrl.pathname)throw Error('MATCHING_LOCAL_DATABASE_SOURCES_REQUIRED');
 const directory=await mkdtemp(join(tmpdir(),'orgmap-drain-')),ledger=await OrganizationLedger.initialize(join(directory,'ledger'));
 const admin=new pg.Pool({connectionString:adminUrl.href}), role='orgmap_drain_test_'+randomBytes(8).toString('hex'), password=randomBytes(32).toString('hex');
 let database='',lease:Awaited<ReturnType<typeof acquireOrganizationHostLease>>|undefined,source:pg.Pool|undefined,drain:pg.Pool|undefined,app:pg.Pool|undefined,roleCreated=false;
 try {
  lease=await acquireOrganizationHostLease(ledger);
  try {database=(await provisionFreshHostBinding(ledger,lease,adminUrl.href)).database;}catch(e){const m=e instanceof Error&&/^HOST_INSTALL_RECOVERY_REQUIRED:(orgmap_fresh_[a-f0-9]{32})$/.exec(e.message);if(m)database=m[1];throw e;}
  await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'`);roleCreated=true;
  console.log('drain-fixture',JSON.stringify({database,role}));
  await admin.query(`GRANT orgmap_lifecycle_maintenance, orgmap_lifecycle_drain TO "${role}"`);
  const u=new URL(adminUrl);u.pathname='/'+database;source=new pg.Pool({connectionString:u.href});
  const d=new URL(u);d.username=role;d.password=password;drain=new pg.Pool({connectionString:d.href});
  const aurl=new URL(runtimeUrl);aurl.pathname='/'+database;app=new pg.Pool({connectionString:aurl.href});
  const org=randomUUID(),other=randomUUID(),account=randomUUID(),job=randomUUID(),effect=randomUUID(),otherEffect=randomUUID(),acceptedAt=new Date().toISOString();
  const member=randomUUID(),otherMember=randomUUID(),connection=randomUUID(),otherConnection=randomUUID(),delivery=randomUUID(),otherDelivery=randomUUID(),platformDelivery=randomUUID(),platformJob=randomUUID();
  await source.query("INSERT INTO accounts(id,email,display_name,password_hash) VALUES($1,$2,'Fixture','fixture')",[account,randomUUID()+'@example.test']);
  await source.query("INSERT INTO organizations(id,name,locale,time_zone) VALUES($1,'A','pt-BR','UTC'),($2,'B','pt-BR','UTC')",[org,other]);
  await source.query("INSERT INTO members(organization_id,id,account_id,org_role,status) VALUES($1,$2,$3,'OWNER','ACTIVE'),($4,$5,$3,'OWNER','ACTIVE')",[org,member,account,other,otherMember]);
  await source.query("INSERT INTO platform_worker_scopes(organization_id,member_id,lease_token,lease_until) VALUES($1,$2,$3,clock_timestamp()-interval '1 day'),($4,$5,$6,clock_timestamp()-interval '1 day')",[org,member,randomUUID(),other,otherMember,randomUUID()]);
  await source.query("INSERT INTO platform_scope_wakes(organization_id,id,member_id,participant,claim_token) VALUES($1,$2,$3,'interoperability',$4)",[org,randomUUID(),member,randomUUID()]);
  await source.query("INSERT INTO platform_jobs(organization_id,id,owner_id,kind,resource_type,resource_ids,export_kind,state,lease_token,lease_until) VALUES($1,$2,$3,'EXPORT','meeting',ARRAY[]::uuid[],'RESOURCES','RUNNING',$4,clock_timestamp()-interval '1 day')",[org,platformJob,member,randomUUID()]);
  await source.query("INSERT INTO platform_deliveries(organization_id,id,event_id,recipient_id,channel,resource_type,resource_id,event,lease_token,lease_until) VALUES($1,$2,$3,$4,'EMAIL','meeting',$5,'Fixture',$6,clock_timestamp()-interval '1 day')",[org,platformDelivery,randomUUID(),member,randomUUID(),randomUUID()]);
  await source.query("INSERT INTO interop_connections(organization_id,id,provider,label) VALUES($1,$2,'LOCAL','A'),($3,$4,'LOCAL','B')",[org,connection,other,otherConnection]);
  await source.query("INSERT INTO interop_deliveries(organization_id,id,connection_id,event_id,payload,state,owner_member_id,lease_token,lease_until) VALUES($1,$2,$3,'event-a','{}','SENDING',$4,$5,clock_timestamp()-interval '1 day'),($6,$7,$8,'event-b','{}','SENDING',$9,$10,clock_timestamp()-interval '1 day')",[org,delivery,connection,member,randomUUID(),other,otherDelivery,otherConnection,otherMember,randomUUID()]);
  for(const [id,e] of [[org,effect],[other,otherEffect]]) await source.query("INSERT INTO organization_effects(organization_id,id,owner,effect_key,lifecycle_fence,source_lease_token,effect_token) VALUES($1,$2,'IAM',$3,1,$4,$5)",[id,e,'mail:'+e,randomUUID(),randomUUID()]);
  await source.query('BEGIN');
  await source.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[org]);
  await source.query("UPDATE organization_lifecycle SET state='DELETION_PENDING',fence=2 WHERE organization_id=$1",[org]);
  await source.query('COMMIT');
  const entry={organizationId:org,jobId:job,fence:'2',acceptedAt};await ledger.confirm(entry);
  const digest=createHash('sha256').update(JSON.stringify(entry)).digest('hex');
  await source.query("INSERT INTO organization_deletion_jobs(organization_id,id,initiator_account_id,request_key,request_hash,accepted_fence,lifecycle_fence,phase,ledger_state,ledger_authority_id,ledger_record_sha256,accepted_at) VALUES($1,$2,$3,'fixture',$4,2,2,'QUIESCE','CONFIRMED',$5,$6,$7)",[org,job,account,'a'.repeat(64),ledger.authorityId,digest,acceptedAt]);
  const token=(await claimDeletionJob(drain,{organizationId:org,jobId:job,fence:'2',ttlSeconds:300})).token;
  const input={ledger,lease,operator:source,drain,organizationId:org,jobId:job,fence:'2',leaseToken:token};
  const c=await source.connect();const registration=await joinOrganizationHostLease(ledger,lease.token,c);c.release();
  await assert.rejects(observeStoppedOrganizationEffects(input),/HOST_WRITERS_STILL_REGISTERED/);
  await registration.release();
  await source.query("INSERT INTO iam_mail_scope_leases(kind,organization_id,lease_token,lease_until) VALUES('INVITATION',$1,$2,clock_timestamp()-interval '1 day')",[org,randomUUID()]);
  await source.query("INSERT INTO iam_mail_scope_leases(kind,organization_id,lease_token,lease_until) VALUES('INVITATION',$1,$2,clock_timestamp()-interval '1 day')",[other,randomUUID()]);
  await source.query("INSERT INTO iam_mail_scope_leases(kind,organization_id,lease_token,lease_until) VALUES('ACCOUNT','00000000-0000-0000-0000-000000000000',$1,clock_timestamp()-interval '1 day')",[randomUUID()]);
  const badA=randomUUID(),badB=randomUUID();
  await source.query("INSERT INTO iam_mail_scope_leases(kind,organization_id,lease_token,lease_until) VALUES('UNCLASSIFIED_A',$1,$2,clock_timestamp()-interval '1 day'),('UNCLASSIFIED_B',$3,$4,clock_timestamp()-interval '1 day')",[org,badA,other,badB]);
  await assert.rejects(reconcileStoppedOrganizationEffects(input),/DELETION_DRAIN_IAM_SCOPE_UNCLASSIFIED/);
  assert.equal((await source.query('SELECT state FROM organization_effects WHERE organization_id=$1 AND id=$2',[org,effect])).rows[0].state,'AUTHORIZED');
  assert.equal((await source.query('SELECT count(*)::int AS n FROM organization_deletion_drain_receipts WHERE job_id=$1',[job])).rows[0].n,0);
  assert.equal((await source.query('SELECT count(*)::int AS n FROM interoperability_deletion_outcomes WHERE job_id=$1',[job])).rows[0].n,0);
  assert.equal((await source.query("SELECT lease_token FROM iam_mail_scope_leases WHERE organization_id=$1 AND kind='UNCLASSIFIED_A'",[org])).rows[0].lease_token,badA);
  await source.query("DELETE FROM iam_mail_scope_leases WHERE organization_id=$1 AND kind='UNCLASSIFIED_A'",[org]);
  await assert.rejects(observeStoppedOrganizationEffects(input),/DELETION_DRAIN_SOURCE_UNRESOLVED/);
  assert.equal((await source.query('SELECT state FROM organization_effects WHERE organization_id=$1 AND id=$2',[org,effect])).rows[0].state,'AUTHORIZED');
  const child=spawn(process.execPath,['-e','']);const stoppedPid=child.pid!;
  await new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('fixture child failed')));});
  const stage=randomUUID();
  await source.query("INSERT INTO administration_branding_stages(id,organization_id,actor_id,credential_scope,purpose,request_key,request_hash,lifecycle_fence,base_revision,blob_key,sha256,size,width,height,write_token,writer_host,writer_pid,state) VALUES($1,$2,$3,'cookie','EMAIL_LOGO',$4,$5,1,0,$6,$5,1,1,1,$7,$8,$9,'WRITING')",[stage,org,account,randomUUID(),'b'.repeat(64),randomUUID(),randomUUID(),hostname(),stoppedPid]);
  await assert.rejects(reconcileStoppedOrganizationEffects(input),/DELETION_DRAIN_BRANDING_WRITING/);
  assert.equal((await source.query('SELECT state FROM organization_effects WHERE organization_id=$1 AND id=$2',[org,effect])).rows[0].state,'AUTHORIZED');
  assert.equal((await source.query('SELECT 1 FROM iam_mail_scope_leases WHERE organization_id=$1',[org])).rowCount,1);
  const stages=await reconcileStoppedBrandingStages({ledger,lease,operator:source,storage:createReservedBrandingStore(join(directory,'branding')),organizationId:org});
  assert.equal(stages.remainingWriting,'0');assert.equal(stages.retired,1);
  // Revalidate at receipt use, not only before issuing it: inject a new A
  // scope between statements on a second DB connection, then roll back.
  await withStoppedHostWriters(ledger,lease,async locked=>{
   const verifier=await source!.connect(),op=await drain!.connect();
   try{
    const binding=await assertHostDatabaseBindingLocked(ledger,lease!,verifier,locked),snapshot=await locked.snapshot();
    await op.query('BEGIN');
    for(const owner of ['iam','platform','interop'])await op.query('SELECT orgmap_deletion_drain_reconcile($1,$2,2,$3,$4)',[org,job,token,owner]);
    const receipt=(await op.query('SELECT orgmap_deletion_drain_observe($1,$2,2,$3,$4,$5,$6,2,$7,$8,$9) AS id',[org,job,token,ledger.authorityId,binding.instanceId,binding.epoch,acceptedAt,digest,snapshot.sha256])).rows[0].id;
    await source!.query("INSERT INTO iam_mail_scope_leases(kind,organization_id,lease_token,lease_until) VALUES('LATE_UNKNOWN',$1,$2,clock_timestamp()+interval '1 hour')",[org,randomUUID()]);
    await assert.rejects(op.query('SELECT orgmap_deletion_drain_assert($1,$2,$3,2,$4)',[receipt,org,job,token]),/DELETION_DRAIN_IAM_SCOPE_UNRESOLVED/);
    await op.query('ROLLBACK');
   }finally{await source!.query("DELETE FROM iam_mail_scope_leases WHERE organization_id=$1 AND kind='LATE_UNKNOWN'",[org]);op.release();verifier.release();}
  });
  await assert.rejects(app.query('SELECT orgmap_deletion_drain_observe($1,$2,2,$3,$4,$5,1,2,$6,$7,$7)',[org,job,token,ledger.authorityId,randomUUID(),acceptedAt,digest]),/permission denied/);
  const result=await reconcileStoppedOrganizationEffects(input);assert.equal(result.scope,'LOCAL_STOPPED_WRITERS_OBSERVATION_ONLY');
  await assert.rejects(drain.query('SELECT orgmap_deletion_drain_assert($1,$2,$3,2,$4)',[result.receiptId,org,job,token]),/DELETION_DRAIN_RECEIPT_INVALID/);
  assert.equal((await source.query('SELECT 1 FROM iam_mail_scope_leases WHERE organization_id=$1',[org])).rowCount,0);
  assert.equal((await source.query('SELECT 1 FROM iam_mail_scope_leases WHERE organization_id=$1',[other])).rowCount,2);
  assert.equal((await source.query("SELECT lease_token FROM iam_mail_scope_leases WHERE organization_id=$1 AND kind='UNCLASSIFIED_B'",[other])).rows[0].lease_token,badB);
  assert.equal((await source.query("SELECT 1 FROM iam_mail_scope_leases WHERE kind='ACCOUNT'")).rowCount,1);
  assert.equal((await source.query('SELECT state FROM platform_jobs WHERE organization_id=$1 AND id=$2',[org,platformJob])).rows[0].state,'FAILED');
  assert.equal((await source.query('SELECT state FROM platform_deliveries WHERE organization_id=$1 AND id=$2',[org,platformDelivery])).rows[0].state,'OUTCOME_UNKNOWN');
  assert.equal((await source.query('SELECT state FROM interop_deliveries WHERE organization_id=$1 AND id=$2',[org,delivery])).rows[0].state,'OUTCOME_UNKNOWN');
  assert.equal((await source.query('SELECT state FROM interop_deliveries WHERE organization_id=$1 AND id=$2',[other,otherDelivery])).rows[0].state,'SENDING');
  assert.ok((await source.query('SELECT lease_token FROM platform_worker_scopes WHERE organization_id=$1',[other])).rows[0].lease_token);
  assert.equal((await source.query('SELECT state FROM organization_effects WHERE organization_id=$1 AND id=$2',[org,effect])).rows[0].state,'OUTCOME_UNKNOWN');
  assert.equal((await source.query('SELECT state FROM organization_effects WHERE organization_id=$1 AND id=$2',[other,otherEffect])).rows[0].state,'AUTHORIZED');
  assert.equal((await source.query('SELECT state FROM organization_lifecycle WHERE organization_id=$1',[other])).rows[0].state,'ACTIVE');
  assert.equal((await source.query('SELECT 1 FROM accounts WHERE id=$1',[account])).rowCount,1);
  await assert.rejects(observeStoppedOrganizationEffects({...input,fence:'3'}),/DELETION_MAINTENANCE_LEASE_INVALID/);
  const isolation=await drain.connect();
  try { await isolation.query('BEGIN ISOLATION LEVEL REPEATABLE READ'); await isolation.query('SELECT 1');
   await assert.rejects(isolation.query('SELECT orgmap_deletion_drain_assert($1,$2,$3,2,$4)',[result.receiptId,org,job,token]),/DELETION_READ_COMMITTED_REQUIRED/);
  } finally { await isolation.query('ROLLBACK');isolation.release(); }
  // A competing join cannot pass the same exclusive ledger section while drain is running.
  let joinFinished=false;const probe=await source.connect();let pending:ReturnType<typeof joinOrganizationHostLease>|undefined;
  await withStoppedHostWriters(ledger,lease,async()=>{pending=joinOrganizationHostLease(ledger,lease!.token,probe).then(x=>{joinFinished=true;return x;});await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(joinFinished,false);});
  const concurrent=await pending!;probe.release();await concurrent.release();
 } finally {
  await app?.end();await drain?.end();await source?.end();await lease?.release();
  if(database){if(!/^orgmap_fresh_[a-f0-9]{32}$/.test(database))throw Error('UNEXPECTED_DATABASE');await admin.query(`DROP DATABASE "${database}"`);}
  if(roleCreated)await admin.query(`DROP ROLE "${role}"`);
  if(database)assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rowCount,0);
  if(roleCreated)assert.equal((await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount,0);
  console.log('drain-cleanup',JSON.stringify({database,role,databaseRemoved:true,roleRemoved:true}));
  await admin.end();await rm(directory,{recursive:true,force:true});
 }
});
