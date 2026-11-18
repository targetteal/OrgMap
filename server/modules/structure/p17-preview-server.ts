import pg from "pg";
import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
const adminUrl =
  process.env.MIGRATION_DATABASE_URL ??
  "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap";
const admin = new pg.Pool({ connectionString: adminUrl });
const name = "orgmap_structure_p17_" + randomBytes(6).toString("hex");
const migrate = new URL(adminUrl);
migrate.pathname = "/" + name;
const runtime = new URL(
  "postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap",
);
runtime.pathname = "/" + name;
process.env.DATABASE_URL = runtime.href;
process.env.ALLOWED_ORIGINS =
  "http://p17.localhost:5197";
await admin.query('CREATE DATABASE "' + name + '"');
const m = new pg.Pool({ connectionString: migrate.href });
try {
  for (const f of (await readdir("server/migrations"))
    .filter((f) => /^\d{3}_.*sql$/.test(f))
    .sort())
    await m.query(await readFile("server/migrations/" + f, "utf8"));
} finally {
  await m.end();
}
console.log("Isolated preview database: " + name);
const { buildApp } = await import("../../src/app.js");
const { createOrgMapIntegration } = await import("../../integration/index.js");
const { pool } = await import("../../src/db.js");
const app = await buildApp([createOrgMapIntegration()], {migrationMaxPrefix:999});
const {defaultPolicy}=await import("../governance/domain.js");
app.get("/api/v1/qa-policy",async()=>({data:defaultPolicy}));
await app.listen({ host: "127.0.0.1", port: 3037 });
console.log("Structure isolated UI API :3037 DB " + name);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await app.close();
  await pool.end();
  await admin.query('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)');
  await admin.end();
  process.exit(0);
}
process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());
