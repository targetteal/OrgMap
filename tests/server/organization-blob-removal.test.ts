import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,rm,writeFile,readFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FilesystemBlobStore} from '../../server/modules/platform/blob.js';
const hash=(value:Buffer)=>createHash('sha256').update(value).digest('hex');

test('Platform checked store rejects collisions and only unlinks matching private files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'orgmap-blob-checked-'));const store=new FilesystemBlobStore(root),key=randomUUID(),data=Buffer.from('fixture-owned'),ref={key,sha256:hash(data),size:data.length};
 try {
  assert.equal(await store.inspectChecked(ref),'ABSENT');
  await writeFile(join(root,key),data,{mode:0o600});assert.equal(await store.inspectChecked(ref),'COMPLETE');
  await writeFile(join(root,key+'.staged'),Buffer.from('foreign'),{mode:0o600});
  assert.equal(await store.inspectChecked(ref),'MISMATCH');await assert.rejects(store.removeChecked(ref),/MISMATCH/);assert.deepEqual(await readFile(join(root,key)),data);
  await rm(join(root,key+'.staged'));await store.removeChecked(ref);assert.equal(await store.inspectChecked(ref),'ABSENT');
  await symlink(join(root,'missing'),join(root,key));await assert.rejects(store.removeChecked(ref));
 } finally {await rm(root,{recursive:true,force:true});}
});

test('host storage binding rejects changed roots and refuses an old nonempty store',async()=>{
 const {mkdir,rename}=await import('node:fs/promises');const {OrganizationLedger}=await import('../../server/ops/organization-ledger.js');
 const {acquireOrganizationHostLease}=await import('../../server/ops/organization-host-lease.js');
 const {installHostStorageBinding,assertHostStorageBindingLocked}=await import('../../server/ops/organization-storage-binding.js');
 const root=await mkdtemp(join(tmpdir(),'orgmap-storage-binding-'));const prior=process.env.ORGMAP_INTEGRATION_CONFIG;
 try {
  const ledger=await OrganizationLedger.initialize(join(root,'ledger')),lease=await acquireOrganizationHostLease(ledger),id=randomUUID(),tx=randomUUID(),dbName='orgmap_test_source';
  const identity={authorityId:ledger.authorityId,instanceId:id,epoch:'1'};
  const fingerprint=createHash('sha256').update(JSON.stringify([dbName,'127.0.0.1',55432])).digest('hex');
  await mkdir(join(ledger.directory,'.runtime-bindings'),{mode:0o700});await writeFile(join(ledger.directory,'.runtime-bindings',`commit-${tx}.json`),JSON.stringify({...identity,transactionId:tx,targetDatabase:dbName,targetFingerprint:fingerprint}),{mode:0o600});
  const db={async query(sql:string){if(sql.startsWith('SELECT current_database()'))return {rows:[{name:dbName,host:'127.0.0.1',port:55432}]};if(sql.startsWith('SELECT managed'))return {rows:[{managed:true}]};if(sql.startsWith('SELECT authority_id'))return {rows:[{authority_id:identity.authorityId,instance_id:id,epoch:'1'}]};throw Error('unexpected query');}} as any;
  const config=join(root,'config.json'),blobs=join(root,'blobs');await writeFile(config,JSON.stringify({blobsDirectory:blobs}),{mode:0o600});process.env.ORGMAP_INTEGRATION_CONFIG=config;
  await installHostStorageBinding(ledger,lease,db,config);
  await ledger.withExclusive(async locked=>{const bound=await assertHostStorageBindingLocked(ledger,lease,db,locked);assert.equal(bound.platform,await (await import('node:fs/promises')).realpath(blobs));});
  await rename(blobs,blobs+'-old');await mkdir(blobs,{mode:0o700});await mkdir(join(blobs,'organization-branding'),{mode:0o700});
  await assert.rejects(ledger.withExclusive(locked=>assertHostStorageBindingLocked(ledger,lease,db,locked)),/HOST_STORAGE_BINDING_MISMATCH/);
  await lease.release();
  const other=await OrganizationLedger.initialize(join(root,'ledger2')),lease2=await acquireOrganizationHostLease(other),otherId=randomUUID(),tx2=randomUUID();
  await mkdir(join(other.directory,'.runtime-bindings'),{mode:0o700});await writeFile(join(other.directory,'.runtime-bindings',`commit-${tx2}.json`),JSON.stringify({authorityId:other.authorityId,instanceId:otherId,epoch:'1',transactionId:tx2,targetDatabase:dbName,targetFingerprint:fingerprint}),{mode:0o600});
  const otherDb={async query(sql:string){if(sql.startsWith('SELECT current_database()'))return {rows:[{name:dbName,host:'127.0.0.1',port:55432}]};if(sql.startsWith('SELECT managed'))return {rows:[{managed:true}]};if(sql.startsWith('SELECT authority_id'))return {rows:[{authority_id:other.authorityId,instance_id:otherId,epoch:'1'}]};throw Error('unexpected query');}} as any;
  await writeFile(join(blobs,'foreign'),Buffer.from('preserve'),{mode:0o600});
  await assert.rejects(installHostStorageBinding(other,lease2,otherDb,config),/HOST_STORAGE_NOT_FRESH/);assert.equal(await readFile(join(blobs,'foreign'),'utf8'),'preserve');await lease2.release();
 }finally{if(prior===undefined)delete process.env.ORGMAP_INTEGRATION_CONFIG;else process.env.ORGMAP_INTEGRATION_CONFIG=prior;await rm(root,{recursive:true,force:true});}
});

test('private blob removal respects durable intent and B references in isolated managed DB',async()=>{
 const pg=(await import('pg')).default,{OrganizationLedger,tombstoneSha256}=await import('../../server/ops/organization-ledger.js');
 const {acquireOrganizationHostLease,provisionFreshHostBinding}=await import('../../server/ops/organization-host-lease.js');
 const {installHostStorageBinding}=await import('../../server/ops/organization-storage-binding.js');
 const {removeOrganizationBlob}=await import('../../server/ops/organization-blob-removal.js');
 const adminUrl=new URL(process.env.MIGRATION_DATABASE_URL??'postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap'),runtimeUrl=new URL(process.env.DATABASE_URL??'postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap');
 if(!['127.0.0.1','localhost','[::1]'].includes(adminUrl.hostname)||adminUrl.host!==runtimeUrl.host||adminUrl.pathname!==runtimeUrl.pathname)throw Error('MATCHING_LOCAL_DATABASE_SOURCES_REQUIRED');
 const root=await mkdtemp(join(tmpdir(),'orgmap-blob-removal-')),ledger=await OrganizationLedger.initialize(join(root,'ledger')),admin=new pg.Pool({connectionString:adminUrl.href});let lease:Awaited<ReturnType<typeof acquireOrganizationHostLease>>|undefined=await acquireOrganizationHostLease(ledger);
 const previous=process.env.ORGMAP_INTEGRATION_CONFIG,role='orgmap_blob_test_'+randomUUID().replaceAll('-','').slice(0,16),password=randomUUID();
 let db='',madeRole=false,source:InstanceType<typeof pg.Pool>|undefined,maintenance:InstanceType<typeof pg.Pool>|undefined;
 try {
  try{db=(await provisionFreshHostBinding(ledger,lease,adminUrl.href)).database;}catch(e){const m=e instanceof Error&&/^HOST_INSTALL_RECOVERY_REQUIRED:(orgmap_fresh_[a-f0-9]{32})$/.exec(e.message);if(m)db=m[1];throw e;}
  console.log(`Blob removal fixture database: ${db}; role: ${role}`);
  const url=new URL(adminUrl);url.pathname='/'+db;source=new pg.Pool({connectionString:url.href});
  const config=join(root,'config.json'),blobs=join(root,'blobs');await writeFile(config,JSON.stringify({blobsDirectory:blobs}),{mode:0o600});process.env.ORGMAP_INTEGRATION_CONFIG=config;
  const install=await source.connect();try{await installHostStorageBinding(ledger,lease,install,config);}finally{install.release();}
  await admin.query(`CREATE ROLE "${role}" LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`);madeRole=true;await admin.query(`GRANT orgmap_lifecycle_maintenance,orgmap_lifecycle_blob TO "${role}"`);
  const limited=new URL(url);limited.username=role;limited.password=password;maintenance=new pg.Pool({connectionString:limited.href});
  const a=randomUUID(),b=randomUUID(),account=randomUUID(),member=randomUUID(),job=randomUUID(),token=randomUUID(),accepted='2026-10-30T12:34:56.123Z';
  const entry={organizationId:a,jobId:job,fence:'2',acceptedAt:accepted},digest=tombstoneSha256(entry);await ledger.confirm(entry);
  await source.query("INSERT INTO accounts(id,email,display_name,password_hash) VALUES($1,$2,'fixture','hash')",[account,`${account}@fixture.invalid`]);
  for(const org of [a,b])await source.query("INSERT INTO organizations(id,name,locale,time_zone) VALUES($1,'fixture','pt-BR','UTC')",[org]);
  await source.query("INSERT INTO members(organization_id,id,account_id,org_role) VALUES($1,$2,$3,'OWNER')",[b,member,account]);
  await source.query("UPDATE organization_lifecycle SET state='DELETION_PENDING',fence=2 WHERE organization_id=$1",[a]);await source.query("UPDATE organization_lifecycle SET state='PURGING',fence=3 WHERE organization_id=$1",[a]);
  // Fixture-only BLOBS state: production transition/zero are not yet enabled.
  await source.query("INSERT INTO organization_deletion_jobs(organization_id,id,initiator_account_id,request_key,request_hash,accepted_fence,lifecycle_fence,state,phase,ledger_state,ledger_authority_id,ledger_record_sha256,lease_token,lease_fence,lease_until,accepted_at) VALUES($1,$2,$3,'fixture',$4,2,3,'RUNNING','BLOBS','CONFIRMED',$5,$6,$7,3,now()+interval '5 minutes',$8)",[a,job,account,'a'.repeat(64),ledger.authorityId,digest,token,accepted]);
  for(const owner of ['administration','platform','structure','governance','work','goals','meetings','interoperability','foundation'])await source.query("INSERT INTO organization_deletion_progress(job_id,context_id,phase,done) VALUES($1,$2,'PURGE',true)",[job,owner]);
  const mc=await maintenance.connect();let fingerprint:string;try{await mc.query('BEGIN');await mc.query('SELECT pg_advisory_xact_lock(730184)');fingerprint=(await mc.query('SELECT orgmap_deletion_schema_fingerprint($1,$2,3,$3) AS f',[a,job,token])).rows[0].f;await mc.query('ROLLBACK');}finally{mc.release();}
  // Preserve and verify the reviewed pin installed by migration.
  assert.equal((await source.query("SELECT fingerprint FROM organization_deletion_schema_baseline WHERE singleton")).rows[0]?.fingerprint,fingerprint!);
  const payload=Buffer.from('owned-A'),shared=Buffer.from('shared-B'),one=randomUUID(),two=randomUUID(),missing=randomUUID(),mismatch=randomUUID(),accountKey=randomUUID();
  const entries=[[one,payload],[two,shared],[missing,payload],[mismatch,payload],[accountKey,payload]] as const;
  for(const [key,bytes] of entries)await source.query("INSERT INTO organization_deletion_blobs(job_id,namespace,blob_key,sha256,size) VALUES($1,'PLATFORM',$2,$3,$4)",[job,key,hash(bytes),bytes.length]);
  await writeFile(join(blobs,one),payload,{mode:0o600});await writeFile(join(blobs,two),shared,{mode:0o600});await writeFile(join(blobs,mismatch),Buffer.from('foreign'),{mode:0o600});await writeFile(join(blobs,accountKey),payload,{mode:0o600});
  await source.query("INSERT INTO account_media(account_id,kind,version,state,asset_id,storage_namespace,blob_key,sha256,size,mime,width,height) VALUES($1,'PHOTO',1,'ACTIVE',$2,'account-assets',$3,$4,$5,'image/png',1,1)",[account,randomUUID(),accountKey,hash(payload),payload.length]);
  await source.query("INSERT INTO platform_files(organization_id,id,resource_type,resource_id,owner_id,name,mime,size,sha256,state,blob_key) VALUES($1,$2,'TASK',$3,$4,'B','text/plain',$5,$6,'READY',$7)",[b,randomUUID(),randomUUID(),member,shared.length,hash(shared),two]);
  const base={ledger,lease,verifier:source,maintenance,organizationId:a,jobId:job,fence:'3',leaseToken:token,namespace:'PLATFORM' as const};
  assert.equal((await removeOrganizationBlob({...base,key:two})).state,'HELD');assert.equal(await readFile(join(blobs,two),'utf8'),'shared-B');
  assert.equal((await removeOrganizationBlob({...base,key:accountKey})).state,'HELD');assert.deepEqual(await readFile(join(blobs,accountKey)),payload);
  assert.equal((await removeOrganizationBlob({...base,key:missing})).state,'HELD');
  assert.equal((await removeOrganizationBlob({...base,key:mismatch})).state,'HELD');assert.equal(await readFile(join(blobs,mismatch),'utf8'),'foreign');
  assert.equal((await removeOrganizationBlob({...base,key:one})).state,'REMOVED');await assert.rejects(readFile(join(blobs,one)),{code:'ENOENT'});
  assert.equal((await removeOrganizationBlob({...base,key:one})).state,'REMOVED');
  const crashKey=randomUUID();await source.query("INSERT INTO organization_deletion_blobs(job_id,namespace,blob_key,sha256,size) VALUES($1,'PLATFORM',$2,$3,$4)",[job,crashKey,hash(payload),payload.length]);await writeFile(join(blobs,crashKey),payload,{mode:0o600});
  await lease.release();lease=undefined;
  const {spawn}=await import('node:child_process');const {recoverAbandonedLedgerLock}=await import('../../server/ops/organization-ledger.js');const {recoverAbandonedHostLease}=await import('../../server/ops/organization-host-lease.js');
  const child=spawn(process.execPath,['--import','tsx','tests/fixtures/organization-blob-kill-writer.ts'],{env:{...process.env,ORGMAP_INTEGRATION_CONFIG:config},stdio:['ignore','ignore','pipe','ipc']});
  console.log(`Blob removal crash fixture child PID: ${child.pid}`);
  let hostToken='';let notifyUnlink:()=>void=()=>{};let rejectUnlink:(e:Error)=>void=()=>{};
  const unlinkReached=new Promise<void>((resolve,reject)=>{notifyUnlink=resolve;rejectUnlink=reject;});
  child.on('message',(message:any)=>{if(message?.type==='LEASE')hostToken=message.token;if(message?.type==='UNLINK_DONE')notifyUnlink();if(message?.type==='ERROR')rejectUnlink(Error(message.message));});
  child.once('error',rejectUnlink);child.once('exit',()=>rejectUnlink(Error('BLOB_CHILD_EXITED_BEFORE_UNLINK')));const unlinkTimer=setTimeout(()=>rejectUnlink(Error('BLOB_CHILD_UNLINK_TIMEOUT')),20000);child.send({ledgerDirectory:ledger.directory,verifierUrl:url.href,maintenanceUrl:limited.href,target:{organizationId:a,jobId:job,fence:'3',leaseToken:token,namespace:'PLATFORM',key:crashKey}});
  try {
   await unlinkReached;clearTimeout(unlinkTimer);assert.ok(hostToken);await assert.rejects(readFile(join(blobs,crashKey)),{code:'ENOENT'});
   const held=(await source.query('SELECT state FROM organization_blob_removal_intents WHERE job_id=$1 AND blob_key=$2',[job,crashKey])).rows[0];assert.equal(held.state,'PREPARED');
   const owner=JSON.parse(await readFile(join(ledger.directory,'.operation-lock','owner.json'),'utf8'));
   await assert.rejects(recoverAbandonedLedgerLock(ledger,owner.token,child.pid!),/LIFECYCLE_LEDGER_HOLDER_ALIVE/);
   const rival=await maintenance.connect();try{
    const rivalPid=(await rival.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const attempt=rival.query('SELECT orgmap_deletion_job_claim($1,$2,3,5)',[a,job]).then(()=>null,e=>e);
    let blocked=false;for(let i=0;i<200;i++){const wait=(await source.query('SELECT cardinality(pg_blocking_pids($1)) AS n',[rivalPid])).rows[0].n;if(wait>0){blocked=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}assert.equal(blocked,true,'claim did not wait for job lock');
    const stopped=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill('SIGKILL');await stopped;assert.match(String((await attempt)?.message),/DELETION_JOB_LEASE_HELD/);
   }finally{rival.release();}
   await recoverAbandonedLedgerLock(ledger,owner.token,child.pid!);await recoverAbandonedHostLease(ledger,hostToken);lease=await acquireOrganizationHostLease(ledger);
   await source.query("UPDATE organization_deletion_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[job]);
   const claimed=(await maintenance.query('SELECT orgmap_deletion_job_claim($1,$2,3,60) AS result',[a,job])).rows[0].result;
   assert.equal((await removeOrganizationBlob({...base,lease,leaseToken:claimed.leaseToken,key:crashKey})).state,'REMOVED');
  }finally{clearTimeout(unlinkTimer);if(child.exitCode===null&&child.signalCode===null){const ended=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill('SIGKILL');await ended;}}
  const rows=(await source.query('SELECT blob_key,state FROM organization_deletion_blobs WHERE job_id=$1',[job])).rows;
  assert.equal(rows.find((x:any)=>x.blob_key===one).state,'REMOVED');assert.equal(rows.find((x:any)=>x.blob_key===crashKey).state,'REMOVED');assert.ok(rows.filter((x:any)=>![one,crashKey].includes(x.blob_key)).every((x:any)=>x.state==='HELD'));
 }finally{
  if(previous===undefined)delete process.env.ORGMAP_INTEGRATION_CONFIG;else process.env.ORGMAP_INTEGRATION_CONFIG=previous;
  await maintenance?.end();await source?.end();await lease?.release();if(madeRole)await admin.query(`DROP ROLE "${role}"`);if(db){if(!/^orgmap_fresh_[a-f0-9]{32}$/.test(db))throw Error('UNEXPECTED_FIXTURE_DATABASE');await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);}await admin.end();await rm(root,{recursive:true,force:true});
 }
});
