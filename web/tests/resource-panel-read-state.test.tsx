import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import React,{act} from 'react';

const dom=new JSDOM('<!doctype html><main></main>',{url:'http://test.localhost'});
for(const key of ['window','document','navigator','HTMLElement','HTMLInputElement','Event','FormData','Node','DOMParser'])Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:(dom.window as any)[key],configurable:true});
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
const {createRoot}=await import('react-dom/client');
const vite=await createServer({root:new URL('../',import.meta.url).pathname,configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});
const {ResourcePanel}=await vite.ssrLoadModule('/src/features/platform/index.tsx');
const {LocalizationProvider}=await vite.ssrLoadModule('/src/localization/index.tsx');
const {RequestError}=await vite.ssrLoadModule('/src/api.ts');
test.after(async()=>{await vite.close();dom.window.close();});

test('resource content remains mounted through permissions and attachments read failures and retries',async()=>{
 let capabilityReads=0,fileReads=0;
 const api=async(path:string)=>{
  if(path.endsWith('/capabilities')){
   if(++capabilityReads<=2)throw new RequestError('INVALID_REQUEST','INVALID_REQUEST');
   return {data:{actions:{read:true,follow:true,comment:false},favorite:false,following:false,exportKinds:[]}};
  }
  if(path.endsWith('/files')){
   if(++fileReads===2)throw new RequestError('INVALID_REQUEST','INVALID_REQUEST');
   return {data:{items:[{id:'file',name:'Referência.pdf',size:1024,mime:'application/pdf'}]}};
  }
  if(path.endsWith('/comments'))return {data:{items:[],page:{hasMore:false,nextCursor:null}}};
  throw Error('Unexpected request: '+path);
 };
 const context={organizationId:'org',bootstrap:{membership:{id:'member',memberType:'MEMBER'}},api,notify(){},navigate(){}};
 const container=document.querySelector('main')!,root=createRoot(container);
 const retry=()=>Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='Tentar novamente')!;
 try{
  await act(async()=>root.render(<LocalizationProvider preferences={{locale:'pt-BR'}}><article><h1>Conteúdo preservado</h1><p>Descrição do recurso</p><ResourcePanel context={context} type="task" resourceId="task"/></article></LocalizationProvider>));
  const article=container.querySelector('article')!;
  assert.match(article.textContent!,/Conteúdo preservado/);
  assert.match(article.textContent!,/Não foi possível carregar as ações e permissões deste recurso/);
  assert.doesNotMatch(article.textContent!,/Revise os campos/);
  await act(async()=>retry().click());
  assert.equal(container.querySelector('article'),article);
  assert.match(article.textContent!,/Descrição do recurso/);
  assert.match(article.textContent!,/Não foi possível carregar os anexos/);
  assert.doesNotMatch(article.textContent!,/Revise os campos/);
  assert.equal(Array.from(article.querySelectorAll('button')).find(b=>b.textContent?.includes('Favoritar'))?.disabled,false);
  await act(async()=>retry().click());
  assert.equal(container.querySelector('article'),article);
  assert.match(article.textContent!,/Referência\.pdf/);
  assert.doesNotMatch(article.textContent!,/Não foi possível carregar os anexos|Revise os campos/);
  assert.equal(fileReads,3);
  assert.ok(capabilityReads>=3);
 }finally{await act(async()=>root.unmount());}
});
