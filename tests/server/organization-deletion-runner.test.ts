import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile,rm,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,spawnSync,type ChildProcess} from 'node:child_process';
import {createServer} from 'node:net';
import pg from 'pg';
import sharp from 'sharp';
import {hashPassword} from '../../server/src/password.js';
import {digest} from '../../server/src/core.js';
import {createRuntime} from '../../server/src/runtime.js';
import {enterManagedWriter} from '../../server/src/managed-writer.js';
import {createLifecycleAuthMethodsPort} from '../../server/modules/interoperability/lifecycle.js';
import {acceptOrganizationDeletion} from '../../server/src/organization-deletion-acceptance.js';
import {OrganizationLedger,recoverAbandonedLedgerLock} from '../../server/ops/organization-ledger.js';
import {acquireOrganizationHostLease,provisionFreshHostBinding,recoverAbandonedHostLease} from '../../server/ops/organization-host-lease.js';
import {installHostStorageBinding} from '../../server/ops/organization-storage-binding.js';
import {processStoppedOrganizationDeletion} from '../../server/ops/organization-deletion-runner.js';

// Stop the synthetic runner before killing it. A crash between mkdir(.operation-lock)
// and owner.json must remain unrecoverable; it is not a valid recovery fixture.
async function pauseRunnerOutsideLedgerLock(child:ChildProcess,ledgerDirectory:string){
 const lock=join(ledgerDirectory,'.operation-lock'),deadline=Date.now()+15000;
 while(Date.now()<deadline){
  if(child.exitCode!==null||child.signalCode!==null||!child.pid||!child.kill('SIGSTOP'))throw Error('RUNNER_FINISHED_BEFORE_SAFE_CRASH');
  let safe=false;
  try{
   let stopped=false;
   for(let n=0;n<100;n++){
    const status=spawnSync('ps',['-o','stat=','-p',String(child.pid)],{encoding:'utf8'});
    if(status.status===0&&/^T/.test(status.stdout.trim())){stopped=true;break;}
    await new Promise(resolve=>setTimeout(resolve,10));
   }
   if(!stopped)throw Error('RUNNER_STOP_NOT_OBSERVED');
   try{await lstat(lock);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;safe=true;return;}
  }finally{if(!safe&&child.exitCode===null&&child.signalCode===null)child.kill('SIGCONT');}
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 throw Error('SAFE_CRASH_POINT_NOT_REACHED');
}

test('real private runner processes accepted closure, preserves B and replays receipt',async()=>{
 const op=new URL(process.env.MIGRATION_DATABASE_URL??'postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap'),app=new URL(process.env.DATABASE_URL??'postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap');
 if(!['postgres:','postgresql:'].includes(op.protocol)||!['127.0.0.1','localhost','[::1]'].includes(op.hostname)||op.host!==app.host||op.pathname!==app.pathname||op.search!==app.search)throw Error('MATCHING_LOCAL_DATABASE_SOURCES_REQUIRED');
 const previous=process.env.ORGMAP_INTEGRATION_CONFIG,dir=await mkdtemp(join(tmpdir(),'orgmap-runner-')),ledger=await OrganizationLedger.initialize(join(dir,'ledger'));
 const admin=new pg.Pool({connectionString:op.href}),suffix=randomBytes(8).toString('hex'),password=randomBytes(32).toString('hex');
 const names=['accept','confirm','drain','blob','finalize'].map(x=>`orgmap_runner_${suffix}_${x}`),made:string[]=[];
 let database='',lease:Awaited<ReturnType<typeof acquireOrganizationHostLease>>|undefined,runnerChild:ChildProcess|undefined;
 let source:pg.Pool|undefined,acceptance:pg.Pool|undefined,confirmation:pg.Pool|undefined,drain:pg.Pool|undefined,blobPool:pg.Pool|undefined,finalizer:pg.Pool|undefined;
 try {
  lease=await acquireOrganizationHostLease(ledger);
  try {database=(await provisionFreshHostBinding(ledger,lease,op.href)).database;} catch(e){const m=e instanceof Error&&/^HOST_INSTALL_RECOVERY_REQUIRED:(orgmap_fresh_[a-f0-9]{32})$/.exec(e.message);if(m)database=m[1];throw e;}
  for(const role of names){await admin.query(`CREATE ROLE "${role}" LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`);made.push(role);}
  await admin.query(`GRANT orgmap_app,orgmap_lifecycle_acceptance TO "${names[0]}"`);
  await admin.query(`GRANT orgmap_lifecycle_ledger_confirm TO "${names[1]}"`);
  await admin.query(`GRANT orgmap_lifecycle_maintenance,orgmap_lifecycle_drain TO "${names[2]}"`);
  await admin.query(`GRANT orgmap_lifecycle_maintenance,orgmap_lifecycle_blob TO "${names[3]}"`);
  await admin.query(`GRANT orgmap_lifecycle_maintenance,orgmap_lifecycle_drain,orgmap_lifecycle_finalize TO "${names[4]}"`);
  console.log('runner-fixture',JSON.stringify({database,roles:names}));
  const db=new URL(op);db.pathname='/'+database;source=new pg.Pool({connectionString:db.href});
  const poolFor=(role:string)=>{const u=new URL(db);u.username=role;u.password=password;return new pg.Pool({connectionString:u.href});};
  acceptance=poolFor(names[0]);confirmation=poolFor(names[1]);drain=poolFor(names[2]);blobPool=poolFor(names[3]);finalizer=poolFor(names[4]);
  const config=join(dir,'config.json');await writeFile(config,JSON.stringify({blobsDirectory:join(dir,'blobs')}),{mode:0o600});process.env.ORGMAP_INTEGRATION_CONFIG=config;
  const bc=await source.connect();try{await installHostStorageBinding(ledger,lease,bc,config);}finally{bc.release();}
  // Verify the installed reviewed pin; never replace it with a measured value.
  const fingerprintClient=await source.connect();let fingerprint:string;
  try{await fingerprintClient.query('BEGIN');await fingerprintClient.query('SELECT pg_advisory_xact_lock(730184)');fingerprint=(await fingerprintClient.query('SELECT orgmap_deletion_schema_fingerprint_internal() digest')).rows[0].digest;await fingerprintClient.query('COMMIT');}finally{fingerprintClient.release();}
  assert.equal((await source.query("SELECT fingerprint FROM organization_deletion_schema_baseline WHERE singleton")).rows[0]?.fingerprint,fingerprint);
  const account=randomUUID(),org=randomUUID(),other=randomUUID(),member=randomUUID(),otherMember=randomUUID(),session=randomUUID(),token=randomUUID(),pw='Synthetic-'+randomUUID();
  await source.query("INSERT INTO accounts(id,email,display_name,password_hash) VALUES($1,$2,'Fixture',$3)",[account,`${randomUUID()}@example.test`,await hashPassword(pw)]);
  await source.query("INSERT INTO organizations(id,name,locale,time_zone) VALUES($1,'A','pt-BR','UTC'),($2,'B','pt-BR','UTC')",[org,other]);
  await source.query("INSERT INTO members(organization_id,id,account_id,org_role) VALUES($1,$2,$3,'OWNER'),($4,$5,$3,'OWNER')",[org,member,account,other,otherMember]);
  await source.query("INSERT INTO sessions(token_hash,id,account_id,csrf,expires_at,auth_method) VALUES($1,$2,$3,'fixture',clock_timestamp()+interval '1 hour','PASSWORD')",[digest(token),session,account]);
  const blob=randomUUID(),bytes=await sharp({create:{width:8,height:8,channels:4,background:'#229988'}}).png().toBuffer(),sha=createHash('sha256').update(bytes).digest('hex');
  const blobPath=join(dir,'blobs','organization-branding',blob);await writeFile(blobPath,bytes,{mode:0o600});
  await source.query("INSERT INTO administration_branding_assets(organization_id,purpose,revision,origin,asset_id,blob_key,sha256,size,mime,width,height) VALUES($1,'EMAIL_LOGO',1,'UPLOADED',$2,$3,$4,$5,'image/png',8,8)",[org,randomUUID(),blob,sha,bytes.length]);
  await source.query("INSERT INTO work_projects(organization_id,id,title,visibility,creator_id) SELECT $1,gen_random_uuid(),'Synthetic','PUBLIC',$2 FROM generate_series(1,12000)",[org,member]);
  const effect=randomUUID();await source.query("INSERT INTO organization_effects(organization_id,id,owner,effect_key,lifecycle_fence,source_lease_token,effect_token) VALUES($1,$2,'INTEROP','synthetic:effect',1,$3,$4)",[org,effect,randomUUID(),randomUUID()]);
  const joinClient=await acceptance.connect();let writer:Awaited<ReturnType<typeof enterManagedWriter>>;try{writer=await enterManagedWriter({ledger,token:lease.token,client:joinClient});}finally{joinClient.release();}assert.ok(writer);
  let cut:Awaited<ReturnType<typeof acceptOrganizationDeletion>>;try{cut=await acceptOrganizationDeletion(acceptance,{organizationId:org,sessionToken:token,csrfToken:'fixture',expectedVersion:1,confirmationName:'A',credentials:{currentPassword:pw},idempotencyKey:randomUUID()},createRuntime(),createLifecycleAuthMethodsPort(()=>false));}finally{await writer.release();}
  await lease.release();lease=undefined;
  const privateUrl=(role:string)=>{const u=new URL(db);u.username=role;u.password=password;return u.href;};
  const child=runnerChild=spawn(process.execPath,['--import','tsx','tests/server/fixtures/deletion-runner-child.ts'],{stdio:['ignore','pipe','pipe'],env:{...process.env,TEST_LEDGER_DIRECTORY:ledger.directory,TEST_VERIFIER_URL:db.href,TEST_DRAIN_URL:privateUrl(names[2]),TEST_CONFIRM_URL:privateUrl(names[1]),TEST_BLOB_URL:privateUrl(names[3]),TEST_FINALIZE_URL:privateUrl(names[4]),TEST_ORG_ID:org,TEST_JOB_ID:cut.jobId}});
  let childOutput='';child.stdout.on('data',x=>{childOutput+=x.toString();});child.stderr.on('data',x=>{childOutput+=x.toString();});
  let checkpoint:{cursor:string;revision:string}|undefined;
  const until=Date.now()+60000;
  while(Date.now()<until && child.exitCode===null && child.signalCode===null){
   const row=(await source.query("SELECT cursor,revision::text,done FROM organization_deletion_progress WHERE job_id=$1 AND context_id='work' AND phase='PURGE'",[cut.jobId])).rows[0];
   if(row && row.cursor!==null && !row.done){checkpoint=row;break;}await new Promise(resolve=>setTimeout(resolve,15));
  }
  assert.ok(checkpoint,`no resumable work checkpoint: ${childOutput}`);
  const hostOwner=JSON.parse(await readFile(join(ledger.directory,'.host-lease','owner.json'),'utf8'));
  assert.equal(hostOwner.pid,child.pid);
  await pauseRunnerOutsideLedgerLock(child,ledger.directory);
  const ended=new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('exit',()=>resolve());});
  child.kill('SIGKILL');await ended;
  try {const owner=JSON.parse(await readFile(join(ledger.directory,'.operation-lock','owner.json'),'utf8'));await recoverAbandonedLedgerLock(ledger,owner.token,owner.pid);}
  catch(e:any){if(e.code!=='ENOENT')throw e;}
  await recoverAbandonedHostLease(ledger,hostOwner.token);runnerChild=undefined;
  // The job lease is not forged or cleared: wait until the database says it expired.
  let expired=false;for(let n=0;n<400;n++){expired=(await source.query('SELECT lease_until IS NULL OR lease_until<=clock_timestamp() expired FROM organization_deletion_jobs WHERE id=$1',[cut.jobId])).rows[0].expired;if(expired)break;await new Promise(resolve=>setTimeout(resolve,100));}assert.equal(expired,true);
  const saved=(await source.query("SELECT cursor,revision::text,done FROM organization_deletion_progress WHERE job_id=$1 AND context_id='work' AND phase='PURGE'",[cut.jobId])).rows[0];assert.ok(saved&&!saved.done&&BigInt(saved.revision)>=BigInt(checkpoint.revision));
  lease=await acquireOrganizationHostLease(ledger);
  // The resumed run exercises crash recovery, not the minimum lease TTL. Finalization
  // can take longer than five seconds when the full integration suite loads PostgreSQL.
  const input={ledger,lease,verifier:source,maintenance:drain,drain,confirmation,blob:blobPool,finalizer,organizationId:org,jobId:cut.jobId,leaseTtlSeconds:60};
  const result=await processStoppedOrganizationDeletion(input);
  assert.equal(result.state,'COMPLETED');assert.equal(result.phase,'COMPLETED');
  const receipt=result.receipt as any;assert.equal(receipt.remoteEffects,'UNKNOWN');assert.equal(receipt.backupCopies,'UNKNOWN');assert.equal(receipt.localObjects,1);assert.equal(receipt.localBytes,bytes.length);assert.ok(!JSON.stringify(receipt).includes(blob));
  await assert.rejects(readFile(blobPath),/ENOENT/);
  assert.equal((await source.query('SELECT state FROM organization_effects WHERE organization_id=$1 AND id=$2',[org,effect])).rows[0].state,'OUTCOME_UNKNOWN');
  assert.equal((await source.query('SELECT state FROM organization_lifecycle WHERE organization_id=$1',[other])).rows[0].state,'ACTIVE');
  assert.equal((await source.query('SELECT count(*)::int n FROM members WHERE organization_id=$1 AND id=$2',[other,otherMember])).rows[0].n,1);
  assert.equal((await source.query('SELECT count(*)::int n FROM accounts WHERE id=$1',[account])).rows[0].n,1);
  assert.deepEqual(await processStoppedOrganizationDeletion(input),result);
  // Exercise the actual operator CLI on a completed job with the host lease released.
  await lease.release(); lease=undefined;
  const cliEnv:NodeJS.ProcessEnv={...process.env,ORGMAP_LIFECYCLE_LEDGER_DIRECTORY:ledger.directory,
   ORGMAP_DELETION_VERIFIER_URL:db.href,ORGMAP_DELETION_MAINTENANCE_URL:privateUrl(names[2]),ORGMAP_DELETION_DRAIN_URL:privateUrl(names[2]),
   ORGMAP_DELETION_CONFIRMATION_URL:privateUrl(names[1]),ORGMAP_DELETION_BLOB_URL:privateUrl(names[3]),ORGMAP_DELETION_FINALIZER_URL:privateUrl(names[4])};
  const cli=async(args:string[],env:NodeJS.ProcessEnv)=>new Promise<{code:number|null;stdout:string;stderr:string}>((resolve,reject)=>{
   const p=spawn(process.execPath,['--import','tsx','scripts/process-organization-deletion.ts',...args],{stdio:['ignore','pipe','pipe'],env});let stdout='',stderr='';p.stdout.on('data',x=>stdout+=x.toString());p.stderr.on('data',x=>stderr+=x.toString());p.once('error',reject);p.once('close',code=>resolve({code,stdout,stderr}));
  });
  const completed=await cli([org,cut.jobId],cliEnv);assert.equal(completed.code,0,completed.stderr);
  assert.deepEqual(JSON.parse(completed.stdout),result);assert.equal(completed.stderr,'');
  for(const secret of [password,pw,token,blob,sha])assert.ok(!completed.stdout.includes(secret));
  let connections=0;const trap=createServer(socket=>{connections++;socket.destroy();});
  await new Promise<void>(resolve=>trap.listen(0,'127.0.0.1',resolve));
  try{
   const port=(trap.address() as import('node:net').AddressInfo).port;
   const trapUrl=`postgres://user:sentinel-secret@127.0.0.1:${port}/fixture`;
   const cases:[string[],NodeJS.ProcessEnv][]=[
    [[org,cut.jobId],{...cliEnv,ORGMAP_DELETION_VERIFIER_URL:'postgres://user:sentinel-secret@remote.invalid/fixture'}],
    [[org,cut.jobId],{...cliEnv,ORGMAP_DELETION_VERIFIER_URL:trapUrl+'?host=remote.invalid'}],
    [[org,cut.jobId,'extra'],{...cliEnv,ORGMAP_DELETION_VERIFIER_URL:trapUrl}],
   ];
   for(const [args,env] of cases){const rejected=await cli(args,env);assert.notEqual(rejected.code,0);assert.equal(rejected.stdout,'');assert.deepEqual(JSON.parse(rejected.stderr),{code:'DELETION_SUPERVISOR_FAILED'});assert.ok(!rejected.stderr.includes('sentinel-secret'));assert.ok(!rejected.stderr.includes(' at '));}
   assert.equal(connections,0,'invalid inputs must not open a database connection');
  }finally{await new Promise<void>((resolve,reject)=>trap.close(error=>error?reject(error):resolve()));}

 } finally {
  if(runnerChild){
   if(runnerChild.exitCode===null&&runnerChild.signalCode===null){const ended=new Promise<void>(resolve=>runnerChild!.once('exit',()=>resolve()));runnerChild.kill('SIGKILL');await ended;}
   try{const owner=JSON.parse(await readFile(join(ledger.directory,'.operation-lock','owner.json'),'utf8'));await recoverAbandonedLedgerLock(ledger,owner.token,owner.pid);}catch(e:any){if(e.code!=='ENOENT')throw e;}
   try{const owner=JSON.parse(await readFile(join(ledger.directory,'.host-lease','owner.json'),'utf8'));await recoverAbandonedHostLease(ledger,owner.token);}catch(e:any){if(e.code!=='ENOENT')throw e;}
  }
  if(previous===undefined)delete process.env.ORGMAP_INTEGRATION_CONFIG;else process.env.ORGMAP_INTEGRATION_CONFIG=previous;
  await acceptance?.end();await confirmation?.end();await drain?.end();await blobPool?.end();await finalizer?.end();await source?.end();await lease?.release();
  if(database){if(!/^orgmap_fresh_[a-f0-9]{32}$/.test(database))throw Error('UNEXPECTED_DATABASE');await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);}
  for(const role of made.reverse())await admin.query(`DROP ROLE "${role}"`);
  if(database)assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rowCount,0);
  assert.equal((await admin.query('SELECT 1 FROM pg_roles WHERE rolname=ANY($1::text[])',[names])).rowCount,0);
  console.log('runner-cleanup',JSON.stringify({database,roles:names,databaseRemoved:true,rolesRemoved:true}));await admin.end();await rm(dir,{recursive:true,force:true});
 }
});
