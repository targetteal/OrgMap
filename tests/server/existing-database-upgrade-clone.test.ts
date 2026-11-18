import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import { createWriteStream,createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import pg from 'pg';

const qi=(s:string)=>'"'+s.replaceAll('"','""')+'"';
async function tool(args:string[],file:string,write:boolean){
 const p=spawn('docker',['compose','exec','-T','postgres',...args],{env:{...process.env,COMPOSE_PROJECT_NAME:'orgmap'},stdio:['pipe','pipe','pipe']});
 p.stderr.resume();
 const done=new Promise<void>((ok,no)=>{p.on('error',no);p.on('close',code=>code===0?ok():no(Error('CLONE_POSTGRES_TOOL_FAILED')));});
 if(write){p.stdin.end();await Promise.all([pipeline(p.stdout,createWriteStream(file,{flags:'wx',mode:0o600})),done]);}
 else {p.stdout.resume();await Promise.all([pipeline(createReadStream(file),p.stdin),done]);}
}
type Shape={name:string;columns:string[]};
async function dataProof(c:pg.PoolClient,shapes:Shape[]){
 const result:Record<string,{count:string;hash:string}>={};
 for(const t of shapes){
  const expr=t.columns.map(x=>'t.'+qi(x)).join(',');
  const row=(await c.query(`SELECT count(*)::text AS count,encode(sha256(convert_to(coalesce(string_agg(j::text,E'\\n' ORDER BY j::text),''),'UTF8')),'hex') AS hash FROM (SELECT jsonb_build_array(${expr}) AS j FROM public.${qi(t.name)} t) x`)).rows[0];
  result[t.name]={count:row.count,hash:row.hash};
 }
 return result;
}
test('existing local database upgrades only in a private clone preserving original data',{skip:process.env.ORGMAP_RUN_EXISTING_DB_CLONE!=='explicit'},async()=>{
 const source=new URL(process.env.MIGRATION_DATABASE_URL??'postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap');
 if(!['127.0.0.1','localhost','[::1]'].includes(source.hostname)||source.pathname!=='/orgmap'||source.search||source.hash)throw Error('CLONE_SOURCE_INVALID');
 const name='orgmap_upgrade_clone_'+randomBytes(10).toString('hex'),dir=await mkdtemp(join(tmpdir(),'orgmap-upgrade-private-')),dump=join(dir,'database.dump');
 const admin=new pg.Pool({connectionString:source.href});let created=false;let clone:pg.Pool|undefined;const fresh=name+'_fresh';let freshCreated=false;
 try {
  const s=await admin.connect();let proof:Record<string,{count:string;hash:string}>,shapes:Shape[];
  try {
   await s.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const migrationRows=(await s.query('SELECT name,checksum FROM schema_migrations ORDER BY name')).rows;
   if(migrationRows.length!==112||migrationRows.some(r=>!r.checksum||Number(r.name.slice(0,3))>507))throw Error('CLONE_SOURCE_MIGRATIONS_CHANGED');
   const objects=(await s.query("SELECT c.relname AS name,array_agg(a.attname::text ORDER BY a.attnum) AS columns FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped WHERE n.nspname='public' AND c.relkind='r' AND c.relname<>'schema_migrations' GROUP BY c.relname ORDER BY c.relname")).rows;
   shapes=objects.map(r=>({name:r.name,columns:r.columns}));proof=await dataProof(s,shapes);
   const snap=(await s.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
   await tool(['pg_dump','-U',decodeURIComponent(source.username),'-d','orgmap','--format=c','--snapshot='+snap],dump,true);
   await s.query('COMMIT');
  }catch(e){await s.query('ROLLBACK').catch(()=>{});throw e;}finally{s.release();}
  const dumpHash=createHash('sha256').update(await readFile(dump)).digest('hex');
  await admin.query('CREATE DATABASE '+qi(name));created=true;console.log('upgrade-clone-created',name);
  await tool(['pg_restore','-U',decodeURIComponent(source.username),'-d',name,'--exit-on-error','--no-owner'],dump,false);
  const target=new URL(source);target.pathname='/'+name;clone=new pg.Pool({connectionString:target.href});
  const before=await clone.connect();try{assert.deepEqual(await dataProof(before,shapes!),proof!);}finally{before.release();}
  const diagnostic=process.env.ORGMAP_CLONE_CATALOG_DIAGNOSTIC==='explicit';
  const env:NodeJS.ProcessEnv={...process.env,MIGRATION_DATABASE_URL:target.href};delete env.MIGRATION_SCOPE;delete env.MIGRATION_MAX_PREFIX;
  await new Promise<void>((ok,no)=>{const p=spawn(process.execPath,['--import','tsx','server/src/migrate.ts'],{env,stdio:['ignore','ignore','pipe']});let diagnostic='';p.stderr.on('data',v=>{diagnostic=(diagnostic+v.toString()).slice(-10000);});p.on('error',no);p.on('exit',code=>{if(code===0)return ok();const marker=/error: ([A-Z][A-Z0-9_]{4,100})/.exec(diagnostic)?.[1]??'UNCLASSIFIED';const sqlstate=/code: '([0-9A-Z]{5})'/.exec(diagnostic)?.[1]??'UNKNOWN';no(Error(`CLONE_UPGRADE_FAILED:${marker}:${sqlstate}`));});});
  if(diagnostic){
   await admin.query('CREATE DATABASE '+qi(fresh));freshCreated=true;
   const freshUrl=new URL(source);freshUrl.pathname='/'+fresh;
   await new Promise<void>((ok,no)=>{const p=spawn(process.execPath,['--import','tsx','server/src/migrate.ts'],{env:{...env,MIGRATION_DATABASE_URL:freshUrl.href},stdio:['ignore','ignore','ignore']});p.on('error',no);p.on('exit',code=>code===0?ok():no(Error('FRESH_MIGRATION_FAILED')));});
   const freshPool=new pg.Pool({connectionString:freshUrl.href});
   try{
    const queries:Record<string,string>={
     relations:"SELECT n.nspname||'.'||c.relname AS k,jsonb_build_array(c.relkind,pg_get_userbyid(c.relowner),c.relacl::text,c.relrowsecurity,c.relforcerowsecurity) AS v FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S')",
     columns:"SELECT c.relname||'.'||a.attname AS k,jsonb_build_array(format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,a.attacl::text,pg_get_expr(d.adbin,d.adrelid)) AS v FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped",
     constraints:"SELECT c.relname||'.'||k.conname AS k,jsonb_build_array(k.contype,k.condeferrable,k.condeferred,k.convalidated,pg_get_constraintdef(k.oid,true)) AS v FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'",
     functions:"SELECT p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS k,jsonb_build_array(pg_get_userbyid(p.proowner),p.proacl::text,p.prosecdef,to_jsonb(p.proconfig),pg_get_functiondef(p.oid)) AS v FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p')",
     schemas:"SELECT nspname AS k,jsonb_build_array(pg_get_userbyid(nspowner),nspacl::text) AS v FROM pg_namespace WHERE nspname='public'",
     indexes:"SELECT c.relname AS k,pg_get_indexdef(c.oid) AS v FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'",
     triggers:"SELECT c.relname||'.'||t.tgname AS k,jsonb_build_array(t.tgenabled,pg_get_triggerdef(t.oid,true),pg_get_functiondef(t.tgfoid)) AS v FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal",
     policies:"SELECT c.relname||'.'||p.polname AS k,jsonb_build_array(p.polcmd,p.polpermissive,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) AS v FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'",
    };
    for(const [kind,sql] of Object.entries(queries)){const [a,b]=await Promise.all([clone.query(sql),freshPool.query(sql)]);const am=new Map(a.rows.map(r=>[r.k,JSON.stringify(r.v)])),bm=new Map(b.rows.map(r=>[r.k,JSON.stringify(r.v)]));const keys=[...new Set([...am.keys(),...bm.keys()])].filter(k=>am.get(k)!==bm.get(k)).sort();if(keys.length){console.log('catalog-difference',JSON.stringify({kind,keys}));if(kind==='relations')for(const key of keys){const x=JSON.parse(am.get(key)??'null'),y=JSON.parse(bm.get(key)??'null');console.log('relation-field-difference',JSON.stringify({key,fields:['kind','owner','acl','rls','forceRls'].filter((_,i)=>JSON.stringify(x?.[i])!==JSON.stringify(y?.[i])),cloneAcl:x?.[2],freshAcl:y?.[2]}));}}}
    const digest=async(p:pg.Pool)=>{const c=await p.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(730184)');const h=(await c.query('SELECT orgmap_deletion_schema_fingerprint_internal() h')).rows[0].h;await c.query('COMMIT');return h;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
    const a=await digest(clone),b=await digest(freshPool);assert.equal(a,b,'equivalent restored ACL must retain fingerprint');
    const mutations=['GRANT SELECT ON public.iam_mail_scope_leases TO PUBLIC','GRANT SELECT ON public.iam_mail_scope_leases TO orgmap_app','GRANT TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public.iam_mail_scope_leases TO orgmap_app','GRANT SELECT ON public.iam_mail_scope_leases TO orgmap_app WITH GRANT OPTION','REVOKE SELECT ON public.iam_mail_scope_leases FROM orgmap_migrator','REVOKE ALL ON public.iam_mail_scope_leases FROM orgmap_migrator','ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO orgmap_app','ALTER TABLE public.iam_mail_scope_leases OWNER TO orgmap_app'];
    for(const sql of mutations){const c=await clone.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(730184)');await c.query(sql);assert.notEqual((await c.query('SELECT orgmap_deletion_schema_fingerprint_internal() h')).rows[0].h,a,sql);}finally{await c.query('ROLLBACK');c.release();}}
    assert.equal(await digest(clone),a);console.log('catalog-fingerprint-proof',JSON.stringify({fingerprint:a,realGrantDetected:true,mutationsChecked:mutations.length}));
   }finally{await freshPool.end();}
   return;
  }
  const c=await clone.connect();try{
   assert.deepEqual(await dataProof(c,shapes!),proof!);
   const states=(await c.query("SELECT count(*)::int AS orgs,count(*) FILTER (WHERE l.state='ACTIVE' AND l.fence=1)::int AS active FROM organizations o LEFT JOIN organization_lifecycle l ON l.organization_id=o.id")).rows[0];assert.equal(states.orgs,states.active);
   await c.query('BEGIN ISOLATION LEVEL READ COMMITTED');await c.query('SELECT pg_advisory_xact_lock(730184)');
   const fingerprint=(await c.query('SELECT orgmap_deletion_schema_fingerprint_internal() AS h')).rows[0].h;
   const baseline=(await c.query('SELECT fingerprint FROM organization_deletion_schema_baseline WHERE singleton')).rows[0]?.fingerprint;
   assert.equal(fingerprint,baseline);assert.equal(fingerprint,'e07243183515cbc26aa36b91cda52504685f8aa1eceffef48c52eb4a87a8f164');await c.query('COMMIT');
   console.log('upgrade-clone-proof',JSON.stringify({database:name,tableCount:shapes!.length,organizations:states.orgs,dumpSha256:dumpHash,fingerprint}));
  }finally{c.release();}
 }finally{
  await clone?.end();
  if(freshCreated){await admin.query('DROP DATABASE '+qi(fresh));assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[fresh])).rowCount,0);console.log('upgrade-fresh-cleanup',fresh);}
  if(created){await admin.query('DROP DATABASE '+qi(name));assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount,0);}
  await admin.end();await rm(dir,{recursive:true,force:true});console.log('upgrade-clone-cleanup',JSON.stringify({database:name,removed:created,privateDumpRemoved:true}));
 }
});
