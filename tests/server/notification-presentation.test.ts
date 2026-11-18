import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SUPPORTED_LOCALES} from '../../packages/i18n/index.js';
import {notificationEvents} from '../../server/modules/platform/catalog.js';
import {ResourceRegistry} from '../../server/modules/platform/ports.js';
import {notificationPresentation,normalizeNotificationContext,notificationDestination} from '../../server/modules/platform/notification-presentation.js';
import {renderNotificationMail} from '../../server/modules/platform/notification-mail.js';
import {notificationStillFollowed} from '../../server/modules/platform/notifications.js';
const org='11111111-1111-4111-8111-111111111111',resource='22222222-2222-4222-8222-222222222222';
const currentTitle='Cuidado <script>alert(1)</script> & colaboração';
const ctx:any={org:{id:org},member:{id:resource,member_type:'MEMBER'},account:{id:resource},mode:'read'};
function fixture(locale:string){
  const registry=new ResourceRegistry({notificationWorkspace:async()=>({name:'Equipo Horizonte',locale,timeZone:'America/Sao_Paulo'})});
  for(const type of ['circle','role','proposal','goal','key-result','project','task','meeting','report','invitation'])registry.registerResourceAdapter(type,{authorize:async()=>true,lookup:async()=>({id:resource,title:currentTitle})});
  return registry;
}
const typeFor=(event:string)=>event.startsWith('Invitation')?'invitation':event.startsWith('Role')?'role':event.startsWith('Circle')?'circle':event.startsWith('Proposal')||event==='ConsentWindowOpened'?'proposal':event==='KRAssigned'?'key-result':event.startsWith('Goal')?'goal':event==='TaskAssigned'?'task':event==='ProjectUpdated'?'project':event==='ReportPublished'?'report':event==='MeetingScheduled'?'meeting':'circle';
test('every notification event renders useful HTML and plain text in all workspace languages with contextual actions and preference controls',async()=>{
  process.env.ORGMAP_PUBLIC_URL='https://orgmap.example';
  for(const locale of SUPPORTED_LOCALES)for(const {event} of notificationEvents){
    const registry=fixture(locale),d={event,resource_type:typeFor(event),resource_id:resource,created_at:'2026-11-17T15:30:00.000Z',actor_name:'Joana <img src=x onerror=evil()>',context:{resourceTitle:'Historical title',excerpt:'Mensagem <b>literal</b>',details:[{key:'person',value:'Ravi & Joana'},{key:'deadline',value:'2026-11-17'},{key:'status',value:'APPLIED'}]}};
    const p=await notificationPresentation(ctx,registry,d),mail=await renderNotificationMail(ctx,registry,d);
    assert.equal(p.locale,locale);assert.notEqual(p.heading,event);assert.equal(p.resourceTitle,currentTitle);
    assert.ok(mail.subject.includes('Equipo Horizonte'));assert.ok(!/[\r\n]/.test(mail.subject));
    assert.ok(mail.html?.includes('lang="'+locale+'"'));assert.ok(mail.html?.includes('&lt;script&gt;'));assert.ok(!mail.html?.includes('<script>'));
    assert.ok(mail.html?.includes('&lt;img src=x onerror=evil()&gt;'));assert.ok(mail.text.includes(currentTitle));
    assert.ok(mail.text.includes('https://orgmap.example'+p.destination));
    assert.ok(mail.text.includes('https://orgmap.example/platform/preferences?organizationId='+org+'&event='+event));
    assert.ok(!mail.text.includes('An event is available'));assert.ok(!mail.subject.includes(event));
    assert.ok(p.details.find(detail=>detail.value.includes('17')),'civil deadline never shifts to previous day');
  }
});
test('Guest receives current authorized title without historical parent, people or comment snapshots',async()=>{
  const registry=fixture('es-ES');
  const p=await notificationPresentation({...ctx,member:{...ctx.member,member_type:'GUEST'}},registry,{event:'RoleScopeUpdated',resource_type:'role',resource_id:resource,actor_name:'Private actor',context:{resourceTitle:'Old private title',excerpt:'Private prior body',details:[{key:'circle',value:'Private ancestor'}]}});
  assert.equal(p.resourceTitle,currentTitle);assert.equal(p.actorName,undefined);assert.equal(p.summary,undefined);assert.deepEqual(p.details,[]);
});
test('context is bounded and routes match canonical task and key-result destinations',()=>{
  const context=normalizeNotificationContext({resourceTitle:'x'.repeat(10000),excerpt:'y'.repeat(10000),details:Array.from({length:100},()=>({key:'scope',value:'z'.repeat(10000)})),secret:'never copied'});
  assert.ok(Buffer.byteLength(JSON.stringify(context))<24000);assert.equal((context as any).secret,undefined);assert.equal(context.details?.length,12);
  assert.equal(notificationDestination('task',resource,org),'/projects/tasks/'+resource+'?organizationId='+org);
  assert.equal(notificationDestination('key-result',resource,org),'/goals/key-results/'+resource+'?organizationId='+org);
  assert.equal(notificationDestination('report',resource,org),'/meetings/reports?organizationId='+org+'&reportId='+resource);
  assert.equal(notificationDestination('report',resource,org,'/meetings/'+resource),'/meetings/'+resource+'?organizationId='+org);
});
test('related follow origins must remain authorized and enabled at delivery, including Guest context',async()=>{
  let readable=true,following=true;
  const registry=new ResourceRegistry({guestAccess:async()=>readable});
  registry.registerResourceAdapter('meeting',{authorize:async()=>readable});
  const recipientCtx={...ctx,c:{query:async()=>({rowCount:following?1:0})}};
  const d={nominal:false,recipient_id:resource,resource_type:'report',resource_id:resource,context:{followRefs:[{type:'meeting',id:resource}]}};
  assert.equal(await notificationStillFollowed(recipientCtx,d,registry),true);
  readable=false;assert.equal(await notificationStillFollowed(recipientCtx,d,registry),false);
  assert.equal(await notificationStillFollowed({...recipientCtx,member:{...ctx.member,member_type:'GUEST'}},d,registry),false);
  readable=true;following=false;assert.equal(await notificationStillFollowed(recipientCtx,d,registry),false);
});
