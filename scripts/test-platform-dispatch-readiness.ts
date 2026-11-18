import pg from "pg";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
const operator = new URL(process.env.MIGRATION_DATABASE_URL ?? "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap");
const runtime = new URL(process.env.DATABASE_URL ?? "postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap");
if (!["127.0.0.1","localhost","[::1]"].includes(operator.hostname) || operator.host!==runtime.host || operator.pathname!==runtime.pathname)
  throw Error("MATCHING_LOCAL_DATABASE_SOURCES_REQUIRED");
const admin = new pg.Pool({connectionString:operator.href}), name="orgmap_platform_readiness_"+randomBytes(8).toString("hex");
const migration = new URL(operator); migration.pathname="/"+name;
const application = new URL(runtime); application.pathname="/"+name;
async function run(args: string[], prefix?: string) {
  const env:NodeJS.ProcessEnv={...process.env,MIGRATION_DATABASE_URL:migration.href,DATABASE_URL:application.href};
  delete env.MIGRATION_SCOPE; delete env.MIGRATION_MAX_PREFIX; if(prefix) env.MIGRATION_MAX_PREFIX=prefix;
  await new Promise<void>((resolve,reject)=>{
    const child=spawn(process.execPath,["--import","tsx",...args],{env,stdio:"inherit"});
    child.once("error",reject); child.once("exit",code=>code===0?resolve():reject(Error("READINESS_TEST_FAILED:"+code)));
  });
}
let created=false;
try {
  await admin.query(`CREATE DATABASE "${name}"`); created=true;
  await run(["server/src/migrate.ts"],"899");
  await run(["--input-type=module","-e",`import assert from 'node:assert/strict'; import {assertPlatformDispatchReady} from './server/modules/platform/dispatch-readiness.ts'; import {pool} from './server/src/db.ts'; try { await assert.rejects(assertPlatformDispatchReady(), /PLATFORM_DISPATCH_MIGRATIONS_REQUIRED/); } finally { await pool.end(); }`]);
  await run(["server/src/migrate.ts"]);
  await run(["--input-type=module","-e",`import {assertPlatformDispatchReady} from './server/modules/platform/dispatch-readiness.ts'; import {pool} from './server/src/db.ts'; try { await assertPlatformDispatchReady(); } finally { await pool.end(); }`]);
  console.log("Platform dispatch refuses missing 900 and accepts matching full schema");
} finally { if(created) await admin.query(`DROP DATABASE "${name}"`); await admin.end(); }
