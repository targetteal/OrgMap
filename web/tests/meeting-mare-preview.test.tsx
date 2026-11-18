import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';import {createServer} from 'vite';import React,{act} from 'react';
const dom=new JSDOM('<!doctype html><main></main>',{url:'http://qa.localhost/meetings'});
for(const key of ['window','document','navigator','HTMLElement','HTMLInputElement','Event','FormData'])Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:(dom.window as any)[key],configurable:true});
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
const {createRoot}=await import('react-dom/client'),vite=await createServer({root:new URL('../',import.meta.url).pathname,configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});
const {feature}=await vite.ssrLoadModule('/src/features/meetings/index.tsx'),{LocalizationProvider}=await vite.ssrLoadModule('/src/localization/index.tsx');
test.after(async()=>{await vite.close();dom.window.close();});
test('meeting list opens a real detail preview and enters the canonical room only on request',async()=>{
 window.innerWidth=1025;
 const id='11111111-1111-4111-8111-111111111111',circle='22222222-2222-4222-8222-222222222222',routes:string[]=[],calls:string[]=[];
 const meeting={id,circleId:circle,title:'Encontro real',state:'SCHEDULED',startAt:'2030-02-01T12:00:00Z',timeZone:'UTC',durationMinutes:60,version:1,isParticipant:true,sections:[{id:'agenda',title:'Pauta',kind:'AGENDA'}],currentStep:'agenda'};
 const c={organizationId:'org',path:'/meetings',session:{account:{id:'account'}},bootstrap:{organization:{id:'org',name:'Org',version:1},membership:{id:'member',memberType:'MEMBER',orgRole:'OWNER'},capabilities:{},modules:{}},structure:{nodes:[{entityId:circle,name:'Círculo A'}],circles:[{id:circle}],roles:[]},members:[{id:'member',displayName:'Pessoa'}],navigate:(path:string)=>routes.push(path),refresh(){},notify(){},api:async(path:string)=>{calls.push(path);if(path.endsWith('/meetings/'+id))return{data:{meeting,participants:[{memberId:'member',access:'EDIT',attendance:'PRESENT'}],agenda:[{id:'agenda',title:'Tema real',status:'OPEN'}],actions:[],documents:[],report:null,capabilities:{edit:true}}};return{data:{items:path.includes('/meetings?')?[meeting,{...meeting,id:'other',title:'Outro encontro',isParticipant:false}]:[],page:{nextCursor:null}}};}};
 const container=document.querySelector('main')!,root=createRoot(container);try{await act(async()=>root.render(<LocalizationProvider preferences={{locale:'pt-BR',timeZone:'UTC'}}><feature.Component context={c}/></LocalizationProvider>));assert.doesNotMatch(container.textContent!,/Outro encontro/);assert.equal(container.querySelector('[role=status].mare-meetings-result-count')?.textContent,'1 reunião');await act(async()=>[...container.querySelectorAll('button')].find(button=>button.textContent==='Todas')!.click());assert.match(container.textContent!,/Outro encontro/);assert.equal(container.querySelector('[role=status].mare-meetings-result-count')?.textContent,'2 reuniões');const row=[...container.querySelectorAll('button')].find(button=>button.textContent?.includes('Encontro real'))!;assert.ok(row);row.focus();await act(async()=>row.click());assert.equal(routes.length,0);assert.ok(calls.some(path=>path.endsWith('/meetings/'+id)));assert.match(container.querySelector('.mare-meeting-preview')!.textContent!,/Tema real/);assert.ok(container.contains(row));
 const background=row.closest('.meetings-list')!;
 const moduleNav=container.querySelector('.mare-meetings-module-nav')!;
 const preview=container.querySelector('.mare-meeting-preview')!;
 assert.equal(background.hasAttribute('inert'),false);
 await act(async()=>preview.querySelector<HTMLButtonElement>('[aria-label="Expandir detalhes"]')!.click());
 assert.equal(preview.getAttribute('aria-modal'),'true');
 assert.equal(background.hasAttribute('inert'),true);
 assert.equal(moduleNav.hasAttribute('inert'),true);
 await act(async()=>preview.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 assert.equal(background.hasAttribute('inert'),false);
 assert.equal(moduleNav.hasAttribute('inert'),false);
 assert.equal(document.activeElement,row);
 await act(async()=>row.click());
 const resizedPreview=container.querySelector('.mare-meeting-preview')!;
 const participants=[...resizedPreview.querySelectorAll('nav button')][1] as HTMLButtonElement;
 await act(async()=>participants.click());
 participants.focus();
 await act(async()=>{
   window.innerWidth=1024;
   window.dispatchEvent(new dom.window.Event('resize'));
 });
 assert.equal(resizedPreview.getAttribute('aria-modal'),'true');
 assert.equal(background.hasAttribute('inert'),true);
 assert.equal(participants.getAttribute('aria-current'),'page');
 assert.equal(document.activeElement,participants);
 await act(async()=>participants.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 assert.equal(background.hasAttribute('inert'),false);
 assert.equal(document.activeElement,row);
 await act(async()=>row.click());
 await act(async()=>[...container.querySelectorAll('button')].find(button=>button.textContent==='Preparar encontro')!.click());assert.equal(routes.at(-1),'/meetings/'+id);}finally{await act(async()=>root.unmount());}
});

test('meeting empty states distinguish scope, filters and organization history',async()=>{
 const routes:string[]=[],circle='22222222-2222-4222-8222-222222222222';
 const meeting={id:'m',circleId:circle,title:'Outro encontro',state:'SCHEDULED',startAt:'2030-02-01T12:00:00Z',timeZone:'UTC',durationMinutes:60,version:1,isParticipant:false};
 let data=[meeting];
 const c={organizationId:'org',path:'/meetings',session:{account:{id:'account'}},bootstrap:{organization:{id:'org',name:'Org',version:1},membership:{id:'member',memberType:'MEMBER',orgRole:'OWNER'},capabilities:{},modules:{}},structure:{nodes:[{entityId:circle,name:'Círculo A'}],circles:[{id:circle}],roles:[]},members:[],navigate:(path:string)=>routes.push(path),refresh(){},notify(){},api:async(path:string)=>({data:{items:path.includes('/meetings?')?(path.includes('circleId=')?[]:data):[],page:{nextCursor:null}}})};
 const container=document.querySelector('main')!,root=createRoot(container);
 const render=(context:any)=>act(async()=>root.render(<LocalizationProvider preferences={{locale:'pt-BR',timeZone:'UTC'}}><feature.Component context={context}/></LocalizationProvider>));
 const button=(label:string)=>[...container.querySelectorAll('button')].find(item=>item.textContent===label)!;
 try{
  await render(c);
  assert.match(container.querySelector('.empty-state')!.textContent!,/Nenhuma reunião sua neste período/);
  await act(async()=>button('Ver todas').click());
  assert.match(container.textContent!,/Outro encontro/);
  const search=container.querySelector<HTMLInputElement>('input[aria-label="Pesquisar reuniões"]')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(search,'inexistente');search.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
  assert.match(container.querySelector('.empty-state')!.textContent!,/Nenhum resultado/);
  await act(async()=>button('Limpar filtros').click());
  assert.match(container.textContent!,/Outro encontro/);
  await render({...c,path:'/meetings?history=1&circleId='+circle});
  assert.match(container.querySelector('.empty-state')!.textContent!,/Nenhum resultado/);
  await act(async()=>button('Limpar filtros').click());
  assert.equal(routes.at(-1),'/meetings?history=1');
  data=[];
  await render({...c,path:'/meetings?history=1'});
  assert.match(container.querySelector('.empty-state')!.textContent!,/Nenhuma reunião disponível nesta organização/);
 }finally{await act(async()=>root.unmount());}
});
