import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import React,{act} from 'react';
const dom=new JSDOM('<!doctype html><main></main>',{url:'http://qa.localhost'});
for(const key of ['window','document','navigator','HTMLElement','HTMLInputElement','HTMLDialogElement','Event','FormData'])Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:(dom.window as any)[key],configurable:true});
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
const {createRoot}=await import('react-dom/client');
const vite=await createServer({root:new URL('../',import.meta.url).pathname,configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});
const {Modal,feature}=await vite.ssrLoadModule('/src/features/governance/index.tsx');
const {LocalizationProvider}=await vite.ssrLoadModule('/src/localization/index.tsx');
const Component=feature.Component,container=document.querySelector('main')!;
test.after(async()=>{await vite.close();dom.window.close();});
const proposal='11111111-1111-4111-8111-111111111111';
const base=(path:string,api:any,eligible=[{id:'circle',name:'Circle'}])=>({organizationId:'org',path,session:{account:{id:'account'}},bootstrap:{organization:{id:"org",name:"Organização",version:1,vocabulary:{}},rootCircleId:'circle',membership:{memberType:'MEMBER',id:'member',orgRole:'OWNER'},capabilities:{},modules:{}},structure:{nodes:[{entityId:'circle',kind:'CIRCLE',name:'Circle'}],circles:[],roles:[],memberships:[],occupancies:[]},members:[],navigate(){},refresh(){},notify(){},api:(url:string,options:any)=>url.endsWith('/governance/proposal-circles')?Promise.resolve({data:{items:eligible}}):api(url,options)});
const button=(name:string)=>{const value=[...container.querySelectorAll('button')].find(b=>(b.textContent?.trim()===name||b.getAttribute('aria-label')===name));assert.ok(value,name);return value;};
test('structure entry preselects Papel, Círculo or Restrição and consumes only its composer parameters',async()=>{
 for(const [entry,expected] of [['role','ROLE'],['circle','CIRCLE'],['restriction','DOCUMENT']]){
  let navigation='';const c=base('/structure/proposals?new=1&circleId=circle&proposalType='+entry+'&returnTo=%2Fstructure',async()=>({data:{items:[],page:{nextCursor:null}}}));c.navigate=(value:string)=>{navigation=value;};const root=createRoot(container);
  try {
   await act(async()=>root.render(<LocalizationProvider preferences={{locale:'pt-BR'}}><Component context={c}/></LocalizationProvider>));
   const type=Array.from(container.querySelectorAll<HTMLSelectElement>('dialog select')).find(select=>Array.from(select.options).some(option=>option.value==='ELECTION'&&option.textContent==='Eleição'));
   assert.ok(type);assert.equal(type.value,expected);assert.equal(navigation,'/structure/proposals?returnTo=%2Fstructure');
  }finally{await act(async()=>root.unmount());}
 }
});
test('named modal keeps dirty form state through DOM discard rejection and Escape, then discards once',async()=>{
 let closed=0,guard:()=>string|null=()=>null;const root=createRoot(container);
 const context={registerNavigationGuard:(value:()=>string|null)=>{guard=value;return()=>{guard=()=>null;};}} as any;
 const render=async(busy=false)=>act(async()=>root.render(<LocalizationProvider preferences={{locale:'en-US'}}><Modal title="Edit proposal" close={()=>closed++} context={context} busy={busy}><input defaultValue="Original"/></Modal></LocalizationProvider>));
 try {await render();
 const dialog=container.querySelector('dialog')!;assert.equal(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent,'Edit proposal');
 const input=container.querySelector('input')!;input.focus();
 await act(async()=>{input.value='Unsaved';input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
 assert.match(guard()!,/unsaved/);
 await act(async()=>dialog.dispatchEvent(new dom.window.Event('cancel',{cancelable:true})));
 assert.equal(closed,0);assert.equal(dialog.open,true);assert.equal(document.activeElement,button('Keep editing'));
 assert.equal(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent,'Discard unsaved changes?');
 assert.equal(container.querySelector('.gov-dialog-body')!.hasAttribute('hidden'),true);assert.equal(container.querySelector('input'),input);
 await act(async()=>dialog.dispatchEvent(new dom.window.Event('cancel',{cancelable:true})));
 assert.equal(closed,0);assert.equal(dialog.open,true);assert.equal(document.activeElement,input);assert.equal(input.value,'Unsaved');assert.match(guard()!,/unsaved/);
 await act(async()=>dialog.dispatchEvent(new dom.window.Event('cancel',{cancelable:true})));
 await act(async()=>button('Keep editing').click());assert.equal(input.value,'Unsaved');assert.match(guard()!,/unsaved/);assert.equal(container.querySelector('.gov-discard-confirmation'),null);
 await render(true);await act(async()=>dialog.dispatchEvent(new dom.window.Event('cancel',{cancelable:true})));
 assert.equal(container.querySelector('.gov-discard-confirmation'),null);assert.equal(closed,0);assert.match(guard()!,/confirmation/);
 await render();await act(async()=>dialog.dispatchEvent(new dom.window.Event('cancel',{cancelable:true})));
 const discard=button('Discard changes');await act(async()=>{discard.click();discard.click();});assert.equal(closed,1);assert.equal(guard(),null);
 }finally{await act(async()=>root.unmount());}
});
test('proposal sort is announced and its create action stays in a separate footer',async()=>{
 const rows=[{id:proposal,title:'A proposal',state:'DRAFT',kind:'GOVERNANCE',circleId:'circle',authorId:'member',createdAt:'2026-01-01T00:00:00Z'}];
 const c=base('/structure/proposals',async(path:string)=>({data:{items:path.endsWith('/proposals')?rows:[],page:{nextCursor:null}}})),root=createRoot(container);
 try {await act(async()=>root.render(<LocalizationProvider preferences={{locale:'en-US'}}><Component context={c}/></LocalizationProvider>));
 assert.equal(container.querySelector('main'),null);
 await act(async()=>button('All').click());
 const sort=container.querySelector<HTMLSelectElement>('select[aria-label="Sort proposals"]')!;assert.ok(sort);await act(async()=>{sort.value='oldest';sort.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});assert.match(container.querySelector('.gov-sr[role=status]')!.textContent!,/Oldest/);
 await act(async()=>button('Add proposal').click());
 assert.ok(container.querySelector('.gov-form-fields'));const footer=container.querySelector('.gov-form-footer')!;assert.ok(footer);assert.match(footer.textContent!,/Cancel/);assert.match(footer.textContent!,/Continue/);assert.equal(footer.querySelector('button.primary')?.getAttribute('disabled'),null);
 }finally{await act(async()=>root.unmount());}
});
test('escalation sends a reason as a separate command, not a ballot',async()=>{
 const sent:any[]=[];
 const detail={proposal:{id:proposal,title:'Assíncrona',version:2,revision:1,state:'REVIEW',kind:'GOVERNANCE',canVote:true},revisions:[{number:1,payload:{changes:[]}}],rounds:[{id:'round',revision:1,state:'OPEN',step:'PRESENT',policy:{method:'CONSENT_WINDOW',workflowSteps:['PRESENT','DECIDE'],quorumPercent:100,allowAbstain:true},electorate:['member'],deadline:'2099-01-01T00:00:00Z'}],ballots:[],objections:[],nominations:[],commits:[],history:[]};
 const c=base('/structure/proposals/'+proposal,async(path:string,options:any)=>{if(options?.method==='POST'){sent.push({path,options});return{data:{id:proposal,version:3}};}return{data:path.endsWith('/origin')?{origin:null}:path.endsWith('/proposals/'+proposal)?detail:{items:[],page:{nextCursor:null}}};});const root=createRoot(container);
 try{await act(async()=>root.render(<LocalizationProvider preferences={{locale:'pt-BR'}}><Component context={c}/></LocalizationProvider>));await act(async()=>button('Decisão').click());await act(async()=>button('Escalar para reunião').click());const form=container.querySelector<HTMLFormElement>('dialog.gov-dialog form')!,reason=form.querySelector<HTMLTextAreaElement>('textarea[name=reason]')!;reason.value='Precisamos conversar';await act(async()=>form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));assert.equal(sent.length,1);assert.match(sent[0].path,/actions\/escalate$/);assert.deepEqual(sent[0].options.body,{reason:'Precisamos conversar'});assert.equal(sent[0].options.version,2);}finally{await act(async()=>root.unmount());}
});
test('kanban derives Agendadas from a readable placement without changing the draft state',async()=>{
 const row={id:proposal,title:'Proposta agendada',state:'DRAFT',kind:'GOVERNANCE',circleId:'circle',authorId:'member',version:1,scheduledMeeting:{proposalId:proposal,meetingId:'meeting',agendaId:'agenda',circleId:'circle',title:'Encontro',startAt:'2030-01-01T12:00:00Z',state:'SCHEDULED',version:1}};
 const c=base('/structure/proposals',async(path:string)=>({data:{items:path.endsWith('/proposals')?[row]:[],page:{nextCursor:null}}})),root=createRoot(container);
 try{await act(async()=>root.render(<LocalizationProvider preferences={{locale:'pt-BR'}}><Component context={c}/></LocalizationProvider>));await act(async()=>button('Todas').click());await act(async()=>button('Kanban').click());const scheduled=[...container.querySelectorAll('.mare-governance-column')].find(column=>column.querySelector('h3')?.textContent?.includes('Agendadas'));assert.ok(scheduled);assert.match(scheduled.textContent!,/Proposta agendada/);assert.equal(row.state,'DRAFT');}finally{await act(async()=>root.unmount());}
});
test('tension destinations remain in a contextual disclosure and closing waits for confirmation',async()=>{
 const posts:any[]=[],row={id:'tension',title:'Clarify decisions',circleId:'circle',state:'OPEN',authorId:'member',version:3,canProcess:true,canProcessAgenda:true};
 const c=base('/structure/tensions',async(path:string,options:any)=>{if(options?.method==='POST'){posts.push({path,options});return{data:{}};}return{data:{items:path.endsWith('/tensions')?[row]:[],page:{nextCursor:null}}};}),root=createRoot(container);
 try{await act(async()=>root.render(<LocalizationProvider preferences={{locale:'en-US'}}><Component context={c}/></LocalizationProvider>));
 const menu=container.querySelector('details.gov-tension-menu')!;assert.ok(menu);assert.equal(menu.hasAttribute('open'),false);assert.match(menu.querySelector('summary')!.getAttribute('aria-label')!,/Clarify decisions/);
 assert.match(menu.textContent!,/Create proposal/);assert.match(menu.textContent!,/Create task/);assert.match(menu.textContent!,/Create goal/);
 await act(async()=>button('Close').click());assert.equal(posts.length,0);assert.ok(container.querySelector('dialog'));assert.match(container.querySelector('dialog')!.textContent!,/remain in the history/);
 await act(async()=>container.querySelector<HTMLFormElement>('dialog form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
 assert.equal(posts.length,1);assert.match(posts[0].path,/tensions\/tension\/actions\/close$/);assert.equal(posts[0].options.version,3);assert.equal(container.querySelector('dialog'),null);
 }finally{await act(async()=>root.unmount());}
});

test('tension menu actions are named and cancelled confirmation restores focus to the visible trigger',async()=>{
 const row={id:'tension',title:'Clarify decisions',circleId:'circle',state:'OPEN',authorId:'member',version:3,canProcess:true,canProcessAgenda:true};
 const c=base('/structure/tensions',async(path:string)=>({data:{items:path.endsWith('/tensions')?[row]:[],page:{nextCursor:null}}})),root=createRoot(container);
 try{
  await act(async()=>root.render(<LocalizationProvider preferences={{locale:'en-US'}}><Component context={c}/></LocalizationProvider>));
  const menu=container.querySelector<HTMLDetailsElement>('details.gov-tension-menu')!,summary=menu.querySelector('summary')!;
  const actions=[...menu.querySelectorAll<HTMLButtonElement>('button')];assert.equal(actions.length,5);
  for(const action of actions){assert.equal(action.getAttribute('aria-label'),action.textContent!.trim()+': '+row.title);}
  menu.open=true;
  const close=actions.find(action=>action.textContent!.trim()==='Close')!;close.focus();
  await act(async()=>close.click());
  assert.equal(menu.open,false);assert.ok(container.querySelector('dialog'));
  const cancel=[...container.querySelectorAll<HTMLButtonElement>('dialog button')].find(action=>action.textContent!.trim()==='Cancel')!;
  cancel.focus();assert.equal(document.activeElement,cancel);
  await act(async()=>cancel.click());
  assert.equal(container.querySelector('dialog'),null);assert.equal(document.activeElement,summary);assert.equal(menu.open,false);
 }finally{await act(async()=>root.unmount());}
});

test('proposal API rejection preserves title and evolution, shows the error and recovers busy state',async()=>{
 const {RequestError}=await vite.ssrLoadModule('/src/api.ts');
 let rejectRequest!:(error:unknown)=>void,guard:()=>string|null=()=>null;const posts:any[]=[];
 const c=Object.assign(base('/structure/proposals',async(path:string,options:any)=>{
  if(options?.method==='POST'){posts.push({path,options});return await new Promise((_resolve,reject)=>{rejectRequest=reject;});}
  if(path.endsWith('/tensions'))return{data:{items:[{id:'source',title:'Context',description:'Description',circleId:'circle',authorId:'member',state:'OPEN'}],page:{nextCursor:null}}};
  if(path.includes('/effective'))return{data:{configuration:{method:'CONSENT_WINDOW',reviewDurationHours:24}}};
  return{data:{items:[],page:{nextCursor:null}}};
 }),{registerNavigationGuard:(value:()=>string|null)=>{guard=value;return()=>{guard=()=>null;};}});
 Object.assign(c.structure.nodes[0],{version:7});
 const root=createRoot(container);
 try{
  await act(async()=>root.render(<LocalizationProvider preferences={{locale:'en-US'}}><Component context={c}/></LocalizationProvider>));
  await act(async()=>button('Add proposal').click());
  const dialog=container.querySelector('dialog')!,form=dialog.querySelector('form')!,title=form.querySelector<HTMLInputElement>('input[name=title]')!;
  await act(async()=>{title.value='Unsaved proposal after rejection';title.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
  const source=[...form.querySelectorAll('select')].find(select=>[...select.options].some(option=>option.value==='source'))!;
  await act(async()=>{source.value='source';source.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  await act(async()=>button('Continue').click());
  const proposalType=[...form.querySelectorAll('select')].find(select=>[...select.options].some(option=>option.value==='DOCUMENT'))!;
  await act(async()=>{proposalType.value='CIRCLE';proposalType.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  const changeSelect=[...form.querySelectorAll<HTMLSelectElement>('.gov-change-builder select')].find(select=>[...select.options].some(option=>option.value==='UPDATE'))!;
  await act(async()=>{changeSelect.value='UPDATE';changeSelect.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  const entity=[...form.querySelectorAll<HTMLSelectElement>('.gov-change-builder select')].find(select=>[...select.options].some(option=>option.value==='circle'))!;
  await act(async()=>{entity.value='circle';entity.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  assert.ok([...form.querySelectorAll('button')].some(button=>button.textContent?.trim()==='Add change'),'the composer supports collecting multiple changes');
  const entityBefore=entity,entityValue=entity.value;
  await act(async()=>form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(posts.length,0,'a form submit cannot bypass the conduction step');
  const continueButton=button('Continue');
  await act(async()=>continueButton.click());
  const submit=form.querySelector<HTMLButtonElement>('.gov-form-footer button.primary')!;
  assert.notEqual(submit,continueButton,'advancing must not morph the clicked button into a submit control');
  assert.equal(posts.length,0,'advancing does not create a draft');
  await act(async()=>form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(posts.length,1);assert.equal(submit.disabled,true);assert.match(guard()!,/confirmation/);
  assert.equal(posts[0].options.body.title,'Unsaved proposal after rejection');assert.equal(posts[0].options.body.tensionId,'source');assert.deepEqual(posts[0].options.body.payload.changes,[{kind:'UPDATE',entityId:'circle',baseVersion:7,name:'Circle'}]);
  await act(async()=>rejectRequest(new RequestError('GOVERNANCE_POLICY_RECONCILIATION_REQUIRED','Rejected by policy')));
  assert.equal(container.querySelector('dialog'),dialog);assert.equal(dialog.open,true);assert.equal(form.querySelector('input[name=title]'),title);assert.equal(title.value,'Unsaved proposal after rejection');
  assert.equal(entityBefore.isConnected,true);
  assert.match(form.querySelector('.proposal-parts-list')!.textContent!,/Circle/,'the collected change survives the rejected request');
  await act(async()=>[...form.querySelectorAll<HTMLButtonElement>('.mare-governance-steps button')][1].click());
  await act(async()=>button('Edit').click());
  assert.equal([...form.querySelectorAll<HTMLSelectElement>('.gov-change-builder select')].find(select=>[...select.options].some(option=>option.value===entityValue))!.value,entityValue,'editing the retained part restores its original target');
  assert.ok([...dialog.querySelectorAll('[role=alert]')].some(alert=>/Local processes conflict/.test(alert.textContent!)));
  assert.equal(submit.disabled,false);assert.equal(dialog.querySelector<HTMLButtonElement>('header button')!.disabled,false);assert.match(guard()!,/unsaved/);
 }finally{await act(async()=>root.unmount());}
});
test('composer carries a real proposal ID and meeting version into agenda scheduling',async()=>{
 const posts:any[]=[],source={id:'source',title:'Context',description:'Description',circleId:'circle',authorId:'member',state:'OPEN'};
 const c=base('/structure/proposals',async(path:string,options:any)=>{if(options?.method==='POST'){posts.push({path,options});return{data:{id:proposal,version:1}};}if(path.endsWith('/tensions'))return{data:{items:[source],page:{nextCursor:null}}};if(path.includes('/effective'))return{data:{configuration:{method:'CONSENT_WINDOW',reviewDurationHours:24}}};if(path.endsWith('/meeting-agenda-items/targets'))return{data:{items:[{id:'meeting',title:'Encontro',circleId:'circle',version:7,state:'SCHEDULED'}]}};if(path.includes('/meetings?'))return{data:{items:[{id:'meeting',startAt:'2030-01-01T12:00:00Z'}],page:{nextCursor:null}}};return{data:{items:[],page:{nextCursor:null}}};});Object.assign(c.structure.nodes[0],{version:7});const root=createRoot(container);
 try{await act(async()=>root.render(<LocalizationProvider preferences={{locale:'pt-BR'}}><Component context={c}/></LocalizationProvider>));await act(async()=>button('Adicionar proposta').click());const form=container.querySelector<HTMLFormElement>('dialog form')!,title=form.querySelector<HTMLInputElement>('input[name=title]')!;title.value='Acordo';const selectValue=async(select:HTMLSelectElement,value:string)=>act(async()=>{select.value=value;select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});await selectValue([...form.querySelectorAll('select')].find(select=>[...select.options].some(option=>option.value==='source'))!,'source');await act(async()=>button('Continuar').click());await selectValue([...form.querySelectorAll('select')].find(select=>[...select.options].some(option=>option.value==='DOCUMENT'))!,'CIRCLE');await selectValue([...form.querySelectorAll<HTMLSelectElement>('.gov-change-builder select')].find(select=>[...select.options].some(option=>option.value==='UPDATE'))!,'UPDATE');await selectValue([...form.querySelectorAll<HTMLSelectElement>('.gov-change-builder select')].find(select=>[...select.options].some(option=>option.value==='circle'))!,'circle');await act(async()=>button('Continuar').click());await selectValue([...form.querySelectorAll('select')].find(select=>[...select.options].some(option=>option.value==='meeting' && option.textContent?.includes('Encontro')))!,'meeting');await act(async()=>form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));assert.equal(posts.length,2);assert.match(posts[0].path,/\/proposals$/);assert.equal(posts[0].options.body.tensionId,'source');assert.match(posts[1].path,/\/meetings\/meeting\/agenda$/);assert.equal(posts[1].options.version,7);assert.equal(posts[1].options.body.sourceId,proposal);}finally{await act(async()=>root.unmount());}
});


test('restriction options retain circle filtering and return keyboard focus on Escape',async()=>{
 const rows=[{id:'one',title:'Publicar com revisão',ownerId:'circle',authorId:'member',publishedVersion:1},{id:'two',title:'Outro acordo',ownerId:'other',authorId:'member',publishedVersion:1}];
 const c=base('/structure/working-agreements',async(path:string)=>({data:{items:path.endsWith('/documents')?rows:[],page:{nextCursor:null}}}));
 c.structure.nodes.push({entityId:'other',kind:'CIRCLE',name:'Outro círculo'});Object.assign(c.bootstrap.capabilities,{'structure.direct':true});
 const root=createRoot(container);
 try{
  await act(async()=>root.render(<LocalizationProvider preferences={{locale:'pt-BR'}}><Component context={c}/></LocalizationProvider>));
  await act(async()=>button('Todas').click());
  assert.match(container.querySelector('.mare-governance-restrictions')!.textContent!,/Publicar com revisão/);
  assert.match(container.querySelector('.mare-governance-restrictions')!.textContent!,/Outro acordo/);
  const options=container.querySelector<HTMLDetailsElement>('.mare-governance-options')!,summary=options.querySelector('summary')!;
  assert.equal(options.open,false);assert.match(options.textContent!,/Criar documento diretamente/);
  options.open=true;
  const circle=options.querySelector<HTMLSelectElement>('select')!;
  await act(async()=>{circle.value='other';circle.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  assert.doesNotMatch(container.querySelector('.mare-governance-restrictions')!.textContent!,/Publicar com revisão/);
  assert.match(container.querySelector('.mare-governance-restrictions')!.textContent!,/Outro acordo/);
  circle.focus();await act(async()=>circle.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  assert.equal(options.open,false);assert.equal(document.activeElement,summary);
 }finally{await act(async()=>root.unmount());}
});


for(const entry of [undefined,'allowed'])test('composer selects only authorized circles '+(entry?'and preserves map context':'when the root is unavailable'),async()=>{
 const calls:string[]=[],navigations:string[]=[];
 const c=base('/structure/proposals'+(entry?'?new=1&circleId='+entry:''),async(path:string)=>{calls.push(path);if(path.includes('/effective'))return{data:{configuration:{method:'CONSENT_WINDOW',reviewDurationHours:24}}};return{data:{items:[],page:{nextCursor:null}}};},[{id:'first',name:'Primeiro disponível'},{id:'allowed',name:'Contexto permitido'}]);
 c.navigate=(path:string)=>{navigations.push(path);};
 const root=createRoot(container);
 try{
  await act(async()=>root.render(<LocalizationProvider preferences={{locale:'pt-BR'}}><Component context={c}/></LocalizationProvider>));
  if(!entry)await act(async()=>button('Adicionar proposta').click());
  const circle=container.querySelector<HTMLInputElement>('dialog [role="combobox"]')!;
  assert.ok(circle);assert.equal(circle.value,entry?'Contexto permitido':'Primeiro disponível');
  await act(async()=>circle.focus());assert.deepEqual([...container.querySelectorAll('[role="option"]')].map(option=>option.textContent),['Primeiro disponível','Contexto permitido']);
  assert.equal(calls.some(path=>path.includes('/policies/circle/effective')),false);
  assert.ok(calls.some(path=>path.includes('/policies/'+(entry??'first')+'/effective')));
  assert.equal(container.querySelector('dialog [role=alert]'),null);
  if(entry)assert.deepEqual(navigations,['/structure/proposals']);
 }finally{await act(async()=>root.unmount());}
});

test('composer with no authorized circles blocks creation and keeps a working close action',async()=>{
 const calls:string[]=[],c=base('/structure/proposals?new=1&circleId=circle',async(path:string,options:any)=>{calls.push(path);assert.notEqual(options?.method,'POST');return{data:{items:[],page:{nextCursor:null}}};},[]),root=createRoot(container);
 try{
  await act(async()=>root.render(<LocalizationProvider preferences={{locale:'pt-BR'}}><Component context={c}/></LocalizationProvider>));
  assert.match(container.querySelector('dialog')!.textContent!,/Nenhum círculo disponível para propor/);
  assert.equal(container.querySelector<HTMLButtonElement>('.gov-form-footer .primary')!.disabled,true);
  assert.equal(calls.some(path=>path.includes('/effective')||path.includes('/meeting-agenda-items/targets')),false);
  const close=container.querySelector<HTMLButtonElement>('.mare-governance-eligibility button')!;assert.equal(close.disabled,false);
  await act(async()=>close.click());assert.equal(container.querySelector('dialog'),null);
 }finally{await act(async()=>root.unmount());}
});

test('a failed eligibility lookup does not fall back to structural circles',async()=>{
 const {RequestError}=await vite.ssrLoadModule('/src/api.ts');
 const calls:string[]=[],c=base('/structure/proposals?new=1',async()=>({data:{items:[],page:{nextCursor:null}}}));
 const baseApi=c.api;c.api=async(path:string,options:any)=>{calls.push(path);if(path.endsWith('/governance/proposal-circles'))throw new RequestError('RESOURCE_NOT_FOUND','Unavailable');return baseApi(path,options);};
 const root=createRoot(container);
 try{
  await act(async()=>root.render(<LocalizationProvider preferences={{locale:'pt-BR'}}><Component context={c}/></LocalizationProvider>));
  assert.match(container.querySelector('dialog [role=alert]')!.textContent!,/Não foi possível verificar os círculos disponíveis/);
  assert.equal(container.querySelector<HTMLButtonElement>('.gov-form-footer .primary')!.disabled,true);
  assert.equal(calls.some(path=>path.includes('/effective')),false);
  assert.equal(container.querySelector<HTMLInputElement>('dialog [role=combobox]')?.value,'');assert.equal(container.querySelector<HTMLInputElement>('dialog [role=combobox]')?.disabled,true);
 }finally{await act(async()=>root.unmount());}
});

test('tension selection preserves the live list and closing restores its visible row',async()=>{
 const id='11111111-1111-4111-8111-111111111111',row={id,title:'Clarify a publication',circleId:'circle',state:'OPEN',authorId:'member',version:3};
 let calls=0,navigation='';
 const c=base('/structure/tensions',async(path:string)=>{if(path.endsWith('/tensions'))calls++;return{data:{items:path.endsWith('/tensions')?[row]:[],page:{nextCursor:null}}};});
 c.navigate=(path:string)=>{navigation=path;};
 const root=createRoot(container),render=async(path:string)=>act(async()=>root.render(<LocalizationProvider preferences={{locale:'en-US'}}><Component context={{...c,path}}/></LocalizationProvider>));
 try{
  await render(c.path);
  const opener=container.querySelector<HTMLButtonElement>('[data-tension-id="'+id+'"]')!;assert.ok(opener);
  await act(async()=>opener.click());assert.match(navigation,/tensionId=/);
  await render(navigation);assert.ok(container.querySelector('[aria-label="Tensão: '+row.title+'"]'));
  assert.equal(calls,1,'selection must not refetch and unmount the list');
  const close=container.querySelector<HTMLButtonElement>('button[aria-label="Fechar detalhes da tensão"]')!;
  await act(async()=>close.click());await render(navigation);
  assert.equal(container.querySelector('[data-tension-id="'+id+'"]'),opener);
  assert.equal(document.activeElement,opener);
  assert.equal(calls,1);
 }finally{await act(async()=>root.unmount());}
});

for(const intent of ['async','draft'])test('composer offers explicit async conduction from a facilitated circle and honors '+intent+' intent',async()=>{
 const posts:any[]=[],source={id:'source',title:'Context',description:'Description',circleId:'circle',authorId:'member',state:'OPEN'};
 const c=base('/structure/proposals',async(path:string,options:any)=>{
  if(options?.method==='POST'){posts.push({path,options});return{data:{id:proposal,version:1}};}
  if(path.endsWith('/tensions'))return{data:{items:[source],page:{nextCursor:null}}};
  if(path.includes('/effective'))return{data:{configuration:{method:'MANUAL_FACILITATED',reviewDurationHours:168},allowOverride:true}};
  return{data:{items:[],page:{nextCursor:null}}};
 });Object.assign(c.structure.nodes[0],{version:7});const root=createRoot(container);
 try{
  await act(async()=>root.render(<LocalizationProvider preferences={{locale:'pt-BR'}}><Component context={c}/></LocalizationProvider>));
  await act(async()=>button('Adicionar proposta').click());const form=container.querySelector<HTMLFormElement>('dialog form')!;
  form.querySelector<HTMLInputElement>('input[name=title]')!.value='Proposta assíncrona';
  const selectValue=async(select:HTMLSelectElement,value:string)=>act(async()=>{select.value=value;select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  await selectValue([...form.querySelectorAll('select')].find(select=>[...select.options].some(option=>option.value==='source'))!,'source');
  await act(async()=>button('Continuar').click());
  await selectValue([...form.querySelectorAll('select')].find(select=>[...select.options].some(option=>option.value==='DOCUMENT'))!,'CIRCLE');
  await selectValue([...form.querySelectorAll<HTMLSelectElement>('.gov-change-builder select')].find(select=>[...select.options].some(option=>option.value==='UPDATE'))!,'UPDATE');
  await selectValue([...form.querySelectorAll<HTMLSelectElement>('.gov-change-builder select')].find(select=>[...select.options].some(option=>option.value==='circle'))!,'circle');
  await act(async()=>button('Continuar').click());
  const toggle=form.querySelector<HTMLButtonElement>('[role=switch]')!;assert.equal(toggle.disabled,false);assert.equal(toggle.getAttribute('aria-checked'),'false');
  await act(async()=>toggle.click());assert.equal(toggle.getAttribute('aria-checked'),'true');assert.match(form.textContent!,/escalar|escalação/);
  const period=[...form.querySelectorAll('select')].find(select=>[...select.options].some(option=>option.textContent==='7 dias'))!;assert.equal(period.value,'168');
  if(intent==='draft')await act(async()=>form.dispatchEvent(new dom.window.SubmitEvent('submit',{bubbles:true,cancelable:true,submitter:button('Salvar rascunho')})));
  else await act(async()=>form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(posts.length,intent==='draft'?1:2);assert.equal(posts[0].options.body._delivery,undefined);
  if(intent==='async'){assert.match(posts[1].path,/actions\/submit$/);assert.deepEqual(posts[1].options.body,{reviewDurationHours:168});assert.equal(posts[1].options.version,1);}
 }finally{await act(async()=>root.unmount());}
});

test('decision refresh and recorded ballot retain the active proposal, errors keep the rationale, and another proposal resets the tab',async()=>{
 const another='22222222-2222-4222-8222-222222222222';
 let fails=true,refreshes=0;const gets:string[]=[];
 const detail:any={proposal:{id:proposal,title:'Assíncrona',version:2,revision:1,state:'REVIEW',kind:'GOVERNANCE',canVote:true},revisions:[{number:1,payload:{changes:[]}}],rounds:[{id:'round',revision:1,state:'OPEN',step:'PRESENT',policy:{decisionProcess:'HOLACRACY_O2',method:'CONSENT_WINDOW',workflowSteps:['PRESENT','DECIDE'],quorumPercent:100,allowAbstain:true,allowRevote:false},electorate:['member'],deadline:'2099-01-01T00:00:00Z'}],ballots:[],objections:[],nominations:[],commits:[],history:[]};
 const second={...detail,proposal:{...detail.proposal,id:another,title:'Outra proposta'},ballots:[]};
 const c=base('/structure/proposals/'+proposal,async(path:string,options:any)=>{
  if(options?.method==='POST'){
   if(fails)throw Error('failure');
   detail.ballots=[{roundId:'round',memberId:'member',choice:options.body.choice,number:1,rationale:options.body.rationale}];
   detail.proposal={...detail.proposal,canVote:false};return {data:{}};
  }
  gets.push(path);
  return {data:path.endsWith('/origin')?{origin:null}:path.endsWith('/proposals/'+proposal)?structuredClone(detail):path.endsWith('/proposals/'+another)?structuredClone(second):{items:[],page:{nextCursor:null}}};
 });
 c.refresh=()=>{refreshes++;};const root=createRoot(container);
 const render=()=>act(async()=>root.render(<LocalizationProvider preferences={{locale:'pt-BR'}}><Component context={c}/></LocalizationProvider>));
 try {
  await render();await act(async()=>button('Decisão').click());
  const status=container.querySelector<HTMLElement>('.proposal-decision-panel [role=status]')!;
  gets.length=0;await act(async()=>status.querySelector<HTMLButtonElement>('button')!.click());
  assert.deepEqual(gets,['/organizations/org/proposals/'+proposal]);
  assert.equal(button('Decisão').getAttribute('aria-pressed'),'true');
  const form=container.querySelector<HTMLFormElement>('.proposal-decision-panel form.gov-form')!,textarea=form.querySelector('textarea')!;
  const setter=Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value')!.set!;
  await act(async()=>{setter.call(textarea,'Justificativa preservada');textarea.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
  textarea.focus();await act(async()=>form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(container.querySelector('.proposal-decision-panel textarea'),textarea);assert.equal(textarea.value,'Justificativa preservada');assert.equal(document.activeElement,textarea);assert.equal(button('Decisão').getAttribute('aria-pressed'),'true');
  fails=false;gets.length=0;await act(async()=>form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
  assert.deepEqual(gets,['/organizations/org/proposals/'+proposal]);
  assert.equal(refreshes,0);assert.equal(button('Decisão').getAttribute('aria-pressed'),'true');assert.match(container.querySelector('.proposal-decision-panel')!.textContent!,/Consentimento registrado/);
  c.path='/structure/proposals/'+another;await render();assert.equal(button('Proposta').getAttribute('aria-pressed'),'true');
 }finally{await act(async()=>root.unmount());}
});
test('an inaccessible proposal route explains itself instead of rendering the catalogue inside the dialog',async()=>{
 const {RequestError}=await vite.ssrLoadModule('/src/api.ts');
 const rows=[{id:'22222222-2222-4222-8222-222222222222',title:'Visible proposal',state:'DRAFT',kind:'GOVERNANCE',circleId:'circle',authorId:'member'}];
 const navigations:string[]=[];
 const c=base('/structure/proposals/'+proposal,async(path:string)=>{if(path.endsWith('/proposals/'+proposal))throw new RequestError('RESOURCE_NOT_FOUND','RESOURCE_NOT_FOUND');return{data:{items:path.endsWith('/proposals')?rows:[],page:{nextCursor:null}}};});c.navigate=(value:string)=>{navigations.push(value);};
 const root=createRoot(container);
 try{
  await act(async()=>root.render(<LocalizationProvider preferences={{locale:'pt-BR'}}><Component context={c}/></LocalizationProvider>));
  const dialog=container.querySelector('dialog.orgmap-dialog')!;assert.ok(dialog);
  assert.match(dialog.querySelector('.gov-missing-record')!.textContent!,/Proposta não encontrada ou sem acesso/);
  assert.equal(dialog.querySelector('.gov-catalogue-controls, .proposal-results, .empty-state'),null);
  assert.doesNotMatch(dialog.textContent!,/Não foi possível concluir a ação/);
  assert.equal(dialog.querySelector('[role=alert]'),null);
  await act(async()=>[...dialog.querySelectorAll('button')].find(b=>b.textContent==='Voltar para propostas')!.click());
  assert.deepEqual(navigations,['/structure/proposals']);
 }finally{await act(async()=>root.unmount());}
});
test('a scoped empty catalogue stays compact and leads to the scopes that have records',async()=>{
 const rows=[{id:'tension',title:'Shared tension',circleId:'circle',state:'OPEN',authorId:'other',version:1}];
 const c=base('/structure/tensions',async(path:string)=>({data:{items:path.endsWith('/tensions')?rows:[],page:{nextCursor:null}}}));
 const root=createRoot(container);
 try{
  await act(async()=>root.render(<LocalizationProvider preferences={{locale:'pt-BR'}}><Component context={c}/></LocalizationProvider>));
  const empty=container.querySelector('.gov-scope-empty')!;assert.ok(empty);assert.match(empty.textContent!,/Nenhuma tensão neste recorte/);
  assert.equal(container.querySelector('.gov-catalogue-tabs button[aria-pressed="true"]')!.getAttribute('aria-label'),'Minhas');
  assert.equal(container.querySelector('.gov-catalogue-tabs button[aria-label="Todas"]')!.getAttribute('data-count'),'1');
  await act(async()=>button('Ver todas as tensões (1)').click());
  assert.equal(container.querySelector('.gov-scope-empty'),null);assert.match(container.querySelector('.tension-catalogue-list')!.textContent!,/Shared tension/);
 }finally{await act(async()=>root.unmount());}
});
