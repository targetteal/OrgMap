// Local feature verification harness. Its database is disposable and never the shared OrgMap DB.
import pg from "pg";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
const source =
  process.env.MIGRATION_DATABASE_URL ??
  "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap";
const admin = new pg.Pool({ connectionString: source }),
  name = "orgmap_meetings_lf_preview_" + randomBytes(6).toString("hex");
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
    process.env.MEETINGS_PREVIEW_ORIGIN ?? "http://lfmeetings.localhost:5185";
  const { buildApp } = await import("../../src/app.js"),
    { pool } = await import("../../src/db.js");
  const { createOrgMapIntegration } =
    await import("../../integration/index.js");
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { seedExportPreview } = await import("./lf-preview-seed.js");
  const blobsDirectory = await mkdtemp(join(tmpdir(), "orgmap-meetings-lf-"));
  const app = await buildApp([createOrgMapIntegration({ blobsDirectory })], {
    migrationMaxPrefix: 999,
  });
  const fixture = await seedExportPreview(app, process.env.ALLOWED_ORIGINS);
  await writeFile(
    "web/src/features/meetings/evidence/lf08-fixture.json",
    JSON.stringify({ ...fixture, database: name, disposed: false }, null, 2),
  );
  const worker = spawn(
    process.execPath,
    ["--import", "tsx", "server/modules/meetings/lf-worker.ts"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        PLATFORM_BLOBS_DIRECTORY: blobsDirectory,
        MEETINGS_PREVIEW_ORGANIZATION_ID: fixture.organizationId,
        MEETINGS_PREVIEW_MEMBER_ID: fixture.memberId,
      },
    },
  );
  const port = Number(process.env.MEETINGS_PREVIEW_PORT ?? 3085);
  await app.listen({ host: "127.0.0.1", port });
  console.log("Meetings disposable API ready on " + port);
  let shuttingDown = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      worker.kill(signal);
      await new Promise<void>((resolve) => {
        if (worker.exitCode !== null) resolve();
        else worker.once("exit", () => resolve());
      });
      await app.close();
      await pool.end();
      await rm(blobsDirectory, { recursive: true, force: true });
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.end();
      await writeFile(
        "web/src/features/meetings/evidence/lf08-fixture.json",
        JSON.stringify({ ...fixture, database: name, disposed: true }, null, 2),
      );
      process.exit(0);
    });
} catch (error) {
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.end();
  throw error;
}
