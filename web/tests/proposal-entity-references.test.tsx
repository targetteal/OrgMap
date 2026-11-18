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


test('proposal evolution resolves archived references only in its authorized scope',async()=>{
 const circle='22222222-2222-4222-8222-222222222222',role='33333333-3333-4333-8333-333333333333',destination='44444444-4444-4444-8444-444444444444',otherProposal='55555555-5555-4555-8555-555555555555';
 const makeDetail=(id:string,refs:any[])=>({proposal:{id,title:'Proposta',circleId:circle,version:1,revision:1,state:'DECIDED',kind:'GOVERNANCE',canEdit:false,canVote:false},revisions:[{number:1,payload:{changes:[{kind:'ARCHIVE',entityId:role},{kind:'MOVE',entityId:role,parentCircleId:destination},{kind:'CREATE',entityId:'new',name:'Nome criado'},{kind:'UPDATE',entityId:role,name:'Nome proposto'}]}}],entityReferences:refs,rounds:[],objections:[],ballots:[],commits:[],nominations:[],history:[]});
 const refs=[{entityId:role,name:'Papel arquivado',kind:'ROLE',archived:true},{entityId:circle,name:'Círculo arquivado',kind:'CIRCLE',archived:true},{entityId:destination,name:'Destino arquivado',kind:'CIRCLE',archived:true}];let pending!:(v:any)=>void;
 const api=async(path:string)=>path.endsWith('/origin')?{data:{origin:null}}:path.endsWith('/proposals/'+proposalId)?{data:makeDetail(proposalId,refs)}:path.endsWith('/proposals/'+otherProposal)?new Promise(r=>{pending=r;}):{data:{items:[],page:{nextCursor:null}}};
 const context=(org:string,id:string,guest=false)=>({organizationId:org,path:'/structure/proposals/'+id,session:{account:{id:'account'}},bootstrap:{organization:{id:'org',name:'Organization'},membership:{memberType:guest?'GUEST':'MEMBER',id:'member'},capabilities:{},modules:{},authorizationRevision:1},structure:{nodes:[],circles:[],roles:[],memberships:[]},members:[],navigate(){},refresh(){},notify(){},api});
 const container=dom.window.document.querySelector('main')!,root=createRoot(container),render=(ctx:any)=><LocalizationProvider preferences={{locale:'pt-BR'}}><Component context={ctx}/></LocalizationProvider>;
 try{await act(async()=>root.render(render(context('org',proposalId))));assert.match(container.textContent!,/Papel arquivado/);assert.match(container.textContent!,/Destino arquivado/);assert.match(container.textContent!,/Círculo arquivado/);assert.match(container.textContent!,/Nome criado/);assert.match(container.textContent!,/Nome proposto/);
 await act(async()=>root.render(render(context('other-org',otherProposal))));assert.doesNotMatch(container.textContent!,/Papel arquivado|Destino arquivado|Círculo arquivado/);await act(async()=>pending({data:makeDetail(otherProposal,[])}));assert.doesNotMatch(container.textContent!,/Papel arquivado|Destino arquivado|Círculo arquivado/);assert.match(container.textContent!,/—/);
 const guest=context('org',proposalId,true);guest.structure.nodes=[{entityId:role,name:'Papel visível'}] as any;await act(async()=>root.render(render(guest)));assert.doesNotMatch(container.textContent!,/Papel arquivado|Destino arquivado|Círculo arquivado/);assert.match(container.textContent!,/Papel visível/);
 }finally{await act(async()=>root.unmount());}
});
