import { test,after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fork,type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp,rm,access,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import pg from 'pg';
import sharp from 'sharp';
import { buildApp } from '../../server/src/app.js';
import { pool } from '../../server/src/db.js';
import { createBrandingServices } from '../../server/modules/administration/branding.js';
import { createBrandingDecoder,createBrandingStorage } from '../../server/modules/administration/branding-image.js';
import { lockActiveOrganization } from '../../server/src/organization-lifecycle.js';

if(!/^\/orgmap_integration_[a-f0-9]{32}$/.test(new URL(process.env.DATABASE_URL??'postgres://invalid/main').pathname))throw Error('EXCLUSIVE_INTEGRATION_TEST_DATABASE_REQUIRED');
after(async()=>{await pool.end();});
const barrier=()=>{let release!:()=>void;const promise=new Promise<void>(r=>release=r);return {promise,release};};

test('branding reserves ownership before bytes, fences publication after cutover and keeps uncertain writes out of GC',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orgmap-branding-stages-'));
  const admin=new pg.Pool({connectionString:process.env.MIGRATION_DATABASE_URL});
  const storage=createBrandingStorage(root),put=storage.store.putReserved.bind(storage.store),remove=storage.store.removeChecked.bind(storage.store);
  let writeOverride:((key:string,bytes:Uint8Array)=>ReturnType<typeof put>)|null=null,rejectGC=false,held=false;
  storage.store.putReserved=(key,bytes)=>writeOverride?writeOverride(key,bytes):put(key,bytes);
  storage.store.removeChecked=async ref=>{if(rejectGC)throw Error('Synthetic GC transport failure');return remove(ref);};
  const svc=createBrandingServices({authorize:async ctx=>ctx.member.org_role==='OWNER',decoder:createBrandingDecoder(),storage,lifecycle:{assertTenantReadable:async ctx=>{await lockActiveOrganization(ctx.c,ctx.org.id);},assertTenantWritable:async ctx=>{await lockActiveOrganization(ctx.c,ctx.org.id);},assertPublicReadable:async(c,org)=>{await lockActiveOrganization(c,org);}}});
  const origin='http://stages.localhost:5173';process.env.ALLOWED_ORIGINS=origin;
  const app=await buildApp([async(app,core)=>{
    svc.register(app,core);
    app.post('/api/v1/organizations/:organizationId/test-branding-gc',r=>core.tenant(r,{mode:'authorization_write'},ctx=>svc.collectGarbage(ctx,async()=>held)));
  }],{migrationScope:'foundation'});
  let releasePending:(()=>void)|undefined;
  let crashChild:ChildProcess|undefined;
  try{
    const reg=await app.inject({method:'POST',url:'/api/v1/auth/register',headers:{origin},payload:{email:`stages-${randomUUID()}@example.test`,password:`Synthetic-${randomUUID()}`,displayName:'Synthetic stage owner'}});
    assert.equal(reg.statusCode,201,reg.body);
    const cookie=`orgmap_session=${reg.cookies.find(x=>x.name==='orgmap_session')!.value}`,csrf=reg.json().data.csrfToken;
    const request=(method:string,url:string,payload?:any,revision?:number,key=randomUUID())=>app.inject({method:method as any,url,headers:{origin,cookie,'x-csrf-token':csrf,'idempotency-key':key,...(revision===undefined?{}:{'if-match':`"${revision}"`})},payload});
    const orgs:string[]=[];
    for(const name of ['A cut during write','B preserved GC','C uncertain write','D real writer crash']){const result=await request('POST','/api/v1/organizations',{name});assert.equal(result.statusCode,201,result.body);orgs.push(result.json().data.organization.id);}
    const path=(org:string)=>`/api/v1/organizations/${org}/administration/branding-assets/workspace-logo`;
    const image=await sharp({create:{width:80,height:40,channels:3,background:'#195f7a'}}).png().toBuffer(),payload={base64:image.toString('base64')};
    const entered=barrier(),resume=barrier();releasePending=resume.release;let cutStage:any;
    writeOverride=async(key,bytes)=>{
      cutStage=(await admin.query('SELECT * FROM administration_branding_stages WHERE blob_key=$1',[key])).rows[0];
      assert.equal(cutStage.state,'WRITING');assert.equal(cutStage.organization_id,orgs[0]);assert.equal(cutStage.size,bytes.byteLength);
      await assert.rejects(access(join(root,key)),/ENOENT/);entered.release();await resume.promise;return put(key,bytes);
    };
    const writing=request('POST',path(orgs[0]),payload,0);
    await entered.promise;
    const c=await admin.connect();try{await c.query('BEGIN');await c.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[orgs[0]]);await c.query("UPDATE organization_lifecycle SET state='DELETION_PENDING',fence=2 WHERE organization_id=$1",[orgs[0]]);await c.query('COMMIT');}finally{c.release();}
    resume.release();const cutResponse=await writing;releasePending=undefined;writeOverride=null;
    assert.equal(cutResponse.statusCode,404,cutResponse.body);
    assert.equal((await admin.query('SELECT state FROM administration_branding_stages WHERE id=$1',[cutStage.id])).rows[0].state,'ABANDONED');
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM administration_branding_gc WHERE id=$1',[cutStage.id])).rows[0].n,1);
    assert.ok((await readFile(join(root,cutStage.blob_key))).byteLength>0);
    assert.equal((await request('GET',`/api/v1/organizations/${orgs[0]}/branding/workspace-logo`)).statusCode,404);
    assert.equal((await request('GET',`/api/v1/organizations/${orgs[1]}/administration/branding-assets`)).statusCode,200);

    // A failure before/while put does not establish ownership or completion.
    writeOverride=async()=>{throw Error('Synthetic write interruption');};const uncertainKey=randomUUID();
    const uncertain=await request('POST',path(orgs[2]),payload,0,uncertainKey);assert.equal(uncertain.statusCode,503,uncertain.body);writeOverride=null;
    const uncertainStage=(await admin.query('SELECT * FROM administration_branding_stages WHERE organization_id=$1',[orgs[2]])).rows[0];
    assert.equal(uncertainStage.state,'WRITING');assert.equal((await admin.query('SELECT count(*)::int AS n FROM administration_branding_gc WHERE blob_key=$1',[uncertainStage.blob_key])).rows[0].n,0);
    assert.equal((await request('POST',path(orgs[2]),payload,0,uncertainKey)).statusCode,503);
    const backupClient=await admin.connect();try{await backupClient.query('BEGIN');await assert.rejects(svc.backupReferences(backupClient,orgs[2]),/STAGING_RECONCILIATION_REQUIRED/);}finally{await backupClient.query('ROLLBACK');backupClient.release();}

    const active=await request('POST',path(orgs[1]),payload,0);assert.equal(active.statusCode,200,active.body);
    const enteredB=barrier(),resumeB=barrier();releasePending=resumeB.release;let abandoned:any;
    writeOverride=async(key,bytes)=>{abandoned=(await admin.query('SELECT * FROM administration_branding_stages WHERE blob_key=$1',[key])).rows[0];enteredB.release();await resumeB.promise;return put(key,bytes);};
    const replacing=request('POST',path(orgs[1]),payload,1);await enteredB.promise;
    const deleted=await request('DELETE',path(orgs[1]),undefined,1);assert.equal(deleted.statusCode,200,deleted.body);
    resumeB.release();const stale=await replacing;releasePending=undefined;writeOverride=null;assert.equal(stale.statusCode,409,stale.body);
    assert.equal((await admin.query('SELECT state FROM administration_branding_stages WHERE id=$1',[abandoned.id])).rows[0].state,'ABANDONED');
    const gcPath=`/api/v1/organizations/${orgs[1]}/test-branding-gc`;
    await admin.query("UPDATE administration_branding_gc SET available_at=clock_timestamp()-interval '1 minute' WHERE organization_id=$1",[orgs[1]]);
    held=true;const retained=await request('POST',gcPath,{});assert.equal(retained.statusCode,200,retained.body);assert.equal(retained.json().data.deferred,2);held=false;
    rejectGC=true;const failed=await request('POST',gcPath,{});assert.equal(failed.statusCode,200,failed.body);assert.equal(failed.json().data.failed,2);rejectGC=false;
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM administration_branding_stages WHERE organization_id=$1 AND storage_removed_at IS NOT NULL',[orgs[1]])).rows[0].n,0);
    await admin.query("UPDATE administration_branding_gc SET available_at=clock_timestamp()-interval '1 minute' WHERE organization_id=$1",[orgs[1]]);
    const collected=await request('POST',gcPath,{});assert.equal(collected.statusCode,200,collected.body);assert.equal(collected.json().data.removed,2);
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM administration_branding_stages WHERE organization_id=$1 AND storage_removed_at IS NOT NULL',[orgs[1]])).rows[0].n,2);
    await assert.rejects(access(join(root,abandoned.blob_key)),/ENOENT/);
    // A forged/corrupt B garbage row cannot remove an A reservation.
    const forged=randomUUID();await admin.query("INSERT INTO administration_branding_gc(id,organization_id,purpose,blob_key,sha256,size,reason) VALUES($1,$2,'WORKSPACE_LOGO',$3,$4,$5,'UNPUBLISHED')",[forged,orgs[1],cutStage.blob_key,cutStage.sha256,cutStage.size]);
    const foreign=await request('POST',gcPath,{});assert.equal(foreign.json().data.deferred,1);assert.ok((await readFile(join(root,cutStage.blob_key))).byteLength>0);
    await admin.query('DELETE FROM administration_branding_gc WHERE id=$1',[forged]);

    const applicationName=`orgmap_branding_crash_${randomUUID().replaceAll('-','')}`,childUrl=new URL(process.env.DATABASE_URL!);childUrl.searchParams.set('application_name',applicationName);
    crashChild=fork(fileURLToPath(new URL('../fixtures/branding-stage-writer.ts',import.meta.url)),[],{execArgv:['--import','tsx'],env:{...process.env,DATABASE_URL:childUrl.href},stdio:['ignore','ignore','ignore','ipc']});
    const child=crashChild;
    const written=new Promise<string>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('CRASH_PROBE_BOUNDARY_TIMEOUT')),30000);
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',()=>{clearTimeout(timer);reject(Error('CRASH_PROBE_EXITED_BEFORE_BOUNDARY'));});
      child.once('message',(message:any)=>{clearTimeout(timer);if(message.state==='BYTES_WRITTEN'&&typeof message.key==='string')resolve(message.key);else reject(Error('CRASH_PROBE_UNEXPECTED_STATE'));});
    });
    child.send({root,request:{method:'POST',url:path(orgs[3]),headers:{origin,cookie,'x-csrf-token':csrf,'idempotency-key':randomUUID(),'if-match':'"0"'},payload}});
    const crashKey=await written;
    const beforeCrash=(await admin.query('SELECT state,writer_pid,blob_key,sha256,size FROM administration_branding_stages WHERE blob_key=$1',[crashKey])).rows[0];
    assert.equal(beforeCrash.state,'WRITING');assert.equal(beforeCrash.writer_pid,child.pid);
    const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill('SIGKILL');await exited;crashChild=undefined;
    const deadline=Date.now()+10000;
    while((await admin.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1',[applicationName])).rowCount){if(Date.now()>deadline)throw Error('CRASH_PROBE_DATABASE_CONNECTION_REMAINED');await new Promise(r=>setTimeout(r,10));}
    assert.equal((await admin.query('SELECT state FROM administration_branding_stages WHERE blob_key=$1',[crashKey])).rows[0].state,'WRITING');
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM administration_branding_gc WHERE blob_key=$1',[crashKey])).rows[0].n,0);
    assert.equal((await storage.store.read({key:crashKey,sha256:beforeCrash.sha256})).byteLength,beforeCrash.size);
    assert.equal((await request('GET',`/api/v1/organizations/${orgs[3]}/branding/workspace-logo`)).statusCode,404);
    const crashBackup=await admin.connect();try{await crashBackup.query('BEGIN');await assert.rejects(svc.backupReferences(crashBackup,orgs[3]),/STAGING_RECONCILIATION_REQUIRED/);}finally{await crashBackup.query('ROLLBACK');crashBackup.release();}
  }finally{releasePending?.();if(crashChild&&crashChild.exitCode===null&&crashChild.signalCode===null){const exited=new Promise<void>(r=>crashChild!.once('exit',()=>r()));crashChild.kill('SIGKILL');await exited;}await app.close();await admin.end();await rm(root,{recursive:true,force:true});}
});
