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

test('reviewed baseline installs and readiness enforces private login and schema drift',async()=>{
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

  const acceptanceRole='orgmap_fp_accept_'+suffix;
  await admin.query(`CREATE ROLE "${acceptanceRole}" LOGIN PASSWORD '${password}'`);
  try {
   await admin.query(`GRANT orgmap_app,orgmap_lifecycle_acceptance TO "${acceptanceRole}"`);
   const au=new URL(u);au.username=acceptanceRole;au.password=password;
   const acceptance=new pg.Pool({connectionString:au.href});
   try {
    const ready=async()=>{const c=await acceptance.connect();try{await c.query('BEGIN ISOLATION LEVEL READ COMMITTED');await c.query('SELECT pg_advisory_xact_lock(730184)');const result=(await c.query('SELECT orgmap_deletion_preflight_schema_ready() AS ok')).rows[0].ok;await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}};
    const baseline=(await source.query('SELECT fingerprint,reviewed_snapshot_sha256 FROM organization_deletion_schema_baseline WHERE singleton')).rows[0];
    assert.deepEqual(baseline,{fingerprint:'3cad98db49494f4cf59ed4641cbb3da457fabb7eb93a240b3c4663892e9cd030',reviewed_snapshot_sha256:'124213c62b53f1680e064e3f5444b578a30a9378009ae50655300675e056a592'});
    const appUrl=new URL(u);appUrl.username='orgmap_app';appUrl.password='orgmap_app_local_only';
    const appPool=new pg.Pool({connectionString:appUrl.href});
    try{await assert.rejects(appPool.query('SELECT orgmap_deletion_preflight_schema_ready()'),/permission denied/);}finally{await appPool.end();}
    assert.equal(await ready(),true);
    const inherited=(await admin.query("SELECT rolinherit FROM pg_roles WHERE rolname='orgmap_lifecycle_blob'")).rows[0].rolinherit;
    await admin.query(`ALTER ROLE orgmap_lifecycle_blob ${inherited?'NOINHERIT':'INHERIT'}`);
    try {assert.equal(await ready(),false);} finally {await admin.query(`ALTER ROLE orgmap_lifecycle_blob ${inherited?'INHERIT':'NOINHERIT'}`);}
    assert.equal(await ready(),true);
    await admin.query('GRANT orgmap_lifecycle_blob TO orgmap_lifecycle_finalize');
    try {assert.equal(await ready(),false);} finally {await admin.query('REVOKE orgmap_lifecycle_blob FROM orgmap_lifecycle_finalize');}
    assert.equal(await ready(),true);
    for(const attribute of ['CREATEDB','CREATEROLE','REPLICATION']) {
     await admin.query(`ALTER ROLE "${acceptanceRole}" ${attribute}`);
     try {await assert.rejects(ready(),/DELETION_ACCEPTANCE_AUTHORITY_REQUIRED/);}
     finally {await admin.query(`ALTER ROLE "${acceptanceRole}" NO${attribute}`);}
     assert.equal(await ready(),true);
    }
   } finally {await acceptance.end();}
  } finally {await admin.query(`DROP ROLE "${acceptanceRole}"`);assert.equal((await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[acceptanceRole])).rowCount,0);console.log('readiness-role-cleanup',acceptanceRole);}

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
