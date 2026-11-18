import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import React,{act} from 'react';
const dom=new JSDOM('<!doctype html><main></main>',{url:'http://qa.localhost'});
for(const key of ['window','document','navigator','HTMLElement','Event','FormData'])Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:(dom.window as any)[key],configurable:true});
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
const {createRoot}=await import('react-dom/client');
const vite=await createServer({root:new URL('../',import.meta.url).pathname,configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});
const {feature}=await vite.ssrLoadModule('/src/features/platform/index.tsx');
const {LocalizationProvider}=await vite.ssrLoadModule('/src/localization/index.tsx');
const Component=feature.Component,container=document.querySelector('main')!;
test.after(async()=>{await vite.close();dom.window.close();});
test('notification switches use localized visible event names and retain focus after save and reload',async()=>{
 let enabled=true,version=1;const commands:any[]=[];
 const context={organizationId:'org',path:'/platform/preferences',session:{account:{id:'account'}},bootstrap:{membership:{id:'member',memberType:'MEMBER'}},navigate(){},notify(){},api:async(_path:string,options:any={})=>{
  if(options.method==='POST'){commands.push(options);enabled=options.body.enabled;version++;return{data:{}};}
  return {data:{version,items:[],policies:[],events:[{event:'ConsentWindowOpened',module:'structure',label:'Prazo de objeções iniciado',description:'Descrição',effective:{EMAIL:{enabled,origin:'USER'},IN_APP:{enabled:true,origin:'DEFAULT'}}},{event:'RoleAssigned',module:'structure',label:'Atribuição de papel',description:'Descrição',effective:{EMAIL:{enabled:true,origin:'DEFAULT'},IN_APP:{enabled:true,origin:'DEFAULT'}}}]}};
 }};
 const root=createRoot(container);
 const render=(locale:string)=>act(async()=>root.render(<LocalizationProvider preferences={{locale}}><Component context={context}/></LocalizationProvider>));
 try {
  await render('pt-BR');
  const email=container.querySelector<HTMLButtonElement>('[role=switch][aria-label="E-mail: Prazo de objeções iniciado"]')!;
  assert.ok(email);assert.ok(container.querySelector('[role=switch][aria-label="Aplicativo: Prazo de objeções iniciado"]'));
  assert.ok(container.querySelector('[role=switch][aria-label="E-mail: Configurações globais · Estrutura"]'));
  assert.equal([...container.querySelectorAll('[role=switch]')].some(el=>el.getAttribute('aria-label')!.includes('ConsentWindowOpened')),false);
  email.focus();await act(async()=>email.click());
  assert.equal(commands.length,1);assert.deepEqual(commands[0].body,{event:'ConsentWindowOpened',channel:'EMAIL',enabled:false});assert.equal(commands[0].version,1);
  assert.equal(email.isConnected,true);assert.equal(document.activeElement,email);assert.equal(email.getAttribute('aria-checked'),'false');
  await act(async()=>root.unmount());
  const second=createRoot(container);
  try {await act(async()=>second.render(<LocalizationProvider preferences={{locale:'en-US'}}><Component context={context}/></LocalizationProvider>));
   assert.ok(container.querySelector('[role=switch][aria-label="Email: Objection period started"]'));
   assert.ok(container.querySelector('[role=switch][aria-label="In-app: Role assigned"]'));
   assert.ok(container.querySelector('[role=switch][aria-label="Email: Global settings · Structure"]'));
   assert.equal(container.querySelector('[role=switch][aria-label="Email: Objection period started"]')?.getAttribute('aria-checked'),'false');
  }finally{await act(async()=>second.unmount());}
 }finally{dom.window.document.querySelector('main')!.replaceChildren();}
});

test('delayed save restores incidental focus loss and respects deliberate movement to another control',async()=>{
 for (const moveFocus of [false,true]) {
 let enabled=true,version=1,resolvePost!:()=>void,resolveRefresh!:()=>void,gets=0;
 const postGate=new Promise<void>(resolve=>{resolvePost=resolve;}),refreshGate=new Promise<void>(resolve=>{resolveRefresh=resolve;});
 const api=async(_path:string,options:any={})=>{
  if(options.method==='POST'){await postGate;enabled=options.body.enabled;version++;return{data:{}};}
  if(++gets>1)await refreshGate;
  return {data:{version,items:[],policies:[],events:[{event:'ConsentWindowOpened',module:'structure',label:'Prazo de objeções iniciado',description:'Descrição',effective:{EMAIL:{enabled,origin:'USER'},IN_APP:{enabled:true,origin:'DEFAULT'}}}]}};
 };
 const {useState}=React;
 function Harness(){const [,setToast]=useState('');const context={organizationId:'org',path:'/platform/preferences',session:{account:{id:'account'}},bootstrap:{membership:{id:'member',memberType:'MEMBER'}},navigate(){},notify(value:string){setToast(value);},api};return <LocalizationProvider preferences={{locale:'pt-BR'}}><Component context={context}/><button id="elsewhere">Outro controle</button></LocalizationProvider>;}
 const root=createRoot(container);
 try{
  await act(async()=>root.render(<Harness/>));
  const selector='[role=switch][aria-label="E-mail: Prazo de objeções iniciado"]';
  const original=container.querySelector<HTMLButtonElement>(selector)!;original.focus();
  await act(async()=>original.click());assert.equal(document.activeElement,original);
  await act(async()=>resolvePost());assert.equal(document.activeElement,original);assert.equal(original.isConnected,true);
  Object.defineProperty(document,'hasFocus',{value:()=>true,configurable:true});
  const elsewhere=container.querySelector<HTMLButtonElement>('#elsewhere')!;
  if (moveFocus) elsewhere.focus(); else original.blur();
  assert.equal(document.activeElement,moveFocus?elsewhere:document.body);
  await act(async()=>resolveRefresh());
  assert.equal(container.querySelector(selector),original);
  assert.equal(document.activeElement,moveFocus?elsewhere:original);assert.equal(original.getAttribute('aria-checked'),'false');
 }finally{await act(async()=>root.unmount());}
 }
});

test('workspace preferences focus the linked event and keep channel locks, follow controls and reset independent',async()=>{
 const organization='11111111-1111-4111-8111-111111111111',resource='22222222-2222-4222-8222-222222222222';
 let email=true,following=true,version=1,resetResolve!:()=>void;const commands:{path:string;options:any}[]=[];
 const context={organizationId:organization,path:'/platform/preferences?organizationId='+organization+'&event=GoalAssigned',session:{account:{id:'account'}},bootstrap:{membership:{id:'member',memberType:'MEMBER'}},navigate(){},notify(){},api:async(path:string,options:any={})=>{
  if(options.method==='POST'){
   commands.push({path,options});
   if(path.endsWith('/preferences/reset'))await new Promise<void>(resolve=>{resetResolve=resolve;});
   else if(path.endsWith('/follow'))following=options.body.enabled;
   else {email=options.body.enabled;version++;}
   return{data:{}};
  }
  return{data:{locale:'es-ES',version,items:[],policies:[],events:[{event:'GoalAssigned',module:'goals',label:'Objetivo asignado',description:'Cuando recibes un objetivo',effective:{EMAIL:{enabled:email,origin:'USER'},IN_APP:{enabled:false,origin:'LOCK'}}}],follows:[{resourceType:'project',resourceId:resource,resourceTitle:'Proyecto Horizonte',enabled:following,destination:'/projects/'+resource+'?organizationId='+organization}]}};
 }};
 const root=createRoot(container);
 try {
  await act(async()=>root.render(<LocalizationProvider preferences={{locale:'pt-BR'}}><Component context={context}/></LocalizationProvider>));
  assert.equal(container.querySelector('h1')?.textContent,'Notificaciones');
  assert.equal(container.querySelector('[role=tab][aria-selected=true]')?.textContent,'Objetivos');
  assert.equal(document.activeElement,container.querySelector('[data-notification-event=GoalAssigned]'));assert.equal(commands.length,0);
  const emailButton=container.querySelector<HTMLButtonElement>('[role=switch][aria-label="Correo: Objetivo asignado"]')!,appButton=container.querySelector<HTMLButtonElement>('[role=switch][aria-label="Aplicación: Objetivo asignado"]')!;
  assert.ok(appButton.disabled);assert.match(container.textContent??'',/Regla de la organización/);await act(async()=>appButton.click());assert.equal(commands.length,0);
  await act(async()=>emailButton.click());assert.deepEqual(commands[0].options.body,{event:'GoalAssigned',channel:'EMAIL',enabled:false});assert.equal(emailButton.getAttribute('aria-checked'),'false');
  const unfollow=container.querySelector<HTMLButtonElement>('[aria-label="Dejar de seguir: Proyecto Horizonte"]')!;await act(async()=>unfollow.click());assert.equal(commands[1].path,'/organizations/'+organization+'/platform/resources/project/'+resource+'/follow');assert.deepEqual(commands[1].options.body,{enabled:false});assert.ok(container.querySelector('[aria-label="Seguir: Proyecto Horizonte"]'));
  const reset=[...container.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='Restaurar valores')!;
  await act(async()=>{reset.click();reset.click();});assert.equal(commands.filter(command=>command.path.endsWith('/preferences/reset')).length,1);assert.ok(reset.disabled);await act(async()=>resetResolve());assert.equal(reset.disabled,false);
 }finally{await act(async()=>root.unmount());}
});
