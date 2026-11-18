import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {governanceDetailTranslator} from './detail-messages';
import type {FeatureContext} from '../../feature-contract';
const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://governance.localhost'});
for(const key of ['window','document','HTMLElement','HTMLInputElement','HTMLFormElement','FormData','MutationObserver','Event','MouseEvent','DOMException','navigator'] as const)Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:(dom.window as any)[key],configurable:true});
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
const {createRoot}=await import('react-dom/client');
const {LocalizationProvider,formatError}=await import('../../localization');
const {RequestError}=await import('../../api');
const {feature}=await import('./index');
const Component=feature.Component,container=dom.window.document.getElementById('root')!;
const proposalId='00000000-0000-4000-8000-000000000001';
const results:unknown[]=[];
for(const locale of ['pt-BR','en-US','es-ES','fr-FR','de-DE','it-IT','ja-JP','nl-NL']){
 const t=governanceDetailTranslator(locale),writes:{path:string;body:any;version:number}[]=[],notices:string[]=[];
 let failDecision=true;
 const detail:any={proposal:{id:proposalId,circleId:'circle',authorId:'actor',title:'Fixture proposal',kind:'GOVERNANCE',state:'REVIEW',version:2,revision:1,canEdit:true,canVote:true},revisions:[{number:1,payload:{changes:[{kind:'UPDATE',entityId:'circle',baseVersion:1,name:'Fixture Circle',purpose:'Fixture purpose'}]}}],rounds:[{id:'round',revision:1,electorate:['actor'],state:'OPEN',step:'DECIDE',policy:{method:'MANUAL_FACILITATED',quorumPercent:100,allowRevote:false,allowAbstain:true,workflowSteps:['PRESENT','DECIDE']}}],ballots:[],objections:[],nominations:[],commits:[],history:[]};
 const context={organizationId:'org',path:'/structure/proposals/'+proposalId,bootstrap:{membership:{id:'actor',memberType:'MEMBER',orgRole:'OWNER'},capabilities:{'structure.direct':true},rootCircleId:'circle'},structure:{nodes:[{entityId:'circle',name:'Fixture Circle'}],circles:[],roles:[],memberships:[],occupancies:[]},members:[{id:'actor',displayName:'Fixture Actor'}],session:{},navigate:()=>{},notify:(message:string)=>notices.push(message),refresh:()=>{},api:async(path:string,options:any={})=>{
  if(options.method==='POST'){
   writes.push({path,body:options.body,version:options.version});
   if(path.endsWith('/votes')){assert.deepEqual(options.body,{choice:'CONSENT',rationale:''});assert.equal(options.version,2);detail.ballots.push({roundId:'round',memberId:'actor',choice:'CONSENT',number:1,rationale:''});}
   else if(path.endsWith('/actions/decide')){
    if(failDecision){failDecision=false;detail.proposal.version=3;throw new RequestError('VERSION_CONFLICT','Synthetic concurrent update');}
    assert.deepEqual(options.body,{verdict:'ADOPT',reason:'Fixture decision reason'});assert.equal(options.version,3);Object.assign(detail.proposal,{state:'DECIDED',verdict:'ADOPT',applyState:'PENDING',version:4});detail.rounds[0].state='CLOSED';
   }else if(path.endsWith('/actions/apply')){assert.equal(options.version,4);Object.assign(detail.proposal,{applyState:'APPLIED',version:5});detail.commits.push({id:'commit',at:'2026-10-19T12:00:00Z'});}
   else if(path.endsWith('/governance/objections/objection/actions/review')){assert.deepEqual(options.body,{state:'TESTING',reason:'Fixture human review'});assert.equal(options.version,1);detail.objections[0].state='TESTING';detail.objections[0].version=2;}
   else assert.fail('Unexpected fixture mutation '+path);
   return {data:structuredClone(detail.proposal)};
  }
  if(path.endsWith('/proposals/'+proposalId))return {data:structuredClone(detail)};
  assert.ok(path.endsWith('/proposals')||path.endsWith('/documents')||path.endsWith('/document-types'));
  return {data:{items:path.endsWith('/proposals')?[structuredClone(detail.proposal)]:[],page:{nextCursor:null}}};
 }} as unknown as FeatureContext;
 const root=createRoot(container);
 await act(async()=>root.render(<LocalizationProvider preferences={{locale}}><Component context={context}/></LocalizationProvider>));
 const button=(name:string,scope:ParentNode=container)=>{const b=[...scope.querySelectorAll('button')].find(el=>el.textContent?.trim()===name);assert.ok(b,'Missing '+locale+' button '+name);return b;};
 assert.ok(container.textContent?.includes(t('decisionRound')));assert.ok(container.textContent?.includes(t('changes',{count:1})));
 await act(async()=>button(t('recordVote')).click());assert.ok(container.textContent?.includes(t('lockedVote')));
 await act(async()=>button(t('recordDecision')).click());
 const dialog=container.querySelector('dialog')!;assert.equal(dialog.querySelector('h2')?.textContent,t('recordDecision'));
 const reason=dialog.querySelector<HTMLTextAreaElement>('textarea[name="reason"]')!;reason.value='Fixture decision reason';
 const select=dialog.querySelector<HTMLSelectElement>('select[name="verdict"]')!;
 await act(async()=>{select.value='REJECT';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
 await act(async()=>button(t('record'),dialog).click());
 assert.ok(dialog.querySelector('[role="alert"]'));assert.equal(reason.value,'Fixture decision reason');assert.equal(select.value,'REJECT');
 if(locale==='en-US'){
  await act(async()=>root.render(<LocalizationProvider preferences={{locale:'ja-JP'}}><Component context={context}/></LocalizationProvider>));
  assert.ok(dialog.querySelector('[role="alert"]')?.textContent?.includes(formatError(new RequestError('VERSION_CONFLICT','fixture'),'ja-JP')));assert.equal(reason.value,'Fixture decision reason');assert.equal(select.value,'REJECT');
  await act(async()=>root.render(<LocalizationProvider preferences={{locale}}><Component context={context}/></LocalizationProvider>));
 }
 await act(async()=>button(t('refresh'),dialog).click());
 assert.equal(dialog.querySelector<HTMLTextAreaElement>('textarea[name="reason"]')?.value,'Fixture decision reason');
 const currentSelect=dialog.querySelector<HTMLSelectElement>('select[name="verdict"]')!;assert.equal(currentSelect.value,'REJECT');
 await act(async()=>{currentSelect.value='ADOPT';currentSelect.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
 await act(async()=>button(t('record'),dialog).click());assert.equal(container.querySelector('dialog'),null);
 await act(async()=>button(t('apply')).click());assert.equal(detail.proposal.applyState,'APPLIED');
 assert.ok(container.textContent?.includes(t('appliedAt',{at:''}).trim()));
 assert.ok(notices.length>=2);assert.ok(notices.every(message=>message===t('saved')));
 if(locale==='en-US')await writeFile('web/src/features/governance/evidence/detail-localization-en.dom.html',container.innerHTML);
 await act(async()=>root.unmount());
 Object.assign(detail.proposal,{state:'REVIEW',applyState:'PENDING',version:6});
 detail.rounds[0].policy.method='CONSENT_WINDOW';detail.rounds[0].state='OPEN';
 detail.objections=[{id:'objection',authorId:'actor',state:'RAISED',rationale:'Fixture objection',version:1}];
 const secondRoot=createRoot(container);
 await act(async()=>secondRoot.render(<LocalizationProvider preferences={{locale}}><Component context={context}/></LocalizationProvider>));
 const objectionForm=[...container.querySelectorAll('form')].find(form=>form.textContent?.includes(t('recordOutcome')))!;
 const humanReason=objectionForm.querySelector('textarea')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value')!.set!.call(humanReason,'Fixture human review');humanReason.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
 await act(async()=>button(t('recordOutcome'),objectionForm).click());
 assert.equal(detail.objections[0].state,'TESTING');
 await act(async()=>button(t('recordDecision')).click());
 const automaticDialog=container.querySelector('dialog')!;
 assert.ok(automaticDialog.textContent?.includes(t('automaticResult')));assert.equal(automaticDialog.querySelector('select[name="verdict"]'),null);
 const close=automaticDialog.querySelector<HTMLButtonElement>(`button[aria-label="${t('close')}"]`)!;assert.ok(close);await act(async()=>close.click());
 results.push({locale,source:'explicit fixture adapter, React/JSDOM',checks:['localized decision round','vote payload unchanged','locked vote feedback','localized decision dialog','conflict visible inside dialog','reason and verdict survive refresh','fresh version on retry','apply payload version','localized notifications','objection review payload and version','automatic decision has no manual verdict','localized close control'],writes});
 await act(async()=>secondRoot.unmount());
}
await writeFile('web/src/features/governance/evidence/detail-localization-dom.json',JSON.stringify({kind:'React/JSDOM functional evidence; no browser or real API',verifiedAt:new Date().toISOString(),results},null,2)+'\n');
console.log('Governance detail vote/decision/conflict-refresh/apply passed in React DOM for all 8 locales.');
