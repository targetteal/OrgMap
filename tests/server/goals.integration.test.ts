import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildApp} from '../../server/src/app.js';
import {pool} from '../../server/src/db.js';
import {createOrgMapIntegration} from '../../server/integration/index.js';
const origin='http://goals-integration.localhost:5367';
process.env.ALLOWED_ORIGINS=origin;
after(()=>pool.end());
test('composed goals statistics and adapters respect module disablement',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'orgmap-goals-composition-'));
 const app=await buildApp([createOrgMapIntegration({blobsDirectory:directory})],{migrationMaxPrefix:999});
 let cookie='',csrf='';
 async function call(method:string,url:string,payload?:any,version?:number){return app.inject({method:method as any,url:'/api/v1'+url,payload,headers:{origin,cookie,'x-csrf-token':csrf,'idempotency-key':randomUUID(),...(version!==undefined?{'if-match':'"'+version+'"'}:{})}});}
 const ok=(r:any,status=200)=>{assert.equal(r.statusCode,status,r.body);return r.json().data;};
 try{
  const registration=await call('POST','/auth/register',{email:randomUUID()+'@example.test',displayName:'Goals composition tester',password:'synthetic-goals-password-123'});const account=ok(registration,201);cookie='orgmap_session='+registration.cookies.find(c=>c.name==='orgmap_session')!.value;csrf=account.csrfToken;
  const org=ok(await call('POST','/organizations',{name:'Goals module policy'},undefined),201),base='/organizations/'+org.organization.id;
  const initialSettings=ok(await call('GET',base+'/administration/settings'));
  initialSettings.settings.modules.goals=true;
  ok(await call('PUT',base+'/administration/settings',{settings:initialSettings.settings},initialSettings.version));
  const period=ok(await call('POST',base+'/goal-periods',{title:'Integration period',startsOn:'2000-01-01',endsOn:'2100-12-31'}),201);
  const goal=ok(await call('POST',base+'/goals',{title:'Searchable composed goal',ownerType:'MEMBER',ownerId:org.membership.id,periodIds:[period.id]}),201);
  assert.equal(ok(await call('GET',base+'/goals/statistics')).denominator,1);
  const settings=ok(await call('GET',base+'/administration/settings'));settings.settings.modules.goals=false;
  const disabled=ok(await call('PUT',base+'/administration/settings',{settings:settings.settings},settings.version));
  for(const path of ['/goals','/goals/'+goal.id,'/goals/statistics','/goal-periods']){const r=await call('GET',base+path);assert.equal(r.statusCode,403,r.body);assert.equal(r.json().error.code,'MODULE_DISABLED');}
  assert.equal((await call('GET',base+'/goal-statistics')).statusCode,404,'No unguarded statistics alias remains');
  assert.ok(!ok(await call('GET',base+'/platform/search?q=Searchable')).items.some((i:any)=>i.type==='goal'));
  settings.settings.modules.goals=true;ok(await call('PUT',base+'/administration/settings',{settings:settings.settings},disabled.version));
  assert.equal(ok(await call('GET',base+'/goals/statistics')).denominator,1);
 }finally{await app.close();await rm(directory,{recursive:true,force:true});}
});
