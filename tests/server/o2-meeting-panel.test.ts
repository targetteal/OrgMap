import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../server/src/app.js";
import { pool } from "../../server/src/db.js";
import { createOrgMapIntegration } from "../../server/integration/index.js";
import { seedO2Panel } from "../../server/modules/meetings/o2-fixture.js";
import { nextStage } from "../../server/modules/meetings/o2-panel.js";
import { fromPlainText } from "../../packages/content/index.js";
const origin = "http://127.0.0.1:5216";
process.env.ALLOWED_ORIGINS = origin;
if (
  !new URL(
    process.env.DATABASE_URL ?? "postgres://invalid/no",
  ).pathname.startsWith("/orgmap_o2panel_")
)
  throw Error("DISPOSABLE_O2_PANEL_DATABASE_REQUIRED");
after(() => pool.end());
test('the meeting panel reads every restriction from its own pinned document revision',async()=>{
  const app=await buildApp([createOrgMapIntegration()],{migrationScope:'all'});
  try {
    const f=await seedO2Panel(app,origin);
    const create=async(title:string,content:string)=>f.call(f.owner,'POST',f.base+'/documents',{title,ownerId:f.rootId,workflow:'GOVERNANCE',visibility:'ORGANIZATION',richContent:fromPlainText(content)});
    const a=await create('First panel restriction','Panel first v1'),b=await create('Second panel restriction','Panel second v1');
    const second=await f.call(f.owner,'POST',f.base+'/documents/'+b.id+'/actions/draft',{richContent:fromPlainText('Panel second v2')},b.version);
    const room=await f.call(f.scribe,'GET',f.url);
    const output=await f.call(f.scribe,'POST',f.url+'/outcomes',{
      kind:'PROPOSAL',title:'Both restrictions',proposalKind:'GOVERNANCE',agendaId:f.agendaId,
      payload:{documents:[{documentId:a.id,documentVersion:1},{documentId:b.id,documentVersion:2}]},
    },room.meeting.version);
    await f.call(f.owner,'POST',f.base+'/documents/'+b.id+'/actions/draft',{content:'Panel later unpublished v3'},second.version);
    const panel=await f.call(f.scribe,'GET',f.url+'/panel');
    const proposal=panel.proposals.find((p:any)=>p.proposal.id===output.target.id);
    assert.deepEqual(proposal.documents.map((d:any)=>[d.documentId,d.number,d.title,d.content]),[
      [a.id,1,'First panel restriction','Panel first v1'],[b.id,2,'Second panel restriction','Panel second v2'],
    ]);
    assert.deepEqual(proposal.document,proposal.documents[0]);
    assert.deepEqual(proposal.documents.map((d:any)=>d.richContent),[fromPlainText('Panel first v1'),fromPlainText('Panel second v2')]);
  } finally {await app.close();}
});
test('operating circle DIRECT restrictions coexist with plural governance readers and exact minutes',async()=>{
  const app=await buildApp([createOrgMapIntegration()],{migrationScope:'all'});
  try {
    const f=await seedO2Panel(app,origin);
    const create=(title:string,workflow:string,content:string)=>f.call(f.owner,'POST',f.base+'/documents',{
      title,ownerId:f.rootId,workflow,visibility:'ORGANIZATION',richContent:fromPlainText(content),
    });
    const direct=await create('Circle direct restriction','DIRECT','Published during preparation');
    await f.call(f.owner,'POST',f.base+'/documents/'+direct.id+'/actions/publish',{},direct.version);
    const published=(await f.call(f.owner,'GET',f.base+'/documents/'+direct.id)).document;
    const draft=await f.call(f.owner,'POST',f.base+'/documents/'+direct.id+'/actions/draft',{
      richContent:fromPlainText('Direct restriction proposed v2'),
    },published.version);
    const governed=await create('Governance restriction','GOVERNANCE','Governance proposed v1');
    const preparation=await f.call(f.owner,'GET',f.base+'/governance-model');
    const operating=await f.call(f.owner,'POST',f.base+'/governance-model/start',{},preparation.revision);
    assert.equal(operating.phase,'OPERATING');
    for(const action of ['publish','archive']){
      const response=await f.raw(f.owner,'POST',f.base+'/documents/'+direct.id+'/actions/'+action,{},draft.version);
      assert.equal(response.statusCode,422,response.body);
      assert.equal(response.json().error.code,'FIELD_GOVERNED');
    }
    const room=await f.call(f.scribe,'GET',f.url);
    const output=await f.call(f.scribe,'POST',f.url+'/outcomes',{
      kind:'PROPOSAL',title:'Both restriction workflows',proposalKind:'GOVERNANCE',agendaId:f.agendaId,
      payload:{documents:[{documentId:direct.id,documentVersion:2},{documentId:governed.id,documentVersion:1}]},
    },room.meeting.version);
    const path=f.base+'/proposals/'+output.target.id;
    const detail=await f.call(f.scribe,'GET',path);
    const expected=[[direct.id,2,'Direct restriction proposed v2'],[governed.id,1,'Governance proposed v1']];
    const pins=(documents:any[])=>documents.map(d=>[d.documentId,d.number,d.content]);
    assert.deepEqual(pins(detail.meetingDocuments),expected);
    assert.deepEqual(detail.meetingDocument,detail.meetingDocuments[0]);
    assert.equal(detail.proposal.policy.decisionProcess,'HOLACRACY_O2');
    assert.equal(typeof detail.proposal.allowOverride,'boolean');
    const panel=(await f.call(f.scribe,'GET',f.url+'/panel')).proposals.find((p:any)=>p.proposal.id===output.target.id);
    assert.deepEqual(pins(panel.documents),expected);
    assert.deepEqual(panel.document,panel.documents[0]);
    assert.deepEqual(panel.detail.documents.map((d:any)=>[d.documentId,d.proposedContent,d.publishedContent]),[
      [direct.id,'Direct restriction proposed v2','Published during preparation'],
      [governed.id,'Governance proposed v1',null],
    ]);
    assert.equal(panel.detail.originTension.id,room.agenda.find((a:any)=>a.id===f.agendaId).sourceId);
    assert.equal(detail.originTension.id,panel.detail.originTension.id);
    await f.panelCommand(f.facilitator,'process',{action:'start',proposalId:output.target.id,revision:1});
    for(let i=0;i<4;i++)await f.panelCommand(f.facilitator,'process',{
      action:'advance',proposalId:output.target.id,revision:1,confirmed:true,
    });
    const ready=await f.call(f.scribe,'GET',path);
    const result=await f.call(f.scribe,'POST',path+'/actions/meeting-consent',{
      meetingVersion:ready.proposal.consentMeetingVersion,revision:1,confirmed:true,reason:'Both restrictions agreed',
    },ready.proposal.version);
    assert.equal(result.proposal.applyState,'APPLIED');
    for(const [document,number] of [[direct,2],[governed,1]] as const){
      const current=await f.call(f.owner,'GET',f.base+'/documents/'+document.id);
      assert.equal(current.document.publishedVersion,number);
      const version=current.versions.find((v:any)=>v.number===number);
      assert.equal(version.origin.kind,'governed');
      assert.equal(version.origin.proposal.id,output.target.id);
      assert.equal(version.origin.proposalRevision,1);
      await f.call(f.owner,'POST',f.base+'/documents/'+document.id+'/actions/draft',{
        content:'Later unpublished content must stay outside the minutes',
      },current.document.version);
    }
    const directVersions=(await f.call(f.owner,'GET',f.base+'/documents/'+direct.id)).versions;
    assert.equal(directVersions.find((v:any)=>v.number===1).origin.kind,'direct');
    assert.deepEqual(pins((await f.call(f.scribe,'GET',path)).meetingDocuments),expected);
    const latestRoom=await f.call(f.scribe,'GET',f.url);
    await f.call(f.scribe,'POST',f.url+'/actions/close',{},latestRoom.meeting.version);
    const minutes=(await f.call(f.scribe,'GET',f.url+'/report/versions')).items[0].snapshot;
    const decision=minutes.o2.decisions.find((d:any)=>d.id===output.target.id);
    assert.deepEqual(pins(decision.restrictions),expected);
    assert.deepEqual(decision.restriction,decision.restrictions[0]);
  } finally {await app.close();}
});
test("integrative transitions require integration and a fresh objection round", () => {
  assert.equal(nextStage("OBJECT", "integrate", 1), "INTEGRATE");
  assert.throws(() => nextStage("OBJECT", "advance", 1));
  assert.equal(nextStage("INTEGRATE", "advance", 0), "OBJECT");
  assert.equal(nextStage("OBJECT", "advance", 0), "APPROVED");
  assert.throws(() => nextStage("APPROVED", "advance", 0));
});
test("a Sync tension keeps its project and origin when an O2 proposal is prepared", async () => {
  const app = await buildApp([createOrgMapIntegration()], { migrationScope: "all" });
  try {
    const f = await seedO2Panel(app, origin);
    const { scribe, guest, facilitator } = f;
    await f.call(f.owner, "POST", f.base + "/members", {
      accountId: f.outsider.accountId, memberType: "GUEST",
    });
    await f.panelCommand(facilitator, "tension", {
      title: "Uma convidada externa não bloqueia a pauta", mode: "SYNC",
    });
    const before = await f.call(scribe, "GET", f.url);
    assert.ok(before.agenda.some((a: any) => a.title === "Uma convidada externa não bloqueia a pauta"));
    const entry = before.agenda.find((a: any) => a.title === "Prioridades da semana");
    assert.ok(entry?.sourceId);
    const endpoint = f.url + "/outcomes";
    const project = await f.call(scribe, "POST", endpoint, {
      kind: "PROJECT", agendaId: entry.id, title: "Organizar a semana", visibility: "PUBLIC", leadMemberId:scribe.memberId,
    }, before.meeting.version);
    await f.panelCommand(scribe, "focus", { agendaId: entry.id });
    const version = (await f.call(scribe, "GET", f.url)).meeting.version;
    const outcome = {
      kind: "PROPOSAL", proposalKind: "GOVERNANCE", title: "Organizar a semana",
      agendaId: entry.id,
      payload: { changes: [{ kind: "CREATE", entityId: randomUUID(), entityKind: "ROLE", parentCircleId: f.rootId, name: "Organizar entregas", purpose: "Dar visibilidade às entregas" }] },
    };
    assert.equal((await f.raw(guest, "POST", endpoint, outcome, version)).statusCode, 403);
    assert.equal((await f.raw(scribe, "POST", endpoint, outcome, before.meeting.version)).statusCode, 409);
    const key = randomUUID();
    const firstResponse = await f.raw(scribe, "POST", endpoint, outcome, version, key);
    assert.equal(firstResponse.statusCode, 200, firstResponse.body);
    const created = firstResponse.json().data;
    const replay = await f.raw(scribe, "POST", endpoint, outcome, version, key);
    assert.equal(replay.statusCode, 200, replay.body);
    assert.deepEqual(replay.json().data, created);
    const detail = await f.call(scribe, "GET", f.url);
    assert.equal(detail.agenda.find((a: any) => a.id === entry.id).sourceId, entry.sourceId);
    const links = detail.actions.filter((a: any) => a.agendaId === entry.id);
    assert.deepEqual(links.map((a: any) => a.targetId).sort(), [project.target.id, created.target.id].sort());
    const path = f.base + "/proposals/" + created.target.id;
    const proposal = (await f.call(scribe, "GET", path)).proposal;
    assert.equal(proposal.state, "DRAFT");
    assert.equal((await f.call(scribe, "GET", path + "/origin")).origin.id, entry.id);
    const panel = await f.call(scribe, "GET", f.url + "/panel");
    assert.equal(panel.treatments.find((t: any) => t.agendaId === entry.id).mode, "SYNC");
    assert.equal(panel.processes.some((p: any) => p.proposalId === proposal.id), false);
    const submit = await f.raw(scribe, "POST", path + "/actions/submit", {}, proposal.version);
    assert.equal(submit.json().error.code, "MEETING_CONSENT_REQUIRED");
    const premature = await f.raw(scribe, "POST", path + "/actions/meeting-consent", {
      meetingVersion: detail.meeting.version, revision: proposal.revision, confirmed: true, reason: "Sem objeções",
    }, proposal.version);
    assert.equal(premature.json().error.code, "INTEGRATIVE_PROCESS_REQUIRED");
    await f.panelCommand(facilitator, "process", { action: "start", proposalId: proposal.id, revision: proposal.revision });
    assert.equal((await f.call(scribe, "GET", f.url + "/panel")).processes.find((p: any) => p.proposalId === proposal.id).stage, "PRESENT");
  } finally {
    await app.close();
  }
});
test("an acting scribe can revise a different author's restriction without reusing integrative consent", async () => {
  const app = await buildApp([createOrgMapIntegration()], { migrationScope: 'all' });
  try {
    const f = await seedO2Panel(app, origin);
    const {scribe, facilitator:author, guest, owner} = f;
    const room = await f.call(scribe,'GET',f.url);
    const agenda = room.agenda.find((entry:any)=>entry.title==='Prioridades da semana');
    await f.panelCommand(scribe,'focus',{agendaId:agenda.id});
    const version = async () => (await f.call(scribe,'GET',f.url)).meeting.version;
    const created = await f.call(author,'POST',f.url+'/outcomes',{
      kind:'POLICY',agendaId:agenda.id,title:'Restrição da facilitadora',content:'Texto original',
    },await version());
    const path=f.base+'/proposals/'+created.target.id;
    const first=await f.call(scribe,'GET',path);
    assert.equal(first.proposal.authorId,author.memberId);
    assert.equal(first.proposal.canAmend,true);
    assert.equal(first.proposal.canEdit,false);
    assert.equal(first.proposal.meetingConsentPending,true);
    assert.equal(first.proposal.consentMeetingId,undefined);
    const own=await f.call(author,'GET',path);
    assert.equal(own.proposal.canAmend,true);
    assert.equal(own.proposal.consentMeetingId,undefined);
    assert.equal((await f.raw(scribe,'POST',path+'/actions/submit',{},first.proposal.version)).statusCode,403);
    const approve = async (revision:number) => {
      await f.panelCommand(author,'process',{action:'start',proposalId:created.target.id,revision});
      for(let i=0;i<4;i++) await f.panelCommand(author,'process',{action:'advance',proposalId:created.target.id,revision,confirmed:true});
    };
    await approve(1);
    const approved=await f.call(scribe,'GET',path);
    assert.equal(approved.proposal.consentMeetingId,f.meeting);
    const consent = {meetingVersion:approved.proposal.consentMeetingVersion,revision:1,confirmed:true,reason:'Sem objeções'};
    assert.equal((await f.raw(author,'POST',path+'/actions/meeting-consent',consent,approved.proposal.version)).statusCode,403);
    for (const actor of [guest,owner]) assert.ok([403,404].includes((await f.raw(actor,'POST',path+'/actions/meeting-consent',consent,approved.proposal.version)).statusCode));

    const documentId=first.revisions[0].payload.documents[0].documentId;
    const amend={draftOnly:true,payload:{documents:[{documentRevision:{documentId,version:first.meetingDocuments[0].editableDocumentVersion,richContent:fromPlainText('Texto revisado pelo escriba')}}]}};
    assert.ok([403,404].includes((await f.raw(guest,'POST',path+'/revisions',amend,first.proposal.version)).statusCode));
    const outside=await f.call(author,'POST',f.base+'/documents',{title:'Outside this proposal',ownerId:f.rootId,workflow:'GOVERNANCE',visibility:'ORGANIZATION',richContent:fromPlainText('Unrelated body')});
    assert.equal((await f.raw(scribe,'POST',f.base+'/documents/'+documentId+'/actions/draft',{richContent:fromPlainText('Direct bypass')},first.meetingDocuments[0].editableDocumentVersion)).statusCode,403);
    assert.equal((await f.raw(scribe,'POST',path+'/revisions',{draftOnly:true,payload:{documents:[{documentRevision:{documentId:outside.id,version:outside.version,richContent:fromPlainText('Unrelated bypass')}}]}},first.proposal.version)).statusCode,403);
    assert.equal((await f.call(author,'GET',f.base+'/documents/'+outside.id)).document.draftVersion,1);
    const key=randomUUID();
    const saved=await f.raw(scribe,'POST',path+'/revisions',amend,first.proposal.version,key);
    assert.equal(saved.statusCode,201,saved.body);
    assert.deepEqual((await f.raw(scribe,'POST',path+'/revisions',amend,first.proposal.version,key)).json().data,saved.json().data);
    assert.equal((await f.raw(author,'POST',path+'/revisions',amend,first.proposal.version)).json().error.code,'VERSION_CONFLICT');
    const latest=await f.call(author,'GET',path);
    assert.equal(latest.proposal.authorId,author.memberId);
    assert.equal(latest.proposal.revision,2);
    assert.equal(latest.meetingDocument.content,'Texto revisado pelo escriba');
    assert.equal(latest.history.find((event:any)=>event.action==='ProposalRevised').actorId,scribe.memberId);
    const historical=await f.call(author,'GET',path+'?documentRevision=1');
    assert.equal(historical.meetingDocument.content,'Texto original');
    assert.equal(historical.meetingDocument.proposalRevision,1);
    assert.equal(historical.proposal.editableDocumentVersion,undefined);
    const document=await f.call(scribe,'GET',f.base+'/documents/'+documentId);
    assert.equal(document.document.publishedVersion,null);
    assert.equal(document.versions.length,2);
    const after=await f.call(scribe,'GET',path);
    assert.equal(after.proposal.meetingConsentPending,true);
    assert.equal(after.proposal.consentMeetingId,undefined);
    assert.equal((await f.raw(scribe,'POST',path+'/actions/meeting-consent',{...consent,revision:2},after.proposal.version)).json().error.code,'INTEGRATIVE_PROCESS_REQUIRED');
    assert.equal((await f.call(scribe,'GET',path+'/origin')).origin.id,agenda.id);
  } finally { await app.close(); }
});
test("meeting outcomes save Work links and reject inaccessible assignments atomically", async () => {
  const app = await buildApp([createOrgMapIntegration()], { migrationScope: "all" });
  try {
    const f = await seedO2Panel(app, origin);
    const { scribe, facilitator } = f;
    const initial = await f.call(scribe, "GET", f.url);
    const agenda = initial.agenda.find((item: any) => item.title === "Prioridades da semana");
    assert.ok(agenda?.sourceId);
    const { bindings } = await f.call(f.owner, "GET", f.base + "/governance-model");
    const roleId = bindings.find((binding: any) => binding.functionCode === "FACILITATOR").roleId;
    const memberLink = { kind: "MEMBER", targetId: facilitator.memberId };
    const roleLink = { kind: "ROLE", targetId: roleId };
    const endpoint = f.url + "/outcomes";
    const work = f.base + "/work";
    const version = async () => (await f.call(scribe, "GET", f.url)).meeting.version;
    const create = async (body: Record<string, unknown>) =>
      (await f.call(scribe, "POST", endpoint, { agendaId: agenda.id, ...(body.kind==='PROJECT'?{leadMemberId:scribe.memberId}:{}), ...body }, await version())).target.id;

    const privateProject = await create({ kind: "PROJECT", title: "Projeto com participante", workLink: memberLink });
    assert.deepEqual((await f.call(scribe, "GET", work + `/projects/${privateProject}/context`)).links, [
      { kind: "PARTICIPANT", targetId: facilitator.memberId },
    ]);
    assert.equal((await f.raw(facilitator, "GET", work + `/projects/${privateProject}`)).statusCode, 404);
    const publicProject = await create({ kind: "PROJECT", title: "Projeto com papel", visibility: "PUBLIC", workLink: roleLink });
    assert.deepEqual((await f.call(scribe, "GET", work + `/projects/${publicProject}/context`)).links, [roleLink]);

    const body = { kind: "TASK", title: "Tarefa com responsável", agendaId: agenda.id, projectId: publicProject, workLink: memberLink };
    const key = randomUUID(), originalVersion = await version();
    const response = await f.raw(scribe, "POST", endpoint, body, originalVersion, key);
    assert.equal(response.statusCode, 200, response.body);
    const direct = response.json().data.target.id;
    const replay = await f.raw(scribe, "POST", endpoint, body, originalVersion, key);
    assert.equal(replay.statusCode, 200, replay.body);
    assert.deepEqual(replay.json().data, response.json().data);
    assert.deepEqual((await f.call(facilitator, "GET", work + `/tasks/${direct}`)).principals, [
      { kind: "MEMBER", memberId: facilitator.memberId },
    ]);

    const roleTask = await create({ kind: "TASK", title: "Tarefa com papel", projectId: publicProject, workLink: roleLink });
    const roleDetail = await f.call(scribe, "GET", work + `/tasks/${roleTask}`);
    assert.deepEqual(roleDetail.principals, [{ kind: "ROLE", roleId }]);
    assert.ok(roleDetail.resolvedAssignees.some((assignee: any) => assignee.memberId === facilitator.memberId));
    const additional = (await f.call(f.owner, "POST", f.base + `/governance-model/roles/${roleId}/occupancies`, {
      memberId: scribe.memberId, startsAt: "2026-01-01T00:00:00Z",
    })).occupancy;
    const rosterPath = endpoint + `/role-occupants?kind=TASK&roleId=${roleId}`;
    const roster = await f.call(scribe, "GET", rosterPath + `&projectId=${publicProject}`);
    const two = [scribe.memberId, facilitator.memberId].sort();
    assert.deepEqual(roster.people.map((person: any) => person.id).sort(), two);
    assert.ok(roster.people.every((person: any) => person.assignable && person.name));
    const personalRoster = await f.call(scribe, "GET", rosterPath);
    assert.deepEqual(personalRoster.people.filter((person: any) => person.assignable).map((person: any) => person.id), [scribe.memberId]);
    assert.ok([403, 404].includes((await f.raw(f.guest, "GET", rosterPath)).statusCode));

    const choose = (people: 'ROLE' | string[]) => ({ ...roleLink, selection:{snapshot:roster.snapshot, people} });
    const publicDetail = await f.call(scribe, 'GET', work + `/projects/${publicProject}`);
    await f.call(scribe, 'PATCH', work + `/projects/${publicProject}`, {assignmentMode:'SINGLE'}, publicDetail.project.version);
    const overLimit = await f.raw(scribe, 'POST', endpoint, {
      kind:'TASK',title:'Recusado ASSIGNMENT_LIMIT',agendaId:agenda.id,projectId:publicProject,workLink:choose(two),
    }, await version());
    assert.equal(overLimit.statusCode, 422, overLimit.body);
    assert.equal(overLimit.json().error.code, 'ASSIGNMENT_LIMIT');
    const teamTask = await create({kind:"TASK",title:"Tarefa com os dois ocupantes",projectId:publicProject,workLink:choose('ROLE')});
    const teamDetail = await f.call(scribe, "GET", work + `/tasks/${teamTask}`);
    assert.deepEqual(teamDetail.principals, [{kind:'ROLE',roleId}]);
    assert.deepEqual(teamDetail.resolvedAssignees.map((person: any) => person.memberId).sort(), two);
    const oneTask = {kind:"TASK",title:"Tarefa com uma ocupante",agendaId:agenda.id,projectId:publicProject,workLink:choose([facilitator.memberId])};
    const oneVersion = await version(), oneKey = randomUUID();
    const one = await f.raw(scribe, "POST", endpoint, oneTask, oneVersion, oneKey);
    assert.equal(one.statusCode, 200, one.body);
    const oneDetail = await f.call(scribe, "GET", work + `/tasks/${one.json().data.target.id}`);
    assert.deepEqual(oneDetail.principals, [{kind:'MEMBER',memberId:facilitator.memberId}]);
    assert.deepEqual(oneDetail.resolvedAssignees.map((person: any) => person.memberId), [facilitator.memberId]);
    const oneProject = await create({kind:"PROJECT",title:"Projeto com papel e uma pessoa",workLink:choose([facilitator.memberId])});
    assert.deepEqual((await f.call(scribe, "GET", work + `/projects/${oneProject}/context`)).links, [
      roleLink, {kind:'PARTICIPANT',targetId:facilitator.memberId},
    ]);
    const bothProject = await create({kind:"PROJECT",title:"Projeto com os dois ocupantes",workLink:choose(two)});
    assert.deepEqual((await f.call(scribe, "GET", work + `/projects/${bothProject}/context`)).links, [
      roleLink, ...two.map(targetId=>({kind:'PARTICIPANT',targetId})),
    ]);
    await f.call(f.owner, "POST", f.base + `/governance-model/occupancies/${additional.source ?? 'OCCUPANCY'}/${additional.id}/end`, {}, additional.version);
    const oneReplay = await f.raw(scribe, "POST", endpoint, oneTask, oneVersion, oneKey);
    assert.equal(oneReplay.statusCode, 200, oneReplay.body);
    assert.deepEqual(oneReplay.json().data, one.json().data);
    const plain = await create({ kind: "TASK", title: "Tarefa sem responsável" });
    assert.deepEqual((await f.call(scribe, "GET", work + `/tasks/${plain}`)).principals, []);

    for (const [collection, targetId] of [['projects', privateProject], ['projects', publicProject], ['tasks', direct], ['tasks', roleTask], ['tasks', plain]]) {
      const { origin } = await f.call(scribe, "GET", work + `/${collection}/${targetId}/origin`);
      assert.equal(origin.id, agenda.id);
      assert.equal(origin.meetingId, f.meeting);
    }

    const before = await f.call(scribe, "GET", f.url);
    const rejected = [
      [{ kind: "TASK", workLink: memberLink }, 422, "PERSONAL_TASK_PRIVATE"],
      [{ kind: "TASK", workLink: memberLink, projectId: privateProject }, 422, "ASSIGNEE_REQUIRES_ACCESS"],
      [{ kind: "PROJECT", leadMemberId:scribe.memberId, workLink: { kind: "ROLE", targetId: randomUUID() } }, 404, "RESOURCE_NOT_FOUND"],
      [{ kind: "POLICY", content: "Conteúdo", workLink: memberLink }, 400, "INVALID_REQUEST"],
      [{ kind: "TASK", projectId: publicProject, workLink: choose('ROLE') }, 409, "ROLE_OCCUPANTS_CHANGED"],
    ] as const;
    for (const [input, status, code] of rejected) {
      const result = await f.raw(scribe, "POST", endpoint, { title: `Recusado ${code}`, agendaId: agenda.id, ...input }, before.meeting.version);
      assert.equal(result.statusCode, status, result.body);
      assert.equal(result.json().error.code, code);
    }
    const after = await f.call(scribe, "GET", f.url);
    assert.equal(after.meeting.version, before.meeting.version);
    assert.deepEqual(after.actions, before.actions);
    assert.equal(after.actions.filter((action: any) => action.targetId === direct).length, 1);
    assert.equal(after.agenda.find((item: any) => item.id === agenda.id).sourceId, agenda.sourceId);
    const { treatments } = await f.call(scribe, "GET", f.url + "/panel");
    assert.equal(treatments.find((item: any) => item.agendaId === agenda.id).mode, "SYNC");
    const { tasks } = await f.call(scribe, "GET", work + "/tasks");
    const { projects } = await f.call(scribe, "GET", work + "/projects");
    assert.ok([...tasks, ...projects].every(item => !item.title.startsWith("Recusado ")));
  } finally {
    await app.close();
  }
});
test("two logins share focus, presence, process; invited member has no governance authority; minutes persist", async () => {
  const app = await buildApp([createOrgMapIntegration()], {
    migrationScope: "all",
  });
  app.addHook("onError", async (_r, _p, error) => {
    if (!(error as any).status) console.error(error);
  });
  try {
    const f = await seedO2Panel(app, origin),
      { scribe: s, facilitator: l, guest: g } = f;
    let d = await f.call(s, "GET", f.url),
      panel = await f.call(l, "GET", f.url + "/panel");
    assert.equal(
      d.participants.filter((p: any) => p.attendance === "PRESENT").length,
      3,
    );
    const granular = await f.call(l, "GET", f.url);
    assert.equal(granular.capabilities.edit, false);
    assert.equal(granular.capabilities.proposeGovernance, true);
    assert.equal(panel.panel.focusId, f.agendaId);
    assert.equal(panel.proposals[0].proposal.id, f.proposalId);
    assert.equal((await f.call(g, "GET", f.url + "/panel")).member, false);
    assert.equal(
      (
        await f.raw(
          g,
          "POST",
          f.url + "/panel/actions/tension",
          { title: "No", mode: "ADAPT" },
          d.meeting.version,
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await f.raw(
          g,
          "POST",
          f.url + "/outcomes",
          { kind: "POLICY", title: "No", content: "No" },
          d.meeting.version,
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await f.raw(
          l,
          "POST",
          f.url + "/actions/participants",
          { participants: [] },
          d.meeting.version,
        )
      ).statusCode,
      403,
    );
    assert.equal((await f.raw(f.outsider, "GET", f.url)).statusCode, 404);
    assert.ok(
      d.agenda.some(
        (a: any) => a.title === "Publicações sem alinhamento" && a.sourceId,
      ),
    );
    d = await f.call(g, "GET", f.url);
    assert.equal(
      (
        await f.raw(
          g,
          "POST",
          f.url + "/panel/actions/process",
          { proposalId: f.proposalId, revision: 1, action: "start" },
          d.meeting.version,
        )
      ).statusCode,
      403,
    );
    await f.panelCommand(l, "presence", { attendance: "ABSENT" });
    d = await f.call(l, "GET", f.url);
    assert.equal(
      (
        await f.raw(
          l,
          "POST",
          f.url + "/outcomes",
          { kind: "POLICY", title: "Ausente", content: "Não autorizado" },
          d.meeting.version,
        )
      ).statusCode,
      403,
    );
    await f.panelCommand(l, "presence", { attendance: "PRESENT" });
    const process = async (actor: any, action: string, extra: any = {}) =>
      f.panelCommand(actor, "process", {
        proposalId: f.proposalId,
        revision: 1,
        action,
        ...extra,
      });
    await process(l, "start");
    await process(s, "advance");
    panel = await f.call(l, "GET", f.url + "/panel");
    assert.equal(panel.processes[0].stage, "REACT");
    d = await f.call(s, "GET", f.url);
    assert.equal(d.meeting.currentStep, "agenda");
    const stale = d.meeting.version;
    await process(l, "advance");
    assert.equal(
      (
        await f.raw(
          s,
          "POST",
          f.url + "/panel/actions/process",
          { proposalId: f.proposalId, revision: 1, action: "advance" },
          stale,
        )
      ).statusCode,
      409,
    );
    await process(s, "advance");
    await process(l, "objection", {
      reason: "Prejuízo ao propósito do círculo",
    });
    assert.equal(
      (
        await f.raw(
          s,
          "POST",
          f.url + "/panel/actions/process",
          {
            proposalId: f.proposalId,
            revision: 1,
            action: "advance",
            confirmed: true,
          },
          (await f.call(s, "GET", f.url)).meeting.version,
        )
      ).statusCode,
      409,
    );
    await process(l, "integrate");
    panel = await f.call(s, "GET", f.url + "/panel");
    await process(s, "resolve", {
      objectionId: panel.processes[0].objections[0].id,
      valid: true,
      reason: "Integrado sem alteração da revisão",
    });
    await process(l, "advance");
    await process(s, "advance", { confirmed: true });
    d = await f.call(s, "GET", f.url);
    let p = (await f.call(s, "GET", f.base + "/proposals/" + f.proposalId))
      .proposal;
    const result = await f.call(
      s,
      "POST",
      f.base + "/proposals/" + p.id + "/actions/meeting-consent",
      {
        meetingVersion: d.meeting.version,
        revision: p.revision,
        confirmed: true,
        reason: "Nenhuma objeção válida pendente",
      },
      p.version,
    );
    assert.equal(result.proposal.applyState, "APPLIED");

    // Draft preparation and attachment preserve authorship and do not start facilitation.
    const prepared = await f.call(l, "POST", f.base + "/proposals", {
      title: "Rascunho anterior ao encontro",
      circleId: f.rootId,
      kind: "GOVERNANCE",
      payload: {
        changes: [
          {
            kind: "CREATE",
            entityId: randomUUID(),
            entityKind: "ROLE",
            parentCircleId: f.rootId,
            name: "Papel preparado",
            purpose: "Preparação assíncrona",
          },
          {kind:'CREATE',entityId:randomUUID(),entityKind:'CIRCLE',parentCircleId:f.rootId,name:'Círculo preparado',purpose:'Estrutura preparada antes do encontro'},
        ],
      },
    });
    d = await f.call(l, "GET", f.url);
    const nextMeeting = (
      await f.call(l, "POST", f.base + "/meeting-series", {
        title: "Próximo encontro",
        circleId: f.rootId,
        localStart: "2026-11-02T18:00",
        timeZone: "America/Sao_Paulo",
        durationMinutes: 60,
        recurrence: { frequency: "ONCE" },
        sections: d.meeting.sections,
        participants: [],
        notesProtocol: "orgmap-richtext-yjs-v1",
        policy: { notesOnlyNoter: true, windowDays: 7 },
      })
    ).occurrenceIds[0];
    const nextUrl = f.base + "/meetings/" + nextMeeting;
    const preparedTension = await f.call(l, "POST", f.base + "/tensions", {
      title: "Tensão preparada",
      circleId: f.rootId,
    });
    const dispatched = await f.call(
      l,
      "POST",
      f.base + "/tensions/" + preparedTension.id + "/actions/process",
      { targetKind: "AGENDA", meetingId: nextMeeting, meetingVersion: 1 },
      preparedTension.version,
    );
    const nextDetail = await f.call(l, "GET", nextUrl);
    await f.call(
      l,
      "POST",
      nextUrl + "/panel/actions/attach",
      { proposalId: prepared.id, agendaId: dispatched.targetId },
      nextDetail.meeting.version,
    );
    const attached = await f.call(
      l,
      "GET",
      f.base + "/proposals/" + prepared.id,
    );
    assert.equal(attached.proposal.authorId, l.memberId);
    assert.equal(attached.proposal.state, "DRAFT");
    assert.equal(attached.proposal.revision, 1);
    assert.equal((await f.call(l, "GET", nextUrl)).meeting.state, "SCHEDULED");
    assert.equal(
      (await f.call(l, "GET", nextUrl + "/panel")).processes.length,
      0,
    );
    // The prepared draft also completes its real meeting path, applying role and circle.
    let next=await f.call(l,'GET',nextUrl);
    await f.call(l,'POST',nextUrl+'/actions/start',{},next.meeting.version);
    const nextCommand=async(action:string,body:any)=>{const current=await f.call(l,'GET',nextUrl);return f.call(l,'POST',nextUrl+'/panel/actions/'+action,body,current.meeting.version);};
    await nextCommand('presence',{attendance:'PRESENT'});
    await nextCommand('step',{sectionId:'agenda'});
    await nextCommand('focus',{agendaId:dispatched.targetId});
    for(const action of ['start','advance','advance','advance','advance'])await nextCommand('process',{proposalId:prepared.id,revision:1,action,confirmed:true});
    next=await f.call(l,'GET',nextUrl);
    const preparedCurrent=(await f.call(l,'GET',f.base+'/proposals/'+prepared.id)).proposal;
    const preparedApplied=await f.call(l,'POST',f.base+'/proposals/'+prepared.id+'/actions/meeting-consent',{meetingVersion:next.meeting.version,revision:1,confirmed:true,reason:'Preparação apresentada, sem objeções válidas pendentes'},preparedCurrent.version);
    assert.equal(preparedApplied.proposal.applyState,'APPLIED');
    const actual=(await f.call(l,'GET',f.base+'/structure')).nodes;
    assert.ok(actual.some((n:any)=>n.name==='Papel preparado'&&n.kind==='ROLE'));
    assert.ok(actual.some((n:any)=>n.name==='Círculo preparado'&&n.kind==='CIRCLE'));
    await nextCommand('complete',{agendaId:dispatched.targetId});
    next=await f.call(l,'GET',nextUrl);await f.call(l,'POST',nextUrl+'/actions/close',{},next.meeting.version);
    const preparedMinutes=(await f.call(l,'GET',nextUrl+'/report/versions')).items[0].snapshot;
    assert.equal(preparedMinutes.o2.decisions[0].changes.length,2);
    assert.equal(preparedMinutes.agenda.find((a:any)=>a.id===dispatched.targetId).status,'COMPLETED');
    // Voluntary substitution stays local and does not inherit permanent template authority.
    await f.panelCommand(l, "assume", { role: "SCRIBE", confirmed: true });
    d = await f.call(l, "GET", f.url);
    assert.equal(
      (
        await f.raw(
          l,
          "POST",
          f.url + "/panel/actions/template",
          { sections: d.meeting.sections },
          d.meeting.version,
        )
      ).statusCode,
      403,
    );
    await f.panelCommand(s, "assume", { role: "SCRIBE", confirmed: true });
    await f.panelCommand(s, "template", { sections: d.meeting.sections });
    // A present circle member without general editing creates a governance proposal.
    await f.panelCommand(l, "tension", {
      title: "Mudança concorrente",
      mode: "ADAPT",
    });
    d = await f.call(l, "GET", f.url);
    const conflictAgenda = d.agenda.find(
      (a: any) => a.title === "Mudança concorrente",
    );
    const role = (
      await f.call(f.owner, "POST", f.base + "/roles", {
        mode: "DIRECT",
        circleId: f.rootId,
        name: "Referência para conflito",
        purpose: "Testar aplicação",
      })
    ).role;
    const created = await f.call(
      l,
      "POST",
      f.url + "/outcomes",
      {
        kind: "PROPOSAL",
        agendaId: conflictAgenda.id,
        title: "Alterar referência",
        proposalKind: "GOVERNANCE",
        payload: {
          changes: [
            {
              kind: "UPDATE",
              entityId: role.id,
              baseVersion: role.version,
              name: "Novo nome",
            },
          ],
        },
      },
      d.meeting.version,
    );
    await f.panelCommand(l, "focus", { agendaId: conflictAgenda.id });
    for (const action of ["start", "advance", "advance", "advance", "advance"])
      await f.panelCommand(l, "process", {
        proposalId: created.target.id,
        revision: 1,
        action,
        confirmed: true,
      });
    await f.call(
      f.owner,
      "PATCH",
      f.base + "/roles/" + role.id,
      { mode: "DIRECT", name: "Nome concorrente" },
      role.version,
    );
    d = await f.call(s, "GET", f.url);
    p = (await f.call(l, "GET", f.base + "/proposals/" + created.target.id))
      .proposal;
    const conflict = await f.raw(
      s,
      "POST",
      f.base + "/proposals/" + p.id + "/actions/meeting-consent",
      {
        meetingVersion: d.meeting.version,
        revision: 1,
        confirmed: true,
        reason: "Sem objeções",
      },
      p.version,
    );
    assert.equal(conflict.statusCode, 409, conflict.body);
    p = (await f.call(l, "GET", f.base + "/proposals/" + p.id)).proposal;
    assert.equal(p.verdict, "ADOPT");
    assert.equal(p.applyState, "APPLY_CONFLICT");
    d = await f.call(s, "GET", f.url);
    assert.equal(
      (
        await f.raw(
          s,
          "POST",
          f.url + "/agenda/" + conflictAgenda.id + "/actions/complete",
          {},
          conflictAgenda.version,
        )
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await f.raw(
          s,
          "POST",
          f.url + "/panel/actions/complete",
          { agendaId: conflictAgenda.id },
          d.meeting.version,
        )
      ).statusCode,
      409,
    );
    const tension = (
      await f.call(l, "GET", f.base + "/tensions?limit=100")
    ).items.find((t: any) => t.id === conflictAgenda.sourceId);
    const blocked = await f.raw(
      l,
      "POST",
      f.base + "/tensions/" + conflictAgenda.sourceId + "/actions/close",
      {},
      tension.version,
    );
    assert.equal(blocked.statusCode, 409, blocked.body);
    assert.equal(blocked.json().error.code, "GOVERNANCE_APPLICATION_PENDING");
    // Reviewing reuses circle metrics, role checklists and existing projects; selections
    // become defaults only through the permanent scribe's own-circle configuration.
    const metric = await f.call(
      f.owner,
      "POST",
      f.base + "/structure-advanced/indicators",
      {
        entityId: f.rootId,
        name: "Métrica do círculo",
        kind: "METRIC",
        valueType: "NUMBER",
        unit: "itens",
        requiredUnits: [],
      },
    );
    const checklist = await f.call(
      f.owner,
      "POST",
      f.base + "/structure-advanced/indicators",
      {
        entityId: role.id,
        name: "Checklist do papel",
        kind: "CHECKLIST",
        valueType: "BOOLEAN",
        unit: "",
        requiredUnits: [],
      },
    );
    const project = (
      await f.call(f.owner, "POST", f.base + "/work/projects", {
        title: "Projeto do círculo",
        circleId: f.rootId,
        visibility: "PUBLIC",
      })
    ).project;
    const resources = [
      { id: metric.id, kind: "INDICATOR" },
      { id: checklist.id, kind: "INDICATOR" },
      { id: project.id, kind: "PROJECT" },
    ];
    panel = await f.call(s, "GET", f.url + "/panel");
    assert.ok(
      resources.every((r) =>
        panel.reviewCandidates.some((candidate: any) => candidate.id === r.id),
      ),
    );
    await f.panelCommand(s, "review", { items: resources });
    d = await f.call(s, "GET", f.url);
    await f.panelCommand(s, "template", { sections: d.meeting.sections });
    const templated = (
      await f.call(s, "POST", f.base + "/meeting-series", {
        title: "Encontro com referências predefinidas",
        circleId: f.rootId,
        localStart: "2026-11-03T18:00",
        timeZone: "America/Sao_Paulo",
        durationMinutes: 60,
        recurrence: { frequency: "ONCE" },
        sections: d.meeting.sections,
        participants: [],
        notesProtocol: "orgmap-richtext-yjs-v1",
        policy: { notesOnlyNoter: true, windowDays: 7 },
      })
    ).occurrenceIds[0];
    const predefined = await f.call(
      s,
      "GET",
      f.base + "/meetings/" + templated + "/panel",
    );
    assert.equal(predefined.review.length, 3);
    assert.ok(
      resources.every((r) =>
        predefined.review.some((selected: any) => selected.id === r.id),
      ),
    );
    await f.panelCommand(s, "notes", {
      notes: "Notas preservadas do encontro.",
    });
    d = await f.call(s, "GET", f.url);
    await f.call(s, "POST", f.url + "/actions/close", {}, d.meeting.version);
    const versions = await f.call(s, "GET", f.url + "/report/versions");
    const decisions = versions.items[0].snapshot.o2.decisions;
    assert.equal(
      decisions.find((decision: any) => decision.id === f.proposalId)
        .applyState,
      "APPLIED",
    );
    assert.ok(
      decisions
        .find((decision: any) => decision.id === f.proposalId)
        .restriction.content.includes("Comunicação"),
    );
    assert.equal(
      decisions.find((decision: any) => decision.id === created.target.id)
        .applyState,
      "APPLY_CONFLICT",
    );
    assert.equal(
      decisions.find((decision: any) => decision.id === created.target.id)
        .changes,
      undefined,
    );
    assert.equal(
      versions.items[0].snapshot.o2.panels[0].notes,
      "Notas preservadas do encontro.",
    );
    assert.equal(
      versions.items[0].snapshot.participants.filter(
        (p: any) => p.attendance === "PRESENT",
      ).length,
      3,
    );
  } finally {
    await app.close();
  }
});
