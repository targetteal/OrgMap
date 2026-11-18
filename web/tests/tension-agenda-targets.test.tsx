import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';import {createServer} from 'vite';import React,{act} from 'react';
const dom=new JSDOM('<!doctype html><main></main>',{url:'http://test.localhost'});for(const k of ['window','document','navigator','HTMLElement','Event'])Object.defineProperty(globalThis,k,{value:k==='window'?dom.window:(dom.window as any)[k],configurable:true});Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
const {createRoot}=await import('react-dom/client');const vite=await createServer({root:new URL('../',import.meta.url).pathname,configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});const {AgendaForm}=await vite.ssrLoadModule('/src/features/governance/index.tsx');const {LocalizationProvider}=await vite.ssrLoadModule('/src/localization/index.tsx');const el=document.querySelector('main')!;test.after(async()=>{await vite.close();dom.window.close();});
const meeting=(version:number)=>({id:'meeting',circleId:'circle',title:'Reunião',state:'RUNNING',startAt:'2026-10-30T12:00:00Z',version,method:'HOLACRACY'});
const context=(api:any,org='org',member='member')=>({organizationId:org,session:{account:{id:'account'}},bootstrap:{membership:{id:member,orgRole:'MEMBER',memberType:'MEMBER'},authorizationRevision:1},api});
const tension={id:'tension',circleId:'circle',title:'Tensão'};
const button=(text:string)=>{const b=[...el.querySelectorAll('button')].find(x=>x.textContent?.trim()===text);assert.ok(b,text);return b;};
async function choose(){const s=el.querySelector('select')!;await act(async()=>{s.value='meeting';s.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});}
test('lista autorizada permite envio, atualiza versão e ignora resposta tardia de outro escopo',async()=>{
 let resolveOld!:(v:any)=>void,oldSignal:AbortSignal|undefined,revision=1;const paths:string[]=[],sent:any[]=[];
 const api=async(path:string,opts:any)=>{paths.push(path);if(path.includes('/organizations/old/')){oldSignal=opts.signal;return new Promise(r=>{resolveOld=r;});}return {data:{items:[meeting(revision)],page:{nextCursor:null}}};};
 const root=createRoot(el), render=(c:any,t:any=tension)=><LocalizationProvider preferences={{locale:'pt-BR'}}><AgendaForm c={c} tension={t} disabled={false} error="" onSubmit={async(v:any)=>sent.push(v)}/></LocalizationProvider>;
 try{
  await act(async()=>root.render(render(context(api))));await choose();await act(async()=>el.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));assert.deepEqual(sent,[{meetingId:'meeting',meetingVersion:1}]);
  revision=2;await act(async()=>button('Atualizar reunião').click());await act(async()=>el.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));assert.equal(sent[1].meetingVersion,2);
  await act(async()=>root.render(render(context(api,'old'))));await act(async()=>root.render(render(context(api,'new','other'),{...tension,id:'other-tension',circleId:'other-circle'})));assert.equal(oldSignal?.aborted,true);await act(async()=>resolveOld({data:{items:[{...meeting(9),title:'Resposta antiga'}]}}));assert.doesNotMatch(el.textContent!,/Resposta antiga/);assert.ok(paths.every(p=>p.includes('/tensions/')&&p.includes('/agenda-meetings')));
 }finally{await act(async()=>root.unmount());}
});
