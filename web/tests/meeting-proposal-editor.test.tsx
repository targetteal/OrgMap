import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import React,{act} from 'react';
const dom=new JSDOM('<!doctype html><main></main>',{url:'http://qa.localhost'});
for(const key of ['window','document','navigator','HTMLElement','HTMLInputElement','HTMLDialogElement','Event','FormData'])Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:(dom.window as any)[key],configurable:true});
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
const {createRoot}=await import('react-dom/client');
const vite=await createServer({root:new URL('../',import.meta.url).pathname,configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});
const {MeetingProposalEditor}=await vite.ssrLoadModule('/src/features/governance/index.tsx');
const {LocalizationProvider}=await vite.ssrLoadModule('/src/localization/index.tsx');
test.after(async()=>{await vite.close();dom.window.close();});
const org='11111111-1111-4111-8111-111111111111',meeting='22222222-2222-4222-8222-222222222222',agenda='33333333-3333-4333-8333-333333333333',circle='44444444-4444-4444-8444-444444444444',doc='55555555-5555-4555-8555-555555555555',proposal='66666666-6666-4666-8666-666666666666';
const container=document.querySelector('main')!;
function context(api:any,nav:string[]=[]){return {organizationId:org,path:`/structure/proposals?fromMeeting=${meeting}&fromAgenda=${agenda}`,session:{account:{id:'account'}},bootstrap:{membership:{id:'member',memberType:'MEMBER'},modules:{meetings:true,governance:true},authorizationRevision:1,rootCircleId:circle},structure:{nodes:[{entityId:circle,name:'Source circle',kind:'CIRCLE'}],memberships:[]},members:[],accountPreferences:{locale:'en-US'},api,navigate:(path:string)=>nav.push(path),refresh(){},registerNavigationGuard(){return()=>{};}} as any;}
const source={meeting:{id:meeting,circleId:circle,title:'Source meeting',version:9,state:'RUNNING'},agenda:[{id:agenda,title:'Source agenda'}],capabilities:{edit:true}};
const docs=[{id:doc,title:'Policy draft',draftVersion:3,workflow:'GOVERNANCE',visibility:'ORGANIZATION'}];
async function select(element:HTMLSelectElement,value:string){await act(async()=>{element.value=value;element.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});}
test('meeting proposal uses the real editor, fixed source circle, meeting version and canonical destination',async()=>{
 const calls:any[]=[],nav:string[]=[];
 const c=context(async(path:string,options:any)=>{calls.push({path,options});return {data:options?.method==='POST'?{target:{kind:'PROPOSAL',id:proposal,title:'Source agenda'}}:source};},nav),root=createRoot(container);
 try{
  await act(async()=>root.render(<LocalizationProvider preferences={{locale:'en-US'}}><MeetingProposalEditor c={c} docs={docs} types={[]}/></LocalizationProvider>));
  assert.equal((container.querySelector('[name="title"]') as HTMLInputElement).value,'Source agenda');
  const selects=[...container.querySelectorAll('select')];
  const sourceCircle=selects.find(s=>[...s.options].some(o=>o.value===circle))!;assert.equal(sourceCircle.disabled,true);
  await select(selects.find(s=>[...s.options].some(o=>o.value==='DOCUMENT'))!,'DOCUMENT');
  await select([...container.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='PUBLISH'))!,'PUBLISH');
  await select([...container.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value===doc))!,doc);
  const submit=[...container.querySelectorAll('button')].find(b=>b.type==='submit')!;assert.ok(submit);await act(async()=>submit.click());
  const post=calls.find(x=>x.options?.method==='POST');assert.equal(post.path,`/organizations/${org}/meetings/${meeting}/outcomes`);assert.equal(post.options.version,9);
  assert.deepEqual(post.options.body,{title:'Source agenda',kind:'PROPOSAL',proposalKind:'GOVERNANCE',payload:{documents:[{documentId:doc,documentVersion:3}]},agendaId:agenda});assert.ok(post.options.key);
  assert.match(nav[0],new RegExp('^/structure/proposals/'+proposal+'\\?returnTo='));
 }finally{await act(async()=>root.unmount());}
});
test('uneditable or invalid sources never mount the creation form or issue a write',async()=>{
 const calls:any[]=[],root=createRoot(container),c=context(async(path:string,options:any)=>{calls.push({path,options});return {data:{...source,capabilities:{edit:false}}};});
 try{
  await act(async()=>root.render(<LocalizationProvider preferences={{locale:'en-US'}}><MeetingProposalEditor c={c} docs={docs} types={[]}/></LocalizationProvider>));
  assert.equal(container.querySelector('form'),null);assert.match(container.textContent!,/unavailable/);assert.equal(calls.length,1);
  await act(async()=>root.render(<LocalizationProvider preferences={{locale:'en-US'}}><MeetingProposalEditor key="invalid" c={{...c,path:'/structure/proposals?fromMeeting=../../other'}} docs={docs} types={[]}/></LocalizationProvider>));
  assert.equal(container.querySelector('form'),null);assert.equal(calls.length,1);
 }finally{await act(async()=>root.unmount());}
});


test('present member may propose without general editing; guest stays blocked even with a stale capability',async()=>{
 const calls:any[]=[],root=createRoot(container),c=context(async(path:string,options:any)=>{calls.push({path,options});return {data:{...source,capabilities:{edit:false,proposeGovernance:true}}};});
 try{
  await act(async()=>root.render(<LocalizationProvider preferences={{locale:'en-US'}}><MeetingProposalEditor c={c} docs={docs} types={[]}/></LocalizationProvider>));
  assert.ok(container.querySelector('form'));assert.equal((container.querySelector('[name="title"]') as HTMLInputElement).value,'Source agenda');
  const readCount=calls.length;
  await act(async()=>root.render(<LocalizationProvider preferences={{locale:'en-US'}}><MeetingProposalEditor c={{...c,bootstrap:{...c.bootstrap,membership:{...c.bootstrap.membership,memberType:'GUEST'}}}} docs={docs} types={[]}/></LocalizationProvider>));
  assert.equal(container.querySelector('form'),null);assert.equal(calls.length,readCount);assert.match(container.textContent!,/unavailable/);
 }finally{await act(async()=>root.unmount());}
});

test('meeting proposal discards only after confirmation and clears its navigation guard before returning',async()=>{
 let guard:()=>string|null=()=>null,blocked=0;const nav:string[]=[];
 const c=context(async()=>({data:source}));
 c.registerNavigationGuard=(value:()=>string|null)=>{guard=value;return()=>{guard=()=>null;};};
 c.navigate=(path:string)=>{if(guard())blocked++;else nav.push(path);};
 const root=createRoot(container);
 const action=(name:string)=>{const button=[...container.querySelectorAll('button')].find(b=>b.textContent?.trim()===name);assert.ok(button,name);return button;};
 try{
  await act(async()=>root.render(<LocalizationProvider preferences={{locale:'en-US'}}><MeetingProposalEditor c={c} docs={docs} types={[]}/></LocalizationProvider>));
  const type=[...container.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='ELECTION'))!;
  await select(type,'ELECTION');assert.match(guard()!,/unsaved/);
  const dialog=container.querySelector('dialog')!;
  await act(async()=>dialog.dispatchEvent(new dom.window.Event('cancel',{cancelable:true})));
  assert.equal(nav.length,0);assert.match(guard()!,/unsaved/);assert.equal(type.value,'ELECTION');
  await act(async()=>action('Keep editing').click());assert.equal(type.value,'ELECTION');assert.match(guard()!,/unsaved/);
  await act(async()=>dialog.dispatchEvent(new dom.window.Event('cancel',{cancelable:true})));
  await act(async()=>action('Discard changes').click());
  assert.equal(blocked,0);assert.equal(guard(),null);
  assert.deepEqual(nav,[`/meetings/${meeting}?step=agenda`]);
 }finally{await act(async()=>root.unmount());}
});
