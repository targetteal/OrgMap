import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, HTTPMethods } from 'fastify';
import { buildApp } from '../../server/src/app.js';
import { pool } from '../../server/src/db.js';
import { createOrgMapIntegration } from '../../server/integration/index.js';
import { Y } from '../../server/modules/meetings/realtime.js';

const origin = 'http://journey.localhost:5273';
process.env.ALLOWED_ORIGINS = origin;
if (!/^\/orgmap_journey_[a-f0-9]{16}$/.test(new URL(process.env.DATABASE_URL ?? 'postgres://invalid/orgmap').pathname)) throw Error('EXCLUSIVE_JOURNEY_DATABASE_REQUIRED');
after(async () => { await pool.end(); });
type Session = { cookie: string; csrf: string; accountId: string };
async function account(app: FastifyInstance, label: string, ip: string): Promise<Session> {
  const r = await app.inject({method:'POST',url:'/api/v1/auth/register',remoteAddress:ip,headers:{origin},payload:{email:`${randomUUID()}@example.test`,password:'Journey-password-long-123',displayName:label}});
  assert.equal(r.statusCode,201,r.body);
  const cookie=r.cookies.find(c=>c.name==='orgmap_session'); assert.ok(cookie);
  return {cookie:`orgmap_session=${cookie.value}`,csrf:r.json().data.csrfToken,accountId:r.json().data.account.id};
}
async function request(app:FastifyInstance, u:Session, method:HTTPMethods, url:string, payload?:object, version?:number, key=randomUUID()) {
  return app.inject({method,url,payload,headers:{origin,cookie:u.cookie,'x-csrf-token':u.csrf,'idempotency-key':key,...(version===undefined?{}:{'if-match':`"${version}"`})}});
}
function ok(r:{statusCode:number;body:string;json:()=>any},status=200) { assert.equal(r.statusCode,status,r.body); return r.json().data; }
function yupdate(text:string) { const d=new Y.Doc(); d.getText('notes').insert(0,text); const update=Buffer.from(Y.encodeStateAsUpdate(d)).toString('base64'); d.destroy(); return update; }
test('real meeting, tension, decision, structure and published agreement retain their origins',async()=>{
 const app=await buildApp([createOrgMapIntegration()],{migrationMaxPrefix:999});
 try {
  await app.ready();
  const owner=await account(app,'Facilitadora','192.0.2.1'), member=await account(app,'Participante','192.0.2.2'), outsider=await account(app,'Outra organização','192.0.2.3');
  const org=ok(await request(app,owner,'POST','/api/v1/organizations',{name:'Jornada A'}),201);
  ok(await request(app,outsider,'POST','/api/v1/organizations',{name:'Jornada B'}),201);
  const base=`/api/v1/organizations/${org.organization.id}`, circleId=org.rootCircle.id;
  const membership=ok(await request(app,owner,'POST',`${base}/members`,{accountId:member.accountId}),201).membership;
  ok(await request(app,owner,'POST',`${base}/circles/${circleId}/memberships`,{memberId:membership.id}),201);
  const series=ok(await request(app,owner,'POST',`${base}/meeting-series`,{title:'Reunião real',circleId,localStart:'2030-01-01T10:00',timeZone:'UTC',durationMinutes:60,recurrence:{frequency:'ONCE'},sections:[{id:'checkin',title:'Check-in',kind:'CHECKIN'},{id:'agenda',title:'Pauta',kind:'AGENDA'},{id:'checkout',title:'Check-out',kind:'CHECKOUT'}],participants:[{memberId:membership.id,access:'EDIT'}],policy:{notesOnlyNoter:false,windowDays:7}}),201);
  const route=`${base}/meetings/${series.occurrenceIds[0]}`;
  assert.equal((await request(app,outsider,'GET',route)).statusCode,404);
  assert.equal((await request(app,member,'POST',`${route}/actions/start`,{},1)).statusCode,403);
  let meeting=ok(await request(app,owner,'POST',`${route}/actions/start`,{},1));
  const checkin={sectionId:'checkin',epoch:1,updateId:randomUUID(),update:yupdate('Cheguei com atenção')};
  const noteKey=randomUUID(); const ack=ok(await request(app,member,'POST',`${route}/collaboration/updates`,checkin,undefined,noteKey));
  assert.equal(ok(await request(app,member,'POST',`${route}/collaboration/updates`,checkin,undefined,noteKey)).sequence,ack.sequence);
  const tension=ok(await request(app,owner,'POST',`${base}/tensions`,{title:'Precisamos cuidar dos acordos',circleId}),201);
  const command={targetKind:'AGENDA',meetingId:series.occurrenceIds[0],meetingVersion:meeting.meeting.version};
  assert.equal((await request(app,owner,'POST',`${base}/tensions/${tension.id}/actions/process`,{...command,meetingVersion:999},tension.version)).statusCode,409);
  const processKey=randomUUID(), converted=ok(await request(app,owner,'POST',`${base}/tensions/${tension.id}/actions/process`,command,tension.version,processKey));
  assert.equal(ok(await request(app,owner,'POST',`${base}/tensions/${tension.id}/actions/process`,command,tension.version,processKey)).targetId,converted.targetId);
  meeting=ok(await request(app,owner,'GET',route));
  assert.equal(meeting.agenda.find((a:any)=>a.id===converted.targetId)?.sourceId,tension.id);
  meeting=ok(await request(app,owner,'POST',`${route}/actions/step`,{sectionId:'agenda'},meeting.meeting.version));
  const roleId=randomUUID();
  const branch=ok(await request(app,owner,'POST',`${base}/governance/branches`,{title:'Papel de acordos',changes:[{kind:'CREATE',entityId:roleId,entityKind:'ROLE',parentCircleId:circleId,name:'Guardião de Acordos',purpose:'Cuidar dos acordos'}]}),201);
  const proposalInput={title:'Criar papel',circleId,tensionId:tension.id,kind:'GOVERNANCE',branchId:branch.id};
  const proposalKey=randomUUID();
  const proposal=ok(await request(app,owner,'POST',`${base}/proposals`,proposalInput,undefined,proposalKey),201);
  assert.equal(ok(await request(app,owner,'POST',`${base}/proposals`,proposalInput,undefined,proposalKey),201).id,proposal.id);
  assert.equal((await request(app,owner,'POST',`${base}/proposals`,{...proposalInput,title:'Alterado'},undefined,proposalKey)).statusCode,409);
  assert.equal((await request(app,outsider,'GET',`${base}/proposals/${proposal.id}`)).statusCode,404);
  const submitted=ok(await request(app,owner,'POST',`${base}/proposals/${proposal.id}/actions/submit`,{},1));
  assert.ok(submitted.round.electorate.includes(membership.id));
  ok(await request(app,owner,'POST',`${base}/proposals/${proposal.id}/votes`,{choice:'CONSENT'},2));
  for(const step of ['CLARIFY','REACT','OBJECT','DECIDE']) ok(await request(app,owner,'POST',`${base}/proposals/${proposal.id}/actions/step`,{step},2));
  assert.equal((await request(app,owner,'POST',`${base}/proposals/${proposal.id}/actions/decide`,{verdict:'ADOPT',reason:'Quórum incompleto'},2)).statusCode,409);
  const voteKey=randomUUID(), vote={choice:'OBJECT',rationale:'Risco concreto'};
  ok(await request(app,member,'POST',`${base}/proposals/${proposal.id}/votes`,vote,2,voteKey));
  ok(await request(app,member,'POST',`${base}/proposals/${proposal.id}/votes`,vote,2,voteKey));
  let detail=ok(await request(app,owner,'GET',`${base}/proposals/${proposal.id}`));
  assert.equal(detail.ballots.length,2); assert.equal(detail.objections.length,1);
  assert.equal((await request(app,owner,'POST',`${base}/proposals/${proposal.id}/actions/decide`,{verdict:'ADOPT',reason:'Objeção aberta'},2)).statusCode,409);
  ok(await request(app,owner,'POST',`${base}/governance/objections/${detail.objections[0].id}/actions/review`,{state:'INTEGRATED',reason:'Mudança integrada'},1));
  ok(await request(app,owner,'POST',`${base}/proposals/${proposal.id}/actions/decide`,{verdict:'ADOPT',reason:'Objeção integrada'},2));
  const applyKey=randomUUID(), applied=ok(await request(app,owner,'POST',`${base}/proposals/${proposal.id}/actions/apply`,{},3,applyKey));
  assert.equal(applied.applyState,'APPLIED'); assert.equal(ok(await request(app,owner,'POST',`${base}/proposals/${proposal.id}/actions/apply`,{},3,applyKey)).commitId,applied.commitId);
  assert.ok(ok(await request(app,owner,'GET',`${base}/structure`)).nodes.some((n:any)=>n.entityId===roleId));
  const doc=ok(await request(app,owner,'POST',`${base}/documents`,{title:'Acordo do círculo',ownerId:circleId,workflow:'GOVERNANCE',visibility:'ORGANIZATION',content:'Cuidamos dos acordos'}),201);
  const agreement=ok(await request(app,owner,'POST',`${base}/proposals`,{title:'Publicar acordo',circleId,kind:'DOCUMENT',payload:{documentId:doc.id,documentVersion:1}}),201);
  ok(await request(app,owner,'POST',`${base}/proposals/${agreement.id}/actions/submit`,{},1));
  ok(await request(app,owner,'POST',`${base}/proposals/${agreement.id}/votes`,{choice:'CONSENT'},2));
  ok(await request(app,member,'POST',`${base}/proposals/${agreement.id}/votes`,{choice:'CONSENT'},2));
  for(const step of ['CLARIFY','REACT','OBJECT','DECIDE']) ok(await request(app,owner,'POST',`${base}/proposals/${agreement.id}/actions/step`,{step},2));
  ok(await request(app,owner,'POST',`${base}/proposals/${agreement.id}/actions/decide`,{verdict:'ADOPT',reason:'Acordo consentido'},2));
  ok(await request(app,owner,'POST',`${base}/proposals/${agreement.id}/actions/apply`,{},3));
  const firstDocument=ok(await request(app,owner,'GET',`${base}/documents/${doc.id}`));
  assert.equal(firstDocument.document.publishedVersion,1);
  assert.equal(firstDocument.versions[0].origin.proposal.id,agreement.id);
  assert.equal(firstDocument.versions[0].origin.proposalRevision,1);
  const memberCaps=ok(await request(app,member,'GET',`${base}/platform/resources/agreement/${doc.id}/capabilities`));
  assert.equal(memberCaps.actions.read,true); assert.equal(memberCaps.actions.comment,true);
  assert.equal((await request(app,outsider,'GET',`${base}/platform/resources/agreement/${doc.id}/capabilities`)).statusCode,404);

  const child=ok(await request(app,owner,'POST',`${base}/circles`,{mode:'DIRECT',name:'Private participation circle',parentCircleId:circleId}),201).circle;
  const childRole=ok(await request(app,owner,'POST',`${base}/roles`,{mode:'DIRECT',name:'Circle role',circleId:child.id}),201).role;
  for(const [ownerId,expected] of [[circleId,true],[child.id,false],[childRole.id,false]] as const) {
    const item=ok(await request(app,owner,'POST',`${base}/documents`,{title:'Capability test',ownerId,workflow:'DIRECT',visibility:'ORGANIZATION',content:'Text'}),201);
    const capabilities=ok(await request(app,member,'GET',`${base}/platform/resources/agreement/${item.id}/capabilities`));
    assert.equal(capabilities.actions.read,true);assert.equal(capabilities.actions.comment,expected);
    assert.equal(ok(await request(app,owner,'GET',`${base}/platform/resources/agreement/${item.id}/capabilities`)).actions.comment,true);
    if(ownerId===childRole.id) {
      ok(await request(app,owner,'POST',`${base}/documents/${item.id}/actions/publish`,{},1));
      assert.equal(ok(await request(app,member,'GET',`${base}/documents/${item.id}`)).versions[0].origin.kind,'direct');
      ok(await request(app,owner,'POST',`${base}/documents/${item.id}/actions/archive`,{},2));
      assert.equal(ok(await request(app,member,'GET',`${base}/platform/resources/agreement/${item.id}/capabilities`)).actions.comment,false);
    }
  }
  const restricted=ok(await request(app,owner,'POST',`${base}/documents`,{title:'Private title',ownerId:circleId,workflow:'DIRECT',visibility:'AUTHOR',content:'Private'}),201);
  const deniedPrivate=await request(app,member,'GET',`${base}/platform/resources/agreement/${restricted.id}/capabilities`);
  assert.equal(deniedPrivate.statusCode,403);assert.doesNotMatch(deniedPrivate.body,/Private title/);

  const secondDraft=ok(await request(app,owner,'POST',`${base}/documents/${doc.id}/actions/draft`,{content:'Segundo acordo'},2));
  const agreement2=ok(await request(app,owner,'POST',`${base}/proposals`,{title:'Revisar acordo',circleId,kind:'DOCUMENT',payload:{documentId:doc.id,documentVersion:secondDraft.draftVersion}}),201);
  ok(await request(app,owner,'POST',`${base}/proposals/${agreement2.id}/actions/submit`,{},1));
  ok(await request(app,owner,'POST',`${base}/proposals/${agreement2.id}/votes`,{choice:'CONSENT'},2));
  ok(await request(app,member,'POST',`${base}/proposals/${agreement2.id}/votes`,{choice:'CONSENT'},2));
  for(const step of ['CLARIFY','REACT','OBJECT','DECIDE']) ok(await request(app,owner,'POST',`${base}/proposals/${agreement2.id}/actions/step`,{step},2));
  ok(await request(app,owner,'POST',`${base}/proposals/${agreement2.id}/actions/decide`,{verdict:'ADOPT',reason:'Segunda versão consentida'},2));
  ok(await request(app,owner,'POST',`${base}/proposals/${agreement2.id}/actions/apply`,{},3));
  const revised=ok(await request(app,member,'GET',`${base}/documents/${doc.id}`));
  assert.equal(revised.versions.find((v:any)=>v.number===1).origin.proposal.id,agreement.id);
  assert.equal(revised.versions.find((v:any)=>v.number===2).origin.proposal.id,agreement2.id);
  meeting=ok(await request(app,owner,'GET',route));
  meeting=ok(await request(app,owner,'POST',`${route}/actions/step`,{sectionId:'checkout'},meeting.meeting.version));
  ok(await request(app,member,'POST',`${route}/collaboration/updates`,{sectionId:'checkout',epoch:1,updateId:randomUUID(),update:yupdate('Saio com clareza')}));
  meeting=ok(await request(app,owner,'GET',route));
  assert.equal((await request(app,owner,'POST',`${route}/actions/close`,{},1)).statusCode,409);
  ok(await request(app,owner,'POST',`${route}/actions/close`,{},meeting.meeting.version));
  const history=ok(await request(app,owner,'GET',`${route}/report/versions`));
  const snapshot=history.items[0].snapshot;
  assert.ok(snapshot.documents.find((d:any)=>d.sectionId==='checkin' && d.sequence>=1));
  assert.ok(snapshot.documents.find((d:any)=>d.sectionId==='checkout' && d.sequence>=1));
  const reloaded=ok(await request(app,member,'GET',route));
  assert.equal(reloaded.agenda.find((a:any)=>a.id===converted.targetId)?.sourceId,tension.id);
  detail=ok(await request(app,owner,'GET',`${base}/proposals/${proposal.id}`));
  assert.ok(JSON.stringify(detail).includes(tension.id));
  assert.ok(detail.history.some((h:any)=>h.action==='ProposalDecided'));
  assert.ok(detail.history.some((h:any)=>h.action==='StructureCommitted'));
 } finally { await app.close(); }
});
