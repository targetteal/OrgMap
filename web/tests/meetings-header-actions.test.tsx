import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import React,{act} from 'react';

const dom=new JSDOM('<!doctype html><main></main>',{url:'http://qa.localhost/structure'});
for(const key of ['window','document','navigator','HTMLElement','Node','Event','KeyboardEvent'])
 Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:(dom.window as any)[key],configurable:true});
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
const {createRoot}=await import('react-dom/client');
const vite=await createServer({root:new URL('../',import.meta.url).pathname,configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});
const {MeetingsHeaderActions}=await vite.ssrLoadModule('/src/features/meetings/header-actions.tsx');
const {LocalizationProvider}=await vite.ssrLoadModule('/src/localization/index.tsx');
const container=document.querySelector('main')!;
test.after(async()=>{await vite.close();dom.window.close();});

const first='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222';
const meeting=(id:string,title:string,extra:Record<string,unknown>={})=>({id,title,circleId:'circle',startAt:'2026-11-13T15:00:00Z',isParticipant:true,...extra});
const context=(api:any,extra:any={})=>({organizationId:'org-a',path:'/structure',session:{account:{id:'account'}},bootstrap:{membership:{id:'member',memberType:'MEMBER',orgRole:'MEMBER'},authorizationRevision:1,modules:{meetings:true}},structure:{nodes:[{kind:'CIRCLE',entityId:'circle',name:'Produto'}]},members:[],api,navigate(){},...extra});
const render=(root:any,value:any)=>act(async()=>root.render(<LocalizationProvider preferences={{locale:'pt-BR',timeZone:'UTC'}}><MeetingsHeaderActions context={value}/></LocalizationProvider>));
function deferred(){let resolve!:(value:any)=>void;const promise=new Promise<any>(done=>{resolve=done;});return{promise,resolve};}

// The header is available away from the meeting area and joins its canonical route.
test('one participating running meeting joins directly and ignores unrelated meetings',async()=>{
 const paths:string[]=[],navigations:string[]=[],root=createRoot(container);
 const api=async(path:string)=>{paths.push(path);return{data:{items:[meeting(first,'Revisar prioridades'),meeting(second,'Reunião alheia',{isParticipant:false,facilitatorId:'another',notetakerId:'another'})]}};};
 try{
  await render(root,context(api,{navigate:(path:string)=>navigations.push(path)}));
  assert.equal(paths.length,1);
  const query=new URL(paths[0],'http://qa.localhost');
  assert.equal(query.pathname,'/organizations/org-a/meetings');
  assert.equal(query.searchParams.get('state'),'RUNNING');
  const join=container.querySelector<HTMLButtonElement>('button[aria-label="Reunião em andamento: Revisar prioridades"]');
  assert.ok(join,'a named running meeting action is available in the header');
  assert.equal(container.querySelector('[role="dialog"]'),null);
  assert.equal(container.textContent?.includes('Reunião alheia'),false);
  await act(async()=>join.click());
  assert.deepEqual(navigations,['/meetings/'+first]);
 }finally{await act(async()=>root.unmount());}
});

test('multiple meetings open an accessible picker; Escape restores focus and selection joins',async()=>{
 const navigations:string[]=[],root=createRoot(container);
 const api=async()=>({data:{items:[meeting(first,'Condução',{isParticipant:false,facilitatorId:'member'}),meeting(second,'Registro',{isParticipant:false,notetakerId:'member'})]}});
 try{
  await render(root,context(api,{navigate:(path:string)=>navigations.push(path)}));
  const trigger=container.querySelector<HTMLButtonElement>('button[aria-label="Reuniões em andamento"]')!;
  assert.ok(trigger);
  trigger.focus();
  await act(async()=>trigger.click());
  const picker=container.querySelector<HTMLElement>('[role="dialog"]')!;
  assert.ok(picker);
  assert.equal(trigger.getAttribute('aria-expanded'),'true');
  assert.equal(document.getElementById(picker.getAttribute('aria-labelledby')!)?.textContent,'Reuniões em andamento');
  assert.match(picker.textContent!,/Condução/);
  assert.match(picker.textContent!,/Registro/);
  assert.match(picker.textContent!,/Produto/);
  const choices=[...picker.querySelectorAll<HTMLButtonElement>('button')].filter(button=>button.textContent?.includes('Entrar na reunião'));
  assert.equal(choices.length,2);
  choices[0].focus();
  await act(async()=>document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
  assert.equal(container.querySelector('[role="dialog"]'),null);
  assert.equal(trigger.getAttribute('aria-expanded'),'false');
  assert.equal(document.activeElement,trigger);
  assert.deepEqual(navigations,[]);
  await act(async()=>trigger.click());
  const chosen=[...container.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button=>button.textContent?.includes('Registro'))!;
  await act(async()=>chosen.click());
  assert.deepEqual(navigations,['/meetings/'+second]);
  assert.equal(container.querySelector('[role="dialog"]'),null);
 }finally{await act(async()=>root.unmount());}
});

test('organization switch hides loaded names immediately and rejects a late old response',async()=>{
 const oldRefresh=deferred(),newOrganization=deferred(),signals:AbortSignal[]=[],root=createRoot(container);
 const initial=async()=>({data:{items:[meeting(first,'Nome antigo carregado'),meeting(second,'Outra reunião antiga')]}});
 const pending=async(path:string,options:any)=>{signals.push(options.signal);return path.includes('/org-a/')?oldRefresh.promise:newOrganization.promise;};
 try{
  await render(root,context(initial));
  const trigger=container.querySelector<HTMLButtonElement>('button[aria-label="Reuniões em andamento"]')!;
  await act(async()=>trigger.click());
  assert.match(container.textContent!,/Nome antigo carregado/);
  // A new request is in flight in the old organization when the user switches.
  await render(root,context(pending));
  await render(root,context(pending,{organizationId:'org-b'}));
  assert.equal(signals[0].aborted,true);
  assert.equal(container.querySelector('button'),null,'the old organization indicator is hidden while the new one loads');
  assert.equal(container.querySelector('[role="dialog"]'),null);
  await act(async()=>oldRefresh.resolve({data:{items:[meeting(first,'Resposta antiga tardia')]}}));
  assert.doesNotMatch(container.innerHTML,/Nome antigo|reunião antiga|Resposta antiga/);
  await act(async()=>newOrganization.resolve({data:{items:[meeting(second,'Encontro da nova organização')]}}));
  assert.ok(container.querySelector('button[aria-label="Reunião em andamento: Encontro da nova organização"]'));
  assert.doesNotMatch(container.innerHTML,/Nome antigo|Resposta antiga/);
 }finally{await act(async()=>root.unmount());}
});

test('account or authorization change hides previously loaded meetings until revalidated',async()=>{
 for(const changed of [{session:{account:{id:'other-account'}}},{bootstrap:{membership:{id:'member',memberType:'MEMBER',orgRole:'MEMBER'},authorizationRevision:2,modules:{meetings:true}}}]){
  const next=deferred(),root=createRoot(container);
  let requests=0;
  const api=async()=>++requests===1?{data:{items:[meeting(first,'Antes da mudança de acesso')]}}:next.promise;
  try{
   await render(root,context(api));
   assert.ok(container.querySelector('button[aria-label="Reunião em andamento: Antes da mudança de acesso"]'));
   await render(root,context(api,changed));
   assert.equal(requests,2);
   assert.equal(container.querySelector('button'),null);
   assert.doesNotMatch(container.innerHTML,/Antes da mudança/);
   await act(async()=>next.resolve({data:{items:[]}}));
   assert.equal(container.querySelector('button'),null);
  }finally{await act(async()=>root.unmount());}
 }
});
