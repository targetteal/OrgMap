import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import React,{act} from 'react';
const dom=new JSDOM('<!doctype html><main></main>',{url:'http://test.localhost'});
for(const k of ['window','document','navigator','HTMLElement','Event'])Object.defineProperty(globalThis,k,{value:k==='window'?dom.window:(dom.window as any)[k],configurable:true});
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
const {createRoot}=await import('react-dom/client');
const vite=await createServer({root:new URL('../',import.meta.url).pathname,configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});
const {MeetingActionStatus}=await vite.ssrLoadModule('/src/features/meetings/index.tsx');
const {Collections}=await vite.ssrLoadModule('/src/features/platform/index.tsx');
const {LocalizationProvider}=await vite.ssrLoadModule('/src/localization/index.tsx');
const el=document.querySelector('main')!;
test.after(async()=>{await vite.close();dom.window.close();});
test('external output is registered, while local action keeps its own state',async()=>{
 const root=createRoot(el);try{await act(async()=>root.render(<LocalizationProvider preferences={{locale:'pt-BR'}}><div><MeetingActionStatus action={{targetKind:'PROPOSAL',targetId:'id',state:'OPEN'}}/><MeetingActionStatus action={{state:'OPEN'}}/><MeetingActionStatus action={{state:'DONE'}}/></div></LocalizationProvider>));assert.equal(el.textContent,'Registrada no móduloPendenteConcluída');}finally{await act(async()=>root.unmount());}
});
test('proposal notifications show authorized titles or fallback and navigate to proposal',async()=>{
 const id='11111111-1111-4111-8111-111111111111', routes:string[]=[];
 const context={organizationId:'org',bootstrap:{membership:{id:'m',memberType:'MEMBER'}},navigate:(p:string)=>routes.push(p),api:async()=>({data:{items:[{id:'a',event:'ProposalSubmitted',resourceType:'proposal',resourceId:id,resourceTitle:'Política <segura>',readAt:'now'},{id:'b',event:'ProposalDecided',resourceType:'proposal',resourceId:id,resourceTitle:null,readAt:'now'}]}})};
 const root=createRoot(el);try{await act(async()=>root.render(<LocalizationProvider preferences={{locale:'pt-BR'}}><Collections context={context}/></LocalizationProvider>));const buttons=[...el.querySelectorAll('.platform-notification-open')];assert.equal(buttons[0].textContent,'Proposta aberta para decisão · Política <segura>');assert.equal(buttons[1].textContent,'Decisão da proposta registrada');assert.equal(el.querySelector('segura'),null);await act(async()=>buttons[0].click());assert.equal(routes[0],'/structure/proposals/'+id);}finally{await act(async()=>root.unmount());}
});

test('notification list shows workspace context and exposes its own event controls without marking on load',async()=>{
 const id='11111111-1111-4111-8111-111111111111',organization='22222222-2222-4222-8222-222222222222',routes:string[]=[];let posts=0;
 const preference='/platform/preferences?organizationId='+organization+'&event=ProposalDecided';
 const context={organizationId:organization,bootstrap:{organization:{id:organization},membership:{id:'m',memberType:'MEMBER'}},navigate:(p:string)=>routes.push(p),api:async(_path:string,options:any={})=>{if(options.method==='POST')posts++;return{data:{locale:'es-ES',items:[{id:'delivery',event:'ProposalDecided',resourceType:'proposal',resourceId:id,presentation:{locale:'es-ES',heading:'La propuesta tiene una decisión',resourceTitle:'Política <segura>',summary:'La decisión quedó registrada.',actorName:'Joana',occurredAt:'2026-11-17T12:00:00Z',details:[{label:'Decisión',value:'Aprobada'}],destination:'/structure/proposals/'+id+'?organizationId='+organization,preferencesDestination:preference}}]}};}};
 const root=createRoot(el);
 try {
  await act(async()=>root.render(<LocalizationProvider preferences={{locale:'pt-BR'}}><Collections context={context}/></LocalizationProvider>));
  assert.equal(el.querySelector('h1')?.textContent,'Notificaciones');assert.match(el.textContent??'',/La decisión quedó registrada/);assert.match(el.textContent??'',/Por Joana/);assert.match(el.textContent??'',/DecisiónAprobada/);assert.equal(el.querySelector('segura'),null);assert.equal(posts,0);
  const manage=[...el.querySelectorAll('button')].find(button=>button.textContent==='Gestionar estos avisos')!;await act(async()=>manage.click());assert.equal(routes[0],preference);assert.equal(posts,0);
  await act(async()=>el.querySelector<HTMLButtonElement>('.platform-notification-open')!.click());assert.equal(posts,1);assert.equal(routes[1],'/structure/proposals/'+id+'?organizationId='+organization);
 }finally{await act(async()=>root.unmount());}
});
