import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import React, { act } from "react";
const dom=new JSDOM('<!doctype html><html><body><main></main></body></html>',{url:'http://branding.localhost'});
for(const key of ['window','document','navigator','HTMLElement','HTMLInputElement','Event','File','Blob']) Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:(dom.window as any)[key],configurable:true});
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
Object.defineProperty(globalThis,'createImageBitmap',{value:async (f:File)=>({width:f.name.includes('small')?100:2200,height:f.name.includes('small')?100:1600,close(){}}),configurable:true});
const urls=URL.createObjectURL, revoke=URL.revokeObjectURL;
URL.createObjectURL=()=>`blob:test-${Math.random()}`;URL.revokeObjectURL=()=>{};
const {createRoot}=await import('react-dom/client');
const vite=await createServer({root:new URL('../',import.meta.url).pathname,configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});
const {BrandingSettings}=await vite.ssrLoadModule('/src/features/administration/branding-settings.tsx');
const {RequestError}=await vite.ssrLoadModule('/src/api.ts');
const container=document.querySelector('main')!;
const purposes=['WORKSPACE_LOGO','EMAIL_LOGO','LOGIN_BACKGROUND'];
const asset=(purpose:string,revision=0,origin='NONE')=>({purpose,revision,origin,state:origin==='UPLOADED'?'READY':'EMPTY',width:null,height:null,mime:null,updatedAt:null,readUrl:null});
const section=(title:string)=>{const el=[...container.querySelectorAll('section')].find(s=>s.querySelector('h3')?.textContent===title);assert.ok(el);return el;};
const button=(el:Element,label:string)=>{const b=[...el.querySelectorAll('button')].find(x=>x.textContent===label);assert.ok(b, label);return b;};
async function select(el:Element,name:string,type='image/png') {const input=el.querySelector('input[type=file]') as HTMLInputElement; const file=new dom.window.File(['fixture'],name,{type});Object.defineProperty(input,'files',{configurable:true,value:[file]});await act(async()=>input.dispatchEvent(new dom.window.Event('change',{bubbles:true})));return file;}
test.after(async()=>{URL.createObjectURL=urls;URL.revokeObjectURL=revoke;await vite.close();dom.window.close();});
test('fundo exige dimensões e confirmação explícita antes de publicar',async()=>{
  const calls:any[]=[];const transport={list:async()=>({assets:purposes.map(p=>asset(p)),ready:true}),read:async()=>new Blob(),upload:async(...args:any[])=>{calls.push(args);return asset(args[0],1,'UPLOADED');},remove:async()=>{throw Error('unexpected');}};
  const root=createRoot(container);try{await act(async()=>root.render(<BrandingSettings organizationId="a" transport={transport}/>));const el=section('Fundo de acesso');await select(el,'small.png');assert.match(el.textContent!,/pelo menos 2000/);await select(el,'large.png');assert.equal(button(el,'Salvar imagem').disabled,true);const checkbox=el.querySelector('input[type=checkbox]') as HTMLInputElement;await act(async()=>checkbox.click());assert.equal(button(el,'Salvar imagem').disabled,false);await act(async()=>button(el,'Salvar imagem').click());assert.equal(calls.length,1);assert.equal(calls[0][0],'LOGIN_BACKGROUND');assert.equal(calls[0][2],0);assert.equal(calls[0][3],true);assert.match(el.textContent!,/Imagem salva/);}finally{await act(async()=>root.unmount());}
});
test('conflito preserva arquivo e exige atualizar revisão antes de nova tentativa',async()=>{
  let revision=0;const calls:any[]=[];const transport={list:async()=>({assets:purposes.map(p=>asset(p,p==='WORKSPACE_LOGO'?revision:0)),ready:true}),read:async()=>new Blob(),upload:async(...args:any[])=>{calls.push(args);if(calls.length===1){revision=2;throw new RequestError('VERSION_CONFLICT','conflict');}return asset(args[0],3,'UPLOADED');},remove:async()=>{throw Error('unexpected');}};
  const root=createRoot(container);try{await act(async()=>root.render(<BrandingSettings organizationId="a" transport={transport}/>));const el=section('Logotipo do espaço de trabalho');const file=await select(el,'logo.png');await act(async()=>button(el,'Salvar imagem').click());assert.match(el.textContent!,/outra sessão/);assert.match(el.textContent!,/logo.png/);assert.equal(button(el,'Salvar imagem').disabled,true);await act(async()=>button(el,'Atualizar versão').click());assert.match(el.textContent!,/logo.png/);await act(async()=>button(el,'Salvar imagem').click());assert.equal(calls[1][1],file);assert.equal(calls[1][2],2);assert.notEqual(calls[0][4],calls[1][4]);}finally{await act(async()=>root.unmount());}
});
test('troca de organização descarta rascunhos e leitura anterior',async()=>{
  let resolveOld:(value:any)=>void=()=>{};const old={list:(signal:AbortSignal)=>new Promise(resolve=>{resolveOld=resolve;signal.addEventListener('abort',()=>{});}),read:async()=>new Blob(),upload:async()=>asset('WORKSPACE_LOGO'),remove:async()=>asset('WORKSPACE_LOGO')};
  const next={...old,list:async()=>({assets:purposes.map(p=>asset(p)),ready:true})};const root=createRoot(container);
  try{await act(async()=>root.render(<BrandingSettings organizationId="a" transport={old}/>));await act(async()=>root.render(<BrandingSettings organizationId="b" transport={next}/>));await act(async()=>resolveOld({assets:[asset('WORKSPACE_LOGO',77,'LEGACY_EXTERNAL')],ready:true}));assert.doesNotMatch(container.textContent!,/Versão 77/);assert.equal(container.querySelectorAll('input[type=file]').length,3);}finally{await act(async()=>root.unmount());}
});
test('remoção usa revisão atual e conserva a imagem ao falhar; nova tentativa reutiliza a chave',async()=>{
  const keys:string[]=[];const transport={list:async()=>({assets:purposes.map(p=>asset(p,p==='EMAIL_LOGO'?4:0,p==='EMAIL_LOGO'?'UPLOADED':'NONE')),ready:true}),read:async()=>new Blob(),upload:async()=>{throw Error('unexpected');},remove:async(p:string,rev:number,key:string)=>{assert.equal(p,'EMAIL_LOGO');assert.equal(rev,4);keys.push(key);if(keys.length===1)throw Error('offline');return asset(p,5,'NONE');}};
  const root=createRoot(container);try{await act(async()=>root.render(<BrandingSettings organizationId="a" transport={transport}/>));const el=section('Logotipo dos e-mails');assert.match(el.textContent!,/prévia indisponível/);await act(async()=>button(el,'Remover imagem').click());assert.match(el.textContent!,/Confira a conexão/);assert.ok(button(el,'Remover imagem'));await act(async()=>button(el,'Remover imagem').click());assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);assert.match(el.textContent!,/Imagem removida/);assert.match(el.textContent!,/Versão 5/);}finally{await act(async()=>root.unmount());}
});
test('troca de idioma preserva arquivo, consentimento e conflito, com controles nos oito idiomas',async()=>{
 let revision=0;const calls:any[]=[];const transport={list:async()=>({assets:purposes.map(p=>asset(p,p==='LOGIN_BACKGROUND'?revision:0)),ready:true}),read:async()=>new Blob(),upload:async(...args:any[])=>{calls.push(args);revision=2;throw new RequestError('VERSION_CONFLICT','conflict');},remove:async()=>{throw Error('unexpected');}};
 const labels=[['pt-BR','Identidade visual','Fundo de acesso','Salvar imagem'],['en-US','Visual identity','Sign-in background','Save image'],['es-ES','Identidad visual','Fondo de acceso','Guardar imagen'],['fr-FR','Identité visuelle','Arrière-plan de connexion','Enregistrer l’image'],['de-DE','Visuelle Identität','Anmeldehintergrund','Bild speichern'],['it-IT','Identità visiva','Sfondo di accesso','Salva immagine'],['ja-JP','ビジュアル設定','ログイン背景','画像を保存'],['nl-NL','Visuele identiteit','Aanmeldachtergrond','Afbeelding opslaan']];
 const root=createRoot(container);try{await act(async()=>root.render(<BrandingSettings organizationId="a" transport={transport} locale="pt-BR"/>));const initial=section('Fundo de acesso');const file=await select(initial,'background.png');await act(async()=>((initial.querySelector('input[type=checkbox]') as HTMLInputElement).click()));await act(async()=>button(initial,'Salvar imagem').click());assert.equal(calls[0][1],file);assert.match(initial.textContent!,/outra sessão/);
 for(const [locale,title,background,save] of labels){await act(async()=>root.render(<BrandingSettings organizationId="a" transport={transport} locale={locale}/>));assert.equal(container.querySelector('h2')?.textContent,title);const el=section(background);assert.match(el.textContent!,/background\.png/);assert.equal((el.querySelector('input[type=checkbox]') as HTMLInputElement).checked,true);assert.equal(button(el,save).disabled,true);assert.ok(el.querySelector('[role=alert]')?.textContent);}
 const el=section('Aanmeldachtergrond');assert.match(el.querySelector('[role=alert]')!.textContent!,/andere sessie/);await act(async()=>button(el,'Versie vernieuwen').click());assert.equal((el.querySelector('input[type=checkbox]') as HTMLInputElement).checked,true);assert.equal(button(el,'Afbeelding opslaan').disabled,false);assert.equal(calls.length,1);
 }finally{await act(async()=>root.unmount());}
});
