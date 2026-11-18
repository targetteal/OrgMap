import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {governanceFormTranslator} from './form-messages';
import {governanceDetailTranslator} from './detail-messages';
import {governanceListTranslator} from './list-messages';
import type {FeatureContext} from '../../feature-contract';
const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://governance.localhost',pretendToBeVisual:true});
for(const key of ['window','document','navigator','Node','Element','HTMLElement','HTMLInputElement','HTMLFormElement','FormData','DOMParser','MutationObserver','Event','MouseEvent','KeyboardEvent','DOMException','getComputedStyle','requestAnimationFrame','cancelAnimationFrame'] as const)Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:(dom.window as any)[key],configurable:true});
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
const {createRoot}=await import('react-dom/client');
const {LocalizationProvider}=await import('../../localization');
const {feature}=await import('./index');
const Component=feature.Component,container=dom.window.document.getElementById('root')!;
const circle='00000000-0000-4000-8000-000000000001',role='00000000-0000-4000-8000-000000000002',created='00000000-0000-4000-8000-000000000003';
const rich={format:'orgmap-richtext',version:1,doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Fixture rich purpose',marks:[{type:'bold'}]}]}]}};
const results:unknown[]=[];
for(const locale of ['pt-BR','en-US','es-ES','fr-FR','de-DE','it-IT','ja-JP','nl-NL'])for(const mode of ['rename','tension','agreement'] as const){
 const f=governanceFormTranslator(locale),d=governanceDetailTranslator(locale),ui=governanceListTranslator(locale),writes:any[]=[],navigations:string[]=[];
 const section=mode==='rename'?'proposals':mode==='tension'?'tensions':'documents';
 const context={organizationId:'org',path:mode==='agreement'?'/structure/working-agreements':'/structure/'+section,bootstrap:{membership:{id:'actor',memberType:'MEMBER',orgRole:'OWNER'},capabilities:{'structure.direct':true},rootCircleId:circle},structure:{nodes:[{entityId:circle,name:'Fixture Circle',kind:'CIRCLE',version:1},{entityId:role,name:'Fixture Role',kind:'ROLE',version:3}],circles:[{id:circle,purpose:''}],roles:[{id:role,purpose:'Fixture rich purpose',purposeRich:rich}],memberships:[],occupancies:[]},members:[],session:{},navigate:(p:string)=>navigations.push(p),notify:()=>{},refresh:()=>{},api:async(path:string,options:any={})=>{
  if(options.method==='POST'){writes.push({path,body:options.body,version:options.version});return {data:{id:created,version:1}};}
  assert.ok(path.endsWith('/proposals')||path.endsWith('/tensions')||path.endsWith('/documents')||path.endsWith('/document-types'));return {data:{items:[],page:{nextCursor:null}}};
 }} as unknown as FeatureContext;
 const root=createRoot(container);
 await act(async()=>root.render(<LocalizationProvider preferences={{locale}}><Component context={context}/></LocalizationProvider>));
 const button=(name:string,scope:ParentNode=container)=>{const b=[...scope.querySelectorAll('button')].find(el=>el.textContent?.trim()===name);assert.ok(b,'Missing '+locale+' '+mode+' '+name);return b;};
 await act(async()=>button(d(mode==='rename'?'addProposal':mode==='tension'?'addTension':'addAgreement')).click());
 const dialog=container.querySelector('dialog')!;assert.ok(dialog);
 const input=dialog.querySelector<HTMLInputElement>('input[name="title"]')!;assert.ok(input);input.value='Fixture '+mode;
 const field=(name:string,selector:string)=>{const label=[...dialog.querySelectorAll('label')].find(el=>el.querySelector(':scope > span')?.textContent===name);assert.ok(label,'Missing field '+name);const el=label.querySelector(selector);assert.ok(el);return el;};
 if(mode==='rename'){
  await act(async()=>button(f('create'),dialog).click());assert.ok(dialog.textContent?.includes(f('changeRequired')));assert.equal(writes.length,0);
  if(locale==='en-US'){
   await act(async()=>root.render(<LocalizationProvider preferences={{locale:'ja-JP'}}><Component context={context}/></LocalizationProvider>));
   assert.ok(dialog.querySelector('[role="alert"]')?.textContent?.includes(governanceFormTranslator('ja-JP')('changeRequired')));assert.equal(input.value,'Fixture rename');
   await act(async()=>root.render(<LocalizationProvider preferences={{locale}}><Component context={context}/></LocalizationProvider>));
  }
  const select=field(f('entity'),'select') as HTMLSelectElement;
  await act(async()=>{select.value=role;select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  assert.equal(dialog.querySelector('.tiptap strong')?.textContent,'Fixture rich purpose');
  const name=field(f('name'),'input') as HTMLInputElement;
  await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(name,'Renamed role');name.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
  await act(async()=>button(f('addChange'),dialog).click());await act(async()=>button(f('create'),dialog).click());
  assert.deepEqual(writes[0].body,{title:'Fixture rename',circleId:circle,kind:'GOVERNANCE',payload:{changes:[{kind:'UPDATE',entityId:role,baseVersion:3,name:'Renamed role'}]}});
  assert.equal(navigations[0],'/structure/proposals/'+created);
 }else if(mode==='tension'){
  input.value='x'.repeat(201);await act(async()=>button(f('create'),dialog).click());assert.ok(dialog.textContent?.includes(f('titleInvalid')));assert.equal(writes.length,0);
  input.value='Fixture tension';await act(async()=>button(f('create'),dialog).click());assert.deepEqual(writes[0].body,{title:'Fixture tension',circleId:circle,description:''});
 }else{
  assert.ok(dialog.textContent?.includes(f('noType')));assert.ok(dialog.querySelector('label')?.textContent?.includes(ui('title')));
  const workflow=dialog.querySelector<HTMLSelectElement>('select[name="workflow"]')!,visibility=dialog.querySelector<HTMLSelectElement>('select[name="visibility"]')!;
  workflow.value='GOVERNANCE';visibility.value='AUTHOR';await act(async()=>button(f('create'),dialog).click());
  assert.deepEqual(writes[0].body,{title:'Fixture agreement',ownerId:circle,workflow:'GOVERNANCE',visibility:'AUTHOR',content:''});
 }
 assert.equal(writes.length,1);assert.equal(container.querySelector('dialog'),null);
 results.push({locale,mode,fixture:true,checks:mode==='rename'?['localized labels','localized validation','rich purpose loaded','name-only payload preserves purpose by omission','detail navigation']:mode==='tension'?['localized title validation','no mutation on invalid title','title retry','legacy empty-description payload']:['localized agreement controls','publication method and visibility payload'],writes});
 await act(async()=>root.unmount());
}
await writeFile('web/src/features/governance/evidence/form-localization-dom.json',JSON.stringify({kind:'React/JSDOM with explicit fixtures; no real API/browser',verifiedAt:new Date().toISOString(),results},null,2)+'\n');
dom.window.close();console.log('Governance create/rename/tension/agreement forms passed in DOM for all 8 locales.');
