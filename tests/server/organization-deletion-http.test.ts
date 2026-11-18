import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import pg from 'pg';
import {OrganizationLedger} from '../../server/ops/organization-ledger.js';
import {acquireOrganizationHostLease,provisionFreshHostBinding} from '../../server/ops/organization-host-lease.js';
import {installHostStorageBinding} from '../../server/ops/organization-storage-binding.js';
import type {FastifyInstance,HTTPMethods} from 'fastify';

const origin='http://deletion-http.localhost:5273';
type Actor={cookie:string;csrf:string;email:string;password:string;accountId:string};
async function register(app:FastifyInstance):Promise<Actor>{const email=`${randomUUID()}@fixture.invalid`,password=`Synthetic-${randomUUID()}`;const r=await app.inject({method:'POST',url:'/api/v1/auth/register',headers:{origin},payload:{email,password,displayName:'Fixture'}});assert.equal(r.statusCode,201,r.body);return {cookie:`orgmap_session=${r.cookies.find(x=>x.name==='orgmap_session')!.value}`,csrf:r.json().data.csrfToken,email,password,accountId:r.json().data.account.id};}
async function call(app:FastifyInstance,u:Actor,method:HTTPMethods,url:string,body?:object,version?:number,key=randomUUID(),csrf=u.csrf){return app.inject({method,url,payload:body,headers:{origin,cookie:u.cookie,'x-csrf-token':csrf,'idempotency-key':key,...(version===undefined?{}:{'if-match':`"${version}"`})}});}
function data(r:{statusCode:number;body:string;json:()=>any},status=200){assert.equal(r.statusCode,status,r.body);return r.json().data;}

test('real deletion HTTP gates and initiator receipt survive relogin without exposing internal authority',async()=>{
 const migration=new URL(process.env.MIGRATION_DATABASE_URL??'postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap');
 const runtime=new URL(process.env.DATABASE_URL??'postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap');
 if(!['postgres:','postgresql:'].includes(migration.protocol)||!['127.0.0.1','localhost','[::1]'].includes(migration.hostname)||migration.host!==runtime.host||migration.pathname!==runtime.pathname)throw Error('MATCHING_LOCAL_DATABASE_SOURCES_REQUIRED');
 const previous={db:process.env.DATABASE_URL,config:process.env.ORGMAP_INTEGRATION_CONFIG,origins:process.env.ALLOWED_ORIGINS,mfa:process.env.ORGMAP_MFA_KEY_FILE};
 const directory=await mkdtemp(join(tmpdir(),'orgmap-deletion-http-')),ledger=await OrganizationLedger.initialize(join(directory,'ledger'));
 process.env.ORGMAP_MFA_KEY_FILE=join(directory,'mfa.key');await writeFile(process.env.ORGMAP_MFA_KEY_FILE,randomBytes(32).toString('hex'),{mode:0o600});
 const lease=await acquireOrganizationHostLease(ledger),admin=new pg.Pool({connectionString:migration.href}),suffix=randomBytes(8).toString('hex'),role='orgmap_http_'+suffix,password=randomUUID();
 let database='',createdRole=false,source:pg.Pool|undefined,application:pg.Pool|undefined,acceptance:pg.Pool|undefined,app:FastifyInstance|undefined,unavailable:FastifyInstance|undefined,registration:{release():Promise<void>}|null=null;
 try {
  try{database=(await provisionFreshHostBinding(ledger,lease,migration.href)).database;}catch(e){const m=e instanceof Error&&/^HOST_INSTALL_RECOVERY_REQUIRED:(orgmap_fresh_[a-f0-9]{32})$/.exec(e.message);if(m)database=m[1];throw e;}
  assert.match(database,/^orgmap_fresh_[a-f0-9]{32}$/);console.log('deletion-http-fixture',JSON.stringify({database,role}));
  await admin.query(`CREATE ROLE "${role}" LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`);createdRole=true;
  await admin.query(`GRANT orgmap_app,orgmap_lifecycle_acceptance TO "${role}"`);
  const sourceUrl=new URL(migration);sourceUrl.pathname='/'+database;source=new pg.Pool({connectionString:sourceUrl.href});
  const appUrl=new URL(runtime);appUrl.pathname='/'+database;application=new pg.Pool({connectionString:appUrl.href});
  const acceptanceUrl=new URL(sourceUrl);acceptanceUrl.username=role;acceptanceUrl.password=password;acceptance=new pg.Pool({connectionString:acceptanceUrl.href});
  const config=join(directory,'integration.json');await writeFile(config,JSON.stringify({blobsDirectory:join(directory,'blobs')}),{mode:0o600});
  process.env.ORGMAP_INTEGRATION_CONFIG=config;process.env.DATABASE_URL=appUrl.href;process.env.ALLOWED_ORIGINS=origin;
  const bind=await source.connect();try{await installHostStorageBinding(ledger,lease,bind,config);}finally{bind.release();}
  const {enterManagedWriter}=await import('../../server/src/managed-writer.js');const c=await application.connect();try{registration=await enterManagedWriter({ledger,token:lease.token,client:c});}finally{c.release();}assert.ok(registration);
  // Confirm the installed reviewed pin matches the untouched schema.
  const pin=await source.connect();try{await pin.query('BEGIN');await pin.query('SELECT pg_advisory_xact_lock(730184)');const fingerprint=(await pin.query('SELECT orgmap_deletion_schema_fingerprint_internal() AS digest')).rows[0].digest;assert.equal((await pin.query('SELECT fingerprint FROM organization_deletion_schema_baseline WHERE singleton')).rows[0]?.fingerprint,fingerprint);await pin.query('COMMIT');}catch(e){await pin.query('ROLLBACK');throw e;}finally{pin.release();}
  const {buildApp}=await import('../../server/src/app.js'),{createOrgMapIntegration}=await import('../../server/integration/index.js'),{createOrganizationDeletionReadiness}=await import('../../server/ops/organization-deletion-readiness.js');
  unavailable=await buildApp([createOrgMapIntegration()],{migrationMaxPrefix:999});
  const owner=await register(unavailable),other=await register(unavailable),member=await register(unavailable),guest=await register(unavailable);
  const A=data(await call(unavailable,owner,'POST','/api/v1/organizations',{name:'Delete fixture A'}),201), B=data(await call(unavailable,owner,'POST','/api/v1/organizations',{name:'Preserve B'}),201);
  const base=`/api/v1/organizations/${A.organization.id}`, otherBase=`/api/v1/organizations/${B.organization.id}`;
  const membership=data(await call(unavailable,owner,'POST',`${base}/members`,{accountId:member.accountId}),201).membership;
  const guestMembership=data(await call(unavailable,owner,'POST',`${base}/members`,{accountId:guest.accountId}),201).membership;
  await source.query("UPDATE members SET member_type='GUEST' WHERE organization_id=$1 AND id=$2",[A.organization.id,guestMembership.id]);
  const info=data(await call(unavailable,owner,'GET',`${base}/deletion-preflight`));assert.equal(info.available,false);assert.equal(info.canAccept,false);assert.equal(info.operationalReason,'OPERATIONS_UNAVAILABLE');
  const orgVersion=(await source.query('SELECT version FROM organizations WHERE id=$1',[A.organization.id])).rows[0].version;
  const payload={confirmationOrganizationId:A.organization.id,confirmationName:'Delete fixture A',currentPassword:owner.password};
  const noOps=await call(unavailable,owner,'POST',`${base}/deletion-requests`,payload,orgVersion);assert.equal(noOps.statusCode,503,noOps.body);assert.equal(noOps.json().error.code,'DELETION_OPERATIONS_UNAVAILABLE');
  assert.equal((await source.query('SELECT count(*)::int n FROM organization_deletion_jobs WHERE organization_id=$1',[A.organization.id])).rows[0].n,0);
  const readiness=createOrganizationDeletionReadiness({ledger,application,acceptance});
  await readiness();
  app=await buildApp([createOrgMapIntegration()],{migrationMaxPrefix:999,organizationDeletion:{acceptancePool:acceptance,assertReady:readiness}});
  const pre=data(await call(app,owner,'GET',`${base}/deletion-preflight`));assert.equal(pre.available,true);assert.equal(pre.canAccept,true);assert.equal(pre.backupCopies,'UNKNOWN');
  for(const actor of [member,guest,other]){const r=await call(app,actor,'GET',`${base}/deletion-preflight`);assert.ok([403,404].includes(r.statusCode),r.body);}
  assert.equal((await call(app,owner,'POST',`${base}/deletion-requests`,payload,orgVersion,randomUUID(),'incorrect')).statusCode,403);
  assert.equal((await call(app,owner,'POST',`${base}/deletion-requests`,{...payload,confirmationOrganizationId:B.organization.id},orgVersion)).statusCode,400);
  assert.equal((await call(app,owner,'POST',`${base}/deletion-requests`,{...payload,confirmationName:'Wrong'},orgVersion)).statusCode,400);
  assert.equal((await call(app,owner,'POST',`${base}/deletion-requests`,payload,orgVersion+1)).statusCode,409);
  for(const actor of [member,guest,other]){const r=await call(app,actor,'POST',`${base}/deletion-requests`,{...payload,currentPassword:actor.password},orgVersion);assert.ok([403,404].includes(r.statusCode),r.body);}
  // Enroll through the real MFA endpoints; enrollment consumes the current-window TOTP.
  const mfaOwner=await register(app),mfaOrg=data(await call(app,mfaOwner,'POST','/api/v1/organizations',{name:'MFA HTTP closure'}),201);
  const mfaBase=`/api/v1/organizations/${mfaOrg.organization.id}`;
  const enrollment=data(await call(app,mfaOwner,'POST','/api/v1/account/mfa/enrollment/start',{currentPassword:mfaOwner.password}));
  let bits=0,acc=0;const bytes:number[]=[];
  for(const char of enrollment.secret){acc=(acc<<5)|'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char);bits+=5;if(bits>=8){bits-=8;bytes.push((acc>>>bits)&255);}}
  const seed=Buffer.from(bytes),{totpAt}=await import('../../server/src/mfa.js');
  const step=Math.floor(Date.now()/30000),consumed=totpAt(seed,step);
  data(await call(app,mfaOwner,'POST','/api/v1/account/mfa/enrollment/confirm',{code:consumed}));
  const mfaPayload={confirmationOrganizationId:mfaOrg.organization.id,confirmationName:'MFA HTTP closure',currentPassword:mfaOwner.password};
  const lifecycle=async()=>assert.equal((await source!.query('SELECT state FROM organization_lifecycle WHERE organization_id=$1',[mfaOrg.organization.id])).rows[0].state,'ACTIVE');
  for(const code of [undefined,'000000',consumed]){
   const validWindow=new Set([-1,0,1].map(offset=>totpAt(seed,Math.floor(Date.now()/30000)+offset)));
   const invalid=code==='000000'?['000000','111111','222222','333333'].find(candidate=>!validWindow.has(candidate))!:code;
   const r=await call(app,mfaOwner,'POST',`${mfaBase}/deletion-requests`,{...mfaPayload,...(invalid===undefined?{}:{totpCode:invalid})},mfaOrg.organization.version);
   assert.equal(r.statusCode,401,r.body);await lifecycle();
  }
  const freshOtp=totpAt(seed,step+1);
  const accepted=data(await call(app,mfaOwner,'POST',`${mfaBase}/deletion-requests`,{...mfaPayload,totpCode:freshOtp},mfaOrg.organization.version),202);
  assert.equal(accepted.state,'DELETION_PENDING');
  const idem=randomUUID(),cut=data(await call(app,owner,'POST',`${base}/deletion-requests`,payload,orgVersion,idem),202);assert.equal(cut.state,'DELETION_PENDING');
  assert.equal((await call(app,owner,'POST',`${base}/deletion-requests`,payload,orgVersion,idem)).json().data.jobId,cut.jobId);
  assert.equal((await source.query('SELECT state FROM organization_lifecycle WHERE organization_id=$1',[A.organization.id])).rows[0].state,'DELETION_PENDING');
  assert.equal((await source.query('SELECT state FROM organization_lifecycle WHERE organization_id=$1',[B.organization.id])).rows[0].state,'ACTIVE');
  // Exercise the application's actual database role, independently of HTTP
  // projection. Each denied SELECT uses its own transaction because a SQL
  // privilege error aborts the transaction.
  const appClient=await application.connect();
  try {
   for(const column of ['request_key','request_hash','lease_token']) {
    await appClient.query('BEGIN');
    try {
     await appClient.query("SELECT set_config('orgmap.account_id',$1,true),set_config('orgmap.organization_id',$2,true)",[owner.accountId,A.organization.id]);
     await assert.rejects(appClient.query(`SELECT ${column} FROM organization_deletion_jobs WHERE id=$1`,[cut.jobId]),(error:any)=>error.code==='42501');
    } finally {await appClient.query('ROLLBACK');}
   }
   await appClient.query('BEGIN');
   try {
    await appClient.query("SELECT set_config('orgmap.account_id',$1,true),set_config('orgmap.organization_id',$2,true)",[owner.accountId,A.organization.id]);
    assert.equal((await appClient.query('SELECT id,state,phase,completion_receipt FROM organization_deletion_jobs WHERE id=$1',[cut.jobId])).rows[0].id,cut.jobId);
    await appClient.query("SELECT set_config('orgmap.account_id',$1,true)",[member.accountId]);
    assert.equal((await appClient.query('SELECT id,state FROM organization_deletion_jobs WHERE id=$1',[cut.jobId])).rowCount,0);
   } finally {await appClient.query('ROLLBACK');}
  } finally {appClient.release();}
  const receipt=data(await call(app,owner,'GET',`/api/v1/account/organization-deletions/${cut.jobId}`));assert.equal(receipt.jobId,cut.jobId);assert.equal(receipt.backupCopies,'UNKNOWN');assert.equal(receipt.remoteEffects,'UNKNOWN');
  const serialized=JSON.stringify([cut,receipt]);for(const secret of ['leaseToken','fence','requestHash','requestKey','credential','password','csrf','payload','blob_key'])assert.doesNotMatch(serialized,new RegExp(secret,'i'));
  assert.equal((await call(app,other,'GET',`/api/v1/account/organization-deletions/${cut.jobId}`)).statusCode,404);
  assert.equal(data(await call(app,other,'GET','/api/v1/account/organization-deletions')).items.length,0);
  assert.ok(data(await call(app,owner,'GET','/api/v1/account/organization-deletions')).items.some((item:any)=>item.jobId===cut.jobId));
  data(await call(app,owner,'POST','/api/v1/auth/logout',{}));
  const login=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{email:owner.email,password:owner.password}});assert.equal(login.statusCode,200,login.body);
  const fresh={...owner,cookie:`orgmap_session=${login.cookies.find(x=>x.name==='orgmap_session')!.value}`,csrf:login.json().data.csrfToken};
  assert.equal(data(await call(app,fresh,'GET',`/api/v1/account/organization-deletions/${cut.jobId}`)).jobId,cut.jobId);
  assert.equal((await call(app,fresh,'GET',`${otherBase}/bootstrap`)).statusCode,200);assert.ok(membership.id);
 } finally {
  await app?.close();await unavailable?.close();await registration?.release();await application?.end();await acceptance?.end();await source?.end();
  const {pool}=await import('../../server/src/db.js');await pool.end();await lease.release();
  if(createdRole)await admin.query(`DROP ROLE "${role}"`);if(database){if(!/^orgmap_fresh_[a-f0-9]{32}$/.test(database))throw Error('UNEXPECTED_FIXTURE_DATABASE');await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);}await admin.end();await rm(directory,{recursive:true,force:true});
  if(previous.db===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previous.db;if(previous.config===undefined)delete process.env.ORGMAP_INTEGRATION_CONFIG;else process.env.ORGMAP_INTEGRATION_CONFIG=previous.config;if(previous.origins===undefined)delete process.env.ALLOWED_ORIGINS;else process.env.ALLOWED_ORIGINS=previous.origins;if(previous.mfa===undefined)delete process.env.ORGMAP_MFA_KEY_FILE;else process.env.ORGMAP_MFA_KEY_FILE=previous.mfa;
 }
});
