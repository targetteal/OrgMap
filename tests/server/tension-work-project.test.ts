import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {buildApp} from '../../server/src/app.js';
import {pool} from '../../server/src/db.js';
import {createOrgMapIntegration} from '../../server/integration/index.js';
import type {FastifyInstance,HTTPMethods} from 'fastify';

if(!/^\/orgmap_integration_[a-f0-9]{32}$/.test(new URL(process.env.DATABASE_URL??'postgres://invalid/orgmap').pathname))throw Error('EXCLUSIVE_INTEGRATION_TEST_DATABASE_REQUIRED');
const origin='http://tension-work.localhost:5273';process.env.ALLOWED_ORIGINS=origin;
after(async()=>pool.end());
type User={cookie:string;csrf:string;accountId:string};
async function user(app:FastifyInstance):Promise<User>{const r=await app.inject({method:'POST',url:'/api/v1/auth/register',headers:{origin},payload:{email:`${randomUUID()}@fixture.invalid`,password:`Synthetic-${randomUUID()}`,displayName:'Fixture'}});assert.equal(r.statusCode,201,r.body);return {cookie:`orgmap_session=${r.cookies.find(x=>x.name==='orgmap_session')!.value}`,csrf:r.json().data.csrfToken,accountId:r.json().data.account.id};}
async function call(app:FastifyInstance,u:User,method:HTTPMethods,url:string,body?:object,version?:number,k=randomUUID()){return app.inject({method,url,payload:body,headers:{origin,cookie:u.cookie,'x-csrf-token':u.csrf,'idempotency-key':k,...(version===undefined?{}:{'if-match':`"${version}"`})}});}
function data(r:{statusCode:number;body:string;json:()=>any},status=200){assert.equal(r.statusCode,status,r.body);return r.json().data;}

test('tension creates one traced project task with live source/destination authorization',async()=>{
 const app=await buildApp([createOrgMapIntegration()],{migrationMaxPrefix:999}),admin=new pg.Pool({connectionString:process.env.MIGRATION_DATABASE_URL});
 try {
  const owner=await user(app),other=await user(app),guest=await user(app),foreign=await user(app);
  const A=data(await call(app,owner,'POST','/api/v1/organizations',{name:'A'}),201),B=data(await call(app,foreign,'POST','/api/v1/organizations',{name:'B'}),201),a=`/api/v1/organizations/${A.organization.id}`,b=`/api/v1/organizations/${B.organization.id}`;
  const otherMember=data(await call(app,owner,'POST',`${a}/members`,{accountId:other.accountId}),201).membership;
  const guestMember=data(await call(app,owner,'POST',`${a}/members`,{accountId:guest.accountId}),201).membership;
  const source=async(title:string)=>data(await call(app,owner,'POST',`${a}/tensions`,{title,circleId:A.rootCircle.id}),201);
  const project=data(await call(app,owner,'POST',`${a}/work/projects`,{title:'Project A',visibility:'PUBLIC'}),201).project;
  const privateB=data(await call(app,foreign,'POST',`${b}/work/projects`,{title:'Foreign',visibility:'PRIVATE'}),201).project;
  const privateOther=data(await call(app,other,'POST',`${a}/work/projects`,{title:'Private other',visibility:'PRIVATE'}),201).project;
  const t=await source('A traced task'),endpoint=`${a}/tensions/${t.id}/actions/process`,key=randomUUID(),body={targetKind:'TASK',projectId:project.id};
  const created=data(await call(app,owner,'POST',endpoint,body,t.version,key));assert.ok(created.targetId);
  const replay=data(await call(app,owner,'POST',endpoint,body,t.version,key));assert.equal(replay.targetId,created.targetId);
  assert.equal((await call(app,owner,'POST',endpoint,{targetKind:'TASK',projectId:privateOther.id},t.version,key)).statusCode,404);
  const task=data(await call(app,owner,'GET',`${a}/work/tasks/${created.targetId}`));assert.equal(task.task.projectId,project.id);assert.equal(task.task.sourceTensionId,t.id);
  const taskOrigin=data(await call(app,owner,'GET',`${a}/work/tasks/${created.targetId}/origin`));assert.equal(taskOrigin.origin.id,t.id);
  const outgoing=data(await call(app,owner,'GET',`${a}/tensions/${t.id}/trace`));assert.ok(outgoing.items.some((x:any)=>x.kind==='TASK'&&x.id===created.targetId));
  const counts=await admin.query('SELECT (SELECT count(*) FROM work_tasks WHERE organization_id=$1 AND source_tension_id=$2)::int tasks,(SELECT count(*) FROM gov_tension_links WHERE organization_id=$1 AND tension_id=$2)::int links',[A.organization.id,t.id]);assert.deepEqual(counts.rows[0],{tasks:1,links:1});
  const blocked=await source('No leaks'),blockedUrl=`${a}/tensions/${blocked.id}/actions/process`;
  for(const pid of [privateOther.id,privateB.id,randomUUID()])assert.equal((await call(app,owner,'POST',blockedUrl,{targetKind:'TASK',projectId:pid},blocked.version)).statusCode,404);
  assert.equal((await call(app,owner,'POST',blockedUrl,{targetKind:'GOAL',projectId:null},blocked.version)).statusCode,400);
  assert.equal((await call(app,owner,'POST',blockedUrl,{targetKind:'AGENDA',projectId:project.id},blocked.version)).statusCode,400);
  assert.equal((await call(app,owner,'POST',blockedUrl,{targetKind:'TASK',projectId:project.id},blocked.version+5)).statusCode,409);
  const before=await admin.query('SELECT state,version FROM gov_tensions WHERE organization_id=$1 AND id=$2',[A.organization.id,blocked.id]);assert.equal(before.rows[0].state,'OPEN');assert.equal(before.rows[0].version,blocked.version);
  const target=data(await call(app,other,'POST',`${a}/work/projects`,{title:'Controlled project',visibility:'PUBLIC'}),201).project;
  const grant=data(await call(app,other,'POST',`${a}/work/projects/${target.id}/access`,{memberId:A.membership.id,role:'EDITOR'},target.version),201);
  const rev=await source('Revoked access'),revUrl=`${a}/tensions/${rev.id}/actions/process`,revKey=randomUUID(),revBody={targetKind:'TASK',projectId:target.id};
  data(await call(app,owner,'POST',revUrl,revBody,rev.version,revKey));
  data(await call(app,other,'POST',`${a}/work/projects/${target.id}/access`,{memberId:A.membership.id,role:'READER'},grant.version));
  assert.equal((await call(app,owner,'POST',revUrl,revBody,rev.version,revKey)).statusCode,403);
  const frozen=data(await call(app,owner,'POST',`${a}/work/projects`,{title:'Frozen',visibility:'PUBLIC'}),201).project;
  data(await call(app,owner,'PATCH',`${a}/work/projects/${frozen.id}`,{frozen:true},frozen.version));
  assert.equal((await call(app,owner,'POST',blockedUrl,{targetKind:'TASK',projectId:frozen.id},blocked.version)).statusCode,409);
  await admin.query("UPDATE members SET member_type='GUEST' WHERE organization_id=$1 AND id=$2",[A.organization.id,guestMember.id]);
  assert.ok([403,404].includes((await call(app,guest,'POST',blockedUrl,{targetKind:'TASK',projectId:project.id},blocked.version)).statusCode));
  const visibleOrigin=data(await call(app,other,'GET',`${a}/work/tasks/${created.targetId}/origin`));assert.equal(visibleOrigin.origin.id,t.id);assert.equal(visibleOrigin.origin.kind,'TENSION');
  const archived=data(await call(app,owner,'POST',`${a}/work/projects`,{title:'Archived',visibility:'PUBLIC'}),201).project;
  data(await call(app,owner,'PATCH',`${a}/work/projects/${archived.id}`,{archived:true},archived.version));
  assert.equal((await call(app,owner,'POST',blockedUrl,{targetKind:'TASK',projectId:archived.id},blocked.version)).statusCode,404);
  await admin.query("INSERT INTO circle_memberships(organization_id,id,member_id,circle_id,starts_at) VALUES($1,$2,$3,$4,now())",[A.organization.id,randomUUID(),otherMember.id,A.rootCircle.id]);
  const memberTension=data(await call(app,other,'POST',`${a}/tensions`,{title:'Member source',circleId:A.rootCircle.id}),201);
  const memberResult=data(await call(app,other,'POST',`${a}/tensions/${memberTension.id}/actions/process`,{targetKind:'TASK',projectId:privateOther.id},memberTension.version));
  assert.equal(data(await call(app,other,'GET',`${a}/work/tasks/${memberResult.targetId}`)).task.projectId,privateOther.id);
  const personal=await source('Personal remains private');const personalResult=data(await call(app,owner,'POST',`${a}/tensions/${personal.id}/actions/process`,{targetKind:'TASK',projectId:null},personal.version));
  assert.equal(data(await call(app,owner,'GET',`${a}/work/tasks/${personalResult.targetId}`)).task.projectId,null);
  assert.equal((await call(app,other,'GET',`${a}/work/tasks/${personalResult.targetId}`)).statusCode,404);
 } finally {await app.close();await admin.end();}
});

test('a destination port returning the wrong project rolls back both task and source',async()=>{
 const app=await buildApp([createOrgMapIntegration({createFromTension:async(ctx,input)=>{
  const taskId=randomUUID();await ctx.c.query('INSERT INTO work_tasks(organization_id,id,creator_id,title,circle_id,source_tension_id) VALUES($1,$2,$3,$4,$5,$6)',[ctx.org.id,taskId,ctx.member.id,input.title,input.circleId,input.tensionId]);return {id:taskId};
 }})],{migrationMaxPrefix:999}),admin=new pg.Pool({connectionString:process.env.MIGRATION_DATABASE_URL});
 try {
  const owner=await user(app),A=data(await call(app,owner,'POST','/api/v1/organizations',{name:'Rollback A'}),201),a=`/api/v1/organizations/${A.organization.id}`;
  const p=data(await call(app,owner,'POST',`${a}/work/projects`,{title:'Real target',visibility:'PUBLIC'}),201).project;
  const t=data(await call(app,owner,'POST',`${a}/tensions`,{title:'Rollback source',circleId:A.rootCircle.id}),201);
  assert.equal((await call(app,owner,'POST',`${a}/tensions/${t.id}/actions/process`,{targetKind:'TASK',projectId:p.id},t.version)).statusCode,409);
  const rows=(await admin.query("SELECT (SELECT count(*) FROM work_tasks WHERE organization_id=$1 AND source_tension_id=$2)::int tasks,(SELECT count(*) FROM gov_tension_links WHERE organization_id=$1 AND tension_id=$2)::int links,(SELECT state FROM gov_tensions WHERE organization_id=$1 AND id=$2) state",[A.organization.id,t.id])).rows[0];
  assert.deepEqual(rows,{tasks:0,links:0,state:'OPEN'});
 } finally {await app.close();await admin.end();}
});
