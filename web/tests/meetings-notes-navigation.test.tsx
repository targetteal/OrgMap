import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import React,{act} from 'react';
import * as Y from 'yjs';
const dom=new JSDOM('<!doctype html><html><body><main></main></body></html>',{url:'http://notes.localhost'});
for(const key of ['window','document','navigator','HTMLElement','HTMLTextAreaElement','Event'])Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:(dom.window as any)[key],configurable:true});
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
class ControlledSocket {
 static OPEN=1;static instances:ControlledSocket[]=[];
 readyState=0;sent:any[]=[];onopen:(()=>void)|null=null;onmessage:((e:{data:string})=>void)|null=null;onclose:(()=>void)|null=null;onerror:(()=>void)|null=null;
 constructor(_url:URL){ControlledSocket.instances.push(this);}
 send(value:string){this.sent.push(JSON.parse(value));}
 open(){this.readyState=1;this.onopen?.();}
 message(data:unknown){this.onmessage?.({data:JSON.stringify(data)});}
 close(){if(this.readyState===3)return;this.readyState=3;this.onclose?.();}
 error(){this.onerror?.();}
}
Object.defineProperty(globalThis,'WebSocket',{value:ControlledSocket,configurable:true});
const {createRoot}=await import('react-dom/client');
const vite=await createServer({root:new URL('../',import.meta.url).pathname,configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});
const {CollaborativeNotes}=await vite.ssrLoadModule('/src/features/meetings/collaboration.tsx');
const {LocalizationProvider}=await vite.ssrLoadModule('/src/localization/index.tsx');
const container=document.querySelector('main')!;
const snapshot=Buffer.from(Y.encodeStateAsUpdate(new Y.Doc())).toString('base64');
test.after(async()=>{await vite.close();dom.window.close();});
function fixture(){
 let guard:(()=>string|null)|null=null,unregistered=0;const pending:number[]=[];
 const context={organizationId:'fixture',api:async()=>({data:{ticket:'ticket',document:{epoch:1,snapshot}}}),registerNavigationGuard:(fn:()=>string|null)=>{guard=fn;return()=>{guard=null;unregistered++;}}};
 return {context,pending,getGuard:()=>guard,getUnregistered:()=>unregistered};
}
async function render(f:ReturnType<typeof fixture>){const root=createRoot(container);await act(async()=>root.render(<LocalizationProvider preferences={{locale:'pt-BR'}}><CollaborativeNotes context={f.context} meetingId="meeting" sectionId="section" epoch={1} editable onPending={(n:number)=>f.pending.push(n)}/></LocalizationProvider>));const socket=ControlledSocket.instances.at(-1)!;assert.ok(socket);await act(async()=>{socket.open();socket.message({type:'sync'});});return {root,socket};}
function edit(value:string){const area=container.querySelector('textarea')!;Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value')!.set!.call(area,value);area.dispatchEvent(new dom.window.Event('input',{bubbles:true}));}
test('live pending guard blocks before ACK, ignores unknown ACK, clears on matching ACK, unregisters',async()=>{
 ControlledSocket.instances=[];const f=fixture(),{root,socket}=await render(f);
 try{
  assert.equal(f.getGuard()?.(),null);
  await act(async()=>{edit('Nota pendente');assert.ok(f.getGuard()?.());});
  const update=socket.sent.find(x=>x.type==='update');assert.ok(update?.updateId);assert.equal(f.pending.at(-1),1);
  await act(async()=>socket.message({type:'ack',updateId:'unknown'}));assert.ok(f.getGuard()?.());assert.equal(f.pending.at(-1),1);
  await act(async()=>socket.message({type:'ack',updateId:update.updateId}));assert.equal(f.getGuard()?.(),null);assert.equal(f.pending.at(-1),0);
 }finally{await act(async()=>root.unmount());}
 assert.equal(f.getGuard(),null);assert.equal(f.getUnregistered(),1);
});
test('transport error and reconnection retain pending notes until real ACK',async()=>{
 ControlledSocket.instances=[];const f=fixture(),{root,socket}=await render(f);
 try{
  await act(async()=>edit('Rascunho persistente'));const first=socket.sent.find(x=>x.type==='update');assert.ok(first);
  await act(async()=>socket.error());assert.ok(f.getGuard()?.());assert.equal(f.pending.at(-1),1);
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,1250));});
  const next=ControlledSocket.instances.at(-1)!;assert.notEqual(next,socket);
  await act(async()=>{next.open();next.message({type:'sync'});});
  const resent=next.sent.find(x=>x.type==='update');assert.equal(resent.updateId,first.updateId);assert.ok(f.getGuard()?.());
  await act(async()=>next.message({type:'ack',updateId:resent.updateId}));assert.equal(f.getGuard()?.(),null);
 }finally{await act(async()=>root.unmount());}
});
test('server refusal keeps pending guard and exposes recovery draft',async()=>{
 ControlledSocket.instances=[];const f=fixture(),{root,socket}=await render(f);
 try{
  await act(async()=>edit('Conteúdo que não pode sumir'));
  await act(async()=>socket.message({type:'error',code:'INVALID_UPDATE',recoveryRequired:true}));
  assert.ok(f.getGuard()?.());assert.equal(f.pending.at(-1),1);
  const fields=[...container.querySelectorAll('textarea')];assert.ok(fields.some(field=>field.value==='Conteúdo que não pode sumir'&&field.readOnly));
 }finally{await act(async()=>root.unmount());}
});

test('a fresh same-epoch snapshot remains editable; a real epoch change preserves the draft',async()=>{
 ControlledSocket.instances=[];const f=fixture(),{root,socket}=await render(f);
 try{
  const serverDoc=new Y.Doc();serverDoc.getText('notes').insert(0,'Nota confirmada');
  const confirmed=Buffer.from(Y.encodeStateAsUpdate(serverDoc)).toString('base64');
  await act(async()=>socket.message({type:'sync',document:{epoch:1,sequence:1,snapshot:confirmed}}));
  const area=container.querySelector('textarea')!;
  assert.equal(area.value,'Nota confirmada');assert.equal(area.readOnly,false);
  assert.doesNotMatch(container.textContent!,/Rascunho de recuperação/);
  await act(async()=>socket.message({type:'sync',document:{epoch:2,sequence:0,snapshot:confirmed}}));
  assert.equal(area.readOnly,true);
  assert.ok([...container.querySelectorAll('textarea')].some(field=>field.readOnly&&field.value==='Nota confirmada'));
  assert.match(container.textContent!,/Rascunho de recuperação/);
 }finally{await act(async()=>root.unmount());}
});
