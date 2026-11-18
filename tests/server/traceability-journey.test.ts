import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {FastifyInstance,HTTPMethods} from 'fastify';
import {buildApp} from '../../server/src/app.js';
import {pool} from '../../server/src/db.js';
import {createOrgMapIntegration} from '../../server/integration/index.js';
const origin='http://trace.localhost:5273';process.env.ALLOWED_ORIGINS=origin;
if(!/^\/orgmap_(?:test|integration|journey)_[a-z0-9]+$/.test(new URL(process.env.DATABASE_URL??'postgres://invalid/orgmap').pathname))throw Error('EXCLUSIVE_TRACE_DATABASE_REQUIRED');
after(async()=>pool.end());
type Session={cookie:string;csrf:string;accountId:string};
async function account(app:FastifyInstance,label:string,ip:string):Promise<Session>{const r=await app.inject({method:'POST',url:'/api/v1/auth/register',remoteAddress:ip,headers:{origin},payload:{email:randomUUID()+'@example.test',password:'Synthetic-password-12345',displayName:label}});assert.equal(r.statusCode,201,r.body);const c=r.cookies.find(x=>x.name==='orgmap_session');assert.ok(c);return {cookie:`orgmap_session=${c.value}`,csrf:r.json().data.csrfToken,accountId:r.json().data.account.id};}
async function call(app:FastifyInstance,u:Session,method:HTTPMethods,url:string,payload?:object,version?:number,key=randomUUID()){return app.inject({method,url,payload,headers:{origin,cookie:u.cookie,'x-csrf-token':u.csrf,'idempotency-key':key,...(version===undefined?{}:{'if-match':`"${version}"`})}});}
function ok(r:{statusCode:number;body:string;json:()=>any},status=200){assert.equal(r.statusCode,status,r.body);return r.json().data;}
test('organization tension reading preserves private target, guest, module and tenant boundaries',async()=>{
 const app=await buildApp([createOrgMapIntegration()],{migrationMaxPrefix:999});
 try{
  await app.ready();const owner=await account(app,'Owner','192.0.2.11'),member=await account(app,'Member','192.0.2.12'),guest=await account(app,'Guest','192.0.2.13'),outsider=await account(app,'Org B','192.0.2.14');
  const org=ok(await call(app,owner,'POST','/api/v1/organizations',{name:'Trace A'}),201);ok(await call(app,outsider,'POST','/api/v1/organizations',{name:'Trace B'}),201);
  const base=`/api/v1/organizations/${org.organization.id}`,circle=org.rootCircle.id;
  const m=ok(await call(app,owner,'POST',`${base}/members`,{accountId:member.accountId}),201).membership;
  const series=ok(await call(app,owner,'POST',`${base}/meeting-series`,{title:'Trace meeting',circleId:circle,localStart:'2030-01-01T10:00',timeZone:'UTC',durationMinutes:60,recurrence:{frequency:'ONCE'},sections:[{id:'agenda',title:'Pauta',kind:'AGENDA'}],participants:[{memberId:m.id,access:'READ'}],policy:{notesOnlyNoter:false,windowDays:7}}),201);
  const meeting=series.occurrenceIds[0],route=`${base}/meetings/${meeting}`;
  const g=ok(await call(app,owner,'POST',`${base}/members`,{accountId:guest.accountId,memberType:'GUEST',accessPlan:[{resource:{context:'meetings',kind:'meeting',id:meeting},actions:['read']}] }),201).membership;assert.ok(g.id);
  const t=ok(await call(app,owner,'POST',`${base}/tensions`,{title:'Source tension',circleId:circle}),201);
  const command={targetKind:'AGENDA',meetingId:meeting,meetingVersion:1},key=randomUUID();
  const agenda=ok(await call(app,owner,'POST',`${base}/tensions/${t.id}/actions/process`,command,t.version,key));
  assert.equal(ok(await call(app,owner,'POST',`${base}/tensions/${t.id}/actions/process`,command,t.version,key)).targetId,agenda.targetId);
  assert.deepEqual(ok(await call(app,owner,'GET',`${route}/agenda/${agenda.targetId}/origin`)).origin,{kind:'TENSION',id:t.id,title:'Source tension'});
  // Tensions are organization-readable; circle participation changes actions, not this reading right.
  assert.equal(ok(await call(app,member,'GET',`${route}/agenda/${agenda.targetId}/origin`)).origin.id,t.id);
  assert.equal((await call(app,guest,'GET',`${route}/agenda/${agenda.targetId}/origin`)).statusCode,404);
  assert.equal((await call(app,outsider,'GET',`${route}/agenda/${agenda.targetId}/origin`)).statusCode,404);
  const beforeMember=ok(await call(app,member,'GET',route));assert.equal(beforeMember.agenda.find((x:any)=>x.id===agenda.targetId).sourceId,t.id);
  const link=ok(await call(app,owner,'POST',`${base}/circles/${circle}/memberships`,{memberId:m.id}),201).membership;
  assert.equal(ok(await call(app,member,'GET',`${route}/agenda/${agenda.targetId}/origin`)).origin.id,t.id);
  const taskKey=randomUUID();
  const task=ok(await call(app,owner,'POST',`${base}/tensions/${t.id}/actions/process`,{targetKind:'TASK'},agenda.version,taskKey));
  assert.equal(ok(await call(app,owner,'GET',`${base}/work/tasks/${task.targetId}/origin`)).origin.id,t.id);
  assert.equal((await call(app,member,'GET',`${base}/work/tasks/${task.targetId}/origin`)).statusCode,404);
  const goalSettings=ok(await call(app,owner,'GET',`${base}/administration/settings`));goalSettings.settings.modules.goals=true;ok(await call(app,owner,'PUT',`${base}/administration/settings`,{settings:goalSettings.settings},goalSettings.version));
  ok(await call(app,owner,'POST',`${base}/goal-periods`,{title:'Trace period',startsOn:'2000-01-01',endsOn:'2100-12-31'}),201);
  const goal=ok(await call(app,owner,'POST',`${base}/tensions/${t.id}/actions/process`,{targetKind:'GOAL'},task.version));
  const branch=ok(await call(app,owner,'POST',`${base}/governance/branches`,{title:'Trace branch',changes:[{kind:'CREATE',entityId:randomUUID(),entityKind:'ROLE',parentCircleId:circle,name:'Trace role',purpose:'Trace purpose'}]}),201);
  const proposal=ok(await call(app,owner,'POST',`${base}/proposals`,{title:'Proposal from tension',circleId:circle,tensionId:t.id,kind:'GOVERNANCE',branchId:branch.id}),201);
  assert.equal(ok(await call(app,owner,'GET',`${base}/proposals/${proposal.id}/origin`)).origin.id,t.id);
  assert.equal(ok(await call(app,owner,'GET',`${base}/goals/${goal.targetId}/origin`)).origin.id,t.id);
  assert.equal(ok(await call(app,member,'GET',`${base}/goals/${goal.targetId}/origin`)).origin.id,t.id);
  assert.equal((await call(app,member,'GET',`${base}/proposals/${proposal.id}/origin`)).statusCode,404);
  assert.equal((await call(app,outsider,'GET',`${base}/goals/${goal.targetId}/origin`)).statusCode,404);
  const ownerTrace=ok(await call(app,owner,'GET',`${base}/tensions/${t.id}/trace`)).items;
  assert.ok(ownerTrace.some((x:any)=>x.kind==='AGENDA'&&x.id===agenda.targetId&&x.meetingId===meeting));
  assert.ok(ownerTrace.some((x:any)=>x.kind==='TASK'&&x.id===task.targetId));assert.ok(ownerTrace.some((x:any)=>x.kind==='GOAL'&&x.id===goal.targetId));assert.ok(ownerTrace.some((x:any)=>x.kind==='PROPOSAL'&&x.id===proposal.id));
  const memberTrace=ok(await call(app,member,'GET',`${base}/tensions/${t.id}/trace`)).items;
  assert.ok(!JSON.stringify(memberTrace).includes(task.targetId));assert.ok(!JSON.stringify(memberTrace).includes(proposal.id));assert.ok(!JSON.stringify(memberTrace).includes('Proposal from tension'));
  assert.equal((await call(app,guest,'GET',`${base}/tensions/${t.id}/trace`)).statusCode,404);
  const ended=ok(await call(app,owner,'POST',`${base}/circle-memberships/${link.id}/end`,{},link.version));assert.ok(ended);
  const revokedOrigin=ok(await call(app,member,'GET',`${route}/agenda/${agenda.targetId}/origin`));
  assert.equal(revokedOrigin.origin.id,t.id);
  assert.equal(ok(await call(app,member,'GET',route)).agenda.find((x:any)=>x.id===agenda.targetId).sourceId,t.id);
  assert.equal((await call(app,member,'GET',`${base}/tensions/${t.id}/trace`)).statusCode,200);
  const revokedGoalOrigin=ok(await call(app,member,'GET',`${base}/goals/${goal.targetId}/origin`));
  assert.equal(revokedGoalOrigin.origin.id,t.id);
  const settings=ok(await call(app,owner,'GET',`${base}/administration/settings`));
  settings.settings.modules.governance=false;
  const disabled=ok(await call(app,owner,'PUT',`${base}/administration/settings`,{settings:settings.settings},settings.version));
  assert.equal(ok(await call(app,owner,'GET',`${base}/work/tasks/${task.targetId}/origin`)).origin,null);
  assert.equal(ok(await call(app,owner,'GET',`${base}/work/tasks/${task.targetId}`)).task.sourceTensionId,null);
  assert.equal(ok(await call(app,owner,'GET',route)).agenda.find((x:any)=>x.id===agenda.targetId).sourceId,null);
  settings.settings.modules.governance=true;ok(await call(app,owner,'PUT',`${base}/administration/settings`,{settings:settings.settings},disabled.version));
  assert.equal(ok(await call(app,owner,'GET',`${base}/work/tasks/${task.targetId}/origin`)).origin.id,t.id);
  const taskDetail=ok(await call(app,owner,'GET',`${base}/work/tasks/${task.targetId}`));
  ok(await call(app,owner,'PATCH',`${base}/work/tasks/${task.targetId}`,{archived:true},taskDetail.task.version));
  assert.equal(ok(await call(app,owner,'POST',`${base}/tensions/${t.id}/actions/process`,{targetKind:'TASK'},agenda.version,taskKey)).targetId,null);
 }finally{await app.close();}
});
