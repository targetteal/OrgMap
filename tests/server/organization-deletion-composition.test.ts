import { finalizeStoppedOrganization } from '../../server/ops/organization-deletion-finalize.js';
import { removeOrganizationBlob } from '../../server/ops/organization-blob-removal.js';
import { installHostStorageBinding } from '../../server/ops/organization-storage-binding.js';
import { advanceStoppedInventoryToPurge, advanceStoppedPurgeToBlobs } from '../../server/ops/organization-deletion-transitions.js';
import { runPrivateDeletionPurgeBatch } from '../../server/src/organization-deletion-driver.js';
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import pg from "pg";
import sharp from "sharp";
import { hashPassword } from "../../server/src/password.js";
import { digest } from "../../server/src/core.js";
import { enterManagedWriter } from "../../server/src/managed-writer.js";
import { createRuntime } from "../../server/src/runtime.js";
import { createInteroperabilityTeardownParticipant } from "../../server/modules/interoperability/teardown.js";
import type { OrganizationDeletionContext } from "../../server/src/organization-lifecycle-contract.js";
import { createLifecycleAuthMethodsPort } from "../../server/modules/interoperability/lifecycle.js";
import { acceptOrganizationDeletion } from "../../server/src/organization-deletion-acceptance.js";
import { OrganizationLedger, tombstoneSha256 } from "../../server/ops/organization-ledger.js";
import { acquireOrganizationHostLease, provisionFreshHostBinding, joinOrganizationHostLease, withStoppedHostWriters, assertHostDatabaseBindingLocked } from "../../server/ops/organization-host-lease.js";
import { claimDeletionJob, yieldDeletionJob } from "../../server/ops/organization-deletion-jobs.js";
import { confirmOrganizationLedger } from "../../server/ops/organization-ledger-confirmation.js";
import { checkpointStoppedOrganizationQuiescenceAndInventory } from "../../server/ops/organization-deletion-barrier.js";

test("real cut, durable ledger and stopped-host receipt produce Q and inventory atomically",async()=>{
 const migration=new URL(process.env.MIGRATION_DATABASE_URL??'postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap');
 const runtime=new URL(process.env.DATABASE_URL??'postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap');
 if(!['postgres:','postgresql:'].includes(migration.protocol)||!['127.0.0.1','localhost','[::1]'].includes(migration.hostname)||migration.host!==runtime.host||migration.pathname!==runtime.pathname||migration.search!==runtime.search)throw Error('MATCHING_LOCAL_DATABASE_SOURCES_REQUIRED');
 const previousConfiguration=process.env.ORGMAP_INTEGRATION_CONFIG;
 const directory=await mkdtemp(join(tmpdir(),'orgmap-composition-')),ledger=await OrganizationLedger.initialize(join(directory,'ledger'));
 const admin=new pg.Pool({connectionString:migration.href}),suffix=randomBytes(8).toString('hex'),pass=randomBytes(32).toString('hex');
 const names=['accept','ledger','drain','owner','blob','finalize'].map(n=>`orgmap_comp_${suffix}_${n}`);
 const made:string[]=[];let database='',lease:Awaited<ReturnType<typeof acquireOrganizationHostLease>>|undefined;
 let source:pg.Pool|undefined,acceptance:pg.Pool|undefined,confirmation:pg.Pool|undefined,drain:pg.Pool|undefined,blobPool:pg.Pool|undefined,finalizer:pg.Pool|undefined;
 try {
  lease=await acquireOrganizationHostLease(ledger);
  try {database=(await provisionFreshHostBinding(ledger,lease,migration.href)).database;} catch(error) {
   const match=error instanceof Error && /^HOST_INSTALL_RECOVERY_REQUIRED:(orgmap_fresh_[a-f0-9]{32})$/.exec(error.message);
   if(match)database=match[1]; throw error;
  }
  for(const role of [names[0],names[1],names[2],names[4],names[5]]){await admin.query(`CREATE ROLE "${role}" LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${pass}'`);made.push(role);}
  await admin.query(`CREATE ROLE "${names[3]}" NOLOGIN NOSUPERUSER NOBYPASSRLS`);made.push(names[3]);
  console.log('composition-fixture',JSON.stringify({database,roles:names}));
  await admin.query(`GRANT orgmap_app,orgmap_lifecycle_acceptance TO "${names[0]}"`);
  await admin.query(`GRANT orgmap_lifecycle_ledger_confirm TO "${names[1]}"`);
  await admin.query(`GRANT orgmap_lifecycle_maintenance,orgmap_lifecycle_drain TO "${names[2]}"`);
  await admin.query(`GRANT orgmap_lifecycle_maintenance,orgmap_lifecycle_blob TO "${names[4]}"`);
  await admin.query(`GRANT orgmap_lifecycle_maintenance,orgmap_lifecycle_drain,orgmap_lifecycle_finalize TO "${names[5]}"`);
  const url=new URL(migration);url.pathname='/'+database;source=new pg.Pool({connectionString:url.href});
  const poolFor=(role:string)=>{const u=new URL(url);u.username=role;u.password=pass;return new pg.Pool({connectionString:u.href});};
  acceptance=poolFor(names[0]);confirmation=poolFor(names[1]);drain=poolFor(names[2]);blobPool=poolFor(names[4]);finalizer=poolFor(names[5]);
  const config=join(directory,'integration.json'); await writeFile(config,JSON.stringify({blobsDirectory:join(directory,'bound-blobs')}),{mode:0o600});
  process.env.ORGMAP_INTEGRATION_CONFIG=config;
  const bindClient=await source.connect(); try {await installHostStorageBinding(ledger,lease,bindClient,config);} finally {bindClient.release();}
  const childUrl=new URL(runtime);childUrl.pathname='/'+database;
  const childResult=await new Promise<{code:number|null;output:string}>((resolve,reject)=>{
   const child=spawn(process.execPath,['--import','tsx','tests/server/fixtures/managed-writer-http-child.ts'],{env:{...process.env,DATABASE_URL:childUrl.href,ORGMAP_TEST_LEDGER:join(directory,'ledger'),ORGMAP_TEST_HOST_TOKEN:lease!.token},stdio:['ignore','pipe','pipe']});
   let output='';child.stdout.on('data',chunk=>{output+=chunk.toString();});child.stderr.on('data',chunk=>{output+=chunk.toString();});
   child.once('error',reject);child.once('close',code=>resolve({code,output}));
  });
  assert.equal(childResult.code,0,childResult.output);
  const httpProof=JSON.parse(childResult.output.trim());
  assert.equal(httpProof.allowedStatus,201);assert.notEqual(httpProof.deniedStatus,201);assert.equal(httpProof.countsPreservedBeforeJoin,true);
  const account=randomUUID(),org=randomUUID(),other=randomUUID(),member=randomUUID(),otherMember=randomUUID(),session=randomUUID(),token=randomUUID(),password=`Synthetic-${randomUUID()}`;
  await source.query("INSERT INTO accounts(id,email,display_name,password_hash) VALUES($1,$2,'Fixture',$3)",[account,`${randomUUID()}@example.test`,await hashPassword(password)]);
  await source.query("INSERT INTO organizations(id,name,locale,time_zone) VALUES($1,'A','pt-BR','UTC'),($2,'B','pt-BR','UTC')",[org,other]);
  await source.query("INSERT INTO members(organization_id,id,account_id,org_role) VALUES($1,$2,$3,'OWNER'),($4,$5,$3,'OWNER')",[org,member,account,other,otherMember]);
  await source.query("INSERT INTO administration_assistant_personal(organization_id,member_id,account_id,revision,instructions) VALUES($1,$2,$3,1,'fixture')",[org,member,account]);
  await source.query("INSERT INTO sessions(token_hash,id,account_id,csrf,expires_at,auth_method) VALUES($1,$2,$3,'fixture',clock_timestamp()+interval '1 hour','PASSWORD')",[digest(token),session,account]);
  const federatedSession=randomUUID(), enrollment=randomUUID(), reauth=randomUUID();
  await source.query("INSERT INTO sessions(token_hash,id,account_id,csrf,expires_at,auth_method,auth_organization_id,auth_connection_id,auth_issuer,auth_subject) VALUES($1,$2,$3,'sso',clock_timestamp()+interval '1 hour','FEDERATED',$4,$5,'issuer','subject')",[digest(randomUUID()),federatedSession,account,org,randomUUID()]);
  await source.query("INSERT INTO provisioned_enrollments(organization_id,id,connection_id,external_id,user_name,email,display_name,issuer,claim_name,claim_value,mapping_revision,active,state,account_id,member_id,created_by) VALUES($1,$2,$3,'fixture','fixture','b@fixture.invalid','B','issuer','sub','b',1,true,'PENDING_ENROLLMENT',$4,$5,$4)",[other,enrollment,randomUUID(),account,otherMember]);
  await source.query("INSERT INTO provisioned_enrollment_reauth(organization_id,id,enrollment_id,enrollment_version,account_id,session_id,token_hash,expires_at,confirmed) VALUES($1,$2,$3,1,$4,$5,$6,clock_timestamp()+interval '1 hour',true)",[other,reauth,enrollment,account,federatedSession,digest(randomUUID())]);
  const blob=randomUUID(), bytes=await sharp({create:{width:8,height:8,channels:4,background:'#229988'}}).png().toBuffer(),sha=createHash('sha256').update(bytes).digest('hex');
  const storage=join(directory,'bound-blobs','organization-branding');await writeFile(join(storage,blob),bytes,{mode:0o600});
  await source.query("INSERT INTO administration_branding_assets(organization_id,purpose,revision,origin,asset_id,blob_key,sha256,size,mime,width,height) VALUES($1,'EMAIL_LOGO',1,'UPLOADED',$2,$3,$4,$5,'image/png',8,8)",[org,randomUUID(),blob,sha,bytes.length]);
  const connection=randomUUID(),delivery=randomUUID(),otherConnection=randomUUID(),otherDelivery=randomUUID();
  await source.query("INSERT INTO interop_connections(organization_id,id,provider,label) VALUES($1,$2,'LOCAL','fixture')",[org,connection]);
  await source.query("INSERT INTO interop_deliveries(organization_id,id,connection_id,event_id,payload,state) VALUES($1,$2,$3,'synthetic','{}','PENDING')",[org,delivery,connection]);
  await source.query("INSERT INTO interop_connections(organization_id,id,provider,label) VALUES($1,$2,'LOCAL','B')",[other,otherConnection]);
  await source.query("INSERT INTO interop_deliveries(organization_id,id,connection_id,event_id,payload,state) VALUES($1,$2,$3,'other','{\"data\":\"B\"}','PENDING')",[other,otherDelivery,otherConnection]);
  const unknownEffect=randomUUID();
  await source.query("INSERT INTO organization_effects(organization_id,id,owner,effect_key,lifecycle_fence,source_lease_token,effect_token) VALUES($1,$2,'INTEROP','synthetic:effect',1,$3,$4)",[org,unknownEffect,randomUUID(),randomUUID()]);
  const acceptInput={organizationId:org,sessionToken:token,csrfToken:'fixture',expectedVersion:1,confirmationName:'A',credentials:{currentPassword:password},idempotencyKey:randomUUID()};
  await assert.rejects(acceptOrganizationDeletion(acceptance,acceptInput,createRuntime(),createLifecycleAuthMethodsPort(()=>false)),/HOST_WRITER_REGISTRATION_REQUIRED/);
  assert.equal((await source.query("SELECT state FROM organization_lifecycle WHERE organization_id=$1",[org])).rows[0].state,'ACTIVE');
  const joinClient=await acceptance.connect();
  let activeWriter: Awaited<ReturnType<typeof enterManagedWriter>>;
  try {activeWriter=await enterManagedWriter({ledger,token:lease.token,client:joinClient});}
  finally {joinClient.release();}
  if (!activeWriter) throw Error('MANAGED_WRITER_JOIN_FAILED');
  let cut: Awaited<ReturnType<typeof acceptOrganizationDeletion>>;
  try { cut=await acceptOrganizationDeletion(acceptance,acceptInput,createRuntime(),createLifecycleAuthMethodsPort(()=>false)); }
  finally {await activeWriter.release();}
  const retained=(await source.query("SELECT auth_method,auth_organization_id,deletion_revoked_job_id,expires_at<=clock_timestamp() expired FROM sessions WHERE id=$1",[federatedSession])).rows[0];
  assert.equal(retained.auth_method,'FEDERATED'); assert.equal(retained.auth_organization_id,org); assert.equal(retained.deletion_revoked_job_id,cut.jobId); assert.equal(retained.expired,true);
  const ordinarySessionPool=new pg.Pool({connectionString:childUrl.href});
  try {
   await assert.rejects(ordinarySessionPool.query("UPDATE sessions SET expires_at=clock_timestamp()+interval '1 hour' WHERE id=$1",[federatedSession]),/SESSION_REVOCATION_IMMUTABLE/);
   assert.equal((await ordinarySessionPool.query("DELETE FROM sessions WHERE id=$1",[federatedSession])).rowCount,0);
  } finally {await ordinarySessionPool.end();}
  assert.equal((await source.query("SELECT session_id FROM provisioned_enrollment_reauth WHERE organization_id=$1 AND id=$2",[other,reauth])).rows[0].session_id,federatedSession);
  const confirmed=await confirmOrganizationLedger({ledger,lease,verifier:source,confirmation,organizationId:org,jobId:cut.jobId});
  assert.match(confirmed.recordSha256,/^[0-9a-f]{64}$/);
  const shortLease=await claimDeletionJob(drain,{organizationId:org,jobId:cut.jobId,fence:cut.fence,ttlSeconds:5});
  await withStoppedHostWriters(ledger,lease,async locked=>{
   const binding=await assertHostDatabaseBindingLocked(ledger,lease!,source!,locked);
   const snapshot=await locked.snapshot(),entry=snapshot.entries.find(item=>item.organizationId===org);
   assert.ok(entry);
   const c=await drain!.connect();
   try {
    await c.query('BEGIN');
    const receipt=(await c.query('SELECT orgmap_deletion_drain_observe($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS id',[org,cut.jobId,cut.fence,shortLease.token,binding.authorityId,binding.instanceId,binding.epoch,entry.fence,entry.acceptedAt,tombstoneSha256(entry),snapshot.sha256])).rows[0].id;
    await c.query("SELECT set_config('orgmap.deletion_drain_receipt',$1,true)",[receipt]);
    await c.query("SELECT foundation_teardown_batch($1,$2,$3,$4,'QUIESCE',NULL,1)",[org,cut.jobId,cut.fence,shortLease.token]);
    let expired=false;
    for(let n=0;n<150;n++) {
     expired=(await c.query('SELECT clock_timestamp() >= $1::timestamptz AS expired',[shortLease.leaseUntil])).rows[0].expired;
     if(expired) break;
     await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(expired,true,'lease must expire according to PostgreSQL clock');
    await assert.rejects(c.query('COMMIT'),/DELETION_MAINTENANCE_LEASE_INVALID/);
   } finally {await c.query('ROLLBACK').catch(()=>{});c.release();}
  });
  assert.equal((await source.query("SELECT count(*)::int n FROM organization_deletion_quiescence_attestations WHERE job_id=$1",[cut.jobId])).rows[0].n,0);
  const claimed=await claimDeletionJob(drain,{organizationId:org,jobId:cut.jobId,fence:cut.fence,ttlSeconds:60});
  const leaseToken=claimed.token;
  assert.match(leaseToken,/^[0-9a-f-]{36}$/);
  assert.equal(claimed.phase,'QUIESCE');
  const input={ledger,lease,operator:source,drain,organizationId:org,jobId:cut.jobId,fence:cut.fence,leaseToken,actorAccountId:account};
  const forged=await drain.connect();
  try {
   await forged.query("BEGIN");
   await forged.query("SELECT set_config('orgmap.deletion_drain_receipt',$1,true)",[randomUUID()]);
   await assert.rejects(forged.query("SELECT orgmap_deletion_quiescence_checkpoint($1,$2,$3,$4,'foundation',1)",[org,cut.jobId,cut.fence,leaseToken]),/DELETION_DRAIN_RECEIPT_INVALID/);
  } finally {await forged.query("ROLLBACK");forged.release();}
  assert.equal((await source.query("SELECT count(*)::int n FROM organization_deletion_progress WHERE job_id=$1",[cut.jobId])).rows[0].n,0);
  const writerClient=await source.connect();const writer=await joinOrganizationHostLease(ledger,lease.token,writerClient);writerClient.release();
  try {await assert.rejects(checkpointStoppedOrganizationQuiescenceAndInventory(input),/HOST_WRITERS_STILL_REGISTERED/);} finally {await writer.release();}
  await assert.rejects(checkpointStoppedOrganizationQuiescenceAndInventory({...input,actorAccountId:randomUUID()}),/DELETION_ACTOR_MISMATCH/);
  assert.equal((await source.query("SELECT count(*)::int n FROM organization_deletion_progress WHERE job_id=$1",[cut.jobId])).rows[0].n,0);
  assert.equal((await source.query("SELECT count(*)::int n FROM interoperability_deletion_outcomes WHERE job_id=$1",[cut.jobId])).rows[0].n,0);
  assert.equal((await source.query("SELECT phase FROM organization_deletion_jobs WHERE id=$1",[cut.jobId])).rows[0].phase,'QUIESCE');
  const result=await checkpointStoppedOrganizationQuiescenceAndInventory(input);
  const states=(await source.query("SELECT context_id,phase,done,drain_receipt_id FROM organization_deletion_progress WHERE job_id=$1 ORDER BY phase,context_id",[cut.jobId])).rows;
  assert.equal(states.length,18);
  assert.equal(states.filter(row=>row.phase==='QUIESCE'&&row.done&&row.drain_receipt_id===result.receiptId).length,9);
  assert.equal(states.filter(row=>row.phase==='INVENTORY'&&row.done).length,9);
  assert.equal((await source.query("SELECT phase FROM organization_deletion_jobs WHERE id=$1",[cut.jobId])).rows[0].phase,'INVENTORY');
  assert.equal((await source.query("SELECT count(*)::int n FROM organization_deletion_blobs WHERE job_id=$1 AND namespace='ORG_BRANDING' AND blob_key=$2 AND sha256=$3 AND size=$4",[cut.jobId,blob,sha,bytes.length])).rows[0].n,1);
  assert.equal((await source.query("SELECT classification FROM interoperability_deletion_outcomes WHERE job_id=$1 AND source_id=$2",[cut.jobId,delivery])).rows[0].classification,'NEVER_SENT');
  await assert.rejects(drain.query("SELECT orgmap_deletion_drain_assert($1,$2,$3,$4,$5)",[result.receiptId,org,cut.jobId,cut.fence,leaseToken]),/DELETION_DRAIN_RECEIPT_INVALID/);
  // Verify the installed reviewed pin and explicitly exercise its absence.
  const pinned=(await source.query('SELECT fingerprint,reviewed_snapshot_sha256 FROM organization_deletion_schema_baseline WHERE singleton')).rows[0];
  assert.ok(pinned);
  await source.query('DELETE FROM organization_deletion_schema_baseline WHERE singleton');
  const baselineClient=await drain.connect();
  let fixtureFingerprint:string;
  try {
   await baselineClient.query('BEGIN');await baselineClient.query('SELECT pg_advisory_xact_lock(730184)');
   fixtureFingerprint=(await baselineClient.query('SELECT orgmap_deletion_schema_fingerprint($1,$2,$3,$4) AS digest',[org,cut.jobId,cut.fence,leaseToken])).rows[0].digest;
   await assert.rejects(baselineClient.query('SELECT orgmap_deletion_assert_schema_current($1,$2,$3,$4)',[org,cut.jobId,cut.fence,leaseToken]),/DELETION_SCHEMA_ATTESTATION_REQUIRED/);
   await baselineClient.query('ROLLBACK');
  } finally {await baselineClient.query('ROLLBACK').catch(()=>{});baselineClient.release();await source.query('INSERT INTO organization_deletion_schema_baseline(singleton,fingerprint,reviewed_snapshot_sha256) VALUES(true,$1,$2)',[pinned.fingerprint,pinned.reviewed_snapshot_sha256]);}
  assert.match(fixtureFingerprint!,/^[a-f0-9]{64}$/);
  console.log('schema-fingerprint',fixtureFingerprint!);
  assert.equal(fixtureFingerprint!,pinned.fingerprint);
  const advanced=await advanceStoppedInventoryToPurge({ledger,lease,operator:source,drain,organizationId:org,jobId:cut.jobId,fence:cut.fence,leaseToken});
  assert.equal(advanced.phase,'PURGE'); assert.equal(advanced.fence,'3');
  await assert.rejects(drain.query("SELECT orgmap_deletion_read_progress($1,$2,$3,$4,'interoperability','PURGE')",[org,cut.jobId,cut.fence,leaseToken]),/LEASE_INVALID/);
  const purgeLease=await claimDeletionJob(drain,{organizationId:org,jobId:cut.jobId,fence:'3',ttlSeconds:60});
  const participant=createInteroperabilityTeardownParticipant(),op=await drain.connect();
  try {
   const context={c:op,organizationId:org,jobId:cut.jobId,lifecycleFence:'3',leaseToken:purgeLease.token,actorAccountId:account} as unknown as OrganizationDeletionContext;
   await assert.rejects(participant.runBatch(context,{phase:'PURGE',cursor:null,limit:1}),/DELETION_SCHEMA_LOCK_REQUIRED/);
   await source.query('ALTER TABLE work_settings ADD COLUMN fixture_pre_purge_drift text');
   await op.query('BEGIN');
   try {
    await op.query('SELECT pg_advisory_xact_lock(730184)');
    await assert.rejects(participant.runBatch(context,{phase:'PURGE',cursor:null,limit:1}),/DELETION_SCHEMA_ATTESTATION_REQUIRED/);
   } finally {await op.query('ROLLBACK');}
   assert.equal((await source.query('SELECT count(*)::int n FROM interop_deliveries WHERE organization_id=$1 AND id=$2',[org,delivery])).rows[0].n,1);
   await source.query('ALTER TABLE work_settings DROP COLUMN fixture_pre_purge_drift');
   let done=false;
   while(!done) {
    await op.query('BEGIN');
    try {
     await op.query('SELECT pg_advisory_xact_lock(730184)');
     const prev=(await op.query("SELECT orgmap_deletion_read_progress($1,$2,3,$3,'interoperability','PURGE') AS progress",[org,cut.jobId,purgeLease.token])).rows[0].progress;
     const ctx={c:op,organizationId:org,jobId:cut.jobId,lifecycleFence:'3',leaseToken:purgeLease.token,actorAccountId:account} as unknown as OrganizationDeletionContext;
     const batch=await participant.runBatch(ctx,{phase:'PURGE',cursor:prev.cursor,limit:1});
     await op.query("SELECT orgmap_deletion_checkpoint($1,$2,3,$3,'interoperability','PURGE',$4,$5,$6,$7,$8::jsonb,$9::jsonb)",[org,cut.jobId,purgeLease.token,prev.revision,prev.cursor,batch.nextCursor,batch.done,JSON.stringify(batch.counts),JSON.stringify(batch.blobReferences??[])]);
     await op.query('COMMIT');done=batch.done;
    } catch(error) {await op.query('ROLLBACK');throw error;}
   }
   const replay=await participant.runBatch({c:op,organizationId:org,jobId:cut.jobId,lifecycleFence:'3',leaseToken:purgeLease.token,actorAccountId:account} as unknown as OrganizationDeletionContext,{phase:'PURGE',cursor:null,limit:1});
   assert.equal(replay.done,true);
  } finally {op.release();}
  assert.equal((await source.query("SELECT count(*)::int n FROM interop_deliveries WHERE organization_id=$1",[org])).rows[0].n,0);
  assert.equal((await source.query("SELECT classification FROM interoperability_deletion_outcomes WHERE job_id=$1 AND source_id=$2",[cut.jobId,delivery])).rows[0].classification,'NEVER_SENT');
  assert.deepEqual((await source.query("SELECT payload FROM interop_deliveries WHERE organization_id=$1 AND id=$2",[other,otherDelivery])).rows[0].payload,{data:'B'});
  assert.equal((await source.query("SELECT count(*)::int n FROM accounts WHERE id=$1",[account])).rows[0].n,1);
  const auditFence='3',auditToken=purgeLease.token;
  const ordinaryUrl=new URL(runtime);ordinaryUrl.pathname='/'+database;
  const ordinary=new pg.Pool({connectionString:ordinaryUrl.href});
  try {
   await assert.rejects(ordinary.query("SELECT orgmap_deletion_schema_fingerprint($1,$2,$3,$4)",[org,cut.jobId,auditFence,auditToken]),/permission denied/);
   await assert.rejects(ordinary.query("SELECT orgmap_deletion_assert_tenant_owned_empty($1,$2,$3,$4)",[org,cut.jobId,auditFence,auditToken]),/permission denied/);
  } finally {await ordinary.end();}
  await assert.rejects(drain.query("SELECT orgmap_deletion_schema_fingerprint($1,$2,$3,$4)",[org,cut.jobId,auditFence,auditToken]),/DELETION_SCHEMA_LOCK_REQUIRED/);
  const inspectSchema=async (fn:'fingerprint'|'zero')=>{
   const c=await drain!.connect();
   try {await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(730184)');
    const value=(await c.query(fn==='fingerprint'?"SELECT orgmap_deletion_schema_fingerprint($1,$2,$3,$4) AS digest":"SELECT orgmap_deletion_assert_tenant_owned_empty($1,$2,$3,$4)",[org,cut.jobId,auditFence,auditToken])).rows[0]?.digest;
    await c.query('COMMIT');return value;
   } catch(error) {await c.query('ROLLBACK').catch(()=>{});throw error;} finally {c.release();}
  };
  const fingerprint=await inspectSchema('fingerprint');
  assert.match(fingerprint,/^[a-f0-9]{64}$/);
  assert.equal(fingerprint,fixtureFingerprint!);
  await assert.rejects(inspectSchema('zero'),/DELETION_TENANT_ROWS_REMAIN/);
  // Migrators use the same advisory transaction lock; DDL waits until the
  // fingerprint transaction commits, and its synthetic change is rolled back.
  const schemaGuard=await drain.connect(),ddlWriter=await source.connect();
  try {
   await schemaGuard.query('BEGIN');
   await schemaGuard.query('SELECT pg_advisory_xact_lock(730184)');
   await ddlWriter.query('BEGIN');
   const guardPid=(await schemaGuard.query('SELECT pg_backend_pid() pid')).rows[0].pid;
   const ddlPid=(await ddlWriter.query('SELECT pg_backend_pid() pid')).rows[0].pid;
   const waiting=ddlWriter.query('SELECT pg_advisory_xact_lock(730184)');void waiting.catch(()=>{});
   let blocked=false;
   for(let n=0;n<200;n++){
    blocked=(await source.query('SELECT $1::int = ANY(pg_blocking_pids($2::int)) AS blocked',[guardPid,ddlPid])).rows[0].blocked;
    if(blocked)break;await new Promise(resolve=>setTimeout(resolve,10));
   }
   assert.equal(blocked,true);
   assert.equal((await schemaGuard.query('SELECT orgmap_deletion_schema_fingerprint($1,$2,$3,$4) AS digest',[org,cut.jobId,auditFence,auditToken])).rows[0].digest,fingerprint);
   await schemaGuard.query('COMMIT');
   await waiting;
   await ddlWriter.query('ALTER TABLE work_settings ADD COLUMN fixture_locked_ddl text');
   await ddlWriter.query('ROLLBACK');
  } finally {await schemaGuard.query('ROLLBACK').catch(()=>{});await ddlWriter.query('ROLLBACK').catch(()=>{});schemaGuard.release();ddlWriter.release();}
  assert.equal(await inspectSchema('fingerprint'),fingerprint);
  await source.query("CREATE FUNCTION fixture_schema_drift() RETURNS integer LANGUAGE sql AS 'SELECT 1'");
  assert.notEqual(await inspectSchema('fingerprint'),fingerprint);
  await source.query("DROP FUNCTION fixture_schema_drift()");
  assert.equal(await inspectSchema('fingerprint'),fingerprint);
  await source.query("GRANT SELECT ON organization_deletion_schema_baseline TO orgmap_app");
  assert.notEqual(await inspectSchema('fingerprint'),fingerprint);
  await source.query("REVOKE SELECT ON organization_deletion_schema_baseline FROM orgmap_app");
  await source.query("ALTER TABLE meeting_statistics_observation DISABLE TRIGGER meeting_statistics_observation_immutable");
  assert.notEqual(await inspectSchema('fingerprint'),fingerprint);
  await source.query("ALTER TABLE meeting_statistics_observation ENABLE TRIGGER meeting_statistics_observation_immutable");
  assert.equal(await inspectSchema('fingerprint'),fingerprint);
  // A non-bypass definer cannot mistake FORCE-RLS-filtered Assistant rows for zero.
  assert.equal((await source.query("SELECT count(*)::int n FROM administration_assistant_personal WHERE organization_id=$1",[org])).rows[0].n,1);
  await source.query(`GRANT EXECUTE ON FUNCTION orgmap_deletion_require_schema_lock(),orgmap_assert_deletion_maintenance(uuid,uuid,bigint,uuid) TO "${names[3]}"`);
  await source.query(`ALTER FUNCTION orgmap_deletion_assert_tenant_owned_empty(uuid,uuid,bigint,uuid) OWNER TO "${names[3]}"`);
  await assert.rejects(inspectSchema('zero'),/DELETION_ZERO_VISIBILITY_REQUIRED/);
  await source.query("ALTER FUNCTION orgmap_deletion_assert_tenant_owned_empty(uuid,uuid,bigint,uuid) OWNER TO CURRENT_USER");
  await source.query(`REVOKE EXECUTE ON FUNCTION orgmap_deletion_require_schema_lock(),orgmap_assert_deletion_maintenance(uuid,uuid,bigint,uuid) FROM "${names[3]}"`);
  await source.query("ALTER FUNCTION orgmap_deletion_assert_tenant_owned_empty(uuid,uuid,bigint,uuid) OWNER TO orgmap_app");
  assert.notEqual(await inspectSchema('fingerprint'),fingerprint);
  await source.query("ALTER FUNCTION orgmap_deletion_assert_tenant_owned_empty(uuid,uuid,bigint,uuid) OWNER TO CURRENT_USER");
  assert.equal(await inspectSchema('fingerprint'),fingerprint);
  const fk=(await source.query("SELECT conname,pg_get_constraintdef(oid,true) AS definition FROM pg_constraint WHERE conrelid='work_sections'::regclass AND confrelid='work_projects'::regclass AND contype='f'")).rows[0];
  assert.ok(fk);
  const quoted='"'+String(fk.conname).replaceAll('"','""')+'"';
  await source.query(`ALTER TABLE work_sections DROP CONSTRAINT ${quoted}`);
  await source.query(`ALTER TABLE work_sections ADD CONSTRAINT ${quoted} FOREIGN KEY(organization_id,project_id) REFERENCES work_projects(organization_id,id) ON DELETE CASCADE`);
  assert.notEqual(await inspectSchema('fingerprint'),fingerprint);
  await source.query(`ALTER TABLE work_sections DROP CONSTRAINT ${quoted}`);
  await source.query(`ALTER TABLE work_sections ADD CONSTRAINT ${quoted} ${fk.definition}`);
  assert.equal(await inspectSchema('fingerprint'),fingerprint);
  const indexDefinition=(await source.query("SELECT pg_get_indexdef('organization_effects_no_unsafe_retry'::regclass) definition")).rows[0].definition;
  await source.query("DROP INDEX organization_effects_no_unsafe_retry");
  assert.notEqual(await inspectSchema('fingerprint'),fingerprint);
  await source.query("ALTER TABLE work_settings ADD COLUMN fixture_schema_drift text");
  const drift=await inspectSchema('fingerprint');
  assert.notEqual(drift,fingerprint);
  await source.query("ALTER TABLE work_settings DROP COLUMN fixture_schema_drift");
  await source.query(indexDefinition);
  assert.equal(await inspectSchema('fingerprint'),fingerprint);
  const purgeTarget={organizationId:org,jobId:cut.jobId,lifecycleFence:'3',leaseToken:purgeLease.token,actorAccountId:account};
  await assert.rejects(runPrivateDeletionPurgeBatch(drain,purgeTarget,'foundation',20),/DELETION_DEPENDENCY_INCOMPLETE/);
  // An operator-supplied checkpoint is not evidence that the owner is empty.
  await drain.query("SELECT orgmap_deletion_read_progress($1,$2,3,$3,'administration','PURGE')",[org,cut.jobId,purgeLease.token]);
  await source.query("UPDATE organization_deletion_progress SET done=true,cursor=NULL WHERE job_id=$1 AND context_id='administration' AND phase='PURGE'",[cut.jobId]);
  await assert.rejects(runPrivateDeletionPurgeBatch(drain,purgeTarget,'administration',20),/DELETION_OWNER_ROWS_REMAIN/);
  await source.query("UPDATE organization_deletion_progress SET done=false,cursor=NULL WHERE job_id=$1 AND context_id='administration' AND phase='PURGE'",[cut.jobId]);

  for (const owner of ['administration','platform','structure','governance','work','goals','meetings','interoperability','foundation']) {
   let done=false;
   for(let n=0;n<500 && !done;n++) done=(await runPrivateDeletionPurgeBatch(drain,purgeTarget,owner,20)).done;
   assert.equal(done,true,owner);
   assert.equal((await runPrivateDeletionPurgeBatch(drain,purgeTarget,owner,20)).done,true);
  }
  await inspectSchema('zero');
  const residualSession=randomUUID();
  await source.query("INSERT INTO sessions(token_hash,id,account_id,csrf,expires_at,auth_method,auth_organization_id) VALUES($1,$2,$3,'x',clock_timestamp()-interval '1 hour','LEGACY',$4)",[digest(randomUUID()),residualSession,account,org]);
  await assert.rejects(runPrivateDeletionPurgeBatch(drain,purgeTarget,'foundation',20),/FOUNDATION_SESSION_NOT_MINIMIZED/);
  await source.query('DELETE FROM sessions WHERE id=$1',[residualSession]);
  assert.equal((await runPrivateDeletionPurgeBatch(drain,purgeTarget,'foundation',20)).done,true);
  const bCreated={organization:{id:other,name:`B ${org}`,locale:'pt-BR',timeZone:'UTC',version:1,structureRevision:1,authorizationRevision:1},membership:{id:otherMember,orgRole:'OWNER'},rootCircle:{organizationId:other,id:randomUUID(),nodeId:randomUUID(),kind:'CIRCLE',parentId:null,parentCircleId:null,name:'B',purpose:null,purposeRich:null,archived:false,version:1}};
  const bAccepted={organizationId:other,membership:{organizationId:other,id:otherMember,accountId:account,orgRole:'OWNER',status:'ACTIVE',version:1,memberType:'HUMAN',suspensionOrigin:null}};
  for(const [key,value] of [['organization.create:b',bCreated],['invitation.accept:b',bAccepted],['organization.create:a',{organization:{id:org},deleted:true}],['invitation.accept:a',{organizationId:org,deleted:true}]] as const)
   assert.equal((await source.query('SELECT orgmap_tenant_command_shape_valid($1,$2,$3) valid',[account,key,value])).rows[0].valid,true,key);
  assert.notEqual((await source.query('SELECT orgmap_tenant_command_shape_valid($1,$2,$3) valid',[account,'organization.create:b',{...bCreated,rootCircle:{...bCreated.rootCircle,organizationId:org}}])).rows[0].valid,true);
  assert.notEqual((await source.query('SELECT orgmap_tenant_command_shape_valid($1,$2,$3) valid',[account,'invitation.accept:b',{...bAccepted,membership:{...bAccepted.membership,organizationId:org}}])).rows[0].valid,true);
  assert.notEqual((await source.query('SELECT orgmap_tenant_command_shape_valid($1,$2,$3) valid',[account,'organization.create:a',{organization:{id:org},deleted:true,extra:{organizationId:org}}])).rows[0].valid,true);
  await source.query("INSERT INTO account_commands(account_id,key,hash,result) VALUES($1,'organization.create:b',$2,$3),($1,'invitation.accept:b',$2,$4)",[account,'c'.repeat(64),bCreated,bAccepted]);
  assert.equal((await runPrivateDeletionPurgeBatch(drain,purgeTarget,'foundation',20)).done,true);
  assert.deepEqual((await source.query("SELECT result FROM account_commands WHERE account_id=$1 AND key='organization.create:b'",[account])).rows[0].result,bCreated);
  const preferenceResult={preferences:{accountId:account,locale:'pt-BR',timeZone:'UTC',dateFormat:'DD/MM/YYYY',theme:'dark',reducedMotion:false,version:2}};
  const profileResult={account:{id:account,email:'b@example.test',displayName:`Texto livre ${org}`,passwordEnabled:true,version:2}};
  const requestId=randomUUID(), assetId=randomUUID(), stamp='2026-10-30T12:00:00.000Z';
  const metadata=(state:string)=>({requestId,state,expiresAt:stamp});
  const media=(kind:'PHOTO'|'COVER',state:'ACTIVE'|'DELETED')=>({kind,state,version:2,assetId:state==='ACTIVE'?assetId:null,mime:state==='ACTIVE'?'image/png':null,width:state==='ACTIVE'?8:null,height:state==='ACTIVE'?8:null,size:state==='ACTIVE'?20:null,updatedAt:stamp,readUrl:state==='ACTIVE'?`/api/v1/account/media/${kind.toLowerCase()}`:null});
  const validCommands:[string,unknown][]=[
   ['account:PATCH:/api/v1/account:key:with:colon',profileResult],
   ['account:PATCH:/api/v1/account/preferences:key',preferenceResult],
   [`account:POST:/api/v1/auth/sessions/${randomUUID()}/revoke:key`,{revoked:true}],
   ['account:POST:/api/v1/auth/password:key',{passwordChanged:true,account:profileResult.account}],
   ['account:POST:/api/v1/auth/password/disable:key',{account:{...profileResult.account,passwordEnabled:false}}],
   ['account:POST:/api/v1/account/email-change/requests:key',metadata('PENDING_PROOF')],
   [`account:POST:/api/v1/account/email-change/requests/${requestId}/revoke:key`,metadata('REVOKED')],
   [`account:POST:/api/v1/account/email-change/requests/${requestId}/complete:key`,{...metadata('COMPLETED'),account:profileResult.account}],
   ...(['PHOTO','COVER'] as const).flatMap(kind=>(['POST','DELETE'] as const).map(method=>[`account-media:${method}:${kind}:key`,{media:media(kind,method==='POST'?'ACTIVE':'DELETED')}] as [string,unknown])),
  ];
  for(const [key,value] of validCommands) assert.equal((await source.query('SELECT orgmap_account_command_shape_valid($1,$2,$3) valid',[account,key,value])).rows[0].valid,true,key);
  assert.notEqual((await source.query('SELECT orgmap_account_command_shape_valid($1,$2,$3) valid',[account,`account:POST:/api/v1/account/email-change/requests/${requestId}/revoke:key`,{...metadata('REVOKED'),requestId:randomUUID()}])).rows[0].valid,true);
  assert.notEqual((await source.query('SELECT orgmap_account_command_shape_valid($1,$2,$3) valid',[account,'account-media:POST:PHOTO:key',{media:{...media('PHOTO','ACTIVE'),organizationId:org}}])).rows[0].valid,true);

  await source.query("INSERT INTO account_commands(account_id,key,hash,result) VALUES($1,'account:PATCH:/api/v1/account/preferences:b',$2,$3),($1,'account:PATCH:/api/v1/account:b',$2,$4)",[account,'b'.repeat(64),preferenceResult,profileResult]);
  assert.equal((await runPrivateDeletionPurgeBatch(drain,purgeTarget,'foundation',20)).done,true);
  assert.deepEqual((await source.query("SELECT result FROM account_commands WHERE account_id=$1 AND key='account:PATCH:/api/v1/account:b'",[account])).rows[0].result,profileResult);
  await source.query("UPDATE account_commands SET result=result || '{\"organizationId\":\"bad\"}'::jsonb WHERE account_id=$1 AND key='account:PATCH:/api/v1/account:b'",[account]);
  await assert.rejects(runPrivateDeletionPurgeBatch(drain,purgeTarget,'foundation',20),/FOUNDATION_ACCOUNT_COMMAND_PROOF_REQUIRED/);
  await source.query("UPDATE account_commands SET result=$2 WHERE account_id=$1 AND key='account:PATCH:/api/v1/account:b'",[account,profileResult]);
  await source.query("INSERT INTO account_commands(account_id,key,hash,result) VALUES($1,'account:future:fixture',$2,$3)",[account,'a'.repeat(64),{arbitraryTenantPayload:'unknown'}]);
  await assert.rejects(runPrivateDeletionPurgeBatch(drain,purgeTarget,'foundation',20),/FOUNDATION_ACCOUNT_COMMAND_PROOF_REQUIRED/);
  await source.query("DELETE FROM account_commands WHERE account_id=$1 AND key='account:future:fixture'",[account]);
  assert.equal((await runPrivateDeletionPurgeBatch(drain,purgeTarget,'foundation',20)).done,true);
  await advanceStoppedPurgeToBlobs({ledger,lease,operator:source,drain,organizationId:org,jobId:cut.jobId,fence:'3',leaseToken:purgeLease.token});
  assert.equal((await source.query('SELECT phase FROM organization_deletion_jobs WHERE id=$1',[cut.jobId])).rows[0].phase,'BLOBS');
  const removed=await removeOrganizationBlob({ledger,lease,verifier:source,maintenance:blobPool,organizationId:org,jobId:cut.jobId,fence:'3',leaseToken:purgeLease.token,namespace:'ORG_BRANDING',key:blob});
  assert.deepEqual(removed,{state:'REMOVED',backupCopies:'UNKNOWN'});
  await assert.rejects(readFile(join(storage,blob)),/ENOENT/);
  assert.deepEqual(await removeOrganizationBlob({ledger,lease,verifier:source,maintenance:blobPool,organizationId:org,jobId:cut.jobId,fence:'3',leaseToken:purgeLease.token,namespace:'ORG_BRANDING',key:blob}),removed);
  await assert.rejects(blobPool.query('SELECT orgmap_deletion_finalize($1,$2,3,$3,$4)',[org,cut.jobId,purgeLease.token,randomUUID()]),/permission denied/);
  // Exercise deferred finalization guard with real claim and PostgreSQL clock.
  await yieldDeletionJob(drain,purgeLease);
  const finalShort=await claimDeletionJob(drain,{organizationId:org,jobId:cut.jobId,fence:'3',ttlSeconds:5});
  await withStoppedHostWriters(ledger,lease,async locked=>{
   const verifier=await source!.connect(),c=await finalizer!.connect();
   try {
    const binding=await assertHostDatabaseBindingLocked(ledger,lease!,verifier,locked),snap=await locked.snapshot(),entry=snap.entries.find(x=>x.jobId===cut.jobId)!;
    await c.query('BEGIN');for(const lock of [730184,730409,730502])await c.query('SELECT pg_advisory_xact_lock($1)',[lock]);
    const receipt=(await c.query('SELECT orgmap_deletion_drain_observe($1,$2,3,$3,$4,$5,$6,$7,$8,$9,$10) id',[org,cut.jobId,finalShort.token,binding.authorityId,binding.instanceId,binding.epoch,entry.fence,entry.acceptedAt,tombstoneSha256(entry),snap.sha256])).rows[0].id;
    await c.query('SELECT orgmap_deletion_finalize($1,$2,3,$3,$4)',[org,cut.jobId,finalShort.token,receipt]);
    let expired=false;for(let n=0;n<150;n++){expired=(await c.query('SELECT clock_timestamp()>=$1::timestamptz expired',[finalShort.leaseUntil])).rows[0].expired;if(expired)break;await new Promise(resolve=>setTimeout(resolve,100));}
    assert.equal(expired,true);await assert.rejects(c.query('COMMIT'),/DELETION_FINALIZER_LEASE_EXPIRED/);
   } finally {await c.query('ROLLBACK').catch(()=>{});c.release();verifier.release();}
  });
  assert.equal((await source.query('SELECT phase FROM organization_deletion_jobs WHERE id=$1',[cut.jobId])).rows[0].phase,'BLOBS');
  const finalLease=await claimDeletionJob(drain,{organizationId:org,jobId:cut.jobId,fence:'3',ttlSeconds:60});
  const finalInput={ledger,lease,verifier:source,finalizer,organizationId:org,jobId:cut.jobId,fence:'3',leaseToken:finalLease.token};
  const sharedFile=randomUUID();
  await source.query("INSERT INTO platform_files(organization_id,id,resource_type,resource_id,owner_id,name,mime,size,sha256,state,blob_key) VALUES($1,$2,'test',$3,$4,'B','image/png',$5,$6,'READY',$7)",[other,sharedFile,randomUUID(),otherMember,bytes.length,sha,blob]);
  await assert.rejects(finalizeStoppedOrganization(finalInput),/DELETION_SHARED_BLOB_REFERENCE_REMAINS/);
  assert.equal((await source.query('SELECT count(*)::int n FROM platform_files WHERE organization_id=$1 AND id=$2',[other,sharedFile])).rows[0].n,1);
  await source.query('DELETE FROM platform_files WHERE organization_id=$1 AND id=$2',[other,sharedFile]);
  await writeFile(join(storage,blob),bytes,{mode:0o600});
  await assert.rejects(finalizeStoppedOrganization(finalInput),/DELETION_FINALIZER_LOCAL_OBJECT_PRESENT/);
  assert.equal((await source.query('SELECT phase FROM organization_deletion_jobs WHERE id=$1',[cut.jobId])).rows[0].phase,'BLOBS');
  await rm(join(storage,blob));
  const finalReceipt=await finalizeStoppedOrganization(finalInput);
  assert.equal(finalReceipt.primaryPurge,'COMPLETE');assert.equal(finalReceipt.localObjects,1);assert.equal(finalReceipt.localBytes,bytes.length);
  assert.equal(finalReceipt.remoteEffects,'UNKNOWN');assert.equal(finalReceipt.backupCopies,'UNKNOWN');
  assert.equal((await source.query('SELECT state FROM organization_effects WHERE organization_id=$1 AND id=$2',[org,unknownEffect])).rows[0].state,'OUTCOME_UNKNOWN');
  assert.ok(!JSON.stringify(finalReceipt).includes(blob));
  assert.equal((await source.query('SELECT state,fence FROM organization_lifecycle WHERE organization_id=$1',[org])).rows[0].state,'DELETED');
  assert.deepEqual(await finalizeStoppedOrganization({...finalInput,leaseToken:randomUUID()}),finalReceipt);


  assert.equal((await source.query("SELECT session_id FROM provisioned_enrollment_reauth WHERE organization_id=$1 AND id=$2",[other,reauth])).rows[0].session_id,federatedSession);
  assert.equal((await source.query("SELECT count(*)::int n FROM accounts WHERE id=$1",[account])).rows[0].n,1);
  assert.equal((await source.query("SELECT state FROM organization_lifecycle WHERE organization_id=$1",[other])).rows[0].state,'ACTIVE');
 } finally {
  if(previousConfiguration===undefined) delete process.env.ORGMAP_INTEGRATION_CONFIG; else process.env.ORGMAP_INTEGRATION_CONFIG=previousConfiguration;
  await acceptance?.end();await confirmation?.end();await drain?.end();await blobPool?.end();await finalizer?.end();await source?.end();await lease?.release();
  if(database){if(!/^orgmap_fresh_[a-f0-9]{32}$/.test(database))throw Error('UNEXPECTED_DATABASE');await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);}
  for(const role of made.reverse())await admin.query(`DROP ROLE "${role}"`);
  if(database) assert.equal((await admin.query("SELECT 1 FROM pg_database WHERE datname=$1",[database])).rowCount,0);
  assert.equal((await admin.query("SELECT 1 FROM pg_roles WHERE rolname=ANY($1::text[])",[names])).rowCount,0);
  console.log('composition-cleanup',JSON.stringify({database,roles:names,databaseRemoved:true,rolesRemoved:true}));
  await admin.end();await rm(directory,{recursive:true,force:true});
 }
});
