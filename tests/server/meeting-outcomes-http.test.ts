import {test,after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {buildApp} from '../../server/src/app.js';import {pool} from '../../server/src/db.js';import {createOrgMapIntegration,createPlatformWorker} from '../../server/integration/index.js';
import {changes as governanceChanges} from '../../server/modules/governance/domain.js';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';import {execFileSync} from 'node:child_process';import {tmpdir} from 'node:os';import {join} from 'node:path';
const blobsDirectory=await mkdtemp(join(tmpdir(),'orgmap-meeting-outcomes-blobs-'));const app=await buildApp([createOrgMapIntegration({blobsDirectory})],{migrationMaxPrefix:999});after(async()=>{await app.close();await pool.end();await rm(blobsDirectory,{recursive:true,force:true});});
type Actor={id:string;cookie:string;csrf:string};
// Each registration represents an independent synthetic client; keep the real limiter active.
let registrationClient=0;
async function call(method:string,path:string,payload?:any,user?:Actor,version?:number,key:string=randomUUID()){return app.inject({remoteAddress:path==='/auth/register'?`192.0.2.${++registrationClient}`:undefined,method:method as any,url:'/api/v1'+path,payload,headers:{origin:'http://localhost:5173','idempotency-key':key,...(user?{cookie:user.cookie,'x-csrf-token':user.csrf}:{}),...(version!==undefined?{'if-match':`"${version}"`}:{})}});}
function data(r:any){assert.ok([200,201,202].includes(r.statusCode),r.body);return r.json().data;}
async function user(){const r=await call('POST','/auth/register',{email:randomUUID()+'@fixture.invalid',password:'Synthetic-password-1234',displayName:'Outcome fixture'});const d=data(r);return {id:d.account.id,cookie:`orgmap_session=${r.cookies.find((c:any)=>c.name==='orgmap_session')!.value}`,csrf:d.csrfToken};}
test('meeting outputs preserve explicit project visibility, source and replay authorization',async()=>{
 const a=await user(),b=await user(),other=await user();const A=data(await call('POST','/organizations',{name:'Outcome A'},a)),B=data(await call('POST','/organizations',{name:'Outcome B'},other));const path='/organizations/'+A.organization.id;
 const member=data(await call('POST',path+'/members',{accountId:b.id},a)).membership;
 const role=data(await call('POST',path+'/roles',{circleId:A.rootCircle.id,name:'Outcome owner',mode:'DIRECT'},a)).role;
 const series=data(await call('POST',path+'/meeting-series',{title:'Source meeting',circleId:A.rootCircle.id,localStart:'2030-03-01T12:00',timeZone:'UTC',durationMinutes:60,recurrence:{frequency:'ONCE'},sections:[{id:'agenda',title:'Agenda',kind:'AGENDA'}],participants:[{memberId:member.id,access:'EDIT',canManage:false,canPublish:false,canRestore:false}],policy:{}},a));const meeting=series.occurrenceIds[0],ep=path+'/meetings/'+meeting;
 let detail=data(await call('POST',ep+'/actions/start',{},a,1));detail=data(await call('POST',ep+'/agenda',{title:'Source item'},a,detail.meeting.version));const agendaId=detail.agenda[0].id,version=detail.meeting.version;
 const payload={kind:'PROJECT',title:'Public outcome',visibility:'PUBLIC',roleId:role.id,agendaId},key=randomUUID();const result=data(await call('POST',ep+'/outcomes',payload,a,version,key));assert.equal(result.target.kind,'PROJECT');const project=result.target.id;
 assert.equal(data(await call('GET',path+'/work/projects/'+project,undefined,a)).project.visibility,'PUBLIC');
 assert.equal(data(await call('POST',ep+'/outcomes',payload,a,version,key)).target.id,project);
 const owner=data(await call('GET',ep+'/outcomes',undefined,a));assert.ok(owner.items.some((x:any)=>x.id===project));const memberView=data(await call('GET',ep+'/outcomes',undefined,b));assert.ok(memberView.items.some((x:any)=>x.id===project));
 assert.equal(data(await call('GET',path+'/work/projects/'+project,undefined,b)).project.visibility,'PUBLIC','an explicit public outcome is readable by the meeting participant');
 const beforePrivate=data(await call('GET',ep,undefined,a));
 const privateOutput=data(await call('POST',ep+'/outcomes',{kind:'PROJECT',title:'Private outcome',visibility:'PRIVATE',roleId:role.id,agendaId},a,beforePrivate.meeting.version));
 assert.equal(data(await call('GET',path+'/work/projects/'+privateOutput.target.id,undefined,a)).project.visibility,'PRIVATE');
 assert.equal((await call('GET',path+'/work/projects/'+privateOutput.target.id,undefined,b)).statusCode,404,'meeting participation does not grant a private project');
 assert.ok(data(await call('GET',ep+'/outcomes',undefined,a)).items.some((item:any)=>item.id===privateOutput.target.id));
 const filtered=data(await call('GET',ep+'/outcomes',undefined,b));
 assert.equal(filtered.items.some((item:any)=>item.id===privateOutput.target.id),false);
 assert.doesNotMatch(JSON.stringify(filtered),/Private outcome/);
 assert.doesNotMatch(JSON.stringify(data(await call('GET',ep,undefined,b))),/Private outcome/,'meeting detail also filters inaccessible output titles');
 const origin=data(await call('GET',path+'/work/projects/'+project+'/origin',undefined,a));assert.equal(origin.origin.kind,'AGENDA');assert.equal(origin.origin.id,agendaId);assert.equal((await call('GET','/organizations/'+B.organization.id+'/work/projects/'+project+'/origin',undefined,other)).statusCode,404);
 assert.equal((await call('POST',ep+'/work-items/'+result.actionId+'/actions/complete',{},a,1)).statusCode,409);
 const latest=data(await call('GET',ep,undefined,a));data(await call('POST',ep+'/actions/close',{},a,latest.meeting.version));assert.equal((await call('POST',ep+'/outcomes',payload,a,version,key)).statusCode,409);
});
test('frozen report download fails when an included output becomes private',async()=>{
 const a=await user(),b=await user();const A=data(await call('POST','/organizations',{name:'Output export fixture'},a)),path='/organizations/'+A.organization.id;const member=data(await call('POST',path+'/members',{accountId:b.id},a)).membership;
 const series=data(await call('POST',path+'/meeting-series',{title:'Export meeting',circleId:A.rootCircle.id,localStart:'2030-03-01T12:00',timeZone:'UTC',durationMinutes:60,recurrence:{frequency:'ONCE'},sections:[{id:'agenda',title:'Agenda',kind:'AGENDA'}],participants:[{memberId:member.id,access:'EDIT',canManage:false,canPublish:false,canRestore:false}],policy:{}},a));const ep=path+'/meetings/'+series.occurrenceIds[0];let detail=data(await call('POST',ep+'/actions/start',{},a,1));
 const project=data(await call('POST',path+'/work/projects',{title:'Private project',circleId:A.rootCircle.id,visibility:'PRIVATE'},a)).project;const grant=data(await call('POST',path+'/work/projects/'+project.id+'/access',{memberId:member.id,role:'EDITOR'},a,project.version));
 const output=data(await call('POST',ep+'/outcomes',{kind:'TASK',title:'Secret task outcome',projectId:project.id},a,detail.meeting.version));detail=data(await call('GET',ep,undefined,a));data(await call('POST',ep+'/actions/close',{},a,detail.meeting.version));
 const selection=data(await call('POST',path+'/meetings/exports',{kind:'MEETING_REPORT_PDF',format:'PDF',reportSource:'CURRENT_AUTHORIZED'},b));const worker=await createPlatformWorker({blobsDirectory});assert.equal(await worker.runJob(A.organization.id,member.id),true);const job=data(await call('GET',path+'/platform/jobs/'+selection.job.id,undefined,b));assert.equal(job.state,'COMPLETED');const download=path+'/platform/artifacts/'+job.result.artifactId+'/download';const first=data(await call('GET',download,undefined,b));const firstPdf=join(blobsDirectory,'first.pdf');await writeFile(firstPdf,Buffer.from(first.base64,'base64'));assert.match(execFileSync('pdftotext',[firstPdf,'-'],{encoding:'utf8'}),/Secret task outcome/);
 data(await call('POST',path+'/work/projects/'+project.id+'/access',{memberId:member.id,role:null},a,grant.version));const denied=await call('GET',download,undefined,b);assert.equal(denied.statusCode,404);assert.doesNotMatch(denied.body,/Secret task outcome|base64/);
 const newSelection=data(await call('POST',path+'/meetings/exports',{kind:'MEETING_REPORT_PDF',format:'PDF',reportSource:'CURRENT_AUTHORIZED'},b));assert.equal(await worker.runJob(A.organization.id,member.id),true);const newJob=data(await call('GET',path+'/platform/jobs/'+newSelection.job.id,undefined,b));assert.equal(newJob.state,'COMPLETED');const newer=data(await call('GET',path+'/platform/artifacts/'+newJob.result.artifactId+'/download',undefined,b));const secondPdf=join(blobsDirectory,'second.pdf');await writeFile(secondPdf,Buffer.from(newer.base64,'base64'));assert.doesNotMatch(execFileSync('pdftotext',[secondPdf,'-'],{encoding:'utf8'}),/Secret task outcome/);assert.ok(output.target.id);
});
test('destination and source roll back together when recording outcome fails',async()=>{
 const migration=new URL(process.env.MIGRATION_DATABASE_URL??'postgres://invalid/invalid');if(!/^\/orgmap_integration_[a-f0-9]{32}$/.test(migration.pathname)||!['127.0.0.1','localhost','[::1]'].includes(migration.hostname))throw Error('ISOLATED_FIXTURE_REQUIRED');const {default:pg}=await import('pg');const admin=new pg.Pool({connectionString:migration.href});
 const a=await user(),A=data(await call('POST','/organizations',{name:'Rollback output'},a)),path='/organizations/'+A.organization.id;const role=data(await call('POST',path+'/roles',{circleId:A.rootCircle.id,name:'Rollback owner',mode:'DIRECT'},a)).role;const series=data(await call('POST',path+'/meeting-series',{title:'Rollback meeting',circleId:A.rootCircle.id,localStart:'2030-03-01T12:00',timeZone:'UTC',durationMinutes:60,recurrence:{frequency:'ONCE'},sections:[{id:'agenda',title:'Agenda',kind:'AGENDA'}],policy:{}},a));const ep=path+'/meetings/'+series.occurrenceIds[0],started=data(await call('POST',ep+'/actions/start',{},a,1));const prior=data(await call('GET',path+'/work/projects',undefined,a)).projects.length;const counts=async()=>{const c=await admin.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('orgmap.organization_id',$1,true)",[A.organization.id]);const result=await c.query("SELECT (SELECT count(*) FROM work_projects WHERE organization_id=$1) projects,(SELECT count(*) FROM meeting_actions WHERE organization_id=$1) actions,(SELECT count(*) FROM domain_events WHERE organization_id=$1) events,(SELECT count(*) FROM outbox WHERE organization_id=$1) outbox,(SELECT count(*) FROM command_results WHERE organization_id=$1) commands",[A.organization.id]);await c.query('ROLLBACK');return result.rows[0];}finally{c.release();}};const before=await counts();const key=randomUUID(),payload={kind:'PROJECT',title:'Rollback proof',roleId:role.id};
 try{await admin.query("CREATE FUNCTION fixture_outcome_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.target_kind IS NOT NULL THEN RAISE EXCEPTION 'fixture output failure'; END IF; RETURN NEW; END $$");await admin.query('CREATE TRIGGER fixture_outcome_reject BEFORE INSERT ON meeting_actions FOR EACH ROW EXECUTE FUNCTION fixture_outcome_reject()');const failed=await call('POST',ep+'/outcomes',payload,a,started.meeting.version,key);assert.equal(failed.statusCode,500);assert.deepEqual(await counts(),before);assert.equal(data(await call('GET',path+'/work/projects',undefined,a)).projects.length,prior);assert.equal(data(await call('GET',ep,undefined,a)).meeting.version,started.meeting.version);await admin.query('DROP TRIGGER fixture_outcome_reject ON meeting_actions');await admin.query('DROP FUNCTION fixture_outcome_reject()');const recovered=data(await call('POST',ep+'/outcomes',payload,a,started.meeting.version,key));assert.equal(recovered.target.kind,'PROJECT');}finally{await admin.query('DROP TRIGGER IF EXISTS fixture_outcome_reject ON meeting_actions');await admin.query('DROP FUNCTION IF EXISTS fixture_outcome_reject()');await admin.end();}
});
test('ordinary circle participant creates meeting outputs under destination permissions',async()=>{
 const owner=await user(),member=await user(),third=await user();
 const org=data(await call('POST','/organizations',{name:'Member outputs'},owner)),base='/organizations/'+org.organization.id;
 const memberRow=data(await call('POST',base+'/members',{accountId:member.id},owner)).membership;
 const thirdRow=data(await call('POST',base+'/members',{accountId:third.id},owner)).membership;
 data(await call('POST',base+'/circles/'+org.rootCircle.id+'/memberships',{memberId:memberRow.id},owner));
 const series=data(await call('POST',base+'/meeting-series',{title:'Member output meeting',circleId:org.rootCircle.id,localStart:'2030-03-01T12:00',timeZone:'UTC',durationMinutes:60,recurrence:{frequency:'ONCE'},sections:[{id:'agenda',title:'Agenda',kind:'AGENDA'}],participants:[{memberId:memberRow.id,access:'EDIT',canManage:false,canPublish:false,canRestore:false},{memberId:thirdRow.id,access:'READ',canManage:false,canPublish:false,canRestore:false}],policy:{}},owner));
 const ep=base+'/meetings/'+series.occurrenceIds[0];let meeting=data(await call('POST',ep+'/actions/start',{},owner,1));
 meeting=data(await call('POST',ep+'/agenda',{title:'Source agenda'},owner,meeting.meeting.version));const agendaId=meeting.agenda[0].id;
 async function create(payload:any){const before=data(await call('GET',ep,undefined,member));return data(await call('POST',ep+'/outcomes',{...payload,agendaId},member,before.meeting.version));}
 const project=(await create({kind:'PROJECT',title:'Member shared project',visibility:'PUBLIC',leadMemberId:memberRow.id})).target;
 const task=(await create({kind:'TASK',title:'Member project task',projectId:project.id})).target;
 const policy=(await create({kind:'POLICY',title:'Member proposed policy',content:'Policy draft'})).target;
 assert.equal(project.kind,'PROJECT');assert.equal(task.kind,'TASK');assert.equal(policy.kind,'PROPOSAL');
 for(const [path,target] of [[`/work/projects/${project.id}`,project],[`/work/tasks/${task.id}`,task],[`/proposals/${policy.id}`,policy]] as const){
  const detail=data(await call('GET',base+path,undefined,member));assert.match(JSON.stringify(detail),new RegExp(target.id));
  const origin=data(await call('GET',base+path+'/origin',undefined,member));assert.equal(origin.origin.kind,'AGENDA');assert.equal(origin.origin.id,agendaId);
 }
 const policyDetail=data(await call('GET',base+'/proposals/'+policy.id,undefined,member));assert.equal(policyDetail.proposal.state,'DRAFT');assert.equal(policyDetail.proposal.kind,'GOVERNANCE');assert.ok(policyDetail.revisions[0].payload.documents.length);
 const proposal=(await create({kind:'PROPOSAL',title:'Member document proposal',proposalKind:'GOVERNANCE',payload:policyDetail.revisions[0].payload})).target;assert.equal(proposal.kind,'PROPOSAL');
 const proposalDetail=data(await call('GET',base+'/proposals/'+proposal.id,undefined,member));assert.equal(proposalDetail.proposal.state,'DRAFT');assert.equal((await call('GET',base+'/proposals/'+proposal.id+'/origin',undefined,member)).json().data.origin.id,agendaId);
 const beforeGoal=data(await call('GET',ep,undefined,member));const goal=await call('POST',ep+'/outcomes',{kind:'GOAL',title:'Member goal',agendaId},member,beforeGoal.meeting.version);assert.equal(goal.statusCode,403);assert.equal(goal.json().error.code,'MODULE_DISABLED');
 const reloaded=data(await call('GET',ep+'/outcomes',undefined,member));for(const item of [project,task,policy,proposal])assert.ok(reloaded.items.some((x:any)=>x.id===item.id));
 const thirdView=data(await call('GET',ep,undefined,third));assert.match(JSON.stringify(thirdView),/Member shared project/);assert.equal((await call('GET',base+'/work/projects/'+project.id,undefined,third)).statusCode,200);assert.equal((await call('GET',base+'/work/tasks/'+task.id,undefined,third)).statusCode,200);
 const latest=data(await call('GET',ep,undefined,owner));data(await call('POST',ep+'/actions/close',{},owner,latest.meeting.version));const closed=data(await call('GET',ep,undefined,member));assert.equal((await call('POST',ep+'/outcomes',{kind:'PROJECT',title:'After close',leadMemberId:memberRow.id},member,closed.meeting.version)).statusCode,409);
});

test('active circle authors contribute own tensions without meeting read access',async()=>{
 const owner=await user(),reader=await user(),absent=await user(),outsider=await user();
 const org=data(await call('POST','/organizations',{name:'Circle agenda contribution'},owner)),base='/organizations/'+org.organization.id,circle=org.rootCircle.id;
 const b=data(await call('POST',base+'/members',{accountId:reader.id},owner)).membership,c=data(await call('POST',base+'/members',{accountId:absent.id},owner)).membership,d=data(await call('POST',base+'/members',{accountId:outsider.id},owner)).membership;
 const membershipB=data(await call('POST',base+'/circles/'+circle+'/memberships',{memberId:b.id},owner));
 data(await call('POST',base+'/circles/'+circle+'/memberships',{memberId:c.id},owner));
 data(await call('POST',base+'/circles/'+circle+'/memberships',{memberId:d.id},owner));
 const series=data(await call('POST',base+'/meeting-series',{title:'Circle meeting',circleId:circle,method:'HOLACRACY',localStart:'2030-03-01T12:00',timeZone:'UTC',durationMinutes:60,recurrence:{frequency:'ONCE'},sections:[{id:'agenda',title:'Agenda',kind:'AGENDA'}],participants:[{memberId:b.id,access:'READ',canManage:false,canPublish:false,canRestore:false},{memberId:d.id,access:'DENY',canManage:false,canPublish:false,canRestore:false}],policy:{}},owner));
 const mid=series.occurrenceIds[0],ep=base+'/meetings/'+mid;let meeting=data(await call('POST',ep+'/actions/start',{},owner,1));
 const t1=data(await call('POST',base+'/tensions',{title:'Reader own tension',circleId:circle},reader));
 const t2=data(await call('POST',base+'/tensions',{title:'Nonparticipant own tension',circleId:circle},absent));
 const deniedTension=data(await call('POST',base+'/tensions',{title:'Denied own tension',circleId:circle},outsider));
 const otherCircle=data(await call('POST',base+'/circles',{parentCircleId:circle,name:'Other meeting circle',mode:'DIRECT'},owner)).circle;
 data(await call('POST',base+'/circles/'+otherCircle.id+'/memberships',{memberId:c.id},owner));
 const otherSeries=data(await call('POST',base+'/meeting-series',{title:'Other circle meeting',circleId:otherCircle.id,localStart:'2030-03-01T13:00',timeZone:'UTC',durationMinutes:60,recurrence:{frequency:'ONCE'},sections:[{id:'agenda',title:'Agenda',kind:'AGENDA'}],policy:{}},owner));
 const wrongCircle=await call('POST',base+'/tensions/'+t2.id+'/actions/process',{targetKind:'AGENDA',meetingId:otherSeries.occurrenceIds[0],meetingVersion:1},absent,t2.version);
 assert.equal(wrongCircle.statusCode,422);assert.equal(wrongCircle.json().error.code,'MEETING_CIRCLE_MISMATCH');
 const managerTension=data(await call('POST',base+'/tensions',{title:'Manager own tension',circleId:otherCircle.id},owner));
 assert.equal(data(await call('POST',base+'/tensions/'+managerTension.id+'/actions/process',{targetKind:'AGENDA',meetingId:otherSeries.occurrenceIds[0],meetingVersion:1},owner,managerTension.version)).targetKind,'AGENDA');
 const guest=await user();data(await call('POST',base+'/members',{accountId:guest.id,memberType:'GUEST',accessPlan:[{resource:{context:'meetings',kind:'meeting',id:mid},actions:['read']}]},owner));
 assert.ok([403,404].includes((await call('GET',base+'/tensions/'+t2.id+'/agenda-meetings?limit=100',undefined,guest)).statusCode));
 assert.ok([403,404].includes((await call('POST',base+'/tensions/'+t2.id+'/actions/process',{targetKind:'AGENDA',meetingId:mid,meetingVersion:meeting.meeting.version},guest,t2.version)).statusCode));
 const deniedTargets=data(await call('GET',base+'/tensions/'+deniedTension.id+'/agenda-meetings?limit=100',undefined,outsider));assert.equal(deniedTargets.items.some((x:any)=>x.id===mid),false);
 assert.ok([403,404].includes((await call('POST',base+'/tensions/'+deniedTension.id+'/actions/process',{targetKind:'AGENDA',meetingId:mid,meetingVersion:meeting.meeting.version},outsider,deniedTension.version)).statusCode));
 let firstKey='',firstBody:any;
 for(const [actor,tension] of [[reader,t1],[absent,t2]] as const){
  const found=data(await call('GET',base+'/tensions/'+tension.id+'/agenda-meetings?limit=100',undefined,actor));const destination=found.items.find((x:any)=>x.id===mid);assert.ok(destination);assert.equal(destination.method,'HOLACRACY');assert.ok(Number.isFinite(Date.parse(destination.startAt)));assert.deepEqual(Object.keys(destination).sort(),['id','circleId','title','state','startAt','version','method'].sort());assert.doesNotMatch(JSON.stringify(found),/documents|notes|actions|participants/i);
  const body={targetKind:'AGENDA',meetingId:mid,meetingVersion:meeting.meeting.version},key=randomUUID();const result=data(await call('POST',base+'/tensions/'+tension.id+'/actions/process',body,actor,tension.version,key));assert.equal(result.targetKind,'AGENDA');if(actor===reader){firstKey=key;firstBody=body;}
  meeting=data(await call('GET',ep,undefined,owner));
 }
 assert.equal((await call('GET',ep,undefined,absent)).statusCode,404);
 const readDetail=data(await call('GET',ep,undefined,reader));assert.equal(readDetail.capabilities.edit,false);assert.equal(readDetail.capabilities.notes,false);assert.equal(readDetail.capabilities.manage,false);
 assert.equal((await call('POST',ep+'/actions/close',{},reader,meeting.meeting.version)).statusCode,403);
 const before=data(await call('GET',ep,undefined,owner));assert.equal(before.agenda.length,2);
 const denied=await call('GET',base+'/tensions/'+t1.id+'/agenda-meetings?limit=100',undefined,outsider);assert.ok([403,404].includes(denied.statusCode));
 const circleMembership=membershipB.membership??membershipB;data(await call('POST',base+'/circle-memberships/'+circleMembership.id+'/end',{},owner,circleMembership.version));
 assert.equal(data(await call('GET',base+'/tensions/'+t1.id+'/agenda-meetings?limit=100',undefined,reader)).items.some((item:any)=>item.id===mid),false);
 assert.ok([403,404].includes((await call('POST',base+'/tensions/'+t1.id+'/actions/process',firstBody,reader,t1.version,firstKey)).statusCode));
 assert.equal(data(await call('GET',ep,undefined,owner)).agenda.length,2);
 data(await call('PATCH',base+'/members/'+b.id,{status:'SUSPENDED'},owner,b.version));
 assert.ok([401,403,404].includes((await call('POST',base+'/tensions/'+t1.id+'/actions/process',firstBody,reader,t1.version,firstKey)).statusCode));
 data(await call('POST',ep+'/actions/close',{},owner,before.meeting.version));
 assert.ok([403,409].includes((await call('POST',base+'/tensions/'+t2.id+'/actions/process',{targetKind:'AGENDA',meetingId:mid,meetingVersion:before.meeting.version},absent,t2.version)).statusCode));
});

test('meeting governance applies update and move of one entity against one base version atomically',async()=>{
 const owner=await user(),org=data(await call('POST','/organizations',{name:'Combined structure proposal'},owner)),base='/organizations/'+org.organization.id,root=org.rootCircle.id;
 const series=data(await call('POST',base+'/meeting-series',{title:'Structure decisions',circleId:root,localStart:'2030-03-01T12:00',timeZone:'UTC',durationMinutes:60,recurrence:{frequency:'ONCE'},sections:[{id:'agenda',title:'Agenda',kind:'AGENDA'}],policy:{}},owner));
 const ep=base+'/meetings/'+series.occurrenceIds[0];data(await call('POST',ep+'/actions/start',{},owner,1));
 const migration=new URL(process.env.MIGRATION_DATABASE_URL??'postgres://invalid/invalid');if(!/^\/orgmap_integration_[a-f0-9]{32}$/.test(migration.pathname)||!['127.0.0.1','localhost','[::1]'].includes(migration.hostname))throw Error('ISOLATED_FIXTURE_REQUIRED');
 async function persisted(ids:string[]){const {default:pg}=await import('pg');const admin=new pg.Pool({connectionString:migration.href});try{const client=await admin.connect();try{await client.query('BEGIN');await client.query("SELECT set_config('orgmap.organization_id',$1,true)",[org.organization.id]);const entities=(await client.query('SELECT id,name,purpose,version FROM entities WHERE organization_id=$1 AND id=ANY($2::uuid[]) ORDER BY id',[org.organization.id,ids])).rows;const history=(await client.query("SELECT resource_id,count(*)::int n FROM structure_history WHERE organization_id=$1 AND resource_id=ANY($2::uuid[]) AND action='StructureChangeSetApplied' GROUP BY resource_id ORDER BY resource_id",[org.organization.id,ids])).rows;await client.query('ROLLBACK');return {entities,history};}finally{client.release();}}finally{await admin.end();}}
 async function decideAndApply(changes:any[],expectFailure:false|'cycle'|'stale'=false){const meeting=data(await call('GET',ep,undefined,owner));const result=data(await call('POST',ep+'/outcomes',{kind:'PROPOSAL',title:'Structure change',proposalKind:'GOVERNANCE',payload:{changes}},owner,meeting.meeting.version));const pid=result.target.id;
  data(await call('POST',base+'/proposals/'+pid+'/actions/submit',{},owner,1));data(await call('POST',base+'/proposals/'+pid+'/votes',{choice:'CONSENT'},owner,2));
  for(const step of ['CLARIFY','REACT','OBJECT','DECIDE'])data(await call('POST',base+'/proposals/'+pid+'/actions/step',{step},owner,2));
  data(await call('POST',base+'/proposals/'+pid+'/actions/decide',{verdict:'ADOPT',reason:'Approved'},owner,2));const applied=await call('POST',base+'/proposals/'+pid+'/actions/apply',{},owner,3);if(expectFailure){assert.equal(applied.statusCode,expectFailure==='cycle'?422:409,applied.body);assert.equal(applied.json().error.code,expectFailure==='cycle'?'STRUCTURE_CYCLE':'APPLY_CONFLICT');if(expectFailure==='stale')assert.equal(applied.json().error.conflictDetails.conflictCode,'VERSION_CONFLICT');return null;}return {...data(applied),proposalId:pid};}
 const circle=randomUUID(),role=randomUUID();assert.equal((await decideAndApply([{kind:'CREATE',entityId:circle,entityKind:'CIRCLE',parentCircleId:root,name:'Target circle',purpose:'Original circle'},{kind:'CREATE',entityId:role,entityKind:'ROLE',parentCircleId:root,name:'Original role',purpose:'Original purpose'}])).applyState,'APPLIED');
 let nodes=data(await call('GET',base+'/structure',undefined,owner)).nodes;let r=nodes.find((n:any)=>n.entityId===role),c=nodes.find((n:any)=>n.entityId===circle);assert.ok(r&&c);const roleVersion=r.version,circleVersion=c.version,rootNodeId=nodes.find((n:any)=>n.entityId===root).nodeId;const persistedBefore=await persisted([role,circle]);
 const combined=[{kind:'UPDATE',entityId:role,baseVersion:roleVersion,name:'Updated role',purpose:'Updated purpose'},{kind:'UPDATE',entityId:circle,baseVersion:circleVersion,name:'Updated circle',purpose:'Updated circle purpose'},{kind:'MOVE',entityId:role,baseVersion:roleVersion,parentCircleId:circle}];
 const combinedApplied=await decideAndApply(combined);assert.equal(combinedApplied.applyState,'APPLIED');const originalProposal=data(await call('GET',base+'/proposals/'+combinedApplied.proposalId,undefined,owner));nodes=data(await call('GET',base+'/structure',undefined,owner)).nodes;r=nodes.find((n:any)=>n.entityId===role);c=nodes.find((n:any)=>n.entityId===circle);assert.equal(r.name,'Updated role');assert.equal(r.parentNodeId,c.nodeId);assert.equal(r.version,roleVersion+1);assert.equal(c.name,'Updated circle');assert.equal(c.version,circleVersion+1);const persistedAfter=await persisted([role,circle]);for(const [entityId,purpose] of [[role,'Updated purpose'],[circle,'Updated circle purpose']]){assert.equal(persistedAfter.entities.find((e:any)=>e.id===entityId).purpose,purpose);assert.equal(persistedAfter.history.find((h:any)=>h.resource_id===entityId).n,persistedBefore.history.find((h:any)=>h.resource_id===entityId).n+1);}
 const reverse=[{kind:'MOVE',entityId:role,baseVersion:r.version,parentCircleId:root},{kind:'UPDATE',entityId:role,baseVersion:r.version,name:'Reversed role'}];assert.equal((await decideAndApply(reverse)).applyState,'APPLIED');
 const after=data(await call('GET',base+'/structure',undefined,owner)).nodes.find((n:any)=>n.entityId===role);assert.equal(after.name,'Reversed role');assert.equal(after.parentNodeId,rootNodeId);assert.equal(after.version,r.version+1);
 const cycleBefore=data(await call('GET',base+'/structure',undefined,owner)).nodes;await decideAndApply([{kind:'UPDATE',entityId:role,baseVersion:after.version,name:'Must rollback'},{kind:'MOVE',entityId:circle,baseVersion:c.version,parentCircleId:circle}],'cycle');assert.deepEqual(data(await call('GET',base+'/structure',undefined,owner)).nodes,cycleBefore);
 const staleBefore=await persisted([role,circle]);await decideAndApply([{kind:'UPDATE',entityId:role,baseVersion:roleVersion,name:'Stale update'},{kind:'MOVE',entityId:role,baseVersion:roleVersion,parentCircleId:circle},{kind:'UPDATE',entityId:circle,baseVersion:c.version,name:'Must not apply'}],'stale');assert.deepEqual(await persisted([role,circle]),staleBefore);
 const current=data(await call('GET',ep,undefined,owner)),proposalsBefore=data(await call('GET',base+'/proposals',undefined,owner));for(const [invalid,status,code] of [[[ {kind:'UPDATE',entityId:role,baseVersion:after.version,name:'x'},{kind:'MOVE',entityId:role,baseVersion:after.version+1,parentCircleId:circle}],409,'VERSION_CONFLICT'],[[{kind:'UPDATE',entityId:role,baseVersion:after.version,name:'x'},{kind:'UPDATE',entityId:role,baseVersion:after.version,name:'y'}],422,'DUPLICATE_ENTITY_CHANGE']]){const response=await call('POST',ep+'/outcomes',{kind:'PROPOSAL',title:'Invalid combination',proposalKind:'GOVERNANCE',payload:{changes:invalid}},owner,current.meeting.version);assert.equal(response.statusCode,status,response.body);assert.equal(response.json().error.code,code);assert.equal(data(await call('GET',ep,undefined,owner)).meeting.version,current.meeting.version);assert.deepEqual(data(await call('GET',ep,undefined,owner)).actions,current.actions);assert.deepEqual(data(await call('GET',base+'/proposals',undefined,owner)),proposalsBefore);}
 const untouched=data(await call('GET',base+'/structure',undefined,owner)).nodes.find((n:any)=>n.entityId===role);assert.equal(untouched.version,after.version);assert.equal(untouched.name,after.name);
 assert.equal((await decideAndApply([{kind:'ARCHIVE',entityId:role,baseVersion:after.version},{kind:'ARCHIVE',entityId:circle,baseVersion:c.version}])).applyState,'APPLIED');
 const archived=data(await call('GET',base+'/proposals/'+combinedApplied.proposalId,undefined,owner));assert.deepEqual(archived.revisions,originalProposal.revisions);
 for(const [entityId,name,kind] of [[role,'Reversed role','ROLE'],[circle,'Updated circle','CIRCLE']])assert.deepEqual(archived.entityReferences.find((ref:any)=>ref.entityId===entityId),{entityId,name,kind,archived:true});
 assert.deepEqual(data(await call('GET',base+'/proposals/'+combinedApplied.proposalId,undefined,owner)).entityReferences,archived.entityReferences);
 const foreign=await user();data(await call('POST','/organizations',{name:'Other tenant'},foreign));assert.equal((await call('GET',base+'/proposals/'+combinedApplied.proposalId,undefined,foreign)).statusCode,404);
 const guest=await user(),member=data(await call('POST',base+'/members',{accountId:guest.id,memberType:'GUEST',accessPlan:[{resource:{context:'governance',kind:'proposal',id:combinedApplied.proposalId},actions:['read']}]},owner)).membership;
 const shared=data(await call('GET',base+'/proposals/'+combinedApplied.proposalId,undefined,guest));assert.deepEqual(shared.entityReferences,[]);
 const grants=data(await call('GET',base+'/members/'+member.id+'/access-grants',undefined,owner)).items,grant=grants.find((x:any)=>x.resourceId===combinedApplied.proposalId);assert.ok(grant);data(await call('POST',base+'/members/'+member.id+'/access-grants/'+grant.id+'/revoke',{},owner,grant.version));assert.equal((await call('GET',base+'/proposals/'+combinedApplied.proposalId,undefined,guest)).statusCode,404);
});

test('distinct governed fields on one entity remain independent',()=>{const entityId=randomUUID(),a=randomUUID(),b=randomUUID();const result=governanceChanges([{kind:'FIELD',entityId,fieldId:a,baseVersion:1,value:'A'},{kind:'FIELD',entityId,fieldId:b,baseVersion:1,value:'B'}]);assert.equal(result.length,2);assert.notEqual((result[0] as any).fieldId,(result[1] as any).fieldId);});
test('project outcome records a circle role and its occupant as responsibles',async()=>{
 const owner=await user(),occupant=await user(),org=data(await call('POST','/organizations',{name:'Responsible outcome'},owner)),base='/organizations/'+org.organization.id;
 const member=data(await call('POST',base+'/members',{accountId:occupant.id},owner)).membership;
 const role=data(await call('POST',base+'/roles',{circleId:org.rootCircle.id,name:'Energizer',mode:'DIRECT'},owner)).role;
 data(await call('POST',base+'/roles/'+role.id+'/occupancies',{memberId:member.id,kind:'DIRECT'},owner));
 const sub=data(await call('POST',base+'/circles',{parentCircleId:org.rootCircle.id,name:'Inner circle',mode:'DIRECT'},owner)).circle;
 const foreign=data(await call('POST',base+'/roles',{circleId:sub.id,name:'Other circle role',mode:'DIRECT'},owner)).role;
 const series=data(await call('POST',base+'/meeting-series',{title:'Responsible meeting',circleId:org.rootCircle.id,localStart:'2030-03-01T12:00',timeZone:'UTC',durationMinutes:60,recurrence:{frequency:'ONCE'},sections:[{id:'agenda',title:'Agenda',kind:'AGENDA'}],policy:{}},owner));
 const ep=base+'/meetings/'+series.occurrenceIds[0];const started=data(await call('POST',ep+'/actions/start',{},owner,1));
 const version=async()=>data(await call('GET',ep,undefined,owner)).meeting.version;
 const created=data(await call('POST',ep+'/outcomes',{kind:'PROJECT',title:'Role owned project',description:'Born in a meeting',visibility:'PRIVATE',roleId:role.id,leadMemberId:member.id},owner,await version()));
 const project=data(await call('GET',base+'/work/projects/'+created.target.id,undefined,owner)).project;
 assert.equal(project.leadMemberId,member.id);
 assert.equal(project.visibility,'PRIVATE','the requested privacy is preserved even when the project has a responsible role and person');
 assert.equal((await call('GET',base+'/work/projects/'+created.target.id,undefined,occupant)).statusCode,404,'being responsible does not grant access to a private project');
 assert.equal(project.description,'Born in a meeting');
 assert.ok((project.contextLinks??[]).some((link:any)=>link.kind==='ROLE'&&link.targetId===role.id));
 const outsider=(data(await call('POST',base+'/members',{accountId:(await user()).id},owner)).membership.id);
 for(const [payload,status,code] of [
  [{kind:'PROJECT',title:'No responsible'},400,'INVALID_REQUEST'],
  [{kind:'TASK',title:'Role on task',roleId:role.id},400,'INVALID_REQUEST'],
  [{kind:'PROJECT',title:'Foreign circle role',roleId:foreign.id},404,'RESOURCE_NOT_FOUND'],
  [{kind:'PROJECT',title:'Non occupant lead',roleId:role.id,leadMemberId:outsider},404,'RESOURCE_NOT_FOUND'],
  [{kind:'PROJECT',title:'Direct outsider lead',leadMemberId:outsider},404,'RESOURCE_NOT_FOUND'],
 ] as const){const response=await call('POST',ep+'/outcomes',payload,owner,await version());assert.equal(response.statusCode,status,response.body);assert.equal(response.json().error.code,code);}
 const direct=data(await call('POST',ep+'/outcomes',{kind:'PROJECT',title:'Person owned project',leadMemberId:member.id},owner,await version()));
 const directProject=data(await call('GET',base+'/work/projects/'+direct.target.id,undefined,owner)).project;
 assert.equal(directProject.leadMemberId,member.id,'circle person may own the project directly');
 assert.equal(directProject.visibility,'PRIVATE','an outcome without a visibility override defaults to private');
});
test('proposal outcome exposes what it proposes in the meeting detail',async()=>{
 const owner=await user(),org=data(await call('POST','/organizations',{name:'Outcome proposal summary'},owner)),base='/organizations/'+org.organization.id,root=org.rootCircle.id;
 const kept=data(await call('POST',base+'/roles',{circleId:root,name:'Existing role',mode:'DIRECT'},owner)).role,doomed=data(await call('POST',base+'/roles',{circleId:root,name:'Doomed role',mode:'DIRECT'},owner)).role;
 const nodes=data(await call('GET',base+'/structure',undefined,owner)).nodes,version=(id:string)=>nodes.find((n:any)=>n.entityId===id).version;
 const series=data(await call('POST',base+'/meeting-series',{title:'Summary meeting',circleId:root,localStart:'2030-03-01T12:00',timeZone:'UTC',durationMinutes:60,recurrence:{frequency:'ONCE'},sections:[{id:'agenda',title:'Agenda',kind:'AGENDA'}],policy:{}},owner));
 const ep=base+'/meetings/'+series.occurrenceIds[0],started=data(await call('POST',ep+'/actions/start',{},owner,1));
 const proposal=data(await call('POST',ep+'/outcomes',{kind:'PROPOSAL',title:'Structure proposal',proposalKind:'GOVERNANCE',payload:{changes:[{kind:'CREATE',entityId:randomUUID(),entityKind:'ROLE',parentCircleId:root,name:'Included role',purpose:'Why'},{kind:'UPDATE',entityId:kept.id,baseVersion:version(kept.id),name:'Renamed role'},{kind:'ARCHIVE',entityId:doomed.id,baseVersion:version(doomed.id)}]}},owner,started.meeting.version)).target;
 const policy=data(await call('POST',ep+'/outcomes',{kind:'POLICY',title:'Circle policy',content:'Draft text'},owner,data(await call('GET',ep,undefined,owner)).meeting.version)).target;
 const detail=data(await call('GET',ep,undefined,owner));
 const byTarget=Object.fromEntries(detail.actions.filter((a:any)=>a.targetId).map((a:any)=>[a.targetId,a]));
 const proposalDetail=byTarget[proposal.id]?.targetProposal;
 assert.deepEqual(proposalDetail?.payload?.changes?.map((change:any)=>change.kind),['CREATE','UPDATE','ARCHIVE']);
 const names=proposalDetail?.entityReferences?.map((row:any)=>row.name)??[];
 assert.ok(names.includes('Existing role')&&names.includes('Doomed role'));
 assert.equal(proposalDetail?.state,'DRAFT');
 assert.ok(proposalDetail?.authorId&&proposalDetail?.version>=1);
 const policyDetail=byTarget[policy.id]?.targetProposal;
 assert.equal(policyDetail?.documents?.[0]?.title,'Circle policy');
 assert.equal(policyDetail?.documents?.[0]?.proposedContent,'Draft text');
 assert.equal(policyDetail?.documents?.[0]?.publishedContent,null);
 const withdraw=data(await call('POST',base+'/proposals/'+proposal.id+'/actions/withdraw',{reason:'No longer needed'},owner,proposalDetail.version));
 assert.equal(withdraw.state,'WITHDRAWN');
 const afterWithdraw=Object.fromEntries(data(await call('GET',ep,undefined,owner)).actions.filter((a:any)=>a.targetId).map((a:any)=>[a.targetId,a]));
 assert.equal(afterWithdraw[proposal.id]?.targetProposal?.state,'WITHDRAWN');
 const migration=new URL(process.env.MIGRATION_DATABASE_URL??'postgres://invalid/invalid');if(!/^\/orgmap_integration_[a-f0-9]{32}$/.test(migration.pathname)||!['127.0.0.1','localhost','[::1]'].includes(migration.hostname))throw Error('ISOLATED_FIXTURE_REQUIRED');const {default:pg}=await import('pg');const admin=new pg.Pool({connectionString:migration.href});
 try{
  const tension=data(await call('POST',base+'/tensions',{title:'Origin tension',circleId:root},owner));
  await admin.query('UPDATE gov_proposals SET tension_id=$1 WHERE id=$2',[tension.id,proposal.id]);
  const linked=Object.fromEntries(data(await call('GET',ep,undefined,owner)).actions.filter((a:any)=>a.targetId).map((a:any)=>[a.targetId,a]));
  const origin=linked[proposal.id]?.targetProposal?.originTension;
  assert.equal(origin?.id,tension.id);
  assert.equal(origin?.title,'Origin tension');
  assert.notEqual(origin?.state,'CLOSED');
  const closed=data(await call('POST',base+'/tensions/'+tension.id+'/actions/close',{},owner,origin.version));
  assert.equal(closed.state,'CLOSED');
  const agendaTension=data(await call('POST',base+'/tensions',{title:'Agenda tension',circleId:root},owner));
  const current=data(await call('GET',ep,undefined,owner));
  data(await call('POST',base+'/tensions/'+agendaTension.id+'/actions/process',{targetKind:'AGENDA',meetingId:series.occurrenceIds[0],meetingVersion:current.meeting.version},owner,agendaTension.version));
  const withPlacement=data(await call('GET',ep,undefined,owner));
  const placement=(withPlacement.agenda as any[]).find((a:any)=>a.sourceId===agendaTension.id);
  assert.ok(placement,'tension processed to agenda exposes its placement');
  const agendaProposal=data(await call('POST',ep+'/outcomes',{kind:'PROPOSAL',title:'Agenda proposal',agendaId:placement.id,proposalKind:'GOVERNANCE',payload:{changes:[{kind:'CREATE',entityId:randomUUID(),entityKind:'ROLE',parentCircleId:root,name:'Agenda role',purpose:'Agenda purpose'}]}},owner,withPlacement.meeting.version)).target;
  const agendaDetail=data(await call('GET',base+'/proposals/'+agendaProposal.id,undefined,owner));
  const withdrawnAgenda=data(await call('POST',base+'/proposals/'+agendaProposal.id+'/actions/withdraw',{reason:'Discarded in meeting'},owner,agendaDetail.proposal.version));
  assert.equal(withdrawnAgenda.state,'WITHDRAWN');
  const relinked=Object.fromEntries(data(await call('GET',ep,undefined,owner)).actions.filter((a:any)=>a.targetId).map((a:any)=>[a.targetId,a]));
  const agendaOrigin=relinked[agendaProposal.id]?.targetProposal?.originTension;
  assert.equal(agendaOrigin?.id,agendaTension.id,'proposal resolves origin tension through the meeting agenda link');
  assert.equal(agendaOrigin?.title,'Agenda tension');
  const closedAgenda=data(await call('POST',base+'/tensions/'+agendaTension.id+'/actions/close',{},owner,agendaOrigin.version));
  assert.equal(closedAgenda.state,'CLOSED','withdrawn proposal does not block tension closure');
 }finally{await admin.end();}
});
