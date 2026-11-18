import test from "node:test";
import assert from "node:assert/strict";
import React,{act} from "react";
import {JSDOM} from "jsdom";
import {createServer} from "vite";
const dom=new JSDOM('<main></main>',{url:'http://localhost'});
Object.defineProperty(dom.window,'matchMedia',{value:()=>({matches:false,addEventListener(){},removeEventListener(){}})});
for(const name of ['window','document','navigator','HTMLElement','Node','Event'])Object.defineProperty(globalThis,name,{value:name==='window'?dom.window:(dom.window as any)[name],configurable:true});
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
const {createRoot}=await import('react-dom/client');
const vite=await createServer({root:new URL('../',import.meta.url).pathname,configFile:false,logLevel:'error',server:{middlewareMode:true,watch:null,hmr:false,ws:false},appType:'custom'});
const {NotificationDropdown}=await vite.ssrLoadModule('/src/NotificationDropdown.tsx'),{StructureCreateMenu}=await vite.ssrLoadModule('/src/StructureCreateMenu.tsx'),{LocalizationProvider}=await vite.ssrLoadModule('/src/localization/index.tsx');
const {AccountMenu}=await vite.ssrLoadModule('/src/AccountMenu.tsx'),{AccountShell}=await vite.ssrLoadModule('/src/AccountShell.tsx'),{projectRelations}=await vite.ssrLoadModule('/src/features/work/project-relations.tsx');
test.after(async()=>{await vite.close();dom.window.close();});
const target=document.querySelector('main')!;
const button=(name:string)=>{const item=Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find(item=>item.getAttribute('aria-label')===name||item.textContent?.trim()===name);assert.ok(item,name);return item;};
const context=(organizationId:string,api:any,navigate:any=()=>{})=>({organizationId,session:{account:{id:'account'}},bootstrap:{membership:{id:'member'},authorizationRevision:1},api,navigate});
test('account menu separates organization switching and secondary resources without exposing the account identifier',async()=>{
 const root=createRoot(target);let chosen='';
 try {
  await act(async()=>root.render(<AccountMenu name="Ana" organizationId="A" organizationName="Organização A" organizations={[{id:'A',name:'Organização A'},{id:'B',name:'Organização B'}]} links={[{path:'/account/general',label:'Minha conta'},{path:'/platform/favorites',label:'Favoritos'},{path:'/interoperability',label:'Integrações'}]} guest={false} navigate={()=>{}} onClose={()=>{}} onCreate={()=>{}} onInvite={()=>{}} onLogout={()=>{}} onOrganization={(id:string)=>chosen=id}/>));
  assert.equal(document.activeElement,target.querySelector('.mare-account-menu'));
  assert.doesNotMatch(target.textContent!,/ID da conta|Organização B/);
  await act(async()=>button('Integrações e recursos').click());assert.match(target.textContent!,/Integrações/);
  assert.equal(document.activeElement,button('Voltar ao menu da conta'));
  await act(async()=>button('Voltar ao menu da conta').click());
  assert.equal(document.activeElement,button('Integrações e recursos'));
  await act(async()=>target.querySelector<HTMLButtonElement>('.account-menu-organization')!.click());
  assert.equal(document.activeElement,button('Voltar ao menu da conta'));
  await act(async()=>target.querySelector('[role=dialog]')!.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  assert.equal(document.activeElement,target.querySelector('.account-menu-organization'));
  await act(async()=>target.querySelector<HTMLButtonElement>('.account-menu-organization')!.click());
  assert.match(target.textContent!,/Organização B/);
  await act(async()=>button('Organização B').click());assert.equal(chosen,'B');
 }finally{await act(async()=>root.unmount());}
});
test('account settings menu receives focus and Escape returns it to the account button',async()=>{
 const root=createRoot(target);
 const session={account:{id:'account',displayName:'Ana'},organizations:[{id:'A',name:'Organização A',memberId:'member'},{id:'B',name:'Comunicação',memberId:'member'},...['C','D','E','F','G'].map(id=>({id,name:`Equipe ${id}`,memberId:'member'}))]};
 let chosen='';
 try{
  await act(async()=>root.render(<LocalizationProvider preferences={{locale:'pt-BR'}}><AccountShell session={session} bootstrap={null} context={null} path="/account/general" navigate={()=>{}} onLogout={()=>{}} onChangeOrg={id=>{chosen=id;}}>Dados pessoais</AccountShell></LocalizationProvider>));
  const trigger=target.querySelector<HTMLButtonElement>('.identity-button')!;
  await act(async()=>trigger.click());
  const panel=target.querySelector<HTMLElement>('.account-identity-menu')!;
  assert.equal(document.activeElement,panel);
  const search=panel.querySelector<HTMLInputElement>('input[aria-label="Buscar organização"]')!;
  const change=async(value:string)=>act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(search,value);search.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
  await change('sem resultado');
  assert.match(panel.querySelector('[role=status]')?.textContent??'',/Nenhuma organização encontrada/);
  assert.equal(chosen,'');
  await change('  COMUNICACAO  ');
  assert.equal(panel.querySelectorAll('.account-identity-organizations button').length,1);
  await act(async()=>panel.querySelector<HTMLButtonElement>('.account-identity-organizations button')!.click());
  assert.equal(chosen,'B');
  await act(async()=>trigger.click());
  assert.equal(target.querySelectorAll('.account-identity-organizations button').length,7,'reopening clears the query');
  await act(async()=>target.querySelector('.account-identity-menu')!.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  assert.equal(target.querySelector('.account-identity-menu'),null);
  assert.equal(document.activeElement,trigger);
 }finally{await act(async()=>root.unmount());}
});
test('account menu localizes actions and finds accented organization names without changing selection',async()=>{
 const root=createRoot(target);let chosen='';
 const organizations=[{id:'A',name:'Organização A'},{id:'B',name:'Comunicação'},{id:'C',name:'Equipe C'},{id:'D',name:'Equipe D'},{id:'E',name:'Equipe E'},{id:'F',name:'Equipe F'}];
 const render=(locale:string)=>act(async()=>root.render(<LocalizationProvider preferences={{locale}}><AccountMenu key={locale} name="Ana" organizationId="A" organizationName="Organização A" organizations={organizations} links={[{path:'/platform/favorites',label:'Favoritos'}]} guest={false} navigate={()=>{}} onClose={()=>{}} onCreate={()=>{}} onInvite={()=>{}} onLogout={()=>{}} onOrganization={(id:string)=>chosen=id}/></LocalizationProvider>));
 try{
  await render('es-ES');
  assert.equal(target.querySelector('[role=dialog]')?.getAttribute('aria-label'),'Menú de la cuenta');
  assert.match(target.textContent!,/Configuración de la organización/);
  await act(async()=>target.querySelector<HTMLButtonElement>('.account-menu-organization')!.click());
  const search=target.querySelector<HTMLInputElement>('input[aria-label="Buscar organizaciones"]')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(search,'sin resultado');search.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
  assert.match(target.textContent!,/No se encontraron organizaciones/);
  await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(search,'comunicacao');search.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
  assert.equal(target.querySelectorAll('.account-menu-scroll button').length,1);
  await act(async()=>button('Comunicação').click());assert.equal(chosen,'B');
  await render('ja-JP');
  assert.equal(target.querySelector('[role=dialog]')?.getAttribute('aria-label'),'アカウントメニュー');
  assert.match(target.textContent!,/組織設定/);
  await act(async()=>target.querySelector<HTMLButtonElement>('.account-menu-organization')!.click());
  assert.match(target.textContent!,/あなたの組織/);
  assert.equal(chosen,'B');
 }finally{await act(async()=>root.unmount());}
});
test('project context resolves a role and its actual parent circle, leaving a personal project unlinked',()=>{
 const c={structure:{nodes:[{entityId:'role',nodeId:'r',kind:'ROLE',parentNodeId:'c',name:'Publicação'},{entityId:'circle',nodeId:'c',kind:'CIRCLE',parentNodeId:null,name:'Comunicação'}]}};
 const related=projectRelations({circleId:null,contextLinks:[{kind:'ROLE',targetId:'role'}]},c);
 assert.deepEqual(related.roles.map((item:any)=>item.name),['Publicação']);assert.deepEqual(related.circles.map((item:any)=>item.id),['circle']);
 assert.deepEqual(projectRelations({circleId:null,contextLinks:[]},c),{roles:[],circles:[]});
});

test('structure creation chooses an agreement type and carries the current circle into the composer URL',async()=>{
  let path='';const root=createRoot(target);
  try {
    await act(async()=>root.render(<StructureCreateMenu circleId="circle-context" navigate={(value:string)=>path=value}/>));
    await act(async()=>button('Nova proposta').click());
    assert.equal(target.querySelectorAll('[role=menuitem]').length,3);
    const circle=Array.from(target.querySelectorAll<HTMLButtonElement>('[role=menuitem]')).find(item=>item.querySelector('strong')?.textContent==='Círculo')!;
    await act(async()=>circle.click());
    const query=new URL('http://localhost'+path).searchParams;
    assert.equal(query.get('new'),'1');assert.equal(query.get('proposalType'),'circle');assert.equal(query.get('circleId'),'circle-context');
    assert.equal(target.querySelector('[role=menu]'),null);
  }finally{await act(async()=>root.unmount());}
});

test('notification dropdown reads real items, never auto-marks on open, and only changes unread state after a successful command',async()=>{
  const proposal='11111111-1111-4111-8111-111111111111';let posts=0,refuse=true,path='';
  const items=[{id:'delivery',event:'ProposalDecided',resourceType:'proposal',resourceId:proposal,resourceTitle:'Acordo de publicação',readAt:null,availableAt:'2026-11-03T10:00:00Z'}];
  const api=async(url:string,options:any={})=>{if(options.method==='POST'){posts++;assert.match(url,/\/org\/platform\/notifications\/delivery\/read$/);if(refuse)throw Error('Sem conexão');return{data:{}};}return{data:{items}};};
  const root=createRoot(target);
  try {
    await act(async()=>root.render(<LocalizationProvider preferences={{locale:'pt-BR'}}><NotificationDropdown context={context('org',api,(value:string)=>path=value)}/></LocalizationProvider>));
    await act(async()=>target.querySelector<HTMLButtonElement>('.notification-bell')!.click());
    assert.equal(posts,0);assert.match(target.textContent!,/Acordo de publicação/);
    assert.equal(target.querySelector('.notification-bell')?.getAttribute('aria-label'),'Notificações · 1 não lida');
    await act(async()=>button('Marcar como lida: Acordo de publicação').click());
    assert.equal(posts,1);assert.ok(target.querySelector('.is-unread'));assert.ok(target.querySelector('[role=alert]'));
    refuse=false;await act(async()=>button('Marcar como lida: Acordo de publicação').click());
    assert.equal(posts,2);assert.equal(target.querySelector('.is-unread'),null);assert.equal(target.querySelector('[role=alert]'),null);
    await act(async()=>target.querySelector<HTMLButtonElement>('.notification-open')!.click());
    assert.equal(path,'/structure/proposals/'+proposal);assert.equal(posts,2);assert.equal(target.querySelector('.notification-panel'),null);
  }finally{await act(async()=>root.unmount());}
});

test('a late notification response cannot cross organization/account scope',async()=>{
  let resolveA!:(value:any)=>void;const pending=new Promise(resolve=>resolveA=resolve),root=createRoot(target);
  const render=(id:string,api:any)=>act(async()=>root.render(<LocalizationProvider preferences={{locale:'pt-BR'}}><NotificationDropdown context={context(id,api)}/></LocalizationProvider>));
  try {
    await render('A',()=>pending);
    await render('B',async()=>({data:{items:[]}}));
    await act(async()=>target.querySelector<HTMLButtonElement>('.notification-bell')!.click());
    await act(async()=>resolveA({data:{items:[{id:'private',resourceTitle:'Não mostrar recurso de A',event:'CommentAdded',resourceType:'project',resourceId:'private'}]}}));
    assert.doesNotMatch(target.textContent!,/Não mostrar recurso de A/);
    assert.match(target.textContent!,/Nenhuma notificação/);
  }finally{await act(async()=>root.unmount());}
});

test('notification controls and event names follow the account language without marking items read',async()=>{
  let posts=0;
  const api=async(_url:string,options:any={})=>{if(options.method==='POST')posts++;return{data:{items:[
    {id:'comment',event:'CommentAdded',resourceType:'project',resourceId:'project-id',resourceTitle:'Informe',readAt:null},
    {id:'other',event:'UnknownFutureEvent',resourceType:'project',resourceId:'other-id',resourceTitle:'Plano',readAt:null},
  ]}};};
  const root=createRoot(target);
  const render=(locale:string)=>act(async()=>root.render(<LocalizationProvider preferences={{locale}}><NotificationDropdown context={context('org',api)}/></LocalizationProvider>));
  try{
    await render('es-ES');
    await act(async()=>target.querySelector<HTMLButtonElement>('.notification-bell')!.click());
    assert.equal(target.querySelector('.notification-heading h2')?.textContent,'Notificaciones');
    assert.ok(target.querySelector('.notification-filters')?.textContent?.includes('Sin leer'));
    assert.match(target.textContent!,/Nuevo comentario/);
    assert.match(target.textContent!,/Actualización en/);
    assert.equal(target.querySelector('.notification-read')?.getAttribute('aria-label'),'Marcar como leída: Informe');
    await render('ja-JP');
    assert.equal(target.querySelector('.notification-heading h2')?.textContent,'通知');
    assert.ok(target.querySelector('.notification-filters')?.textContent?.includes('未読'));
    assert.match(target.textContent!,/新しいコメント/);
    assert.match(target.textContent!,/の更新/);
    assert.equal(target.querySelector('.notification-read')?.getAttribute('aria-label'),'既読にする：Informe');
    assert.equal(posts,0);
  }finally{await act(async()=>root.unmount());}
});

test('workspace notification presentation overrides account language and keeps contextual actions local',async()=>{
  const organization='11111111-1111-4111-8111-111111111111',role='22222222-2222-4222-8222-222222222222';
  const destination='/roles/'+role+'?organizationId='+organization,routes:string[]=[];let posts=0;
  const api=async(_url:string,options:any={})=>{if(options.method==='POST')posts++;return{data:{locale:'es-ES',items:[{id:'assignment',event:'RoleAssigned',resourceType:'role',resourceId:role,readAt:null,presentation:{locale:'es-ES',heading:'Se te ha asignado un rol',resourceTitle:'Enlace <seguro>',summary:'Ahora participas en el equipo.',actorName:'Joana',occurredAt:'2026-11-17T10:00:00Z',details:[{label:'Círculo',value:'Equipo Horizonte'},{label:'Alcance',value:'Coordinación'}],destination,preferencesDestination:'/platform/preferences?organizationId='+organization+'&event=RoleAssigned'}}]}};};
  const root=createRoot(target);
  try {
    await act(async()=>root.render(<LocalizationProvider preferences={{locale:'pt-BR'}}><NotificationDropdown context={context(organization,api,value=>routes.push(value))}/></LocalizationProvider>));
    await act(async()=>target.querySelector<HTMLButtonElement>('.notification-bell')!.click());
    assert.equal(target.querySelector('.notification-heading h2')?.textContent,'Notificaciones');
    assert.match(target.textContent!,/Se te ha asignado un rol/);assert.match(target.textContent!,/Ahora participas/);assert.match(target.textContent!,/Por Joana/);assert.match(target.textContent!,/Círculo: Equipo Horizonte/);
    assert.equal(target.querySelector('seguro'),null);assert.equal(posts,0);assert.ok(target.querySelector('time')?.getAttribute('title'));
    await act(async()=>target.querySelector<HTMLButtonElement>('.notification-open')!.click());
    assert.equal(routes[0],destination);assert.equal(posts,1);
    await act(async()=>target.querySelector<HTMLButtonElement>('.notification-bell')!.click());
    await act(async()=>button('Preferencias de notificaciones').click());
    assert.equal(routes[1],'/platform/preferences?organizationId='+organization);
  }finally{await act(async()=>root.unmount());}
});
