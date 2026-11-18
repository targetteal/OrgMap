import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';import {createServer} from 'vite';import React,{act,useState} from 'react';
const dom=new JSDOM('<!doctype html><main></main>',{url:'http://qa.localhost'});
for(const key of ['window','document','navigator','HTMLElement','Event'])Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:(dom.window as any)[key],configurable:true});
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
Object.defineProperty(dom.window,'matchMedia',{value:()=>({matches:true,addEventListener(){},removeEventListener(){}})});
dom.window.HTMLElement.prototype.getClientRects=function(){return [this.getBoundingClientRect()] as any;};
const {createRoot}=await import('react-dom/client'),vite=await createServer({root:new URL('../',import.meta.url).pathname,configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});
const {useMobileNavigation}=await vite.ssrLoadModule('/src/use-mobile-navigation.ts');
test.after(async()=>{await vite.close();dom.window.close();});
test('closed mobile navigation is inert; modal entry, keyboard wrapping and Escape return focus',async()=>{
 function Surface(){const[open,setOpen]=useState(false),nav=useMobileNavigation(open,()=>setOpen(false));return <><aside ref={nav.sidebarRef} inert={nav.narrow&&!open?true:undefined} role={nav.modalOpen?'dialog':undefined} aria-modal={nav.modalOpen||undefined}><button onClick={()=>setOpen(false)}>Close navigation</button><button>Last destination</button></aside><section inert={nav.modalOpen?true:undefined}><button onClick={event=>{nav.openerRef.current=event.currentTarget;setOpen(true);}}>Open navigation</button></section></>;}
 const container=document.querySelector('main')!,root=createRoot(container);
 try{await act(async()=>root.render(<Surface/>));const panel=container.querySelector('aside')!,workspace=container.querySelector('section')!,buttons=[...container.querySelectorAll('button')],opener=buttons[2];assert.equal(panel.hasAttribute('inert'),true);assert.equal(workspace.hasAttribute('inert'),false);
 await act(async()=>opener.click());assert.equal(panel.getAttribute('role'),'dialog');assert.equal(panel.getAttribute('aria-modal'),'true');assert.equal(workspace.hasAttribute('inert'),true);assert.equal(document.activeElement,buttons[0]);
 await act(async()=>buttons[0].dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true})));assert.equal(document.activeElement,buttons[1]);
 await act(async()=>buttons[1].dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true})));assert.equal(document.activeElement,buttons[0]);
 await act(async()=>panel.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));assert.equal(panel.hasAttribute('inert'),true);assert.equal(workspace.hasAttribute('inert'),false);assert.equal(document.activeElement,opener);
 }finally{await act(async()=>root.unmount());}
});
