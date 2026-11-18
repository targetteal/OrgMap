import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import React, {act} from 'react';

const dom=new JSDOM('<main></main>',{url:'http://qa.localhost',pretendToBeVisual:true});
for(const name of ['window','document','navigator','HTMLElement','HTMLInputElement','Event','FormData','MutationObserver']) {
  Object.defineProperty(globalThis,name,{value:name==='window'?dom.window:(dom.window as any)[name],configurable:true});
}
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
Object.defineProperty(globalThis,'requestAnimationFrame',{value:dom.window.requestAnimationFrame.bind(dom.window),configurable:true});
dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
const vite=await createServer({root:new URL('../',import.meta.url).pathname,configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});
const {feature}=await vite.ssrLoadModule('/src/features/goals/index.tsx');
const {LocalizationProvider}=await vite.ssrLoadModule('/src/localization/index.tsx');
const {createRoot}=await import('react-dom/client');
const Goals=feature.Component;
test.after(async()=>{await vite.close();dom.window.close();});

test('goal draft survives cancellation, and successful creation clears the navigation guard',async()=>{
  const container=document.querySelector('main')!;
  const root=createRoot(container);
  let guard:()=>string|null=()=>null;
  const navigation:string[]=[],writes:any[]=[];
  const context:any={
    path:'/goals',organizationId:'org',session:{account:{id:'account'}},
    bootstrap:{membership:{id:'owner',memberType:'MEMBER',orgRole:'OWNER'},organization:{timeZone:'UTC'}},
    members:[{id:'owner',displayName:'Owner',status:'ACTIVE'}],structure:{nodes:[],occupancies:[]},
    api:async(path:string,options:any)=>{
      if(options?.method==='POST'){writes.push(options.body);return {data:{id:'created'}};}
      if(path.endsWith('/goal-periods'))return {data:{items:[{id:'period',title:'November',startsOn:'2026-11-01',endsOn:'2026-11-30'}]}};
      return {data:{items:[],page:{nextCursor:null},capabilities:{create:true,periodManage:true}}};
    },
    registerNavigationGuard:(next:()=>string|null)=>{guard=next;return()=>{guard=()=>null;};},
    navigate:(path:string)=>{assert.equal(guard(),null);navigation.push(path);},notify:()=>{},
  };
  const button=(label:string)=>{
    const result=[...container.querySelectorAll('button')].find(el=>el.textContent?.trim()===label);
    assert.ok(result,label);return result;
  };
  try{
    await act(async()=>root.render(<LocalizationProvider preferences={{locale:'en-US'}}><Goals context={context}/></LocalizationProvider>));
    await act(async()=>button('Add goal').click());
    const title=container.querySelector('dialog input') as HTMLInputElement;
    await act(async()=>{
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(title,'Goal draft');
      title.dispatchEvent(new Event('input',{bubbles:true}));
    });
    assert.ok(guard());
    await act(async()=>container.querySelector('dialog')!.dispatchEvent(new Event('cancel',{cancelable:true})));
    assert.match(container.textContent!,/Discard this form/);
    await act(async()=>button('Keep editing').click());
    assert.equal(title.value,'Goal draft');
    const owner=[...container.querySelectorAll('dialog select')].find(el=>[...el.querySelectorAll('option')].some(o=>o.value==='MEMBER:owner')) as HTMLSelectElement;
    assert.ok(owner);
    await act(async()=>{owner.value='MEMBER:owner';owner.dispatchEvent(new Event('change',{bubbles:true}));});
    await act(async()=>button('Select period').click());
    await act(async()=>(container.querySelector('dialog input[type="checkbox"]') as HTMLInputElement).click());
    await act(async()=>button('Create').click());
    assert.equal(writes.length,1);
    assert.equal(writes[0].title,'Goal draft');
    assert.deepEqual(navigation,['/goals/created']);
    assert.equal(container.querySelector('dialog'),null);
    assert.equal(guard(),null);
  }finally{await act(async()=>root.unmount());}
});
