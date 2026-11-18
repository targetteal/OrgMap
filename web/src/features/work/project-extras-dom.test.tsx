import test from "node:test";
import assert from "node:assert/strict";
import React,{act,useState} from "react";
import {JSDOM} from "jsdom";
import type {FeatureContext} from "../../feature-contract";
import {CustomFieldInputs,customFieldsPayload,type CustomFieldValue} from "./custom-field-inputs";
import {ProjectChecklists,ExternalWorkLinks,ProjectCopyActions,type ProjectChecklist,type ExternalWorkLink} from "./project-extras";

const dom=new JSDOM("<!doctype html><body><main></main></body>",{url:"http://localhost",pretendToBeVisual:true});
for(const key of ["window","document","navigator","localStorage","HTMLElement","HTMLInputElement","HTMLSelectElement","HTMLTextAreaElement","MutationObserver","DOMParser","Node","Event","FormData","getComputedStyle"])Object.defineProperty(globalThis,key,{value:key==="window"?dom.window:(dom.window as any)[key],configurable:true});
Object.defineProperty(globalThis,"IS_REACT_ACT_ENVIRONMENT",{value:true,configurable:true});
const {createRoot}=await import("react-dom/client");
const context={organizationId:"org",session:{account:{id:"account"}}} as FeatureContext;
const button=(label:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button)=>button.textContent===label)!;
async function change(input:HTMLInputElement|HTMLTextAreaElement,value:string){await act(async()=>{const prototype=input instanceof HTMLTextAreaElement?dom.window.HTMLTextAreaElement.prototype:dom.window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,"value")!.set!.call(input,value);input.dispatchEvent(new dom.window.Event("input",{bubbles:true}));});}

test("typed values retain numbers and dates, clear a configured key, and preserve legacy text",async()=>{
  const number="00000000-0000-4000-8000-000000000001",date="00000000-0000-4000-8000-000000000002",select="00000000-0000-4000-8000-000000000003";
  const c={...context,api:async()=>({data:{definitions:[{id:number,name:"Custo",type:"NUMBER",options:[]},{id:date,name:"Marco",type:"DATE",options:[]},{id:select,name:"Grupo",type:"SELECT",options:["A","B"]}]}})} as unknown as FeatureContext;
  const root=createRoot(document.querySelector("main")!);
  try{
    await act(async()=>root.render(<form><CustomFieldInputs context={c} value={{[number]:0,[date]:"2026-11-01",[select]:"A",Critério:"Evidência"}}/></form>));
    const input=document.querySelector<HTMLInputElement>(`input[name="typedField:${number}"]`)!;
    assert.equal(input.type,"number");assert.equal(input.value,"0");input.value="3.5";
    document.querySelector<HTMLSelectElement>(`select[name="typedField:${select}"]`)!.value="";
    const payload=customFieldsPayload(new dom.window.FormData(document.querySelector("form")!) as FormData);
    assert.equal(payload[number],3.5);assert.equal(typeof payload[number],"number");assert.equal(payload[date],"2026-11-01");assert.equal(payload.Critério,"Evidência");assert.equal(Object.hasOwn(payload,select),false);
  }finally{await act(async()=>root.unmount());}
});

test("grouped checklist drafts survive a refused command and commit as project/task content without marking tasks done",async()=>{
  let stored:ProjectChecklist[]=[],reject=true,calls=0,lastPath="";
  function Harness({type="project"}:{type?:"project"|"task"}){
    const [version,setVersion]=useState(1),[groups,setGroups]=useState(stored);
    return <ProjectChecklists context={context} type={type} project={{id:"item",version,[type==="project"?"projectChecklists":"taskChecklists"]:groups}} editable pending={false} command={async(path,body,v,method)=>{calls++;lastPath=path;assert.equal(v,version);assert.equal(method,"PATCH");if(reject)return null;stored=(body as {checklists:ProjectChecklist[]}).checklists;setGroups(stored);setVersion(version+1);return{project:{version:version+1}};}}/>;
  }
  let root=createRoot(document.querySelector("main")!);
  try{
    await act(async()=>root.render(<Harness/>));
    await act(async()=>button("Checklist").click());
    await act(async()=>button("Adicionar passo").click());
    const step=document.querySelector<HTMLInputElement>(".mare-checklist-step .field input")!;
    await change(step,"Preparar o encontro");
    await act(async()=>document.querySelector<HTMLInputElement>(".mare-checklist-step > input")!.click());
    await act(async()=>button("Salvar checklists").click());
    assert.equal(calls,1);assert.ok(button("Salvar checklists"));assert.equal(step.value,"Preparar o encontro");
    reject=false;
    await act(async()=>button("Salvar checklists").click());
    assert.equal(lastPath,"/projects/item/checklists");assert.equal(stored[0].items[0].done,true);assert.ok(!button("Salvar checklists"));
    await act(async()=>root.unmount());root=createRoot(document.querySelector("main")!);
    await act(async()=>root.render(<Harness type="task"/>));
    assert.equal(document.querySelector<HTMLInputElement>(".mare-checklist-step .field input")!.value,"Preparar o encontro");
    await act(async()=>document.querySelector<HTMLInputElement>(".mare-checklist-step > input")!.click());
    await act(async()=>button("Salvar checklists").click());
    assert.equal(lastPath,"/tasks/item/checklists");
  }finally{await act(async()=>root.unmount());}
});

test("reference links validate HTTP URLs and template publication has an explicit content review control",async()=>{
  const commands:{path:string;body:unknown}[]=[];
  function Links(){const [links,setLinks]=useState<ExternalWorkLink[]>([]);return <ExternalWorkLinks type="project" id="p" version={3} links={links} editable pending={false} command={async(path,body)=>{commands.push({path,body});setLinks((body as {links:ExternalWorkLink[]}).links);return{};}}/>;}
  const root=createRoot(document.querySelector("main")!);
  try{
    await act(async()=>root.render(<><Links/><ProjectCopyActions project={{id:"p",title:"Projeto privado",version:3}} command={async(path,body)=>{commands.push({path,body});return{template:{id:"t"}};}} pending={false} templateAllowed onDuplicate={()=>{}}/></>));
    await act(async()=>button("Link").click());
    const url=document.querySelector<HTMLInputElement>('input[name="url"]')!;url.value="javascript:alert(1)";
    await act(async()=>document.querySelector(".mare-external-links form")!.dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true})));
    assert.equal(commands.length,0);assert.ok(document.querySelector('[role="alert"]'));
    url.value="https://example.com/referencia";
    await act(async()=>document.querySelector(".mare-external-links form")!.dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true})));
    assert.equal(commands[0].path,"/projects/p/links");assert.equal(document.querySelector<HTMLAnchorElement>(".mare-reference-link a")!.rel,"noopener noreferrer");
    await act(async()=>button("Salvar como modelo").click());
    const publish=document.querySelector<HTMLFormElement>(".mare-project-copy form")!;
    assert.equal(publish.checkValidity(),false);
    assert.ok(publish.textContent?.includes("informações privadas"));
    publish.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked=true;
    assert.equal(publish.checkValidity(),true);
    await act(async()=>publish.dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true})));
    assert.equal(commands[1].path,"/projects/p/template");assert.deepEqual(commands[1].body,{name:"Projeto privado"});
  }finally{await act(async()=>root.unmount());}
});

test("switching projects isolates dirty checklist and reference drafts by identity and restores the original draft",async()=>{
  const writes:{path:string;body:unknown}[]=[];
  function Harness(){const [id,setId]=useState("identity-a");return <><button onClick={()=>setId("identity-a")}>Abrir A</button><button onClick={()=>setId("identity-b")}>Abrir B</button><ProjectChecklists context={context} project={{id,version:1,projectChecklists:[]}} editable pending={false} command={async(path,body)=>{writes.push({path,body});return{};}}/><ExternalWorkLinks draftKey={"link-draft:"+id} type="project" id={id} version={1} editable pending={false} command={async(path,body)=>{writes.push({path,body});return{};}}/></>;}
  const root=createRoot(document.querySelector("main")!);
  try{
    await act(async()=>root.render(<Harness/>));
    await act(async()=>button("Checklist").click());
    await change(document.querySelector<HTMLInputElement>(".mare-checklist-title input")!,"Somente A");
    await act(async()=>button("Link").click());
    await change(document.querySelector<HTMLInputElement>('input[name="url"]')!,"https://example.com/a");
    await act(async()=>button("Abrir B").click());
    assert.equal(document.querySelectorAll(".mare-checklist-group").length,0);
    assert.ok(!button("Salvar checklists"));assert.equal(document.querySelector('input[name="url"]'),null);
    await act(async()=>button("Abrir A").click());
    assert.equal(document.querySelector<HTMLInputElement>(".mare-checklist-title input")!.value,"Somente A");
    assert.equal(document.querySelector<HTMLInputElement>('input[name="url"]')!.value,"https://example.com/a");
    await act(async()=>button("Salvar checklists").click());
    assert.equal(writes[0].path,"/projects/identity-a/checklists");
    assert.equal(writes.some((write)=>write.path.includes("identity-b")),false);
  }finally{await act(async()=>root.unmount());}
});
