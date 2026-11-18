import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';import {createServer} from 'vite';import React,{act} from 'react';
const dom=new JSDOM('<!doctype html><main></main>',{url:'http://test.localhost'});for(const k of ['window','document','navigator','HTMLElement','Event'])Object.defineProperty(globalThis,k,{value:k==='window'?dom.window:(dom.window as any)[k],configurable:true});Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
const {createRoot}=await import('react-dom/client');const vite=await createServer({root:new URL('../',import.meta.url).pathname,configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});const {DecisionWindow}=await vite.ssrLoadModule('/src/features/governance/decision-window.tsx');test.after(async()=>{await vite.close();dom.window.close();});
test('server time gates decisions, re-arms early and capped timers, and cancels on scope change and unmount',async()=>{
 const el=document.querySelector('main')!,root=createRoot(el);const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout,originalNow=performance.now.bind(performance),originalDateNow=Date.now;
 let monotonic=100,serial=0,decisions=0;const timers=new Map<number,{fn:()=>void;delay:number}>(),cleared:number[]=[];
 Object.defineProperty(performance,'now',{configurable:true,value:()=>monotonic});Date.now=()=>Date.parse('2099-01-01T00:00:00Z');
 globalThis.setTimeout=((fn:()=>void,delay:number)=>{const id=++serial;timers.set(id,{fn,delay});return id;}) as any;
 globalThis.clearTimeout=((id:number)=>{cleared.push(id);timers.delete(id);}) as any;
 const base=Date.parse('2030-01-01T00:00:00Z'),clock={asOf:new Date(base).toISOString(),receivedAt:100};
 const props={method:'CONSENT_WINDOW',locale:'en-US',formatInstant:(v:string)=>v,disabled:false,onDecide:()=>decisions++,label:'Decide'};
 const button=()=>el.querySelector('button')!;const fire=async(id:number)=>{const timer=timers.get(id);assert.ok(timer);timers.delete(id);await act(async()=>timer.fn());};
 try{
  await act(async()=>root.render(<DecisionWindow key="org-a:proposal-a:round-a" {...props} clock={clock} deadline={new Date(base+1000).toISOString()}/>));
  assert.equal(button().disabled,true,'client wall clock must not advance server deadline');assert.equal(timers.get(1)?.delay,1000);assert.match(el.textContent!,/Waiting/);
  monotonic=1099.5;await fire(1);assert.equal(button().disabled,true);assert.equal(timers.get(2)?.delay,1,'early timer is re-armed');
  monotonic=1100;await fire(2);assert.equal(button().disabled,false);await act(async()=>button().click());assert.equal(decisions,1);
  await act(async()=>root.render(<DecisionWindow key="org-a:proposal-a:round-b" {...props} disabled clock={{...clock,receivedAt:monotonic}} deadline={new Date(base+2147485000).toISOString()}/>));
  assert.equal(button().disabled,true);const capped=[...timers.entries()][0];assert.equal(capped[1].delay,2147483647);
  monotonic+=2147483647;await fire(capped[0]);assert.equal(button().disabled,true);assert.equal([...timers.values()][0].delay,1353,'long window is re-armed after cap');
  monotonic+=1353;await fire([...timers.keys()][0]);assert.equal(button().disabled,true,'busy remains disabled after deadline');
  await act(async()=>root.render(<DecisionWindow key="org-b:proposal-b:round-c" {...props} clock={{...clock,receivedAt:monotonic}} deadline={new Date(base+10000).toISOString()}/>));const prior=[...timers.keys()][0];assert.equal(button().disabled,true);
  await act(async()=>root.render(<DecisionWindow key="org-b:proposal-b:round-d" {...props} method="CONSENT_ROUND" clock={clock} deadline={new Date(base+10000).toISOString()}/>));assert.ok(cleared.includes(prior));assert.equal(timers.size,0);assert.equal(button().disabled,false);
  await act(async()=>root.render(<DecisionWindow key="org-b:proposal-b:round-e" {...props} clock={null} deadline={undefined}/>));assert.equal(button().disabled,true);assert.match(el.textContent!,/unavailable/);
  await act(async()=>root.render(<DecisionWindow key="org-b:proposal-b:round-f" {...props} clock={{...clock,receivedAt:monotonic}} deadline={new Date(base+10000).toISOString()}/>));const last=[...timers.keys()][0];await act(async()=>root.unmount());assert.ok(cleared.includes(last));assert.equal(timers.size,0);
 } finally{globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;Date.now=originalDateNow;Object.defineProperty(performance,'now',{configurable:true,value:originalNow});}
});
