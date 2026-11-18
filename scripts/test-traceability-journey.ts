import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
const operator=new URL(process.env.MIGRATION_DATABASE_URL??'postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap');
const runtime=new URL(process.env.DATABASE_URL??'postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap');
if(!['127.0.0.1','localhost','[::1]'].includes(operator.hostname)||operator.host!==runtime.host||operator.pathname!==runtime.pathname)throw Error('MATCHING_LOCAL_DATABASE_SOURCES_REQUIRED');
const admin=new pg.Pool({connectionString:operator.href}),name='orgmap_journey_'+randomBytes(8).toString('hex');
const suite=process.argv.find(x=>x.startsWith('--suite='))?.slice('--suite='.length)??process.env.TRACE_TEST_SUITE??'journey';
if(!['journey','governance','meeting'].includes(suite))throw Error('TRACE_TEST_SUITE_INVALID');
const migration=new URL(operator),application=new URL(runtime);migration.pathname='/'+name;application.pathname='/'+name;
async function run(args:string[]){const env:NodeJS.ProcessEnv={...process.env,MIGRATION_DATABASE_URL:migration.href,DATABASE_URL:application.href};delete env.MIGRATION_SCOPE;delete env.MIGRATION_MAX_PREFIX;
 await new Promise<void>((resolve,reject)=>{const child=spawn(process.execPath,['--import','tsx',...args],{env,stdio:'inherit'});child.once('error',reject);child.once('exit',(code,signal)=>code===0?resolve():reject(Error(`TRACE_TEST_CHILD_FAILED:${code}:${signal}`)));});}
let created=false;try{console.log('trace-fixture',JSON.stringify({database:name,suite}));await admin.query(`CREATE DATABASE "${name}"`);created=true;await run(['server/src/migrate.ts']);const file=suite==='journey'?'traceability-journey.test.ts':suite==='meeting'?'meeting-decision-journey.test.ts':'governance.test.ts';await run(['--test','--test-concurrency=1','tests/server/'+file]);}
finally{try{if(created){await admin.query(`DROP DATABASE "${name}"`);if((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount)throw Error('TRACE_TEST_CLEANUP_FAILED');console.log('trace-cleanup',JSON.stringify({database:name,removed:true}));}}finally{await admin.end();}}
