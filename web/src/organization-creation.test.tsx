import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';

const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://localhost/organizations/new',pretendToBeVisual:true});
for(const key of ['window','document','location','history','localStorage','sessionStorage','navigator','HTMLElement','HTMLDialogElement','HTMLInputElement','MutationObserver','Event','CustomEvent','DOMException','FormData','Node','DOMParser'] as const) Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:(dom.window as any)[key],configurable:true,writable:true});
Object.defineProperty(globalThis,'ResizeObserver',{value:class {observe(){} unobserve(){} disconnect(){}},configurable:true});
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
Object.defineProperty(globalThis,'getComputedStyle',{value:dom.window.getComputedStyle.bind(dom.window),configurable:true});
dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}} as unknown as MediaQueryList);
dom.window.scrollTo=()=>{};
dom.window.HTMLElement.prototype.scrollTo=function(){};
dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
registerHooks({load(url,options,next){return url.endsWith('.css')?{format:'module',source:'export {};',shortCircuit:true}:next(url,options);}});
const {App}=await import('./App');
const {createRoot}=await import('react-dom/client');
const rootElement=document.getElementById('root')!;
const oldId='11111111-1111-4111-8111-111111111111', newId='22222222-2222-4222-8222-222222222222';
const oldOrg={id:oldId,name:'Anterior',memberId:'old-member',orgRole:'OWNER'},newOrg={id:newId,name:'Nova organização',memberId:'new-member',orgRole:'OWNER'};
const button=(label:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent?.trim()===label);
const response=(data:unknown,status=200)=>new Response(JSON.stringify(status===200?{data,meta:{requestId:'test'}}:{error:{code:'NETWORK_TEST',message:'Falha simulada'},meta:{requestId:'test'}}),{status,headers:{'Content-Type':'application/json'}});

test('creation uses returned identity, preserves the receipt across failures and prevents double submission',async()=>{
 for (const prior of [false,true]) {
  history.replaceState({},'', '/organizations/new');sessionStorage.clear();
  let created=false,postCount=0,failPost=true,failMe=false,failBootstrap=false,postGate:()=>void=()=>{};
  const keys:string[]=[];
  const postWait=new Promise<void>(resolve=>{postGate=resolve;});
  const session=()=>({account:{id:'account',email:'test@example.test',displayName:'Teste'},organizations:[...(prior?[oldOrg]:[]),...(created?[newOrg]:[])],csrfToken:'csrf'});
  const bootstrap=(id:string)=>({organization:{id,name:id===newId?newOrg.name:oldOrg.name,version:1},membership:{id:id===newId?'new-member':'old-member',orgRole:'OWNER',memberType:'MEMBER'},capabilities:{},modules:{},rootCircleId:null});
  globalThis.fetch=async(input,init)=>{
   const url=String(input),method=init?.method??'GET';
   if(url==='/api/v1/me'){if(failMe){failMe=false;return response(null,503);}return response(session());}
   if(url==='/api/v1/account/preferences') return response({preferences:{locale:'pt-BR',timeZone:'America/Sao_Paulo',dateFormat:'DD/MM/YYYY',theme:'light'}});
   if(url==='/api/v1/organizations'&&method==='POST'){postCount++;keys.push((init?.headers as Record<string,string>)['Idempotency-Key']);if(failPost){failPost=false;return response(null,503);}await postWait;created=true;failMe=true;return response({organization:newOrg});}
   if(url.endsWith('/bootstrap')){if(url.includes(newId)&&failBootstrap){failBootstrap=false;return response(null,503);}return response(bootstrap(url.includes(newId)?newId:oldId));}
   if(url.endsWith('/structure')) return response({nodes:[],circles:[],roles:[],memberships:[],occupancies:[],coverage:{complete:true,depthLimited:false,degradedReasons:[]}});
   if(url.includes('/members?')) return response({items:[],page:{hasMore:false,nextCursor:null}});
   if(url.endsWith('/entry')) return response({acknowledged:true,destination:'STRUCTURE'});
   if(url.endsWith('/branding/workspace')) return response({asset:{origin:'NONE',revision:0,readUrl:null},appearance:{color:'#0b7077',showOrganizationName:true}});
   return response({items:[],notifications:[],settings:{}});
  };
  const root=createRoot(rootElement);
  try {
   await act(async()=>root.render(<App/>));
   await act(async()=>button('Criar organização')!.click());
   const input=document.querySelector<HTMLInputElement>('input[name="name"]')!;
   await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(input,newOrg.name);input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
   const form=document.querySelector('dialog form')!;
   await act(async()=>form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
   assert.equal(input.value,newOrg.name);assert.equal(location.pathname,'/organizations/new');assert.match(rootElement.textContent!,/Falha simulada/);
   await act(async()=>{form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));postGate();});
   assert.equal(postCount,2);assert.equal(keys[0],keys[1]);assert.match(rootElement.textContent!,/Organização criada/);assert.ok(button('Abrir organização'));
   assert.equal(location.pathname,'/organizations/new');assert.notEqual(sessionStorage.getItem('orgmap.activeOrg'),newId);
   failBootstrap=true;
   await act(async()=>button('Abrir organização')!.click());
   assert.equal(postCount,2);assert.match(rootElement.textContent!,/Organização criada/);assert.equal(location.pathname,'/organizations/new');
   await act(async()=>button('Abrir organização')!.click());
   assert.equal(postCount,2);assert.equal(sessionStorage.getItem('orgmap.activeOrg'),newId);assert.equal(location.pathname,'/structure');
  }finally{await act(async()=>root.unmount());}
 }
});

test('a delayed session refresh cannot reinstall an expired account after creation',async()=>{
 history.replaceState({},'', '/organizations/new');sessionStorage.clear();
 let meCalls=0,bootstrapCalls=0,resolveMe:(value:Response)=>void=()=>{};
 const accountSession={account:{id:'account',email:'test@example.test',displayName:'Teste'},organizations:[],csrfToken:'csrf'};
 globalThis.fetch=async(input,init)=>{
  const url=String(input);
  if(url==='/api/v1/me') {if(++meCalls===1)return response(accountSession);return new Promise<Response>(resolve=>{resolveMe=resolve;});}
  if(url==='/api/v1/account/preferences')return response({preferences:{locale:'pt-BR',timeZone:'America/Sao_Paulo',dateFormat:'DD/MM/YYYY',theme:'light'}});
  if(url==='/api/v1/organizations'&&init?.method==='POST')return response({organization:newOrg});
  if(url.endsWith('/bootstrap'))bootstrapCalls++;
  return response({});
 };
 const root=createRoot(rootElement);
 try{
  await act(async()=>root.render(<App/>));
  await act(async()=>button('Criar organização')!.click());
  const input=document.querySelector<HTMLInputElement>('input[name="name"]')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(input,newOrg.name);input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
  await act(async()=>document.querySelector('dialog form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(meCalls,2);
  await act(async()=>{window.dispatchEvent(new dom.window.Event('orgmap:session-expired'));resolveMe(response({...accountSession,organizations:[newOrg]}));});
  assert.equal(bootstrapCalls,0);assert.equal(sessionStorage.getItem('orgmap.activeOrg'),null);
  assert.equal(location.pathname,'/login');
 }finally{await act(async()=>root.unmount());}
});
