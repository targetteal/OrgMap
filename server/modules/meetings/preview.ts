// Local feature verification harness. Its database is disposable and never the shared OrgMap DB.
import pg from "pg";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
const source =
  process.env.MIGRATION_DATABASE_URL ??
  "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap";
const admin = new pg.Pool({ connectionString: source }),
  name = "orgmap_meetings_preview_" + randomBytes(6).toString("hex");
const migration = new URL(source);
migration.pathname = "/" + name;
const runtime = new URL(
  "postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap",
);
runtime.pathname = "/" + name;
await admin.query(`CREATE DATABASE "${name}"`);
try {
  await new Promise<void>((resolve, reject) => {
    const p = spawn(
      process.execPath,
      ["--import", "tsx", "server/src/migrate.ts"],
      {
        stdio: "inherit",
        env: { ...process.env, MIGRATION_DATABASE_URL: migration.href },
      },
    );
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(Error("Migrations failed")),
    );
    p.on("error", reject);
  });
  process.env.DATABASE_URL = runtime.href;
  process.env.ALLOWED_ORIGINS =
    process.env.MEETINGS_PREVIEW_ORIGIN ?? "http://meetings.localhost:5181";
  const { buildApp } = await import("../../src/app.js"),
    { pool } = await import("../../src/db.js"),
    { createMeetings } = await import("./plugin.js"),
    { createMeetingRuntimePorts } = await import("./guest.js");
  const { foundationDefaultAdmissionPolicy } =
    await import("../../src/admission.js");
  const app = await buildApp([
    foundationDefaultAdmissionPolicy,
    async (app, core) => {
      const ports = createMeetingRuntimePorts(core, {
        validateMembers: async (ctx, ids) =>
          (
            await ctx.c.query(
              "SELECT id FROM members WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND status='ACTIVE'",
              [ctx.org.id, ids],
            )
          ).rowCount === new Set(ids).size,
      });
      await createMeetings(ports)(app, core);
    },
  ]);
  const port = Number(process.env.MEETINGS_PREVIEW_PORT ?? 3081);
  await app.listen({ host: "127.0.0.1", port });
  console.log("Meetings disposable API ready on " + port);
  let shuttingDown = false;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      await app.close();
      await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.end();
      process.exit(0);
    });
} catch (error) {
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.end();
  throw error;
}
