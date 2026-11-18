import pg from "pg";
import { spawnSync } from "node:child_process";
const name = process.env.GOALS_PREVIEW_DATABASE ?? "orgmap_goals_preview";
if (!/^orgmap_goals_[a-z0-9_]+$/.test(name)) throw Error("Isolated Goals preview database required");
const admin = new pg.Pool({
  connectionString:
    "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap",
});
if (
  !(await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [name]))
    .rowCount
)
  await admin.query("CREATE DATABASE " + name);
await admin.end();
process.env.DATABASE_URL =
  "postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/" + name;
process.env.MIGRATION_DATABASE_URL =
  "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/" + name;
process.env.ALLOWED_ORIGINS = "http://goals.localhost:5178";
const result = spawnSync(
  process.execPath,
  ["--import", "tsx", process.env.GOALS_INTEGRATED === "1" ? "server/src/migrate.ts" : "server/modules/goals/migrate-slice.ts"],
  { stdio: "inherit", env: process.env },
);
if (result.status) process.exit(result.status ?? 1);
const { buildApp } = await import("../../src/app.js");
const { foundationDefaultAdmissionPolicy } = await import("../../src/admission.js");
const { createGoalsModule } = await import("./plugin.js");
const { createRegistryGoalLinkResolver } = await import("./ports.js");
const { ResourceRegistry } = await import("../platform/ports.js");
const { workModule, createWorkResourceAdapters } =
  await import("../work/index.js");
const registry = new ResourceRegistry();
for (const [kind, adapter] of Object.entries(createWorkResourceAdapters()))
  registry.registerResourceAdapter(kind, adapter);
const { pool } = await import("../../src/db.js");
const app = process.env.GOALS_INTEGRATED === "1"
  ? await buildApp([(await import("../../integration/index.js")).createOrgMapIntegration(await (await import("../../integration/config.js")).loadIntegrationOptions())], {migrationMaxPrefix:999})
  : await buildApp([
  foundationDefaultAdmissionPolicy, // Explicit standalone QA only; integrated preview uses Administration.
  workModule,
  createGoalsModule({ resolveLink: createRegistryGoalLinkResolver(registry) }),
]);
await app.listen({ host: "127.0.0.1", port: 3008 });
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
