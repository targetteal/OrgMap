import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import React, { act } from 'react';
import { fromPlainText } from '../../packages/content/index.js';

const dom=new JSDOM('<!doctype html><main></main>',{url:'http://restriction-publication.localhost'});
for(const key of ['window','document','navigator','HTMLElement','HTMLInputElement','Event','FormData','MutationObserver'])
  Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:(dom.window as any)[key],configurable:true});
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
const {createRoot}=await import('react-dom/client');
const vite=await createServer({root:new URL('../',import.meta.url).pathname,configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});
const {O2MeetingPanel}=await vite.ssrLoadModule('/src/features/meetings/o2-panel.tsx');
const {LocalizationProvider}=await vite.ssrLoadModule('/src/localization/index.tsx');
test.after(async()=>{await vite.close();dom.window.close();});

const meetingId='22222222-2222-4222-8222-222222222222';
const circleId='33333333-3333-4333-8333-333333333333';
const firstId='44444444-4444-4444-8444-444444444444';
const secondId='55555555-5555-4555-8555-555555555555';
type Part={documentId:string;documentVersion:number;documentAction?:'ARCHIVE'};
const parts:Part[]=[{documentId:firstId,documentVersion:2},{documentId:secondId,documentVersion:5}];
const bodies=[
  {documentId:firstId,number:2,title:'Primeira restrição',content:'Corpo da primeira revisão aprovada'},
  {documentId:secondId,number:5,title:'Segunda restrição',richContent:fromPlainText('Corpo da segunda revisão aprovada')},
];
function deferred<T>() {
  let resolve!:(value:T)=>void;
  const promise=new Promise<T>(done=>{resolve=done;});
  return {promise,resolve};
}
function fixture({payload={documents:parts},documents=bodies,applyState='APPLIED',legacy=false,readDocument}:{
  payload?:any;documents?:any[];applyState?:string;legacy?:boolean;readDocument:(id:string,signal:AbortSignal)=>Promise<any>;
}) {
  const calls:{path:string;signal?:AbortSignal}[]=[],navigation:string[]=[];
  const attendee={memberId:'scribe',attendance:'PRESENT',access:'READ',isCircleMember:true};
  const detail={
    meeting:{id:meetingId,title:'Governança',circleId,state:'RUNNING',version:4,currentStep:'agenda',notetakerId:'scribe',facilitatorId:'facilitator',sections:[{id:'agenda',title:'Pauta',kind:'AGENDA'}]},
    agenda:[{id:'subject',title:'Acordos de trabalho',status:'OPEN'}],participants:[attendee],actions:[],capabilities:{edit:false,proposeGovernance:true},accessMode:'PARTICIPANT',
  };
  const panel={
    member:true,present:true,canConduct:false,canConfigure:false,panel:{focusId:'subject',notes:''},attendees:[attendee],review:[],treatments:[{agendaId:'subject',mode:'ADAPT'}],processes:[],
    proposals:[{agendaId:'subject',proposal:{id:'proposal',kind:legacy?'DOCUMENT':'GOVERNANCE',title:'Acordos aprovados',state:applyState==='APPLIED'?'DECIDED':'DRAFT',revision:3,version:5,authorId:'scribe',applyState,verdict:applyState==='APPLIED'?'ADOPT':null,payload},...(legacy?{document:documents[0]}:{documents})}],
  };
  const context:any={
    organizationId:'organization',session:{account:{id:'account'}},path:`/meetings/${meetingId}?step=agenda`,
    bootstrap:{organization:{id:'organization'},membership:{id:'scribe',memberType:'MEMBER'},authorizationRevision:9,modules:{meetings:true,governance:true}},
    structure:{nodes:[{entityId:circleId,name:'Produto',kind:'CIRCLE'}]},members:[{id:'scribe',displayName:'Escriba'}],
    navigate:(path:string)=>navigation.push(path),
    api:async(path:string,options:any={})=>{
      calls.push({path,signal:options.signal});
      const prefix='/organizations/organization';
      if(path.startsWith(prefix+'/documents/'))return readDocument(path.slice((prefix+'/documents/').length),options.signal);
      if(path===prefix+'/meetings/'+meetingId+'/panel')return {data:structuredClone(panel)};
      if(path===prefix+'/meetings/'+meetingId)return {data:structuredClone(detail)};
      throw new Error('Unexpected API route: '+path);
    },
  };
  return {context,calls,navigation};
}
async function mount(context:any) {
  const container=document.querySelector('main')!;
  const root=createRoot(container);
  await act(async()=>root.render(<LocalizationProvider preferences={{locale:'pt-BR'}}><O2MeetingPanel context={context} meetingId={meetingId}/></LocalizationProvider>));
  return {container,close:async()=>{await act(async()=>root.unmount());}};
}
function publicationButtons(container:Element) {
  return Array.from(container.querySelectorAll('button')).filter(button=>button.textContent?.startsWith('Ver restrição publicada'));
}

test('an applied plural proposal shows both pinned bodies and navigates to each independently verified publication',async()=>{
  const first=deferred<any>(),second=deferred<any>();
  const f=fixture({readDocument:async id=>id===firstId?first.promise:second.promise});
  const view=await mount(f.context);
  try {
    const reading=view.container.querySelector('.o2-proposal-reading')!;
    assert.match(reading.textContent??'',/Corpo da primeira revisão aprovada/);
    assert.match(reading.textContent??'',/Corpo da segunda revisão aprovada/);
    assert.equal(reading.querySelectorAll(':scope > section').length,2);
    assert.equal(publicationButtons(view.container).length,0);
    const requests=f.calls.filter(call=>call.path.includes('/documents/'));
    assert.deepEqual(requests.map(call=>call.path),[firstId,secondId].map(id=>'/organizations/organization/documents/'+id));
    assert.ok(requests.every(call=>call.signal instanceof AbortSignal&&!call.signal.aborted));
    await act(async()=>{
      first.resolve({data:{document:{id:firstId,title:'Primeira publicação',publishedVersion:2,archived:false}}});
      second.resolve({data:{document:{id:secondId,title:'Segunda publicação',publishedVersion:5,archived:false}}});
    });
    const links=publicationButtons(view.container);
    assert.deepEqual(links.map(link=>link.textContent?.trim()),['Ver restrição publicada: Primeira publicação','Ver restrição publicada: Segunda publicação']);
    await act(async()=>{links[0].click();links[1].click();});
    assert.deepEqual(f.navigation,[firstId,secondId].map(id=>'/structure/working-agreements/'+id));
    assert.match(view.container.querySelector('.o2-application')?.textContent??'',/restrições publicadas/);
  } finally {await view.close();}
  assert.ok(f.calls.filter(call=>call.path.includes('/documents/')).every(call=>call.signal?.aborted));
});

test('archive instructions, denied resources and documents without a current publication produce no navigation links',async()=>{
  const archiveId='archive-instruction',deniedId='denied',archivedId='archived',unpublishedId='unpublished';
  const excluded:Part[]=[{documentId:archiveId,documentVersion:1,documentAction:'ARCHIVE'},...[deniedId,archivedId,unpublishedId].map(documentId=>({documentId,documentVersion:3}))];
  const f=fixture({payload:{documents:excluded},documents:[],readDocument:async id=>{
    if(id===deniedId)throw Object.assign(new Error('Resource not found'),{code:'RESOURCE_NOT_FOUND'});
    if(id===archivedId)return {data:{document:{id,title:'Arquivada',publishedVersion:3,archived:true}}};
    if(id===unpublishedId)return {data:{document:{id,title:'Em rascunho',publishedVersion:null,archived:false}}};
    throw new Error('Archive instructions must not request a publication');
  }});
  const view=await mount(f.context);
  try {
    assert.equal(publicationButtons(view.container).length,0);
    assert.deepEqual(f.calls.filter(call=>call.path.includes('/documents/')).map(call=>call.path.split('/').at(-1)),[deniedId,archivedId,unpublishedId]);
    assert.equal(view.container.querySelector('.o2-application')?.textContent,'Alteração efetivada');
    assert.deepEqual(f.navigation,[]);
    assert.doesNotMatch(view.container.textContent??'',/Resource not found|restrição publicada/);
  } finally {await view.close();}
});

test('a pending proposal keeps both document bodies without claiming or fetching publication',async()=>{
  const f=fixture({applyState:'PENDING',readDocument:async()=>{throw new Error('Pending proposals must not look up publication');}});
  const view=await mount(f.context);
  try {
    assert.match(view.container.querySelector('.o2-proposal-reading')?.textContent??'',/Corpo da primeira revisão aprovada/);
    assert.match(view.container.querySelector('.o2-proposal-reading')?.textContent??'',/Corpo da segunda revisão aprovada/);
    assert.equal(publicationButtons(view.container).length,0);
    assert.equal(f.calls.filter(call=>call.path.includes('/documents/')).length,0);
    assert.equal(view.container.querySelector('.o2-application')?.textContent,'Proposta em preparação');
  } finally {await view.close();}
});

test('a legacy DOCUMENT payload and pinned document retain their verified publication link',async()=>{
  const f=fixture({legacy:true,payload:{documentId:firstId,documentVersion:2},documents:[bodies[0]],readDocument:async id=>({data:{document:{id,title:'Publicação legada',publishedVersion:2,archived:false}}})});
  const view=await mount(f.context);
  try {
    assert.match(view.container.querySelector('.o2-proposal-reading')?.textContent??'',/Corpo da primeira revisão aprovada/);
    const links=publicationButtons(view.container);
    assert.equal(links.length,1);
    await act(async()=>links[0].click());
    assert.deepEqual(f.navigation,['/structure/working-agreements/'+firstId]);
  } finally {await view.close();}
});
