/** Own temporary database only. Does not restart/migrate the dev service/database. */
import pg from 'pg';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const candidate=process.env.ORGMAP_QA_CANDIDATE??process.cwd();
const testRoot=fileURLToPath(new URL('.',import.meta.url));
const scope=process.env.ORGMAP_QA_SCOPE??'foundation';
const keepOnFailure=process.env.ORGMAP_QA_KEEP_DB==='1';
let failed=false;
const adminUrl=process.env.MIGRATION_DATABASE_URL??'postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap';
const admin=new pg.Pool({connectionString:adminUrl});
const name='orgmap_quality_'+randomBytes(12).toString('hex');
const migration=new URL(adminUrl);migration.pathname='/'+name;
const runtime=new URL(process.env.DATABASE_URL??'postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap');runtime.pathname='/'+name;
if(!['localhost','127.0.0.1','[::1]'].includes(migration.hostname)||migration.host!==runtime.host)throw Error('QA requires same local database host');
let created=false;
async function run(args:string[]){
 await new Promise<void>((resolve,reject)=>{
  const env={...process.env,MIGRATION_DATABASE_URL:migration.href,DATABASE_URL:runtime.href};
  if(scope!=='integrated')env.MIGRATION_MAX_PREFIX='19';else delete env.MIGRATION_MAX_PREFIX;
  const child=spawn(process.execPath,['--import','tsx',...args],{cwd:candidate,stdio:'inherit',env});
  child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('QA child exit '+code)));
 });
}
try{
 await admin.query('CREATE DATABASE "'+name+'"');created=true;
 console.log('QA database created: '+name);
 console.log('QA phase: migrate clean database');
 await run(['server/src/migrate.ts']);
 console.log('QA phase: tests');
 const tests=scope==='security'?['security-independent.test.ts']:['foundation-independent.test.ts',...(scope==='integrated'?['goals-independent.test.ts','security-independent.test.ts']:[])];
 await run(['--test',...tests.map(name=>resolve(testRoot,name))]);
}catch(error){failed=true;throw error;}finally{
 if(created&&failed&&keepOnFailure)console.log('QA database retained for diagnosis: '+name);
 else if(created){await admin.query('DROP DATABASE "'+name+'" WITH (FORCE)');console.log('QA database removed: '+name);}
 await admin.end();
}
