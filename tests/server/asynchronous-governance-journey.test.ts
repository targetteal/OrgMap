import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {buildApp} from '../../server/src/app.js';
import {pool,transaction} from '../../server/src/db.js';
import {startSmtpSink} from '../../server/src/smtp.js';
import {createOrgMapIntegration,createPlatformWorker} from '../../server/integration/index.js';
import {defaultPolicy} from '../../server/modules/governance/domain.js';
const directory=await mkdtemp(join(tmpdir(),'orgmap-async-notification-'));
const smtp=await startSmtpSink({port:0,directory:join(directory,'mail')});const options={smtp:{port:(smtp.address() as {port:number}).port},blobsDirectory:join(directory,'blobs')};
const app=await buildApp([createOrgMapIntegration(options)],{migrationMaxPrefix:999});
after(async()=>{await app.close();await pool.end();await new Promise<void>(r=>smtp.close(()=>r()));await rm(directory,{recursive:true,force:true});});
type Actor={cookie:string;csrf:string;id:string};
async function call(method:string,path:string,body?:any,actor?:Actor,version?:number,key=randomUUID()){return app.inject({method:method as any,url:'/api/v1'+path,headers:{origin:'http://localhost:5173','idempotency-key':key,...(actor?{cookie:actor.cookie,'x-csrf-token':actor.csrf}:{}),...(version===undefined?{}:{'if-match':`"${version}"`})},payload:body});}
function data(r:any,status?:number){if(status!==undefined)assert.equal(r.statusCode,status,r.body);else assert.ok([200,201].includes(r.statusCode),r.body);return r.json().data;}
async function user(){const email=`${randomUUID()}@fixture.invalid`;const r=await call('POST','/auth/register',{email,password:'Synthetic-password-12345',displayName:'Async fixture'});const d=data(r,201);return {id:d.account.id,email,cookie:`orgmap_session=${r.cookies.find((c:any)=>c.name==='orgmap_session')!.value}`,csrf:d.csrfToken};}
async function waitDeadline(deadline:string){const end=Date.parse(deadline);assert.ok(Number.isFinite(end));for(let i=0;i<80;i++){const dbNow=(await pool.query('SELECT clock_timestamp() AS now')).rows[0].now as Date;if(+dbNow>=end)return;await new Promise(r=>setTimeout(r,200));}throw Error('POSTGRES_DEADLINE_NOT_REACHED');}
async function deliveryStates(organizationId:string,recipientId:string,resourceId:string){return transaction(async c=>{
 await c.query("SELECT set_config('orgmap.organization_id',$1,true)",[organizationId]);
 return (await c.query('SELECT id,event,channel,state,attempts FROM platform_deliveries WHERE organization_id=$1 AND recipient_id=$2 AND resource_id=$3 ORDER BY event,channel',[organizationId,recipientId,resourceId])).rows;
});}

test('asynchronous consent uses actual deadline, fresh snapshots, decision and publication',async()=>{
 const a=await user(),b=await user();const A=data(await call('POST','/organizations',{name:'Async A'},a),201),B=data(await call('POST','/organizations',{name:'Async B'},b),201);const path='/organizations/'+A.organization.id;
 const root=data(await call('GET',path+'/bootstrap',undefined,a)).rootCircleId;const member=data(await call('POST',path+'/members',{accountId:b.id},a),201).membership;
 const association=data(await call('POST',path+'/circles/'+root+'/memberships',{memberId:member.id},a)).membership;
 const platform=path+'/platform';const preference=data(await call('GET',platform+'/preferences',undefined,b));
 data(await call('POST',platform+'/preferences',{event:'structure.Master',channel:'EMAIL',enabled:false},b,preference.version));
 const worker=await createPlatformWorker(options);
 const cfg={...defaultPolicy,method:'CONSENT_WINDOW',reviewDurationHours:8/3600,responseRequirement:'ALL',allowAbstain:false,allowRevote:false,workflowSteps:['DECIDE']};
 const policy=data(await call('POST',path+'/governance/policies',{circleId:root,configuration:cfg},a));
 const doc=data(await call('POST',path+'/documents',{title:'Async agreement',ownerId:root,workflow:'GOVERNANCE',visibility:'ORGANIZATION',content:'Agreement contents'},a),201);
 const payload={documentId:doc.id,documentVersion:1};const p=data(await call('POST',path+'/proposals',{title:'Async proposal',circleId:root,kind:'DOCUMENT',payload},a),201);const ep=path+'/proposals/'+p.id;
 const submitKey=randomUUID();const first=data(await call('POST',ep+'/actions/submit',{},a,1,submitKey));assert.equal(first.round.electorate.length,2);assert.equal(first.round.policy.allowRevote,false);
 assert.equal(data(await call('POST',ep+'/actions/submit',{},a,1,submitKey)).round.id,first.round.id);
 for(let i=0;i<4;i++)await worker.runDelivery(A.organization.id,member.id);
 const opening=data(await call('GET',platform+'/notifications',undefined,b)).items.filter((x:any)=>x.event==='ProposalSubmitted'&&x.resourceId===p.id);assert.equal(opening.length,1);
 assert.equal(opening[0].resourceTitle,'Async proposal');
 assert.equal((await readdir(join(directory,'mail'))).filter(x=>x.endsWith('.eml')).length,0);
 assert.equal((await call('POST',ep+'/votes',{choice:'ABSTAIN'},a,2)).statusCode,422);
 data(await call('POST',ep+'/votes',{choice:'OBJECT',rationale:'Concrete risk'},a,2));assert.equal((await call('POST',ep+'/votes',{choice:'CONSENT'},a,2)).statusCode,409);
 assert.equal((await call('POST',ep+'/actions/decide',{reason:'Too soon'},a,2)).statusCode,409);
 const firstDetail=data(await call('GET',ep,undefined,a));assert.equal(firstDetail.ballots.length,1);const objection=firstDetail.objections[0];data(await call('POST',path+'/governance/objections/'+objection.id+'/actions/review',{state:'VALID',reason:'Risk confirmed'},a,1));
 await waitDeadline(first.round.deadline);assert.equal((await call('POST',ep+'/votes',{choice:'CONSENT'},b,2)).statusCode,409);assert.equal(data(await call('POST',ep+'/actions/decide',{reason:'Missing response and valid objection'},a,2)).verdict,'REVIEW_REQUIRED');
 data(await call('POST',path+'/circle-memberships/'+association.id+'/end',{},a,association.version));
 data(await call('POST',path+'/governance/policies',{circleId:root,configuration:{...cfg,allowAbstain:true,allowRevote:true}},a,policy.version));
 assert.equal(p.kind,'GOVERNANCE');
 data(await call('POST',ep+'/revisions',{payload:{documents:[payload]}},a,3),201);const second=data(await call('POST',ep+'/actions/submit',{},a,4));assert.equal(second.round.electorate.length,1);assert.equal(second.round.policy.allowRevote,true);assert.equal(second.round.policy.allowAbstain,true);const detail=data(await call('GET',ep,undefined,a));assert.equal(detail.rounds.length,2);assert.equal(detail.ballots.filter((x:any)=>x.roundId===second.round.id).length,0);
 data(await call('POST',ep+'/votes',{choice:'ABSTAIN'},a,5));data(await call('POST',ep+'/votes',{choice:'CONSENT'},a,5));assert.equal((await call('POST',ep+'/actions/decide',{reason:'All responded early'},a,5)).statusCode,409);
 await waitDeadline(second.round.deadline);assert.equal(data(await call('POST',ep+'/actions/decide',{reason:'Consent after deadline'},a,5)).verdict,'ADOPT');assert.equal(data(await call('POST',ep+'/actions/apply',{},a,6)).applyState,'APPLIED');assert.equal(data(await call('GET',path+'/documents/'+doc.id,undefined,a)).document.publishedVersion,1);
 const final=data(await call('GET',ep,undefined,a));assert.ok(final.history.some((h:any)=>h.action==='ProposalDecided'));assert.ok(final.history.some((h:any)=>h.action==='ProposalRevised'));assert.equal((await call('GET','/organizations/'+B.organization.id+'/proposals/'+p.id,undefined,b)).statusCode,404);assert.equal((await call('GET',path+'/documents/'+doc.id,undefined,b)).statusCode,200);
 const reassociation=data(await call('POST',path+'/circles/'+root+'/memberships',{memberId:member.id},a)).membership;
 const currentPreference=data(await call('GET',platform+'/preferences',undefined,b));data(await call('POST',platform+'/preferences',{event:'structure.Master',channel:'EMAIL',enabled:true},b,currentPreference.version));
 const doc2=data(await call('POST',path+'/documents',{title:'Joint agreement',ownerId:root,workflow:'GOVERNANCE',visibility:'ORGANIZATION',content:'Joint contents'},a),201);
 const joint=data(await call('POST',path+'/proposals',{title:'Joint async proposal',circleId:root,kind:'DOCUMENT',payload:{documentId:doc2.id,documentVersion:1}},a),201),jointEp=path+'/proposals/'+joint.id;
 const round=data(await call('POST',jointEp+'/actions/submit',{},a,1)).round;assert.equal(round.electorate.length,2);
 data(await call('POST',jointEp+'/votes',{choice:'CONSENT'},a,2));
 await new Promise(r=>setTimeout(r,350));
 data(await call('POST',jointEp+'/votes',{choice:'CONSENT'},b,2));assert.equal((await call('POST',jointEp+'/actions/decide',{reason:'Both responded, deadline still open'},a,2)).statusCode,409);
 await waitDeadline(round.deadline);assert.equal(data(await call('POST',jointEp+'/actions/decide',{reason:'Both consented after deadline'},a,2)).verdict,'ADOPT');assert.equal(data(await call('POST',jointEp+'/actions/apply',{},a,3)).applyState,'APPLIED');assert.equal(data(await call('GET',path+'/documents/'+doc2.id,undefined,b)).document.publishedVersion,1);
 let mailFiles:string[]=[];
 // A wall-clock deadline can expire while a sleeping test host makes no
 // delivery attempts. Bound actual polls instead, including retry backoff.
 const deliveryTrace:{elapsedMs:number;processed:boolean;states:string[]}[]=[];
 for(let attempt=0;attempt<200;attempt++) {
  const started=Date.now();
  const processed=await worker.runDelivery(A.organization.id,member.id);
  mailFiles=(await readdir(join(directory,'mail'))).filter(x=>x.endsWith('.eml'));
  const rows=await deliveryStates(A.organization.id,member.id,joint.id);
  deliveryTrace.push({elapsedMs:Date.now()-started,processed,states:rows.map(row=>`${row.event}:${row.channel}:${row.state}:${row.attempts}`)});
  if(mailFiles.length===2&&rows.length===4&&rows.every(row=>row.state==='DELIVERED'))break;
  if(rows.some(row=>row.state==='OUTCOME_UNKNOWN'||row.state==='FAILED'))break;
  await new Promise(r=>setTimeout(r,250));
 }
 const deliveries=await deliveryStates(A.organization.id,member.id,joint.id);
 const messages=data(await call('GET',platform+'/notifications',undefined,b)).items.filter((x:any)=>x.resourceId===joint.id);assert.deepEqual(messages.map((x:any)=>x.event).sort(),['ProposalDecided','ProposalSubmitted'],JSON.stringify({deliveries,mailFiles:mailFiles.length,deliveryTrace:deliveryTrace.slice(-20)}));
 assert.equal(messages[0].event,'ProposalDecided');assert.ok(messages.every((x:any)=>x.resourceTitle==='Joint async proposal'));
 assert.equal(data(await call('GET',platform+'/notifications',undefined,a)).items.filter((x:any)=>x.resourceId===joint.id).length,0);
 assert.equal(mailFiles.length,2,JSON.stringify(deliveries));
 assert.deepEqual(deliveries.filter(row=>row.channel==='EMAIL').map(row=>row.state),['DELIVERED','DELIVERED'],JSON.stringify(deliveries));
 for(const file of mailFiles)assert.match(await readFile(join(directory,'mail',file),'utf8'),new RegExp(b.email.replaceAll('.','\\.')));
 // This distinct pending event is enqueued while B is eligible; access is then
 // removed before the worker performs its normal delivery authorization.
 const revoked=data(await call('POST',path+'/proposals',{title:'Access revoked before delivery',circleId:root,kind:'DOCUMENT',payload:{documentId:doc2.id,documentVersion:1}},a),201),revokedEp=path+'/proposals/'+revoked.id;
 data(await call('POST',revokedEp+'/actions/submit',{},a,1));
 data(await call('POST',path+'/circle-memberships/'+reassociation.id+'/end',{},a,reassociation.version));
 for(let i=0;i<6;i++)await worker.runDelivery(A.organization.id,member.id);
 assert.equal(data(await call('GET',platform+'/notifications',undefined,b)).items.filter((x:any)=>x.resourceId===revoked.id).length,0);
 assert.doesNotMatch(JSON.stringify(data(await call('GET',platform+'/notifications',undefined,b))),/Joint async proposal|Access revoked before delivery/);
 assert.equal((await call('POST',platform+'/notifications/'+opening[0].id+'/read',{},b)).statusCode,404);
 assert.equal((await readdir(join(directory,'mail'))).filter(x=>x.endsWith('.eml')).length,2);
});
