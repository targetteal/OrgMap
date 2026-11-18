import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,randomBytes,createHash } from 'node:crypto';
import { mkdtemp,rm,writeFile } from 'node:fs/promises';
import { tmpdir,hostname } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { hashPassword } from '../../server/src/password.js';
import { digest } from '../../server/src/core.js';
import { enterManagedWriter } from '../../server/src/managed-writer.js';
import { createRuntime } from '../../server/src/runtime.js';
import { createLifecycleAuthMethodsPort } from '../../server/modules/interoperability/lifecycle.js';
import { acceptOrganizationDeletion } from '../../server/src/organization-deletion-acceptance.js';
import { OrganizationLedger } from '../../server/ops/organization-ledger.js';
import { acquireOrganizationHostLease,provisionFreshHostBinding } from '../../server/ops/organization-host-lease.js';
import { installHostStorageBinding } from '../../server/ops/organization-storage-binding.js';
import { confirmOrganizationLedger } from '../../server/ops/organization-ledger-confirmation.js';
import { claimDeletionJob,heartbeatDeletionJob } from '../../server/ops/organization-deletion-jobs.js';
import { checkpointStoppedOrganizationQuiescenceAndInventory,reconcileStoppedOrganizationEffects } from '../../server/ops/organization-deletion-barrier.js';
import { advanceStoppedInventoryToPurge,advanceStoppedPurgeToBlobs } from '../../server/ops/organization-deletion-transitions.js';

test('real cut and inventory seal advance only with bound fresh proof; BLOBS stays closed',async()=>{
 const migration=new URL(process.env.MIGRATION_DATABASE_URL??'postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap'),runtime=new URL(process.env.DATABASE_URL??'postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap');
 if(!['127.0.0.1','localhost','[::1]'].includes(migration.hostname)||migration.host!==runtime.host||migration.pathname!==runtime.pathname||migration.search!==runtime.search)throw Error('MATCHING_LOCAL_DATABASE_SOURCES_REQUIRED');
 const dir=await mkdtemp(join(tmpdir(),'orgmap-phase-transition-')),ledger=await OrganizationLedger.initialize(join(dir,'ledger')),admin=new pg.Pool({connectionString:migration.href});
 const suffix=randomBytes(8).toString('hex'),password=randomBytes(32).toString('hex'),roles=['accept','ledger','drain'].map(x=>`orgmap_phase_${suffix}_${x}`),made:string[]=[];
 const previousConfig=process.env.ORGMAP_INTEGRATION_CONFIG;
 let database='',clone='',lease:Awaited<ReturnType<typeof acquireOrganizationHostLease>>|undefined,source:pg.Pool|undefined,acceptance:pg.Pool|undefined,confirmation:pg.Pool|undefined,drain:pg.Pool|undefined,clonedDrain:pg.Pool|undefined;
 try{
  lease=await acquireOrganizationHostLease(ledger);try{database=(await provisionFreshHostBinding(ledger,lease,migration.href)).database;}catch(e){const m=e instanceof Error&&/^HOST_INSTALL_RECOVERY_REQUIRED:(orgmap_fresh_[a-f0-9]{32})$/.exec(e.message);if(m)database=m[1];throw new Error(`${String(e)} cause=${String(e instanceof Error?e.cause:'unknown')}`);}
  for(const role of roles){await admin.query(`CREATE ROLE "${role}" LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`);made.push(role);}
  await admin.query(`GRANT orgmap_app,orgmap_lifecycle_acceptance TO "${roles[0]}"`);
  await admin.query(`GRANT orgmap_lifecycle_ledger_confirm TO "${roles[1]}"`);
  await admin.query(`GRANT orgmap_lifecycle_maintenance,orgmap_lifecycle_drain TO "${roles[2]}"`);
  console.log('transition-fixture',JSON.stringify({database,roles}));
  const u=new URL(migration);u.pathname='/'+database;source=new pg.Pool({connectionString:u.href});
  const storageConfig=join(dir,'integration.json');await writeFile(storageConfig,JSON.stringify({blobsDirectory:join(dir,'blobs')}),{mode:0o600});
  process.env.ORGMAP_INTEGRATION_CONFIG=storageConfig;
  const setup=await source.connect();try{await installHostStorageBinding(ledger,lease,setup,storageConfig);}finally{setup.release();}
  const forRole=(role:string,db=database)=>{const v=new URL(u);v.pathname='/'+db;v.username=role;v.password=password;return new pg.Pool({connectionString:v.href});};
  acceptance=forRole(roles[0]);confirmation=forRole(roles[1]);drain=forRole(roles[2]);
  const account=randomUUID(),org=randomUUID(),other=randomUUID(),member=randomUUID(),otherMember=randomUUID(),session=randomUUID(),sessionToken=randomUUID(),loginPassword=`Synthetic-${randomUUID()}`;
  await source.query("INSERT INTO accounts(id,email,display_name,password_hash) VALUES($1,$2,'Fixture',$3)",[account,randomUUID()+'@example.test',await hashPassword(loginPassword)]);
  await source.query("INSERT INTO organizations(id,name,locale,time_zone) VALUES($1,'A','pt-BR','UTC'),($2,'B','pt-BR','UTC')",[org,other]);
  await source.query("INSERT INTO members(organization_id,id,account_id,org_role) VALUES($1,$2,$3,'OWNER'),($4,$5,$3,'OWNER')",[org,member,account,other,otherMember]);
  await source.query("INSERT INTO sessions(token_hash,id,account_id,csrf,expires_at,auth_method) VALUES($1,$2,$3,'fixture',clock_timestamp()+interval '1 hour','PASSWORD')",[digest(sessionToken),session,account]);
  const blob=randomUUID(),sha=createHash('sha256').update('fixture-byte').digest('hex');
  await source.query("INSERT INTO administration_branding_assets(organization_id,purpose,revision,origin,asset_id,blob_key,sha256,size,mime,width,height) VALUES($1,'EMAIL_LOGO',1,'UPLOADED',$2,$3,$4,12,'image/png',1,1)",[org,randomUUID(),blob,sha]);
  const joined=await acceptance.connect();let writer:Awaited<ReturnType<typeof enterManagedWriter>>;try{writer=await enterManagedWriter({ledger,token:lease.token,client:joined});}finally{joined.release();}
  if(!writer)throw Error('MANAGED_WRITER_JOIN_FAILED');let cut:Awaited<ReturnType<typeof acceptOrganizationDeletion>>;
  try{cut=await acceptOrganizationDeletion(acceptance,{organizationId:org,sessionToken,csrfToken:'fixture',expectedVersion:1,confirmationName:'A',credentials:{currentPassword:loginPassword},idempotencyKey:randomUUID()},createRuntime(),createLifecycleAuthMethodsPort(()=>false));}finally{await writer.release();}
  await confirmOrganizationLedger({ledger,lease,verifier:source,confirmation,organizationId:org,jobId:cut.jobId});
  const current=await claimDeletionJob(drain,{organizationId:org,jobId:cut.jobId,fence:cut.fence,ttlSeconds:300});
  const input={ledger,lease,operator:source,drain,organizationId:org,jobId:cut.jobId,fence:cut.fence,leaseToken:current.token};
  await checkpointStoppedOrganizationQuiescenceAndInventory({...input,actorAccountId:account});
  const originalPin=(await source.query('SELECT fingerprint,reviewed_snapshot_sha256 FROM organization_deletion_schema_baseline WHERE singleton')).rows[0];assert.ok(originalPin);
  await source.query('DELETE FROM organization_deletion_schema_baseline WHERE singleton');
  try {await assert.rejects(advanceStoppedInventoryToPurge(input),/DELETION_SCHEMA_ATTESTATION_REQUIRED/);}
  finally {await source.query('INSERT INTO organization_deletion_schema_baseline(singleton,fingerprint,reviewed_snapshot_sha256) VALUES(true,$1,$2)',[originalPin.fingerprint,originalPin.reviewed_snapshot_sha256]);}
  const pin=await drain.connect();let fp:string;try{await pin.query('BEGIN');await pin.query('SELECT pg_advisory_xact_lock(730184)');fp=(await pin.query('SELECT orgmap_deletion_schema_fingerprint($1,$2,$3,$4) AS value',[org,cut.jobId,cut.fence,current.token])).rows[0].value;await pin.query('COMMIT');}finally{pin.release();}
  // Verify the actual reviewed pin; never replace it with a fixture hash.
  assert.equal((await source.query("SELECT fingerprint FROM organization_deletion_schema_baseline WHERE singleton")).rows[0]?.fingerprint,fp!);
  await source.query("UPDATE organization_deletion_progress SET done=false WHERE job_id=$1 AND phase='INVENTORY' AND context_id='governance'",[cut.jobId]);
  await assert.rejects(advanceStoppedInventoryToPurge(input),/DELETION_INVENTORY_INCOMPLETE/);
  await source.query("UPDATE organization_deletion_progress SET done=true WHERE job_id=$1 AND phase='INVENTORY' AND context_id='governance'",[cut.jobId]);
  await source.query("UPDATE organization_deletion_progress SET done=false WHERE job_id=$1 AND phase='QUIESCE' AND context_id='meetings'",[cut.jobId]);
  await assert.rejects(advanceStoppedInventoryToPurge(input),/DELETION_QUIESCENCE_INCOMPLETE/);
  await source.query("UPDATE organization_deletion_progress SET done=true WHERE job_id=$1 AND phase='QUIESCE' AND context_id='meetings'",[cut.jobId]);
  const saved=(await source.query("DELETE FROM organization_deletion_blobs WHERE job_id=$1 AND blob_key=$2 RETURNING namespace,blob_key,sha256,size",[cut.jobId,blob])).rows[0];assert.ok(saved);
  await assert.rejects(advanceStoppedInventoryToPurge(input),/DELETION_INVENTORY_MANIFEST_MISMATCH/);
  await source.query('INSERT INTO organization_deletion_blobs(job_id,namespace,blob_key,sha256,size) VALUES($1,$2,$3,$4,$5)',[cut.jobId,saved.namespace,saved.blob_key,saved.sha256,saved.size]);
  await source.query('CREATE TABLE phase_fixture_unknown(id uuid)');await assert.rejects(advanceStoppedInventoryToPurge(input),/DELETION_TABLE_INVENTORY_MISMATCH/);await source.query('DROP TABLE phase_fixture_unknown');
  const stage=randomUUID();
  await source.query("INSERT INTO administration_branding_stages(id,organization_id,actor_id,credential_scope,purpose,request_key,request_hash,lifecycle_fence,base_revision,blob_key,sha256,size,width,height,write_token,writer_host,writer_pid,state) VALUES($1,$2,$3,'cookie','EMAIL_LOGO',$4,$5,1,0,$6,$5,1,1,1,$7,$8,$9,'WRITING')",[stage,org,account,randomUUID(),'b'.repeat(64),randomUUID(),randomUUID(),hostname(),process.pid]);
  await assert.rejects(advanceStoppedInventoryToPurge(input),/DELETION_DRAIN_BRANDING_WRITING/);
  await source.query('DELETE FROM administration_branding_stages WHERE id=$1',[stage]);
  assert.equal((await source.query('SELECT phase FROM organization_deletion_jobs WHERE id=$1',[cut.jobId])).rows[0].phase,'INVENTORY');
  // Clone has same binding identity but a different physical database. The
  // verifier remains bound to the original; the drain must be rejected before
  // any receipt or outcome can be written to either target.
  clone='orgmap_phase_clone_'+randomBytes(8).toString('hex');await admin.query(`CREATE DATABASE "${clone}"`);console.log('transition-clone',JSON.stringify({database:clone}));
  const cloneUrl=new URL(migration);cloneUrl.pathname='/'+clone;
  const cloneEnv:NodeJS.ProcessEnv={...process.env,MIGRATION_DATABASE_URL:cloneUrl.href};delete cloneEnv.MIGRATION_SCOPE;delete cloneEnv.MIGRATION_MAX_PREFIX;
  await new Promise<void>((resolve,reject)=>{const child=spawn(process.execPath,['--import','tsx','server/src/migrate.ts'],{env:cloneEnv,stdio:'inherit'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('CLONE_MIGRATION_FAILED')));});
  const cloneAdmin=new pg.Pool({connectionString:cloneUrl.href});try{const identity=(await source.query('SELECT authority_id,instance_id,epoch FROM organization_runtime_identity WHERE singleton')).rows[0];await cloneAdmin.query('INSERT INTO organization_runtime_identity(singleton,authority_id,instance_id,epoch) VALUES(true,$1,$2,$3)',[identity.authority_id,identity.instance_id,identity.epoch]);await cloneAdmin.query('UPDATE organization_runtime_mode SET managed=true WHERE singleton');}finally{await cloneAdmin.end();}
  clonedDrain=forRole(roles[2],clone);const before=(await source.query('SELECT count(*)::int AS n FROM organization_deletion_drain_receipts WHERE job_id=$1',[cut.jobId])).rows[0].n;
  await assert.rejects(reconcileStoppedOrganizationEffects({...input,drain:clonedDrain}),/DELETION_DRAIN_DATABASE_MISMATCH/);
  await assert.rejects(advanceStoppedInventoryToPurge({...input,drain:clonedDrain}),/DELETION_DRAIN_DATABASE_MISMATCH/);
  assert.equal((await source.query('SELECT count(*)::int AS n FROM organization_deletion_drain_receipts WHERE job_id=$1',[cut.jobId])).rows[0].n,before);
  const transition=await advanceStoppedInventoryToPurge(input);
  assert.equal(transition.phase,'PURGE');assert.equal(transition.fence,'3');assert.equal(transition.manifestCount,1);
  await assert.rejects(heartbeatDeletionJob(drain,current,60),/DELETION_MAINTENANCE_LEASE_INVALID/);
  const next=await claimDeletionJob(drain,{organizationId:org,jobId:cut.jobId,fence:'3',ttlSeconds:300});assert.notEqual(next.token,current.token);assert.equal(next.phase,'PURGE');
  await assert.rejects(advanceStoppedPurgeToBlobs({...input,fence:'3',leaseToken:next.token}),/DELETION_TENANT_ROWS_REMAIN|DELETION_SCHEMA_ATTESTATION_REQUIRED/);
  const final=(await source.query('SELECT phase,lifecycle_fence,inventory_manifest_sha256,inventory_manifest_count FROM organization_deletion_jobs WHERE id=$1',[cut.jobId])).rows[0];
  assert.equal(final.phase,'PURGE');assert.equal(String(final.lifecycle_fence),'3');assert.equal(final.inventory_manifest_sha256,transition.manifestSha256);
  assert.equal((await source.query('SELECT state FROM organization_lifecycle WHERE organization_id=$1',[other])).rows[0].state,'ACTIVE');assert.equal((await source.query('SELECT 1 FROM accounts WHERE id=$1',[account])).rowCount,1);
 }finally{
  await clonedDrain?.end();await drain?.end();await confirmation?.end();await acceptance?.end();await source?.end();await lease?.release();
  if(clone){if(!/^orgmap_phase_clone_[a-f0-9]{16}$/.test(clone))throw Error('UNEXPECTED_CLONE');await admin.query(`DROP DATABASE "${clone}"`);}
  if(database){if(!/^orgmap_fresh_[a-f0-9]{32}$/.test(database))throw Error('UNEXPECTED_DATABASE');await admin.query(`DROP DATABASE "${database}"`);}
  for(const role of made.reverse())await admin.query(`DROP ROLE "${role}"`);
  for(const name of [database,clone].filter(Boolean))assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount,0);
  assert.equal((await admin.query('SELECT 1 FROM pg_roles WHERE rolname=ANY($1::text[])',[roles])).rowCount,0);
  console.log('transition-cleanup',JSON.stringify({database,clone,roles,removed:true}));await admin.end();await rm(dir,{recursive:true,force:true});
  if(previousConfig===undefined)delete process.env.ORGMAP_INTEGRATION_CONFIG;else process.env.ORGMAP_INTEGRATION_CONFIG=previousConfig;
 }
});
