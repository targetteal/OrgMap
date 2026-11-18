import pg from "pg";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { createServer as createNetServer } from "node:net";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const evidence = resolve(".orgmap/qa/o2-panel");
await mkdir(evidence, { recursive: true });
const apiPort = 3066,
  webPort = 5216,
  origin = `http://127.0.0.1:${webPort}`;
// Fail before creating a database if either exclusively reserved preview port is busy.
await Promise.all(
  [apiPort, webPort].map(
    (port) =>
      new Promise<void>((resolve, reject) => {
        const probe = createNetServer();
        probe.once("error", reject);
        probe.listen(port, "127.0.0.1", () =>
          probe.close((error) => (error ? reject(error) : resolve())),
        );
      }),
  ),
);
const migrationSource =
  process.env.MIGRATION_DATABASE_URL ??
  "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap";
const runtimeSource =
  process.env.DATABASE_URL ??
  "postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap";
const migration = new URL(migrationSource),
  runtime = new URL(runtimeSource);
for (const source of [migration, runtime]) {
  if (
    !["postgres:", "postgresql:"].includes(source.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(source.hostname)
  )
    throw Error("LOCAL_DATABASE_REQUIRED");
}
if (migration.host !== runtime.host || migration.pathname !== runtime.pathname)
  throw Error("MATCHING_LOCAL_DATABASE_SOURCES_REQUIRED");
const database = "orgmap_o2panel_preview_" + randomBytes(8).toString("hex");
migration.pathname = runtime.pathname = "/" + database;
const admin = new pg.Pool({ connectionString: migrationSource });
const blobs = await mkdtemp(join(tmpdir(), "orgmap-o2-package-preview-"));
let app: import("fastify").FastifyInstance | undefined;
let vite: import("vite").ViteDevServer | undefined;
let runtimePool: pg.Pool | undefined;
let created = false,
  closing = false;
async function close(exitCode = 0) {
  if (closing) return;
  closing = true;
  try {
    await vite?.close();
    await app?.close();
    await runtimePool?.end();
    await rm(blobs, { recursive: true, force: true });
    if (created)
      await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await writeFile(
      join(evidence, "preview-cleanup.json"),
      JSON.stringify(
        {
          database,
          removed: created,
          workersStarted: false,
          mainDatabaseTouched: false,
          externalInvitationsSent: false,
        },
        null,
        2,
      ),
    );
  } finally {
    await admin.end();
    process.exit(exitCode);
  }
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => void close());
try {
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  await new Promise<void>((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      MIGRATION_DATABASE_URL: migration.href,
      DATABASE_URL: runtime.href,
      MIGRATION_MAX_PREFIX: "899",
    };
    delete env.MIGRATION_SCOPE;
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "server/src/migrate.ts"],
      { stdio: "inherit", env },
    );
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(Error("O2_PREVIEW_MIGRATION_FAILED")),
    );
  });
  const { supplementPanelFixture } =
    await import("../server/modules/meetings/o2-fixture-migrations.js");
  await supplementPanelFixture(migration.href);
  process.env.DATABASE_URL = runtime.href;
  process.env.ALLOWED_ORIGINS = origin;
  const { buildApp } = await import("../server/src/app.js");
  const { pool } = await import("../server/src/db.js");
  runtimePool = pool;
  const { createOrgMapIntegration } =
    await import("../server/integration/index.js");
  app = await buildApp([createOrgMapIntegration({ blobsDirectory: blobs })], {
    migrationMaxPrefix: 899,
  });
  const { seedO2Panel } =
    await import("../server/modules/meetings/o2-fixture.js");
  const seeded = await seedO2Panel(app, origin);
  const fixture = {
    database,
    origin,
    meetingId: seeded.meeting,
    organizationId: seeded.base.split("/").at(-1),
    accounts: [seeded.scribe, seeded.facilitator, seeded.guest].map(
      ({ email, password, memberId }) => ({ email, password, memberId }),
    ),
    workersStarted: false,
  };
  await writeFile(
    join(evidence, "preview-fixture.json"),
    JSON.stringify(fixture, null, 2),
    { mode: 0o600 },
  );
  const paths = [
    "server/integration/index.ts",
    "server/src/app.ts",
    "server/src/runtime.ts",
    "server/modules/structure/service.ts",
    "server/modules/structure/applier.ts",
    "server/modules/governance/service.ts",
    "server/modules/o2/package.ts",
    "server/modules/o2/contract.ts",
    "server/modules/o2/service.ts",
    "server/modules/o2/plugin.ts",
    "server/migrations/034_governance_model.sql",
    "server/migrations/050_o2_meeting_panel.sql",
    "web/src/features/registry.ts",
    "web/src/features/o2/index.tsx",
    "web/src/features/o2/types.ts",
    "web/src/features/o2/o2.css",
  ];
  const hashes: Record<string, string> = {};
  for (const path of paths) {
    try {
      hashes[path] = createHash("sha256")
        .update(await readFile(path))
        .digest("hex");
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  await writeFile(
    join(evidence, "preview-source-hashes-start.json"),
    JSON.stringify(hashes, null, 2),
  );
  const { createServer } = await import("vite");
  vite = await createServer({
    root: "web",
    configFile: false,
    cacheDir: resolve('.orgmap/qa/o2-panel/vite-cache'),
    server: {
      host: "127.0.0.1",
      port: webPort,
      strictPort: true,
      proxy: { "/api": { target: `http://127.0.0.1:${apiPort}`, ws: true } },
    },
  });
  await app.listen({ host: "127.0.0.1", port: apiPort });
  await vite.listen();
  console.log(
    JSON.stringify({
      previewReady: true,
      origin,
      apiPort,
      database,
      organizationId: fixture.organizationId,
      fixture: join(evidence, "preview-fixture.json"),
      phase: "PREPARATION",
      workersStarted: false,
    }),
  );
} catch (error) {
  console.error(error);
  await close(1);
}
