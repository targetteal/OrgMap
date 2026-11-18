import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import React,{act} from 'react';
const dom=new JSDOM('<!doctype html><main></main>',{url:'http://qa.localhost'});
for(const key of ['window','document','navigator','HTMLElement','Event'])Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:(dom.window as any)[key],configurable:true});
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
const {createRoot}=await import('react-dom/client');
const vite=await createServer({root:new URL('../',import.meta.url).pathname,configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});
const {MemberProfileContent}=await vite.ssrLoadModule('/src/MemberProfileContent.tsx');
test.after(async()=>{await vite.close();dom.window.close();});
test('profile distinguishes status, type and access without duplicate summary or owner self-edit',async()=>{
 const root=createRoot(document.querySelector('main')!);
 const structure={nodes:[],memberships:[],occupancies:[],coverage:{complete:true}};
 const render=(member:any,guest=false)=>act(async()=>root.render(<MemberProfileContent member={member} structure={structure} context={null} path={'/members/'+member.id} guest={guest} owner={true} currentMemberId="self" navigate={()=>{}} onEdit={()=>{}}/>));
 try{
  for(const [member,type,access] of [
   [{id:'member',displayName:'Membro',status:'ACTIVE',memberType:'MEMBER',orgRole:'MEMBER'},'Membro','Membro'],
   [{id:'guest',displayName:'Convidada',status:'SUSPENDED',memberType:'GUEST',orgRole:'MEMBER'},'Convidado','Membro'],
   [{id:'self',displayName:'Proprietário',status:'ACTIVE',memberType:'MEMBER',orgRole:'OWNER'},'Membro','Proprietário'],
  ] as any[]){
   await render(member);
   const identity=document.querySelector('.mare-profile-identity')!;assert.equal(identity.querySelector('p')?.textContent,member.status==='ACTIVE'?'Ativo':'Suspenso');
   const details=[...document.querySelectorAll('.mare-profile-details div')];
   assert.equal(details.find(row=>row.querySelector('dt')?.textContent==='Tipo')?.querySelector('dd')?.textContent,type);
   assert.equal(details.find(row=>row.querySelector('dt')?.textContent==='Acesso')?.querySelector('dd')?.textContent,access);
   assert.equal(!![...identity.querySelectorAll('button')].find(b=>b.textContent==='Alterar acesso'),member.id!=='self');
  }
  await render({id:'member',displayName:'Membro',status:'ACTIVE',memberType:'MEMBER',orgRole:'MEMBER'},true);
  assert.equal(document.querySelector('.mare-profile-details'),null);assert.equal(document.querySelector('.mare-profile-identity p'),null);
 }finally{await act(async()=>root.unmount());}
});
