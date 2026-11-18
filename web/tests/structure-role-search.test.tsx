import test from "node:test";
import assert from "node:assert/strict";
import {JSDOM} from "jsdom";
import React,{act} from "react";
import {createServer} from "vite";

test("role search keeps the visible parent of a matching nested role and reports empty results",async()=>{
 const dom=new JSDOM('<main></main>',{url:'http://local.test'});
 for(const key of ['window','document','navigator','HTMLElement','Element','Node','Event'])Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:(dom.window as any)[key],configurable:true});
 Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
 const {createRoot}=await import('react-dom/client');
 const vite=await createServer({root:new URL('../',import.meta.url).pathname,configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});
 const {StructureRoleTree}=await vite.ssrLoadModule('/src/StructureRoleTree.tsx');
 const root=createRoot(document.querySelector('main')!);let destination='';
 try {
  await act(async()=>root.render(<StructureRoleTree parentId="root" navigate={(value:string)=>destination=value} nodes={[
   {nodeId:'direct',entityId:'direct',parentNodeId:'root',kind:'ROLE',name:'Escriba'},
   {nodeId:'child',entityId:'child',parentNodeId:'root',kind:'CIRCLE',name:'Operações'},
   {nodeId:'role',entityId:'role',parentNodeId:'child',kind:'ROLE',name:'Facilitador'},
  ]}/>));
  const input=document.querySelector('input')!;
  async function search(value:string){await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});}
  await search('Facilitador');
  assert.ok(document.querySelector('details[open]'));
  assert.match(document.querySelector('summary')!.textContent!,/Operações/);
  assert.doesNotMatch(document.querySelector('main')!.textContent!,/Escriba/);
  const role=[...document.querySelectorAll('button')].find(button=>button.textContent?.includes('Facilitador'))!;
  await act(async()=>role.click());assert.equal(destination,'/roles/role');
  await search('inexistente');assert.match(document.querySelector('main')!.textContent!,/Nenhum papel ou subcírculo encontrado/);
 }finally{await act(async()=>root.unmount());await vite.close();dom.window.close();}
});
