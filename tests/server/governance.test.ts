import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../server/src/app.js";
import {foundationDefaultAdmissionPolicy} from '../../server/src/admission.js';
import { pool, transaction } from "../../server/src/db.js";
import { createGovernanceResourceAdapters } from "../../server/modules/governance/ports.js";
import { createGovernanceModule } from "../../server/modules/governance/plugin.js";
import { Governance, validateOrgPolicy, type GovernancePorts,type OrganizationalGovernancePolicy } from "../../server/modules/governance/service.js";
import {createGovernanceRuntimePorts} from "../../server/modules/governance/guest.js";
import type {ModuleRuntime} from "../../server/src/runtime.js";
import {createMeetings} from "../../server/modules/meetings/plugin.js";
import {createMeetingAgendaCommandPort} from "../../server/modules/meetings/agenda-port.js";
import {selfOnlyPorts} from "../../server/modules/meetings/service.js";
import { createGovernanceMeetingItems } from "../../server/modules/governance/meeting-items.js";
import { createGovernanceTraceReader } from '../../server/modules/governance/trace.js';
import { createMeetingTraceReader } from '../../server/modules/meetings/trace.js';
import { createWorkTraceReader } from '../../server/modules/work/index.js';
import { createGoalResourceAdapters } from '../../server/modules/goals/ports.js';
import type { TraceabilityPort } from '../../server/src/traceability.js';
import { validateRichDocument,toPlainText,renderHTML,readContent } from "../../packages/content/index.js";
import {mandateInput,mandateInstant} from "../../web/src/features/governance/date-input.js";
import {
  defaultPolicy,
  mayVote,
  verdict,
} from "../../server/modules/governance/domain.js";
import { fail } from "../../server/src/core.js";
import { createStructurePorts } from "../../server/modules/structure/applier.js";
import { registerContext as structureModule } from "../../server/modules/structure/plugin.js";
import { createWorkApplicationPorts } from "../../server/modules/work/application.js";
import { createGoalFromTension } from "../../server/modules/goals/services.js";
import { registerContext as goalsModule } from "../../server/modules/goals/plugin.js";
let governanceCore:ModuleRuntime,governancePorts:GovernancePorts;
const disabledMeetingOrgs=new Set<string>();
const disabledGovernanceOrgs=new Set<string>();
const sharedTrace={} as TraceabilityPort;
// These fixtures require established membership, independent of host/DB clock drift.
const activeMembershipStart='2020-01-01T00:00:00.000Z';
const meetingPorts={...selfOnlyPorts,readPolicy:{trace:sharedTrace} as import('../../server/modules/meetings/service.js').MeetingReadPolicy,linkedItems:async(ctx:any,input:{circleId:string})=>createGovernanceMeetingItems(governancePorts)(ctx,{circleIds:[input.circleId]})};
const app = await buildApp([
  foundationDefaultAdmissionPolicy,
  async(_app,core)=>{
    core.registerModuleScope({module:"meetings",routePrefixes:[],resourceTypes:["meeting","report"]});
    core.registerOrganizationSettings(async ctx=>({version:1,settings:{name:ctx.org.name,locale:ctx.org.locale,timezone:ctx.org.time_zone,modules:{structure:true,work:true,goals:true,governance:!disabledGovernanceOrgs.has(ctx.org.id),meetings:!disabledMeetingOrgs.has(ctx.org.id)}}}));
  },
  structureModule,
  goalsModule,
  createMeetings(meetingPorts),
  async (app, core) => {
    governanceCore=core;
    const ports = createStructurePorts(core);
    const work = createWorkApplicationPorts(core);
    const agenda=createMeetingAgendaCommandPort(core,meetingPorts);
    const configured:GovernancePorts={
      ...ports,
      agenda:{authorize:agenda.authorize,proposalPlacements:agenda.proposalPlacements,targets:async()=>({items:[],page:{hasMore:false,nextCursor:null}}),addTension:async(ctx,request,input)=>{
        const result=await agenda.addTension(ctx,request,input);
        if(input.source.title==='Falha após criar agenda')fail(409,'TEST_SOURCE_FAILURE_AFTER_AGENDA');
        return result;
      }},
      // Integration harness owns admin storage; production GOV never queries it.
      organizationalPolicy: async ctx => {
        const row = (await ctx.c.query(
          "SELECT value FROM administration_records WHERE organization_id=$1 AND kind='policy' AND value->>'key'='governance.method' AND NOT (value ? 'parentId')",
          [ctx.org.id],
        )).rows[0];
        return row?.value ?? null;
      },
      createFromTension: async (ctx, input) => {
        const result =
          input.kind === "TASK"
            ? await work.createTaskFromTension(ctx, input)
            : await createGoalFromTension(ctx, input);
        if (input.title === "Falha após criar alvo")
          fail(409, "TARGET_TEST_FAILURE");
        return result;
      },
      applyStructure: async (ctx, input) => {
        if (
          !input.changes.some(
            (c) => c.kind === "UPDATE" && c.purpose === "Novo",
          )
        )
          return ports.applyStructure(ctx, input);
        await ports.applyStructure(ctx, input);
        await ctx.c.query(
          "INSERT INTO gov_history(organization_id,id,resource_id,actor_id,action,snapshot) VALUES($1,$2,$3,$4,'TEST_PARTIAL','{}')",
          [ctx.org.id, randomUUID(), randomUUID(), ctx.member.id],
        );
        fail(409, "VERSION_CONFLICT");
      },
    };
    governancePorts=createGovernanceRuntimePorts(core,configured);
    const govTrace=createGovernanceTraceReader(core,governancePorts),workTrace=createWorkTraceReader(core),meetingTrace=createMeetingTraceReader(core,meetingPorts),goalTrace=createGoalResourceAdapters().goal;
    const trace:TraceabilityPort={tension:govTrace.tension,goalOrigin:govTrace.goalOrigin,destination:async(ctx,kind,rid)=>{
      if(kind==='TASK')return workTrace(ctx,rid);
      if(kind==='AGENDA')return meetingTrace(ctx,rid);
      if(kind==='PROPOSAL')return govTrace.proposal(ctx,rid);
      await core.assertModuleAvailable(ctx,'goals');
      const item=await goalTrace.lookup!(ctx,rid);return item?{kind:'GOAL',...item}:null;
    }};
    governancePorts.trace=trace;Object.assign(sharedTrace,trace);
    return createGovernanceModule(governancePorts)(app, core);
  },
]);
// Opt-in diagnostics preserve the real error handler and authorization decisions.
if (process.env.GOVERNANCE_TEST_DIAGNOSTICS === '1') app.addHook('onError', async (request, _reply, error) => {
  const cause=error as Error & {code?:string;constraint?:string;table?:string};
  console.error('governance-test-error', JSON.stringify({method:request.method,url:request.url,code:cause.code,constraint:cause.constraint,table:cause.table,message:cause.message,stack:cause.stack}));
});
async function withOrg<T>(
  organizationId: string,
  u: User,
  work: (ctx: any) => Promise<T>,
) {
  return transaction(async (c) => {
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
      organizationId,
    ]);
    const org = (
      await c.query("SELECT * FROM organizations WHERE id=$1 FOR UPDATE", [
        organizationId,
      ])
    ).rows[0];
    const member = (
      await c.query(
        "SELECT * FROM members WHERE organization_id=$1 AND account_id=$2",
        [organizationId, u.id],
      )
    ).rows[0];
    return work({ c, org, member, account: { id: u.id }, mode: "write" });
  });
}
after(async () => {
  await app.close();
  await pool.end();
});
type User = { cookie: string; csrf: string; id: string };
let registrationClient=0;
async function call(
  method: string,
  path: string,
  b?: any,
  u?: User,
  ver?: number,
  key = randomUUID(),
) {
  return app.inject({
    // Independent synthetic clients; keep the real auth limiter enabled.
    remoteAddress: path==='/auth/register'?`192.0.2.${++registrationClient}`:undefined,
    method: method as any,
    url: "/api/v1" + path,
    headers: {
      origin: "http://localhost:5173",
      "idempotency-key": key,
      ...(u ? { cookie: u.cookie, "x-csrf-token": u.csrf } : {}),
      ...(ver !== undefined ? { "if-match": `"${ver}"` } : {}),
    },
    payload: b,
  });
}
async function advance(path: string, pid: string, u: User, v: number) {
  for (const step of ["CLARIFY", "REACT", "OBJECT", "DECIDE"])
    data(
      await call(
        "POST",
        path + "/proposals/" + pid + "/actions/step",
        { step },
        u,
        v,
      ),
    );
}
async function user() {
  const r = await call("POST", "/auth/register", {
    email: randomUUID() + "@example.test",
    password: "password-long-12345",
    displayName: "Governance Test",
  });
  assert.equal(r.statusCode, 201, r.body);
  return {
    cookie: r.cookies[0].name + "=" + r.cookies[0].value,
    csrf: r.json().data.csrfToken,
    id: r.json().data.account.id,
  };
}
function data(r: any, status?: number) {
  if (status) assert.equal(r.statusCode, status, r.body);
  else assert.ok(r.statusCode === 200 || r.statusCode === 201, r.body);
  return r.json().data;
}
function applyConflict(r: any) {
  assert.equal(r.statusCode, 409, r.body);
  assert.equal(r.json().error.code, "APPLY_CONFLICT");
  return r.json().error.conflictDetails;
}
test("organizational governance policy resolves future rounds, preserves snapshots and refuses conflicting overrides", async () => {
  const a = await user(), other = await user();
  const A = data(await call("POST", "/organizations", {name:"Org policy"}, a));
  const B = data(await call("POST", "/organizations", {name:"Foreign policy"}, other));
  const org = A.organization.id, path = "/organizations/"+org;
  const circleId = data(await call("GET", path+"/bootstrap", undefined, a)).rootCircleId;
  const effective=async()=>data(await call("GET",path+"/governance/policies/"+circleId+"/effective",undefined,a));
  const foreignCircle = data(await call("GET", "/organizations/"+B.organization.id+"/bootstrap", undefined, other)).rootCircleId;
  const rootId = randomUUID();
  async function saveRoot(next: OrganizationalGovernancePolicy) {
    return withOrg(org,a,async ctx=>{
      await validateOrgPolicy(ctx,next);
      await ctx.c.query("INSERT INTO administration_records(organization_id,id,kind,value) VALUES($1,$2,'policy',$3) ON CONFLICT(organization_id,id) DO UPDATE SET value=EXCLUDED.value,version=administration_records.version+1",[org,rootId,next]);
    });
  }
  const doc=data(await call("POST",path+"/documents",{title:"Policy test",ownerId:circleId,workflow:"GOVERNANCE",visibility:"ORGANIZATION",content:"v1"},a),201);
  async function round(key=randomUUID()) {
    const p=data(await call("POST",path+"/proposals",{title:"Policy round",circleId,kind:"DOCUMENT",payload:{documentId:doc.id,documentVersion:1}},a),201);
    data(await call("POST",path+"/proposals/"+p.id+"/actions/submit",{},a,1,key));
    return {id:p.id,detail:data(await call("GET",path+"/proposals/"+p.id,undefined,a)),key};
  }
  const domainRound=await round();
  assert.equal((await effective()).policySource,"DOMAIN");
  assert.equal(domainRound.detail.rounds[0].policy.method,"MANUAL_FACILITATED");
  await saveRoot({key:"governance.method",value:"CONSENT_WINDOW",allowOverride:true});
  assert.equal((await effective()).policySource,"ORGANIZATION");
  assert.equal((await effective()).configuration.method,"CONSENT_WINDOW");
  const orgRound=await round();
  assert.equal(orgRound.detail.rounds[0].policy.method,"CONSENT_WINDOW");
  assert.ok(orgRound.detail.rounds[0].deadline);
  assert.equal(data(await call("GET",path+"/proposals/"+domainRound.id,undefined,a)).rounds[0].policy.method,"MANUAL_FACILITATED");
  const local={...defaultPolicy,method:"CONSENT_ROUND" as const,workflowSteps:["PRESENT","DECIDE"]};
  const localKey=randomUUID();
  const localRow=data(await call("POST",path+"/governance/policies",{circleId,configuration:local},a,undefined,localKey));
  assert.equal((await effective()).policySource,"LOCAL");
  assert.equal((await effective()).localVersion,1);
  const simplified=await round();
  assert.equal(simplified.detail.rounds[0].policy.method,"CONSENT_ROUND");
  assert.deepEqual(simplified.detail.rounds[0].policy.workflowSteps,["PRESENT","DECIDE"]);
  assert.equal(simplified.detail.rounds[0].step,"PRESENT");
  data(await call("POST",path+"/proposals/"+simplified.id+"/actions/step",{step:"DECIDE"},a,2));
  assert.equal(data(await call("GET",path+"/proposals/"+simplified.id,undefined,a)).rounds[0].step,"DECIDE");
  await assert.rejects(saveRoot({key:"governance.method",value:"CONSENT_WINDOW",allowOverride:false}),/GOVERNANCE_POLICY_RECONCILIATION_REQUIRED/);
  assert.equal((await round()).detail.rounds[0].policy.method,"CONSENT_ROUND");
  // Reconcile explicitly to the target full policy, then lock; no rows are deleted.
  const reconciled={...defaultPolicy,method:"CONSENT_WINDOW" as const};
  data(await call("POST",path+"/governance/policies",{circleId,configuration:reconciled},a,localRow.version));
  await saveRoot({key:"governance.method",value:"CONSENT_WINDOW",allowOverride:false});
  assert.equal((await effective()).allowOverride,false);
  assert.equal((await call("GET",path+"/governance/policies/"+foreignCircle+"/effective",undefined,a)).statusCode,404);
  assert.equal((await call("POST",path+"/governance/policies",{circleId,configuration:local},a,2)).statusCode,409);
  const forbiddenReplay=await call("POST",path+"/governance/policies",{circleId,configuration:local},a,undefined,localKey);
  assert.equal(forbiddenReplay.statusCode,409);
  assert.equal(forbiddenReplay.json().error.code,"GOVERNANCE_OVERRIDE_DENIED");
  assert.equal((await call("POST",path+"/governance/policies",{circleId:foreignCircle,configuration:local},a)).statusCode,404);
  await assert.rejects(saveRoot({key:"governance.method",value:"BOGUS" as any,allowOverride:true}),/DOMAIN_INVARIANT/);
  assert.equal((await round()).detail.rounds[0].policy.method,"CONSENT_WINDOW");
  // Replay uses its immutable original result, even after the organizational default changes.
  const replay=await call("POST",path+"/proposals/"+domainRound.id+"/actions/submit",{},a,1,domainRound.key);
  data(replay);
  assert.equal(data(await call("GET",path+"/proposals/"+domainRound.id,undefined,a)).rounds[0].policy.method,"MANUAL_FACILITATED");
  await withOrg(org,a,async ctx=>{
    assert.equal((await ctx.c.query("SELECT count(*)::int AS n FROM gov_policies WHERE organization_id=$1",[org])).rows[0].n,1);
  });
});
test("an explicit response period opens only that proposal asynchronously and preserves organization locks", async()=>{
  const owner=await user();const A=data(await call('POST','/organizations',{name:'Per-proposal conduction'},owner));
  const org=A.organization.id,path='/organizations/'+org,circleId=data(await call('GET',path+'/bootstrap',undefined,owner)).rootCircleId;
  const effective=()=>call('GET',path+'/governance/policies/'+circleId+'/effective',undefined,owner).then(data);
  const before=await effective();assert.equal(before.configuration.method,'MANUAL_FACILITATED');
  const doc=data(await call('POST',path+'/documents',{title:'Agreement',ownerId:circleId,workflow:'GOVERNANCE',visibility:'ORGANIZATION',content:'Text'},owner));
  const draft=()=>call('POST',path+'/proposals',{title:'Async choice',circleId,kind:'DOCUMENT',payload:{documentId:doc.id,documentVersion:1}},owner).then(data);
  const proposal=await draft(),url=path+'/proposals/'+proposal.id+'/actions/submit';
  assert.equal((await call('POST',url,{reviewDurationHours:0},owner,1)).statusCode,400);
  const submitted=data(await call('POST',url,{reviewDurationHours:168},owner,1));
  assert.equal(submitted.round.policy.method,'CONSENT_WINDOW');assert.equal(submitted.round.policy.reviewDurationHours,168);assert.ok(submitted.round.deadline);
  assert.equal((await effective()).configuration.method,'MANUAL_FACILITATED');
  await withOrg(org,owner,async ctx=>{await ctx.c.query("INSERT INTO administration_records(organization_id,id,kind,value) VALUES($1,$2,'policy',$3)",[org,randomUUID(),{key:'governance.method',value:'MANUAL_FACILITATED',allowOverride:false}]);});
  const locked=await draft(),denied=await call('POST',path+'/proposals/'+locked.id+'/actions/submit',{reviewDurationHours:24},owner,1);
  assert.equal(denied.statusCode,409);assert.equal(denied.json().error.code,'GOVERNANCE_OVERRIDE_DENIED');
  const detail=data(await call('GET',path+'/proposals/'+locked.id,undefined,owner));assert.equal(detail.proposal.state,'DRAFT');assert.equal(detail.rounds.length,0);
});
test("escalation interrupts an asynchronous round without voting or deciding", async () => {
  const owner = await user(), voter = await user(), outsider = await user();
  const org = data(await call("POST", "/organizations", { name: "Escalation" }, owner)).organization.id;
  const path = "/organizations/" + org;
  const circleId = data(await call("GET", path + "/bootstrap", undefined, owner)).rootCircleId;
  const member = data(await call("POST", path + "/members", {accountId:voter.id}, owner)).membership;
  data(await call("POST", path + "/circles/" + circleId + "/memberships", {memberId:member.id,startsAt:activeMembershipStart}, owner));
  data(await call("POST", path + "/governance/policies", { circleId, configuration: { ...defaultPolicy, method: "CONSENT_WINDOW" } }, owner));
  const document = data(await call("POST", path + "/documents", { title:"Agreement", ownerId:circleId, workflow:"GOVERNANCE", visibility:"ORGANIZATION", content:"Text" }, owner));
  const createdRestriction=data(await call('POST',path+'/proposals',{title:'Nova restrição',circleId,kind:'DOCUMENT',newTension:{title:'Falta um acordo',description:'Contexto'},newDocument:{title:'Acordo novo',richContent:readContent('Conteúdo novo')}},owner),201);
  const createdDetail=data(await call('GET',path+'/proposals/'+createdRestriction.id,undefined,owner));
  const createdDocumentId=createdDetail.revisions[0].payload.documents[0].documentId;
  const createdDocument=data(await call('GET',path+'/documents/'+createdDocumentId,undefined,owner));
  assert.equal(createdDocument.document.publishedVersion,null);
  assert.equal(createdDocument.versions[0].content,'Conteúdo novo');
  const reviseBody={title:'Alterar restrição',circleId,kind:'DOCUMENT',newTension:{title:'Precisamos revisar',description:'Contexto'},documentRevision:{documentId:createdDocumentId,version:createdDocument.document.version,richContent:readContent('Conteúdo revisto')}};
  assert.equal((await call('POST',path+'/proposals',reviseBody,voter)).statusCode,403);
  assert.equal((await call('POST',path+'/proposals',{...reviseBody,documentRevision:{...reviseBody.documentRevision,version:99}},owner)).statusCode,409);
  assert.equal(data(await call('GET',path+'/tensions',undefined,owner)).items.filter((row:any)=>row.title==='Precisamos revisar').length,0);
  assert.equal(data(await call('GET',path+'/documents/'+createdDocumentId,undefined,owner)).document.draftVersion,1);
  const revisedProposal=data(await call('POST',path+'/proposals',reviseBody,owner),201);
  const revisedDetail=data(await call('GET',path+'/proposals/'+revisedProposal.id,undefined,owner));
  assert.equal(revisedDetail.revisions[0].payload.documents[0].documentId,createdDocumentId);assert.equal(revisedDetail.revisions[0].payload.documents[0].documentVersion,2);
  const revisedDocument=data(await call('GET',path+'/documents/'+createdDocumentId,undefined,owner));
  assert.equal(revisedDocument.document.publishedVersion,null);assert.equal(revisedDocument.document.draftVersion,2);
  const proposal = data(await call("POST", path + "/proposals", { title:"Discuss", circleId, newTension:{title:'Tensão de origem',description:'Contexto da tensão'}, kind:"DOCUMENT", payload:{ documentId:document.id, documentVersion:1 } }, owner));
  assert.ok(proposal.tensionId);
  const source=data(await call('GET',path+'/tensions',undefined,owner)).items.find((row:any)=>row.id===proposal.tensionId);
  assert.equal(source.title,'Tensão de origem');assert.equal(source.description,'Contexto da tensão');
  const sourceDetail=data(await call('GET',path+'/proposals/'+proposal.id,undefined,owner));
  assert.equal(sourceDetail.originTension.title,'Tensão de origem');assert.equal(sourceDetail.originTension.description,'Contexto da tensão');
  const url = path + "/proposals/" + proposal.id;
  const submitted = data(await call("POST", url + "/actions/submit", {reviewDurationHours:48}, owner, 1));
  assert.equal(submitted.round.policy.reviewDurationHours,48);
  assert.ok(submitted.round.deadline);
  data(await call("POST", url + "/votes", {choice:"CONSENT"}, voter, 2));
  assert.notEqual((await call("POST", url + "/actions/escalate", {reason:"Discuss"}, outsider, 2)).statusCode, 200);
  assert.notEqual((await call("POST", url + "/actions/escalate", {reason:"  "}, owner, 2)).statusCode, 200);
  assert.equal((await call("POST", url + "/actions/escalate", {reason:"Discuss"}, owner, 1)).statusCode, 409);
  const escalated = data(await call("POST", url + "/actions/escalate", {reason:"Discuss in meeting"}, owner, 2));
  assert.equal(escalated.state, "ESCALATED");
  assert.equal(escalated.verdict, null);
  assert.equal(escalated.applyState, "PENDING");
  const detail = data(await call("GET", url, undefined, owner));
  assert.equal(detail.rounds[0].state, "INTERRUPTED");
  assert.equal(detail.rounds[0].deadline, submitted.round.deadline);
  assert.equal(detail.ballots.length, 1);
  assert.equal(detail.ballots[0].choice, "CONSENT");
  assert.equal(detail.proposal.canVote, false);
  assert.equal((await call("POST", url + "/votes", {choice:"CONSENT"}, owner, 3)).statusCode, 409);
  assert.equal((await call("POST", url + "/actions/escalate", {reason:"Again"}, owner, 3)).statusCode, 409);
});
test("draft access policy governs read, edit, submit, adapters, meetings and replay without inferring lead links", async () => {
  const a=await user(),b=await user();
  const A=data(await call("POST","/organizations",{name:"Draft policy"},a));
  const org=A.organization.id,path="/organizations/"+org;
  const circleId=data(await call("GET",path+"/bootstrap",undefined,a)).rootCircleId;
  const member=data(await call("POST",path+"/members",{accountId:b.id},a)).membership;
  data(await call("POST",path+"/circles/"+circleId+"/memberships",{memberId:member.id,startsAt:activeMembershipStart},a));
  const doc=data(await call("POST",path+"/documents",{title:"Draft ACL",ownerId:circleId,workflow:"GOVERNANCE",visibility:"ORGANIZATION",content:"one"},a),201);
  const payload={documentId:doc.id,documentVersion:1};
  const p=data(await call("POST",path+"/proposals",{title:"Shared only by policy",circleId,kind:"DOCUMENT",payload},a),201);
  assert.equal(p.kind,'GOVERNANCE');
  const amendmentPayload={documents:[payload]};
  const detail=()=>call("GET",path+"/proposals/"+p.id,undefined,b);
  const list=async()=>data(await call("GET",path+"/proposals",undefined,b)).items;
  async function externalVisibility(expected:boolean,ports={}) {
    await withOrg(org,b,async ctx=>{
      const adapter=createGovernanceResourceAdapters(ports).proposal;
      assert.equal(await adapter.authorize(ctx,p.id,"read"),expected);
      assert.equal((await adapter.search!(ctx,"Shared only",20)).some((r:any)=>r.id===p.id),expected);
      assert.equal((await createGovernanceMeetingItems(ports)(ctx,{circleIds:[circleId]})).some(r=>r.id===p.id),expected);
    });
  }
  assert.equal((await detail()).statusCode,404);
  assert.equal((await list()).some((r:any)=>r.id===p.id),false);
  await externalVisibility(false);
  const shared={...defaultPolicy,draftAccess:"CIRCLE_MEMBERS" as const};
  data(await call("POST",path+"/governance/policies",{circleId,configuration:shared},a));
  assert.equal(data(await detail()).proposal.canEdit,true);
  await externalVisibility(true);
  const amendmentKey=randomUUID();
  data(await call("POST",path+"/proposals/"+p.id+"/revisions",{payload:amendmentPayload},b,1,amendmentKey));
  data(await call("POST",path+"/governance/policies",{circleId,configuration:defaultPolicy},a,1));
  assert.equal((await detail()).statusCode,404);
  assert.equal((await call("POST",path+"/proposals/"+p.id+"/revisions",{payload:amendmentPayload},b,1,amendmentKey)).statusCode,404);
  await externalVisibility(false);
  const leadPolicy={...defaultPolicy,draftAccess:"AUTHOR_AND_LEAD_LINKS" as const};
  await withOrg(org,a,async ctx=>{
    await assert.rejects(()=>new Governance(ctx,{headers:{"if-match":"\"2\""}} as any).setPolicy({circleId,configuration:leadPolicy}),/DRAFT_LEAD_LINK_SERVICE_REQUIRED/);
  });
  data(await call("POST",path+"/governance/policies",{circleId,configuration:leadPolicy},a,2));
  // Explicit consumer contract test only: this provider is NOT a production role inference.
  const leadPorts={isLeadLink:async(ctx:any,input:any)=>ctx.org.id===org&&input.circleId===circleId&&input.memberId===member.id};
  assert.equal((await detail()).statusCode,404); // Ordinary membership does not imply the explicit role.
  await externalVisibility(true,leadPorts);
  await externalVisibility(false,{isLeadLink:async()=>false});
  data(await call("POST",path+"/governance/policies",{circleId,configuration:shared},a,3));
  data(await call("POST",path+"/proposals/"+p.id+"/actions/submit",{},b,2));
  data(await call("POST",path+"/proposals/"+p.id+"/revisions",{payload:amendmentPayload},a,3));
  data(await call("POST",path+"/governance/policies",{circleId,configuration:defaultPolicy},a,4));
  assert.equal(data(await detail()).proposal.canEdit,false);
  assert.equal((await call("POST",path+"/proposals/"+p.id+"/revisions",{payload:amendmentPayload},b,4)).statusCode,403);
  await externalVisibility(true); // Returned drafts retain circle visibility, not edit rights.
});
test("rich agreements preserve marks, lists, links and exact approved revision in PostgreSQL, restore and transfer", async () => {
  const a=await user(),foreign=await user();
  const A=data(await call("POST","/organizations",{name:"Rich agreements"},a));
  const B=data(await call("POST","/organizations",{name:"Foreign rich"},foreign));
  const org=A.organization.id,path="/organizations/"+org;
  const circleId=data(await call("GET",path+"/bootstrap",undefined,a)).rootCircleId;
  const rich=validateRichDocument({format:"orgmap-richtext",version:1,doc:{type:"doc",content:[
    {type:"paragraph",content:[{type:"text",text:"Acordo 🌿 日本語 <script>",marks:[{type:"bold"},{type:"italic"},{type:"underline"},{type:"strike"}]},{type:"hardBreak"},{type:"text",text:"Referência",marks:[{type:"link",attrs:{href:"https://example.com/acordo"}}]}]},
    {type:"bulletList",content:[{type:"listItem",content:[{type:"paragraph",content:[{type:"text",text:"Escutar"}]}]}]},
    {type:"orderedList",attrs:{start:2},content:[{type:"listItem",content:[{type:"paragraph",content:[{type:"text",text:"Revisar"}]}]}]},
  ]}});
  const create={title:"Acordo rico",ownerId:circleId,workflow:"GOVERNANCE",visibility:"ORGANIZATION",richContent:rich};
  const doc=data(await call("POST",path+"/documents",create,a),201);
  const get=()=>call("GET",path+"/documents/"+doc.id,undefined,a);
  assert.deepEqual(data(await get()).versions[0].richContent,rich);
  assert.equal(data(await get()).versions[0].content,toPlainText(rich));
  assert.ok(renderHTML(rich).includes("&lt;script&gt;"));
  assert.ok(renderHTML(rich).includes('<ol start="2">'));
  const invalid=structuredClone(rich) as any;invalid.doc.content[0].content[2].marks[0].attrs.href="javascript:alert(1)";
  assert.equal((await call("POST",path+"/documents",{...create,richContent:invalid},a)).statusCode,422);
  assert.equal((await call("POST",path+"/documents",{...create,content:"ambiguous"},a)).statusCode,400);
  assert.equal((await call("POST",path+"/documents/"+doc.id+"/actions/draft",{richContent:{...rich,unexpected:true}},a,1)).statusCode,422);
  assert.equal((await call("GET","/organizations/"+B.organization.id+"/documents/"+doc.id,undefined,foreign)).statusCode,404);
  const proposal=data(await call("POST",path+"/proposals",{title:"Aprovar acordo rico",circleId,kind:"DOCUMENT",payload:{documentId:doc.id,documentVersion:1}},a),201);
  data(await call("POST",path+"/proposals/"+proposal.id+"/actions/submit",{},a,1));
  data(await call("POST",path+"/proposals/"+proposal.id+"/votes",{choice:"CONSENT"},a,2));
  await advance(path,proposal.id,a,2);
  data(await call("POST",path+"/proposals/"+proposal.id+"/actions/decide",{verdict:"ADOPT",reason:"Revisão rica aprovada"},a,2));
  data(await call("POST",path+"/proposals/"+proposal.id+"/actions/apply",{},a,3));
  assert.equal(data(await get()).document.publishedVersion,1);
  data(await call("POST",path+"/documents/"+doc.id+"/actions/draft",{content:'{"format":"orgmap-richtext"} <b>literal</b>'},a,2));
  data(await call("POST",path+"/documents/"+doc.id+"/actions/restore",{number:1},a,3));
  const restored=data(await get());
  assert.equal(restored.document.publishedVersion,1);
  assert.equal(restored.document.draftVersion,3);
  assert.deepEqual(restored.versions.find((v:any)=>v.number===3).richContent,rich);
  assert.equal(restored.versions.find((v:any)=>v.number===2).richContent,null);
  assert.equal(restored.versions.find((v:any)=>v.number===2).content,'{"format":"orgmap-richtext"} <b>literal</b>');
  assert.equal((await call("POST",path+"/documents/"+doc.id+"/actions/draft",{richContent:rich},a,1)).statusCode,409);
  assert.equal(data(await get()).versions.length,3);
  await withOrg(org,a,async ctx=>{
    const adapter=createGovernanceResourceAdapters().agreement;
    const exported=await adapter.export!(ctx,[doc.id],"agreement") as any;
    assert.deepEqual(exported.records[0].data.richContent,rich);
    assert.equal("content" in exported.records[0].data,false);
    const validated=await adapter.validateImport!(ctx,exported.records,"agreement");
    const imported=await adapter.applyImport!(ctx,validated.plan,"agreement") as any;
    const row=(await ctx.c.query("SELECT content,rich_content FROM gov_document_versions WHERE organization_id=$1 AND document_id=$2 AND number=1",[org,imported.idMap[doc.id]])).rows[0];
    assert.deepEqual(row.rich_content,rich);
    assert.equal(row.content,toPlainText(rich));
  });
});
test("governed purpose preserves rich snapshots and applies the approved AST without flattening",async()=>{
  const a=await user();
  const org=data(await call('POST','/organizations',{name:'Rich purpose governance'},a)).organization.id,path='/organizations/'+org;
  const circleId=data(await call('GET',path+'/bootstrap',undefined,a)).rootCircleId;
  const rich=validateRichDocument({format:'orgmap-richtext',version:1,doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Cuidar 🌿',marks:[{type:'bold'}]}]},{type:'bulletList',content:[{type:'listItem',content:[{type:'paragraph',content:[{type:'text',text:'Revisar acordos'}]}]}]}]}});
  const entityId=randomUUID();
  const changes=[{kind:'CREATE',entityId,entityKind:'ROLE',parentCircleId:circleId,name:'Guardião rico',purposeRich:rich}];
  const input={title:'Propósito rico aprovado',circleId,kind:'GOVERNANCE',payload:{changes}};
  const invalid=structuredClone(rich) as any;invalid.doc.content[0].content[0].marks=[{type:'unknown'}];
  assert.equal((await call('POST',path+'/proposals',{...input,payload:{changes:[{...changes[0],purposeRich:invalid}]}},a)).statusCode,422);
  assert.equal((await call('POST',path+'/proposals',{...input,payload:{changes:[{...changes[0],purpose:'divergente'}]}},a)).statusCode,422);
  const proposal=data(await call('POST',path+'/proposals',input,a),201);
  const detail=data(await call('GET',path+'/proposals/'+proposal.id,undefined,a));
  assert.deepEqual(detail.revisions[0].payload.changes[0].purposeRich,rich);
  assert.equal(detail.revisions[0].payload.changes[0].purpose,toPlainText(rich));
  data(await call('POST',path+'/proposals/'+proposal.id+'/actions/submit',{},a,1));
  data(await call('POST',path+'/proposals/'+proposal.id+'/votes',{choice:'CONSENT'},a,2));
  await advance(path,proposal.id,a,2);
  data(await call('POST',path+'/proposals/'+proposal.id+'/actions/decide',{verdict:'ADOPT',reason:'Propósito revisado'},a,2));
  data(await call('POST',path+'/proposals/'+proposal.id+'/actions/apply',{},a,3));
  await withOrg(org,a,async ctx=>{
    const row=(await ctx.c.query('SELECT purpose,purpose_rich FROM entities WHERE organization_id=$1 AND id=$2',[org,entityId])).rows[0];
    assert.deepEqual(row.purpose_rich,rich);assert.equal(row.purpose,toPlainText(rich));
  });
});
test('rich tension descriptions survive reads and transfer while legacy text stays literal',async()=>{
 const a=await user(),foreign=await user();
 const org=data(await call('POST','/organizations',{name:'Rich tension'},a)).organization.id,path='/organizations/'+org;
 const foreignOrg=data(await call('POST','/organizations',{name:'Other tensions'},foreign)).organization.id;
 const circleId=data(await call('GET',path+'/bootstrap',undefined,a)).rootCircleId;
 const rich=validateRichDocument({format:'orgmap-richtext',version:1,doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Cuidar 🌿',marks:[{type:'bold'}]},{type:'text',text:' dos acordos'}]},{type:'bulletList',content:[{type:'listItem',content:[{type:'paragraph',content:[{type:'text',text:'Ouvir o círculo'}]}]}]}]}});
 const tension=data(await call('POST',path+'/tensions',{title:'Uma descrição rica',circleId,descriptionRich:rich},a),201);
 const listed=data(await call('GET',path+'/tensions',undefined,a)).items.find((row:any)=>row.id===tension.id);
 assert.deepEqual(listed.descriptionRich,rich);assert.equal(listed.description,toPlainText(rich));
 const invalid=structuredClone(rich) as any;invalid.doc.content[0].content[0].marks=[{type:'link',attrs:{href:'javascript:alert(1)'}}];
 assert.equal((await call('POST',path+'/tensions',{title:'Invalid',circleId,descriptionRich:invalid},a)).statusCode,422);
 assert.equal((await call('POST',path+'/tensions',{title:'Ambiguous',circleId,description:'plain',descriptionRich:rich},a)).statusCode,400);
 const literal='<b>literal</b> {"format":"orgmap-richtext"}';
 const legacy=data(await call('POST',path+'/tensions',{title:'Legado',circleId,description:literal},a),201);
 assert.equal(legacy.description,literal);assert.equal(legacy.descriptionRich,null);
 assert.equal(data(await call('GET','/organizations/'+foreignOrg+'/tensions',undefined,foreign)).items.some((row:any)=>row.id===tension.id),false);
 await withOrg(org,a,async ctx=>{
  const adapter=createGovernanceResourceAdapters().tension;
  const exported=await adapter.export!(ctx,[tension.id,legacy.id],'tension') as any;
  const record=exported.records.find((r:any)=>r.sourceId===tension.id);
  assert.deepEqual(record.data.descriptionRich,rich);assert.equal('description' in record.data,false);
  const validated=await adapter.validateImport!(ctx,exported.records,'tension');
  const imported=await adapter.applyImport!(ctx,validated.plan,'tension') as any;
  const row=(await ctx.c.query('SELECT description,description_rich FROM gov_tensions WHERE organization_id=$1 AND id=$2',[org,imported.idMap[tension.id]])).rows[0];
  assert.deepEqual(row.description_rich,rich);assert.equal(row.description,toPlainText(rich));
  const old=(await ctx.c.query('SELECT description,description_rich FROM gov_tensions WHERE organization_id=$1 AND id=$2',[org,imported.idMap[legacy.id]])).rows[0];
  assert.equal(old.description,literal);assert.equal(old.description_rich,null);
 });
});
test('completing an existing tension in the proposal command preserves its identity and rolls back on conflict',async()=>{
 const a=await user(),other=await user();
 const org=data(await call('POST','/organizations',{name:'Complete tension context'},a),201).organization.id,path='/organizations/'+org;
 const circleId=data(await call('GET',path+'/bootstrap',undefined,a)).rootCircleId;
 const doc=data(await call('POST',path+'/documents',{title:'Context document',ownerId:circleId,workflow:'GOVERNANCE',visibility:'ORGANIZATION',content:'Draft'},a),201);
 const rich=validateRichDocument({format:'orgmap-richtext',version:1,doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Contexto preservado',marks:[{type:'bold'}]}]}]}});
 const blank=data(await call('POST',path+'/tensions',{title:'Tensão legada',circleId},a),201);
 const input={title:'Proposta com contexto',circleId,kind:'DOCUMENT',payload:{documentId:doc.id,documentVersion:1},tensionId:blank.id,tensionRevision:{version:blank.version,descriptionRich:rich}};
 assert.equal((await call('POST',path+'/proposals',{...input,tensionRevision:{version:blank.version,descriptionRich:validateRichDocument({format:'orgmap-richtext',version:1,doc:{type:'doc',content:[{type:'paragraph'}]}})}},a)).statusCode,422);
 const created=data(await call('POST',path+'/proposals',input,a),201);
 assert.equal(created.tensionId,blank.id);
 const updated=data(await call('GET',path+'/tensions',undefined,a)).items.find((row:any)=>row.id===blank.id);
 assert.equal(updated.version,blank.version+2); // context completion and proposal processing
 assert.equal(updated.description,toPlainText(rich));assert.deepEqual(updated.descriptionRich,rich);
 const stale=await call('POST',path+'/proposals',{...input,title:'Stale context'},a);
 assert.equal(stale.statusCode,409);assert.equal(stale.json().error.code,'VERSION_CONFLICT');
 const another=data(await call('POST',path+'/tensions',{title:'Outra tensão legada',circleId},a),201);
 const failed=await call('POST',path+'/proposals',{...input,title:'Invalid payload',tensionId:another.id,tensionRevision:{version:another.version,descriptionRich:rich},payload:{documentId:doc.id,documentVersion:999}},a);
 assert.notEqual(failed.statusCode,201);
 const preserved=data(await call('GET',path+'/tensions',undefined,a)).items.find((row:any)=>row.id===another.id);
 assert.equal(preserved.version,another.version);assert.equal(preserved.description,'');assert.equal(preserved.descriptionRich,null);
 assert.equal((await call('POST',path+'/proposals',{...input,title:'Foreign author',tensionId:another.id,tensionRevision:{version:another.version,descriptionRich:rich}},other)).statusCode,404);
 await withOrg(org,a,async ctx=>{
  const actions=(await ctx.c.query('SELECT action FROM gov_history WHERE organization_id=$1 AND resource_id=$2',[org,another.id])).rows.map((row:any)=>row.action);
  assert.deepEqual(actions,['TensionCreated']);
 });
});
test("tension titles preserve 200 Unicode code points and reject 201", async () => {
  const a=await user();
  const A=data(await call("POST","/organizations",{name:"Unicode tensions"},a));
  const path="/organizations/"+A.organization.id;
  const circleId=data(await call("GET",path+"/bootstrap",undefined,a)).rootCircleId;
  const title="🌿".repeat(200);
  const tension=data(await call("POST",path+"/tensions",{title:"  "+title+"  ",circleId},a),201);
  assert.equal(tension.title,title);
  assert.equal(Array.from(tension.title).length,200);
  const rows=data(await call("GET",path+"/tensions",undefined,a));
  assert.equal(rows.items.find((row:any)=>row.id===tension.id).title,title);
  assert.equal((await call("POST",path+"/tensions",{title:title+"🌿",circleId},a)).statusCode,400);
  assert.equal((await call("POST",path+"/tensions",{title:"   ",circleId},a)).statusCode,400);
});
test("governance guests read only shared resources and vote only with a current grant and round eligibility",async()=>{
 const owner=await user(),guest=await user(),ungranted=await user();
 const A=data(await call("POST","/organizations",{name:"Guest governance"},owner)),org=A.organization.id,path="/organizations/"+org;
 const circleId=data(await call("GET",path+"/bootstrap",undefined,owner)).rootCircleId;
 const sharedDoc=data(await call("POST",path+"/documents",{title:"Shared agreement",ownerId:circleId,workflow:"GOVERNANCE",visibility:"ORGANIZATION",content:"Scoped content"},owner),201);
 const hiddenDoc=data(await call("POST",path+"/documents",{title:"PRIVATE_NAME_DO_NOT_LEAK",ownerId:circleId,workflow:"DIRECT",visibility:"AUTHOR",content:"PRIVATE_BODY_DO_NOT_LEAK"},owner),201);
 const p=data(await call("POST",path+"/proposals",{title:"Shared proposal",circleId,kind:"DOCUMENT",payload:{documentId:sharedDoc.id,documentVersion:1}},owner),201);
 const privateP=data(await call("POST",path+"/proposals",{title:"PRIVATE_PROPOSAL_DO_NOT_LEAK",circleId,kind:"DOCUMENT",payload:{documentId:sharedDoc.id,documentVersion:1}},owner),201);
 const ref=(kind:string,rid:string)=>({context:"governance",kind,id:rid});
 const plan=[{resource:ref("proposal",p.id),actions:["read","vote"]},{resource:ref("agreement",sharedDoc.id),actions:["read"]}];
 const membership=data(await call("POST",path+"/members",{accountId:guest.id,memberType:"GUEST",accessPlan:plan},owner)).membership;
 assert.equal(data(await call("GET",path+"/bootstrap",undefined,guest)).membership.memberType,"GUEST");
 data(await call("POST",path+"/members",{accountId:ungranted.id,memberType:"GUEST",accessPlan:[]},owner));
 assert.equal((await call("GET",path+"/proposals/"+p.id,undefined,guest)).statusCode,404); // Never-submitted draft policy still applies.
 data(await call("POST",path+"/proposals/"+p.id+"/actions/submit",{},owner,1));
 const shared=data(await call("GET",path+"/proposals/"+p.id,undefined,guest));
 assert.equal(shared.proposal.title,"Shared proposal");assert.equal(shared.proposal.canEdit,false);
 assert.equal(shared.proposal.canVote,true);
 assert.ok(shared.rounds[0].electorate.includes(membership.id));
 const proposals=data(await call("GET",path+"/proposals?limit=1",undefined,guest));
 assert.deepEqual(proposals.items.map((row:any)=>row.id),[p.id]);assert.equal(proposals.page.hasMore,false);
 assert.ok(!JSON.stringify(proposals).includes(privateP.id));
 assert.equal((await call("GET",path+"/proposals/"+privateP.id,undefined,guest)).statusCode,404);
 assert.equal((await call("GET",path+"/documents/"+hiddenDoc.id,undefined,guest)).statusCode,404);
 const docs=await call("GET",path+"/documents",undefined,guest);assert.ok(!docs.body.includes("PRIVATE_"));assert.ok(!docs.body.includes(hiddenDoc.id));assert.equal(data(docs).items.length,1);
 assert.equal((await call("POST",path+"/members/"+membership.id+"/access-grants",{accessPlan:[{resource:ref("agreement",hiddenDoc.id),actions:["read"]}]},owner)).statusCode,403);
 assert.equal((await call("POST",path+"/proposals/"+p.id+"/revisions",{payload:{documents:[{documentId:sharedDoc.id,documentVersion:1}]}},guest,2)).statusCode,404);
 const key=randomUUID();data(await call("POST",path+"/proposals/"+p.id+"/votes",{choice:"CONSENT"},guest,2,key));
 assert.equal(data(await call("GET",path+"/proposals/"+p.id,undefined,guest)).proposal.canVote,false);
 assert.equal((await call("POST",path+"/proposals/"+p.id+"/votes",{choice:"CONSENT"},ungranted,2)).statusCode,404);
 const lateMember=data(await call("GET",path+"/members",undefined,owner)).items.find((row:any)=>row.accountId===ungranted.id);
 const visibleMembers=data(await call('GET',path+'/members',undefined,guest)).items;
 assert.equal(visibleMembers.length,2);assert.equal(visibleMembers.some((row:any)=>row.id===lateMember.id),false);
 data(await call("POST",path+"/members/"+lateMember.id+"/access-grants",{accessPlan:[{resource:ref("proposal",p.id),actions:["read","vote"]}]},owner));
 assert.equal((await call("GET",path+"/proposals/"+p.id,undefined,ungranted)).statusCode,200);
 assert.equal(data(await call("GET",path+"/proposals/"+p.id,undefined,ungranted)).proposal.canVote,false);
 assert.equal((await call("POST",path+"/proposals/"+p.id+"/votes",{choice:"CONSENT"},ungranted,2)).statusCode,403);
 await governanceCore.withResourceWorkerContext(org,membership.id,[{resource:ref("proposal",p.id),action:"read"}],async ctx=>{
   const adapter=createGovernanceResourceAdapters(governancePorts).proposal;
   assert.equal(await adapter.authorize(ctx,p.id,"read"),true);
   assert.equal(await adapter.authorize(ctx,p.id,"export"),false);
   assert.equal((await adapter.search!(ctx,"PRIVATE",20)).length,0);
   assert.deepEqual((await createGovernanceMeetingItems(governancePorts)(ctx,{circleIds:[circleId]})).map(row=>row.id),[p.id]);
   await assert.rejects(()=>new Governance(ctx,{} as any,governancePorts).document({title:"Unauthorized worker write"}),/ACTION_DENIED/);
 });
 await assert.rejects(()=>governanceCore.withWorkerContext(org,membership.id,async()=>true),/RESOURCE_NOT_FOUND/);
 disabledGovernanceOrgs.add(org);
 let calledWhileOff=false;
 await assert.rejects(()=>governanceCore.withResourceWorkerContext(org,membership.id,[{resource:ref("proposal",p.id),action:"read"}],async()=>{calledWhileOff=true;return true;}),/RESOURCE_NOT_FOUND/);
 assert.equal(calledWhileOff,false);
 assert.equal((await call('GET',path+'/proposals/'+p.id,undefined,guest)).statusCode,404);
 disabledGovernanceOrgs.delete(org);
 const grant=data(await call("GET",path+"/members/"+membership.id+"/access-grants",undefined,owner)).items.find((row:any)=>row.resourceId===p.id);
 data(await call("POST",path+"/members/"+membership.id+"/access-grants/"+grant.id+"/revoke",{},owner,grant.version));
 assert.equal((await call("POST",path+"/proposals/"+p.id+"/votes",{choice:"CONSENT"},guest,2,key)).statusCode,404);
 assert.equal((await call("GET",path+"/proposals/"+p.id,undefined,guest)).statusCode,404);
 assert.equal(data(await call("GET",path+"/proposals",undefined,guest)).items.length,0);
 await assert.rejects(()=>governanceCore.withResourceWorkerContext(org,membership.id,[{resource:ref("proposal",p.id),action:"read"}],async()=>true),/RESOURCE_NOT_FOUND/);
 assert.equal((await call("GET",path+"/documents/"+sharedDoc.id,undefined,guest)).statusCode,200);
 assert.equal((await call("POST",path+"/documents/"+sharedDoc.id+"/actions/archive",{},owner,1)).statusCode,422);
 async function adoptDocument(payload:any,title:string){
   const proposal=data(await call('POST',path+'/proposals',{title,circleId,kind:'DOCUMENT',payload},owner),201),ep=path+'/proposals/'+proposal.id;
   const submitted=data(await call('POST',ep+'/actions/submit',{},owner,1));assert.equal(submitted.round.electorate.length,1);
   data(await call('POST',ep+'/votes',{choice:'CONSENT'},owner,2));
   for(const step of ['CLARIFY','REACT','OBJECT','DECIDE'])data(await call('POST',ep+'/actions/step',{step},owner,2));
   data(await call('POST',ep+'/actions/decide',{verdict:'ADOPT',reason:'Approved'},owner,2));
   data(await call('POST',ep+'/actions/apply',{},owner,3));
 }
 await adoptDocument({documentId:sharedDoc.id,documentVersion:1},'Publish shared agreement');
 const published=data(await call('GET',path+'/documents/'+sharedDoc.id,undefined,owner)).document;
 await adoptDocument({documentId:sharedDoc.id,documentVersion:published.publishedVersion,documentAction:'ARCHIVE',documentBaseVersion:published.version},'Archive shared agreement');
 assert.equal((await call("GET",path+"/documents/"+sharedDoc.id,undefined,guest)).statusCode,404);
});
test("real tension to meeting agenda preserves both guards, replay, module availability and atomic rollback",async()=>{
 const a=await user(),b=await user();
 const A=data(await call('POST','/organizations',{name:'Agenda source'},a)),org=A.organization.id,path='/organizations/'+org;
 const circleId=data(await call('GET',path+'/bootstrap',undefined,a)).rootCircleId;
 const created=data(await call('POST',path+'/meeting-series',{title:'Reunião destino',circleId,localStart:'2030-01-01T10:00',timeZone:'America/Sao_Paulo',durationMinutes:60,recurrence:{frequency:'ONCE'},sections:[{id:'agenda',title:'Agenda',kind:'AGENDA'}],participants:[],policy:{notesOnlyNoter:false,windowDays:7}},a));
 const meetingId=created.occurrenceIds[0],before=data(await call('GET',path+'/meetings/'+meetingId,undefined,a));
 const tension=data(await call('POST',path+'/tensions',{title:'Tensão encaminhada',circleId},a),201),endpoint=path+'/tensions/'+tension.id+'/actions/process';
 const input={targetKind:'AGENDA',meetingId,meetingVersion:before.meeting.version};
 await withOrg(org,a,async ctx=>{
  await assert.rejects(()=>new Governance(ctx,{headers:{'if-match':'"1"'}} as any).processTension(tension.id,input),/TENSION_AGENDA_SERVICE_REQUIRED/);
 });
 assert.equal((await call('POST',endpoint,{...input,meetingVersion:99},a,1)).statusCode,409);
 const member=data(await call('POST',path+'/members',{accountId:b.id},a)).membership;
 data(await call('POST',path+'/circles/'+circleId+'/memberships',{memberId:member.id,startsAt:activeMembershipStart},a));
 assert.equal((await call('POST',endpoint,input,b,1)).statusCode,403); // Source ownership.
 const ownB=data(await call('POST',path+'/tensions',{title:'Fonte de outro participante',circleId},b),201);
 assert.equal((await call('POST',path+'/tensions/'+ownB.id+'/actions/process',input,b,1)).statusCode,404); // Target ACL.
 const sourceDoc=data(await call('POST',path+'/documents',{title:'Acordo de origem',ownerId:circleId,workflow:'GOVERNANCE',visibility:'ORGANIZATION',content:'Conteúdo'},a),201);
 const fromB={title:'Proposta de origem',circleId,tensionId:ownB.id,kind:'DOCUMENT',payload:{documentId:sourceDoc.id,documentVersion:1}};
 assert.equal((await call('POST',path+'/proposals',fromB,a)).statusCode,403); // Owners are not exempt from source authorship.
 const foreignOrg=data(await call('POST','/organizations',{name:'Foreign source'},b)).organization.id;
 const foreignCircle=data(await call('GET','/organizations/'+foreignOrg+'/bootstrap',undefined,b)).rootCircleId;
 const foreignTension=data(await call('POST','/organizations/'+foreignOrg+'/tensions',{title:'Outra organização',circleId:foreignCircle},b),201);
 assert.equal((await call('POST',path+'/proposals',{...fromB,tensionId:foreignTension.id},a)).statusCode,404);
 assert.equal((await call('POST',path+'/proposals',fromB,b)).statusCode,201);
 const failing=data(await call('POST',path+'/tensions',{title:'Falha após criar agenda',circleId},a),201);
 assert.equal((await call('POST',path+'/tensions/'+failing.id+'/actions/process',input,a,1)).statusCode,409);
 const rolledBack=data(await call('GET',path+'/meetings/'+meetingId,undefined,a));
 assert.equal(rolledBack.meeting.version,before.meeting.version);assert.equal(rolledBack.agenda.length,0);
 await withOrg(org,a,async ctx=>{
  assert.equal((await ctx.c.query('SELECT version,state FROM gov_tensions WHERE organization_id=$1 AND id=$2',[org,failing.id])).rows[0].version,1);
  assert.equal((await ctx.c.query('SELECT 1 FROM gov_tension_links WHERE organization_id=$1 AND tension_id=$2',[org,failing.id])).rowCount,0);
 });
 const key=randomUUID(),result=data(await call('POST',endpoint,input,a,1,key));
 assert.equal(result.targetKind,'AGENDA');assert.equal(result.version,2);
 assert.equal(data(await call('POST',endpoint,input,a,1,key)).targetId,result.targetId);
 const detail=data(await call('GET',path+'/meetings/'+meetingId,undefined,a));
 assert.equal(detail.agenda.length,1);assert.equal(detail.agenda[0].id,result.targetId);assert.equal(detail.agenda[0].sourceId,tension.id);assert.equal(detail.agenda[0].title,tension.title);
 await withOrg(org,a,async ctx=>assert.equal((await ctx.c.query("SELECT 1 FROM gov_tension_links WHERE organization_id=$1 AND tension_id=$2 AND target_kind='AGENDA' AND target_id=$3",[org,tension.id,result.targetId])).rowCount,1));
 data(await call('POST',path+'/governance/policies',{circleId,configuration:{...defaultPolicy,draftAccess:'CIRCLE_MEMBERS'}},a));
 const scheduled=data(await call('POST',path+'/proposals',{title:'Proposta na pauta',circleId,kind:'DOCUMENT',payload:{documentId:sourceDoc.id,documentVersion:1}},a),201);
 const meetingWithProposal=data(await call('POST',path+'/meetings/'+meetingId+'/agenda',{title:scheduled.title,sourceId:scheduled.id},a,detail.meeting.version));
 const ownerList=data(await call('GET',path+'/proposals',undefined,a)).items,scheduledView=ownerList.find((row:any)=>row.id===scheduled.id);
 assert.equal(scheduledView.state,'DRAFT');assert.equal(scheduledView.scheduledMeeting.meetingId,meetingId);
 const otherList=data(await call('GET',path+'/proposals',undefined,b)).items,otherView=otherList.find((row:any)=>row.id===scheduled.id);
 assert.ok(otherView);assert.equal(otherView.scheduledMeeting,undefined); // The placement does not bypass meeting read access.
 disabledMeetingOrgs.add(org);
 assert.equal((await call('POST',endpoint,input,a,1,key)).statusCode,403);
 disabledMeetingOrgs.delete(org);
 data(await call('POST',path+'/meetings/'+meetingId+'/actions/cancel',{scope:'THIS',reason:'Teste de autorização atual'},a,meetingWithProposal.meeting.version));
 const afterCancel=data(await call('GET',path+'/proposals',undefined,a)).items.find((row:any)=>row.id===scheduled.id);assert.equal(afterCancel.state,'DRAFT');assert.equal(afterCancel.scheduledMeeting,undefined);
 assert.equal((await call('POST',endpoint,input,a,1,key)).statusCode,409);
});
test("mandate inputs use the account zone and reject DST gaps/folds while preserving unchanged instants",()=>{
  assert.equal(mandateInput("2026-10-19T12:30:47Z","Asia/Tokyo"),"2026-10-19T21:30");
  assert.equal(mandateInstant("2026-10-19T21:30","Asia/Tokyo"),"2026-10-19T12:30:00.000Z");
  assert.equal(mandateInstant("2026-10-19T21:30","Asia/Tokyo","2026-10-19T12:30:47Z"),"2026-10-19T12:30:47.000Z");
  assert.throws(()=>mandateInstant("2026-03-08T02:30","America/New_York"),/NONEXISTENT/);
  assert.throws(()=>mandateInstant("2026-11-01T01:30","America/New_York"),/AMBIGUOUS/);
  assert.throws(()=>mandateInstant("2026-02-30T10:00","UTC"),/INVALID/);
});
test("deadline boundary, participation and objection consent rules", () => {
  assert.throws(()=>verdict({state:'OPEN',policy:defaultPolicy,electorate:[]},0,0,new Date()),/EMPTY_ELECTORATE/);
  const r = {
    state: "OPEN",
    electorate: ["a", "b", "c"],
    policy: { ...defaultPolicy, method: "CONSENT_WINDOW", quorumPercent: 50 },
    deadline: "2026-10-18T12:00:00Z",
  };
  assert.throws(
    () => mayVote(r, "a", new Date(r.deadline)),
    /ROUND_DEADLINE_PASSED/,
  );
  assert.throws(
    () => mayVote(r, "x", new Date("2026-10-18T11:00Z")),
    /ACTION_DENIED/,
  );
  assert.throws(
    () => verdict(r, 3, 0, new Date("2026-10-18T11:00Z")),
    /REVIEW_WINDOW_OPEN/,
  );
  assert.equal(verdict(r, 2, 0, new Date(r.deadline)), "ADOPT");
  assert.equal(verdict(r, 1, 0, new Date(r.deadline)), "REVIEW_REQUIRED");
  assert.equal(verdict(r, 3, 1, new Date(r.deadline)), "REVIEW_REQUIRED");
});
test("PostgreSQL policy snapshot, deadline, concurrent amendment, privacy, signed cursor and platform adapters", async () => {
  const a = await user();
  const A = data(
    await call("POST", "/organizations", { name: "Snapshot org" }, a),
  );
  const org = A.organization.id,
    path = "/organizations/" + org;
  const bootstrap = data(await call("GET", path + "/bootstrap", undefined, a));
  const circleId = bootstrap.rootCircleId;
  const config = {
    ...defaultPolicy,
    method: "CONSENT_WINDOW",
    quorumPercent: 100,
    allowAbstain: false,
    workflowSteps: ["DECIDE"],
  };
  const policyRow = data(
    await call(
      "POST",
      path + "/governance/policies",
      { circleId, configuration: config },
      a,
    ),
  );
  const privateDoc = data(
    await call(
      "POST",
      path + "/documents",
      {
        title: "Private source",
        ownerId: circleId,
        workflow: "GOVERNANCE",
        visibility: "AUTHOR",
        content: "sensitive text",
      },
      a,
    ),
    201,
  );
  assert.equal(
    (
      await call(
        "POST",
        path + "/proposals",
        {
          title: "Hidden draft cannot circulate",
          circleId,
          kind: "DOCUMENT",
          payload: { documentId: privateDoc.id, documentVersion: 1 },
        },
        a,
      )
    ).statusCode,
    422,
  );
  const type = data(
    await call(
      "POST",
      path + "/document-types",
      { name: "Acordo governado", workflow: "GOVERNANCE" },
      a,
    ),
    201,
  );
  assert.equal(type.name, "Acordo governado");
  const document = data(
    await call(
      "POST",
      path + "/documents",
      {
        title: "Agreement snapshot",
        ownerId: circleId,
        typeId: type.id,
        workflow: "DIRECT",
        visibility: "ORGANIZATION",
        content: "v1",
      },
      a,
    ),
    201,
  );
  assert.equal(document.workflow, "GOVERNANCE");
  const directType=data(await call('POST',path+'/document-types',{name:'Regra direta',workflow:'DIRECT'},a),201),directDoc=data(await call('POST',path+'/documents',{title:'Tipo desativável',ownerId:circleId,typeId:directType.id,workflow:'DIRECT',visibility:'ORGANIZATION',content:'conteúdo'},a),201);
  data(await call('POST',path+'/document-types/'+directType.id+'/actions/configure',{name:'Regra direta',workflow:'DIRECT',active:false},a,1));assert.equal((await call('POST',path+'/documents/'+directDoc.id+'/actions/publish',{},a,1)).statusCode,422);
  const input = {
    title: "Timed proposal",
    circleId,
    kind: "DOCUMENT",
    payload: { documentId: document.id, documentVersion: 1 },
  };
  const proposal = data(await call("POST", path + "/proposals", input, a), 201);
  assert.equal(proposal.kind,'GOVERNANCE');
  data(
    await call(
      "POST",
      path + "/proposals/" + proposal.id + "/actions/submit",
      {},
      a,
      1,
    ),
  );
  data(
    await call(
      "POST",
      path + "/governance/policies",
      { circleId, configuration: { ...defaultPolicy, allowRevote: true } },
      a,
      policyRow.version,
    ),
  );
  let detail = data(
    await call("GET", path + "/proposals/" + proposal.id, undefined, a),
  );
  assert.equal(detail.rounds[0].policy.method, "CONSENT_WINDOW");
  assert.equal(detail.rounds[0].policy.allowAbstain, false);
  assert.equal(
    (
      await call(
        "POST",
        path + "/proposals/" + proposal.id + "/votes",
        { choice: "ABSTAIN" },
        a,
        2,
      )
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await call(
        "POST",
        path + "/proposals/" + proposal.id + "/actions/decide",
        { reason: "Too early" },
        a,
        2,
      )
    ).statusCode,
    409,
  );
  await withOrg(org, a, async (ctx) =>
    ctx.c.query(
      "UPDATE gov_rounds SET deadline=clock_timestamp()-interval '1 second' WHERE organization_id=$1 AND proposal_id=$2",
      [org, proposal.id],
    ),
  );
  assert.equal(
    (
      await call(
        "POST",
        path + "/proposals/" + proposal.id + "/votes",
        { choice: "CONSENT" },
        a,
        2,
      )
    ).statusCode,
    409,
  );
  assert.equal(
    data(
      await call(
        "POST",
        path + "/proposals/" + proposal.id + "/actions/decide",
        { reason: "No quorum at deadline" },
        a,
        2,
      ),
    ).verdict,
    "REVIEW_REQUIRED",
  );
  const results = await Promise.all([
    call(
      "POST",
      path + "/proposals/" + proposal.id + "/revisions",
      { payload: {documents:[input.payload]} },
      a,
      3,
    ),
    call(
      "POST",
      path + "/proposals/" + proposal.id + "/revisions",
      { payload: {documents:[input.payload]} },
      a,
      3,
    ),
  ]);
  assert.deepEqual(results.map((x) => x.statusCode).sort(), [201, 409]);
  detail = data(
    await call("GET", path + "/proposals/" + proposal.id, undefined, a),
  );
  assert.equal(detail.revisions.length, 2);
  assert.equal(detail.revisions[0].payload.documents[0].documentVersion, 1);
  assert.equal(detail.rounds[0].state, "CLOSED");
  const first = data(
    await call("GET", path + "/documents?limit=1", undefined, a),
  );
  assert.equal(first.items.length, 1);
  assert.equal(first.page.hasMore, true);
  const second = data(
    await call(
      "GET",
      path +
        "/documents?limit=1&cursor=" +
        encodeURIComponent(first.page.nextCursor),
      undefined,
      a,
    ),
  );
  assert.notEqual(first.items[0].id, second.items[0].id);
  assert.equal(
    (
      await call(
        "GET",
        path + "/proposals?cursor=" + encodeURIComponent(first.page.nextCursor),
        undefined,
        a,
      )
    ).statusCode,
    400,
  );
  const adapters = createGovernanceResourceAdapters();
  await withOrg(org, a, async (ctx) => {
    assert.equal(
      await adapters.agreement.authorize(ctx, privateDoc.id, "read"),
      true,
    );
    const found = await adapters.proposal.search!(ctx, "Timed", 20);
    assert.equal(found[0].id, proposal.id);
    const exported = await adapters.tension.export!(ctx, [], "tension");
    assert.equal(exported.estimated, false);
    const portable = await adapters.agreement.export!(
      ctx,
      [document.id],
      "agreement",
    );
    const valid = await adapters.agreement.validateImport!(
      ctx,
      portable.records,
      "agreement",
    );
    const imported = await adapters.agreement.applyImport!(
      ctx,
      valid.plan,
      "agreement",
    );
    assert.notEqual(imported.idMap[document.id], document.id);
    assert.equal(
      (
        await ctx.c.query(
          "SELECT published_version FROM gov_documents WHERE organization_id=$1 AND id=$2",
          [org, imported.idMap[document.id]],
        )
      ).rows[0].published_version,
      null,
    );
    await assert.rejects(
      () =>
        adapters.agreement.validateImport!(
          ctx,
          [
            {
              schemaVersion: 1,
              kind: "agreement",
              sourceId: document.id,
              data: {
                title: "x",
                ownerId: circleId,
                workflow: "DIRECT",
                visibility: "AUTHOR",
                content: "x",
                publishedVersion: 1,
              },
            },
          ],
          "agreement",
        ),
      /INVALID_REQUEST/,
    );
  });
  const b = await user();
  const neverSubmitted = data(
    await call(
      "POST",
      path + "/proposals",
      { ...input, title: "Private never submitted" },
      a,
    ),
    201,
  );
  const membership = data(
    await call("POST", path + "/members", { accountId: b.id }, a),
  ).membership;
  data(
    await call(
      "POST",
      path + "/circles/" + circleId + "/memberships",
      { memberId: membership.id, startsAt:activeMembershipStart },
      a,
    ),
  );
  assert.equal(
    (await call("GET", path + "/documents/" + privateDoc.id, undefined, b))
      .statusCode,
    404,
  );
  assert.equal(
    (await call("GET", path + "/proposals/" + proposal.id, undefined, b))
      .statusCode,
    200,
  );
  await withOrg(org, b, async (ctx) => {
    assert.equal(
      await adapters.proposal.authorize(ctx, neverSubmitted.id, "read"),
      false,
    );
    assert.equal(
      (await adapters.proposal.search!(ctx, "Private never", 20)).length,
      0,
    );
    assert.equal(
      await adapters.agreement.authorize(ctx, privateDoc.id, "export"),
      false,
    );
    assert.equal(
      (await adapters.agreement.search!(ctx, "Private", 20)).length,
      0,
    );
    assert.equal(
      await adapters.proposal.authorize(ctx, proposal.id, "comment"),
      true,
    );
  });
});
test("composed real structure application and election mandate; approved document conflict preserves decision", async () => {
  const a = await user(),
    A = data(
      await call("POST", "/organizations", { name: "Composed governance" }, a),
    );
  const org = A.organization.id,
    path = "/organizations/" + org,
    bootstrap = data(await call("GET", path + "/bootstrap", undefined, a)),
    circleId = bootstrap.rootCircleId;
  async function approve(input: any) {
    const p = data(await call("POST", path + "/proposals", input, a), 201);
    data(
      await call(
        "POST",
        path + "/proposals/" + p.id + "/actions/submit",
        {},
        a,
        1,
      ),
    );
    data(
      await call(
        "POST",
        path + "/proposals/" + p.id + "/votes",
        { choice: "CONSENT" },
        a,
        2,
      ),
    );
    await advance(path, p.id, a, 2);
    data(
      await call(
        "POST",
        path + "/proposals/" + p.id + "/actions/decide",
        { verdict: "ADOPT", reason: "Processo consentido" },
        a,
        2,
      ),
    );
    return p;
  }
  const roleId = randomUUID();
  const branch = data(
    await call(
      "POST",
      path + "/governance/branches",
      {
        title: "Ramo de criação",
        changes: [
          {
            kind: "CREATE",
            entityId: roleId,
            entityKind: "ROLE",
            parentCircleId: circleId,
            name: "Guardião de Acordos",
            purpose: "Cuidar dos acordos da organização",
          },
        ],
      },
      a,
    ),
    201,
  );
  const p = await approve({
    title: "Criar papel",
    circleId,
    kind: "GOVERNANCE",
    branchId: branch.id,
  });
  const key = randomUUID();
  const applied = data(
    await call(
      "POST",
      path + "/proposals/" + p.id + "/actions/apply",
      {},
      a,
      3,
      key,
    ),
  );
  assert.equal(applied.applyState, "APPLIED");
  assert.equal(
    data(
      await call(
        "POST",
        path + "/proposals/" + p.id + "/actions/apply",
        {},
        a,
        3,
        key,
      ),
    ).commitId,
    applied.commitId,
  );
  const graph = data(await call("GET", path + "/structure", undefined, a));
  assert.ok(
    graph.nodes.some(
      (n: any) => n.entityId === roleId && n.name === "Guardião de Acordos",
    ),
  );
  data(
    await call(
      "PUT",
      path + "/structure-advanced/roles/" + roleId + "/settings",
      {
        flags: {
          core: true,
          electable: true,
          assigner: false,
          representative: false,
          admin: false,
        },
      },
      a,
      0,
    ),
  );
  const election = await approve({
    title: "Eleger guardião",
    circleId,
    kind: "ELECTION",
    payload: {
      roleId,
      winnerId: bootstrap.membership.id,
      mandateEnd: new Date(Date.now() + 86400000).toISOString(),
    },
  });
  assert.equal(
    data(
      await call(
        "POST",
        path + "/proposals/" + election.id + "/actions/apply",
        {},
        a,
        3,
      ),
    ).applyState,
    "APPLIED",
  );
  await withOrg(org, a, async (ctx) => {
    const mandates = (
      await ctx.c.query(
        "SELECT * FROM structure_mandates WHERE organization_id=$1 AND proposal_id=$2",
        [org, election.id],
      )
    ).rows;
    assert.equal(mandates.length, 1);
    assert.equal(mandates[0].kind, "ELECTED");
    assert.equal(mandates[0].role_id, roleId);
  });
  const field = data(
    await call(
      "POST",
      path + "/structure-advanced/fields",
      {
        key: "decision_rule",
        label: "Regra de decisão",
        target: "ROLE",
        schema: { type: "TEXT", required: false, max: 200 },
        governed: true,
      },
      a,
    ),
    201,
  );
  const fieldProposal = await approve({
    title: "Regra do papel",
    circleId,
    kind: "GOVERNANCE",
    payload: {
      changes: [
        {
          kind: "FIELD",
          entityId: roleId,
          fieldId: field.id,
          baseVersion: 0,
          value: "Consentimento explícito",
        },
      ],
    },
  });
  assert.equal(
    data(
      await call(
        "POST",
        path + "/proposals/" + fieldProposal.id + "/actions/apply",
        {},
        a,
        3,
      ),
    ).applyState,
    "APPLIED",
  );
  const values = data(
    await call(
      "GET",
      path + "/structure-advanced/entities/" + roleId + "/fields",
      undefined,
      a,
    ),
  );
  assert.equal(
    values.find((v: any) => v.field.id === field.id).value,
    "Consentimento explícito",
  );
  assert.equal(
    (
      await call(
        "PUT",
        path + "/structure-advanced/entities/" + roleId + "/fields/" + field.id,
        { value: "Bypass" },
        a,
        1,
      )
    ).statusCode,
    422,
  );
  const doc = data(
    await call(
      "POST",
      path + "/documents",
      {
        title: "Stale agreement",
        ownerId: circleId,
        workflow: "GOVERNANCE",
        visibility: "ORGANIZATION",
        content: "approved",
      },
      a,
    ),
    201,
  );
  const controlledType=data(await call('POST',path+'/document-types',{name:'Política do círculo',workflow:'GOVERNANCE'},a),201),controlledDoc=data(await call('POST',path+'/documents',{title:'Tipo revogado após decisão',ownerId:circleId,typeId:controlledType.id,workflow:'GOVERNANCE',visibility:'ORGANIZATION',content:'aprovável'},a),201);const controlledProposal=await approve({title:'Publicar política tipada',circleId,kind:'DOCUMENT',payload:{documentId:controlledDoc.id,documentVersion:1}});data(await call('POST',path+'/document-types/'+controlledType.id+'/actions/configure',{name:'Política do círculo',workflow:'GOVERNANCE',active:false},a,1));assert.equal(applyConflict(await call('POST',path+'/proposals/'+controlledProposal.id+'/actions/apply',{},a,3)).conflictCode,'DOCUMENT_TYPE_INACTIVE');
  const change = await approve({
    title: "Publish exact draft",
    circleId,
    kind: "DOCUMENT",
    payload: { documentId: doc.id, documentVersion: 1 },
  });
  data(
    await call(
      "POST",
      path + "/documents/" + doc.id + "/actions/draft",
      { content: "new unapproved" },
      a,
      1,
    ),
  );
  assert.equal(
    applyConflict(
      await call(
        "POST",
        path + "/proposals/" + change.id + "/actions/apply",
        {},
        a,
        3,
      ),
    ).applyState,
    "APPLY_CONFLICT",
  );
  assert.equal(
    data(await call("GET", path + "/documents/" + doc.id, undefined, a))
      .document.publishedVersion,
    null,
  );
  assert.equal(
    data(await call("GET", path + "/proposals/" + change.id, undefined, a))
      .proposal.verdict,
    "ADOPT",
  );
  const memberUser = await user(),
    membership = data(
      await call("POST", path + "/members", { accountId: memberUser.id }, a),
    ).membership;
  data(
    await call(
      "POST",
      path + "/circles/" + circleId + "/memberships",
      { memberId: membership.id, startsAt:activeMembershipStart },
      a,
    ),
  );
  const memberElection = data(
    await call(
      "POST",
      path + "/proposals",
      {
        title: "Eleição iniciada por membro",
        circleId,
        kind: "ELECTION",
        payload: {
          roleId,
          winnerId: null,
          mandateEnd: new Date(Date.now() + 172800000).toISOString(),
        },
      },
      memberUser,
    ),
    201,
  );
  data(
    await call(
      "POST",
      path + "/proposals/" + memberElection.id + "/nominations",
      {
        candidateId: membership.id,
        rationale: "Disponibilidade para cuidar dos acordos",
      },
      memberUser,
      1,
    ),
    201,
  );
  const facilitated = data(
    await call("GET", path + "/proposals/" + memberElection.id, undefined, a),
  );
  assert.equal(facilitated.nominations.length, 1);
  assert.equal(
    (
      await call(
        "POST",
        path + "/proposals/" + memberElection.id + "/actions/submit",
        {},
        memberUser,
        1,
      )
    ).statusCode,
    422,
  );
  data(
    await call(
      "POST",
      path + "/proposals/" + memberElection.id + "/revisions",
      {
        payload: {
          roleId,
          winnerId: membership.id,
          mandateEnd: new Date(Date.now() + 172800000).toISOString(),
        },
      },
      a,
      1,
    ),
    201,
  );
  data(
    await call(
      "POST",
      path + "/proposals/" + memberElection.id + "/actions/submit",
      {},
      a,
      2,
    ),
  );
  data(
    await call(
      "POST",
      path + "/proposals/" + memberElection.id + "/votes",
      { choice: "CONSENT" },
      a,
      3,
    ),
  );
  data(
    await call(
      "POST",
      path + "/proposals/" + memberElection.id + "/votes",
      { choice: "CONSENT" },
      memberUser,
      3,
    ),
  );
  await advance(path, memberElection.id, a, 3);
  data(
    await call(
      "POST",
      path + "/proposals/" + memberElection.id + "/actions/decide",
      { verdict: "ADOPT", reason: "Candidato indicado e consentido" },
      a,
      3,
    ),
  );
  assert.equal(
    data(
      await call(
        "POST",
        path + "/proposals/" + memberElection.id + "/actions/apply",
        {},
        a,
        4,
      ),
    ).applyState,
    "APPLIED",
  );
});
test("PostgreSQL workflow, tenant isolation, exact document revision, replay, member voting, rollback", async () => {
  const a = await user(),
    b = await user();
  const A = data(await call("POST", "/organizations", { name: "Gov A" }, a));
  const B = data(await call("POST", "/organizations", { name: "Gov B" }, b));
  const path = "/organizations/" + A.organization.id,
    other = "/organizations/" + B.organization.id;
  const structure = data(await call("GET", path + "/structure", undefined, a));
  const root = structure.nodes[0].entityId;
  const bootstrap = data(await call("GET", path + "/bootstrap", undefined, a));
  const ownerId = bootstrap.membership.id;
  const doc = data(
    await call(
      "POST",
      path + "/documents",
      {
        title: "Acordo novo",
        ownerId: root,
        workflow: "GOVERNANCE",
        visibility: "ORGANIZATION",
        content: "texto aprovado",
      },
      a,
    ),
    201,
  );
  assert.equal(
    (await call("GET", other + "/documents/" + doc.id, undefined, b))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "POST",
        path + "/documents/" + doc.id + "/actions/publish",
        {},
        a,
        1,
      )
    ).statusCode,
    422,
  );
  const tension = data(
    await call(
      "POST",
      path + "/tensions",
      { title: "Melhorar um acordo", circleId: root },
      a,
    ),
    201,
  );
  const key = randomUUID();
  const input = {
    title: "Publicar acordo",
    circleId: root,
    tensionId: tension.id,
    kind: "DOCUMENT",
    payload: { documentId: doc.id, documentVersion: 1 },
  };
  const p = data(
    await call("POST", path + "/proposals", input, a, undefined, key),
    201,
  );
  assert.equal(
    data(await call("POST", path + "/proposals", input, a, undefined, key), 201)
      .id,
    p.id,
  );
  assert.equal(
    (
      await call(
        "POST",
        path + "/proposals",
        { ...input, title: "Mudança" },
        a,
        undefined,
        key,
      )
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await call(
        "POST",
        path + "/tensions/" + tension.id + "/actions/close",
        {},
        a,
        2,
      )
    ).statusCode,
    409,
  );
  assert.equal(
    (await call("POST", path + "/proposals/" + p.id + "/actions/submit", {}, a))
      .statusCode,
    428,
  );
  const submitted = data(
    await call(
      "POST",
      path + "/proposals/" + p.id + "/actions/submit",
      {},
      a,
      1,
    ),
  );
  assert.deepEqual(submitted.round.electorate, [ownerId]);
  const voteKey = randomUUID();
  data(
    await call(
      "POST",
      path + "/proposals/" + p.id + "/votes",
      { choice: "OBJECT", rationale: "Risco concreto" },
      a,
      2,
      voteKey,
    ),
  );
  data(
    await call(
      "POST",
      path + "/proposals/" + p.id + "/votes",
      { choice: "OBJECT", rationale: "Risco concreto" },
      a,
      2,
      voteKey,
    ),
  );
  assert.equal(
    (
      await call(
        "POST",
        path + "/proposals/" + p.id + "/votes",
        { choice: "CONSENT" },
        a,
        2,
      )
    ).statusCode,
    409,
  );
  let detail = data(
    await call("GET", path + "/proposals/" + p.id, undefined, a),
  );
  assert.equal(detail.ballots.length, 1);
  assert.equal(detail.objections.length, 1);
  const summary = data(
    await call("GET", path + "/proposals", undefined, a),
  ).items.find((item: any) => item.id === p.id);
  assert.equal(summary.responseCount, 1);
  assert.equal(summary.electorateCount, 1);
  assert.equal(summary.ownVote, "OBJECT");
  assert.equal(summary.canVote, false);
  assert.equal(summary.evolutionCount, 1);
  assert.ok(Number.isFinite(Date.parse(summary.createdAt)));
  await advance(path, p.id, a, 2);
  assert.equal(
    (
      await call(
        "POST",
        path + "/proposals/" + p.id + "/actions/decide",
        { verdict: "ADOPT", reason: "Consenso" },
        a,
        2,
      )
    ).statusCode,
    409,
  );
  data(
    await call(
      "POST",
      path +
        "/governance/objections/" +
        detail.objections[0].id +
        "/actions/review",
      { state: "INTEGRATED", reason: "Alteração de prática acordada" },
      a,
      1,
    ),
  );
  data(
    await call(
      "POST",
      path + "/proposals/" + p.id + "/actions/decide",
      { verdict: "ADOPT", reason: "Objeção integrada" },
      a,
      2,
    ),
  );
  const applied = data(
    await call(
      "POST",
      path + "/proposals/" + p.id + "/actions/apply",
      {},
      a,
      3,
    ),
  );
  assert.equal(applied.applyState, "APPLIED");
  assert.equal(
    data(await call("GET", path + "/documents/" + doc.id, undefined, a))
      .document.publishedVersion,
    1,
  );
  assert.equal(
    (
      await call(
        "POST",
        path + "/proposals/" + p.id + "/actions/apply",
        {},
        a,
        4,
      )
    ).statusCode,
    409,
  );
  data(
    await call(
      "POST",
      path + "/documents/" + doc.id + "/actions/draft",
      { content: "segunda versão" },
      a,
      2,
    ),
  );
  data(
    await call(
      "POST",
      path + "/documents/" + doc.id + "/actions/restore",
      { number: 1 },
      a,
      3,
    ),
  );
  const restored = data(
    await call("GET", path + "/documents/" + doc.id, undefined, a),
  );
  assert.equal(restored.versions.length, 3);
  assert.equal(restored.versions[0].content, "texto aprovado");
  const p2 = data(
    await call(
      "POST",
      path + "/proposals",
      {
        title: "Estrutura",
        circleId: root,
        kind: "GOVERNANCE",
        payload: {
          changes: [
            { kind: "UPDATE", entityId: root, baseVersion: 1, purpose: "Novo" },
          ],
        },
      },
      a,
    ),
    201,
  );
  data(
    await call(
      "POST",
      path + "/proposals/" + p2.id + "/actions/submit",
      {},
      a,
      1,
    ),
  );
  data(
    await call(
      "POST",
      path + "/proposals/" + p2.id + "/votes",
      { choice: "CONSENT" },
      a,
      2,
    ),
  );
  await advance(path, p2.id, a, 2);
  data(
    await call(
      "POST",
      path + "/proposals/" + p2.id + "/actions/decide",
      { verdict: "ADOPT", reason: "Aprovada" },
      a,
      2,
    ),
  );
  assert.equal(
    applyConflict(
      await call(
        "POST",
        path + "/proposals/" + p2.id + "/actions/apply",
        {},
        a,
        3,
      ),
    ).applyState,
    "APPLY_CONFLICT",
  );
  detail = data(await call("GET", path + "/proposals/" + p2.id, undefined, a));
  assert.equal(detail.commits.length, 0);
  assert.equal(detail.proposal.verdict, "ADOPT");
  await withOrg(A.organization.id, a, async (ctx) => {
    assert.equal(
      (
        await ctx.c.query(
          "SELECT count(*) FROM gov_history WHERE organization_id=$1 AND action='TEST_PARTIAL'",
          [A.organization.id],
        )
      ).rows[0].count,
      "0",
    );
    assert.equal(
      (
        await ctx.c.query(
          "SELECT purpose,version FROM entities WHERE organization_id=$1 AND id=$2",
          [A.organization.id, root],
        )
      ).rows[0].purpose,
      "",
    );
  });
  data(
    await call(
      "POST",
      path + "/proposals/" + p2.id + "/revisions",
      {
        payload: {
          changes: [
            {
              kind: "UPDATE",
              entityId: root,
              baseVersion: 1,
              purpose: "Propósito revisado",
            },
          ],
        },
      },
      a,
      4,
    ),
    201,
  );
  const fresh = data(
    await call(
      "POST",
      path + "/proposals/" + p2.id + "/actions/submit",
      {},
      a,
      5,
    ),
  );
  assert.equal(fresh.proposal.revision, 2);
  assert.notEqual(fresh.round.id, detail.rounds[0].id);
  detail = data(await call("GET", path + "/proposals/" + p2.id, undefined, a));
  assert.equal(
    detail.ballots.filter((ballot: any) => ballot.roundId === fresh.round.id)
      .length,
    0,
  );
  assert.equal(detail.ballots.length, 1);
  data(
    await call(
      "POST",
      path + "/proposals/" + p2.id + "/votes",
      { choice: "CONSENT" },
      a,
      6,
    ),
  );
  await advance(path, p2.id, a, 6);
  data(
    await call(
      "POST",
      path + "/proposals/" + p2.id + "/actions/decide",
      { verdict: "ADOPT", reason: "Nova revisão consentida" },
      a,
      6,
    ),
  );
  assert.equal(
    data(
      await call(
        "POST",
        path + "/proposals/" + p2.id + "/actions/apply",
        {},
        a,
        7,
      ),
    ).applyState,
    "APPLIED",
  );
  const member = data(
    await call("POST", path + "/members", { accountId: b.id }, a),
  ).membership;
  // Organization membership permits reading a decided proposal in another circle,
  // without conferring participation or edit rights.
  const crossCircleList = data(await call("GET", path + "/proposals", undefined, b)).items;
  assert.ok(crossCircleList.some((row: any) => row.id === p2.id));
  const crossCircleDetail = data(await call("GET", path + "/proposals/" + p2.id, undefined, b));
  assert.equal(crossCircleDetail.proposal.canEdit, false);
  assert.equal(crossCircleDetail.proposal.canVote, false);
  const otherCircleTension=data(await call('POST',path+'/tensions',{title:'Tensão acessível na organização',circleId:root},a),201);
  const crossCircleTensions=data(await call('GET',path+'/tensions',undefined,b)).items;
  assert.ok(crossCircleTensions.some((row:any)=>row.id===otherCircleTension.id));
  assert.equal((await call('POST',path+'/proposals',{...input,tensionId:otherCircleTension.id},b)).statusCode,403);
  data(
    await call(
      "POST",
      path + "/circles/" + root + "/memberships",
      { memberId: member.id, startsAt:activeMembershipStart },
      a,
    ),
  );
  data(
    await call(
      "POST",
      path + "/governance/policies",
      {
        circleId: root,
        configuration: {
          ...defaultPolicy,
          method: "CONSENT_ROUND",
          allowRevote: true,
          quorumPercent: 50,
        },
      },
      a,
    ),
  );
  const p3 = data(
    await call(
      "POST",
      path + "/proposals",
      { ...input, tensionId: undefined, title: "Membro participa" },
      b,
    ),
    201,
  );
  data(
    await call(
      "POST",
      path + "/proposals/" + p3.id + "/actions/submit",
      {},
      b,
      1,
    ),
  );
  const memberVoteKey = randomUUID();
  data(
    await call(
      "POST",
      path + "/proposals/" + p3.id + "/votes",
      { choice: "CONSENT" },
      b,
      2,
      memberVoteKey,
    ),
  );
  data(
    await call(
      "POST",
      path + "/proposals/" + p3.id + "/votes",
      { choice: "ABSTAIN" },
      b,
      2,
    ),
  );
  data(
    await call(
      "PATCH",
      path + "/members/" + member.id,
      { status: "SUSPENDED" },
      a,
      member.version,
    ),
  );
  assert.equal(
    (
      await call(
        "POST",
        path + "/proposals/" + p3.id + "/votes",
        { choice: "CONSENT" },
        b,
        2,
        memberVoteKey,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (await call("GET", path + "/documents", undefined, a)).statusCode,
    200,
  );
  assert.equal(
    (await call("GET", other + "/proposals/" + p.id, undefined, b)).statusCode,
    404,
  );
  assert.equal((await pool.query("SELECT * FROM gov_proposals")).rowCount, 0);
});
test("real task/goal conversion from tension is atomic, idempotent and preserves both links", async () => {
  const a = await user(),
    A = data(
      await call("POST", "/organizations", { name: "Tension conversion" }, a),
    ),
    org = A.organization.id,
    path = "/organizations/" + org;
  const bootstrap = data(await call("GET", path + "/bootstrap", undefined, a));
  const t = data(
      await call(
        "POST",
        path + "/tensions",
        {
          title: "Definir o próximo experimento",
          circleId: bootstrap.rootCircleId,
        },
        a,
      ),
      201,
    ),
    key = randomUUID();
  const task = data(
    await call(
      "POST",
      path + "/tensions/" + t.id + "/actions/process",
      { targetKind: "TASK" },
      a,
      1,
      key,
    ),
  );
  assert.equal(
    data(
      await call(
        "POST",
        path + "/tensions/" + t.id + "/actions/process",
        { targetKind: "TASK" },
        a,
        1,
        key,
      ),
    ).targetId,
    task.targetId,
  );
  assert.equal(
    (
      await call(
        "POST",
        path + "/tensions/" + t.id + "/actions/process",
        { targetKind: "GOAL" },
        a,
        2,
      )
    ).statusCode,
    422,
  );
  const year = new Date().getUTCFullYear();
  data(
    await call(
      "POST",
      path + "/goal-periods",
      {
        title: "Ano de teste",
        startsOn: year + "-01-01",
        endsOn: year + "-12-31",
      },
      a,
    ),
    201,
  );
  const goal = data(
    await call(
      "POST",
      path + "/tensions/" + t.id + "/actions/process",
      { targetKind: "GOAL" },
      a,
      2,
    ),
  );
  assert.notEqual(goal.targetId, task.targetId);
  await withOrg(org, a, async (ctx) => {
    assert.equal(
      (
        await ctx.c.query(
          "SELECT count(*) FROM gov_tension_links WHERE organization_id=$1 AND tension_id=$2",
          [org, t.id],
        )
      ).rows[0].count,
      "2",
    );
    assert.equal(
      (
        await ctx.c.query(
          "SELECT source_tension_id FROM work_tasks WHERE organization_id=$1 AND id=$2",
          [org, task.targetId],
        )
      ).rows[0].source_tension_id,
      t.id,
    );
    assert.equal(
      (
        await ctx.c.query(
          "SELECT id FROM goals WHERE organization_id=$1 AND id=$2",
          [org, goal.targetId],
        )
      ).rowCount,
      1,
    );
  });
  const failed = data(
    await call(
      "POST",
      path + "/tensions",
      { title: "Falha após criar alvo", circleId: bootstrap.rootCircleId },
      a,
    ),
    201,
  );
  assert.equal(
    (
      await call(
        "POST",
        path + "/tensions/" + failed.id + "/actions/process",
        { targetKind: "TASK" },
        a,
        1,
      )
    ).statusCode,
    409,
  );
  await withOrg(org, a, async (ctx) => {
    assert.equal(
      (
        await ctx.c.query(
          "SELECT count(*) FROM work_tasks WHERE organization_id=$1 AND source_tension_id=$2",
          [org, failed.id],
        )
      ).rows[0].count,
      "0",
    );
    assert.equal(
      (
        await ctx.c.query(
          "SELECT state,version FROM gov_tensions WHERE organization_id=$1 AND id=$2",
          [org, failed.id],
        )
      ).rows[0].state,
      "OPEN",
    );
  });
});

test('proposal circle choices use current command authority and never leak other tenants',async()=>{
 const owner=await user(),person=await user(),outsider=await user();
 const A=data(await call('POST','/organizations',{name:'Proposal choices A'},owner));
 const B=data(await call('POST','/organizations',{name:'Proposal choices B'},outsider));
 const path='/organizations/'+A.organization.id,other='/organizations/'+B.organization.id;
 const member=data(await call('POST',path+'/members',{accountId:person.id},owner)).membership;
 const endpoint=path+'/governance/proposal-circles';
 const initial=data(await call('GET',endpoint,undefined,owner));
 assert.ok(initial.items.some((item:any)=>item.id===A.rootCircle.id));
 assert.deepEqual(data(await call('GET',endpoint,undefined,person)).items,[]);
 data(await call('POST',path+'/circles/'+A.rootCircle.id+'/memberships',{memberId:member.id,startsAt:activeMembershipStart},owner));
 assert.deepEqual(data(await call('GET',endpoint,undefined,person)).items.map((item:any)=>item.id),[A.rootCircle.id]);
 assert.equal((await call('GET',other+'/governance/proposal-circles',undefined,owner)).statusCode,404);
 assert.equal((await call('GET',endpoint,undefined,outsider)).statusCode,404);
 await withOrg(A.organization.id,owner,async ctx=>{
   const modeled=new Governance(ctx,{} as any,{...governancePorts,modelParticipation:async()=>false});
   assert.equal(await modeled.participates(A.rootCircle.id),false,'owner does not bypass active model participation');
 });
});

test("proposal catalogue exposes only structural kinds needed by type filters",async()=>{
 const owner=await user(),other=await user();
 const organization=data(await call('POST','/organizations',{name:'Catalogue kinds'},owner)).organization.id;
 const base='/organizations/'+organization;
 const circleId=data(await call('GET',base+'/bootstrap',undefined,owner)).rootCircleId;
 const proposal=data(await call('POST',base+'/proposals',{title:'Two structural kinds',circleId,kind:'GOVERNANCE',payload:{changes:[{kind:'CREATE',entityId:randomUUID(),entityKind:'ROLE',name:'Test role',purpose:'Purpose',parentCircleId:circleId},{kind:'CREATE',entityId:randomUUID(),entityKind:'CIRCLE',name:'Test circle',purpose:'Purpose',parentCircleId:circleId}]}},owner),201);
 const item=data(await call('GET',base+'/proposals',undefined,owner)).items.find((row:any)=>row.id===proposal.id);
 assert.deepEqual([...item.changeKinds].sort(),['CIRCLE','ROLE']);assert.equal(item.payload,undefined);
 assert.equal((await call('GET',base+'/proposals',undefined,other)).statusCode,404);
});
