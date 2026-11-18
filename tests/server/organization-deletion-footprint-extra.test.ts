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
import { claimDeletionJob } from '../../server/ops/organization-deletion-jobs.js';

test('attestation tracks unknown schemas, views, column ACL and rejects app membership',async()=>{
 const adminUrl=new URL(process.env.MIGRATION_DATABASE_URL??'postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap');
 const runtimeUrl=new URL(process.env.DATABASE_URL??'postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap');
 if(!['127.0.0.1','localhost','[::1]'].includes(adminUrl.hostname)||adminUrl.host!==runtimeUrl.host||adminUrl.pathname!==runtimeUrl.pathname)throw Error('MATCHING_LOCAL_DATABASE_SOURCES_REQUIRED');
 const dir=await mkdtemp(join(tmpdir(),'orgmap-footprint-extra-')),ledger=await OrganizationLedger.initialize(join(dir,'ledger'));
 const admin=new pg.Pool({connectionString:adminUrl.href}),suffix=randomBytes(8).toString('hex'),role='orgmap_fp_login_'+suffix,password=randomBytes(32).toString('hex');
 let db='',created=false,lease:Awaited<ReturnType<typeof acquireOrganizationHostLease>>|undefined,source:pg.Pool|undefined,worker:pg.Pool|undefined;
 try {
  lease=await acquireOrganizationHostLease(ledger);try{db=(await provisionFreshHostBinding(ledger,lease,adminUrl.href)).database;}catch(e){const m=e instanceof Error&&/^HOST_INSTALL_RECOVERY_REQUIRED:(orgmap_fresh_[a-f0-9]{32})$/.exec(e.message);if(m)db=m[1];throw e;}
  await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'`);created=true;
  console.log('footprint-fixture',JSON.stringify({database:db,role}));
  await admin.query(`GRANT orgmap_lifecycle_maintenance,orgmap_lifecycle_ledger_confirm TO "${role}"`);
  const u=new URL(adminUrl);u.pathname='/'+db;source=new pg.Pool({connectionString:u.href});const w=new URL(u);w.username=role;w.password=password;worker=new pg.Pool({connectionString:w.href});
  const org=randomUUID(),account=randomUUID(),job=randomUUID();
  await source.query("INSERT INTO accounts(id,email,display_name,password_hash) VALUES($1,$2,'Fixture','fixture')",[account,randomUUID()+'@example.test']);
  await source.query("INSERT INTO organizations(id,name,locale,time_zone) VALUES($1,'A','pt-BR','UTC')",[org]);
  const c=await source.connect();try{await c.query('BEGIN');await c.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[org]);await c.query("UPDATE organization_lifecycle SET state='DELETION_PENDING',fence=2 WHERE organization_id=$1",[org]);await c.query('COMMIT');}finally{c.release();}
  await source.query("INSERT INTO organization_deletion_jobs(organization_id,id,initiator_account_id,request_key,request_hash,accepted_fence,lifecycle_fence) VALUES($1,$2,$3,'fixture',$4,2,2)",[org,job,account,'a'.repeat(64)]);
  await confirmOrganizationLedger({ledger,lease,verifier:source,confirmation:worker,organizationId:org,jobId:job});
  const claim=await claimDeletionJob(worker,{organizationId:org,jobId:job,fence:'2',ttlSeconds:300});
  const digest=async()=>{const x=await worker!.connect();try{await x.query('BEGIN');await x.query('SELECT pg_advisory_xact_lock(730184)');const h=(await x.query('SELECT orgmap_deletion_schema_fingerprint($1,$2,2,$3) AS h',[org,job,claim.token])).rows[0].h;await x.query('COMMIT');return h as string;}catch(e){await x.query('ROLLBACK').catch(()=>{});throw e;}finally{x.release();}};
  const before=await digest();
  await source.query('CREATE VIEW fixture_footprint_view AS SELECT 1 AS value');assert.notEqual(await digest(),before);
  await source.query('DROP VIEW fixture_footprint_view');assert.equal(await digest(),before);
  await source.query('GRANT REFERENCES (key) ON TABLE administration_assistant_commands TO orgmap_app');assert.notEqual(await digest(),before);
  await source.query('REVOKE REFERENCES (key) ON TABLE administration_assistant_commands FROM orgmap_app');assert.equal(await digest(),before);
  await source.query('CREATE SCHEMA fixture_footprint_empty');assert.notEqual(await digest(),before,'empty unknown schema must change attestation');
  await source.query('DROP SCHEMA fixture_footprint_empty');assert.equal(await digest(),before);
  await admin.query(`GRANT orgmap_app TO "${role}"`);await assert.rejects(digest(),/DELETION_MAINTENANCE_AUTHORITY_REQUIRED/);
  await admin.query(`REVOKE orgmap_app FROM "${role}"`);assert.equal(await digest(),before);
 }finally{
  await worker?.end();await source?.end();await lease?.release();
  if(db){if(!/^orgmap_fresh_[a-f0-9]{32}$/.test(db))throw Error('UNEXPECTED_DATABASE');await admin.query(`DROP DATABASE "${db}"`);}
  if(created)await admin.query(`DROP ROLE "${role}"`);
  if(db)assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[db])).rowCount,0);
  if(created)assert.equal((await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount,0);
  console.log('footprint-cleanup',JSON.stringify({database:db,role,databaseRemoved:true,roleRemoved:true}));
  await admin.end();await rm(dir,{recursive:true,force:true});
 }
});
