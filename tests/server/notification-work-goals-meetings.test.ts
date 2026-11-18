import {after,test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import pg from "pg";
import type {FastifyInstance,HTTPMethods} from "fastify";
import {buildApp} from "../../server/src/app.js";
import {pool} from "../../server/src/db.js";
import {createOrgMapIntegration} from "../../server/integration/index.js";

const origin="http://notification-producers.localhost:5368";
process.env.ALLOWED_ORIGINS=origin;process.env.ORGMAP_PUBLIC_URL=origin;delete process.env.BREVO_API_KEY;
if(!/^\/orgmap_integration_[a-f0-9]{32}$/.test(new URL(process.env.DATABASE_URL??"postgres://invalid/").pathname))throw Error("EXCLUSIVE_NOTIFICATION_PRODUCER_DATABASE_REQUIRED");
after(()=>pool.end());
type User={cookie:string;csrf:string;accountId:string};
function ok(response:any,status=200){assert.equal(response.statusCode,status,response.body);return response.json().data;}
function call(app:FastifyInstance,user:User,method:HTTPMethods,path:string,payload?:any,version?:number,key=randomUUID()){
  return app.inject({method,url:"/api/v1"+path,payload,headers:{origin,cookie:user.cookie,"x-csrf-token":user.csrf,"idempotency-key":key,...(version===undefined?{}:{"if-match":`"${version}"`})}});
}
async function account(app:FastifyInstance,name:string):Promise<User>{
  const response=await app.inject({method:"POST",url:"/api/v1/auth/register",headers:{origin},payload:{email:`${randomUUID()}@example.test`,password:`Fixture!${randomUUID()}`,displayName:name}}),data=ok(response,201);
  return {cookie:`orgmap_session=${response.cookies.find(c=>c.name==="orgmap_session")!.value}`,csrf:data.csrfToken,accountId:data.account.id};
}
async function fixture(){
  const directory=await mkdtemp(join(tmpdir(),"orgmap-notification-producers-"));
  const app=await buildApp([createOrgMapIntegration({blobsDirectory:directory})],{migrationMaxPrefix:999});
  const admin=new pg.Pool({connectionString:process.env.MIGRATION_DATABASE_URL!});
  await app.ready();
  const owner=await account(app,"Responsável"),person=await account(app,"Pessoa avisada"),other=await account(app,"Outra pessoa");
  const org=ok(await call(app,owner,"POST","/organizations",{name:"Notificações de domínio"}),201),base=`/organizations/${org.organization.id}`;
  const member=ok(await call(app,owner,"POST",base+"/members",{accountId:person.accountId}),201).membership;
  const otherMember=ok(await call(app,owner,"POST",base+"/members",{accountId:other.accountId}),201).membership;
  const settings=ok(await call(app,owner,"GET",base+"/administration/settings"));settings.settings.modules.goals=true;
  ok(await call(app,owner,"PUT",base+"/administration/settings",{settings:settings.settings},settings.version));
  async function deliveries(event:string,resourceId?:string){return (await admin.query("SELECT * FROM platform_deliveries WHERE organization_id=$1 AND event=$2 AND ($3::uuid IS NULL OR resource_id=$3) ORDER BY resource_id,recipient_id,channel",[org.organization.id,event,resourceId??null])).rows;}
  async function follow(user:User,type:string,resourceId:string){ok(await call(app,user,"POST",`${base}/platform/resources/${type}/${resourceId}/follow`,{enabled:true}));}
  return {app,admin,owner,person,other,org,base,member,otherMember,deliveries,follow,close:async()=>{await app.close();await admin.end();await rm(directory,{recursive:true,force:true});}};
}

test("Work emits resolved task assignments and real project updates once; no-op, replay and rollback do not add notices",async()=>{
  const f=await fixture();
  try{
    const project=ok(await call(f.app,f.owner,"POST",f.base+"/work/projects",{title:"Entregar uma melhoria",visibility:"PUBLIC"}),201).project;
    const task=ok(await call(f.app,f.owner,"POST",f.base+"/work/tasks",{title:"Revisar acessibilidade",projectId:project.id}),201).task;
    const role=ok(await call(f.app,f.owner,"POST",f.base+"/roles",{name:"Revisão",circleId:f.org.rootCircle.id,mode:"DIRECT"}),201).role;
    ok(await call(f.app,f.owner,"POST",`${f.base}/roles/${role.id}/occupancies`,{memberId:f.member.id,kind:"DIRECT"}),201);
    const assignment={principals:[{kind:"ROLE",roleId:role.id},{kind:"MEMBER",memberId:f.otherMember.id}]},key=randomUUID();
    const assigned=ok(await call(f.app,f.owner,"POST",`${f.base}/work/tasks/${task.id}/assignments`,assignment,task.version,key)).task;
    const notices=await f.deliveries("TaskAssigned",task.id);
    assert.equal(notices.length,4);assert.deepEqual([...new Set(notices.map(n=>n.recipient_id))].sort(),[f.member.id,f.otherMember.id].sort());
    ok(await call(f.app,f.owner,"POST",`${f.base}/work/tasks/${task.id}/assignments`,assignment,task.version,key));assert.equal((await f.deliveries("TaskAssigned",task.id)).length,4);
    const same=ok(await call(f.app,f.owner,"POST",`${f.base}/work/tasks/${task.id}/assignments`,assignment,assigned.version)).task;
    assert.equal((await f.deliveries("TaskAssigned",task.id)).length,4);
    const rejected=await call(f.app,f.owner,"POST",`${f.base}/work/tasks/${task.id}/assignments`,{principals:[{kind:"MEMBER",memberId:randomUUID()}]},same.version);assert.equal(rejected.statusCode,404);
    assert.equal((await f.deliveries("TaskAssigned",task.id)).length,4);
    await f.follow(f.person,"project",project.id);
    const updated=ok(await call(f.app,f.owner,"PATCH",`${f.base}/work/projects/${project.id}`,{title:"Melhoria pronta"},project.version)).project;
    assert.equal((await f.deliveries("ProjectUpdated",project.id)).length,2);
    assert.ok((await f.deliveries("ProjectUpdated",project.id)).every(row=>row.recipient_id===f.member.id));
    ok(await call(f.app,f.owner,"PATCH",`${f.base}/work/projects/${project.id}`,{title:"Melhoria pronta"},updated.version));
    assert.equal((await f.deliveries("ProjectUpdated",project.id)).length,2);
    const foreign=ok(await call(f.app,f.owner,"POST","/organizations",{name:"Organização separada"}),201);
    const forbidden=await call(f.app,f.owner,"PATCH",`/organizations/${foreign.organization.id}/work/projects/${project.id}`,{title:"Não deve mudar"},updated.version+1);assert.equal(forbidden.statusCode,404);
    assert.equal((await f.deliveries("ProjectUpdated",project.id)).length,2);
  }finally{await f.close();}
});

test("Goals assigns objective and KR, notifies followers on material edits and preserves assignments on a rejected replacement",async()=>{
  const f=await fixture();
  try{
    const period=ok(await call(f.app,f.owner,"POST",f.base+"/goal-periods",{title:"Período ativo",startsOn:"2000-01-01",endsOn:"2100-12-31"}),201);
    const goal=ok(await call(f.app,f.owner,"POST",f.base+"/goals",{title:"Melhorar a experiência",ownerType:"MEMBER",ownerId:f.org.membership.id,periodIds:[period.id],privacy:"PUBLIC"}),201);
    const createdKR=ok(await call(f.app,f.owner,"POST",`${f.base}/goals/${goal.id}/key-results`,{title:"Percurso acessível",resultType:"PERCENTAGE",initialValue:"0",targetValue:"100"},goal.version),201);
    const kr=createdKR.keyResults[0],assignments=[{memberId:f.org.membership.id,functionalRole:"LEAD"},{memberId:f.member.id,functionalRole:"CONTRIBUTOR"},{memberId:f.otherMember.id,functionalRole:"CONTRIBUTOR",keyResultId:kr.id}];
    const current=ok(await call(f.app,f.owner,"POST",`${f.base}/goals/${goal.id}/assignments`,{assignments},createdKR.version));
    assert.equal((await f.deliveries("GoalAssigned",goal.id)).length,2);
    assert.equal((await f.deliveries("KRAssigned",kr.id)).length,2);
    const noOp=ok(await call(f.app,f.owner,"POST",`${f.base}/goals/${goal.id}/assignments`,{assignments},current.version));
    assert.equal((await f.deliveries("GoalAssigned",goal.id)).length,2);assert.equal((await f.deliveries("KRAssigned",kr.id)).length,2);
    await f.follow(f.person,"goal",goal.id);
    const edited=ok(await call(f.app,f.owner,"PATCH",`${f.base}/goals/${goal.id}`,{title:"Experiência mais clara"},noOp.version));
    assert.equal((await f.deliveries("GoalUpdated",goal.id)).length,2);
    const untouched=ok(await call(f.app,f.owner,"PATCH",`${f.base}/goals/${goal.id}`,{title:"Experiência mais clara"},edited.version));
    assert.equal((await f.deliveries("GoalUpdated",goal.id)).length,2);
    const failed=await call(f.app,f.owner,"POST",`${f.base}/goals/${goal.id}/assignments`,{assignments:[assignments[0],{memberId:randomUUID(),functionalRole:"CONTRIBUTOR"}]},untouched.version);
    assert.equal(failed.statusCode,404);
    const still=ok(await call(f.app,f.owner,"GET",`${f.base}/goals/${goal.id}`));assert.equal(still.assignments.length,3);assert.equal(still.version,untouched.version);
    assert.equal((await f.deliveries("GoalAssigned",goal.id)).length,2);
  }finally{await f.close();}
});

test("Meetings batches recurring invitations, ignores denied participants and announces each publication transition once",async()=>{
  const f=await fixture();
  try{
    const created=ok(await call(f.app,f.owner,"POST",f.base+"/meeting-series",{title:"Revisão semanal",circleId:f.org.rootCircle.id,localStart:"2030-03-01T12:00",timeZone:"UTC",durationMinutes:60,recurrence:{frequency:"DAILY",count:3},sections:[{id:"agenda",title:"Pauta",kind:"AGENDA"}],participants:[{memberId:f.member.id,access:"READ"},{memberId:f.otherMember.id,access:"DENY"}],policy:{}}),201);
    assert.equal(created.occurrenceIds.length,3);
    const scheduled=await f.deliveries("MeetingScheduled");assert.equal(scheduled.length,2);assert.ok(scheduled.every(n=>n.recipient_id===f.member.id));assert.equal(new Set(scheduled.map(n=>n.resource_id)).size,1);
    const route=`${f.base}/meetings/${created.occurrenceIds[0]}`;
    const secondRoute=`${f.base}/meetings/${created.occurrenceIds[1]}`;
    const second=ok(await call(f.app,f.owner,"GET",secondRoute));
    const invited=ok(await call(f.app,f.owner,"POST",secondRoute+"/actions/participants",{scope:"THIS",participants:[{memberId:f.otherMember.id,access:"READ"}]},second.meeting.version));
    const laterInvite=(await f.deliveries("MeetingScheduled")).filter(row=>row.recipient_id===f.otherMember.id);
    assert.equal(laterInvite.length,2);assert.ok(laterInvite.every(row=>row.resource_id===created.occurrenceIds[1]));
    ok(await call(f.app,f.owner,"POST",secondRoute+"/actions/participants",{scope:"THIS",participants:[{memberId:f.otherMember.id,access:"READ"}]},invited.meeting.version));
    assert.equal((await f.deliveries("MeetingScheduled")).length,4);
    let detail=ok(await call(f.app,f.owner,"GET",route));
    const noOp=ok(await call(f.app,f.owner,"POST",route+"/actions/reschedule",{scope:"THIS",title:"Revisão semanal"},detail.meeting.version));
    assert.equal((await f.deliveries("MeetingScheduled")).length,4);
    detail=ok(await call(f.app,f.owner,"GET",route));
    detail=ok(await call(f.app,f.owner,"POST",route+"/actions/start",{},detail.meeting.version));
    const project=ok(await call(f.app,f.owner,"POST",f.base+"/work/projects",{title:"Encaminhamentos",visibility:"PUBLIC"}),201).project;
    const outcome=ok(await call(f.app,f.owner,"POST",route+"/outcomes",{kind:"TASK",title:"Preparar a próxima rodada",projectId:project.id,workLink:{kind:"MEMBER",targetId:f.member.id}},detail.meeting.version));
    assert.equal((await f.deliveries("TaskAssigned",outcome.target.id)).length,2);
    detail=ok(await call(f.app,f.owner,"GET",route));
    detail=ok(await call(f.app,f.owner,"POST",route+"/actions/close",{},detail.meeting.version));
    const published=ok(await call(f.app,f.owner,"POST",route+"/report/actions/publish",{},detail.report.version));
    const reports=await f.deliveries("ReportPublished",detail.report.id);assert.equal(reports.length,2);assert.ok(reports.every(n=>n.recipient_id===f.member.id));
    ok(await call(f.app,f.owner,"POST",route+"/report/actions/publish",{},published.report.version));
    assert.equal((await f.deliveries("ReportPublished",detail.report.id)).length,2);
    assert.equal((await call(f.app,f.other,"GET",route)).statusCode,404);
    assert.ok(noOp.changed.includes(created.occurrenceIds[0]));
  }finally{await f.close();}
});
