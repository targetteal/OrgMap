import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import React,{act} from 'react';

const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://auth.localhost/forgot-password'});
for(const key of ['window','document','navigator','HTMLElement','HTMLInputElement','Event','FormData'])
 Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:(dom.window as any)[key],configurable:true});
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
const {createRoot}=await import('react-dom/client');
const vite=await createServer({root:new URL('../',import.meta.url).pathname,configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});
const {RecoveryPage}=await vite.ssrLoadModule('/src/account/index.tsx');
const originalFetch=globalThis.fetch;
const container=dom.window.document.querySelector('#root')!;
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
async function enter(name:string,value:string){
 const input=container.querySelector<HTMLInputElement>(`input[name="${name}"]`);assert.ok(input);
 await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
}
async function submit(){await act(async()=>container.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));}
test.after(async()=>{globalThis.fetch=originalFetch;await vite.close();dom.window.close();});

test('Spanish recovery keeps the request generic and never claims local mailbox delivery',async()=>{
 const calls:Array<{url:string;body:any;method:string}>=[];
 globalThis.fetch=async(url,options={})=>{calls.push({url:String(url),body:JSON.parse(String(options.body)),method:String(options.method)});return response({data:{}});};
 const root=createRoot(container);
 try{
  await act(async()=>root.render(<RecoveryPage reset={false} navigate={()=>{}} locale="es-ES" onLocaleChange={()=>{}}/>));
  assert.match(container.textContent!,/Recuperar acceso/);
  assert.equal(container.querySelector('select')?.value,'es-ES');
  await enter('email','synthetic@example.test');await submit();
  assert.deepEqual(calls,[{url:'/api/v1/auth/recovery/request',body:{email:'synthetic@example.test'},method:'POST'}]);
  assert.match(container.textContent!,/Si existe una cuenta con este correo/);
  assert.doesNotMatch(container.textContent!,/local|entregado/i);
 }finally{await act(async()=>root.unmount());}
});

test('Japanese reset preserves token and password payload and announces completion',async()=>{
 const calls:Array<{url:string;body:any}>=[];
 globalThis.fetch=async(url,options={})=>{calls.push({url:String(url),body:JSON.parse(String(options.body))});return response({data:{}});};
 const root=createRoot(container);
 try{
  await act(async()=>root.render(<RecoveryPage reset navigate={()=>{}} locale="ja-JP" onLocaleChange={()=>{}}/>));
  assert.match(container.textContent!,/新しいパスワードを設定/);
  const password=container.querySelector<HTMLInputElement>('input[name="newPassword"]')!;
  assert.equal(password.minLength,12);assert.equal(password.maxLength,1024);
  assert.match(document.getElementById(password.getAttribute('aria-describedby')!)?.textContent??'',/12.*1024/);
  await enter('token','synthetic-recovery-code');await enter('newPassword','synthetic-long-password');await submit();
  assert.deepEqual(calls,[{url:'/api/v1/auth/recovery/complete',body:{token:'synthetic-recovery-code',newPassword:'synthetic-long-password'}}]);
  assert.match(container.querySelector('[role="status"]')?.textContent??'',/パスワードを再設定しました/);
 }finally{await act(async()=>root.unmount());}
});

test('failed recovery keeps the form available with a localized error',async()=>{
 globalThis.fetch=async()=>response({error:{code:'INVALID_REQUEST'}},400);
 const root=createRoot(container);
 try{
  await act(async()=>root.render(<RecoveryPage reset navigate={()=>{}} locale="es-ES" onLocaleChange={()=>{}}/>));
  await enter('token','invalid');await enter('newPassword','synthetic-long-password');await submit();
  assert.match(container.textContent!,/Revisa los campos completados/);
  await enter('newPassword','another-synthetic-password');
  assert.match(container.textContent!,/Revisa los campos completados/);
  assert.ok(container.querySelector('input[name="token"]'));
  await act(async()=>root.render(<RecoveryPage reset navigate={()=>{}} locale="ja-JP" onLocaleChange={()=>{}}/>));
  assert.match(container.textContent!,/入力内容を確認して再試行/);
  assert.doesNotMatch(container.textContent!,/Revisa los campos completados/);
 }finally{await act(async()=>root.unmount());}
});
