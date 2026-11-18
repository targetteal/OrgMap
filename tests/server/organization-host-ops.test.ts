import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash,randomBytes} from 'node:crypto';
import {mkdtemp,mkdir,rm,readFile,writeFile,chmod,rename,open} from 'node:fs/promises';
import {tmpdir,hostname} from 'node:os';
import {join} from 'node:path';
import pg from 'pg';
import {spawn,type ChildProcess} from 'node:child_process';
import {OrganizationLedger} from '../../server/ops/organization-ledger.js';
import {acquireOrganizationHostLease,assertHostDatabaseBinding,provisionFreshHostBinding,reapStoppedHostWriters,listHostWriters,withStoppedHostWriters} from '../../server/ops/organization-host-lease.js';
import {createBackup,restoreBackup} from '../../server/ops/backup.js';
import {reconcileStoppedBrandingStages} from '../../server/ops/branding-stage-reconciliation.js';
import {createReservedBrandingStore} from '../../server/modules/administration/branding-storage.js';
import {createSessionRecord} from '../../server/src/sessions.js';
import {assertManagedWriter,enterManagedWriter} from '../../server/src/managed-writer.js';
import {installHostStorageBinding} from '../../server/ops/organization-storage-binding.js';
import {configureLocalDispatcher} from '../../server/src/dispatcher-config.js';
import {configureIamMail} from '../../server/iam-mail/config.js';
import {startSmtpSink} from '../../server/src/smtp.js';
import {createServer} from 'node:net';
import {listPlatformBackupReferences} from '../../server/modules/platform/backup.js';

test('real bound host excludes restore, restores tombstone and makes old instance fail binding',async()=>{
 const adminUrl=process.env.MIGRATION_DATABASE_URL??'postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap',runtimeUrl=process.env.DATABASE_URL??'postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap';
 const op=new URL(adminUrl),runtime=new URL(runtimeUrl);if(!['127.0.0.1','localhost','[::1]'].includes(op.hostname)||op.host!==runtime.host||op.pathname!==runtime.pathname)throw Error('MATCHING_LOCAL_DATABASE_SOURCES_REQUIRED');
 const receiptPath=join(tmpdir(),`orgmap-host-ops-receipt-${randomUUID()}.json`);
 const receipt: {version:1; state:'RUNNING'|'CLEANED'|'CLEANUP_INCOMPLETE'; databases:string[]; databasePlans:{name:string;state:'PLANNED'|'CREATED'}[]; roles:string[]; roleCandidates:string[]; processes:{kind:string;pid:number;reaped:boolean}[]; cleanup:{databases:'PENDING'|'ABSENT'|'REMAINS'|'UNKNOWN';roles:'PENDING'|'ABSENT'|'REMAINS'|'UNKNOWN';processes:'PENDING'|'REAPED'|'UNREAPED'}} = {version:1,state:'RUNNING',databases:[],databasePlans:[],roles:[],roleCandidates:[],processes:[],cleanup:{databases:'PENDING',roles:'PENDING',processes:'PENDING'}};
 const saveReceipt=async()=>{const temp=receiptPath+'.tmp';const file=await open(temp,'wx',0o600);try{await file.writeFile(JSON.stringify(receipt,null,2)+'\n');await file.sync();}finally{await file.close();}await rename(temp,receiptPath);const directory=await open(tmpdir(),'r');try{await directory.sync();}finally{await directory.close();}};
 const reservation=await open(receiptPath,'wx',0o600);await reservation.close();await saveReceipt();console.log(`Host-ops receipt: ${receiptPath}`);
 const recordDatabase=async(name:string)=>{if(name&&!receipt.databases.includes(name))receipt.databases.push(name);const item=receipt.databasePlans.find(x=>x.name===name);if(item)item.state='CREATED';else receipt.databasePlans.push({name,state:'CREATED'});await saveReceipt();};
 const databaseEvent=async(event:{name:string;state:'PLANNED'|'CREATED'})=>{if(!/^orgmap_(fresh|restore)_[a-f0-9]{32}$/.test(event.name))throw Error('UNEXPECTED_FIXTURE_DATABASE');if(event.state==='CREATED')return recordDatabase(event.name);if(receipt.databasePlans.some(x=>x.name===event.name))throw Error('DUPLICATE_FIXTURE_DATABASE_PLAN');receipt.databasePlans.push(event);await saveReceipt();};
 const recordRole=async(name:string)=>{if(!receipt.roles.includes(name)){receipt.roles.push(name);await saveReceipt();}};
 const recordProcess=async(kind:string,child:ChildProcess)=>{if(child.pid){receipt.processes.push({kind,pid:child.pid,reaped:false});await saveReceipt();}};
 const markReaped=(child:ChildProcess)=>{const item=receipt.processes.find(x=>x.pid===child.pid);if(item && (child.exitCode!==null||child.signalCode!==null))item.reaped=true;};
 const previousConfiguration=process.env.ORGMAP_INTEGRATION_CONFIG;
 const dir=await mkdtemp(join(tmpdir(),'orgmap-host-ops-')),ledger=await OrganizationLedger.initialize(join(dir,'ledger')),admin=new pg.Pool({connectionString:adminUrl});let sourceName='',restoredName='',cloneName='',writerPid=0;let writer:ChildProcess|undefined;let lease:Awaited<ReturnType<typeof acquireOrganizationHostLease>>|undefined;
 try {
   lease=await acquireOrganizationHostLease(ledger);let provisioned;try{provisioned=await provisionFreshHostBinding(ledger,lease,adminUrl,databaseEvent);}catch(e){const match=e instanceof Error&&/^HOST_INSTALL_RECOVERY_REQUIRED:(orgmap_fresh_[a-f0-9]{32})$/.exec(e.message);if(match){sourceName=match[1];await recordDatabase(sourceName);}throw e;}sourceName=provisioned.database;await recordDatabase(sourceName);assert.match(sourceName,/^orgmap_fresh_[a-f0-9]{32}$/);
   cloneName='orgmap_fresh_'+randomUUID().replaceAll('-','');
   await databaseEvent({name:cloneName,state:'PLANNED'});await admin.query(`CREATE DATABASE "${cloneName}" TEMPLATE "${sourceName}"`);await recordDatabase(cloneName);
   const cloneUrl=new URL(adminUrl);cloneUrl.pathname='/'+cloneName;const clone=new pg.Pool({connectionString:cloneUrl.href});
   try {const cloned=await clone.connect();try {
     await assert.rejects(assertHostDatabaseBinding(ledger,lease,cloned),/HOST_DATABASE_BINDING_MISMATCH/);
     await assert.rejects(enterManagedWriter({ledger,token:lease.token,client:cloned}),/HOST_DATABASE_BINDING_MISMATCH/);
   } finally {cloned.release();}} finally {await clone.end();}
   const sourceUrl=new URL(adminUrl);sourceUrl.pathname='/'+sourceName;const sourceRuntime=new URL(runtimeUrl);sourceRuntime.pathname='/'+sourceName;const source=new pg.Pool({connectionString:sourceUrl.href});
   try {const c=await source.connect();try {await assertHostDatabaseBinding(ledger,lease,c);
     const storageConfig=join(dir,'integration.json'),blobs=join(dir,'blobs');await writeFile(storageConfig,JSON.stringify({blobsDirectory:blobs}),{mode:0o600});process.env.ORGMAP_INTEGRATION_CONFIG=storageConfig;await installHostStorageBinding(ledger,lease,c,storageConfig);
     await assert.rejects(assertManagedWriter(c),/HOST_WRITER_REGISTRATION_REQUIRED/);
     const joined=await enterManagedWriter({ledger,token:lease.token,client:c});assert.ok(joined);
     await assertManagedWriter(c);const other=await source.connect();try{await assertManagedWriter(other);}finally{other.release();}
     const localRecord=(await listHostWriters(ledger,lease)).find(x=>x.pid===process.pid);assert.ok(localRecord);
     const recordPath=join(ledger.directory,'.host-lease',`writer-${localRecord.id}.json`);
     await chmod(recordPath,0o644);try{await assert.rejects(assertManagedWriter(c),/HOST_WRITER_REGISTRATION_REQUIRED/);}finally{await chmod(recordPath,0o600);}
     await assertManagedWriter(c);
     await joined.release();await assert.rejects(assertManagedWriter(c),/HOST_WRITER_REGISTRATION_REQUIRED/);
     const a=randomUUID(),b=randomUUID(),account=randomUUID();
     await c.query("INSERT INTO accounts(id,email,display_name,password_hash) VALUES($1,$2,'Fixture','fixture')",[account,randomUUID()+'@example.test']);
     await c.query("INSERT INTO organizations(id,name,locale,time_zone) VALUES($1,'A','pt-BR','America/Sao_Paulo'),($2,'B','pt-BR','America/Sao_Paulo')",[a,b]);
     await c.query("INSERT INTO members(organization_id,id,account_id,org_role,status) VALUES($1,$2,$3,'OWNER','ACTIVE'),($4,$5,$3,'OWNER','ACTIVE')",[a,randomUUID(),account,b,randomUUID()]);
     const session=await createSessionRecord(c,account,{method:'PASSWORD'});const brandRoot=join(blobs,'organization-branding');
     const sharp=(await import('sharp')).default;const image=await sharp({create:{width:32,height:24,channels:3,background:'red'}}).png().toBuffer();
     writer=spawn(process.execPath,['--import','tsx','tests/fixtures/branding-stage-writer.ts'],{env:{...process.env,DATABASE_URL:sourceRuntime.href,ORGMAP_LIFECYCLE_LEDGER_DIRECTORY:ledger.directory,ORGMAP_HOST_LEASE_TOKEN:lease.token},stdio:['ignore','pipe','pipe','ipc']});const childWriter=writer;writerPid=childWriter.pid??0;await recordProcess('branding-writer',childWriter);
     const written=await new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('WRITER_PROBE_TIMEOUT')),20000);childWriter.once('error',reject);childWriter.once('message',m=>{clearTimeout(timer);resolve(m);});childWriter.send({root:brandRoot,request:{method:'POST',url:`/api/v1/organizations/${a}/administration/branding-assets/email-logo`,headers:{origin:'http://localhost:5173',cookie:`orgmap_session=${session.token}`,'x-csrf-token':session.csrf,'idempotency-key':randomUUID(),'if-match':'\"0\"'},payload:{base64:image.toString('base64')}}});});
     assert.equal(written.state,'BYTES_WRITTEN');const stopped=new Promise<void>(resolve=>childWriter.once('exit',()=>resolve()));childWriter.kill('SIGKILL');await stopped;markReaped(childWriter);await saveReceipt();
     const absentId=randomUUID(),absentKey=randomUUID(),digest=createHash('sha256').update(image).digest('hex');
     await c.query(`INSERT INTO administration_branding_stages(id,organization_id,actor_id,credential_scope,purpose,request_key,request_hash,lifecycle_fence,base_revision,blob_key,sha256,size,width,height,write_token,writer_host,writer_pid,state) VALUES($1,$2,$3,'cookie','EMAIL_LOGO',$4,$5,1,0,$6,$7,$8,32,24,$9,$10,$11,'WRITING')`,[absentId,a,account,randomUUID(),'a'.repeat(64),absentKey,digest,image.length,randomUUID(),hostname(),writerPid]);
     const recovery={ledger,lease,operator:source,storage:createReservedBrandingStore(brandRoot),organizationId:a};
     await assert.rejects(reconcileStoppedBrandingStages(recovery),/HOST_WRITERS_STILL_REGISTERED/);await reapStoppedHostWriters(ledger,lease,[writerPid]);
     const reconciled=await reconcileStoppedBrandingStages(recovery);assert.equal(reconciled.retired,2);assert.equal(reconciled.remainingWriting,'0');assert.equal(reconciled.published,false);assert.equal(reconciled.bytesDeleted,false);assert.equal((await sharp(await readFile(join(brandRoot,written.key))).metadata()).format,'png');
     const stage=(await c.query('SELECT state FROM administration_branding_stages WHERE organization_id=$1',[a])).rows;assert.equal(stage.length,2);assert.ok(stage.every(r=>r.state==='ABANDONED'));
     // Run the actual API, dispatcher and IAM daemon as supervised writers.
     const suffix=randomBytes(8).toString('hex'),dispatchRole='orgmap_platform_dispatcher_local_'+suffix,iamRole='orgmap_iam_mail_local_'+suffix,children:ChildProcess[]=[];
     let sink:Awaited<ReturnType<typeof startSmtpSink>>|undefined;
     const preexisting=(await admin.query('SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])',[[dispatchRole,iamRole]])).rows;
     if(preexisting.length)throw Error('HOST_OPS_FIXTURE_ROLE_COLLISION');
     receipt.roleCandidates.push(dispatchRole,iamRole);await saveReceipt();
     try {
       const dispatchFile=join(dir,'dispatch.env'),iamFile=join(dir,'iam.env');await configureLocalDispatcher({adminUrl:sourceUrl.href,file:dispatchFile,role:dispatchRole});await recordRole(dispatchRole);await configureIamMail({adminUrl:sourceUrl.href,file:iamFile,role:iamRole});await recordRole(iamRole);
       sink=await startSmtpSink({port:0,directory:join(dir,'smtp')});const smtpPort=(sink.address() as any).port;
       const portServer=createServer();await new Promise<void>(resolve=>portServer.listen(0,'127.0.0.1',resolve));const apiPort=(portServer.address() as any).port;await new Promise<void>(resolve=>portServer.close(()=>resolve()));
       const config=join(dir,'integration.json');await writeFile(config,JSON.stringify({smtp:{port:smtpPort},blobsDirectory:blobs}),{mode:0o600});
       const env:NodeJS.ProcessEnv={...process.env,DATABASE_URL:sourceRuntime.href,ORGMAP_LIFECYCLE_LEDGER_DIRECTORY:ledger.directory,ORGMAP_HOST_LEASE_TOKEN:lease.token,ORGMAP_INTEGRATION_CONFIG:config,PORT:String(apiPort),SMTP_PORT:String(smtpPort),PLATFORM_DISPATCH_DATABASE_URL:(await readFile(dispatchFile,'utf8')).trim().slice('PLATFORM_DISPATCH_DATABASE_URL='.length),IAM_MAIL_ENV_FILE:iamFile};delete env.IAM_MAIL_DISPATCH_DATABASE_URL;
       for(const [kind,args] of [['api',['server/src/main.ts']],['dispatcher',['server/modules/platform/worker-cli.ts','server/modules/platform/composition.ts']],['iam-mail',['scripts/iam-mail.ts']]] as const){const child=spawn(process.execPath,['--import','tsx',...args],{env,stdio:['ignore','ignore','pipe']});children.push(child);await recordProcess(kind,child);}
       const deadline=Date.now()+30000;let ready=false;while(Date.now()<deadline){if(children.some(x=>x.exitCode!==null||x.signalCode!==null))throw Error('MANAGED_CHILD_EXITED');const registered=await listHostWriters(ledger,lease);if(children.every(x=>registered.some(w=>w.pid===x.pid))){try{if((await fetch(`http://127.0.0.1:${apiPort}/api/ready`,{signal:AbortSignal.timeout(1000)})).ok){ready=true;break;}}catch{}}await new Promise(resolve=>setTimeout(resolve,100));}assert.equal(ready,true,'managed writers did not all join');await assert.rejects(withStoppedHostWriters(ledger,lease,async()=>true),/WRITERS_STILL_REGISTERED/);
     } finally {
       for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
       await Promise.all(children.map(child=>new Promise<void>((resolve,reject)=>{if(child.exitCode!==null||child.signalCode!==null){resolve();return;}const kill=setTimeout(()=>child.kill('SIGKILL'),5000),deadline=setTimeout(()=>reject(Error('MANAGED_CHILD_NOT_STOPPED')),10000);child.once('exit',()=>{clearTimeout(kill);clearTimeout(deadline);resolve();});})));
       children.forEach(markReaped);await saveReceipt();
       await reapStoppedHostWriters(ledger,lease,children.flatMap(child=>child.pid?[child.pid]:[]));if(sink)await new Promise<void>(resolve=>sink!.close(()=>resolve()));
       for(const role of [dispatchRole,iamRole])if(receipt.roles.includes(role))await admin.query(`DROP ROLE IF EXISTS "${role}"`);
     }
     assert.equal((await listHostWriters(ledger,lease)).length,0);
     const bundle=join(dir,'bundle');
     // Backup is a managed writer operation; release the registration before testing the stopped-host restore barrier.
     const backupWriter=await enterManagedWriter({ledger,token:lease.token,client:c});assert.ok(backupWriter);
     try {await assertManagedWriter(c);await createBackup({adminUrl:sourceUrl.href,bundleDirectory:bundle,blobsDirectory:blobs,references:listPlatformBackupReferences,lifecycleLedgerDirectory:ledger.directory});}
     finally {await backupWriter.release();}
     await assert.rejects(assertManagedWriter(c),/HOST_WRITER_REGISTRATION_REQUIRED/);
     assert.equal((await listHostWriters(ledger,lease)).length,0);
     const restoreOptions={adminUrl:sourceUrl.href,runtimeUrl:sourceRuntime.href,bundleDirectory:bundle,references:listPlatformBackupReferences,lifecycleLedgerDirectory:ledger.directory,destinationDirectory:join(dir,'restore')};
     await assert.rejects(restoreBackup(restoreOptions),/HOST_LEASE_HELD_OR_RECOVERY_REQUIRED/);
     await c.query('BEGIN');await c.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[a]);await c.query("UPDATE organization_lifecycle SET state='DELETION_PENDING',fence=2 WHERE organization_id=$1",[a]);await c.query('COMMIT');await ledger.confirm({organizationId:a,jobId:randomUUID(),fence:'2',acceptedAt:new Date().toISOString()});
     await lease.release();lease=undefined;
     let restored:any;try{
      const cli=spawn(process.execPath,['--import','tsx','scripts/backup.ts','restore',bundle,restoreOptions.destinationDirectory],{env:{...process.env,MIGRATION_DATABASE_URL:sourceUrl.href,DATABASE_URL:sourceRuntime.href,ORGMAP_LIFECYCLE_LEDGER_DIRECTORY:ledger.directory,ORGMAP_TEST_RESOURCE_RECEIPTS:'1'},stdio:['ignore','pipe','pipe','ipc']});
      await recordProcess('restore-cli',cli);
      let stdout='',stderr='';cli.stdout!.on('data',chunk=>{stdout+=chunk;});cli.stderr!.on('data',chunk=>{stderr+=chunk;});
      cli.on('message',(value:unknown)=>{const msg=value as {type?:string;id?:string;name?:string;state?:'PLANNED'|'CREATED'};if(msg?.type!=='HOST_OPS_DATABASE'||typeof msg.id!=='string'||typeof msg.name!=='string'||!['PLANNED','CREATED'].includes(msg.state??''))return;
       void databaseEvent({name:msg.name,state:msg.state!}).then(()=>cli.send({id:msg.id,ok:true}),()=>cli.send({id:msg.id,ok:false}));});
      const code=await new Promise<number|null>((resolve,reject)=>{cli.once('error',reject);cli.once('close',resolve);});markReaped(cli);await saveReceipt();
      if(code!==0)throw Error(stderr);restored=JSON.parse(stdout.trim());
     }catch(e:any){const match=/HOST_BINDING_RECOVERY_REQUIRED:(orgmap_restore_[a-f0-9]{32})/.exec(String(e.stderr??e.message));if(match){restoredName=match[1];await recordDatabase(restoredName);}throw e;}restoredName=restored.restoredDatabase;await recordDatabase(restoredName);assert.equal(restored.readiness,'BOUND_HOST_NOT_RUNNING');assert.equal(restored.retained,true);
     const targetOp=new URL(sourceUrl.href),targetRuntime=new URL(sourceRuntime.href);targetOp.pathname='/'+restoredName;targetRuntime.pathname='/'+restoredName;await assert.rejects(restoreBackup({...restoreOptions,adminUrl:targetOp.href,runtimeUrl:targetRuntime.href}),/EEXIST/);
     const lease2=await acquireOrganizationHostLease(ledger);lease=lease2;await assert.rejects(assertHostDatabaseBinding(ledger,lease2,c),/HOST_DATABASE_BINDING_MISMATCH/);
     const restoredUrl=new URL(sourceUrl.href);restoredUrl.pathname='/'+restoredName;const rc=new pg.Client({connectionString:restoredUrl.href});await rc.connect();try{await assertHostDatabaseBinding(ledger,lease2,rc);const rows=(await rc.query('SELECT organization_id,state FROM organization_lifecycle WHERE organization_id=ANY($1::uuid[])',[[a,b]])).rows;assert.equal(rows.find(r=>r.organization_id===a).state,'DELETION_PENDING');assert.equal(rows.find(r=>r.organization_id===b).state,'ACTIVE');assert.equal((await rc.query('SELECT 1 FROM accounts WHERE id=$1',[account])).rowCount,1);
       process.env.ORGMAP_INTEGRATION_CONFIG=restored.storageConfigurationFile;const restoredWriter=await enterManagedWriter({ledger,lease:undefined,token:lease2.token,client:rc} as any);assert.ok(restoredWriter);await assertManagedWriter(rc);await restoredWriter.release();process.env.ORGMAP_INTEGRATION_CONFIG=storageConfig;
       await assert.rejects(reconcileStoppedBrandingStages({...recovery,lease:lease2}),/HOST_DATABASE_BINDING_MISMATCH/);
       const targetPool=new pg.Pool({connectionString:restoredUrl.href});try{const mismatchId=randomUUID(),mismatchKey=randomUUID();await writeFile(join(restored.brandingDirectory,mismatchKey),'unrelated');await rc.query(`INSERT INTO administration_branding_stages(id,organization_id,actor_id,credential_scope,purpose,request_key,request_hash,lifecycle_fence,base_revision,blob_key,sha256,size,width,height,write_token,writer_host,writer_pid,state) VALUES($1,$2,$3,'cookie','EMAIL_LOGO',$4,$5,1,0,$6,$7,$8,32,24,$9,$10,$11,'WRITING')`,[mismatchId,b,account,randomUUID(),'b'.repeat(64),mismatchKey,digest,image.length,randomUUID(),hostname(),writerPid]);const held=await reconcileStoppedBrandingStages({ledger,lease:lease2,operator:targetPool,storage:createReservedBrandingStore(restored.brandingDirectory),organizationId:b});assert.equal(held.held,1);assert.equal(held.retired,0);assert.equal(held.remainingWriting,'1');assert.equal(await readFile(join(restored.brandingDirectory,mismatchKey),'utf8'),'unrelated');}finally{await targetPool.end();}
       }finally{await rc.end();}
     await lease2.release();lease=undefined;
   }finally{c.release();}}finally{await source.end();}
 } finally {
   if(previousConfiguration===undefined)delete process.env.ORGMAP_INTEGRATION_CONFIG;else process.env.ORGMAP_INTEGRATION_CONFIG=previousConfiguration;
   if(writer && writer.exitCode===null && writer.signalCode===null){const stopped=new Promise<void>(resolve=>writer!.once('exit',()=>resolve()));writer.kill('SIGKILL');await stopped;markReaped(writer);await saveReceipt();}
   try {if(lease&&writerPid)await reapStoppedHostWriters(ledger,lease,[writerPid]);await lease?.release();}
   finally {
    try{for(const name of [...receipt.databases].reverse())if(name){if(!/^orgmap_(fresh|restore)_[a-f0-9]{32}$/.test(name))throw Error('UNEXPECTED_FIXTURE_DATABASE');await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);}}
    finally {
      try {
       const db=(await admin.query('SELECT datname FROM pg_database WHERE datname=ANY($1::text[])',[receipt.databasePlans.map(item=>item.name)])).rows;
       const roles=(await admin.query('SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])',[receipt.roleCandidates])).rows;
       receipt.cleanup.databases=db.length?'REMAINS':'ABSENT';receipt.cleanup.roles=roles.length?'REMAINS':'ABSENT';
      } catch {receipt.cleanup.databases='UNKNOWN';receipt.cleanup.roles='UNKNOWN';}
      receipt.cleanup.processes=receipt.processes.every(item=>item.reaped)?'REAPED':'UNREAPED';
      receipt.state=receipt.cleanup.databases==='ABSENT'&&receipt.cleanup.roles==='ABSENT'&&receipt.cleanup.processes==='REAPED'?'CLEANED':'CLEANUP_INCOMPLETE';
      try {await saveReceipt();} finally {await admin.end();await rm(dir,{recursive:true,force:true});}
    }
   }
 }
});
