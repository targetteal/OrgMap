// Own disposable account/a11y runtime. No watch, no shared database or external services.
import pg from 'pg';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const migrationBase=new URL(process.env.MIGRATION_DATABASE_URL??'postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap');
const runtimeBase=new URL(process.env.DATABASE_URL??'postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap');
if(!['127.0.0.1','localhost','[::1]'].includes(migrationBase.hostname)||migrationBase.host!==runtimeBase.host)throw Error('LOCAL_EXCLUSIVE_DATABASE_REQUIRED');
const database='orgmap_a11y_ui_'+randomBytes(8).toString('hex');
const admin=new pg.Pool({connectionString:migrationBase.href});
const migration=new URL(migrationBase);migration.pathname='/'+database;
const runtime=new URL(runtimeBase);runtime.pathname='/'+database;
const origin='http://a11y.localhost:5188',port=3028;
let created=false,app:Awaited<ReturnType<typeof import('../../server/src/app')['buildApp']>>|undefined,runtimePool:pg.Pool|undefined;
const fingerprints=[];
for(const file of ['web/src/App.tsx','web/src/account/index.tsx','web/src/localization/index.tsx','web/src/accessibility/index.tsx','web/src/accessibility/styles.css'])fingerprints.push({file,sha256:createHash('sha256').update(await readFile(file)).digest('hex')});
const state={owner:'01a15237-1624-7652-8bf2-47fad3e454e3',pid:process.pid,database,origin,api:`http://127.0.0.1:${port}`,state:'starting',startedAt:new Date().toISOString(),scope:'Real App consumers, account/core backend foundation only; feature backends are not registered',syntheticOnly:true,fingerprints};
async function record(){await mkdir('tests/localization/evidence',{recursive:true});await writeFile('tests/localization/evidence/runtime.json',JSON.stringify(state,null,2)+'\n');}
try{
 await admin.query(`CREATE DATABASE "${database}"`);created=true;
 await new Promise<void>((resolve,reject)=>{
  const child=spawn(process.execPath,['--import','tsx','server/src/migrate.ts'],{stdio:['ignore','pipe','pipe'],env:{...process.env,MIGRATION_DATABASE_URL:migration.href,MIGRATION_SCOPE:'foundation',MIGRATION_MAX_PREFIX:undefined}});
  let diagnostic='';child.stdout.on('data',data=>diagnostic+=data);child.stderr.on('data',data=>diagnostic+=data);child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('SCOPED_MIGRATION_FAILED '+diagnostic.replaceAll(migration.href,'[database]'))));
 });
 process.env.MIGRATION_DATABASE_URL=migration.href;process.env.DATABASE_URL=runtime.href;process.env.ALLOWED_ORIGINS=origin;
 const {buildApp}=await import('../../server/src/app');runtimePool=(await import('../../server/src/db')).pool;app=await buildApp([],{migrationScope:'foundation'});
 const accounts=[];
 for(const [index,displayName] of ['Pessoa A — QA acessibilidade','Pessoa B — QA acessibilidade'].entries()){
  const email=`a11y-${index+1}@example.test`;
  const registration=await app.inject({method:'POST',url:'/api/v1/auth/register',headers:{origin,'idempotency-key':randomUUID()},payload:{email,password:'localization-synthetic-password-123',displayName}});
  if(![200,201].includes(registration.statusCode))throw Error('SYNTHETIC_REGISTRATION_FAILED '+registration.statusCode);
  const body=registration.json().data,headers={origin,'idempotency-key':randomUUID(),cookie:registration.cookies.map(c=>`${c.name}=${c.value}`).join('; '),'x-csrf-token':body.csrfToken};
  const organizations=[];
  for(const name of index===0?['Pesquisa acessível — A','Equipe internacional — B']:['Outra conta — C']){
   const response=await app.inject({method:'POST',url:'/api/v1/organizations',headers:{...headers,'idempotency-key':randomUUID()},payload:{name}});
   if(![200,201].includes(response.statusCode))throw Error('SYNTHETIC_ORGANIZATION_FAILED '+response.statusCode);
   const data=response.json().data;organizations.push({id:data.organization.id,name});
  }
  accounts.push({email,id:body.account.id,organizations});
 }
 await writeFile('tests/localization/evidence/runtime-fixture.json',JSON.stringify({syntheticOnly:true,database,accounts,passwordSource:'Fixed synthetic QA password in runtime.ts; not a real user credential'},null,2)+'\n');
 await app.listen({host:'127.0.0.1',port});state.state='running';await record();console.log(JSON.stringify({state:'running',pid:process.pid,database,port,origin,scope:state.scope}));
 await new Promise<void>(resolve=>{process.once('SIGINT',()=>resolve());process.once('SIGTERM',()=>resolve());});
}finally{
 await app?.close();await runtimePool?.end();
 try{if(created)await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);}finally{await admin.end();state.state='closed';await record();}
}
