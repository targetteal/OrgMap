import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import type {FeatureContext} from '../../feature-contract';
import {TaskAssignmentsEditor,TaskAssigneesView} from './task-assignments';

const dom=new JSDOM('<!doctype html><body><main></main></body>',{url:'http://localhost',pretendToBeVisual:true});
for(const key of ['window','document','navigator','HTMLElement','HTMLSelectElement','Event','FormData','Node'])Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:(dom.window as any)[key],configurable:true});
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
const {createRoot}=await import('react-dom/client');
test('assignment choices disambiguate roles while preserving selected role identifiers and capacity',async()=>{
 const nodes=[{nodeId:'c1',entityId:'circle-1',kind:'CIRCLE',name:'Pesquisa',parentNodeId:null},{nodeId:'c2',entityId:'circle-2',kind:'CIRCLE',name:'Operações',parentNodeId:null},{nodeId:'r1',entityId:'role-1',kind:'ROLE',name:'Facilitação',parentNodeId:'c1'},{nodeId:'r2',entityId:'role-2',kind:'ROLE',name:'Facilitação',parentNodeId:'c2'}];
 const context={structure:{nodes},members:[]} as unknown as FeatureContext;
 const value={principals:[{kind:'ROLE' as const,roleId:'role-1'},{kind:'ROLE' as const,roleId:'role-2'}],roleCapacities:[{roleId:'role-1',state:'VACANT' as const,eligibleCount:0,occupantCount:0},{roleId:'role-2',state:'OCCUPIED' as const,eligibleCount:2,occupantCount:2}]};
 let saved:unknown;
 const root=createRoot(document.querySelector('main')!);
 try{
  await act(async()=>root.render(<><TaskAssignmentsEditor context={context} value={value} roleEnabled pending={false} onSave={async(principals)=>{saved=principals;}}/><TaskAssigneesView context={context} value={value}/></>));
  const options=Array.from(document.querySelectorAll<HTMLOptionElement>('select option'));
  assert.deepEqual(options.map(option=>[option.textContent,option.value]),[['Facilitação · Pesquisa','ROLE:role-1'],['Facilitação · Operações','ROLE:role-2']]);
  assert.match(document.body.textContent!,/Sem ocupantes atuais/);
  assert.match(document.body.textContent!,/2 pessoas com acesso à tarefa/);
  await act(async()=>document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
  assert.deepEqual(saved,value.principals);
 }finally{await act(async()=>root.unmount());}
});
test('role capacity uses singular wording for one person and lists current people',async()=>{
 const nodes=[{nodeId:'c1',entityId:'circle-1',kind:'CIRCLE',name:'Pesquisa',parentNodeId:null},{nodeId:'r1',entityId:'role-1',kind:'ROLE',name:'Facilitação',parentNodeId:'c1'}];
 const context={structure:{nodes},members:[{id:'m1',displayName:'Bruno Araújo'}]} as unknown as FeatureContext;
 const value={principals:[{kind:'ROLE' as const,roleId:'role-1'}],roleCapacities:[{roleId:'role-1',state:'OCCUPIED' as const,eligibleCount:1,occupantCount:1}],resolvedAssignees:[{memberId:'m1'}]};
 const root=createRoot(document.querySelector('main')!);
 try{
  await act(async()=>root.render(<TaskAssigneesView context={context} value={value} compact/>));
  assert.match(document.body.textContent!,/1 pessoa com acesso à tarefa/);
  assert.doesNotMatch(document.body.textContent!,/1 pessoas/);
  assert.match(document.body.textContent!,/Bruno Araújo/);
 }finally{await act(async()=>root.unmount());}
});
