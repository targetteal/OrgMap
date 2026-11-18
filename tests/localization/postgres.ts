// Scoped account/localization acceptance. Creates and drops ONLY its own local database; no shared migrations.
import pg from 'pg';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {SUPPORTED_LOCALES,formatInstant,formatNumber,createTranslator} from '../../packages/i18n/index';
const migrationBase=new URL(process.env.MIGRATION_DATABASE_URL??'postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap');
const runtimeBase=new URL(process.env.DATABASE_URL??'postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap');
if(!['127.0.0.1','localhost','[::1]'].includes(migrationBase.hostname)||migrationBase.host!==runtimeBase.host)throw Error('LOCAL_EXCLUSIVE_DATABASE_REQUIRED');
const database='orgmap_l10n_'+randomBytes(8).toString('hex');
const admin=new pg.Pool({connectionString:migrationBase.href});
const migration=new URL(migrationBase);migration.pathname='/'+database;
const runtime=new URL(runtimeBase);runtime.pathname='/'+database;
const origin='http://a11y.localhost:5188';
let created=false,app:Awaited<ReturnType<typeof import('../../server/src/app')['buildApp']>>|undefined,runtimePool:pg.Pool|undefined;
const checks:Record<string,unknown>[]=[];
try{
 await admin.query(`CREATE DATABASE "${database}"`);created=true;
 await new Promise<void>((resolve,reject)=>{
  const processHandle=spawn(process.execPath,['--import','tsx','server/src/migrate.ts'],{stdio:['ignore','pipe','pipe'],env:{...process.env,MIGRATION_DATABASE_URL:migration.href,MIGRATION_SCOPE:'foundation',MIGRATION_MAX_PREFIX:undefined}});
  let diagnostic='';processHandle.stdout.on('data',data=>diagnostic+=data);processHandle.stderr.on('data',data=>diagnostic+=data);
  processHandle.on('error',reject);processHandle.on('exit',code=>code===0?resolve():reject(Error('SCOPED_MIGRATION_FAILED '+diagnostic.replaceAll(migration.href,'[database]'))));
 });
 process.env.MIGRATION_DATABASE_URL=migration.href;process.env.DATABASE_URL=runtime.href;process.env.ALLOWED_ORIGINS=origin;
 const {buildApp}=await import('../../server/src/app');runtimePool=(await import('../../server/src/db')).pool;
 app=await buildApp([],{migrationScope:'foundation'});
 type User={cookie:string;csrf:string;id:string;email:string};
 async function call(method:string,path:string,payload?:unknown,user?:User,version?:number,key=randomUUID()){
  return app!.inject({method:method as any,url:'/api/v1'+path,headers:{origin,'idempotency-key':key,...(user?{cookie:user.cookie,'x-csrf-token':user.csrf}:{}),...(version!==undefined?{'if-match':`"${version}"`}:{})},payload});
 }
 function data(response:any){assert.ok([200,201].includes(response.statusCode),`HTTP ${response.statusCode}: ${response.body}`);return response.json().data;}
 async function register():Promise<User>{const email=randomUUID()+'@example.test';const response=await call('POST','/auth/register',{email,password:'localization-synthetic-password-123',displayName:'Localization synthetic QA'});const body=data(response);return{email,id:body.account.id,csrf:body.csrfToken,cookie:response.cookies.map(c=>`${c.name}=${c.value}`).join('; ')};}
 async function login(user:User):Promise<User>{const response=await call('POST','/auth/login',{email:user.email,password:'localization-synthetic-password-123'});const body=data(response);return{...user,csrf:body.csrfToken,cookie:response.cookies.map(c=>`${c.name}=${c.value}`).join('; ')};}
 let a=await register();const b=await register();
 let preferences=data(await call('GET','/account/preferences',undefined,a)).preferences;
 assert.equal(preferences.locale,'pt-BR');
 for(const [index,locale] of SUPPORTED_LOCALES.entries()){
  const timeZone=index%2?'Asia/Tokyo':'America/New_York',dateFormat=(['DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD']as const)[index%3];
  const payload={locale,timeZone,dateFormat,reducedMotion:true};const key=randomUUID(),version=preferences.version;
  preferences=data(await call('PATCH','/account/preferences',payload,a,version,key)).preferences;
  const replay=data(await call('PATCH','/account/preferences',payload,a,version,key)).preferences;assert.equal(replay.version,preferences.version);
  assert.equal((await call('PATCH','/account/preferences',{locale:'pt-BR'},a,version)).statusCode,409);
  a=await login(a);const reloaded=data(await call('GET','/account/preferences',undefined,a)).preferences;assert.deepEqual(reloaded,preferences);assert.equal(reloaded.locale,locale);
  const other=data(await call('GET','/account/preferences',undefined,b)).preferences;assert.equal(other.locale,'pt-BR');assert.equal(other.reducedMotion,false);
  checks.push({locale,timeZone,dateFormat,version:reloaded.version,loginReload:true,idempotentReplay:true,staleVersionDenied:true,otherAccountUnchanged:true,saveLabel:createTranslator(locale).t('common.save'),renderedInstant:formatInstant('2026-01-01T01:30:00Z',reloaded),renderedNumber:formatNumber(1234.5,reloaded)});
 }
 const before=preferences;
 for(const name of ['Localization organization A','Localization organization B'])data(await call('POST','/organizations',{name},a));
 assert.deepEqual(data(await call('GET','/account/preferences',undefined,a)).preferences,before);
 assert.equal((await call('PATCH','/account/preferences',{timeZone:'invalid/zone'},a,preferences.version)).statusCode,400);
 assert.equal((await call('GET','/account/preferences')).statusCode,401);
 const persisted=new pg.Pool({connectionString:migration.href});
 try{const row=(await persisted.query('SELECT locale,time_zone,date_format,reduced_motion,version FROM account_preferences WHERE account_id=$1',[a.id])).rows[0];assert.equal(row.locale,preferences.locale);assert.equal(row.time_zone,preferences.timeZone);assert.equal(row.version,preferences.version);}finally{await persisted.end();}
 await mkdir('tests/localization/evidence',{recursive:true});
 await writeFile('tests/localization/evidence/postgres.json',JSON.stringify({checkedAt:new Date().toISOString(),scope:'Real account API and PostgreSQL, current foundation migrations, in-process Fastify transport; no UI/layout/global module acceptance',database,syntheticOnly:true,locales:checks,twoOrganizationsPreserveGlobalPreferences:true,invalidTimeZoneDenied:true,anonymousDenied:true,directPostgresRead:true,secretsRecorded:false},null,2)+'\n');
 console.log(JSON.stringify({passed:true,locales:checks.length,scope:'account API/PostgreSQL only',evidence:'tests/localization/evidence/postgres.json'}));
}finally{
 await app?.close();await runtimePool?.end();
 try{if(created)await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);}finally{await admin.end();}
}
