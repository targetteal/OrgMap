import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import React,{act} from 'react';

const dom=new JSDOM('<!doctype html><html><body><main></main></body></html>',{url:'http://account.localhost/account/general'});
for(const key of ['window','document','navigator','HTMLElement','HTMLInputElement','Event','FormData'])
 Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:(dom.window as any)[key],configurable:true});
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
const {createRoot}=await import('react-dom/client');
const vite=await createServer({root:new URL('../',import.meta.url).pathname,configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});
const {AccountPage}=await vite.ssrLoadModule('/src/account/index.tsx');
const {LocalizationProvider}=await vite.ssrLoadModule('/src/localization/index.tsx');
const originalFetch=globalThis.fetch;
const data=(value:unknown)=>new Response(JSON.stringify({data:value}),{headers:{'Content-Type':'application/json'}});
const account={id:'synthetic-account',email:'ana@example.test',displayName:'Ana',version:3,passwordEnabled:true};
const preferences={locale:'es-ES',timeZone:'America/Sao_Paulo',dateFormat:'DD/MM/YYYY',theme:'light',reducedMotion:false,version:2};
test.after(async()=>{globalThis.fetch=originalFetch;await vite.close();dom.window.close();});

test('profile, password dialog and sessions use the account locale without sending commands',async()=>{
 const calls:string[]=[];
 globalThis.fetch=async(url,options={})=>{
  const path=String(url),method=String((options as RequestInit).method??'GET');calls.push(`${method} ${path}`);
  if(path.endsWith('/api/v1/account'))return data({account,authMethods:[{id:'password',kind:'PASSWORD',label:'Password',enabled:true,verified:true}]});
  if(path.endsWith('/api/v1/account/preferences'))return data({preferences});
  if(path.endsWith('/api/v1/auth/sessions'))return data({items:[{id:'current',createdAt:'2026-11-01T10:00:00Z',expiresAt:'2026-11-08T10:00:00Z',current:true,version:1},{id:'other',createdAt:'2026-11-02T10:00:00Z',expiresAt:'2026-11-09T10:00:00Z',current:false,version:1}]});
  if(path.endsWith('/api/v1/account/email-change/requests'))return data({items:[]});
  if(path.endsWith('/api/v1/account/mfa'))return data({enabled:false});
  throw Error(`Unexpected request: ${method} ${path}`);
 };
 const container=dom.window.document.querySelector('main')!,root=createRoot(container);
 const render=(locale:string,path:string)=>act(async()=>root.render(<LocalizationProvider preferences={{locale}}><AccountPage key={`${locale}:${path}`} path={path} navigate={()=>{}} notify={()=>{}} /></LocalizationProvider>));
 try{
  await render('es-ES','/account/general');
  assert.match(container.textContent!,/Información personal/);
  assert.match(container.textContent!,/Cambiar correo electrónico/);
  assert.ok(container.querySelector('input[value="ana@example.test"]')?.hasAttribute('readonly'));
  await render('es-ES','/account/security');
  assert.match(container.textContent!,/Métodos de autenticación/);
  const change=[...container.querySelectorAll('button')].find(button=>button.textContent?.trim()==='Cambiar contraseña');
  assert.ok(change);
  await act(async()=>change.click());
  assert.match(dom.window.document.body.textContent!,/Nueva contraseña/);
  assert.match(dom.window.document.body.textContent!,/Usa al menos 12 caracteres/);
  assert.ok(dom.window.document.querySelector('dialog button[aria-label="Cerrar"]'));
  await render('ja-JP','/account/sessions');
  assert.match(container.textContent!,/アカウントのセッション/);
  assert.match(container.textContent!,/現在のセッション/);
  assert.match(container.textContent!,/セッションを終了/);
  await render('ja-JP','/account/general');
  assert.match(container.textContent!,/メールアドレスを変更/);
  assert.match(container.textContent!,/新しいメールアドレス/);
  assert.ok(calls.every(call=>call.startsWith('GET ')),calls.join('\n'));
 }finally{await act(async()=>root.unmount());}
});
