import test from "node:test";
import assert from "node:assert/strict";
import React,{act,useState} from "react";
import {JSDOM} from "jsdom";
import type {FeatureContext} from "../../feature-contract";
import {TaskViewControls,type SavedTaskView,type TaskViewConfig} from "./task-view-controls";
const dom=new JSDOM("<!doctype html><body><main></main></body>",{url:"http://localhost",pretendToBeVisual:true});
for(const key of ["window","document","navigator","HTMLElement","HTMLInputElement","HTMLSelectElement","Node","Event"])Object.defineProperty(globalThis,key,{value:key==="window"?dom.window:(dom.window as any)[key],configurable:true});
Object.defineProperty(globalThis,"IS_REACT_ACT_ENVIRONMENT",{value:true,configurable:true});
const {createRoot}=await import("react-dom/client");
test("task view gallery, circle filters, priority, archive mode and visible properties survive remount with versioned personal order",async()=>{
  let stored:SavedTaskView[]=[],version=0;
  const manual={current:null as ((ids:string[])=>Promise<boolean>)|null};
  const c={organizationId:"org",members:[{id:"person",displayName:"Ana",status:"ACTIVE"}],structure:{nodes:[{kind:"CIRCLE",entityId:"circle",nodeId:"cn",name:"Pesquisa"},{kind:"ROLE",entityId:"role",nodeId:"rn",parentNodeId:"cn",name:"Entrega"}]},api:async(path:string,options:any={})=>{assert.ok(path.includes("/work/task-views"));if(options.method==="POST"){assert.equal(options.version,version);assert.equal(options.body.projectId,"project");stored=options.body.views;version++;}return{data:{views:stored,version}};},notify:()=>{}} as unknown as FeatureContext;
  let observed:TaskViewConfig;
  function Harness(){const [current,setCurrent]=useState<TaskViewConfig>({view:"LIST",query:"",sort:"POSITION",grouping:"SECTION",personFilter:"",roleFilter:"",circleFilter:"",statusFilter:"",tagFilter:"",visibleProperties:["state","participants","due"],archived:false,archiveMode:"ACTIVE",orderIds:[]});observed=current;return <><button onClick={()=>setCurrent((v)=>({...v,view:"GALLERY"}))}>Galeria</button><TaskViewControls context={c} projectId="project" current={current} onChange={(patch)=>setCurrent((v)=>({...v,...patch}))} states={[{id:"TODO",name:"A fazer"}]} onError={(error)=>{throw Error(error);}} manualOrderRef={manual}/></>;}
  const button=(name:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button)=>(button.getAttribute("aria-label") ?? button.textContent)===name)!;
  const field=(name:string)=>Array.from(document.querySelectorAll("label.field")).find((label)=>label.firstChild?.textContent===name)?.querySelector("input,select") as HTMLInputElement|HTMLSelectElement;
  const change=async(input:HTMLInputElement|HTMLSelectElement,value:string)=>{await act(async()=>{Object.getOwnPropertyDescriptor(input instanceof HTMLInputElement?dom.window.HTMLInputElement.prototype:dom.window.HTMLSelectElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new dom.window.Event(input instanceof HTMLInputElement?"input":"change",{bubbles:true}));});};
  let root=createRoot(document.querySelector("main")!);
  try{
    await act(async()=>root.render(<Harness/>));
    await act(async()=>button("Galeria").click());
    await act(async()=>button("Filtros de tarefas").click());
    await change(field("Papel"),"role");await change(field("Círculo"),"circle");
    await act(async()=>button("Vista de tarefas").click());
    await change(field("Agrupar tarefas"),"CIRCLE");await change(field("Ordenar tarefas"),"PRIORITY");await change(field("Mostrar tarefas"),"ALL");
    const stateProperty=Array.from(document.querySelectorAll(".mare-property-options label")).find((label)=>label.textContent==="Estado")!.querySelector<HTMLInputElement>("input")!;
    await act(async()=>stateProperty.click());
    await act(async()=>button("Vistas de tarefas").click());
    await change(field("Nome da vista"),"Entregas de pesquisa");
    await act(async()=>document.querySelector(".mare-catalog-popover form")!.dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true})));
    assert.equal(stored[0].view,"GALLERY");assert.equal(stored[0].sort,"PRIORITY");assert.equal(stored[0].grouping,"CIRCLE");assert.equal(stored[0].circleFilter,"circle");assert.equal(stored[0].roleFilter,"role");assert.equal(stored[0].archiveMode,"ALL");assert.deepEqual(stored[0].visibleProperties,["participants","due"]);
    await act(async()=>root.unmount());root=createRoot(document.querySelector("main")!);
    await act(async()=>root.render(<Harness/>));
    assert.equal(observed!.view,"GALLERY");assert.equal(observed!.archiveMode,"ALL");assert.equal(observed!.roleFilter,"role");assert.deepEqual(observed!.visibleProperties,["participants","due"]);
    await act(async()=>{assert.equal(await manual.current!(["second","first"]),true);});
    assert.deepEqual(stored[0].orderIds,["second","first"]);assert.equal(version,2);
  }finally{await act(async()=>root.unmount());}
});
