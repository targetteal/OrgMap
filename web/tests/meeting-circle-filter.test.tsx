import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import React, {act} from 'react';

const dom=new JSDOM('<!doctype html><main></main>',{url:'http://qa.localhost/meetings'});
for(const key of ['window','document','navigator','HTMLElement','HTMLInputElement','Event','FormData'])
  Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:(dom.window as any)[key],configurable:true});
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
const {createRoot}=await import('react-dom/client');
const vite=await createServer({root:new URL('../',import.meta.url).pathname,configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});
const {feature}=await vite.ssrLoadModule('/src/features/meetings/index.tsx');
const {LocalizationProvider}=await vite.ssrLoadModule('/src/localization/index.tsx');
const Component=feature.Component;
test.after(async()=>{await vite.close();dom.window.close();});

test('circle filter drives paginated API queries, survives view changes and discards an obsolete page',async()=>{
  const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
  const requests:string[]=[],navigations:string[]=[];
  let latePage!:(result:any)=>void;
  let failList=false;
  const item=(title:string)=>({id:title,title,state:'SCHEDULED',startAt:new Date().toISOString(),timeZone:'UTC',durationMinutes:60,circleId:a,isParticipant:true});
  const api=async(path:string)=>{
    if(!path.includes('/meetings?'))return {data:{items:[]}};
    requests.push(path);
    if(failList)throw Error('Temporary list failure');
    const query=new URL('http://qa.localhost'+path).searchParams;
    if(query.has('cursor'))return new Promise(resolve=>{latePage=resolve;});
    return {data:{items:[{...item(query.get('circleId')===b?'Reunião B':'Reunião A'),state:query.get('state')==='CLOSED'?'CLOSED':'SCHEDULED'}],page:{nextCursor:query.get('circleId')===a?'page-a':null}}};
  };
  const container=document.querySelector('main')!,root=createRoot(container);
  const ctx=(path:string)=>({organizationId:'org',path,session:{account:{id:'account'}},bootstrap:{membership:{id:'member',memberType:'MEMBER',orgRole:'OWNER'},capabilities:{},modules:{}},structure:{roles:[],circles:[{id:a},{id:b}],nodes:[{entityId:a,name:'Círculo A'},{entityId:b,name:'Círculo B'}]},members:[],api,navigate:(value:string)=>navigations.push(value),notify(){},refresh(){}});
  const render=async(path:string)=>act(async()=>root.render(<LocalizationProvider preferences={{locale:'pt-BR',timeZone:'UTC'}}><Component context={ctx(path)}/></LocalizationProvider>));
  const click=async(text:string)=>{const button=[...container.querySelectorAll('button')].find(button=>button.textContent?.trim()===text);assert.ok(button,text);await act(async()=>button.click());};
  try {
    await render('/meetings?circleId='+a);
    assert.equal(new URL('http://qa.localhost'+requests.at(-1)).searchParams.get('circleId'),a);
    assert.equal(new URL('http://qa.localhost'+requests.at(-1)).searchParams.has('from'),false);
    await click('Calendário');
    assert.ok(new URL('http://qa.localhost'+requests.at(-1)).searchParams.has('from'));
    await click('Lista');
    assert.equal(new URL('http://qa.localhost'+requests.at(-1)).searchParams.has('from'),false);
    await click('Carregar mais');
    assert.equal(new URL('http://qa.localhost'+requests.at(-1)).searchParams.get('cursor'),'page-a');
    const filter=container.querySelector('select[name=circleFilter]') as HTMLSelectElement;
    await act(async()=>{filter.value=b;filter.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
    assert.equal(navigations.at(-1),'/meetings?circleId='+b);
    await render(navigations.at(-1)!);
    await act(async()=>latePage({data:{items:[item('Ancienne page A')],page:{nextCursor:'wrong'}}}));
    assert.match(container.textContent!,/Reunião B/);
    assert.doesNotMatch(container.textContent!,/Reunião A|Ancienne page A|Carregar mais/);
    failList=true;
    await render('/meetings?circleId='+a);
    assert.doesNotMatch(container.textContent!,/Reunião B/);
    failList=false;
    await render('/meetings?circleId='+b);
    await click('Agendar reunião');
    assert.equal((container.querySelector('select[name=circleId]') as HTMLSelectElement).value,b);
    await render('/meetings/reports?circleId='+b);
    assert.equal(container.querySelector('[role=status].mare-meetings-result-count')?.textContent,'1 ata');
    const reports=new URL('http://qa.localhost'+requests.at(-1)).searchParams;
    assert.equal(reports.get('state'),'CLOSED');assert.equal(reports.get('circleId'),b);
    await render('/meetings');
    assert.equal(new URL('http://qa.localhost'+requests.at(-1)).searchParams.has('circleId'),false);
  } finally {await act(async()=>root.unmount());}
});
