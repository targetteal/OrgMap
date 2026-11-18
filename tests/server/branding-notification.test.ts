import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import sharp from 'sharp';
import {LocalSmtpTransport} from '../../server/modules/platform/smtp.js';
import {sendLocalMail,startSmtpSink} from '../../server/src/smtp.js';
const origin='http://localhost:5173';
process.env.ALLOWED_ORIGINS=origin;
process.env.ORGMAP_PUBLIC_URL=origin;
delete process.env.BREVO_API_KEY;
function parseMails(directory:string) {
 const code=`import email, email.policy, hashlib, json, pathlib, sys\nout=[]\nfor p in pathlib.Path(sys.argv[1]).glob('*.eml'):\n m=email.message_from_bytes(p.read_bytes(),policy=email.policy.default)\n imgs=[x for x in m.walk() if x.get_content_type()=='image/png']\n html=[x.get_content() for x in m.walk() if x.get_content_type()=='text/html']\n out.append({'to':m['To'],'type':m.get_content_type(),'images':[{'cid':x.get('Content-ID'),'sha':hashlib.sha256(x.get_payload(decode=True)).hexdigest()} for x in imgs],'html':html})\nprint(json.dumps(out))`;
 const p=spawnSync('python3',['-c',code,directory],{encoding:'utf8'});assert.equal(p.status,0,p.stderr);return JSON.parse(p.stdout) as Array<{to:string;type:string;images:{cid:string;sha:string}[];html:string[]}>;
}
test('SMTP MIME has isolated inline CID raster; security mail remains plain',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'orgmap-brand-smtp-'));const smtp=await startSmtpSink({port:0,directory});const port=(smtp.address() as any).port;
 try {const transport=new LocalSmtpTransport(port);const a=await sharp({create:{width:12,height:8,channels:3,background:'red'}}).png().toBuffer(),b=await sharp({create:{width:12,height:8,channels:3,background:'blue'}}).png().toBuffer();const hash=(v:Buffer)=>createHash('sha256').update(v).digest('hex');
  for(const [recipient,bytes,cid] of [['a@example.test',a,'a-brand@inline'],['b@example.test',b,'b-brand@inline'],['guest@example.test',a,'guest-brand@inline']] as const) await transport.send({id:randomUUID(),email:recipient,event:'CommentAdded',inlineBrand:{content:bytes,contentType:'image/png',cid}});
  await sendLocalMail({id:randomUUID(),to:'security@example.test',subject:'Account security',text:'Account message'},port);
  const result=parseMails(directory);assert.equal(result.length,4);
  for(const [recipient,expected,cid] of [['a@example.test',a,'a-brand@inline'],['b@example.test',b,'b-brand@inline'],['guest@example.test',a,'guest-brand@inline']] as const) {const mail=result.find(m=>m.to.includes(recipient))!;assert.equal(mail.type,'multipart/related');assert.equal(mail.images.length,1);assert.equal(mail.images[0].sha,hash(expected));assert.equal(mail.images[0].cid,`<${cid}>`);assert.ok(mail.html[0].includes(`cid:${cid}`));}
  const security=result.find(m=>m.to.includes('security@example.test'))!;assert.equal(security.type,'text/plain');assert.equal(security.images.length,0);
  await assert.rejects(transport.send({id:randomUUID(),email:'x@example.test',event:'CommentAdded',inlineBrand:{content:a,contentType:'image/png',cid:'x\r\nBcc: evil@example.test'}}));
  await assert.rejects(transport.send({id:randomUUID(),email:'x@example.test',event:'CommentAdded',inlineBrand:{content:Buffer.from('not png'),contentType:'image/png',cid:'valid@inline'}}));
  assert.equal((await readdir(directory)).filter(x=>x.endsWith('.eml')).length,4);
 } finally {await new Promise<void>(resolve=>smtp.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}
});

test('real notification workers deliver only current tenant branding and suppress Guest master-off',async()=>{
 const pg=(await import('pg')).default;
 const {buildApp}=await import('../../server/src/app.js');const {pool}=await import('../../server/src/db.js');const {createRuntime}=await import('../../server/src/runtime.js');
 const {createOrgMapIntegration,createIntegrationEnvironment}=await import('../../server/integration/index.js');
 const {enqueueNotification}=await import('../../server/modules/platform/notifications.js');const {PlatformWorker}=await import('../../server/modules/platform/worker.js');
 const {ScopedDeliveryWorker}=await import('../../server/modules/platform/scoped-delivery.js');const {PostgresScopeDispatch}=await import('../../server/modules/platform/dispatcher.js');
 const db=new URL(process.env.DATABASE_URL??'postgres://invalid/invalid');if(!/^\/orgmap_(integration|brandmail)_[a-f0-9]+$/.test(db.pathname)||!['127.0.0.1','localhost','[::1]'].includes(db.hostname))throw Error('EXCLUSIVE_BRANDING_MAIL_DATABASE_REQUIRED');
 const op=new URL(process.env.MIGRATION_DATABASE_URL!);if(op.host!==db.host||op.pathname!==db.pathname)throw Error('EXCLUSIVE_BRANDING_MAIL_DATABASE_REQUIRED');
 const directory=await mkdtemp(join(tmpdir(),'orgmap-brand-delivery-'));const smtp=await startSmtpSink({port:0,directory:join(directory,'mail')});const port=(smtp.address() as any).port;
 const app=await buildApp([createOrgMapIntegration({blobsDirectory:join(directory,'blobs'),smtp:{port}})],{migrationMaxPrefix:999});const admin=new pg.Pool({connectionString:op.href});
 const prefix=process.env.INTEGRATION_TEST_ROLE_PREFIX;if(prefix&&!/^orgmap_it_[a-f0-9]{32}_$/.test(prefix))throw Error('INVALID_TEST_ROLE_PREFIX');const role=prefix?prefix+randomUUID().replaceAll('-','').slice(0,16):'orgmap_bm_'+randomUUID().replaceAll('-','');const password=randomUUID();let dispatch:InstanceType<typeof pg.Pool>|undefined,roleCreated=false;
 const fixtureOrganizations=new Set<string>();
 async function user(){const email=randomUUID()+'@example.test';const r=await app.inject({method:'POST',url:'/api/v1/auth/register',headers:{origin},payload:{email,password:'a-secure-password-123',displayName:'Brand mail'}});assert.equal(r.statusCode,201,r.body);return {email,id:r.json().data.account.id,cookie:r.cookies[0].name+'='+r.cookies[0].value,csrf:r.json().data.csrfToken};}
 async function req(u:any,method:string,url:string,payload?:any,revision?:number){const response=await app.inject({method:method as any,url:'/api/v1'+url,headers:{origin,cookie:u.cookie,'x-csrf-token':u.csrf,'idempotency-key':randomUUID(),...(revision===undefined?{}:{'if-match':`"${revision}"`})},payload});if(method==='POST'&&url==='/organizations'&&response.statusCode===201)fixtureOrganizations.add(response.json().data.organization.id);return response;}
 function ok(r:any,status=200){assert.equal(r.statusCode,status,r.body);return r.json().data;}
 try {
  const owner=await user(),aRecipient=await user(),bRecipient=await user(),guest=await user();
  const A=ok(await req(owner,'POST','/organizations',{name:'Brand A'}),201),B=ok(await req(owner,'POST','/organizations',{name:'Brand B'}),201);
  const baseA=`/organizations/${A.organization.id}`,baseB=`/organizations/${B.organization.id}`;
  const memberA=ok(await req(owner,'POST',baseA+'/members',{accountId:aRecipient.id}),201).membership;
  const memberB=ok(await req(owner,'POST',baseB+'/members',{accountId:bRecipient.id}),201).membership;
  const guestMember=ok(await req(owner,'POST',baseA+'/members',{accountId:guest.id,memberType:'GUEST',accessPlan:[{resource:{context:'structure',kind:'circle',id:A.rootCircle.id},actions:['read']}]}),201).membership;
  const red=await sharp({create:{width:70,height:50,channels:3,background:'red'}}).png().toBuffer(),blue=await sharp({create:{width:70,height:50,channels:3,background:'blue'}}).png().toBuffer();
  ok(await req(owner,'POST',baseA+'/administration/branding-assets/email-logo',{base64:red.toString('base64')},0));ok(await req(owner,'POST',baseB+'/administration/branding-assets/email-logo',{base64:blue.toString('base64')},0));
  const core=createRuntime(),env=createIntegrationEnvironment(core,{blobsDirectory:join(directory,'blobs'),smtp:{port}}),transport=new LocalSmtpTransport(port);
  const expectedA=await core.withWorkerContext(A.organization.id,A.membership.id,ctx=>env.branding.emailInline(ctx)),expectedB=await core.withWorkerContext(B.organization.id,B.membership.id,ctx=>env.branding.emailInline(ctx));assert.ok(expectedA&&expectedB);
  const brandingReads:string[]=[];const branding=async(ctx:Parameters<typeof env.branding.emailInline>[0])=>{brandingReads.push(ctx.org.id);return env.branding.emailInline(ctx);};
  const normal=new PlatformWorker({withContext:(org,member,fn)=>core.withWorkerContext(org,member,fn),registry:env.registry,blobs:env.blobs,transport,notificationBranding:branding});
  async function enqueue(org:any,recipient:string){return core.withWorkerContext(org.organization.id,org.membership.id,async ctx=>{const eventId=randomUUID();await enqueueNotification(ctx,env.registry,{eventId,event:'CommentAdded',ref:{type:'circle',id:org.rootCircle.id},recipients:[{memberId:recipient,nominal:true}]});return eventId;});}
  await enqueue(A,memberA.id);await enqueue(B,memberB.id);
  for(let i=0;i<3;i++){await normal.runDelivery(A.organization.id,memberA.id);await normal.runDelivery(B.organization.id,memberB.id);}
  await admin.query(`CREATE ROLE "${role}" LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`);roleCreated=true;
  await admin.query(`GRANT orgmap_platform_dispatcher TO "${role}"`);const dispatchUrl=new URL(op.href);dispatchUrl.username=role;dispatchUrl.password=password;dispatch=new pg.Pool({connectionString:dispatchUrl.href});
  const scopes=new PostgresScopeDispatch(dispatch),scoped=new ScopedDeliveryWorker({metadata:scopes.deliveryMetadata(),registry:env.registry,transport,notificationBranding:branding,withReadResourceContext:(org,member,ref,fn)=>core.withResourceWorkerContext(org,member,[{resource:{context:'structure',kind:'circle',id:ref.id},action:'read'}],fn)});
  async function drain(){for(let i=0;i<10;i++){const scope=await scopes.claim();if(!scope)break;try{await scoped.run(scope);}finally{await scopes.release(scope,false);}}}
  await enqueue(A,guestMember.id);
  const settings=ok(await req(owner,'GET',baseA+'/administration/settings'));settings.settings.notifications.emailEnabled=false;const disabled=ok(await req(owner,'PUT',baseA+'/administration/settings',{settings:settings.settings},settings.version));
  const readsBeforeSuppression=brandingReads.length;await drain();assert.equal(brandingReads.length,readsBeforeSuppression);let mails=parseMails(join(directory,'mail'));assert.equal(mails.filter(m=>m.to.includes(guest.email)).length,0);
  disabled.settings.notifications.emailEnabled=true;ok(await req(owner,'PUT',baseA+'/administration/settings',{settings:disabled.settings},disabled.version));await enqueue(A,guestMember.id);await drain();
  await sendLocalMail({id:randomUUID(),to:'security@example.test',subject:'Security',text:'Global security mail'},port);mails=parseMails(join(directory,'mail'));
  const expectedHash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
  for(const [recipient,bytes] of [[aRecipient.email,expectedA.content],[bRecipient.email,expectedB.content],[guest.email,expectedA.content]] as const){const list=mails.filter(m=>m.to.includes(recipient));assert.equal(list.length,1,JSON.stringify(mails));assert.equal(list[0].type,'multipart/related');assert.equal(list[0].images.length,1);assert.equal(list[0].images[0].sha,expectedHash(bytes));const cid=list[0].images[0].cid.replace(/^<|>$/g,'');assert.ok(list[0].html[0].includes('cid:'+cid));}
  const security=mails.find(m=>m.to.includes('security@example.test'))!;assert.equal(security.type,'text/plain');assert.equal(security.images.length,0);
 } finally {await app.close();await dispatch?.end();if(fixtureOrganizations.size){const ids=[...fixtureOrganizations];await admin.query('DELETE FROM platform_deliveries WHERE organization_id=ANY($1::uuid[])',[ids]);await admin.query('DELETE FROM platform_scope_wakes WHERE organization_id=ANY($1::uuid[])',[ids]);}if(roleCreated)await admin.query(`DROP ROLE "${role}"`);await admin.end();await pool.end();await new Promise<void>(resolve=>smtp.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}
});

test('high entropy email derivative stays inside SMTP local budget without truncation',async()=>{
 const {randomBytes}=await import('node:crypto');const {readFile}=await import('node:fs/promises');const {createBrandingDecoder,BRANDING_EMAIL_OUTPUT_BYTES}=await import('../../server/modules/administration/branding-image.js');
 const raw=randomBytes(360*180*4),image=await sharp(raw,{raw:{width:360,height:180,channels:4}}).png().toBuffer();const result=await createBrandingDecoder().decodeAndNormalize(image,'EMAIL_LOGO');assert.ok(result.bytes.byteLength<=BRANDING_EMAIL_OUTPUT_BYTES);assert.ok(result.width<=360&&result.height<=180);assert.equal((await sharp(result.bytes).metadata()).format,'png');
 const directory=await mkdtemp(join(tmpdir(),'orgmap-brand-budget-'));const smtp=await startSmtpSink({port:0,directory});try{await new LocalSmtpTransport((smtp.address() as any).port).send({id:randomUUID(),email:'noise@example.test',event:'CommentAdded',inlineBrand:{content:result.bytes,contentType:'image/png',cid:'noise-brand@inline'}});const files=(await readdir(directory)).filter(x=>x.endsWith('.eml'));assert.equal(files.length,1);const mail=await readFile(join(directory,files[0]));assert.ok(mail.length<1024*1024);const parsed=parseMails(directory)[0];assert.equal(parsed.images[0].sha,createHash('sha256').update(result.bytes).digest('hex'));}finally{await new Promise<void>(resolve=>smtp.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}
});
