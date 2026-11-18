import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { OrganizationLedger, tombstoneSha256 } from '../../server/ops/organization-ledger.js';
import { acquireOrganizationHostLease, provisionFreshHostBinding, withStoppedHostWriters } from '../../server/ops/organization-host-lease.js';
import { claimDeletionJob } from '../../server/ops/organization-deletion-jobs.js';

test('Interop drain retains minimal honest outcomes, including legacy and in-flight refresh',async()=>{
 const adminUrl=new URL(process.env.MIGRATION_DATABASE_URL??'postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap');
 const runtimeUrl=new URL(process.env.DATABASE_URL??'postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap');
 if(!['127.0.0.1','localhost','[::1]'].includes(adminUrl.hostname)||adminUrl.host!==runtimeUrl.host||adminUrl.pathname!==runtimeUrl.pathname)throw Error('MATCHING_LOCAL_DATABASE_SOURCES_REQUIRED');
 const dir=await mkdtemp(join(tmpdir(),'orgmap-interop-outcomes-')),ledger=await OrganizationLedger.initialize(join(dir,'ledger'));
 const admin=new pg.Pool({connectionString:adminUrl.href}),role='orgmap_interop_outcome_'+randomBytes(8).toString('hex'),password=randomBytes(32).toString('hex');
 let db='',roleCreated=false,lease:Awaited<ReturnType<typeof acquireOrganizationHostLease>>|undefined,source:pg.Pool|undefined,drain:pg.Pool|undefined,app:pg.Pool|undefined;
 try {
  lease=await acquireOrganizationHostLease(ledger);let bound;
  try{bound=await provisionFreshHostBinding(ledger,lease,adminUrl.href);db=bound.database;}catch(e){const m=e instanceof Error&&/^HOST_INSTALL_RECOVERY_REQUIRED:(orgmap_fresh_[a-f0-9]{32})$/.exec(e.message);if(m)db=m[1];throw e;}
  await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'`);roleCreated=true;
  await admin.query(`GRANT orgmap_lifecycle_maintenance,orgmap_lifecycle_drain TO "${role}"`);
  const u=new URL(adminUrl);u.pathname='/'+db;source=new pg.Pool({connectionString:u.href});
  const d=new URL(u);d.username=role;d.password=password;drain=new pg.Pool({connectionString:d.href});
  const au=new URL(runtimeUrl);au.pathname='/'+db;app=new pg.Pool({connectionString:au.href});
  const org=randomUUID(),other=randomUUID(),account=randomUUID(),member=randomUUID(),otherMember=randomUUID(),job=randomUUID(),connection=randomUUID(),otherConnection=randomUUID(),grant=randomUUID(),otherGrant=randomUUID();
  const never=randomUUID(),confirmed=randomUUID(),legacy=randomUUID(),otherDelivery=randomUUID(),intent=randomUUID(),acceptedAt=new Date().toISOString();
  const config=randomUUID(), project=randomUUID(),projectNever=randomUUID(),projectLegacy=randomUUID();
  await source.query("INSERT INTO accounts(id,email,display_name,password_hash) VALUES($1,$2,'Fixture','fixture')",[account,randomUUID()+'@example.test']);
  await source.query("INSERT INTO organizations(id,name,locale,time_zone) VALUES($1,'A','pt-BR','UTC'),($2,'B','pt-BR','UTC')",[org,other]);
  await source.query("INSERT INTO members(organization_id,id,account_id,org_role,status) VALUES($1,$2,$3,'OWNER','ACTIVE'),($4,$5,$3,'OWNER','ACTIVE')",[org,member,account,other,otherMember]);
  await source.query("INSERT INTO interop_connections(organization_id,id,provider,label) VALUES($1,$2,'LOCAL','A'),($3,$4,'LOCAL','B'),($1,$5,'TRELLO','A grant'),($3,$6,'TRELLO','B grant')",[org,connection,other,otherConnection,grant,otherGrant]);
  await source.query("INSERT INTO interop_provider_grants(organization_id,id,owner_member_id,provider,state,access_encrypted,refresh_encrypted,refresh_lease,refresh_lease_until) VALUES($1,$2,$3,'TRELLO','AUTHORIZED','secret-A','refresh-A',$4,clock_timestamp()-interval '1 day'),($5,$6,$7,'TRELLO','AUTHORIZED','secret-B','refresh-B',$8,clock_timestamp()-interval '1 day')",[org,grant,member,randomUUID(),other,otherGrant,otherMember,randomUUID()]);
  await source.query("INSERT INTO interop_project_output_configs(organization_id,id,project_id,provider,connection_id,owner_member_id,board_id,list_id,enabled) VALUES($1,$2,$3,'TRELLO',$4,$5,'private-board','private-list',true)",[org,config,project,grant,member]);
  await source.query("INSERT INTO interop_project_output_deliveries(organization_id,id,config_id,config_revision,project_id,task_id,task_version,kind,owner_member_id,title,description_plain,occurred_at,state,marker,attempts,remote_id,remote_effect_possible) VALUES($1,$2,$3,1,$4,$5,1,'WORK_TASK_CREATED',$6,'private title','private text',now(),'PENDING',$7,0,NULL,false),($1,$8,$3,1,$4,$9,1,'WORK_TASK_CREATED',$6,'private legacy','private text',now(),'CONFIRMED',$10,1,'private remote',true)",[org,projectNever,config,project,randomUUID(),member,randomUUID(),projectLegacy,randomUUID(),randomUUID()]);
  await source.query("INSERT INTO interop_deliveries(organization_id,id,connection_id,event_id,payload,state,attempts,owner_member_id) VALUES($1,$2,$3,'never','{\"secret\":\"never\"}','PENDING',0,$4),($1,$5,$3,'confirmed','{\"secret\":\"confirmed\"}','DELIVERED',1,$4),($1,$6,$3,'legacy','{\"secret\":\"legacy\"}','DELIVERED',1,$4),($7,$8,$9,'other','{\"secret\":\"B\"}','PENDING',0,$10)",[org,never,connection,member,confirmed,legacy,other,otherDelivery,otherConnection,otherMember]);
  await source.query("INSERT INTO organization_effects(organization_id,id,owner,effect_key,lifecycle_fence,source_lease_token,effect_token) VALUES($1,$2,'INTEROP',$3,1,$4,$5)",[org,intent,'delivery:'+confirmed,randomUUID(),randomUUID()]);
  await source.query("UPDATE organization_effects SET state='CONFIRMED',completed_at=clock_timestamp() WHERE organization_id=$1 AND id=$2",[org,intent]);
  const c=await source.connect();try{await c.query('BEGIN');await c.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[org]);await c.query("UPDATE organization_lifecycle SET state='DELETION_PENDING',fence=2 WHERE organization_id=$1",[org]);await c.query('COMMIT');}finally{c.release();}
  const entry={organizationId:org,jobId:job,fence:'2',acceptedAt};await ledger.confirm(entry);const hash=tombstoneSha256(entry);
  await source.query("INSERT INTO organization_deletion_jobs(organization_id,id,initiator_account_id,request_key,request_hash,accepted_fence,lifecycle_fence,phase,ledger_state,ledger_authority_id,ledger_record_sha256,accepted_at) VALUES($1,$2,$3,'fixture',$4,2,2,'QUIESCE','CONFIRMED',$5,$6,$7)",[org,job,account,'a'.repeat(64),ledger.authorityId,hash,acceptedAt]);
  const token=(await claimDeletionJob(drain,{organizationId:org,jobId:job,fence:'2',ttlSeconds:300})).token;
  await assert.rejects(app.query('SELECT interoperability_deletion_prepare_refresh($1,$2,2,$3)',[org,job,token]),/permission denied/);
  await assert.rejects(drain.query('SELECT interoperability_deletion_prepare_refresh($1,$2,2,$3)',[org,job,randomUUID()]),/DELETION_MAINTENANCE_LEASE_INVALID/);
  const noProof=await drain.connect();try{await noProof.query('BEGIN');await noProof.query('SELECT interoperability_deletion_prepare_refresh($1,$2,2,$3)',[org,job,token]);await assert.rejects(noProof.query('COMMIT'),/INTEROP_REFRESH_DRAIN_RECEIPT_REQUIRED/);}finally{noProof.release();}
  assert.ok((await source.query('SELECT refresh_lease FROM interop_provider_grants WHERE organization_id=$1 AND id=$2',[org,grant])).rows[0].refresh_lease);
  const receipt=await withStoppedHostWriters(ledger,lease,async locked=>{
   const snapshot=await locked.snapshot(),c=await drain!.connect();
   try{await c.query('BEGIN');
    assert.equal((await c.query('SELECT interoperability_deletion_prepare_refresh($1,$2,2,$3) AS n',[org,job,token])).rows[0].n,1);
    await c.query("SELECT orgmap_deletion_drain_reconcile($1,$2,2,$3,'interop')",[org,job,token]);
    const r=(await c.query('SELECT orgmap_deletion_drain_observe($1,$2,2,$3,$4,$5,$6,2,$7,$8,$9) AS id',[org,job,token,ledger.authorityId,bound.binding.instanceId,bound.binding.epoch,acceptedAt,hash,snapshot.sha256])).rows[0].id;
    await assert.rejects(c.query('SELECT interoperability_deletion_outcomes_batch($1,$2,2,$3,$4,2)',[org,job,randomUUID(),r]),/DELETION_MAINTENANCE_LEASE_INVALID/);
    await c.query('ROLLBACK');
    await c.query('BEGIN');await c.query('SELECT interoperability_deletion_prepare_refresh($1,$2,2,$3)',[org,job,token]);await c.query("SELECT orgmap_deletion_drain_reconcile($1,$2,2,$3,'interop')",[org,job,token]);
    const rr=(await c.query('SELECT orgmap_deletion_drain_observe($1,$2,2,$3,$4,$5,$6,2,$7,$8,$9) AS id',[org,job,token,ledger.authorityId,bound.binding.instanceId,bound.binding.epoch,acceptedAt,hash,snapshot.sha256])).rows[0].id;
    const one=(await c.query('SELECT interoperability_deletion_outcomes_batch($1,$2,2,$3,$4,2) AS result',[org,job,token,rr])).rows[0].result;assert.equal(one.recorded,2);assert.equal(one.done,false);
    const two=(await c.query('SELECT interoperability_deletion_outcomes_batch($1,$2,2,$3,$4,2) AS result',[org,job,token,rr])).rows[0].result;assert.equal(two.recorded,2);assert.equal(two.done,false);
    const three=(await c.query('SELECT interoperability_deletion_outcomes_batch($1,$2,2,$3,$4,2) AS result',[org,job,token,rr])).rows[0].result;assert.equal(three.recorded,1);assert.equal(three.done,true);
    const replay=(await c.query('SELECT interoperability_deletion_outcomes_batch($1,$2,2,$3,$4,2) AS result',[org,job,token,rr])).rows[0].result;assert.equal(replay.recorded,0);assert.equal(replay.done,true);
    await c.query('COMMIT');return rr;
   }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
  });
  await assert.rejects(drain.query('SELECT interoperability_deletion_outcomes_batch($1,$2,2,$3,$4,2)',[org,job,token,receipt]),/DELETION_DRAIN_RECEIPT_INVALID/);
  const rows=(await source.query('SELECT * FROM interoperability_deletion_outcomes WHERE job_id=$1 ORDER BY source_id',[job])).rows;
  const disposition=(id:string)=>rows.find((r:any)=>r.source_id===id)?.classification;
  assert.equal(disposition(never),'NEVER_SENT');assert.equal(disposition(confirmed),'CONFIRMED');assert.equal(disposition(legacy),'OUTCOME_UNKNOWN');assert.equal(disposition(grant),'OUTCOME_UNKNOWN');
  assert.equal(disposition(projectNever),'NEVER_SENT');assert.equal(disposition(projectLegacy),'OUTCOME_UNKNOWN');
  assert.doesNotMatch(JSON.stringify(rows),/secret|refresh-A|event-a|payload/);
  const g=(await source.query('SELECT state,refresh_lease,access_encrypted,refresh_encrypted FROM interop_provider_grants WHERE organization_id=$1 AND id=$2',[org,grant])).rows[0];
  assert.equal(g.state,'REAUTHORIZATION_REQUIRED');assert.equal(g.refresh_lease,null);assert.equal(g.access_encrypted,null);assert.equal(g.refresh_encrypted,null);
  assert.ok((await source.query('SELECT refresh_lease FROM interop_provider_grants WHERE organization_id=$1 AND id=$2',[other,otherGrant])).rows[0].refresh_lease);
  assert.equal((await source.query('SELECT payload FROM interop_deliveries WHERE organization_id=$1 AND id=$2',[other,otherDelivery])).rows[0].payload.secret,'B');
 }finally{
  await app?.end();await drain?.end();await source?.end();await lease?.release();
  if(db){if(!/^orgmap_fresh_[a-f0-9]{32}$/.test(db))throw Error('UNEXPECTED_DATABASE');await admin.query(`DROP DATABASE "${db}"`);}
  if(roleCreated)await admin.query(`DROP ROLE "${role}"`);
  await admin.end();await rm(dir,{recursive:true,force:true});
 }
});
