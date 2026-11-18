import pg from 'pg';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
const allowed=new Set(['organization-lifecycle','lifecycle-dispatch-fences','lifecycle-iam-effects']);
const suite=process.argv[2]; if(!suite || !allowed.has(suite)) throw Error('UNKNOWN_LIFECYCLE_DB_SUITE');
const operator=new URL(process.env.MIGRATION_DATABASE_URL??'postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap');
const application=new URL(process.env.DATABASE_URL??'postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap');
if(!['postgres:','postgresql:'].includes(operator.protocol)||operator.protocol!==application.protocol||!['127.0.0.1','localhost','[::1]'].includes(operator.hostname)||operator.host!==application.host||operator.pathname!==application.pathname||operator.search!==application.search)throw Error('MATCHING_LOCAL_DATABASE_SOURCES_REQUIRED');
const database='orgmap_test_'+randomBytes(16).toString('hex'); const admin=new pg.Pool({connectionString:operator.href});
const migration=new URL(operator);migration.pathname='/'+database;const runtime=new URL(application);runtime.pathname='/'+database; let created=false;
async function run(args:string[]) {const env:NodeJS.ProcessEnv={...process.env,MIGRATION_DATABASE_URL:migration.href,DATABASE_URL:runtime.href};delete env.MIGRATION_SCOPE;delete env.MIGRATION_MAX_PREFIX;await new Promise<void>((ok,fail)=>{const child=spawn(process.execPath,['--import','tsx',...args],{env,stdio:'inherit'});child.once('error',fail);child.once('exit',code=>code===0?ok():fail(Error(`LIFECYCLE_DB_TEST_FAILED:${code}`)));});}
try {await admin.query(`CREATE DATABASE "${database}"`);created=true;console.log(`Lifecycle fixture database: ${database}`);await run(['server/src/migrate.ts']);await run(['--test',`tests/server/${suite}.test.ts`]);}
finally {try{if(created){await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);if((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rowCount!==0)throw Error('LIFECYCLE_FIXTURE_CLEANUP_FAILED');console.log(`Lifecycle fixture removed: ${database}`);}}finally{await admin.end();}}
