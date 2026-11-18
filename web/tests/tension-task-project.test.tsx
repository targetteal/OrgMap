import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import React,{act} from 'react';
const dom=new JSDOM('<!doctype html><html><body><main></main></body></html>',{url:'http://tension.localhost'});
for(const key of ['window','document','navigator','HTMLElement','HTMLSelectElement','Event'])Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:(dom.window as any)[key],configurable:true});
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
const {createRoot}=await import('react-dom/client');
const vite=await createServer({root:new URL('../',import.meta.url).pathname,configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});
const {TensionTaskForm}=await vite.ssrLoadModule('/src/features/governance/tension-task-form.tsx');
const {LocalizationProvider}=await vite.ssrLoadModule('/src/localization/index.tsx');
const container=document.querySelector('main')!;
const context=(api:any,org='org-a',account='account-a',revision=1,guest=false)=>({organizationId:org,session:{account:{id:account}},bootstrap:{authorizationRevision:revision,membership:{memberType:guest?'GUEST':'MEMBER'}},api} as any);
const manager={id:'manager',title:'Manager project',accessRole:'MANAGER',frozen:false,visibility:'PUBLIC'};
const editor={id:'editor',title:'Editor private',accessRole:'EDITOR',frozen:false,visibility:'PRIVATE'};
const readonly={id:'read',title:'Read only secret',accessRole:'READER',frozen:false,visibility:'PRIVATE'};
const frozen={id:'frozen',title:'Frozen project',accessRole:'EDITOR',frozen:true,visibility:'PUBLIC'};
const archived={id:'archived',title:'Archived project',accessRole:'MANAGER',frozen:false,archived:true,visibility:'PUBLIC'};
const options=()=>[...container.querySelectorAll('option')].map(x=>x.textContent);
const button=(label:string)=>{const b=[...container.querySelectorAll('button')].find(x=>x.textContent===label);assert.ok(b,label);return b;};
async function render(root:any,c:any,onSubmit:(id:string|null)=>Promise<void>,disabled=false){await act(async()=>root.render(<LocalizationProvider preferences={{locale:'en-US'}}><TensionTaskForm context={c} disabled={disabled} onSubmit={onSubmit}/></LocalizationProvider>));}
async function select(value:string){const e=container.querySelector('select')!;await act(async()=>{e.value=value;e.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});}
async function submit(){await act(async()=>button('Create task').click());}
test.after(async()=>{await vite.close();dom.window.close();});

test('offers only writable projects and submits personal or selected project with visibility warning',async()=>{
 const calls:string[]=[];const submissions:(string|null)[]=[];const api=async(path:string)=>{calls.push(path);return {data:{projects:[manager,editor,readonly,frozen,archived]}};};const root=createRoot(container);
 try {await render(root,context(api),async id=>{submissions.push(id);});assert.deepEqual(options(),['Personal task','Manager project · Public in the organization','Editor private · Private']);assert.deepEqual(calls,['/organizations/org-a/work/projects']);
  assert.match(container.textContent!,/task will be personal.*origin in the tension will be recorded/i);await submit();assert.deepEqual(submissions,[null]);
  await select('editor');assert.match(container.textContent!,/tension title will become the task title.*visible to people who can access the project/i);assert.match(container.textContent!,/tension still follows its own permissions/i);await submit();assert.deepEqual(submissions,[null,'editor']);
  await render(root,context(api),async id=>{submissions.push(id);},true);assert.equal(container.querySelector('select')!.disabled,true);await submit();assert.deepEqual(submissions,[null,'editor']);
 } finally {await act(async()=>root.unmount());}
});

test('loading and error disable submit; retry reloads projects',async()=>{
 let resolveFirst:(v:any)=>void=()=>{};let attempts=0;const api=()=>{attempts++;return attempts===1?new Promise(resolve=>{resolveFirst=resolve;}):attempts===2?Promise.reject(Error('denied')):Promise.resolve({data:{projects:[manager]}});};
 const root=createRoot(container),sent:(string|null)[]=[];try{await render(root,context(api),async x=>{sent.push(x);});assert.match(container.textContent!,/Loading projects/);assert.equal(container.querySelector('select')!.disabled,true);await submit();assert.deepEqual(sent,[]);
  await act(async()=>resolveFirst({data:{projects:[manager]}}));assert.equal(container.querySelector('select')!.disabled,false);
  await render(root,context(api,'org-b'),async x=>{sent.push(x);});assert.match(container.textContent!,/could not be loaded/);assert.equal(container.querySelector('select')!.disabled,true);assert.equal(button('Create task').disabled,true);
  await act(async()=>button('Try again').click());assert.match(container.textContent!,/Manager project/);assert.equal(container.querySelector('select')!.disabled,false);
 }finally{await act(async()=>root.unmount());}
});

test('organization, account and authorization revision changes hide old selection and ignore late response',async()=>{
 const waiting=new Map<string,(v:any)=>void>(),calls:{path:string;signal:AbortSignal}[]=[];
 const api=(path:string,{signal}:{signal:AbortSignal})=>{calls.push({path,signal});return new Promise(resolve=>waiting.set(`${path}:${calls.length}`,resolve));};const root=createRoot(container),sent:(string|null)[]=[];
 try{
  await render(root,context(api),async x=>{sent.push(x);});await act(async()=>waiting.get('/organizations/org-a/work/projects:1')!({data:{projects:[manager]}}));await select('manager');
  await render(root,context(api,'org-a','account-b',1),async x=>{sent.push(x);});assert.doesNotMatch(container.textContent!,/Manager project/);assert.equal(container.querySelector('select')!.value,'');
  await render(root,context(api,'org-b','account-b',1),async x=>{sent.push(x);});assert.equal(calls[1].signal.aborted,true);
  await act(async()=>waiting.get('/organizations/org-a/work/projects:2')!({data:{projects:[{...manager,title:'Old account private'}]}}));assert.doesNotMatch(container.textContent!,/Old account private/);
  await act(async()=>waiting.get('/organizations/org-b/work/projects:3')!({data:{projects:[editor]}}));assert.match(container.textContent!,/Editor private/);await select('editor');
  await render(root,context(api,'org-b','account-b',2),async x=>{sent.push(x);});assert.doesNotMatch(container.textContent!,/Editor private/);assert.equal(container.querySelector('select')!.value,'');assert.equal(button('Create task').disabled,true);
  await act(async()=>waiting.get('/organizations/org-b/work/projects:4')!({data:{projects:[]}}));await submit();assert.deepEqual(sent,[null]);
 }finally{await act(async()=>root.unmount());}
});

test('Guest does not request projects, including when membership changes without an authorization revision change',async()=>{
 let calls=0;const api=async()=>{calls++;return {data:{projects:[manager]}};};const root=createRoot(container);
 try{await render(root,context(api,'org-a','account-a',1,true),async()=>{});assert.equal(calls,0);assert.equal(container.querySelector('select')!.disabled,true);
  await render(root,context(api,'org-a','account-a',1,false),async()=>{});assert.equal(calls,1);assert.match(container.textContent!,/Manager project/);
  await render(root,context(api,'org-a','account-a',1,true),async()=>{});assert.equal(calls,1);assert.doesNotMatch(container.textContent!,/Manager project/);assert.equal(container.querySelector('select')!.disabled,true);
 }finally{await act(async()=>root.unmount());}
});
test('downgrade to Guest immediately hides previously loaded project selection',async()=>{
 let calls=0;const api=async()=>{calls++;return {data:{projects:[manager]}};};const root=createRoot(container);const sent:(string|null)[]=[];
 try{await render(root,context(api),async x=>{sent.push(x);});await select('manager');assert.match(container.textContent!,/Manager project/);
  await render(root,context(api,'org-a','account-a',1,true),async x=>{sent.push(x);});assert.equal(calls,1);assert.doesNotMatch(container.textContent!,/Manager project/);assert.equal(container.querySelector('select')!.disabled,true);await submit();assert.deepEqual(sent,[]);
 }finally{await act(async()=>root.unmount());}
});
