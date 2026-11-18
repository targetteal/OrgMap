import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';import {createServer} from 'vite';import {fileURLToPath} from 'node:url';import React,{act} from 'react';
const dom=new JSDOM('<!doctype html><main></main>',{url:'http://test.localhost'});for(const k of ['window','document','navigator','HTMLElement','HTMLInputElement','Event','FormData'])Object.defineProperty(globalThis,k,{value:k==='window'?dom.window:(dom.window as any)[k],configurable:true});Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
const {createRoot}=await import('react-dom/client');const vite=await createServer({root:fileURLToPath(new URL('../',import.meta.url)),configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});const {MeetingOutcomeForm}=await vite.ssrLoadModule('/src/features/meetings/outcome-form.tsx');const rootEl=document.querySelector('main')!;test.after(async()=>{await vite.close();dom.window.close();});
const org='11111111-1111-4111-8111-111111111111',meeting='22222222-2222-4222-8222-222222222222',target='33333333-3333-4333-8333-333333333333';
const context=(api:any,extras:any={})=>({organizationId:org,session:{account:{id:'a'}},bootstrap:{organization:{timeZone:'UTC'},membership:{id:'m',memberType:'MEMBER',orgRole:'OWNER'},modules:{work:true,goals:true,governance:true,meetings:true},authorizationRevision:1},accountPreferences:{locale:'en-US'},api,navigate:()=>{},members:[],structure:{structureRevision:1,nodes:[],circles:[],roles:[],memberships:[],occupancies:[],coverage:{complete:true,depthLimited:false,degradedReasons:[]}},...extras} as any);
async function change(name:string,value:string){const e=rootEl.querySelector(`[name="${name}"]`) as HTMLInputElement;assert.ok(e,name);await act(async()=>{const proto=e instanceof dom.window.HTMLInputElement?dom.window.HTMLInputElement.prototype:e instanceof dom.window.HTMLTextAreaElement?dom.window.HTMLTextAreaElement.prototype:dom.window.HTMLSelectElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(e,value);e.dispatchEvent(new dom.window.Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));});}
const button=(title:string)=>{const b=[...rootEl.querySelectorAll('button')].find(x=>x.textContent===title);assert.ok(b,title);return b;};
const props={meetingId:meeting,meetingVersion:7,timeZone:'UTC',agenda:[{id:'a1',title:'Agenda item'}],onCreated:()=>{},onProposal:()=>{},onReload:()=>{}};
test('role selection starts with everyone, resets for a new role and submits only the selected subset',async()=>{
 const root=createRoot(rootEl),writes:any[]=[];
 const first=[{id:'a',name:'Ana',assignable:true},{id:'b',name:'Bia',assignable:true}];
 const api=async(path:string,opts:any)=>{
  if(opts?.method==='POST'){
   writes.push(opts.body);
   return {data:{target:{kind:'TASK',id:target,title:'Role task'}}};
  }
  if(path.includes('/role-occupants?'))return {data:{snapshot:'snapshot',people:path.includes('roleId=one')?first:[{id:'c',name:'Camila',assignable:true}]}};
  return {data:{projects:[{id:'shared',title:'Shared work',accessRole:'MANAGER',visibility:'PUBLIC'}]}};
 };
 const c=context(api,{structure:{nodes:[{nodeId:'c1',kind:'CIRCLE',entityId:'circle-one',name:'First circle'},{nodeId:'c2',kind:'CIRCLE',entityId:'circle-two',name:'Second circle'},{kind:'ROLE',entityId:'one',parentNodeId:'c1',name:'Same role'},{kind:'ROLE',entityId:'two',parentNodeId:'c2',name:'Same role'}]}});
 const checked=()=>[...rootEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map(input=>input.checked);
 try{
  await act(async()=>root.render(<MeetingOutcomeForm {...props} context={c}/>));
  assert.deepEqual([...rootEl.querySelectorAll('[name="workLink"] option')].filter(option=>(option as HTMLOptionElement).value.startsWith('ROLE:')).map(option=>option.textContent),['Same role · First circle','Same role · Second circle']);
  await change('projectId','shared');
  await change('workLink','ROLE:one');
  assert.deepEqual(checked(),[true,true]);
  await act(async()=>rootEl.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  assert.deepEqual(checked(),[false,true]);
  await change('workLink','ROLE:two');
  assert.deepEqual(checked(),[true]);
  await change('workLink','ROLE:one');
  assert.deepEqual(checked(),[true,true]);
  await act(async()=>rootEl.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await change('title','Role task');
  await act(async()=>button('Create output').click());
  assert.deepEqual(writes[0].workLink,{kind:'ROLE',targetId:'one',selection:{snapshot:'snapshot',people:['b']}});
 }finally{await act(async()=>root.unmount());}
});
test('another assignee needs a project, and switching to it preserves the chosen member',async()=>{
 const writes:any[]=[],root=createRoot(rootEl);
 const api=async(_path:string,opts:any)=>{
  if(opts?.method==='POST'){
   writes.push(opts.body);
   return {data:{target:{kind:'TASK',id:target,title:'Linked task'}}};
  }
  return {data:{projects:[{id:'shared',title:'Shared work',accessRole:'MANAGER',visibility:'PUBLIC'}]}};
 };
 const c=context(api,{
  members:[{id:'other',displayName:'Active person',status:'ACTIVE',memberType:'MEMBER'},{id:'guest',displayName:'Guest person',status:'ACTIVE',memberType:'GUEST'}],
  structure:{nodes:[{kind:'ROLE',entityId:'role',name:'Role from structure'}]},
 });
 try{
  await act(async()=>root.render(<MeetingOutcomeForm {...props} context={c} agendaContext={{id:'a1',announceAdapt:false}}/>));
  assert.match(rootEl.textContent!,/Active person|Role from structure/);
  assert.doesNotMatch(rootEl.textContent!,/Guest person/);
  await change('title','Linked task');
  await change('workLink','MEMBER:other');
  assert.match(rootEl.textContent!,/choose a project they can access/);
  assert.equal(button('Create output').disabled,true);
  assert.deepEqual(writes,[]);
  await change('projectId','shared');
  assert.equal(button('Create output').disabled,false);
  await act(async()=>button('Create output').click());
  assert.deepEqual(writes,[{title:'Linked task',kind:'TASK',agendaId:'a1',projectId:'shared',workLink:{kind:'MEMBER',targetId:'other'}}]);
 }finally{await act(async()=>root.unmount());}
});
test('task filters projects and posts real selection with meeting revision without leaving the meeting',async()=>{const calls:any[]=[],nav:string[]=[];let created=0;const api=async(path:string,opts:any)=>{calls.push({path,opts});return opts?.method==='POST'?{data:{target:{kind:'TASK',id:target,title:'Created'}}}:{data:{projects:[{id:'ok',title:'Editable',accessRole:'EDITOR',frozen:false,visibility:'PRIVATE'},{id:'read',title:'Read only',accessRole:'READER',frozen:false},{id:'frozen',title:'Frozen',accessRole:'MANAGER',frozen:true}]}};};const root=createRoot(rootEl);try{await act(async()=>root.render(<MeetingOutcomeForm {...props} onCreated={()=>{created++;}} context={context(api,{navigate:(p:string)=>nav.push(p)})}/>));assert.match(rootEl.textContent!,/Editable/);assert.doesNotMatch(rootEl.textContent!,/Read only|Frozen/);await change('title','Task from meeting');const project=[...rootEl.querySelectorAll('select')].find(x=>[...x.options].some(o=>o.value==='ok'))!;await act(async()=>{project.value='ok';project.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});await act(async()=>button('Create output').click());assert.equal(calls[1].opts.version,7);assert.equal(calls[1].opts.body.projectId,'ok');assert.equal(calls[1].opts.body.kind,'TASK');assert.equal(created,1);assert.deepEqual(nav,[]);}finally{await act(async()=>root.unmount());}});
test('a project created from the focused tension refreshes the meeting without navigating',async()=>{
 const writes:any[]=[],nav:string[]=[];
 let created=0;
 const api=async(_path:string,opts:any)=>{
  if(opts?.method!=='POST')return {data:{projects:[]}};
  writes.push(opts.body);
  return {data:{target:{kind:'PROJECT',id:target,title:'Project from meeting'}}};
 };
 const root=createRoot(rootEl);
 try{
  await act(async()=>root.render(<MeetingOutcomeForm {...props} circleId="core-circle" context={context(api,{navigate:(path:string)=>nav.push(path),structure:{nodes:[{nodeId:'core',entityId:'core-circle',kind:'CIRCLE',name:'Core'},{entityId:'project-role',kind:'ROLE',parentNodeId:'core',name:'Delivery'}]}})}
   agendaContext={{id:'a1',announceAdapt:false}} onCreated={()=>{created++;}}/>));
  await change('kind','PROJECT');
  await change('title','Project from meeting');
  await change('responsible','project-role');
  await change('description','   ');
  await act(async()=>button('Create output').click());
  assert.deepEqual(writes,[{kind:'PROJECT',title:'Project from meeting',agendaId:'a1',visibility:'PRIVATE',roleId:'project-role',leadMemberId:null}]);
  assert.equal(created,1);
  assert.deepEqual(nav,[]);
 }finally{await act(async()=>root.unmount());}
});
test('project defaults private; goal period and proposal are explicit choices',async()=>{const calls:any[]=[],proposals:any[]=[];const api=async(path:string,opts:any)=>{calls.push({path,opts});if(opts?.method==='POST')return {data:{target:{kind:'PROJECT',id:target,title:'x'}}};return path.endsWith('goal-periods')?{data:{items:[{id:'period',title:'Current',startsOn:'2020-01-01',endsOn:'2099-12-31',archived:false},{id:'old',title:'Old',startsOn:'2010-01-01',endsOn:'2011-01-01',archived:false}]}}:{data:{projects:[]}};};const root=createRoot(rootEl);try{await act(async()=>root.render(<MeetingOutcomeForm {...props} context={context(api)} onProposal={x=>proposals.push(x)}/>));await change('kind','PROJECT');assert.equal((rootEl.querySelector('[name="visibility"]') as HTMLSelectElement).value,'PRIVATE');await change('kind','GOAL');assert.match(rootEl.textContent!,/Current/);assert.doesNotMatch(rootEl.textContent!,/Old/);await change('kind','PROPOSAL');await change('agendaId','a1');await act(async()=>button('Open proposal editor').click());assert.deepEqual(proposals,['a1']);assert.equal(calls.filter(x=>x.opts?.method==='POST').length,0);}finally{await act(async()=>root.unmount());}});
test('scope change or unmount discards late result and removes guard',async()=>{let resolve!:(x:any)=>void,guard:()=>string|null=()=>null;const navigated:string[]=[];const api=async(_path:string,opts:any)=>opts?.method==='POST'?new Promise(r=>{resolve=r;}):{data:{projects:[]}};const root=createRoot(rootEl);const extra={navigate:(p:string)=>navigated.push(p),registerNavigationGuard:(f:()=>string|null)=>{guard=f;return()=>{guard=()=>null;};}};try{await act(async()=>root.render(<MeetingOutcomeForm {...props} context={context(api,extra)}/>));await change('title','Pending');await act(async()=>button('Create output').click());assert.match(guard()!,/Wait for the output/);await act(async()=>root.unmount());assert.equal(guard(),null);await act(async()=>resolve({data:{target:{kind:'TASK',id:target,title:'Late'}}}));assert.deepEqual(navigated,[]);}finally{}}
);

test('role and module changes invalidate a goal and suppress unavailable requests and submits',async()=>{let resolveGoal!:(v:any)=>void;const calls:any[]=[],nav:string[]=[];const api=async(path:string,opts:any)=>{calls.push({path,opts});if(path.endsWith('goal-periods'))return new Promise(r=>{resolveGoal=r;});return {data:{projects:[]}};};const root=createRoot(rootEl);const ctx=(role:string,modules:any)=>context(api,{navigate:(p:string)=>nav.push(p),bootstrap:{organization:{timeZone:'UTC'},membership:{id:'m',memberType:'MEMBER',orgRole:role},authorizationRevision:1,modules}});try{await act(async()=>root.render(<MeetingOutcomeForm {...props} context={ctx('OWNER',{work:true,goals:true,governance:true})}/>));await change('kind','GOAL');assert.equal(calls.filter(x=>x.path.endsWith('goal-periods')).length,1);await act(async()=>root.render(<MeetingOutcomeForm {...props} context={ctx('MEMBER',{work:true,goals:true,governance:true})}/>));assert.equal([...rootEl.querySelectorAll('option')].some(x=>x.value==='GOAL'),false);await act(async()=>resolveGoal({data:{items:[{id:'late',title:'Late',startsOn:'2020-01-01',endsOn:'2099-12-31',archived:false}]}}));assert.doesNotMatch(rootEl.textContent!,/Late/);assert.equal((rootEl.querySelector('[name="kind"]') as HTMLSelectElement).value,'TASK');await change('kind','PROJECT');assert.equal((rootEl.querySelector('[name="kind"]') as HTMLSelectElement).value,'PROJECT');await act(async()=>root.render(<MeetingOutcomeForm {...props} context={ctx('OWNER',{work:false,goals:false,governance:false})}/>));assert.match(rootEl.textContent!,/No output types are available/);assert.equal(rootEl.querySelector('form'),null);assert.equal(calls.filter(x=>x.opts?.method==='POST').length,0);assert.equal(calls.filter(x=>x.path.endsWith('goal-periods')).length,1);assert.deepEqual(nav,[]);}finally{await act(async()=>root.unmount());}});

test('allowed kinds removes governance choices while omitted prop preserves legacy defaults',async()=>{
 const api=async()=>({data:{projects:[]}}),ctx=context(api),root=createRoot(rootEl);
 const kinds=()=>[...(rootEl.querySelector('[name="kind"]') as HTMLSelectElement).options].map(o=>o.value);
 try{
  await act(async()=>root.render(<MeetingOutcomeForm {...props} context={ctx}/>));
  assert.deepEqual(kinds(),['TASK','PROJECT','GOAL','POLICY','PROPOSAL']);
  assert.equal((rootEl.querySelector('[name="kind"]') as HTMLSelectElement).value,'TASK');
  await change('kind','PROPOSAL');
  await act(async()=>root.render(<MeetingOutcomeForm {...props} context={ctx} allowedKinds={['TASK','PROJECT','GOAL']}/>));
  assert.deepEqual(kinds(),['TASK','PROJECT','GOAL']);
  assert.equal((rootEl.querySelector('[name="kind"]') as HTMLSelectElement).value,'TASK');
  assert.equal([...rootEl.querySelectorAll('button')].some(b=>b.textContent==='Open proposal editor'),false);
 }finally{await act(async()=>root.unmount());}
});

test('allowed kinds respects module availability and empty list offers no form or requests',async()=>{
 const calls:string[]=[],api=async(path:string)=>{calls.push(path);return {data:{projects:[]}};},root=createRoot(rootEl);
 const ctx=context(api,{bootstrap:{organization:{timeZone:'UTC'},membership:{id:'m',memberType:'MEMBER',orgRole:'OWNER'},modules:{work:false,goals:true,governance:true},authorizationRevision:1}});
 try{
  await act(async()=>root.render(<MeetingOutcomeForm {...props} context={ctx} allowedKinds={['TASK','PROJECT']}/>));
  assert.match(rootEl.textContent!,/No output types are available/);
  assert.equal(rootEl.querySelector('form'),null);
  await act(async()=>root.render(<MeetingOutcomeForm {...props} context={context(api)} allowedKinds={['PROJECT']}/>));
  assert.equal((rootEl.querySelector('[name="kind"]') as HTMLSelectElement).value,'PROJECT');
  await act(async()=>root.render(<MeetingOutcomeForm {...props} context={context(api)} allowedKinds={[]}/>));
  assert.equal(rootEl.querySelector('form'),null);
  assert.match(rootEl.textContent!,/No output types are available/);
  assert.deepEqual(calls,[]);
 }finally{await act(async()=>root.unmount());}
});

test('project requires a responsible limited to direct circle roles or a circle person',async()=>{
 const circle='44444444-4444-4444-8444-444444444444',other='55555555-5555-4555-8555-555555555555';
 const role='66666666-6666-4666-8666-666666666666';
 const structure={structureRevision:1,circles:[],roles:[],memberships:[{id:'cm1',memberId:'m3',circleId:circle,startsAt:'2020-01-01',endsAt:null}],coverage:{complete:true,depthLimited:false,degradedReasons:[]},
  nodes:[{nodeId:'nc',entityId:circle,kind:'CIRCLE',parentNodeId:null,name:'Core',version:1},{nodeId:'no',entityId:other,kind:'CIRCLE',parentNodeId:null,name:'Other',version:1},{nodeId:'nr',entityId:role,kind:'ROLE',parentNodeId:'nc',name:'Facilitator',version:1},{nodeId:'nested',entityId:'nested-circle',kind:'CIRCLE',parentNodeId:'nc',name:'Nested',version:1},{nodeId:'nested-role',entityId:'nested-role',kind:'ROLE',parentNodeId:'nested',name:'Nested role',version:1},{nodeId:'nx',entityId:'99999999-9999-4999-8999-999999999999',kind:'ROLE',parentNodeId:'no',name:'Facilitator',version:1}],
  occupancies:[{id:'o1',memberId:'m1',roleId:role,circleId:circle,startsAt:'2020-01-01',endsAt:null},{id:'o2',memberId:'m2',roleId:role,circleId:circle,startsAt:'2020-01-01',endsAt:'2001-01-01'},{id:'o3',memberId:'m4',roleId:'nested-role',circleId:'nested-circle',startsAt:'2020-01-01',endsAt:null},{id:'o4',memberId:'guest',roleId:role,circleId:circle,startsAt:'2020-01-01',endsAt:null}]};
 const members=[{id:'m1',displayName:'Ana Active',status:'ACTIVE',memberType:'MEMBER'},{id:'m2',displayName:'Old Occ',status:'ACTIVE',memberType:'MEMBER'},{id:'m3',displayName:'Circle Member',status:'ACTIVE',memberType:'MEMBER'},{id:'m4',displayName:'Outsider',status:'ACTIVE',memberType:'MEMBER'},{id:'guest',displayName:'Guest holder',status:'ACTIVE',memberType:'GUEST'}];
 const calls:any[]=[];const api=async(_p:string,opts:any)=>{calls.push(opts);return opts?.method==='POST'?{data:{target:{kind:'PROJECT',id:target,title:'x'}}}:{data:{projects:[]}};};
 const root=createRoot(rootEl);
 try{
  await act(async()=>root.render(<MeetingOutcomeForm {...props} circleId={circle} context={context(api,{structure,members})}/>));
  await change('kind','PROJECT');
  const roleSel=rootEl.querySelector('[name="responsible"]') as HTMLSelectElement;
  assert.deepEqual([...roleSel.options].map(o=>o.textContent),['Select','Facilitator · Core','Assign directly to a person']);
  await change('title','Project from meeting');
  await act(async()=>button('Create output').click());
  assert.equal(button('Create output').disabled,true);
  assert.equal(calls.filter(o=>o?.method==='POST').length,0,'submit blocked without responsible');
  await change('agendaId','a1');
  await change('description','  Agreed project description  ');
  await change('workLink','MEMBER:m4');
  await act(async()=>{roleSel.value=role;roleSel.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  const personSel=rootEl.querySelector('[name="leadMemberId"]') as HTMLSelectElement;
  assert.ok(personSel,'person select shown only after role pick');
  assert.deepEqual([...personSel.options].map(o=>o.textContent),['Everyone in the role','Ana Active']);
  await act(async()=>{personSel.value='m1';personSel.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  await act(async()=>button('Create output').click());
  let post=calls.find(o=>o?.method==='POST');
  assert.equal(post.body.description,'Agreed project description');
  assert.deepEqual(post.body.workLink,{kind:'MEMBER',targetId:'m4'},'optional project context is independent of the circle responsible');
  assert.equal(post.body.roleId,role);
  assert.equal(post.body.leadMemberId,'m1');
  assert.equal(post.body.agendaId,'a1');
  await act(async()=>{roleSel.value='__person__';roleSel.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  const directSel=rootEl.querySelector('[name="leadMemberId"]') as HTMLSelectElement;
  assert.deepEqual([...directSel.options].map(o=>o.textContent),['Select','Ana Active','Circle Member']);
  assert.equal(button('Create output').disabled,true,'direct assignment requires a circle person');
  await act(async()=>{directSel.value='m3';directSel.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  await act(async()=>button('Create output').click());
  post=calls.filter(o=>o?.method==='POST').pop();
  assert.equal(post.body.roleId,null);
  assert.equal(post.body.leadMemberId,'m3');
  await act(async()=>root.render(<MeetingOutcomeForm {...props} circleId={other} context={context(api,{structure,members})}/>));
  const changedCircleResponsible=rootEl.querySelector('[name="responsible"]') as HTMLSelectElement;
  assert.equal(changedCircleResponsible.value,'','circle change clears the old responsible');
  assert.deepEqual([...changedCircleResponsible.options].map(option=>option.textContent),['Select','Facilitator · Other','Assign directly to a person']);
  assert.equal(button('Create output').disabled,true);
  assert.equal(rootEl.querySelector('[name="leadMemberId"]'),null);
 }finally{await act(async()=>root.unmount());}
});
