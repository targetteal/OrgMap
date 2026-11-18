import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {governanceProcessTranslator} from './process-messages';
import {governanceDetailTranslator} from './detail-messages';
import type {FeatureContext} from '../../feature-contract';
const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://governance.localhost'});
for(const key of ['window','document','HTMLElement','HTMLInputElement','HTMLFormElement','FormData','MutationObserver','Event','MouseEvent','DOMException','navigator'] as const)Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:(dom.window as any)[key],configurable:true});
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
const {createRoot}=await import('react-dom/client');const {LocalizationProvider}=await import('../../localization');const {feature}=await import('./index');
const Component=feature.Component,container=dom.window.document.getElementById('root')!;
const circle='00000000-0000-4000-8000-000000000001',tension='00000000-0000-4000-8000-000000000002',meeting='00000000-0000-4000-8000-000000000003';
const configuration={draftAccess:'AUTHOR_ONLY',method:'MANUAL_FACILITATED',quorumPercent:100,responseRequirement:'QUORUM',reviewDurationHours:168,allowRevote:false,allowAbstain:true,workflowSteps:['PRESENT','CLARIFY','REACT','OBJECT','DECIDE']};
const results:unknown[]=[];
for(const locale of ['pt-BR','en-US','es-ES','fr-FR','de-DE','it-IT','ja-JP','nl-NL'])for(const mode of ['policy-allowed','policy-locked','agenda-allowed','agenda-denied']){
 const p=governanceProcessTranslator(locale),d=governanceDetailTranslator(locale),writes:any[]=[],navigation:string[]=[];let meetingReads=0;
 const policy=mode.startsWith('policy'),allowed=mode.endsWith('allowed');
 const context={organizationId:'org',path:'/structure/'+(policy?'governance-policy':'tensions'),bootstrap:{membership:{id:'actor',orgRole:'OWNER',memberType:'MEMBER'},rootCircleId:circle,modules:{meetings:true},capabilities:{'structure.direct':true}},structure:{nodes:[{entityId:circle,kind:'CIRCLE',name:'Fixture Circle',version:1}],circles:[],roles:[],memberships:[],occupancies:[]},members:[],session:{},navigate:(path:string)=>navigation.push(path),notify:()=>{},refresh:()=>{},api:async(path:string,options:any={})=>{
  if(options.method==='POST'){writes.push({path,body:options.body,version:options.version});return {data:{id:tension,version:2}};}
  if(path.endsWith('/effective'))return {data:{configuration,policySource:'ORGANIZATION',allowOverride:allowed,localVersion:0,leadLinkAccessAvailable:false}};
  if(path.includes('/meetings?'))return {data:{items:[{id:meeting,circleId:circle,title:'Fixture meeting',version:7,state:'SCHEDULED',startAt:'2030-01-01T13:00:00Z',method:'STANDARD'}],page:{nextCursor:null}}};
  if(path.endsWith('/meetings/'+meeting))return {data:{meeting:{id:meeting,circleId:circle,title:'Fixture meeting',version:7+(++meetingReads),state:'SCHEDULED',startAt:'2030-01-01T13:00:00Z',method:'STANDARD'},capabilities:{edit:allowed,manage:false}}};
  assert.ok(path.endsWith('/governance/policies')||path.endsWith('/tensions')||path.endsWith('/documents')||path.endsWith('/document-types'));
  return {data:{items:path.endsWith('/tensions')?[{id:tension,circleId:circle,title:'Fixture tension',state:'OPEN',version:1,authorId:'actor',canProcessAgenda:true}]:[],page:{nextCursor:null}}};
 }} as unknown as FeatureContext;
 const root=createRoot(container);await act(async()=>root.render(<LocalizationProvider preferences={{locale}}><Component context={context}/></LocalizationProvider>));
 const button=(name:string,scope:ParentNode=container)=>{const b=[...scope.querySelectorAll('button')].find(el=>el.textContent?.trim()===name);assert.ok(b,'Missing '+locale+' '+mode+' '+name);return b;};
 await act(async()=>button(policy?d('configureProcess'):p('agendaAction')).click());
 const dialog=container.querySelector('dialog')!;assert.ok(dialog);
 if(policy){
  assert.ok(dialog.textContent?.includes(p('effectivePolicy')));assert.ok(dialog.textContent?.includes(p('leadUnavailable')));
  const field=(name:string)=>{const l=[...dialog.querySelectorAll('label')].find(el=>el.querySelector(':scope > span')?.textContent===name);assert.ok(l);return l.querySelector<HTMLSelectElement>('select')!;};
  assert.equal(field(p('draftAccess')).querySelector<HTMLOptionElement>('option[value="AUTHOR_AND_LEAD_LINKS"]')?.disabled,true);
  const save=button(p('savePolicy'),dialog);
  if(!allowed){assert.equal(save.disabled,true);assert.ok(dialog.textContent?.includes(p('overrideForbidden')));assert.equal(dialog.querySelector<HTMLFieldSetElement>('fieldset')?.disabled,true);}
  else{
   for(const [name,value]of [[p('draftAccess'),'CIRCLE_MEMBERS'],[p('workflow'),'SIMPLIFIED']] as const){const select=field(name);await act(async()=>{select.value=value;select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});}
   await act(async()=>save.click());assert.equal(writes.length,1);assert.equal(writes[0].version,0);assert.deepEqual(writes[0].body,{circleId:circle,configuration:{...configuration,draftAccess:'CIRCLE_MEMBERS',workflowSteps:['PRESENT','DECIDE']}});
  }
 }else{
  assert.equal(dialog.querySelector('h2')?.textContent,p('toAgenda'));
  const select=dialog.querySelector('select')!;await act(async()=>{select.value=meeting;select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  const add=button(p('addToAgenda'),dialog);
  if(!allowed){assert.equal(add.disabled,true);assert.ok(dialog.textContent?.includes(p('agendaDenied')));if(locale==='en-US'){
   const readsBefore=meetingReads;
   await act(async()=>root.render(<LocalizationProvider preferences={{locale:'ja-JP'}}><Component context={context}/></LocalizationProvider>));
   assert.ok(dialog.querySelector('[role="alert"]')?.textContent?.includes(governanceProcessTranslator('ja-JP')('agendaDenied')));assert.equal(select.value,meeting);assert.equal(meetingReads,readsBefore);
   await act(async()=>root.render(<LocalizationProvider preferences={{locale}}><Component context={context}/></LocalizationProvider>));
  }}
  else{assert.ok(dialog.textContent?.includes(p('agendaExplanation',{meeting:'Fixture meeting'})));await act(async()=>button(p('refreshMeeting'),dialog).click());await act(async()=>add.click());assert.deepEqual(writes,[{path:'/organizations/org/tensions/'+tension+'/actions/process',body:{targetKind:'AGENDA',meetingId:meeting,meetingVersion:9},version:1}]);assert.deepEqual(navigation,['/meetings/'+meeting]);}
 }
 if(!allowed)assert.equal(writes.length,0);
 results.push({locale,mode,fixture:true,checks:policy?['effective policy text','missing lead port disables option',allowed?'draft access+workflow payload/version':'org policy locks edits without writes']:['authorized list is not write authority',allowed?'refresh uses latest target version and source version':'denied target keeps submit disabled'],writes});
 await act(async()=>root.unmount());
}
await writeFile('web/src/features/governance/evidence/process-localization-dom.json',JSON.stringify({kind:'React/JSDOM with explicit fixtures; no real API/browser',verifiedAt:new Date().toISOString(),results},null,2)+'\n');console.log('Governance policy/agenda permissions and payloads passed in DOM for all 8 locales.');
