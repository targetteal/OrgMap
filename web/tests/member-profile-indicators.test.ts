import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import React,{act} from 'react';
test('profile panel sends the membership subject to the real consumer, resets by scope and never upgrades Guest',async()=>{
 const dom=new JSDOM('<!doctype html><html><body><main></main></body></html>',{url:'http://profile.localhost/members/membership-self?tab=metrics'});
 const previous=new Map<string,PropertyDescriptor|undefined>();
 for(const key of ['window','document','navigator','HTMLElement','Event','FormData']){previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:(dom.window as any)[key],configurable:true});}
 previous.set('IS_REACT_ACT_ENVIRONMENT',Object.getOwnPropertyDescriptor(globalThis,'IS_REACT_ACT_ENVIRONMENT'));Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
 const {createRoot}=await import('react-dom/client');
 const vite=await createServer({root:new URL('../',import.meta.url).pathname,configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});
 const root=createRoot(document.querySelector('main')!);
 try{
  const {MemberProfileIndicators}=await vite.ssrLoadModule('/src/MemberProfileIndicators.tsx');
  const {LocalizationProvider}=await vite.ssrLoadModule('/src/localization/index.tsx');
  const {RequestError}=await vite.ssrLoadModule('/src/api.ts');
  const paths:string[]=[],navigation:string[]=[];
  const api=async(path:string)=>{paths.push(path);if(path.includes('membership-private'))throw new RequestError('RESOURCE_NOT_FOUND','hidden');return {data:{items:[{id:'metric',version:1,name:path.includes('org-b')?'Métrica B':'Métrica autorizada',kind:'METRIC',valueType:'NUMBER',unit:'horas',requiredUnits:[]},{id:'checklist',version:1,name:'Checklist autorizado',kind:'CHECKLIST',valueType:'BOOLEAN',unit:'item',requiredUnits:[]}],capabilities:{define:false,record:true}}};};
  const context=(organizationId='org-a',memberType='MEMBER')=>({organizationId,bootstrap:{membership:{id:'membership-self',memberType}},session:{account:{id:'different-account-id'}},api,navigate:(path:string)=>navigation.push(path)});
  const render=async(c:any,memberId:string,kind:string)=>{await act(async()=>{root.render(React.createElement(LocalizationProvider,{accountId:'different-account-id',preferences:{locale:'pt-BR'},children:React.createElement(MemberProfileIndicators,{context:c,memberId,kind})}));});};
  await render(context(),'membership-self','METRIC');
  assert.equal(paths[0],'/organizations/org-a/structure-advanced/subjects/member/membership-self/indicators');assert.ok(!paths[0].includes('different-account-id'));
  assert.ok(document.body.textContent?.includes('Métrica autorizada'));assert.ok(!document.body.textContent?.includes('Checklist autorizado'));assert.ok(!document.body.textContent?.includes('Atribuir indicador'));
  const permissions=[...document.querySelectorAll('button')].find(b=>b.textContent==='Permissões dos meus indicadores')!;await act(async()=>permissions.click());assert.deepEqual(navigation,['/my-indicator-permissions']);
  await render(context(),'membership-self','CHECKLIST');assert.ok(document.body.textContent?.includes('Checklist autorizado'));assert.ok(!document.body.textContent?.includes('Métrica autorizada'));
  await render(context('org-b'),'membership-self','METRIC');assert.ok(paths.some(p=>p.includes('/org-b/')));assert.ok(document.body.textContent?.includes('Métrica B'));assert.ok(!document.body.textContent?.includes('Checklist autorizado'));
  await render(context(),'membership-private','METRIC');assert.ok(!document.body.textContent?.includes('Métrica B'));assert.ok(!document.body.textContent?.includes('Permissões dos meus indicadores'));
  const count=paths.length;await render(context('org-a','GUEST'),'membership-self','METRIC');assert.equal(paths.length,count);assert.equal(document.querySelector('main')?.textContent,'');
 }finally{await act(async()=>root.unmount());await vite.close();dom.window.close();for(const [key,descriptor] of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete(globalThis as any)[key];}}
});
