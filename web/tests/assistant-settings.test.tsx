import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import React,{act} from 'react';
const dom=new JSDOM('<!doctype html><html><body><main></main></body></html>',{url:'http://assistant.localhost'});
for(const key of ['window','document','navigator','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Event','KeyboardEvent'])Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:(dom.window as any)[key],configurable:true});
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
const {createRoot}=await import('react-dom/client');
const vite=await createServer({root:new URL('../',import.meta.url).pathname,configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});
const {AssistantSettings}=await vite.ssrLoadModule('/src/features/administration/assistant-settings.tsx');
const {RequestError}=await vite.ssrLoadModule('/src/api.ts');
const {LocalizationProvider}=await vite.ssrLoadModule('/src/localization/index.tsx');
const {assistantTranslator}=await vite.ssrLoadModule('/src/features/administration/assistant-messages.ts');
const container=document.querySelector('main')!;
const tab=(label:string)=>{const el=[...container.querySelectorAll('[role=tab]')].find(x=>x.textContent===label) as HTMLButtonElement;assert.ok(el);return el;};
const button=(label:string)=>{const el=[...container.querySelectorAll('button')].find(x=>x.textContent===label) as HTMLButtonElement;assert.ok(el,label);return el;};
const apiContext=(api:any,org='a')=>({organizationId:org,api} as any);
const statusData={data:{capabilities:{configuration:true,execution:false,rag:false},usage:{status:'NO_DATA',requests:null,tokens:null}}};
const result=(instructions='',revision=0)=>({data:{settings:{revision,instructions,updatedAt:null}}});
async function edit(value:string){const el=container.querySelector('textarea')!;await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});}
test.after(async()=>{await vite.close();dom.window.close();});
test('configuração pessoal salva e mostra execução bloqueada e uso sem dados',async()=>{
  const calls:any[]=[];const api=async(path:string,options:any={})=>{calls.push({path,options});if(path.endsWith('/status'))return statusData;if(options.method==='PUT')return result(options.body.instructions,1);return result();};
  const root=createRoot(container);try{await act(async()=>root.render(<AssistantSettings context={apiContext(api)}/>));assert.equal(button('Ativar assistente').disabled,true);await act(async()=>tab('Preferências').click());await edit('Meu contexto');await act(async()=>button('Salvar alterações').click());const save=calls.find(x=>x.options.method==='PUT');assert.equal(save.options.version,0);assert.equal(save.options.body.instructions,'Meu contexto');assert.ok(save.options.key);assert.match(container.textContent!,/Instruções salvas/);await act(async()=>tab('Uso').click());assert.match(container.textContent!,/Dados de uso ainda não estão disponíveis/);assert.doesNotMatch(container.textContent!,/0 tokens/);await act(async()=>tab('Base de conhecimento').click());assert.equal(button('Ativar base de conhecimento').disabled,true);}finally{await act(async()=>root.unmount());}
});
test('conflito mantém rascunho e atualização preserva texto com nova revisão',async()=>{
  let rev=0,attempts=0;const api=async(path:string,o:any={})=>{if(path.endsWith('/status'))return statusData;if(o.method==='PUT'){attempts++;if(attempts===1){rev=2;throw new RequestError('VERSION_CONFLICT','conflict');}assert.equal(o.version,2);assert.equal(o.body.instructions,'rascunho');return result('rascunho',3);}return result('atual',rev);};
  const root=createRoot(container);try{await act(async()=>root.render(<AssistantSettings context={apiContext(api)}/>));await act(async()=>tab('Preferências').click());await edit('rascunho');await act(async()=>button('Salvar alterações').click());assert.match(container.textContent!,/outra sessão/);assert.equal((container.querySelector('textarea') as HTMLTextAreaElement).value,'rascunho');await act(async()=>button('Atualizar versão').click());assert.equal((container.querySelector('textarea') as HTMLTextAreaElement).value,'rascunho');await act(async()=>button('Salvar alterações').click());assert.match(container.textContent!,/Versão 3/);}finally{await act(async()=>root.unmount());}
});
test('falha de permissão workspace preserva privacidade e controles de salvar ausentes',async()=>{
  const api=async(path:string)=>{if(path.endsWith('/status'))return statusData;if(path.endsWith('/workspace'))throw new RequestError('ACTION_DENIED','denied');return result('minhas');};const root=createRoot(container);
  try{await act(async()=>root.render(<AssistantSettings context={apiContext(api)}/>));await act(async()=>tab('Instruções').click());assert.match(container.textContent!,/não tem permissão/);assert.equal(container.querySelector('textarea'),null);assert.equal([...container.querySelectorAll('button')].some(x=>x.textContent==='Salvar alterações'),false);}finally{await act(async()=>root.unmount());}
});
test('troca de organização cancela dados anteriores e teclado navega entre abas',async()=>{
  let resolveOld:(x:any)=>void=()=>{};const old=async(path:string)=>path.endsWith('/personal')?new Promise(resolve=>{resolveOld=resolve;}):path.endsWith('/status')?statusData:result();const next=async(path:string)=>path.endsWith('/status')?statusData:result('novo');const root=createRoot(container);
  try{await act(async()=>root.render(<AssistantSettings context={apiContext(old,'a')}/>));await act(async()=>root.render(<AssistantSettings context={apiContext(next,'b')}/>));await act(async()=>resolveOld(result('SEGREDO A')));await act(async()=>tab('Ativação').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})));assert.equal(tab('Preferências').getAttribute('aria-selected'),'true');assert.equal((container.querySelector('textarea') as HTMLTextAreaElement).value,'novo');assert.doesNotMatch(container.textContent!,/SEGREDO A/);}finally{await act(async()=>root.unmount());}
});

test('os oito idiomas atualizam as cinco abas e mantêm capacidades bloqueadas',async()=>{
 const api=async(path:string)=>path.endsWith('/status')?statusData:result('contexto');const root=createRoot(container);
 try{for(const locale of ['pt-BR','en-US','es-ES','fr-FR','de-DE','it-IT','ja-JP','nl-NL']){
  const t=assistantTranslator(locale);
  await act(async()=>root.render(<LocalizationProvider preferences={{locale}}><AssistantSettings context={apiContext(api)}/></LocalizationProvider>));
  assert.ok(container.querySelector(`[aria-label="${t('title')}"]`));
  for(const name of ['activation','preferences','instructions','knowledge','usage']) assert.ok(tab(t(name)));
  await act(async()=>tab(t('activation')).click());assert.equal(button(t('activate')).disabled,true);assert.ok(container.textContent?.includes(t('activationHelp')));
  await act(async()=>tab(t('preferences')).click());assert.ok(container.textContent?.includes(t('personalHelp')));assert.equal((container.querySelector('textarea') as HTMLTextAreaElement).value,'contexto');
  await act(async()=>tab(t('instructions')).click());assert.ok(container.textContent?.includes(t('workspaceHelp')));
  await act(async()=>tab(t('knowledge')).click());assert.ok(container.textContent?.includes(t('knowledgeHelp')));assert.equal(button(t('activateKnowledge')).disabled,true);
  await act(async()=>tab(t('usage')).click());assert.ok(container.textContent?.includes(t('usageHelp')));
 }}finally{await act(async()=>root.unmount());}
});
