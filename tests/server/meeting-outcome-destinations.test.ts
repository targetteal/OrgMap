import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createRuntime,type Ctx} from '../../server/src/runtime.js';
import {createWorkMeetingOutcomePort} from '../../server/modules/work/meeting-outcomes.js';
import {createGoalsMeetingOutcomePort} from '../../server/modules/goals/meeting-outcomes.js';
import {createGovernanceMeetingOutcomePort} from '../../server/modules/governance/meeting-outcomes.js';
import type {MeetingOutcomeInput} from '../../server/modules/meetings/outcomes.js';

test('destination owners authorize current ACL and create actual resources in the caller transaction',async()=>{
 const url=new URL(process.env.DATABASE_URL??'postgres://invalid/');if(!/^\/orgmap_integration_[a-f0-9]{32}$/.test(url.pathname)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('EXCLUSIVE_INTEGRATION_TEST_DATABASE_REQUIRED');
 const admin=new pg.Pool({connectionString:process.env.MIGRATION_DATABASE_URL}),app=new pg.Pool({connectionString:url.href});const c=await app.connect();
 const org=randomUUID(),circle=randomUUID(),role=randomUUID(),owner=randomUUID(),member=randomUUID(),account=randomUUID(),otherAccount=randomUUID(),period=randomUUID(),meeting=randomUUID();
 try {
  await admin.query("INSERT INTO accounts(id,email,display_name,password_hash) VALUES($1,$2,'Owner','x'),($3,$4,'Other','x')",[account,`${account}@example.test`,otherAccount,`${otherAccount}@example.test`]);
  await admin.query("INSERT INTO organizations(id,name,locale,time_zone) VALUES($1,'A','pt-BR','UTC')",[org]);
  await admin.query("INSERT INTO members(organization_id,id,account_id,org_role) VALUES($1,$2,$3,'OWNER'),($1,$4,$5,'MEMBER')",[org,owner,account,member,otherAccount]);
  await admin.query("INSERT INTO entities(organization_id,id,node_id,kind,name) VALUES($1,$2,$3,'CIRCLE','Circle')",[org,circle,randomUUID()]);
  await admin.query("INSERT INTO entities(organization_id,id,node_id,kind,name,parent_id) VALUES($1,$2,$3,'ROLE','Responsible',$4)",[org,role,randomUUID(),circle]);
  await admin.query("INSERT INTO goal_periods(organization_id,id,title,starts_on,ends_on) VALUES($1,$2,'Current',CURRENT_DATE-1,CURRENT_DATE+1)",[org,period]);
  await c.query('BEGIN');await c.query("SELECT set_config('orgmap.organization_id',$1,true)",[org]);
  const ctx={c,org:{id:org,time_zone:'UTC'},member:{id:owner,organization_id:org,account_id:account,status:'ACTIVE',member_type:'MEMBER',org_role:'OWNER'},account:{id:account},mode:'write'} as Ctx;
  const other={...ctx,member:{...ctx.member,id:member,account_id:otherAccount,org_role:'MEMBER'},account:{id:otherAccount}} as Ctx;
  const work=createWorkMeetingOutcomePort(createRuntime()),goals=createGoalsMeetingOutcomePort(),gov=createGovernanceMeetingOutcomePort();
  const base={meetingId:meeting,circleId:circle,agendaId:null,title:'Saída real'};
  await assert.rejects(work.create(ctx,{...base,kind:'PROJECT'}),/INVALID_REQUEST/);
  await assert.rejects(work.create(ctx,{...base,kind:'PROJECT',workLink:{kind:'MEMBER',targetId:owner}}),/INVALID_REQUEST/,'an optional work link does not supply the project responsible');
  const project=await work.create(ctx,{...base,kind:'PROJECT',roleId:role});assert.equal(project.kind,'PROJECT');
  assert.equal((await c.query('SELECT visibility FROM work_projects WHERE organization_id=$1 AND id=$2',[org,project.id])).rows[0].visibility,'PRIVATE');
  await assert.rejects(work.authorize(other,{...base,kind:'TASK',projectId:project.id}),/RESOURCE_NOT_FOUND/);
  const task=await work.create(ctx,{...base,kind:'TASK',projectId:project.id});assert.equal((await c.query('SELECT project_id FROM work_tasks WHERE organization_id=$1 AND id=$2',[org,task.id])).rows[0].project_id,project.id);
  assert.equal(await work.read(other,{kind:'TASK',id:task.id}),null);
  await c.query("UPDATE work_access SET role='READER' WHERE organization_id=$1 AND project_id=$2 AND member_id=$3",[org,project.id,owner]);
  await assert.rejects(work.authorize(ctx,{...base,kind:'TASK',projectId:project.id}),/ACTION_DENIED/);
  await c.query("UPDATE work_access SET role='MANAGER' WHERE organization_id=$1 AND project_id=$2 AND member_id=$3",[org,project.id,owner]);
  await c.query('UPDATE work_projects SET frozen=true WHERE organization_id=$1 AND id=$2',[org,project.id]);
  await assert.rejects(work.authorize(ctx,{...base,kind:'TASK',projectId:project.id}),/PROJECT_FROZEN/);
  await c.query('UPDATE work_projects SET frozen=false WHERE organization_id=$1 AND id=$2',[org,project.id]);

  const goal=await goals.create(ctx,{...base,kind:'GOAL',periodId:period});assert.equal((await c.query('SELECT privacy FROM goals WHERE organization_id=$1 AND id=$2',[org,goal.id])).rows[0].privacy,'PRIVATE');assert.equal(await goals.read(other,{kind:'GOAL',id:goal.id}),null);
  await c.query("INSERT INTO goal_periods(organization_id,id,title,starts_on,ends_on) VALUES($1,$2,'Overlap',CURRENT_DATE-1,CURRENT_DATE+1)",[org,randomUUID()]);
  await assert.rejects(goals.create(ctx,{...base,kind:'GOAL'}),/GOAL_PERIOD_SELECTION_REQUIRED/);
  const selected=await goals.create(ctx,{...base,kind:'GOAL',periodId:period});assert.equal(selected.kind,'GOAL');
  await assert.rejects(gov.authorize(other,{...base,kind:'PROPOSAL'}),/ACTION_DENIED/);
  const proposal=await gov.create(ctx,{...base,kind:'PROPOSAL',proposalKind:'GOVERNANCE',payload:{changes:[{kind:'UPDATE',entityId:circle,baseVersion:1,name:'Updated'}]}});
  assert.equal((await c.query('SELECT state FROM gov_proposals WHERE organization_id=$1 AND id=$2',[org,proposal.id])).rows[0].state,'DRAFT');
  const policy=await gov.create(ctx,{...base,kind:'POLICY',content:'Proposta de acordo'});
  const p=(await c.query('SELECT p.kind,p.state,r.payload FROM gov_proposals p JOIN gov_revisions r ON r.organization_id=p.organization_id AND r.proposal_id=p.id WHERE p.organization_id=$1 AND p.id=$2',[org,policy.id])).rows[0];
  assert.equal(p.kind,'GOVERNANCE');assert.equal(p.state,'DRAFT');assert.equal(p.payload.documents[0].documentVersion,1);
  assert.equal((await c.query('SELECT workflow,published_version FROM gov_documents WHERE organization_id=$1 AND id=$2',[org,p.payload.documents[0].documentId])).rows[0].published_version,null);
  assert.equal(await gov.read(other,{kind:'PROPOSAL',id:proposal.id}),null);
  await assert.rejects(goals.authorize(other,{...base,kind:'GOAL'}),/ACTION_DENIED/);
  await c.query('ROLLBACK');
  assert.equal((await admin.query('SELECT count(*)::int n FROM work_projects WHERE organization_id=$1',[org])).rows[0].n,0);
  assert.equal((await admin.query('SELECT count(*)::int n FROM goals WHERE organization_id=$1',[org])).rows[0].n,0);
  assert.equal((await admin.query('SELECT count(*)::int n FROM gov_proposals WHERE organization_id=$1',[org])).rows[0].n,0);
 } finally {await c.query('ROLLBACK').catch(()=>{});c.release();await app.end();await admin.end();}
});
