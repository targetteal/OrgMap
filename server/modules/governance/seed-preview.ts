import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
const base='http://127.0.0.1:3016/api/v1',origin='http://governance.localhost:5186';
const proof=await fetch(base+'/governance-preview').then(r=>r.json());if(proof.testOnly!==true||!/^orgmap_gov_ui_[0-9a-f]{12}$/.test(proof.databaseName))throw Error('Dedicated governance preview required');
let cookie='',csrf='';
async function command(path:string,body:unknown,version?:number,method='POST'){const response=await fetch(base+path,{method,headers:{origin,'content-type':'application/json','idempotency-key':randomUUID(),...(cookie&&path!=='/auth/register'?{cookie,'x-csrf-token':csrf}:{}),...(version!==undefined?{'if-match':`"${version}"`}:{})},body:method==='GET'?undefined:JSON.stringify(body)});const payload=await response.json();if(!response.ok)throw Error(path+': '+payload.error?.code);if(path==='/auth/register'){cookie=response.headers.getSetCookie().find(c=>c.startsWith('orgmap_session='))!.split(';')[0];csrf=payload.data.csrfToken;}return payload.data;}
const email='governanca-final-'+randomUUID().slice(0,8)+'@example.test';await command('/auth/register',{email,password:'governanca-preview-test-2026',displayName:'Pessoa de teste Governança'});
let regionalPreferences:unknown;
if(process.env.GOVERNANCE_PREVIEW_LOCALE||process.env.GOVERNANCE_PREVIEW_TIME_ZONE){
 const current=(await command('/account/preferences',undefined,undefined,'GET')).preferences;
 regionalPreferences=(await command('/account/preferences',{locale:process.env.GOVERNANCE_PREVIEW_LOCALE??current.locale,timeZone:process.env.GOVERNANCE_PREVIEW_TIME_ZONE??current.timeZone,dateFormat:'YYYY-MM-DD'},current.version,'PATCH')).preferences;
}
const org=await command('/organizations',{name:'Instituto Horizontes Abertos'}),prefix='/organizations/'+org.organization.id,bootstrap=await command(prefix+'/bootstrap',undefined,undefined,'GET'),circleId=bootstrap.rootCircleId;
const role=(await command(prefix+'/roles',{name:'Guardião dos Acordos',mode:'DIRECT',purpose:'Cuidar dos acordos que orientam o trabalho coletivo.',circleId})).role;
await command(prefix+'/structure-advanced/roles/'+role.id+'/settings',{flags:{core:true,electable:true,assigner:false,representative:false,admin:false}},0,'PUT');
const proposal=await command(prefix+'/proposals',{title:'Revisar propósito do Guardião dos Acordos',circleId,kind:'GOVERNANCE',payload:{changes:[{kind:'UPDATE',entityId:role.id,baseVersion:role.version,purpose:'Revisar acordos com os círculos e registrar aprendizados.'}]}});await command(prefix+'/proposals/'+proposal.id+'/actions/submit',{},1);
await command(prefix+'/proposals',{title:'Eleição para cuidar dos acordos',circleId,kind:'ELECTION',payload:{roleId:role.id,winnerId:null,mandateEnd:new Date(Date.now()+90*86400000).toISOString()}});
await command(prefix+'/proposals',{title:'Clarear a ligação entre acordos e papéis de cuidado coletivo',circleId,kind:'GOVERNANCE',payload:{changes:[{kind:'UPDATE',entityId:role.id,baseVersion:role.version,name:'Guardião dos Acordos e Aprendizados',purpose:role.purpose}]}});
let guestPreview:unknown;
let agendaPreview:unknown;
let purposePreview:unknown;
if(process.env.GOVERNANCE_PREVIEW_PURPOSE==='1'){
 const purposeRich={format:'orgmap-richtext',version:1,doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Cuidar dos acordos 🌿',marks:[{type:'bold'}]}]},{type:'bulletList',content:[{type:'listItem',content:[{type:'paragraph',content:[{type:'text',text:'Escutar o círculo'}]}]}]}]}};
 const current=await command(prefix+'/structure',undefined,undefined,'GET');
 const target=current.nodes.find((n:any)=>n.entityId===role.id);
 const p=await command(prefix+'/proposals',{title:'Aplicar propósito rico inicial',circleId,kind:'GOVERNANCE',payload:{changes:[{kind:'UPDATE',entityId:role.id,baseVersion:target.version,purposeRich}]}});
 await command(prefix+'/proposals/'+p.id+'/actions/submit',{},1);
 await command(prefix+'/proposals/'+p.id+'/votes',{choice:'CONSENT'},2);
 for(const step of ['CLARIFY','REACT','OBJECT','DECIDE'])await command(prefix+'/proposals/'+p.id+'/actions/step',{step},2);
 await command(prefix+'/proposals/'+p.id+'/actions/decide',{verdict:'ADOPT',reason:'Fixture rico inicial aprovado'},2);
 await command(prefix+'/proposals/'+p.id+'/actions/apply',{},3);
 const structure=await command(prefix+'/structure',undefined,undefined,'GET');
 const read=structure.roles.find((r:any)=>r.id===role.id);
 if(!isDeepStrictEqual(read?.purposeRich,purposeRich))throw Error('Structure did not preserve rich purpose');
 purposePreview={proposalId:p.id,purposeRich,readPurposeRich:read.purposeRich};
}
if(process.env.GOVERNANCE_PREVIEW_AGENDA==='1'){
 const meeting=await command(prefix+'/meeting-series',{title:'Reunião de revisão dos acordos',circleId,localStart:'2030-01-01T10:00',timeZone:'America/Sao_Paulo',durationMinutes:60,recurrence:{frequency:'ONCE'},sections:[{id:'agenda',title:'Agenda',kind:'AGENDA'}],participants:[],policy:{notesOnlyNoter:false,windowDays:7}});
 const tension=await command(prefix+'/tensions',{title:'Clarear o cuidado com os acordos na próxima reunião',circleId,description:'Tensão sintética para verificar o encaminhamento atômico à agenda.'});
 agendaPreview={meetingId:meeting.occurrenceIds[0],tensionId:tension.id};
}
if(process.env.GOVERNANCE_PREVIEW_GUEST==='1'){
 const guestProposal=await command(prefix+'/proposals',{title:'Consulta compartilhada com convidado',circleId,kind:'GOVERNANCE',payload:{changes:[{kind:'UPDATE',entityId:role.id,baseVersion:role.version,purpose:'Escutar contribuições externas sobre os acordos.'}]}});
 const ownerCookie=cookie,ownerCsrf=csrf;
 const guestEmail='governanca-convidado-'+randomUUID().slice(0,8)+'@example.test';
 const account=(await command('/auth/register',{email:guestEmail,password:'governanca-preview-test-2026',displayName:'Convidado de teste Governança'})).account;
 cookie=ownerCookie;csrf=ownerCsrf;
 const membership=(await command(prefix+'/members',{accountId:account.id,memberType:'GUEST',accessPlan:[{resource:{context:'governance',kind:'proposal',id:guestProposal.id},actions:['read','vote']}]})).membership;
 await command(prefix+'/proposals/'+guestProposal.id+'/actions/submit',{},1);
 guestPreview={email:guestEmail,proposalId:guestProposal.id,memberId:membership.id};
}
await writeFile('web/src/features/governance/evidence/preview-fixture.json',JSON.stringify({synthetic:true,databaseName:proof.databaseName,email,regionalPreferences,guestPreview,agendaPreview,purposePreview,organizationId:org.organization.id,circleId,roleId:role.id,reviewProposalId:proposal.id},null,2)+'\n');console.log('Synthetic preview ready: '+email+' / '+org.organization.id);
