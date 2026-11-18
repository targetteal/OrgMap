import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import React,{act} from 'react';
const dom=new JSDOM('<!doctype html><html><body><main></main></body></html>',{url:'http://trace.localhost'});
for(const key of ['window','document','navigator','HTMLElement','Event'])Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:(dom.window as any)[key],configurable:true});
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
const {createRoot}=await import('react-dom/client');
const vite=await createServer({root:new URL('../',import.meta.url).pathname,configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});
const {TraceOrigin,TensionDestinations,TraceReturnLink,traceRoute,safeReturnTo}=await vite.ssrLoadModule('/src/traceability.tsx');
const container=document.querySelector('main')!;
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
const ctx=(api:any,org=a,account=a,guest=false,navigate=(_p:string)=>{})=>({organizationId:org,session:{account:{id:account}},bootstrap:{membership:{memberType:guest?'GUEST':'MEMBER'}},api,navigate,accountPreferences:{locale:'en-US'}} as any);
test.after(async()=>{await vite.close();dom.window.close();});
test('canonical routes validate UUIDs and return targets are internal and whitelisted',()=>{
 assert.equal(traceRoute({kind:'GOAL',id:a,title:'Goal'}),`/goals/${a}`);
 assert.equal(safeReturnTo(`/structure/working-agreements/${a}`),`/structure/working-agreements/${a}`);
 assert.equal(traceRoute({kind:'AGENDA',id:a,meetingId:b,title:'Agenda'},`/projects/tasks/${a}`),`/meetings/${b}?step=agenda&returnTo=${encodeURIComponent(`/projects/tasks/${a}`)}`);
 assert.equal(traceRoute({kind:'AGENDA',id:a,meetingId:'../evil',title:'X'}),null);
 for(const bad of ['https://evil.invalid/','//evil.invalid/','/\\evil.invalid','/goals/../account','/goals/'+a+'?returnTo=https://evil.invalid','/structure/tensions?tensionId='+a+'&next=//evil.invalid'])assert.equal(safeReturnTo(bad),null,bad);
});
test('origin navigates using a computed route and disabled links cannot navigate',async()=>{
 let path='';const api=async()=>({data:{origin:{kind:'TENSION',id:a,title:'Origin title',url:'https://evil.invalid'}}});const context=ctx(api,a,a,false,p=>path=p);const root=createRoot(container);
 try{await act(async()=>root.render(<TraceOrigin context={context} endpoint={`/organizations/${a}/work/tasks/${a}/origin`} returnTo={`/projects/tasks/${b}`}/>));assert.match(container.textContent!,/Origin title/);await act(async()=>container.querySelector('button')!.click());assert.equal(path,`/structure/tensions?tensionId=${a}&returnTo=${encodeURIComponent(`/projects/tasks/${b}`)}`);path='';await act(async()=>root.render(<TraceOrigin context={context} endpoint={`/organizations/${a}/work/tasks/${a}/origin`} disabled/>));await act(async()=>container.querySelector('button')!.click());assert.equal(path,'');}finally{await act(async()=>root.unmount());}
});
test('account or organization switch hides old data immediately and ignores delayed replies',async()=>{
 let resolveOld:(value:any)=>void=()=>{};const old=()=>new Promise(resolve=>{resolveOld=resolve;});const next=async()=>({data:{origin:{kind:'TASK',id:b,title:'New account'}}});const root=createRoot(container);
 try{await act(async()=>root.render(<TraceOrigin context={ctx(old)} endpoint={`/organizations/${a}/work/tasks/${a}/origin`}/>));await act(async()=>root.render(<TraceOrigin context={ctx(next,b,b)} endpoint={`/organizations/${b}/work/tasks/${b}/origin`}/>));await act(async()=>resolveOld({data:{origin:{kind:'TASK',id:a,title:'Private A'}}}));assert.match(container.textContent!,/New account/);assert.doesNotMatch(container.textContent!,/Private A/);}finally{await act(async()=>root.unmount());}
});
test('Guest never calls endpoint, destination list skips malformed items, and return is safe',async()=>{
 let calls=0,path='';const api=async()=>{calls++;return {data:{items:[{kind:'GOAL',id:a,title:'First'},{kind:'AGENDA',id:b,title:'Missing meeting'},{kind:'TASK',id:'bad',title:'Bad'}]}}};const root=createRoot(container);
 try{await act(async()=>root.render(<TensionDestinations context={ctx(api,a,a,true)} endpoint={`/organizations/${a}/work/tasks/${a}/origin`}/>));assert.equal(calls,0);await act(async()=>root.render(<TensionDestinations context={ctx(api,a,a,false,p=>path=p)} endpoint={`/organizations/${a}/work/tasks/${a}/origin`}/>));assert.equal(container.querySelectorAll('button').length,1);await act(async()=>container.querySelector('button')!.click());assert.equal(path,`/goals/${a}`);await act(async()=>root.render(<TraceReturnLink context={ctx(api,a,a,false,p=>path=p)} returnTo="//evil.invalid"/>));assert.equal(container.querySelector('button'),null);}finally{await act(async()=>root.unmount());}
});
test('switching accounts hides a previously rendered origin and rejects another tenant endpoint',async()=>{
 let resolveNext:(value:any)=>void=()=>{},calls=0;const api=async()=>{calls++;return calls===1?{data:{origin:{kind:'TASK',id:a,title:'Previous account secret'}}}:new Promise(resolve=>{resolveNext=resolve;});};
 const root=createRoot(container),endpoint=`/organizations/${a}/work/tasks/${a}/origin`;
 try{
  await act(async()=>root.render(<TraceOrigin context={ctx(api,a,a)} endpoint={endpoint}/>));assert.match(container.textContent!,/Previous account secret/);
  await act(async()=>root.render(<TraceOrigin context={ctx(api,a,b)} endpoint={endpoint}/>));assert.doesNotMatch(container.textContent!,/Previous account secret/);
  await act(async()=>root.render(<TraceOrigin context={ctx(api,b,b)} endpoint={endpoint}/>));assert.equal(calls,2);
  await act(async()=>resolveNext({data:{origin:{kind:'TASK',id:a,title:'Late account secret'}}}));assert.doesNotMatch(container.textContent!,/account secret/);
 }finally{await act(async()=>root.unmount());}
});
test('proposal and goal origin endpoints load only for the current organization',async()=>{
 const calls:string[]=[];const api=async(path:string)=>{calls.push(path);return {data:{origin:{kind:'TENSION',id:a,title:'Authorized origin'}}};};const root=createRoot(container);
 try {
  for(const kind of ['proposals','goals']){
   const endpoint=`/organizations/${a}/${kind}/${b}/origin`;
   await act(async()=>root.render(<TraceOrigin context={ctx(api)} endpoint={endpoint}/>));
   assert.match(container.textContent!,/Authorized origin/);assert.ok(container.querySelector('.trace-links .trace-links__link'));
   assert.equal(calls.at(-1),endpoint);
  }
  await act(async()=>root.render(<TraceOrigin context={ctx(api,b)} endpoint={`/organizations/${a}/goals/${b}/origin`}/>));
  assert.equal(calls.length,2);assert.doesNotMatch(container.textContent!,/Authorized origin/);
 } finally {await act(async()=>root.unmount());}
});
test('an authorization refresh hides previously visible references and rechecks the same endpoint',async()=>{
 let resolveNext:(value:any)=>void=()=>{},calls=0;
 const api=async()=>++calls===1?{data:{origin:{kind:'TENSION',id:a,title:'Previously authorized title'}}}:new Promise(resolve=>{resolveNext=resolve;});
 const root=createRoot(container),endpoint=`/organizations/${a}/work/tasks/${b}/origin`;
 const first=ctx(api);first.bootstrap.authorizationRevision=1;
 const next={...first,bootstrap:{...first.bootstrap,authorizationRevision:2}};
 try{
  await act(async()=>root.render(<TraceOrigin context={first} endpoint={endpoint}/>));
  assert.match(container.textContent!,/Previously authorized title/);
  await act(async()=>root.render(<TraceOrigin context={next} endpoint={endpoint}/>));
  assert.doesNotMatch(container.textContent!,/Previously authorized title/);
  assert.equal(calls,2);
  await act(async()=>resolveNext({data:{origin:null}}));
  assert.equal(container.querySelector('button'),null);
 }finally{await act(async()=>root.unmount());}
});
