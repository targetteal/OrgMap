import pg from "pg";
import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { isFoundationMigration } from "../server/src/migration-selection.js";
import { foundationDefaultAdmissionPolicy } from "../server/src/admission.js";

// Dedicated synthetic database. No worker or external delivery is started.
const adminUrl = "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap";
const admin = new pg.Pool({connectionString:adminUrl});
const name = "orgmap_o2_ui_" + randomBytes(6).toString("hex");
const migration = new URL(adminUrl); migration.pathname = "/" + name;
const runtime = new URL("postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap"); runtime.pathname = "/" + name;
process.env.DATABASE_URL = runtime.href;
process.env.ALLOWED_ORIGINS = "http://127.0.0.1:5211";
await admin.query('CREATE DATABASE "'+name+'"');
const migrator = new pg.Pool({connectionString:migration.href});
try {
  for (const file of (await readdir("server/migrations")).filter(file => isFoundationMigration(file) || /^(0[2-9][0-9]|10[0-9])_.*sql$/.test(file)).sort())
    await migrator.query(await readFile("server/migrations/"+file,"utf8"));
} finally {await migrator.end();}
const { buildApp } = await import("../server/src/app.js");
const { pool } = await import("../server/src/db.js");
const { createStructurePorts, createStructureModule } = await import("../server/modules/structure/plugin.js");
const { createGovernanceModule } = await import("../server/modules/governance/plugin.js");
const app = await buildApp([foundationDefaultAdmissionPolicy,async(app,core)=>{
  const ports=createStructurePorts(core);core.registerFoundationStructure(ports);
  await createStructureModule()(app,core);
  await createGovernanceModule({applyStructure:ports.applyStructure})(app,core);
}]);
await app.listen({host:"127.0.0.1",port:3061});
console.log("Synthetic O2 preview API http://127.0.0.1:3061 database="+name);
let closing=false;
async function close(){if(closing)return;closing=true;await app.close();await pool.end();await admin.query('DROP DATABASE IF EXISTS "'+name+'" WITH (FORCE)');await admin.end();process.exit(0);}
process.on("SIGINT",()=>void close());process.on("SIGTERM",()=>void close());
