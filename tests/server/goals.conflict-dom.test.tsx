import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import type { FeatureContext } from "../../web/src/feature-contract.js";
register(new URL("../../server/modules/goals/test-assets-loader.mjs", import.meta.url));
const dom = new JSDOM('<!doctype html><html><body><main></main></body></html>', {url:"http://goals-dom.localhost"});
for (const key of ["window","document","navigator","HTMLElement","HTMLInputElement","HTMLDialogElement","Event","Node","MutationObserver"])
  Object.defineProperty(globalThis,key,{value:key === "window" ? dom.window : (dom.window as any)[key], configurable:true});
Object.defineProperty(globalThis,"IS_REACT_ACT_ENVIRONMENT",{value:true,configurable:true});
Object.defineProperty(globalThis,"requestAnimationFrame",{value:(callback:FrameRequestCallback)=>{callback(0);return 0;},configurable:true});
dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};
dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");};
const {createRoot}=await import("react-dom/client");
const {LocalizationProvider}=await import("../../web/src/localization/index.js");
const {feature}=await import("../../web/src/features/goals/index.js");
const {goalTranslator}=await import("../../web/src/features/goals/messages.js");
const {RequestError}=await import("../../web/src/api.js");
const goalId="11111111-1111-4111-8111-111111111111", krId="22222222-2222-4222-8222-222222222222";
const container=dom.window.document.querySelector("main")!;
const message="Este registro mudou. Seu rascunho continua no formulário e não foi salvo. Atualize os dados sem fechar; copie o que deseja manter, feche e reabra o formulário para revisar a versão atual.";
function button(name:string, scope:ParentNode=container) {
  const result=[...scope.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent===name);
  assert.ok(result,"Missing button: "+name);return result;
}
async function click(element:HTMLElement) {await act(async()=>element.click());}
async function fill(element:HTMLInputElement|HTMLTextAreaElement,value:string) {
  await act(async()=>{
    const proto=element instanceof dom.window.HTMLInputElement ? dom.window.HTMLInputElement.prototype : dom.window.HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto,"value")!.set!.call(element,value);
    element.dispatchEvent(new dom.window.Event("input",{bubbles:true}));
  });
}
test("Goals conflict keeps the draft, blocks stale resubmit and reloads current data before reopening in all eight locales",async()=>{
 for(const locale of ["pt-BR","en-US","es-ES","fr-FR","de-DE","it-IT","ja-JP","nl-NL"]) {
  const t=goalTranslator(locale);
  let current="4",version=2,writes=0,reads=0,reloadFails=false;
  const stored=()=>({id:goalId,title:"Synthetic goal",ownerType:"MEMBER",ownerId:"member",source:"KEY_RESULTS",manualProgress:"0",krWeight:"100",childWeight:"0",privacy:"PUBLIC",lifecycle:"ACTIVE",health:"ON_TRACK",version,
    progress:{display:Number(current)*10},keyResults:[{id:krId,title:"Synthetic KR",initialValue:"0",targetValue:"10",currentValue:current,resultType:"QUANTITATIVE",weight:"1",health:"ON_TRACK",confidenceLevel:null,version,progress:{display:Number(current)*10}}],children:[],periodIds:[],assignments:[],capabilities:{update:true,configure:true,assign:true,transition:true,link:false,history:true}});
  const api:FeatureContext["api"]=async(path,options)=>{
   if(options?.method) {
    writes++;
    if(writes===1){current="5";version=3;throw new RequestError("VERSION_CONFLICT","VERSION_CONFLICT");}
    assert.equal(options.version,3,"reopened form must use current resource version");
    assert.equal((options.body as any).value,"7");current="7";version=4;
    return {data:stored()} as any;
   }
   reads++;
   if(reloadFails)throw new RequestError("INTERNAL_ERROR","INTERNAL_ERROR");
   const data=path.includes("/goal-periods") ? {items:[]} : path.endsWith("/history") ? {items:[]} : path.includes("/goals?") ? {items:[stored()],page:{nextCursor:null},capabilities:{}} : stored();
   return {data} as any;
  };
  const context={organizationId:"org",path:"/goals/"+goalId,api,bootstrap:{membership:{id:"member",memberType:"MEMBER"}},session:{},structure:{nodes:[],occupancies:[]},members:[],navigate(){},refresh(){},notify(){}} as unknown as FeatureContext;
  const root=createRoot(container);
  try {
   await act(async()=>root.render(<LocalizationProvider preferences={{locale}}><feature.Component context={context}/></LocalizationProvider>));
   await click(button(t("Atualizar progresso")));
   let dialog=container.querySelector("dialog")!;
   await fill(dialog.querySelector("input")!,"6");
   await fill(dialog.querySelector("textarea")!,"Local unsaved comment");
   await click(button(t("Salvar"),dialog));
   assert.match(dialog.textContent!,new RegExp(t(message).replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
   assert.equal(button(t("Salvar"),dialog).disabled,true);
   await act(async()=>dialog.querySelector("form")!.dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true})));
   assert.equal(writes,1,"Enter/submit must not retry stale payload");
   const before=reads;reloadFails=true;
   await click(button(t("Atualizar dados sem fechar"),dialog));
   assert.ok(reads>before);
   assert.equal(dialog.querySelector("input")!.value,"6");
   assert.equal(dialog.querySelector("textarea")!.value,"Local unsaved comment");
   reloadFails=false;
   await click(button(t("Atualizar dados sem fechar"),dialog));
   assert.equal(dialog.querySelector("input")!.value,"6","successful refresh must also preserve unsaved draft");
   assert.equal(button(t("Salvar"),dialog).disabled,true,"refresh must not silently rebase the old payload");
   await click(button(t("Cancelar"),dialog));
   await click(button(t("Atualizar progresso")));
   dialog=container.querySelector("dialog")!;
   assert.equal(dialog.querySelector("input")!.value,"5","reopening shows the concurrent stored value");
   assert.equal(dialog.querySelector("textarea")!.value,"");
   assert.equal(button(t("Salvar"),dialog).disabled,false);
   await fill(dialog.querySelector("input")!,"7");
   await click(button(t("Salvar"),dialog));
   assert.equal(writes,2);assert.equal(current,"7");
  } finally {await act(async()=>root.unmount());container.innerHTML="";}
 }
});

test("Goals category/owner filters send and clear exact query parameters in eight locales, without an owner oracle for Guest",async()=>{
 for(const locale of ["pt-BR","en-US","es-ES","fr-FR","de-DE","it-IT","ja-JP","nl-NL"])for(const guest of [false,true]) {
  const t=goalTranslator(locale),queries:URLSearchParams[]=[];
  const api:FeatureContext["api"]=async(path)=>{
   if(path.includes("/goals?"))queries.push(new URL(path,"http://goals-dom.localhost").searchParams);
   return {data:path.includes("/goals?") ? {items:[],page:{nextCursor:null},capabilities:{}} : {items:[]}} as any;
  };
  const context={organizationId:"org",path:"/goals",api,bootstrap:{membership:{id:"member",memberType:guest?"GUEST":"MEMBER"}},session:{},structure:{nodes:[],occupancies:[]},members:[{id:"member",displayName:"Pessoa literal",status:"ACTIVE"},{id:"inactive",displayName:"Pessoa anterior",status:"SUSPENDED"}],navigate(){},refresh(){},notify(){}} as unknown as FeatureContext;
  const root=createRoot(container);
  const field=(label:string)=>{
   const name=[...container.querySelectorAll<HTMLLabelElement>("label")].find(item=>item.textContent===t(label));
   return name ? container.querySelector<HTMLSelectElement>("#"+name.htmlFor.replaceAll(":","\\:")) : null;
  };
  const select=async(element:HTMLSelectElement,value:string)=>{await act(async()=>{element.value=value;element.dispatchEvent(new dom.window.Event("change",{bubbles:true}));});};
  try {
   await act(async()=>root.render(<LocalizationProvider preferences={{locale}}><feature.Component context={context}/></LocalizationProvider>));
   const filter=[...container.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.getAttribute("aria-label")===t("Filtrar"));assert.ok(filter);
   await click(filter);
   await select(field("Categoria")!,"INDIVIDUAL");
   assert.equal(queries.at(-1)!.get("category"),"INDIVIDUAL");
   if(guest){assert.equal(field("Proprietário"),null);assert.equal(queries.at(-1)!.has("ownerId"),false);}
   else {
    assert.ok([...field("Proprietário")!.options].some(option=>option.value==="inactive"),"filters include inactive previous owners");
    await select(field("Proprietário")!,"member");
    assert.equal(queries.at(-1)!.get("ownerId"),"member");
    assert.equal(queries.at(-1)!.get("category"),"INDIVIDUAL");
   }
   assert.equal(button(t("Limpar filtros")).disabled,false);
   await click(button(t("Limpar filtros")));
   assert.equal(queries.at(-1)!.has("category"),false);assert.equal(queries.at(-1)!.has("ownerId"),false);
   assert.equal(field("Categoria")!.value,"");
   if(!guest)assert.equal(field("Proprietário")!.value,"");
  }finally{await act(async()=>root.unmount());container.innerHTML="";}
 }
});

test("All five KR progress controls preserve decimal or boolean payloads, comments and confidence across eight locales",async()=>{
 for(const locale of ["pt-BR","en-US","es-ES","fr-FR","de-DE","it-IT","ja-JP","nl-NL"])for(const resultType of ["QUANTITATIVE","PERCENTAGE","BINARY","MILESTONE","CUSTOM"]) {
  const t=goalTranslator(locale),boolean=["BINARY","MILESTONE"].includes(resultType);
  let current="0",writes=0;const navigations:string[]=[];
  const stored=()=>({id:goalId,title:"Synthetic goal",ownerType:"MEMBER",ownerId:"member",source:"KEY_RESULTS",manualProgress:"0",krWeight:"100",childWeight:"0",privacy:"PUBLIC",lifecycle:"ACTIVE",health:"ON_TRACK",version:7,
    progress:{display:0},keyResults:[{id:krId,title:"Synthetic KR",initialValue:"0",targetValue:resultType==="BINARY"?"1":"100",currentValue:current,resultType,links:[{kind:"PROJECT",id:"project",title:"Projeto vinculado",titleSource:"FALLBACK"},{kind:"TASK",id:"task",title:"Tarefa vinculada",titleSource:"FALLBACK"},{kind:"PROJECT",id:"literal",title:"Projeto vinculado"}],unit:"unidade literal",weight:"1",health:"ON_TRACK",confidenceLevel:null,version:2,progress:{display:0}}],children:[],periodIds:[],assignments:[],capabilities:{update:true,history:true}});
  const api:FeatureContext["api"]=async(path,options)=>{
   if(options?.method){
    assert.ok(path.endsWith("/key-results/"+krId+"/progress"));assert.equal(options.version,2,"KR version is independent of goal version");
    const body=options.body as any;assert.equal(body.value,boolean?true:"12.5");assert.equal(body.comment,"Comentário literal");assert.equal(body.confidenceLevel,"HIGH");
    current=boolean?(resultType==="BINARY"?"1":"100"):body.value;writes++;return {data:stored()} as any;
   }
   return {data:path.includes("/goals?")?{items:[stored()],page:{nextCursor:null},capabilities:{}}:path.includes("/goal-periods")||path.endsWith("/history")?{items:[]}:stored()} as any;
  };
  const context={organizationId:"org",path:"/goals/"+goalId,api,bootstrap:{membership:{id:"member",memberType:"MEMBER"}},session:{},structure:{nodes:[],occupancies:[]},members:[],navigate(path:string){navigations.push(path);},refresh(){},notify(){}} as unknown as FeatureContext;
  const root=createRoot(container);
  try {
   await act(async()=>root.render(<LocalizationProvider preferences={{locale}}><feature.Component context={context}/></LocalizationProvider>));
   if(resultType === "QUANTITATIVE") {
    await click(button(t("Projeto vinculado")));await click(button(t("Tarefa vinculada")));
    assert.deepEqual(navigations,["/projects/project","/projects/tasks/task"]);
    assert.ok([...container.querySelectorAll("button")].some(item=>item.textContent==="Projeto vinculado"),"resource title remains literal even if it matches a catalog key");
   }
   await click(button(t("Atualizar progresso")));
   const dialog=container.querySelector("dialog")!;
   if(boolean)await act(async()=>{const select=dialog.querySelector("select")!;select.value="true";select.dispatchEvent(new dom.window.Event("change",{bubbles:true}));});
   else await fill(dialog.querySelector("input")!,"12.5");
   const confidence=[...dialog.querySelectorAll("label")].find(label=>label.textContent===t("Confiança"))!;
   await act(async()=>{const select=dom.window.document.getElementById(confidence.htmlFor) as HTMLSelectElement;select.value="HIGH";select.dispatchEvent(new dom.window.Event("change",{bubbles:true}));});
   await fill(dialog.querySelector("textarea")!,"Comentário literal");
   await click(button(t("Salvar"),dialog));
   assert.equal(writes,1);assert.equal(container.querySelector("dialog"),null);
  }finally{await act(async()=>root.unmount());container.innerHTML="";}
 }
});
