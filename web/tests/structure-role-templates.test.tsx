import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';

test('Reusable role templates edit real template with version and preserves draft on conflict',async()=>{
 const dom=new JSDOM('<!doctype html><main></main>',{url:'http://qa.localhost/structure/advanced'});
 for(const key of ['window','document','navigator','HTMLElement','HTMLInputElement','HTMLDialogElement','Element','Node','Event','FormData','MutationObserver','DOMParser','DocumentFragment','Range'])Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:(dom.window as any)[key],configurable:true});
 Object.defineProperty(globalThis,'getComputedStyle',{value:dom.window.getComputedStyle.bind(dom.window),configurable:true});
 Object.defineProperty(globalThis,'requestAnimationFrame',{value:(fn:FrameRequestCallback)=>setTimeout(()=>fn(0),0),configurable:true});
 Object.defineProperty(globalThis,'cancelAnimationFrame',{value:(id:number)=>clearTimeout(id),configurable:true});
 Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false};
 const {createRoot}=await import('react-dom/client');const vite=await createServer({root:new URL('../',import.meta.url).pathname,configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});
 const {feature}=await vite.ssrLoadModule('/src/features/structure-advanced/index.tsx');const {RequestError}=await vite.ssrLoadModule('/src/api.ts');const {LocalizationProvider}=await vite.ssrLoadModule('/src/localization/index.tsx');
 const rich={format:'orgmap-richtext',version:1,doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Propósito persistido'}]}]}};
 const flags={core:true,electable:false,assigner:true,representative:false,admin:false};
 const catalog={templates:[{id:'template-id',name:'Papel original',purposeRich:rich,flags,version:7}],fields:[],roleSettings:[],indicators:[],views:[],snapshots:[],capabilities:{configure:true}};
 let fail=true,guard:(()=>string|null)|null=null;const writes:{path:string;options:any}[]=[];
 const context={organizationId:'org',path:'/structure/advanced',hash:'',session:{account:{id:'account'}},bootstrap:{organization:{id:'org'},membership:{id:'m',memberType:'MEMBER',orgRole:'OWNER'},capabilities:{},modules:{}},structure:{nodes:[],occupancies:[],memberships:[]},members:[],navigate(){},refresh(){},notify(){},registerNavigationGuard:(fn:()=>string|null)=>{guard=fn;return()=>{if(guard===fn)guard=null}},api:async(path:string,options?:any)=>{if(options?.method){writes.push({path,options});if(fail)throw new RequestError('VERSION_CONFLICT','Conflito de versão');return {data:{}}}if(path.endsWith('/catalog'))return {data:fail&&writes.length ? {...catalog,templates:[{...catalog.templates[0],name:'Versão remota',version:8}]} : catalog};if(path.endsWith('/graph'))return {data:{entities:[]}};throw Error('unexpected '+path)}};
 const root=createRoot(document.querySelector('main')!);
 try{
  await act(async()=>root.render(<LocalizationProvider preferences={{locale:'pt-BR'}}><feature.Component context={context}/></LocalizationProvider>));
  assert.match(document.querySelector('#role-templates')!.textContent!,/independentes das funções essenciais O2/);
  await act(async()=> (document.querySelector('button[aria-label="Editar modelo de papel Papel original"]') as HTMLButtonElement).click());
  assert.match(guard?.()??'',/Salve ou feche/);
  const dialog=document.querySelector('dialog')!,input=dialog.querySelector('input[name="name"]') as HTMLInputElement;
  assert.equal(input.value,'Papel original');assert.equal((dialog.querySelector('input[name="core"]') as HTMLInputElement).checked,true);
  assert.equal((dialog.querySelector('input[name="assigner"]') as HTMLInputElement).checked,true);
  await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(input,'Papel revisado');input.dispatchEvent(new dom.window.Event('input',{bubbles:true}))});
  await act(async()=>dialog.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(writes.length,1);assert.equal(writes[0].path,'/organizations/org/structure-advanced/templates/template-id');assert.equal(writes[0].options.method,'PATCH');assert.equal(writes[0].options.version,7);assert.deepEqual(writes[0].options.body,{name:'Papel revisado',purposeRich:rich,flags});
  assert.equal(input.value,'Papel revisado');assert.ok(document.querySelector('dialog'));
  assert.equal((dialog.querySelector('.form-actions button.primary') as HTMLButtonElement).disabled,true);
  const action=(text:string)=>[...dialog.querySelectorAll('button')].find(button=>button.textContent?.trim()===text)!;
  await act(async()=>action('Consultar versão atual').click());assert.match(dialog.textContent!,/Versão remota/);assert.equal(input.value,'Papel revisado');
  await act(async()=>action('Usar esta versão e manter meu rascunho').click());assert.equal(input.value,'Papel revisado');
  fail=false;await act(async()=>dialog.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(document.querySelector('dialog'),null);assert.equal(writes.length,2);assert.equal(writes[1].options.version,8);
 }finally{await act(async()=>root.unmount());await vite.close();dom.window.close()}
});
