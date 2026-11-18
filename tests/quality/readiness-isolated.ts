import pg from 'pg';import {randomBytes} from 'node:crypto';import {spawn} from 'node:child_process';import {resolve} from 'node:path';import {fileURLToPath} from 'node:url';
const candidate=process.env.ORGMAP_QA_CANDIDATE??process.cwd(),testRoot=fileURLToPath(new URL('.',import.meta.url));
const baseAdmin=new URL(process.env.MIGRATION_DATABASE_URL??'postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap');
const baseRuntime=new URL(process.env.DATABASE_URL??'postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap');
if(!['127.0.0.1','localhost','[::1]'].includes(baseAdmin.hostname)||baseAdmin.host!==baseRuntime.host)throw Error('QA requires same local PostgreSQL host');
const admin=new pg.Pool({connectionString:baseAdmin.href});let failed=false;
async function child(args:string[],env:NodeJS.ProcessEnv){return await new Promise<number>((resolve,reject)=>{const p=spawn(process.execPath,['--import','tsx',...args],{cwd:candidate,stdio:'inherit',env});p.on('error',reject);p.on('exit',code=>resolve(code??1));});}
try{for(const profile of ['partial002','valid_foundation','altered_checksum']){
 const name='orgmap_quality_ready_'+randomBytes(10).toString('hex');let created=false,profileFailed=false;
 const migration=new URL(baseAdmin);migration.pathname='/'+name;const runtime=new URL(baseRuntime);runtime.pathname='/'+name;
 const env={...process.env,MIGRATION_DATABASE_URL:migration.href,DATABASE_URL:runtime.href,MIGRATION_MAX_PREFIX:profile==='partial002'?'2':'19',ORGMAP_QA_SCHEMA_PROFILE:profile};
 try{
  await admin.query('CREATE DATABASE "'+name+'"');created=true;console.log('QA readiness profile '+profile+' database '+name);
  if(await child(['server/src/migrate.ts'],env)!==0){profileFailed=true;failed=true;continue;}
  if(profile==='altered_checksum'){
   const mutate=new pg.Pool({connectionString:migration.href});try{const changed=await mutate.query("UPDATE schema_migrations SET checksum=repeat('0',64) WHERE name='003_invitations.sql'");if(changed.rowCount!==1)throw Error('Checksum fixture was not changed');}finally{await mutate.end();}
  }
  profileFailed=(await child([resolve(testRoot,'readiness-independent.test.ts')],env))!==0;failed=failed||profileFailed;
 }finally{
  if(created&&profileFailed&&process.env.ORGMAP_QA_KEEP_DB==='1')console.log('QA readiness database retained: '+name);
  else if(created){await admin.query('DROP DATABASE "'+name+'" WITH (FORCE)');console.log('QA readiness database removed: '+name);}
 }
}}finally{await admin.end();}
if(failed)process.exitCode=1;
