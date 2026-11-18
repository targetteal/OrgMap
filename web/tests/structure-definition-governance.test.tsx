import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import React, { act } from "react";

const dom=new JSDOM("<!doctype html><main></main>",{url:"http://qa.localhost"});
for(const key of ["window","document","navigator","HTMLElement","HTMLInputElement","HTMLTextAreaElement","HTMLDialogElement","Event","FormData"])
  Object.defineProperty(globalThis,key,{value:key==="window"?dom.window:(dom.window as any)[key],configurable:true});
Object.defineProperty(globalThis,"IS_REACT_ACT_ENVIRONMENT",{value:true,configurable:true});
dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'));};
const {createRoot}=await import("react-dom/client");
const vite=await createServer({root:new URL("../",import.meta.url).pathname,configFile:false,logLevel:"error",server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:"custom"});
const {MeetingProposalEditor}=await vite.ssrLoadModule("/src/features/governance/index.tsx");
const {LocalizationProvider}=await vite.ssrLoadModule("/src/localization/index.tsx");
test.after(async()=>{await vite.close();dom.window.close();});
const circle="11111111-1111-4111-8111-111111111111",role="22222222-2222-4222-8222-222222222222",meeting="33333333-3333-4333-8333-333333333333";
const responsibility={id:"44444444-4444-4444-8444-444444444444",text:"Review agreements"};
const artifact={id:"55555555-5555-4555-8555-555555555555",text:"Brand"};
const rich={format:"orgmap-richtext",version:1,doc:{type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"Purpose",marks:[{type:"bold"}]}]}]}};
const container=document.querySelector("main")!;
async function select(el:HTMLSelectElement,value:string){assert.ok(el);await act(async()=>{el.value=value;el.dispatchEvent(new dom.window.Event("change",{bubbles:true}));});}
const button=(root:Element,text:string)=>[...root.querySelectorAll("button")].find(button=>button.textContent?.trim()===text)!;
test("governance editor preserves item identity, clears lists intentionally and omits untouched rich purpose",async()=>{
  const posts:any[]=[];
  const c={organizationId:"org",path:"/structure/proposals?fromMeeting="+meeting,session:{account:{id:"account"}},bootstrap:{rootCircleId:circle,authorizationRevision:1,membership:{id:"member",memberType:"MEMBER",orgRole:"OWNER"},modules:{governance:true,meetings:true}},
    structure:{nodes:[{entityId:circle,kind:"CIRCLE",name:"Circle",version:1},{entityId:role,kind:"ROLE",name:"Role",version:7}],circles:[{id:circle,purpose:""}],roles:[{id:role,purpose:"Purpose",purposeRich:rich,responsibilities:[responsibility],artifacts:[artifact]}],memberships:[]},members:[],
    navigate(){},refresh(){},registerNavigationGuard(){return()=>{};},
    api:async(_path:string,options:any)=>options?.method==="POST"?(posts.push(options),{data:{target:{kind:"PROPOSAL",id:"proposal",title:"O2"}}}):{data:{meeting:{id:meeting,circleId:circle,title:"O2",version:2,state:"RUNNING"},agenda:[],capabilities:{edit:true}}},
  };
  const root=createRoot(container);
  try{
    await act(async()=>root.render(<LocalizationProvider preferences={{locale:"en-US"}}><MeetingProposalEditor c={c} docs={[]} types={[]}/></LocalizationProvider>));
    const selects=[...container.querySelectorAll("select")];
    await select(selects.find(select=>[...select.options].some(option=>option.value===role))!,role);
    const editor=(kind:string)=>[...container.querySelectorAll("fieldset.definition-editor")].find(fieldset=>fieldset.querySelector("legend")?.textContent===kind)!;
    const input=editor("Responsibilities").querySelector<HTMLElement>('[contenteditable="true"]')!;
    assert.equal(editor("Responsibilities").querySelector('[role="toolbar"]'),null,"short definition entries do not expose a formatting toolbar");
    await act(async()=>{
      (input as any).editor.commands.setContent('<p>Review and document agreements</p>');
    });
    await act(async()=>(editor("Artifacts").querySelector('[aria-label="Remove item 1"]') as HTMLButtonElement).click());
    assert.match(editor("Artifacts").textContent!,/No items defined/);
    await act(async()=>button(container,"Add change").click());
    await act(async()=>button(container,"Edit").click());
    assert.match(editor("Artifacts").textContent!,/No items defined/);
    const editing=editor("Responsibilities").querySelector<HTMLElement>('[contenteditable="true"]')!;
    assert.equal(editing.textContent,"Review and document agreements");
    await act(async()=>container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true})));
    assert.equal(posts.length,0,"an unfinished queued edit must not silently submit old content");
    await act(async()=>button(container,"Save change").click());
    await act(async()=>container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true})));
    assert.equal(posts.length,1);
    assert.deepEqual(posts[0].body.payload.changes,[{kind:"UPDATE",entityId:role,baseVersion:7,name:"Role",responsibilities:[{...responsibility,text:"Review and document agreements",richText:{format:"orgmap-richtext",version:1,doc:{type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"Review and document agreements"}]}]}}}],artifacts:[]}]);
    assert.equal(posts[0].body.payload.changes[0].purposeRich,undefined);
  }finally{await act(async()=>root.unmount());}
});
