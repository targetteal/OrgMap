// Run only from a separately copied snapshot. Manifest is JSON {files:{relativePath:sha256}}.
// It must include every regular file in server/, packages/, tests/server/ and scripts/,
// plus package.json and package-lock.json; symlinks in these trees are refused.
import pg from 'pg';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, readdir, lstat, realpath } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { spawn } from 'node:child_process';
const root=await realpath(process.cwd());
if (!process.env.JOURNEY_SNAPSHOT_ROOT || root!==await realpath(process.env.JOURNEY_SNAPSHOT_ROOT)) throw Error('EXPLICIT_SNAPSHOT_ROOT_REQUIRED');
const manifestPath=process.env.JOURNEY_MANIFEST, expected=process.env.JOURNEY_MANIFEST_SHA256;
if (!manifestPath || !expected || !/^[a-f0-9]{64}$/.test(expected)) throw Error('EXPLICIT_MANIFEST_HASH_REQUIRED');
const manifestBytes=await readFile(manifestPath);
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
if(hash(manifestBytes)!==expected) throw Error('MANIFEST_HASH_MISMATCH');
const manifest=JSON.parse(manifestBytes.toString()) as {files:Record<string,string>};
const found:Record<string,string>={};
async function visit(path:string):Promise<void> {
 const info=await lstat(path); if(info.isSymbolicLink()) throw Error('SNAPSHOT_SYMLINK_REFUSED:'+path);
 if(info.isDirectory()) { for(const name of (await readdir(path)).sort()) await visit(resolve(path,name)); return; }
 if(!info.isFile()) throw Error('SNAPSHOT_NONREGULAR_FILE:'+path);
 found[relative(root,path).split(sep).join('/')]=hash(await readFile(path));
}
for(const path of ['server','packages','tests/server','scripts','package.json','package-lock.json']) await visit(resolve(root,path));
if(JSON.stringify(Object.entries(found).sort())!==JSON.stringify(Object.entries(manifest.files).sort())) throw Error('SNAPSHOT_MANIFEST_MISMATCH');
const operator=new URL(process.env.MIGRATION_DATABASE_URL ?? 'postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap');
const runtime=new URL(process.env.DATABASE_URL ?? 'postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap');
if(!['127.0.0.1','localhost','[::1]'].includes(operator.hostname) || operator.host!==runtime.host || operator.pathname!==runtime.pathname) throw Error('MATCHING_LOCAL_DATABASE_SOURCES_REQUIRED');
const admin=new pg.Pool({connectionString:operator.href}), name='orgmap_journey_'+randomBytes(8).toString('hex');
const migration=new URL(operator), application=new URL(runtime); migration.pathname='/'+name; application.pathname='/'+name;
async function run(args:string[]) {
 const env:NodeJS.ProcessEnv={...process.env,MIGRATION_DATABASE_URL:migration.href,DATABASE_URL:application.href};
 delete env.MIGRATION_SCOPE; delete env.MIGRATION_MAX_PREFIX;
 await new Promise<void>((resolveRun,reject)=>{const child=spawn(process.execPath,['--import','tsx',...args],{env,stdio:'inherit'});child.once('error',reject);child.once('exit',(code,signal)=>code===0?resolveRun():reject(Error(`JOURNEY_CHILD_FAILED:${code}:${signal}`)));});
}
let created=false;
try { console.log(`journey snapshot ${root} manifest ${expected} database ${name}`); await admin.query(`CREATE DATABASE "${name}"`); created=true; await run(['server/src/migrate.ts']); await run(['--test','tests/server/meeting-decision-journey.test.ts']); }
finally { try { if(created) { await admin.query(`DROP DATABASE "${name}"`); console.log(`journey database removed ${name}`); } } finally { await admin.end(); } }
