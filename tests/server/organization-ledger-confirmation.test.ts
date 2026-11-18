import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import pg from 'pg';
import {OrganizationLedger,tombstoneSha256} from '../../server/ops/organization-ledger.js';
import {acquireOrganizationHostLease,provisionFreshHostBinding} from '../../server/ops/organization-host-lease.js';
import {confirmOrganizationLedger} from '../../server/ops/organization-ledger-confirmation.js';

test('confirmation appends before SQL, recovers after rollback, and binds the exact A/B record',async()=>{
 const adminUrl=new URL(process.env.MIGRATION_DATABASE_URL??'postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap');
 const runtimeUrl=new URL(process.env.DATABASE_URL??'postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap');
 if(!['127.0.0.1','localhost','[::1]'].includes(adminUrl.hostname)||adminUrl.host!==runtimeUrl.host||adminUrl.pathname!==runtimeUrl.pathname)throw Error('MATCHING_LOCAL_DATABASE_SOURCES_REQUIRED');
 const dir=await mkdtemp(join(tmpdir(),'orgmap-ledger-confirm-test-')),ledger=await OrganizationLedger.initialize(join(dir,'ledger'));
 const admin=new pg.Pool({connectionString:adminUrl.href}),lease=await acquireOrganizationHostLease(ledger);
 const prefix=`orgmap_it_${randomUUID().replaceAll('-','')}_`, role=prefix+randomUUID().replaceAll('-','').slice(0,16),password=randomUUID();
 let db='',createdRole=false,source:pg.Pool|undefined,confirmation:pg.Pool|undefined;
 try {
  try{db=(await provisionFreshHostBinding(ledger,lease,adminUrl.href)).database;}catch(e){const m=e instanceof Error&&/^HOST_INSTALL_RECOVERY_REQUIRED:(orgmap_fresh_[a-f0-9]{32})$/.exec(e.message);if(m)db=m[1];throw e;}
  assert.match(db,/^orgmap_fresh_[a-f0-9]{32}$/);const dbUrl=new URL(adminUrl);dbUrl.pathname='/'+db;source=new pg.Pool({connectionString:dbUrl.href});
  await admin.query(`CREATE ROLE "${role}" LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`);createdRole=true;
  await admin.query(`GRANT orgmap_lifecycle_ledger_confirm TO "${role}"`);const confirmUrl=new URL(dbUrl);confirmUrl.username=role;confirmUrl.password=password;confirmation=new pg.Pool({connectionString:confirmUrl.href});
  const account=randomUUID(),a=randomUUID(),b=randomUUID(),ja=randomUUID(),jb=randomUUID(),accepted='2026-10-30T12:34:56.123Z';
  await source.query("INSERT INTO accounts(id,email,display_name,password_hash) VALUES($1,$2,'fixture','hash')",[account,`${account}@example.invalid`]);
  for(const [org,job] of [[a,ja],[b,jb]]){
   await source.query("INSERT INTO organizations(id,name,locale,time_zone) VALUES($1,'fixture','pt-BR','UTC')",[org]);
   await source.query("UPDATE organization_lifecycle SET state='DELETION_PENDING',fence=2 WHERE organization_id=$1",[org]);
   await source.query("INSERT INTO organization_deletion_jobs(organization_id,id,initiator_account_id,request_key,request_hash,accepted_fence,lifecycle_fence,accepted_at) VALUES($1,$2,$3,'fixture',$4,2,2,$5)",[org,job,account,'a'.repeat(64),accepted]);
  }
  const args={ledger,lease,verifier:source,confirmation,organizationId:a,jobId:ja};
  await assert.rejects(confirmOrganizationLedger({...args,jobId:randomUUID()}),/LEDGER_CONFIRM_JOB_INVALID/);
  assert.equal((await ledger.snapshot()).entries.length,0);
  await source.query("ALTER TABLE organization_deletion_jobs ADD CONSTRAINT fixture_no_confirmation CHECK (ledger_state <> 'CONFIRMED')");
  await assert.rejects(confirmOrganizationLedger(args),/fixture_no_confirmation/);
  assert.equal((await ledger.snapshot()).entries.length,1);
  assert.equal((await source.query('SELECT ledger_state FROM organization_deletion_jobs WHERE organization_id=$1',[a])).rows[0].ledger_state,'PENDING');
  await source.query('ALTER TABLE organization_deletion_jobs DROP CONSTRAINT fixture_no_confirmation');
  const first=await confirmOrganizationLedger(args),retry=await confirmOrganizationLedger(args),other=await confirmOrganizationLedger({...args,organizationId:b,jobId:jb});
  assert.deepEqual(retry,first);assert.notEqual(first.recordSha256,other.recordSha256);
  const entries=(await ledger.snapshot()).entries;
  assert.equal(first.recordSha256,tombstoneSha256(entries.find(x=>x.organizationId===a)!));
  assert.equal(other.recordSha256,tombstoneSha256(entries.find(x=>x.organizationId===b)!));
  const rows=(await source.query('SELECT organization_id,ledger_state,ledger_authority_id,ledger_record_sha256 FROM organization_deletion_jobs ORDER BY organization_id')).rows;
  assert.equal(rows.length,2);assert.ok(rows.every(r=>r.ledger_state==='CONFIRMED'&&r.ledger_authority_id===ledger.authorityId));
  assert.equal(rows.find(r=>r.organization_id===a).ledger_record_sha256,first.recordSha256);
  await assert.rejects(confirmation.query('SELECT orgmap_ledger_confirmation_commit($1,$2,$3,3,$4,$5)',[a,ja,ledger.authorityId,accepted,first.recordSha256]),/LEDGER_CONFIRM_ENTRY_MISMATCH/);
  await assert.rejects(confirmation.query('SELECT orgmap_ledger_confirmation_commit($1,$2,$3,2,$4,$5)',[a,ja,ledger.authorityId,accepted,'b'.repeat(64)]),/LEDGER_CONFIRM_HASH_MISMATCH/);
 } finally {
  await confirmation?.end();await source?.end();await lease.release();
  if(createdRole)await admin.query(`DROP ROLE "${role}"`);
  if(db){if(!/^orgmap_fresh_[a-f0-9]{32}$/.test(db))throw Error('UNEXPECTED_FIXTURE_DATABASE');await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);}
  await admin.end();await rm(dir,{recursive:true,force:true});
 }
});
