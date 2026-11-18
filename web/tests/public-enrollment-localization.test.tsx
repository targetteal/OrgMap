import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import React,{act} from 'react';

const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://enrollment.localhost/enrollment'});
for(const key of ['window','document','navigator','HTMLElement','HTMLInputElement','Event','FormData'])
 Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:(dom.window as any)[key],configurable:true});
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
const {createRoot}=await import('react-dom/client');
const vite=await createServer({root:new URL('../',import.meta.url).pathname,configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});
const {EnrollmentPage}=await vite.ssrLoadModule('/src/features/interoperability/enrollment.tsx');
const {RequestError}=await vite.ssrLoadModule('/src/api.ts');
const container=dom.window.document.querySelector('#root')!;
const token='a'.repeat(64);
async function enter(name:string,value:string){const input=container.querySelector<HTMLInputElement>(`input[name="${name}"]`);assert.ok(input);await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});}
async function submit(){await act(async()=>container.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));}
test.after(async()=>{await vite.close();dom.window.close();});

test('expired code keeps proof in the form and relocalizes the recovery hint',async()=>{
 const calls:Array<{path:string;body:any}>=[];
 const api=async(path:string,options:any)=>{calls.push({path,body:options.body});throw new RequestError('ENROLLMENT_TOKEN_EXPIRED','expired');};
 const root=createRoot(container);
 try{
  await act(async()=>root.render(<EnrollmentPage navigate={()=>{}} api={api as any} locale="es-ES" onLocaleChange={()=>{}}/>));
  assert.match(container.textContent!,/Activar acceso a la organización/);
  await enter('token',token);await submit();
  assert.deepEqual(calls,[{path:'/enrollments/prepare',body:{token}}]);
  assert.match(container.textContent!,/El código ha caducado/);
  assert.equal(container.querySelector<HTMLInputElement>('input[name="token"]')?.value,token);
  assert.equal(dom.window.location.search,'');
  await act(async()=>root.render(<EnrollmentPage navigate={()=>{}} api={api as any} locale="ja-JP" onLocaleChange={()=>{}}/>));
  assert.match(container.textContent!,/コードの有効期限が切れました/);
  assert.equal(container.querySelector<HTMLInputElement>('input[name="token"]')?.value,token);
 }finally{await act(async()=>root.unmount());}
});

test('linking an existing account sends explicit confirmation before preparation',async()=>{
 const calls:Array<{path:string;body:any}>=[];
 const api=async(path:string,options:any)=>{
  calls.push({path,body:options.body});
  if(path==='/enrollments/reauthenticate')return {data:{existingAccountReauth:'synthetic-reauth'}};
  throw new RequestError('ENROLLMENT_INVALID','invalid');
 };
 const root=createRoot(container);
 try{
  await act(async()=>root.render(<EnrollmentPage navigate={()=>{}} api={api as any} locale="es-ES" onLocaleChange={()=>{}}/>));
  await enter('token',token);
  const link=container.querySelector<HTMLInputElement>('.interop-check input[type="checkbox"]');assert.ok(link);
  await act(async()=>link.click());
  await enter('currentPassword','synthetic-current-password');
  const confirm=container.querySelector<HTMLInputElement>('input[name="confirmAccountLink"]');assert.ok(confirm);
  await act(async()=>confirm.click());
  await submit();
  assert.deepEqual(calls,[
   {path:'/enrollments/reauthenticate',body:{token,confirmAccountLink:true,currentPassword:'synthetic-current-password'}},
   {path:'/enrollments/prepare',body:{token,existingAccountReauth:'synthetic-reauth'}},
  ]);
  assert.match(container.textContent!,/El código o la sesión de activación no está disponible/);
  assert.equal(dom.window.location.search,'');
 }finally{await act(async()=>root.unmount());}
});
