import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../server/src/app.js';
import { pool } from '../../server/src/db.js';
import { createAssistantAdministration } from '../../server/modules/administration/assistant.js';
import { readAdmissionPolicy } from '../../server/modules/administration/admission.js';
const service=createAssistantAdministration({canManageSettings:async ctx=>ctx.member.org_role==='OWNER'});
const app=await buildApp([async(app,core)=>{core.registerAdmissionPolicyProvider({resolve:readAdmissionPolicy});service.register(app,core);}]);
after(async()=>{await app.close();await pool.end();});
type User={id:string;email:string;cookie:string;csrf:string};
async function register():Promise<User>{const email=randomUUID()+'@example.test';const r=await app.inject({method:'POST',url:'/api/v1/auth/register',remoteAddress:'127.0.2.'+(Math.floor(Math.random()*200)+1),headers:{origin:'http://localhost:5173'},payload:{email,password:'a-secure-password-123',displayName:'Assistant test'}});assert.equal(r.statusCode,201,r.body);return {id:r.json().data.account.id,email,cookie:r.cookies[0].name+'='+r.cookies[0].value,csrf:r.json().data.csrfToken};}
async function call(user:User,method:string,url:string,payload?:any,revision?:number,k=randomUUID()) {return app.inject({method:method as any,url:'/api/v1'+url,headers:{origin:'http://localhost:5173',cookie:user.cookie,'x-csrf-token':user.csrf,'idempotency-key':k,...(revision===undefined?{}:{'if-match':`"${revision}"`})},payload});}
function data(r:any){assert.ok([200,201].includes(r.statusCode),r.body);return r.json().data;}
test('assistant persists per member and workspace, isolates A/B, reauthorizes replay and refuses runtime',async()=>{
  const owner=await register(),person=await register(),guest=await register();
  const a=data(await call(owner,'POST','/organizations',{name:'Assistant A'})).organization.id;
  const b=data(await call(owner,'POST','/organizations',{name:'Assistant B'})).organization.id;
  data(await call(owner,'POST',`/organizations/${a}/members`,{accountId:person.id}));
  data(await call(owner,'POST',`/organizations/${a}/members`,{accountId:guest.id,memberType:'GUEST',accessPlan:[]}));
  const path=(org:string)=>`/organizations/${org}/administration/assistant`;
  assert.deepEqual(data(await call(owner,'GET',path(a)+'/personal')).settings,{revision:0,instructions:'',updatedAt:null});
  const k=randomUUID();const first=await call(person,'PUT',path(a)+'/personal',{instructions:'private member'},0,k);assert.equal(data(first).settings.revision,1);
  const replay=await call(person,'PUT',path(a)+'/personal',{instructions:'private member'},0,k);assert.equal(data(replay).settings.instructions,'private member');
  assert.equal(data(await call(owner,'GET',path(a)+'/personal')).settings.instructions,'');
  assert.equal(data(await call(owner,'GET',path(b)+'/personal')).settings.instructions,'');
  assert.equal((await call(person,'GET',path(a)+'/workspace')).statusCode,403);
  assert.equal(data(await call(owner,'PUT',path(a)+'/workspace',{instructions:'organization instruction'},0)).settings.revision,1);
  assert.equal(data(await call(owner,'GET',path(b)+'/workspace')).settings.instructions,'');
  assert.equal((await call(owner,'PUT',path(a)+'/workspace',{instructions:'stale'},0)).statusCode,409);
  assert.equal((await call(owner,'PUT',path(a)+'/workspace',{instructions:'x',unexpected:true},1)).statusCode,400);
  assert.notEqual((await call(guest,'GET',path(a)+'/personal')).statusCode,200);
  const status=data(await call(owner,'GET',path(a)+'/status'));assert.deepEqual(status.capabilities,{configuration:true,execution:false,rag:false});assert.deepEqual(status.usage,{status:'NO_DATA',requests:null,tokens:null});
  for(const endpoint of ['execute','rag','upload','query','activate']) {const blocked=await call(owner,'POST',path(a)+'/'+endpoint,{});assert.equal(blocked.statusCode,503,blocked.body);assert.equal(blocked.json().error.code,'CAPABILITY_UNAVAILABLE');}
  const login=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin:'http://localhost:5173'},payload:{email:person.email,password:'a-secure-password-123'}});assert.equal(login.statusCode,200,login.body);
  const again={...person,cookie:login.cookies[0].name+'='+login.cookies[0].value,csrf:login.json().data.csrfToken};assert.equal(data(await call(again,'GET',path(a)+'/personal')).settings.instructions,'private member');
});
