import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../server/src/app.js';
import { pool, transaction } from '../../server/src/db.js';
import { createIntegratedDispatcher, createOrgMapIntegration, createPlatformWorker } from '../../server/integration/index.js';
import { defaultPolicy } from '../../server/modules/governance/domain.js';
import { snapshotO2 } from '../../server/modules/meetings/o2-panel.js';

const app = await buildApp([createOrgMapIntegration()], { migrationMaxPrefix: 999 });
after(async () => { await app.close(); await pool.end(); });
type Actor = { id: string; cookie: string; csrf: string };
async function call(method: string, path: string, payload?: any, user?: Actor, version?: number, key = randomUUID()) {
  return app.inject({ method: method as any, url: '/api/v1' + path, payload, headers: {
    origin: 'http://localhost:5173', 'idempotency-key': key,
    ...(user ? { cookie: user.cookie, 'x-csrf-token': user.csrf } : {}),
    ...(version === undefined ? {} : { 'if-match': `"${version}"` }),
  } });
}
function data(r: any) { assert.ok([200, 201].includes(r.statusCode), r.body); return r.json().data; }
async function user(): Promise<Actor> {
  const r = await call('POST', '/auth/register', { email: randomUUID() + '@fixture.invalid', password: 'Synthetic-password-1234', displayName: 'Fixture' });
  const d = data(r);
  return { id: d.account.id, cookie: `orgmap_session=${r.cookies.find((c: any) => c.name === 'orgmap_session')!.value}`, csrf: d.csrfToken };
}

test('a present participant can assume the absent secretary role only in an active Holacracy meeting', async () => {
  const owner = await user(), participant = await user(), reader = await user();
  const org = data(await call('POST', '/organizations', { name: 'Secretary fixture' }, owner));
  const base = '/organizations/' + org.organization.id;
  const member = data(await call('POST', base + '/members', { accountId: participant.id }, owner)).membership;
  const readonly = data(await call('POST', base + '/members', { accountId: reader.id }, owner)).membership;
  const series = data(await call('POST', base + '/meeting-series', {
    title: 'Governance', circleId: org.rootCircle.id, method: 'HOLACRACY', localStart: '2030-03-01T12:00', timeZone: 'UTC', durationMinutes: 60,
    recurrence: { frequency: 'ONCE' }, sections: [{ id: 'agenda', title: 'Agenda', kind: 'AGENDA' }],
    participants: [{ memberId: member.id, access: 'EDIT' }, { memberId: readonly.id, access: 'READ' }], policy: { notesOnlyNoter: true },
  }, owner));
  const ep = base + '/meetings/' + series.occurrenceIds[0];
  let meeting = data(await call('POST', ep + '/actions/start', {}, owner, 1));
  assert.equal((await call('POST',ep+'/actions/step',{sectionId:'agenda'},participant,meeting.meeting.version)).statusCode,403);
  meeting = data(await call('POST',ep+'/actions/facilitator',{memberId:member.id},owner,meeting.meeting.version));
  const facilitated = data(await call('GET',ep,undefined,participant));
  assert.equal(facilitated.capabilities.facilitatorOperation,true);
  assert.equal(facilitated.capabilities.manage,false);
  meeting = data(await call('POST',ep+'/actions/step',{sectionId:'agenda'},participant,meeting.meeting.version));
  assert.equal((await call('POST', ep + '/actions/claim-secretary', { confirmed: false }, reader, meeting.meeting.version)).statusCode, 400);
  meeting = data(await call('POST', ep + '/actions/attendance', { memberId: member.id, attendance: 'PRESENT' }, participant, meeting.meeting.version));
  assert.equal((await call('POST', ep + '/actions/claim-secretary', { confirmed: false }, participant, meeting.meeting.version)).statusCode, 400);
  meeting = data(await call('POST', ep + '/actions/attendance', { memberId: org.membership.id, attendance: 'PRESENT' }, owner, meeting.meeting.version));
  assert.equal((await call('POST', ep + '/actions/claim-secretary', { confirmed: true }, participant, meeting.meeting.version)).json().error.code, 'SECRETARY_PRESENT');
  assert.equal((await call('POST', ep + '/actions/claim-secretary', { confirmed: true }, reader, meeting.meeting.version)).json().error.code, 'SECRETARY_PRESENT');
  meeting = data(await call('POST', ep + '/actions/attendance', { memberId: org.membership.id, attendance: 'ABSENT' }, owner, meeting.meeting.version));
  const key = randomUUID(), oldVersion = meeting.meeting.version;
  meeting = data(await call('POST', ep + '/actions/claim-secretary', { confirmed: true }, reader, oldVersion, key));
  assert.equal(meeting.meeting.notetakerId, readonly.id);
  assert.equal(meeting.capabilities.edit, false);
  assert.equal(meeting.capabilities.notes, true);
  assert.equal(data(await call('POST', ep + '/actions/claim-secretary', { confirmed: true }, reader, oldVersion, key)).meeting.notetakerId, readonly.id);
  assert.equal((await call('POST', ep + '/actions/claim-secretary', { confirmed: true }, reader, oldVersion)).statusCode, 409);

  const circle = org.rootCircle.id, newCircle = randomUUID(), role = randomUUID();
  let output = data(await call('POST', ep + '/outcomes', { kind:'PROPOSAL', title:'Create circle and role', proposalKind:'GOVERNANCE', payload:{changes:[{kind:'CREATE',entityId:newCircle,entityKind:'CIRCLE',parentCircleId:circle,name:'New circle',purpose:'Circle purpose'},{kind:'CREATE',entityId:role,entityKind:'ROLE',parentCircleId:newCircle,name:'Secretary test role',purpose:'Purpose'}]} }, owner, meeting.meeting.version));
  const proposal = base + '/proposals/' + output.target.id;
  assert.ok([403,404].includes((await call('POST', proposal + '/actions/meeting-consent', {meetingVersion:meeting.meeting.version+1,revision:1,confirmed:true,reason:'No objections'}, reader, 1)).statusCode));
  data(await call('POST', base + '/governance/policies', {circleId:circle,configuration:{...defaultPolicy,decisionProcess:'HOLACRACY_O2'}}, owner));
  assert.equal((await call('POST',proposal+'/actions/submit',{},owner,1)).json().error.code,'MEETING_CONSENT_REQUIRED');
  meeting = data(await call('GET', ep, undefined, reader));
  let detail = data(await call('GET', proposal, undefined, reader));
  assert.equal(detail.proposal.consentMeetingId, meeting.meeting.id);
  const consent = {meetingVersion:meeting.meeting.version, revision:1, confirmed:true, reason:'Rodada sem objeções'}, consentKey = randomUUID();
  assert.equal((await call('POST', proposal + '/actions/meeting-consent', {...consent,revision:2}, reader, 1)).statusCode, 409);
  assert.ok([403,404].includes((await call('POST', proposal + '/actions/meeting-consent', consent, participant, 1)).statusCode));
  const accepted = data(await call('POST', proposal + '/actions/meeting-consent', consent, reader, 1, consentKey));
  assert.equal(accepted.applyState, 'APPLIED');
  assert.equal(accepted.proposal.verdict, 'ADOPT');
  assert.equal(data(await call('POST', proposal + '/actions/meeting-consent', consent, reader, 1, consentKey)).commitId, accepted.commitId);
  assert.ok(data(await call('GET', base + '/structure', undefined, owner)).nodes.some((node:any) => node.entityId === role));
  assert.ok(data(await call('GET', base + '/structure', undefined, owner)).nodes.some((node:any) => node.entityId === newCircle));
  assert.equal(data(await call('GET',base+'/governance/policies/'+newCircle+'/effective',undefined,owner)).configuration.decisionProcess,'HOLACRACY_O2');
  detail = data(await call('GET', proposal, undefined, reader));
  assert.equal(detail.commits.length, 1);
  assert.equal(detail.history.filter((h:any) => h.action === 'ProposalDecided').length, 1);

  meeting = data(await call('GET', ep, undefined, owner));
  output = data(await call('POST', ep + '/outcomes', {kind:'POLICY',title:'Approved policy',content:'Policy body'}, owner, meeting.meeting.version));
  const policyProposal = base + '/proposals/' + output.target.id;
  meeting = data(await call('GET', ep, undefined, reader));
  const policyDetail = data(await call('GET', policyProposal, undefined, reader));
  assert.equal(policyDetail.meetingDocument.content,'Policy body');
  const applied = data(await call('POST', policyProposal + '/actions/meeting-consent', {meetingVersion:meeting.meeting.version,revision:1,confirmed:true,reason:'Consentimento da reunião'}, reader, 1));
  assert.equal(applied.applyState,'APPLIED');
  const docId = policyDetail.revisions[0].payload.documents[0].documentId;
  const agreementDoc = data(await call('GET', base + '/documents/' + docId, undefined, owner));
  assert.equal(agreementDoc.document.publishedVersion, 1);
  assert.equal(agreementDoc.versions[0].origin.proposal.id, output.target.id);
  assert.equal(agreementDoc.versions[0].origin.proposalRevision, 1);
  assert.equal(agreementDoc.versions[0].origin.meeting.id, meeting.meeting.id);
  const uninvited = await user();
  data(await call('POST', base + '/members', {accountId:uninvited.id}, owner));
  const limited = data(await call('GET', base + '/documents/' + docId, undefined, uninvited));
  assert.equal(limited.versions[0].origin.proposal.id, output.target.id);
  assert.equal(limited.versions[0].origin.meeting, undefined);
  assert.doesNotMatch(JSON.stringify(limited), new RegExp(meeting.meeting.id));

  const nodes = data(await call('GET', base + '/structure', undefined, owner)).nodes;
  const roleNode = nodes.find((node:any) => node.entityId === role);
  meeting = data(await call('GET', ep, undefined, owner));
  output = data(await call('POST', ep + '/outcomes', {kind:'PROPOSAL',title:'Stale change',proposalKind:'GOVERNANCE',payload:{changes:[{kind:'UPDATE',entityId:role,baseVersion:roleNode.version,name:'Conflicting'}]}}, owner, meeting.meeting.version));
  const stale = base + '/proposals/' + output.target.id;
  // The structure changes after the version was captured in the proposal.
  data(await call('PATCH', base + '/roles/' + role, {mode:'DIRECT',name:'Concurrent edit'}, owner, roleNode.version));
  meeting = data(await call('GET', ep, undefined, reader));
  const conflict = await call('POST', stale + '/actions/meeting-consent', {meetingVersion:meeting.meeting.version,revision:1,confirmed:true,reason:'Consentimento da reunião'}, reader, 1);
  assert.equal(conflict.statusCode,409,conflict.body);
  assert.equal(conflict.json().error.conflictDetails.conflictCode,'VERSION_CONFLICT');
  const staleDetail = data(await call('GET', stale, undefined, reader));
  assert.equal(staleDetail.proposal.verdict,'ADOPT');
  assert.equal(staleDetail.proposal.applyState,'APPLY_CONFLICT');
  assert.equal(data(await call('GET', base + '/structure', undefined, owner)).nodes.find((node:any)=>node.entityId===role).name,'Concurrent edit');
  const freshNodes = data(await call('GET',base+'/structure',undefined,owner)).nodes;
  const freshRole = freshNodes.find((node:any)=>node.entityId===role), freshCircle = freshNodes.find((node:any)=>node.entityId===newCircle);
  meeting = data(await call('GET',ep,undefined,owner));
  output = data(await call('POST',ep+'/outcomes',{kind:'PROPOSAL',title:'Invalid cycle',proposalKind:'GOVERNANCE',payload:{changes:[
    {kind:'UPDATE',entityId:role,baseVersion:freshRole.version,name:'Must not apply'},
    {kind:'MOVE',entityId:newCircle,baseVersion:freshCircle.version,parentCircleId:newCircle},
  ]}},owner,meeting.meeting.version));
  meeting = data(await call('GET',ep,undefined,reader));
  const cyclic = await call('POST',base+'/proposals/'+output.target.id+'/actions/meeting-consent',{meetingVersion:meeting.meeting.version,revision:1,confirmed:true,reason:'Consentimento registrado'},reader,1);
  assert.equal(cyclic.statusCode,409,cyclic.body);
  assert.equal(cyclic.json().error.conflictDetails.conflictCode,'STRUCTURE_CYCLE');
  assert.equal(data(await call('GET',base+'/structure',undefined,owner)).nodes.find((node:any)=>node.entityId===role).name,'Concurrent edit');
});

test('a substitute secretary may reschedule and open the assigned meeting without managing the series', async () => {
  const owner = await user(), substitute = await user(), other = await user();
  const org = data(await call('POST','/organizations',{name:'Scheduled secretary fixture'},owner));
  const base = '/organizations/' + org.organization.id;
  const sub = data(await call('POST',base+'/members',{accountId:substitute.id},owner)).membership;
  const third = data(await call('POST',base+'/members',{accountId:other.id},owner)).membership;
  const series = data(await call('POST',base+'/meeting-series',{
    title:'Future governance',circleId:org.rootCircle.id,method:'HOLACRACY',localStart:'2030-04-01T12:00',timeZone:'UTC',durationMinutes:60,
    recurrence:{frequency:'ONCE'},sections:[{id:'agenda',title:'Agenda',kind:'AGENDA'}],
    participants:[{memberId:sub.id,access:'READ'},{memberId:third.id,access:'READ'}],policy:{},
  },owner));
  const ep = base+'/meetings/'+series.occurrenceIds[0];
  assert.equal((await call('POST',ep+'/actions/start',{},other,1)).statusCode,403);
  let detail = data(await call('POST',ep+'/actions/claim-secretary',{confirmed:true},substitute,1));
  assert.equal(detail.capabilities.secretaryOperation,true);
  assert.equal(detail.capabilities.manage,false);
  const reschedule = {scope:'THIS',localStart:'2030-04-02T12:00',timeZone:'UTC',title:'Future governance',durationMinutes:60};
  assert.equal((await call('POST',ep+'/actions/reschedule',{...reschedule,scope:'ALL'},substitute,detail.meeting.version)).statusCode,403);
  data(await call('POST',ep+'/actions/reschedule',reschedule,substitute,detail.meeting.version));
  detail = data(await call('GET',ep,undefined,substitute));
  detail = data(await call('POST',ep+'/actions/start',{},substitute,detail.meeting.version));
  assert.equal(detail.meeting.state,'RUNNING');
  assert.equal(detail.capabilities.notes,true);
});

test('consent cannot apply changes in an unrelated circle',async()=>{
  const owner=await user(),secretary=await user();
  const org=data(await call('POST','/organizations',{name:'Circle scope fixture'},owner)),base='/organizations/'+org.organization.id,root=org.rootCircle.id;
  const person=data(await call('POST',base+'/members',{accountId:secretary.id},owner)).membership;
  const a=data(await call('POST',base+'/circles',{mode:'DIRECT',parentCircleId:root,name:'Circle A'},owner)).circle;
  const b=data(await call('POST',base+'/circles',{mode:'DIRECT',parentCircleId:root,name:'Circle B'},owner)).circle;
  data(await call('POST',base+'/governance/policies',{circleId:root,configuration:{...defaultPolicy,decisionProcess:'HOLACRACY_O2'}},owner));
  const series=data(await call('POST',base+'/meeting-series',{title:'Circle A governance',circleId:a.id,method:'HOLACRACY',localStart:'2030-03-01T12:00',timeZone:'UTC',durationMinutes:60,recurrence:{frequency:'ONCE'},sections:[{id:'agenda',title:'Agenda',kind:'AGENDA'}],participants:[{memberId:person.id,access:'READ'}],policy:{}},owner));
  const meetingPath=base+'/meetings/'+series.occurrenceIds[0];
  let meeting=data(await call('POST',meetingPath+'/actions/start',{},owner,1));
  meeting=data(await call('POST',meetingPath+'/actions/claim-secretary',{confirmed:true},secretary,meeting.meeting.version));
  const target=data(await call('POST',meetingPath+'/outcomes',{kind:'PROPOSAL',title:'Wrong circle',proposalKind:'GOVERNANCE',payload:{changes:[{kind:'UPDATE',entityId:b.id,baseVersion:b.version,name:'Must not change'}]}},owner,meeting.meeting.version)).target;
  meeting=data(await call('GET',meetingPath,undefined,secretary));
  const result=await call('POST',base+'/proposals/'+target.id+'/actions/meeting-consent',{meetingVersion:meeting.meeting.version,revision:1,confirmed:true,reason:'Consentimento registrado'},secretary,1);
  assert.equal(result.statusCode,409,result.body);
  assert.equal(result.json().error.conflictDetails.conflictCode,'CONSENT_SCOPE_CONFLICT');
  const conflictDetail=data(await call('GET',base+'/proposals/'+target.id,undefined,owner));
  const bypass=await call('POST',base+'/proposals/'+target.id+'/actions/apply',{},owner,conflictDetail.proposal.version);
  assert.equal(bypass.statusCode,409,bypass.body);
  assert.equal(bypass.json().error.conflictDetails.conflictCode,'CONSENT_SCOPE_CONFLICT');
  const structure=data(await call('GET',base+'/structure',undefined,owner));
  assert.equal(structure.nodes.find((node:any)=>node.entityId===b.id).name,'Circle B');
});

test('asynchronous consent starts after distribution, applies silence and blocks on objections', async () => {
  const owner = await user(), memberUser = await user();
  const org = data(await call('POST','/organizations',{name:'Async consent fixture'},owner));
  const base = '/organizations/'+org.organization.id, circle = org.rootCircle.id;
  const member = data(await call('POST',base+'/members',{accountId:memberUser.id},owner)).membership;
  data(await call('POST',base+'/circles/'+circle+'/memberships',{memberId:member.id},owner));
  const preferences = data(await call('GET',base+'/platform/preferences',undefined,memberUser));
  data(await call('POST',base+'/platform/preferences',{event:'structure.Master',channel:'EMAIL',enabled:false},memberUser,preferences.version));
  const policy = {...defaultPolicy,decisionProcess:'HOLACRACY_O2',method:'CONSENT_WINDOW',reviewDurationHours:5/3600,workflowSteps:['DECIDE']};
  data(await call('POST',base+'/governance/policies',{circleId:circle,configuration:policy},owner));
  const worker = await createPlatformWorker();
  async function round(title:string) {
    const doc = data(await call('POST',base+'/documents',{title,ownerId:circle,workflow:'GOVERNANCE',visibility:'ORGANIZATION',content:title+' body'},owner));
    const proposal = data(await call('POST',base+'/proposals',{title,circleId:circle,kind:'DOCUMENT',payload:{documentId:doc.id,documentVersion:1}},owner));
    const ep = base+'/proposals/'+proposal.id;
    const submitted = data(await call('POST',ep+'/actions/submit',{},owner,1));
    assert.equal(submitted.round.deadline,null);
    assert.equal((await call('POST',ep+'/votes',{choice:'CONSENT'},memberUser,2)).json().error.code,'CONSENT_DISTRIBUTION_PENDING');
    await worker.runGovernanceConsent(org.organization.id,org.membership.id);
    assert.equal(data(await call('GET',ep,undefined,owner)).rounds[0].deadline,null);
    for(let i=0;i<5;i++) await worker.runDelivery(org.organization.id,member.id);
    await worker.runGovernanceConsent(org.organization.id,org.membership.id);
    const opened = data(await call('GET',ep,undefined,owner));
    assert.ok(opened.rounds[0].deadline);
    assert.equal((await call('POST',ep+'/actions/decide',{reason:'Manual attempt'},owner,2)).json().error.code,'AUTOMATIC_CONSENT_REQUIRED');
    return {doc,ep,deadline:opened.rounds[0].deadline};
  }
  async function afterDeadline(deadline:string) {
    while (Date.now() < Date.parse(deadline)+100) await new Promise(resolve=>setTimeout(resolve,100));
  }
  const quiet = await round('Silence');
  await afterDeadline(quiet.deadline);
  let failed: boolean|undefined;
  const dispatcher = createIntegratedDispatcher({
    claim:async participants=>{assert.ok(participants?.includes('governance-consent'));return {organizationId:org.organization.id,memberId:org.membership.id,token:randomUUID(),participants:['governance-consent']};},
    release:async(_scope,didFail)=>{failed=didFail;return true;},
    heartbeat:async()=>true,
  });
  assert.equal(await dispatcher.runOnce(),true);
  assert.equal(failed,false);
  const adopted = data(await call('GET',quiet.ep,undefined,owner));
  assert.equal(adopted.proposal.verdict,'ADOPT');
  assert.equal(adopted.proposal.applyState,'APPLIED');
  assert.equal(data(await call('GET',base+'/documents/'+quiet.doc.id,undefined,owner)).document.publishedVersion,1);
  await worker.runGovernanceConsent(org.organization.id,org.membership.id);
  assert.equal(data(await call('GET',quiet.ep,undefined,owner)).commits.length,1);
  const opposed = await round('Objection');
  data(await call('POST',opposed.ep+'/votes',{choice:'OBJECT',rationale:'A concrete objection'},memberUser,2));
  await afterDeadline(opposed.deadline);
  await worker.runGovernanceConsent(org.organization.id,org.membership.id);
  const blocked = data(await call('GET',opposed.ep,undefined,owner));
  assert.equal(blocked.proposal.verdict,'REVIEW_REQUIRED');
  assert.notEqual(blocked.proposal.applyState,'APPLIED');
  assert.equal(data(await call('GET',base+'/documents/'+opposed.doc.id,undefined,owner)).document.publishedVersion,null);
});

test('multi-document publication pins every revision and authorizes publication origins independently', async () => {
  const owner=await user(), member=await user(), guest=await user(), outsider=await user();
  const org=data(await call('POST','/organizations',{name:'Multi-document origins'},owner));
  const base='/organizations/'+org.organization.id, circleId=org.rootCircle.id;
  data(await call('POST',base+'/members',{accountId:member.id},owner));
  data(await call('POST','/organizations',{name:'Other tenant'},outsider));
  data(await call('POST',base+'/governance/policies',{circleId,configuration:{...defaultPolicy,decisionProcess:'HOLACRACY_O2'}},owner));
  const series=data(await call('POST',base+'/meeting-series',{
    title:'Multi-document consent',circleId,method:'HOLACRACY',localStart:'2030-06-01T12:00',timeZone:'UTC',durationMinutes:60,
    recurrence:{frequency:'ONCE'},sections:[{id:'agenda',title:'Agenda',kind:'AGENDA'}],participants:[],policy:{},
  },owner));
  const ep=base+'/meetings/'+series.occurrenceIds[0];
  let meeting=data(await call('POST',ep+'/actions/start',{},owner,1));
  meeting=data(await call('POST',ep+'/actions/attendance',{memberId:org.membership.id,attendance:'PRESENT'},owner,meeting.meeting.version));
  const a=data(await call('POST',base+'/documents',{title:'First restriction',ownerId:circleId,workflow:'GOVERNANCE',visibility:'ORGANIZATION',content:'First v1'},owner));
  const b=data(await call('POST',base+'/documents',{title:'Second restriction',ownerId:circleId,workflow:'GOVERNANCE',visibility:'ORGANIZATION',content:'Second v1'},owner));
  data(await call('POST',base+'/documents/'+b.id+'/actions/draft',{content:'Second v2'},owner,b.version));
  const payload={documents:[{documentId:a.id,documentVersion:1},{documentId:b.id,documentVersion:2}]};
  const output=data(await call('POST',ep+'/outcomes',{kind:'PROPOSAL',title:'Publish both',proposalKind:'GOVERNANCE',payload},owner,meeting.meeting.version));
  const pp=base+'/proposals/'+output.target.id;
  let detail=data(await call('GET',pp,undefined,owner));
  assert.deepEqual(detail.meetingDocuments.map((d:any)=>[d.documentId,d.number,d.content]),[[a.id,1,'First v1'],[b.id,2,'Second v2']]);
  assert.deepEqual(detail.meetingDocument,detail.meetingDocuments[0]);
  assert.ok(detail.meetingDocuments.every((d:any)=>Number.isInteger(d.editableDocumentVersion)));
  // A later draft must not replace the pinned body shown in this proposal.
  data(await call('POST',base+'/documents/'+a.id+'/actions/draft',{content:'First v2'},owner,a.version));
  data(await call('POST',base+'/documents/'+b.id+'/actions/draft',{content:'Second v3'},owner,detail.meetingDocuments[1].editableDocumentVersion));
  const amended=data(await call('POST',pp+'/revisions',{payload:{documents:[{documentId:a.id,documentVersion:2},{documentId:b.id,documentVersion:3}]}},owner,1));
  detail=data(await call('GET',pp+'?documentRevision=1',undefined,owner));
  assert.deepEqual(detail.meetingDocuments.map((d:any)=>[d.number,d.proposalRevision,d.content,d.editableDocumentVersion]),[[1,1,'First v1',undefined],[2,1,'Second v2',undefined]]);
  meeting=data(await call('GET',ep,undefined,owner));
  data(await call('POST',pp+'/actions/meeting-consent',{meetingVersion:meeting.meeting.version,revision:2,confirmed:true,reason:'Both approved'},owner,amended.version));
  const first=data(await call('GET',base+'/documents/'+a.id,undefined,owner));
  const second=data(await call('GET',base+'/documents/'+b.id,undefined,owner));
  const snapshot=await transaction(async c=>{
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)",[org.organization.id]);
    return snapshotO2({c,org:{id:org.organization.id}} as any,meeting.meeting.id);
  });
  const decision=snapshot.decisions.find((d:any)=>d.id===output.target.id);
  assert.ok(decision);
  assert.deepEqual(decision.restrictions.map((d:any)=>[d.documentId,d.number,d.content]),[[a.id,2,'First v2'],[b.id,3,'Second v3']]);
  assert.deepEqual(decision.restriction,decision.restrictions[0]);
  assert.equal(first.versions[0].number,2);
  assert.equal(second.versions[0].number,3);
  for(const document of [first,second]) {
    assert.equal(document.versions[0].origin.proposal.id,output.target.id);
    assert.equal(document.versions[0].origin.proposalRevision,2);
    assert.equal(document.versions[0].origin.meeting.id,meeting.meeting.id);
    assert.equal(document.versions[1].origin,undefined);
  }
  data(await call('POST',base+'/documents/'+b.id+'/actions/draft',{content:'Unapproved v4'},owner,second.document.version));
  const later=data(await call('GET',base+'/documents/'+b.id,undefined,owner));
  assert.equal(later.versions[0].origin,undefined);
  assert.equal(later.versions[1].origin.proposalRevision,2);
  // Proposal visibility does not grant access to its private source meeting.
  const limited=data(await call('GET',base+'/documents/'+a.id,undefined,member));
  assert.equal(limited.versions[0].origin.proposal.id,output.target.id);
  assert.equal(limited.versions[0].origin.meeting,undefined);
  assert.doesNotMatch(JSON.stringify(limited),new RegExp(meeting.meeting.id));
  data(await call('POST',base+'/members',{accountId:guest.id,memberType:'GUEST',accessPlan:[{resource:{context:'governance',kind:'agreement',id:a.id},actions:['read']}]},owner));
  const scoped=data(await call('GET',base+'/documents/'+a.id,undefined,guest));
  assert.deepEqual(scoped.versions[0].origin,{kind:'unavailable'});
  assert.doesNotMatch(JSON.stringify(scoped),new RegExp(output.target.id+'|'+meeting.meeting.id));
  assert.equal((await call('GET',base+'/documents/'+a.id,undefined,outsider)).statusCode,404);
  assert.equal((await call('GET',base+'/proposals/'+output.target.id,undefined,outsider)).statusCode,404);
  meeting=data(await call('GET',ep,undefined,owner));
  const archive=data(await call('POST',ep+'/outcomes',{kind:'PROPOSAL',title:'Archive first',proposalKind:'GOVERNANCE',payload:{documents:[{documentId:a.id,documentVersion:2,documentAction:'ARCHIVE',documentBaseVersion:first.document.version}]}},owner,meeting.meeting.version));
  meeting=data(await call('GET',ep,undefined,owner));
  data(await call('POST',base+'/proposals/'+archive.target.id+'/actions/meeting-consent',{meetingVersion:meeting.meeting.version,revision:1,confirmed:true,reason:'Archive approved'},owner,1));
  const archived=data(await call('GET',base+'/documents/'+a.id,undefined,owner));
  assert.equal(archived.document.archived,true);
  assert.deepEqual(archived.versions,first.versions);
});

test('legacy DOCUMENT proposals retain amend and publication origin contracts',async()=>{
  const owner=await user(),org=data(await call('POST','/organizations',{name:'Legacy document'},owner));
  const base='/organizations/'+org.organization.id,circleId=org.rootCircle.id;
  const doc=data(await call('POST',base+'/documents',{title:'Legacy restriction',ownerId:circleId,workflow:'GOVERNANCE',visibility:'ORGANIZATION',content:'Legacy v1'},owner));
  const proposal={id:randomUUID()};
  // Simulate the persisted contract from before create normalized DOCUMENT to GOVERNANCE.
  await transaction(async c=>{
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)",[org.organization.id]);
    await c.query("INSERT INTO gov_proposals(organization_id,id,circle_id,author_id,title,kind) VALUES($1,$2,$3,$4,'Legacy proposal','DOCUMENT')",[org.organization.id,proposal.id,circleId,org.membership.id]);
    await c.query("INSERT INTO gov_revisions(organization_id,proposal_id,number,payload) VALUES($1,$2,1,$3)",[org.organization.id,proposal.id,{documentId:doc.id,documentVersion:1}]);
  });
  const richContent={format:'orgmap-richtext',version:1,doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Legacy v2'}]}]}};
  const amended=data(await call('POST',base+'/proposals/'+proposal.id+'/revisions',{documentRevision:{documentId:doc.id,version:doc.version,richContent}},owner,1));
  const detail=data(await call('GET',base+'/proposals/'+proposal.id,undefined,owner));
  assert.equal(detail.proposal.kind,'DOCUMENT');
  assert.equal(detail.revisions.find((r:any)=>r.number===2).payload.documentId,doc.id);
  assert.equal(detail.revisions.find((r:any)=>r.number===2).payload.documentVersion,2);
  assert.equal(detail.meetingDocuments[0].content,'Legacy v2');
  data(await call('POST',base+'/governance/policies',{circleId,configuration:{...defaultPolicy,workflowSteps:['DECIDE']}},owner));
  data(await call('POST',base+'/proposals/'+proposal.id+'/actions/submit',{},owner,amended.version));
  data(await call('POST',base+'/proposals/'+proposal.id+'/votes',{choice:'CONSENT'},owner,amended.version+1));
  data(await call('POST',base+'/proposals/'+proposal.id+'/actions/decide',{verdict:'ADOPT',reason:'Legacy approval'},owner,amended.version+1));
  data(await call('POST',base+'/proposals/'+proposal.id+'/actions/apply',{},owner,amended.version+2));
  const published=data(await call('GET',base+'/documents/'+doc.id,undefined,owner));
  assert.equal(published.versions[0].origin.proposal.id,proposal.id);
  assert.equal(published.versions[0].origin.proposalRevision,2);
  assert.equal(published.versions[1].origin,undefined);
});
