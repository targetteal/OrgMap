import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createServer } from "vite";

test("directory separates direct roles from subcircle roles, collapses groups, and preserves return navigation", async () => {
  const dom = new JSDOM('<!doctype html><main></main>', { url: 'http://structure.localhost/structure/directory' });
  for (const key of ['window','document','navigator','HTMLElement','Element','Node','Event']) Object.defineProperty(globalThis,key,{value:key === 'window' ? dom.window : (dom.window as any)[key],configurable:true});
  Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
  const { createRoot } = await import('react-dom/client');
  const vite = await createServer({root:new URL('../',import.meta.url).pathname,configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});
  const { StructureDirectory } = await vite.ssrLoadModule('/src/StructureDirectory.tsx');
  const nodes = [
    {nodeId:'z',entityId:'role-z',kind:'ROLE',name:'Zelar',parentNodeId:'a'},
    {nodeId:'b',entityId:'role-b',kind:'ROLE',name:'Água',parentNodeId:'a'},
    {nodeId:'a',entityId:'circle-a',kind:'CIRCLE',name:'Comunidade',parentNodeId:null},
    {nodeId:'c',entityId:'circle-c',kind:'CIRCLE',name:'Operações',parentNodeId:'a'},
    {nodeId:'d',entityId:'role-d',kind:'ROLE',name:'Acolher',parentNodeId:'c'},
  ];
  let destination = '', snapshot:any = null;
  const root=createRoot(document.querySelector('main')!);
  try {
    await act(async()=>root.render(<StructureDirectory onStateChange={(value:any)=>snapshot=value} context={{path:'/structure/directory',organizationId:'synthetic',bootstrap:{rootCircleId:'circle-a',modules:{},membership:{memberType:'MEMBER'}},structure:{nodes,roles:[],coverage:{complete:true}},navigate:(path:string)=>destination=path}}/>));
    const rows=()=>Array.from(document.querySelectorAll<HTMLButtonElement>('.directory-list button[data-node]'));
    assert.deepEqual(rows().map(e=>e.dataset.node),['a','b','z','c']);
    assert.equal(document.querySelector('[data-node="b"]')!.closest('.outline-circle')!.querySelector('strong')!.textContent,'Comunidade');
    assert.equal(document.querySelector('[data-node="d"]'),null,'subcircles start collapsed as in the approved outline');
    await act(async()=>document.querySelector<HTMLButtonElement>('[aria-label="Expandir Operações"]')!.click());
    assert.equal(document.querySelector('[data-node="d"]')!.closest('.outline-circle')!.querySelector('strong')!.textContent,'Operações');
    const collapse=document.querySelector<HTMLButtonElement>('[aria-label="Recolher Operações"]')!;
    await act(async()=>collapse.click());
    assert.equal(document.querySelector('[data-node="d"]'),null);
    assert.ok(document.querySelector('[data-node="b"]'));
    assert.deepEqual(snapshot.directoryCollapsed,['c']);
    await act(async()=>document.querySelector<HTMLDetailsElement>('.mare-directory-filters')!.querySelector('summary')!.click());
    const filter=Array.from(document.querySelectorAll('.structure-kind-filter button')).find(e=>e.textContent==='Papéis') as HTMLButtonElement;
    await act(async()=>filter.click());
    assert.equal(filter.getAttribute('aria-pressed'),'true');
    assert.equal(rows().length,5);
    assert.equal(snapshot.kindFilter,'ROLE');
    await act(async()=>document.querySelector<HTMLButtonElement>('[data-node="b"]')!.click());
    assert.equal(destination,'/roles/role-b?from=%2Fstructure%2Fdirectory');
    const input=document.querySelector('input')!;
    await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(input,'inexistente');input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
    assert.match(document.querySelector('.empty-state')!.textContent!,/inexistente/);
    assert.equal(snapshot.query,'inexistente');
    assert.equal(snapshot.kindFilter,'ROLE');
    const clear=Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='Limpar filtros') as HTMLButtonElement;
    await act(async()=>clear.click());
    assert.equal(rows().length,4);
    assert.equal(input.value,'');
    assert.equal(snapshot.query,'');
    assert.equal(snapshot.kindFilter,'');
  } finally {await act(async()=>root.unmount());await vite.close();dom.window.close();}
});
