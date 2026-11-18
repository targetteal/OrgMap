import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import React, { act } from 'react';

const dom = new JSDOM('<!doctype html><html><body><main></main></body></html>', { url: 'http://qa.localhost/structure/proposals/11111111-1111-4111-8111-111111111111' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Event', 'FormData']) {
  Object.defineProperty(globalThis, key, { value: key === 'window' ? dom.window : (dom.window as any)[key], configurable: true });
}
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
const { createRoot } = await import('react-dom/client');
const vite = await createServer({ root: new URL('../', import.meta.url).pathname, configFile: false, logLevel: 'error', server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
const { feature } = await vite.ssrLoadModule('/src/features/governance/index.tsx');
const { LocalizationProvider } = await vite.ssrLoadModule('/src/localization/index.tsx');
const Component = feature.Component;
const proposalId = '11111111-1111-4111-8111-111111111111';
test.after(async () => { await vite.close(); dom.window.close(); });

test('filter panel supports empty result, clear and Escape focus restoration', async () => {
  const rows=[{id:proposalId,title:'Proposta existente',state:'DRAFT',kind:'GOVERNANCE',changeKinds:['ROLE'],circleId:'circle',authorId:'member',createdAt:'2026-01-01T00:00:00Z'},{id:'22222222-2222-4222-8222-222222222222',title:'Círculo novo',state:'DRAFT',kind:'GOVERNANCE',changeKinds:['CIRCLE'],circleId:'circle',authorId:'member',createdAt:'2026-01-02T00:00:00Z'}];
  const context={organizationId:'org',path:'/structure/proposals',session:{account:{id:'account'}},bootstrap:{organization:{id:"org",name:"Organização",version:1,vocabulary:{}},membership:{memberType:'MEMBER',id:'member'},capabilities:{},modules:{}},structure:{nodes:[],memberships:[],occupancies:[]},members:[],accountPreferences:{locale:'pt-BR'},navigate(){},refresh(){},notify(){},api:async(path:string)=>({data:{items:path.endsWith('/proposals')?rows:[],page:{nextCursor:null}}})};
  const container=dom.window.document.querySelector('main')!, root=createRoot(container);
  const button=(name:string)=>{const b=[...container.querySelectorAll('button')].find(x=>x.textContent?.trim()===name);assert.ok(b,name);return b;};
  try {
    await act(async()=>root.render(<LocalizationProvider preferences={{locale:'pt-BR'}}><Component context={context}/></LocalizationProvider>));
    const upToDate=container.querySelector('.empty-state')!;
    assert.match(upToDate.textContent!,/Você está em dia/);
    await act(async()=>button('Ver todas as propostas (2)').click());
    assert.match(container.querySelector('.proposal-results')!.textContent!,/Proposta existente/);
    const trigger=button('Filtrar');await act(async()=>trigger.click());
    const panel=container.querySelector<HTMLElement>('#proposal-filter-panel')!;assert.equal(dom.window.document.activeElement,panel);
    await act(async()=>button('Recusadas').click());assert.match(container.textContent!,/Nenhum resultado/);
    const clear=container.querySelector<HTMLButtonElement>('.empty-state button')!;assert.equal(clear.textContent,'Limpar filtros');
    await act(async()=>clear.click());assert.match(container.textContent!,/Proposta existente/);
    const type=[...panel.querySelectorAll<HTMLSelectElement>('select')].find(select=>[...select.options].some(option=>option.value==='ROLE'))!;
    assert.ok(type);assert.deepEqual([...type.options].map(option=>option.value),['','ROLE','CIRCLE','DOCUMENT','ELECTION']);
    await act(async()=>{type.value='ROLE';type.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
    assert.match(container.querySelector('.proposal-results')!.textContent!,/Proposta existente/);assert.doesNotMatch(container.querySelector('.proposal-results')!.textContent!,/Círculo novo/);
    await act(async()=>{type.value='CIRCLE';type.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
    assert.match(container.querySelector('.proposal-results')!.textContent!,/Círculo novo/);assert.doesNotMatch(container.querySelector('.proposal-results')!.textContent!,/Proposta existente/);
    await act(async()=>panel.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    assert.equal(container.querySelector('#proposal-filter-panel'),null);assert.equal(dom.window.document.activeElement,trigger);
  } finally {await act(async()=>root.unmount());}
});
