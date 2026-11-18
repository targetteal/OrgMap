import pg from "pg";
import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import {isFoundationMigration} from '../../src/migration-selection.js';
const adminUrl =
  process.env.MIGRATION_DATABASE_URL ??
  "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap";
const name = "orgmap_gov_ui_" + randomBytes(6).toString("hex"),
  admin = new pg.Pool({ connectionString: adminUrl });
const migration = new URL(adminUrl);
migration.pathname = "/" + name;
const runtime = new URL(
  "postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap",
);
runtime.pathname = "/" + name;
process.env.DATABASE_URL = runtime.href;
process.env.ALLOWED_ORIGINS = "http://governance.localhost:5186";
await admin.query(`CREATE DATABASE "${name}"`);
const db = new pg.Pool({ connectionString: migration.href });
try {
  for (const file of (await readdir("server/migrations"))
    .filter((f) => isFoundationMigration(f)||/^02\d.*sql$|^10[0-7]_governance.*sql$|^3\d\d_.*sql$/.test(f))
    .sort())
    await db.query(await readFile("server/migrations/" + file, "utf8"));
} finally {
  await db.end();
}
const { buildApp } = await import("../../src/app.js");
const {foundationDefaultAdmissionPolicy}=await import('../../src/admission.js');
const { pool } = await import("../../src/db.js");
const { createGovernanceModule } = await import("./plugin.js");
const { createStructurePorts } = await import("../structure/applier.js");
const { registerContext } = await import("../structure/plugin.js");
const {createMeetings}=await import('../meetings/plugin.js');
const {selfOnlyPorts}=await import('../meetings/service.js');
const {createMeetingAgendaCommandPort}=await import('../meetings/agenda-port.js');
let app: Awaited<ReturnType<typeof buildApp>>;
try {
  app = await buildApp([
    foundationDefaultAdmissionPolicy,
    async (_app, core) => core.registerOrganizationSettings(async ctx => ({version:1,settings:{name:ctx.org.name,locale:ctx.org.locale,timezone:ctx.org.time_zone,modules:{structure:true,governance:true,meetings:true}}})),
    registerContext,
    async(_app,core)=>core.registerModuleScope({module:'meetings',routePrefixes:[],resourceTypes:['meeting','report']}),
    createMeetings(selfOnlyPorts),
    async (app, core) =>
      createGovernanceModule({...createStructurePorts(core),agenda:createMeetingAgendaCommandPort(core,selfOnlyPorts)})(app, core),
  ]);
  app.get('/api/v1/governance-preview',async()=>({testOnly:true,databaseName:name}));
  await app.listen({ host: "127.0.0.1", port: 3016 });
  console.log("Governance isolated API :3016 / DB " + name);
} catch (error) {
  await pool.end();
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.end();
  throw error;
}
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await app.close();
  await pool.end();
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.end();
  process.exit(0);
}
process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());
