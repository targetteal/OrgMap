import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import React,{act} from 'react';
import {setTimeout as delay} from 'node:timers/promises';

const dom = new JSDOM('<!doctype html><main></main>',{url:'http://qa.localhost'});
for (const key of ['window','document','navigator','HTMLElement','HTMLInputElement','HTMLDialogElement','Event','FormData','MutationObserver'])
  Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:(dom.window as any)[key],configurable:true});
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'));};
const {createRoot} = await import('react-dom/client');
const vite = await createServer({root:new URL('../',import.meta.url).pathname,configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});
const {feature} = await vite.ssrLoadModule('/src/features/governance/index.tsx');
const {LocalizationProvider} = await vite.ssrLoadModule('/src/localization/index.tsx');
const {RequestError} = await vite.ssrLoadModule('/src/api.ts');
test.after(async()=>{await vite.close();dom.window.close();});
const pid='00000000-0000-4000-8000-000000000001', circle='00000000-0000-4000-8000-000000000002', meeting='00000000-0000-4000-8000-000000000003';
const container=document.querySelector('main')!;
const component=feature.Component;
const baseProposal={id:pid,circleId:circle,authorId:'actor',title:'Proposta de teste',kind:'GOVERNANCE',state:'DRAFT',version:1,revision:1,canEdit:false,consentMeetingId:meeting,consentMeetingVersion:4,meetingConsentRequired:true};
function context(detail:any,calls:any[]){return {organizationId:'org',path:'/structure/proposals/'+pid,session:{account:{id:'account'}},bootstrap:{organization:{id:'org',name:'Organization'},membership:{id:'actor',memberType:'MEMBER',orgRole:'MEMBER'},capabilities:{},rootCircleId:circle,modules:{}},structure:{nodes:[{entityId:circle,name:'Círculo',kind:'CIRCLE'}],circles:[],roles:[],memberships:[],occupancies:[]},members:[{id:'actor',displayName:'Secretária'}],navigate(){},notify(){},refresh(){},api:async(path:string,options:any={})=>{if(options.method==='POST'){calls.push({path,options});return {data:{}};}if(path.endsWith('/proposals/'+pid))return {data:detail};return {data:{items:path.endsWith('/proposals')?[detail.proposal]:[],page:{nextCursor:null},origin:null}};}};}
function button(label:string,scope:ParentNode=container){const found=[...scope.querySelectorAll('button')].find(b=>b.textContent?.trim()===label);assert.ok(found,`Missing button: ${label}`);return found;}

test('secretary reviews the exact version and explicitly confirms before recording consent',async()=>{
 const calls:any[]=[],detail={proposal:baseProposal,revisions:[{number:1,payload:{documents:[{documentId:'doc',documentVersion:1}]}}],meetingDocument:{title:'Política proposta',number:1,content:'Conteúdo da política',richContent:null},meetingDocuments:[{documentId:'doc',title:'Política proposta',number:1,content:'Conteúdo da política',richContent:null,proposalRevision:1}],rounds:[],ballots:[],objections:[],nominations:[],commits:[],history:[]};
 const Component=component,root=createRoot(container);
 try{
  await act(async()=>root.render(<LocalizationProvider preferences={{locale:'pt-BR'}}><Component context={context(detail,calls)}/></LocalizationProvider>));
  assert.match(container.textContent!,/Conteúdo da política/);
  assert.match(container.textContent!,/secretaria atuante registra/);
  await act(async()=>button('Registrar consentimento da reunião').click());
  const dialog=container.querySelector('dialog')!;
  assert.match(dialog.textContent!,/sem objeções pendentes/);
  const checkbox=dialog.querySelector<HTMLInputElement>('input[name="confirmed"]')!;
  assert.equal(checkbox.required,true);
  await act(async()=>{checkbox.checked=true;checkbox.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  const reason=dialog.querySelector<HTMLTextAreaElement>('textarea[name="reason"]')!;reason.value='Sem objeções';
  await act(async()=>button('Registrar e efetivar',dialog).click());
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].options.body,{meetingVersion:4,revision:1,confirmed:true,reason:'Sem objeções'});
  assert.equal(calls[0].options.version,1);
 }finally{await act(async()=>root.unmount());}
});

test('draft editing keeps typing during a save and retains the local change after a version conflict',async()=>{
 const change={kind:'CREATE',entityId:'role',entityKind:'ROLE',parentCircleId:circle,name:'Papel inicial',purpose:''};
 const initial={...baseProposal,kind:'GOVERNANCE',canAmend:true};
 const snapshot=(version:number,name:string)=>({proposal:{...initial,version,revision:version},revisions:[{number:version,payload:{changes:[{...change,name}]}}],rounds:[],ballots:[],objections:[],nominations:[],commits:[],history:[]});
 let detail=snapshot(1,'Papel inicial');
 const writes:any[]=[];
 let firstSave!:(response:any)=>void;
 let guard:()=>string|null=()=>null;
 const c=context(detail,[]);
 c.api=async(path:string,options:any={})=>{
  if(options.method==='POST'){
   writes.push(options);
   if(writes.length===1)return new Promise(resolve=>{firstSave=resolve;});
   throw new RequestError('VERSION_CONFLICT','A versão mudou.');
  }
  if(path.endsWith('/proposals/'+pid))return {data:detail};
  return {data:{items:[],page:{nextCursor:null},origin:null}};
 };
 Object.assign(c,{registerNavigationGuard:(fn:()=>string|null)=>{guard=fn;return()=>{guard=()=>null;};}});
 const Component=component,root=createRoot(container);
 const nameInput=()=>container.querySelector<HTMLInputElement>('.gov-inline-change input')!;
 async function typeName(value:string){await act(async()=>{
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(nameInput(),value);
  nameInput().dispatchEvent(new dom.window.Event('input',{bubbles:true}));
 });}
 try{
  await act(async()=>root.render(<LocalizationProvider preferences={{locale:'pt-BR'}}><Component context={c}/></LocalizationProvider>));
  await act(async()=>button('Editar proposta').click());
  assert.equal(button('Registrar consentimento da reunião').disabled,true);
  await act(async()=>{await delay(950);});
  assert.equal(writes.length,0);
  await typeName('Primeira alteração');
  await act(async()=>{await delay(950);});
  assert.equal(writes[0].version,1);
  assert.equal(writes[0].body.payload.changes[0].name,'Primeira alteração');
  assert.match(guard()!,/aguardando salvamento/);
  await typeName('Alteração durante a gravação');
  detail=snapshot(2,'Primeira alteração');
  await act(async()=>firstSave({data:detail.proposal}));
  assert.equal(nameInput().value,'Alteração durante a gravação');
  await act(async()=>{await delay(950);});
  assert.equal(writes[1].version,2);
  assert.notEqual(writes[1].key,writes[0].key);
  assert.equal(writes[1].body.payload.changes[0].name,'Alteração durante a gravação');
  assert.equal(nameInput().value,'Alteração durante a gravação');
  assert.match(container.textContent!,/Outra revisão foi registrada/);
  assert.equal(button('Concluir edição').disabled,true);
 }finally{await act(async()=>root.unmount());}
});
