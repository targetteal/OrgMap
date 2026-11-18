import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
const org='11111111-1111-4111-8111-111111111111', target='22222222-2222-4222-8222-222222222222';
const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost/members/'+target,pretendToBeVisual:true});
for(const key of ['window','document','location','history','localStorage','sessionStorage','navigator','HTMLElement','HTMLDialogElement','HTMLInputElement','MutationObserver','Event','CustomEvent','DOMException','FormData','Node','DOMParser'] as const)Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:(dom.window as any)[key],configurable:true,writable:true});
Object.defineProperty(globalThis,'ResizeObserver',{value:class {observe(){} unobserve(){} disconnect(){}},configurable:true});
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
Object.defineProperty(globalThis,'getComputedStyle',{value:dom.window.getComputedStyle.bind(dom.window),configurable:true});
dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}} as unknown as MediaQueryList);dom.window.scrollTo=()=>{};dom.window.HTMLElement.prototype.scrollTo=function(){};
dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
registerHooks({load(url,options,next){return url.endsWith('.css')?{format:'module',source:'export {};',shortCircuit:true}:next(url,options);}});
const {App}=await import('./App');const {createRoot}=await import('react-dom/client');
const response=(data:unknown,status=200,code='NETWORK_TEST')=>new Response(JSON.stringify(status===200?{data,meta:{requestId:'test'}}:{error:{code,message:code},meta:{requestId:'test'}}),{status,headers:{'Content-Type':'application/json'}});
test('member access dialog identifies target, explains suspension, cancels and preserves version-conflict feedback',async()=>{
 sessionStorage.setItem('orgmap.activeOrg',org);let patches=0;let sentVersion='';
 const member={id:target,displayName:'Iara Costa',status:'ACTIVE',memberType:'MEMBER',orgRole:'MEMBER',version:7};
 globalThis.fetch=async(input,init)=>{
  const url=String(input),method=init?.method??'GET';
  if(url==='/api/v1/me')return response({account:{id:'account',email:'test@example.test',displayName:'Ravi'},organizations:[{id:org,name:'Org',memberId:'self',orgRole:'OWNER'}],csrfToken:'csrf'});
  if(url==='/api/v1/account/preferences')return response({preferences:{locale:'pt-BR',timeZone:'America/Sao_Paulo',dateFormat:'DD/MM/YYYY',theme:'light'}});
  if(url.endsWith('/bootstrap'))return response({organization:{id:org,name:'Org',version:1},membership:{id:'self',orgRole:'OWNER',memberType:'MEMBER'},capabilities:{'structure.direct':true},modules:{},rootCircleId:null});
  if(url.endsWith('/structure'))return response({nodes:[],circles:[],roles:[],memberships:[],occupancies:[],coverage:{complete:true}});
  if(url.includes('/members?'))return response({items:[member],page:{hasMore:false,nextCursor:null}});
  if(url.endsWith('/members/'+target)&&method==='PATCH'){patches++;sentVersion=(init?.headers as Record<string,string>)['If-Match'];return response(null,409,'VERSION_CONFLICT');}
  if(url.endsWith('/entry'))return response({acknowledged:true,destination:'STRUCTURE'});
  if(url.endsWith('/branding/workspace'))return response({asset:{origin:'NONE',revision:0,readUrl:null},appearance:{color:'#0b7077',showOrganizationName:true}});
  return response({items:[],notifications:[],settings:{}});
 };
 const root=createRoot(document.getElementById('root')!);
 const button=(name:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(item=>item.textContent?.trim()===name);
 try{
  await act(async()=>root.render(<App/>));
  assert.ok(button('Alterar acesso'));await act(async()=>button('Alterar acesso')!.click());
  let dialog=document.querySelector<HTMLDialogElement>('dialog[open]')!;assert.ok(dialog);
  assert.match(dialog.textContent!,/Alterar acesso de Iara Costa/);assert.match(dialog.textContent!,/Estado atual de Iara Costa: Ativo/);assert.match(dialog.textContent!,/perde o acesso à organização até que seja reativada/);
  assert.equal(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent,'Alterar acesso de Iara Costa');
  await act(async()=>button('Cancelar')!.click());assert.equal(patches,0);
  await act(async()=>button('Alterar acesso')!.click());dialog=document.querySelector('dialog[open]')!;
  const select=dialog.querySelector<HTMLSelectElement>('select[name=status]')!;select.value='SUSPENDED';
  await act(async()=>dialog.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(patches,1);assert.equal(sentVersion,'"7"');assert.match(dialog.textContent!,/Feche este formulário, atualize a página/);assert.equal(select.value,'SUSPENDED');
 }finally{await act(async()=>root.unmount());dom.window.close();}
});
