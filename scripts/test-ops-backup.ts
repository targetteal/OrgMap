import pg from "pg";
import { spawn } from "node:child_process";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OrganizationLedger } from "../server/ops/organization-ledger.js";
import { acquireOrganizationHostLease, provisionFreshHostBinding } from "../server/ops/organization-host-lease.js";
const source=new URL(process.env.MIGRATION_DATABASE_URL??"postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap"),runtime=new URL(process.env.DATABASE_URL??"postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap");
if(![source,runtime].every(u=>['postgres:','postgresql:'].includes(u.protocol)&&['localhost','127.0.0.1','[::1]'].includes(u.hostname))||source.host!==runtime.host||source.pathname!==runtime.pathname)throw Error('MATCHING_LOCAL_DATABASE_SOURCES_REQUIRED');
const admin=new pg.Pool({connectionString:source.href}),directory=await mkdtemp(join(tmpdir(),'orgmap-ops-proof-')),ledger=await OrganizationLedger.initialize(join(directory,'lifecycle-authority'));
let database='';let lease:Awaited<ReturnType<typeof acquireOrganizationHostLease>>|undefined;
try {
 lease=await acquireOrganizationHostLease(ledger);let provisioned;try{provisioned=await provisionFreshHostBinding(ledger,lease,source.href);}catch(e){const match=e instanceof Error&&/^HOST_INSTALL_RECOVERY_REQUIRED:(orgmap_fresh_[a-f0-9]{32})$/.exec(e.message);if(match)database=match[1];throw e;}database=provisioned.database;await lease.release();lease=undefined;
 source.pathname='/'+database;runtime.pathname='/'+database;
 await new Promise<void>((ok,no)=>{const child=spawn(process.execPath,['--import','tsx','--test',...process.argv.slice(2).filter(x=>x.startsWith('--test-name-pattern=')),'tests/server/ops-backup.test.ts'],{env:{...process.env,COMPOSE_PROJECT_NAME:process.env.COMPOSE_PROJECT_NAME ?? "orgmap",MIGRATION_DATABASE_URL:source.href,DATABASE_URL:runtime.href,OPS_PROOF_DIRECTORY:directory},stdio:'inherit'});child.on('error',no);child.on('exit',code=>code===0?ok():no(Error('OPS_PROOF_FAILED:'+code)));});
} finally {await lease?.release();if(database){if(!/^orgmap_fresh_[a-f0-9]{32}$/.test(database))throw Error('UNEXPECTED_FIXTURE_DATABASE');await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);assert.equal((await admin.query("SELECT 1 FROM pg_database WHERE datname=$1",[database])).rowCount,0);console.log(JSON.stringify({opsFixtureCleanup:{database,databaseAbsent:true}}));}await admin.end();await rm(directory,{recursive:true,force:true});await assert.rejects(readdir(directory),{code:"ENOENT"});console.log(JSON.stringify({opsFixtureDirectoryCleanup:{directory,directoryAbsent:true}}));}
