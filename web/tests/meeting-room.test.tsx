import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import React, { act } from 'react';

const dom = new JSDOM('<!doctype html><main></main>', {url:'http://room.localhost/meetings'});
for (const key of ['window','document','navigator','HTMLElement','Event']) Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:(dom.window as any)[key],configurable:true});
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
const {createRoot} = await import('react-dom/client');
const vite = await createServer({root:new URL('../',import.meta.url).pathname,configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});
const {feature} = await vite.ssrLoadModule('/src/features/meetings/index.tsx');
const {LocalizationProvider} = await vite.ssrLoadModule('/src/localization/index.tsx');
test.after(async()=>{await vite.close();dom.window.close();});

for (const editable of [true,false]) test(`meeting without O2 uses the approved room and preserves ${editable?'versioned commands':'read-only capabilities'}`,async()=>{
  const id='11111111-1111-4111-8111-111111111111', mutations:any[]=[], reads:string[]=[];
  const meeting={id,circleId:'circle',title:'Encontro de publicação',state:'RUNNING',startAt:'2030-02-01T12:00:00Z',timeZone:'UTC',durationMinutes:60,version:7,sections:[{id:'agenda',title:'Pauta',kind:'AGENDA'}],currentStep:'agenda',notetakerId:'member',policy:{notesOnlyNoter:true,windowDays:7}};
  const detail={meeting,participants:[{memberId:'member',access:editable?'EDIT':'READ',attendance:'PRESENT'}],agenda:[{id:'subject-a',title:'Publicações sem contexto',presenterId:'member',status:'OPEN',version:3},{id:'subject-b',title:'Revisar calendário',presenterId:'member',status:'OPEN',version:5}],actions:[],documents:[],report:null,capabilities:{edit:editable,manage:editable,facilitatorOperation:editable,secretaryOperation:editable}};
  const c={organizationId:'org',path:`/meetings/${id}?step=agenda`,session:{account:{id:'account'}},bootstrap:{governanceModel:null,organization:{id:'org',name:'Org'},membership:{id:'member',memberType:'MEMBER',orgRole:editable?'OWNER':'MEMBER'},authorizationRevision:1,capabilities:{},modules:{}},structure:{nodes:[{entityId:'circle',name:'Comunicação'}],circles:[],roles:[]},members:[{id:'member',displayName:'Ana Costa'}],navigate(){},refresh(){},notify(){},api:async(path:string,options:any={})=>{if(options.method==='POST'){mutations.push({path,...options});return{data:detail};}reads.push(path);if(path.endsWith(`/meetings/${id}`))return{data:detail};return{data:{origin:null,items:[]}};}};
  const container=document.querySelector('main')!,root=createRoot(container);
  try {
    await act(async()=>root.render(<LocalizationProvider preferences={{locale:'pt-BR',timeZone:'UTC'}}><feature.Component context={c}/></LocalizationProvider>));
    assert.ok(container.querySelector('.mare-standard-room'));
    assert.equal(container.querySelector('.meetings-session'),null);
    assert.equal(container.querySelector('.meetings-session-toolbar'),null);
    assert.equal(reads.some(path=>path.endsWith('/panel')),false,'visual composition does not activate the O2 domain');
    const queue=[...container.querySelectorAll<HTMLButtonElement>('.o2-tension')];
    assert.equal(queue.length,2);
    await act(async()=>queue[1].click());
    assert.equal(container.querySelector('.mare-room-subject-title')?.textContent,'Revisar calendário');
    assert.equal(mutations.length,0,'reading a subject never completes it');
    const complete=[...container.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent?.includes('Concluir tratamento'));
    if(editable){assert.ok(complete);await act(async()=>complete.click());assert.equal(mutations[0].path,`/organizations/org/meetings/${id}/agenda/subject-b/actions/complete`);assert.equal(mutations[0].version,5);}
    else{assert.equal(complete,undefined);assert.equal(container.querySelector('.o2-steps button:not([disabled])'),null);}
  } finally {await act(async()=>root.unmount());}
});
