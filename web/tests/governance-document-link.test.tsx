import {installDialogLifecycle} from './helpers/dialog';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import React, { act } from 'react';

const dom = new JSDOM('<!doctype html><html><body><main></main></body></html>', { url: 'http://qa.localhost/structure/proposals/11111111-1111-4111-8111-111111111111' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Event', 'FormData']) {
  Object.defineProperty(globalThis, key, { value: key === 'window' ? dom.window : (dom.window as any)[key], configurable: true });
}
installDialogLifecycle(dom.window as any);
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
const { createRoot } = await import('react-dom/client');
const vite = await createServer({ root: new URL('../', import.meta.url).pathname, configFile: false, logLevel: 'error', server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
const { feature } = await vite.ssrLoadModule('/src/features/governance/index.tsx');
const { LocalizationProvider } = await vite.ssrLoadModule('/src/localization/index.tsx');
const Component = feature.Component;
const proposalId = '11111111-1111-4111-8111-111111111111';
test.after(async () => { await vite.close(); dom.window.close(); });

test('document proposal links only to an agreement resolved in the authorized list', async () => {
  const docId = '22222222-2222-4222-8222-222222222222';
  const detail = { proposal: { id: proposalId, title: 'Proposal', version: 1, revision: 1, state: 'ACCEPTED', applyState: 'APPLIED', kind: 'DOCUMENT', canEdit: false, canVote: false }, revisions: [{ number: 1, payload: { documentId: docId, documentVersion: 1 } }], rounds: [], objections: [], ballots: [], commits: [], nominations: [], history: [] };
  for (const available of [true, false]) {
    let destination = '';
    const context = {
      organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', path: `/structure/proposals/${proposalId}`,
      session: { account: { id: 'account' } }, bootstrap: { organization:{id:"org",name:"Organização",version:1,vocabulary:{}}, membership: { memberType: 'MEMBER', id: 'member' }, capabilities: { 'structure.direct': true }, modules: {} },
      structure: { nodes: [], memberships: [], occupancies: [] }, members: [], accountPreferences: { locale: 'pt-BR' },
      navigate(path: string) { destination = path; }, refresh() {}, notify() {},
      api: async (path: string) => ({ data: path.endsWith('/origin') ? { origin: null } : path.endsWith(`/proposals/${proposalId}`) ? detail : { items: path.endsWith('/documents') && available ? [{ id: docId, title: 'Acordo autorizado' }] : [], page: { nextCursor: null } } }),
    };
    const container = dom.window.document.querySelector('main')!;
    const root = createRoot(container);
    try {
      await act(async () => root.render(<LocalizationProvider preferences={{ locale: 'pt-BR' }}><Component context={context} /></LocalizationProvider>));
      const button = [...container.querySelectorAll('button')].find(b => b.textContent === 'Abrir acordo');
      if (available) {
        assert.ok(button);
        assert.match(container.textContent!, /Acordo autorizado/);
        await act(async () => button.click());
        assert.equal(destination, `/structure/working-agreements/${docId}`);
      } else {
        assert.equal(button, undefined);
        assert.doesNotMatch(container.textContent!, /Acordo autorizado|22222222/);
      }
    } finally { await act(async () => root.unmount()); }
  }
});

test('version origin links to the authorized historical proposal and retains a return path',async()=>{
 const docId='22222222-2222-4222-8222-222222222222', historical='33333333-3333-4333-8333-333333333333';
 let destination='';
 const doc={document:{id:docId,title:'Acordo',workflow:'GOVERNANCE',publishedVersion:2,draftVersion:2},versions:[
  {number:2,content:'Versão atual',createdAt:'2026-01-01T12:00:00Z',origin:{kind:'governed',proposal:{kind:'PROPOSAL',id:proposalId,title:'Proposta atual'},proposalRevision:2}},
  {number:1,content:'Versão antiga',createdAt:'2025-01-01T12:00:00Z',origin:{kind:'governed',proposal:{kind:'PROPOSAL',id:historical,title:'Proposta antiga'},proposalRevision:3}},
 ]};
 const context={organizationId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',path:`/structure/working-agreements/${docId}`,session:{account:{id:'account'}},bootstrap:{organization:{id:'org',name:'Organização',version:1,vocabulary:{}},membership:{memberType:'MEMBER',id:'member'},capabilities:{},modules:{}},structure:{nodes:[],memberships:[],occupancies:[]},members:[],navigate(path:string){destination=path;},refresh(){},notify(){},api:async(path:string)=>({data:path.endsWith('/documents/'+docId)?doc:path.includes('/capabilities')?{actions:{read:true},favorite:false,following:false,exportKinds:[]}:path.includes('/files')||path.includes('/comments')?{items:[]}:{items:[],page:{nextCursor:null}}})};
 const root=createRoot(dom.window.document.querySelector('main')!);
 try {
  await act(async()=>root.render(<LocalizationProvider preferences={{locale:'pt-BR'}}><Component context={context}/></LocalizationProvider>));
  const buttons=[...document.querySelectorAll<HTMLButtonElement>('button')];
  const historicalButton=buttons.find(button=>button.textContent?.includes('Proposta antiga'))!;assert.ok(historicalButton);
  await act(async()=>historicalButton.click());
  const target=new URL(destination,'https://orgmap.invalid');assert.equal(target.pathname,`/structure/proposals/${historical}`);assert.equal(target.searchParams.get('revision'),'3');assert.equal(target.searchParams.get('returnTo'),`/structure/working-agreements/${docId}`);
 }finally{await act(async()=>root.unmount());}
});

test('a proposal opened from an agreement selects its referenced historical revision',async()=>{
 const docId='22222222-2222-4222-8222-222222222222';
 const detail={proposal:{id:proposalId,title:'Proposal',version:2,revision:2,state:'DECIDED',kind:'DOCUMENT'},revisions:[{number:1,payload:{documentId:docId,documentVersion:1}},{number:2,payload:{documentId:docId,documentVersion:2}}],rounds:[],objections:[],ballots:[],commits:[],nominations:[],history:[]};
 const context={organizationId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',path:`/structure/proposals/${proposalId}?revision=1`,session:{account:{id:'account'}},bootstrap:{organization:{id:'org',name:'Organização',version:1,vocabulary:{}},membership:{memberType:'MEMBER',id:'member'},capabilities:{},modules:{}},structure:{nodes:[],memberships:[],occupancies:[]},members:[],navigate(){},refresh(){},notify(){},api:async(path:string)=>({data:path.endsWith('/origin')?{origin:null}:path.includes('/proposals/'+proposalId)?detail:{items:[],page:{nextCursor:null}}})};
 const root=createRoot(dom.window.document.querySelector('main')!);
 try {
  await act(async()=>root.render(<LocalizationProvider preferences={{locale:'pt-BR'}}><Component context={context}/></LocalizationProvider>));
  const selector=[...document.querySelectorAll<HTMLSelectElement>('select')].find(select=>[...select.options].some(option=>/histórica/i.test(option.textContent??'')));assert.ok(selector);assert.equal(selector.value,'1');
 }finally{await act(async()=>root.unmount());}
});


test('mixed proposal reads each exact document revision and switches history without showing current texts',async()=>{
 const ids=['22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
 const revisions=[1,2].map(number=>({number,payload:{documents:ids.map((documentId,index)=>({documentId,documentVersion:number+index}))}}));
 const documents=(revision:number)=>ids.map((documentId,index)=>({documentId,title:'Restrição '+(index+1),number:revision+index,content:`Texto ${index+1} da proposta ${revision}`,richContent:null,proposalRevision:revision}));
 const detail={proposal:{id:proposalId,title:'Proposta composta',revision:2,version:2,kind:'GOVERNANCE',state:'DECIDED'},revisions,meetingDocuments:documents(2),rounds:[],objections:[],ballots:[],commits:[],nominations:[],history:[]};
 const context={organizationId:'org',path:`/structure/proposals/${proposalId}?revision=1`,session:{account:{id:'account'}},bootstrap:{organization:{id:'org',name:'Org',vocabulary:{}},membership:{id:'member',memberType:'MEMBER'},capabilities:{},modules:{}},structure:{nodes:[],circles:[],roles:[],memberships:[],occupancies:[]},members:[],navigate(){},refresh(){},notify(){},api:async(path:string)=>({data:path.includes('documentRevision=1')?{...detail,meetingDocuments:documents(1)}:path.endsWith('/proposals/'+proposalId)?detail:path.endsWith('/origin')?{origin:null}:{items:[],page:{nextCursor:null}}})};
 const root=createRoot(document.querySelector('main')!);
 try{
  await act(async()=>root.render(<LocalizationProvider preferences={{locale:'pt-BR'}}><Component context={context}/></LocalizationProvider>));
  assert.match(document.querySelector('main')!.textContent!,/Texto 1 da proposta 1/);assert.match(document.querySelector('main')!.textContent!,/Texto 2 da proposta 1/);assert.doesNotMatch(document.querySelector('main')!.textContent!,/Texto [12] da proposta 2/);
  const selector=[...document.querySelectorAll<HTMLSelectElement>('select')].find(select=>[...select.options].some(option=>/histórica/i.test(option.textContent??'')))!;
  await act(async()=>{selector.value='2';selector.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  assert.match(document.querySelector('main')!.textContent!,/Texto 1 da proposta 2/);assert.match(document.querySelector('main')!.textContent!,/Texto 2 da proposta 2/);assert.doesNotMatch(document.querySelector('main')!.textContent!,/Texto [12] da proposta 1/);
 }finally{await act(async()=>root.unmount());}
});
