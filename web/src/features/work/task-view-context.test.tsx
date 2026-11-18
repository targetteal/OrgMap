import test from "node:test";
import assert from "node:assert/strict";
import {registerHooks} from "node:module";
import React,{act} from "react";
import {JSDOM} from "jsdom";
import type {FeatureContext} from "../../feature-contract";
const dom=new JSDOM("<!doctype html><body><main></main></body>",{url:"http://localhost",pretendToBeVisual:true});
for(const key of ["window","document","navigator","localStorage","HTMLElement","HTMLDialogElement","HTMLInputElement","HTMLSelectElement","HTMLTextAreaElement","Node","Event","DOMParser","FormData","MutationObserver","getComputedStyle"])Object.defineProperty(globalThis,key,{value:key==="window"?dom.window:(dom.window as any)[key],configurable:true});
Object.defineProperty(globalThis,"IS_REACT_ACT_ENVIRONMENT",{value:true,configurable:true});
registerHooks({load(url,options,next){return url.endsWith(".css")?{format:"module",source:"export {};",shortCircuit:true}:next(url,options);}});
const {createRoot}=await import("react-dom/client");
const {feature}=await import("./index");
const Component=feature.Component as React.ComponentType<{context:FeatureContext;embeddedProject:boolean}>;
dom.window.HTMLDialogElement.prototype.show = function () { this.setAttribute("open", ""); };
dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); this.dataset.testModal = "true"; };
dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); delete this.dataset.testModal; };

test("changing a task preserves the selected named view and filters through the real Work refresh",async()=>{
  const projectId="00000000-0000-4000-8000-000000000001",taskId="00000000-0000-4000-8000-000000000002",memberId="00000000-0000-4000-8000-000000000003";
  const project={id:projectId,title:"Projeto",description:"",creatorId:memberId,version:1,views:["LIST","BOARD"],accessRole:"MANAGER",visibility:"PRIVATE",tags:[],taskStates:[],frozen:false};
  let task={id:taskId,projectId,title:"Alvo",description:"",creatorId:memberId,version:1,status:"TODO",parentId:null,sectionId:null,startsAt:null,endsAt:null,assigneeIds:[],tags:[]},viewReads=0,updates=0;
  const viewA={id:"view-a",name:"Vista A",view:"BOARD",query:"",sort:"TITLE",grouping:"STATUS",personFilter:"",roleFilter:"",circleFilter:"",statusFilter:"",tagFilter:"",visibleProperties:["state","participants","due"],archived:false,archiveMode:"ACTIVE",orderIds:[]};
  const api=async(path:string,options:any={})=>{
    let data:any;
    if(path.endsWith("/task-views?projectId="+projectId)){viewReads++;data={views:[viewA,{...viewA,id:"view-b",name:"Vista B",view:"GALLERY",query:"Alvo",grouping:"NONE"}],version:1};}
    else if(path.endsWith("/settings"))data={settings:{version:1,lockProjectConfiguration:false}};
    else if(path.endsWith("/layout?projectId="+projectId))data={layout:{view:"LIST",sort:"POSITION",grouping:"SECTION",version:1}};
    else if(path.endsWith("/projects"))data={projects:[project]};
    else if(path.endsWith("/projects/"+projectId))data={project,sections:[],access:[],capabilities:{edit:true,manage:true,assign:true,configurationLocked:false}};
    else if(path.endsWith("/tasks?projectId="+projectId))data={tasks:[task]};
    else if(path.endsWith("/tasks/"+taskId)&&options.method==="PATCH"){updates++;task={...task,...options.body,version:task.version+1};data={task};}
    else if(path.endsWith("/tasks/"+taskId))data={task,capabilities:{edit:false,assign:false},checklist:[],dependencies:[],links:[],groups:[],subtasks:[]};
    else if(path.endsWith("/tasks"))data={tasks:[task]};
    else throw Error(`Unexpected Work request ${path}`);
    return{data};
  };
  const c={organizationId:"org",path:"/projects/"+projectId,session:{account:{id:"account"}},bootstrap:{membership:{id:memberId,orgRole:"MEMBER",memberType:"MEMBER"}},structure:{nodes:[],memberships:[],occupancies:[]},members:[],api,notify:()=>{},navigate:()=>{}} as unknown as FeatureContext;
  window.innerWidth = 1025;
  const root=createRoot(document.querySelector("main")!);
  try{
    await act(async()=>root.render(<Component context={c} embeddedProject/>));
    const button=(name:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button)=>(button.getAttribute("aria-label") ?? button.textContent)===name)!;
    await act(async()=>button("Vistas de tarefas").click());
    await act(async()=>button("Vista B").click());
    assert.ok(document.querySelector(".mare-task-gallery"));
    assert.equal(document.querySelector<HTMLInputElement>(".work-search")!.value,"Alvo");
    const move=document.querySelector<HTMLDetailsElement>('.mare-move-menu')!;
    move.open=true;
    await act(async()=>Array.from(move.querySelectorAll<HTMLButtonElement>("button")).find((button)=>button.textContent==="Em andamento")!.click());
    assert.equal(updates,1);
    assert.equal(task.status,"IN_PROGRESS");
    assert.ok(document.querySelector(".mare-task-gallery"),"the selected gallery must survive server refresh");
    assert.equal(document.querySelector<HTMLInputElement>(".work-search")!.value,"Alvo");
    assert.equal(viewReads,1,"refresh must retain the mounted view controller instead of reapplying Vista A");
    const selection=document.querySelector<HTMLInputElement>('.mare-task-gallery [aria-label="Selecionar Alvo"]')!;
    assert.ok(selection);await act(async()=>selection.click());
    assert.ok(document.querySelector(".mare-bulk-actions"),"task card selection exposes bulk actions in gallery");
    await act(async()=>button("Limpar seleção").click());
    await act(async()=>button("Quadro").click());
    await act(async()=>button("Vista de tarefas").click());
    const grouping=Array.from(document.querySelectorAll('label')).find(label=>label.textContent?.includes('Agrupar tarefas'))!.querySelector('select')!;
    assert.match(grouping.textContent!,/Agrupar por seção/);
    assert.match(grouping.textContent!,/Agrupar por estado/);
    await act(async()=>{grouping.value='STATUS';grouping.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
    assert.match(document.querySelector('.mare-personal-order-note')!.textContent!,/Agrupado por estado/);
    assert.match(document.querySelector('.work-board .work-card')!.textContent!,/Estado: Em andamento/);
    assert.equal(task.status,'IN_PROGRESS');assert.equal(updates,1,'changing grouping does not mutate task state');
    const boardSelection=document.querySelector<HTMLInputElement>('.work-board [aria-label="Selecionar Alvo"]')!;
    assert.ok(boardSelection);await act(async()=>boardSelection.click());
    assert.ok(document.querySelector(".mare-bulk-actions"),"task Kanban uses the same selection and bulk controls");
    const card = document.querySelector<HTMLButtonElement>(".work-board .work-card")!;
    assert.ok(card);
    await act(async () => card.click());
    let drawer = document.querySelector<HTMLDialogElement>(".mare-task-drawer")!;
    assert.ok(drawer.open);
    assert.equal(drawer.dataset.testModal, undefined, "desktop opens the task as a modeless drawer");
    await act(async () => {
      window.innerWidth = 1024;
      window.dispatchEvent(new dom.window.Event("resize"));
    });
    assert.equal(document.querySelector(".mare-task-drawer"), drawer, "crossing the breakpoint preserves the open task");
    assert.equal(drawer.dataset.testModal, "true", "compact widths use the native modal path");
    assert.equal(document.activeElement?.getAttribute("aria-label"), "Fechar tarefa");
    await act(async () => drawer.dispatchEvent(new dom.window.Event("cancel", { cancelable: true })));
    assert.equal(document.querySelector(".mare-task-drawer"), null);
    assert.equal(document.activeElement, card, "closing the modal restores the original card after it leaves the top layer");
    await act(async () => card.click());
    drawer = document.querySelector<HTMLDialogElement>(".mare-task-drawer")!;
    assert.equal(drawer.dataset.testModal, "true", "direct compact opening also uses the native modal path");
  }finally{await act(async()=>root.unmount());}
});

test("resource denial, transient failure and guest access remain distinct across route changes", async()=>{
  const {RequestError}=await import("../../api");
  const projectId="00000000-0000-4000-8000-000000000101", taskId="00000000-0000-4000-8000-000000000102", siblingId="00000000-0000-4000-8000-000000000103";
  let targetFailure: string | null = "RESOURCE_NOT_FOUND", supportingFailure = false, navigated="";
  const task={id:taskId, title:"Compartilhada", projectId:null, status:"TODO", archived:true, version:1, description:"", tags:[]};
  const api=async(path:string)=>{
    if(path.endsWith("/projects/"+projectId) || path.endsWith("/tasks/"+siblingId) || path.endsWith("/tasks/"+taskId)) {
      if(targetFailure) throw new RequestError(targetFailure,"private details must not appear");
      return {data:{task,capabilities:{edit:false,assign:false},checklist:[],dependencies:[],links:[],groups:[],subtasks:[]}};
    }
    if(supportingFailure && path.endsWith("/projects")) throw new RequestError("RESOURCE_NOT_FOUND","auxiliary error");
    if(path.endsWith("/projects")) return {data:{projects:[]}};
    if(path.endsWith("/tasks") || path.includes("/tasks?projectId=")) return {data:{tasks:[]}};
    return {data:{}};
  };
  const base={organizationId:"org",session:{account:{id:"account"}},bootstrap:{membership:{id:"guest",orgRole:"MEMBER",memberType:"GUEST"}},structure:{nodes:[],memberships:[],occupancies:[]},members:[],api,notify:()=>{},navigate:(path:string)=>{navigated=path;}} as unknown as FeatureContext;
  const root=createRoot(document.querySelector("main")!);
  const render=async(path:string)=>{await act(async()=>root.render(<Component context={{...base,path}} embeddedProject={false}/>));};
  try{
    await render("/projects/"+projectId);
    assert.match(document.body.textContent!,/Conteúdo indisponível/);
    assert.doesNotMatch(document.body.textContent!,/private details|tarefas compartilhadas\s*0|Pesquisar tarefas/);
    assert.equal(document.querySelector(".work-toolbar"),null);
    assert.equal(Array.from(document.querySelectorAll("button")).some((b)=>b.textContent==="Tentar novamente"),false);
    await act(async()=>document.querySelector<HTMLButtonElement>(".work-resource-actions button")!.click());
    assert.equal(navigated,"/projects/tasks");
    targetFailure="NETWORK_ERROR";
    await render("/projects/tasks/"+siblingId);
    assert.match(document.body.textContent!,/Não foi possível carregar/);
    assert.ok(Array.from(document.querySelectorAll("button")).some((b)=>b.textContent==="Tentar novamente"));
    targetFailure=null;
    await act(async()=>Array.from(document.querySelectorAll("button")).find((b)=>b.textContent==="Tentar novamente")!.click());
    assert.match(document.body.textContent!,/Compartilhada/);
    assert.ok(document.querySelector(".work-sharing-note"));
    assert.equal(document.querySelector(".work-sharing-note.notice"),null);
    targetFailure="RESOURCE_NOT_FOUND";
    await render("/projects/tasks/"+siblingId);
    // Same scope retains its current data until a refresh, while a new target cannot.
    await render("/projects/tasks/"+taskId);
    assert.match(document.body.textContent!,/Conteúdo indisponível/);
    assert.doesNotMatch(document.body.textContent!,/Compartilhada|private details/);
    targetFailure=null; supportingFailure=true;
    await render("/projects/tasks/"+siblingId);
    assert.match(document.body.textContent!,/Não foi possível carregar/);
    assert.doesNotMatch(document.body.textContent!,/Conteúdo indisponível/);
  }finally{await act(async()=>root.unmount());}
});
