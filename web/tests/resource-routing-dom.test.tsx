import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';

const org='11111111-1111-4111-8111-111111111111', circleId='22222222-2222-4222-8222-222222222222', roleId='33333333-3333-4333-8333-333333333333', documentId='44444444-4444-4444-8444-444444444444';
const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost/platform/search',pretendToBeVisual:true});
for(const key of ['window','document','location','history','localStorage','sessionStorage','navigator','HTMLElement','Element','HTMLDialogElement','HTMLInputElement','MutationObserver','Event','CustomEvent','DOMException','FormData','Node','DOMParser'] as const)Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:(dom.window as any)[key],configurable:true,writable:true});
Object.defineProperty(globalThis,'ResizeObserver',{value:class {observe(){} unobserve(){} disconnect(){}},configurable:true});
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
Object.defineProperty(globalThis,'getComputedStyle',{value:dom.window.getComputedStyle.bind(dom.window),configurable:true});
dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}} as unknown as MediaQueryList);
dom.window.scrollTo=()=>{};dom.window.HTMLElement.prototype.scrollTo=function(){};
dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
registerHooks({load(url,options,next){return url.endsWith('.css')?{format:'module',source:'export {};',shortCircuit:true}:next(url,options);}});
const {App}=await import('../src/App');
const {createRoot}=await import('react-dom/client');
const response=(data:unknown)=>new Response(JSON.stringify({data,meta:{requestId:'test'}}),{headers:{'Content-Type':'application/json'}});

test('search and favorites return to the original role result after opening a restriction in its owning circle',async()=>{
 const nodes=[{nodeId:'circle-node',entityId:circleId,kind:'CIRCLE',name:'Círculo dono',parentNodeId:null},{nodeId:'role-node',entityId:roleId,kind:'ROLE',name:'Mesmo nome',parentNodeId:'circle-node'}];
 const restriction={id:documentId,title:'Restrição vinculada',ownerId:circleId,publishedVersion:1,richContent:{format:'orgmap-richtext',version:1,doc:{type:'doc',content:[{type:'paragraph',content:[{type:'roleMention',attrs:{roleId,label:'Mesmo nome'}}]}]}}};
 globalThis.fetch=async(input)=>{
  const url=String(input);
  if(url==='/api/v1/me')return response({account:{id:'account',email:'test@example.test',displayName:'Ravi'},organizations:[{id:org,name:'Org',memberId:'self',orgRole:'OWNER'}],csrfToken:'csrf'});
  if(url==='/api/v1/account/preferences')return response({preferences:{locale:'pt-BR',timeZone:'America/Sao_Paulo',dateFormat:'DD/MM/YYYY',theme:'light'}});
  if(url.endsWith('/bootstrap'))return response({organization:{id:org,name:'Org',version:1},membership:{id:'self',orgRole:'OWNER',memberType:'MEMBER'},capabilities:{},modules:{structure:true},rootCircleId:circleId});
  if(url.endsWith('/structure'))return response({nodes,circles:[{id:circleId,name:'Círculo dono'}],roles:[{id:roleId,name:'Mesmo nome'}],memberships:[],occupancies:[],coverage:{complete:true}});
  if(url.includes('/members?'))return response({items:[],page:{hasMore:false,nextCursor:null}});
  if(url.endsWith('/entry'))return response({acknowledged:true,destination:'STRUCTURE'});
  if(url.endsWith('/branding/workspace'))return response({asset:{origin:'NONE',revision:0,readUrl:null},appearance:{color:'#0b7077',showOrganizationName:true}});
  if(url.endsWith('/platform/capabilities'))return response({resourceTypes:['role']});
  if(url.includes('/platform/resources/')&&url.endsWith('/capabilities'))return response({actions:{},favorite:false,following:false,exportKinds:[]});
  if(url.includes('/platform/search?'))return response({items:[{type:'role',id:roleId,title:'Mesmo nome'}]});
  if(url.endsWith('/platform/favorites'))return response({items:[{id:'favorite',resourceType:'role',resourceId:roleId,resourceTitle:'Mesmo nome'}]});
  if(url.endsWith('/documents'))return response({items:[restriction],page:{nextCursor:null}});
  if(url.endsWith('/documents/'+documentId))return response({document:restriction,versions:[{number:1,content:'Texto publicado da restrição.'}]});
  if(url.endsWith('/work/projects'))return response({projects:[]});
  return response({items:[],notifications:[],settings:{}});
 };
 try {
  for(const source of ['/platform/search?q=Mesmo+nome&type=role','/platform/favorites']){
   history.replaceState({},'',source);sessionStorage.clear();sessionStorage.setItem('orgmap.activeOrg',org);
   const root=createRoot(document.getElementById('root')!);
   try {
    await act(async()=>root.render(<App/>));
    const focusId='resource-entry-role-'+roleId;
    await act(async()=>document.getElementById(focusId)!.click());
    assert.equal(location.pathname,'/roles/'+roleId);
    await act(async()=>document.querySelector<HTMLButtonElement>('#entity-restrictions button')!.click());
    assert.equal(location.pathname,'/circles/'+circleId);
    assert.equal(new URLSearchParams(location.search).get('document'),documentId);
    assert.match(document.querySelector('aside.mare-entity-drawer')!.textContent!,/Círculo dono.*Restrição vinculada.*Texto publicado/s);
    await act(async()=>document.querySelector<HTMLButtonElement>('aside.mare-entity-drawer button[aria-label="Fechar painel"]')!.click());
    assert.equal(location.pathname,source.split('?')[0]);
    const returned=new URLSearchParams(location.search);
    assert.equal(returned.get('focus'),focusId,'the role result, not the owning circle, receives focus');
    if(source.includes('search')){assert.equal(returned.get('q'),'Mesmo nome');assert.equal(returned.get('type'),'role');}
    assert.equal(document.activeElement,document.getElementById(focusId));
   }finally{await act(async()=>root.unmount());}
  }
 }finally{dom.window.close();}
});
