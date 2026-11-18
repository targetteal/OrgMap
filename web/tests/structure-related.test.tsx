import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';

test('entity links use explicit role IDs and project context rather than names',async()=>{
 const dom=new JSDOM('<!doctype html><main></main>',{url:'http://structure.localhost/'});
 for(const key of ['window','document','navigator','HTMLElement','Element','Node','Event'])Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:(dom.window as any)[key],configurable:true});
 Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
 const {createRoot}=await import('react-dom/client');
 const vite=await createServer({root:fileURLToPath(new URL('../',import.meta.url)),configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});
 const {StructureRelated,StructureEntityNavigation,StructureDocumentPanel}=await vite.ssrLoadModule('/src/StructureRelated.tsx');
 const destinations:string[]=[];

 const roleId='00000000-0000-4000-8000-000000000001', otherId='00000000-0000-4000-8000-000000000002';
 const rich=(roleId:string)=>({format:'orgmap-richtext',version:1,doc:{type:'doc',content:[{type:'paragraph',content:[{type:'roleMention',attrs:{roleId,label:'Mesmo nome'}}]}]}});
 const docs=[{id:'one',title:'Menção exata',richContent:rich(roleId),ownerId:'circle',publishedVersion:1},{id:'two',title:'Outro papel',richContent:rich(otherId),publishedVersion:1},{id:'three',title:'Texto legado',content:'@Mesmo nome',publishedVersion:1},{id:'four',title:'Do círculo',ownerId:'circle',publishedVersion:1}];
 const projects=[{id:'p1',title:'Projeto do papel',contextLinks:[{kind:'ROLE',targetId:roleId}]},{id:'p2',title:'Projeto de outro',contextLinks:[{kind:'ROLE',targetId:otherId}]},{id:'p3',title:'Projeto do círculo',circleId:'circle'}];
 const entity={nodeId:'role-node',entityId:roleId,kind:'ROLE',name:'Mesmo nome',parentNodeId:'circle-node'};
 const circle={nodeId:'circle-node',entityId:'circle',kind:'CIRCLE',name:'Círculo',parentNodeId:null};
 const context={organizationId:'org',bootstrap:{membership:{memberType:'MEMBER'},organization:{}},structure:{nodes:[circle,entity],coverage:{complete:true}},navigate:(path:string)=>destinations.push(path),api:async(path:string)=>path.endsWith('/documents')?{data:{items:docs,page:{nextCursor:null}}}:path.endsWith('/documents/one')?{data:{document:docs[0],versions:[{number:1,content:'Texto publicado da restrição.'}]}}:{data:{projects}}};
 const root=createRoot(document.querySelector('main')!);
 try {
  await act(async()=>root.render(<StructureRelated context={context} entity={entity}/>));
  assert.match(document.querySelector('#entity-restrictions')!.textContent!,/Menção exata/);
  assert.doesNotMatch(document.querySelector('#entity-restrictions')!.textContent!,/Outro papel|Texto legado|Do círculo/);
  assert.match(document.querySelector('#entity-projects')!.textContent!,/Projeto do papel/);
  assert.doesNotMatch(document.querySelector('#entity-projects')!.textContent!,/Projeto de outro|Projeto do círculo/);
  const restrictionButton=document.querySelector<HTMLButtonElement>('#entity-restrictions button')!;
  await act(async()=>restrictionButton.click());
  assert.equal(destinations.at(-1),'/circles/circle?from='+encodeURIComponent('/structure')+'&document=one');
  await act(async()=>document.querySelector<HTMLButtonElement>('#entity-projects button')!.click());
  assert.equal(destinations.at(-1),'/projects/p1');
  await act(async()=>root.render(<StructureRelated context={context} entity={circle}/>));
  assert.match(document.querySelector('#entity-restrictions')!.textContent!,/Do círculo/);
  const circleRestriction=[...document.querySelectorAll<HTMLButtonElement>('#entity-restrictions button')].find(button=>button.textContent?.includes('Do círculo'))!;
  await act(async()=>circleRestriction.click());
  assert.equal(destinations.at(-1),'/circles/circle?from='+encodeURIComponent('/structure')+'&document=four');
  assert.match(document.querySelector('#entity-projects')!.textContent!,/Projeto do papel/);
  assert.match(document.querySelector('#entity-projects')!.textContent!,/Projeto do círculo/);
  let scrolled='';
  Object.defineProperty(dom.window.HTMLElement.prototype,'scrollIntoView',{value:function(){scrolled=this.id},configurable:true});
  const navigation=(kind:'CIRCLE'|'ROLE')=><aside><StructureEntityNavigation kind={kind}/><article className="structure-entity-content"><section id="entity-overview"/><section id="entity-roles"/><section id="entity-restrictions"/><section id="entity-projects"/></article></aside>;
  await act(async()=>root.render(navigation('CIRCLE')));
  assert.deepEqual([...document.querySelectorAll('nav button')].map(button=>button.textContent),['Visão geral','Papéis','Restrições','Projetos']);
  const projectsButton=[...document.querySelectorAll<HTMLButtonElement>('nav button')].find(button=>button.textContent==='Projetos')!;
  await act(async()=>projectsButton.click());
  assert.equal(scrolled,'entity-projects');
  assert.equal(projectsButton.getAttribute('aria-current'),'location');
  await act(async()=>root.render(navigation('ROLE')));
  assert.deepEqual([...document.querySelectorAll('nav button')].map(button=>button.textContent),['Visão geral','Restrições','Projetos']);
  await act(async()=>root.render(<StructureDocumentPanel context={context} entity={circle} documentId="one" expanded={false} onToggleExpand={()=>{}} onClose={()=>{}}/>));
  const panel=document.querySelector('aside.mare-entity-drawer')!;
  assert.match(panel.querySelector('.mare-entity-location')!.textContent!,/Círculo/);
  assert.match(panel.querySelector('h2')!.textContent!,/Menção exata/);
  assert.match(panel.textContent!,/Texto publicado da restrição/);
 }finally{await act(async()=>root.unmount());await vite.close();dom.window.close()}
});

test('restriction drawers hide previous scope content and reject delayed org, account, authorization and document responses',async()=>{
 const dom=new JSDOM('<!doctype html><main></main>',{url:'http://structure.localhost/'});
 for(const key of ['window','document','navigator','HTMLElement','Element','Node','Event'])Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:(dom.window as any)[key],configurable:true});
 Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
 const {createRoot}=await import('react-dom/client');
 const vite=await createServer({root:fileURLToPath(new URL('../',import.meta.url)),configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});
 const {StructureDocumentPanel}=await vite.ssrLoadModule('/src/StructureRelated.tsx');
 const entity={nodeId:'circle-node',entityId:'circle',kind:'CIRCLE',name:'Círculo',parentNodeId:null};
 const pending:{resolve:(value:any)=>void;signal:AbortSignal}[]=[];
 const api=async(_path:string,options:any)=>new Promise(resolve=>pending.push({resolve,signal:options.signal}));
 const base={organizationId:'org-a',session:{account:{id:'account-a'}},bootstrap:{organization:{},membership:{id:'member-a',memberType:'MEMBER'},authorizationRevision:1},structure:{nodes:[entity]},path:'/circles/circle',api,navigate(){}};
 const payload=(title:string)=>({data:{document:{title,publishedVersion:1},versions:[{number:1,content:title+' body'}]}});
 const root=createRoot(document.querySelector('main')!);
 const commits:string[]=[];
 function Probe({context,documentId}:{context:any;documentId:string}){
  React.useLayoutEffect(()=>{commits.push(document.querySelector('main')!.textContent!);});
  return <StructureDocumentPanel context={context} entity={entity} documentId={documentId} expanded={false} onToggleExpand={()=>{}} onClose={()=>{}}/>;
 }
 try {
  const variations=[
   {context:{...base,organizationId:'org-b'},documentId:'one'},
   {context:{...base,session:{account:{id:'account-b'}}},documentId:'one'},
   {context:{...base,bootstrap:{...base.bootstrap,membership:{...base.bootstrap.membership,id:'member-b'}}},documentId:'one'},
   {context:{...base,bootstrap:{...base.bootstrap,authorizationRevision:2}},documentId:'one'},
   {context:base,documentId:'two'},
  ];
  for(const [index,next] of variations.entries()){
   await act(async()=>root.render(<Probe key={index} context={base} documentId="one"/>));
   await act(async()=>pending.at(-1)!.resolve(payload('Anterior')));
   assert.match(document.querySelector('main')!.textContent!,/Anterior body/);
   commits.length=0;
   await act(async()=>root.render(<Probe key={index} {...next}/>));
   assert.doesNotMatch(commits[0],/Anterior/,'previous data is hidden in the first commit, before passive effects');
   assert.match(document.querySelector('main')!.textContent!,/Carregando restrição/);
   const stale=pending.at(-1)!;
   await act(async()=>root.render(<Probe key={index} context={base} documentId="three"/>));
   assert.equal(stale.signal.aborted,true);
   const current=pending.at(-1)!;
   await act(async()=>current.resolve(payload('Atual')));
   await act(async()=>stale.resolve(payload('Resposta atrasada')));
   assert.match(document.querySelector('main')!.textContent!,/Atual body/);
   assert.doesNotMatch(document.querySelector('main')!.textContent!,/Anterior|Resposta atrasada/);
  }
 }finally{await act(async()=>root.unmount());await vite.close();dom.window.close();}
});
