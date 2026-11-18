import pg from "pg";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";

// Only this disposable database is migrated. No delivery worker is started.
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
const database = "orgmap_o2panel_" + randomUUID().replaceAll("-", "");
migration.pathname = runtime.pathname = "/" + database;
const admin = new pg.Pool({ connectionString: migrationSource });
const evidence = resolvePath(".orgmap/qa/o2-panel");
await mkdir(evidence, { recursive: true });
let child: ChildProcess | undefined,
  interrupted = false,
  created = false;
let escalation: ReturnType<typeof setTimeout> | undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    interrupted = true;
    if (child?.pid) {
      const pid = child.pid;
      try {
        process.kill(-pid, signal);
      } catch (e: any) {
        if (e.code !== "ESRCH") throw e;
      }
      escalation ??= setTimeout(() => {
        try {
          process.kill(-pid, "SIGKILL");
        } catch (e: any) {
          if (e.code !== "ESRCH") throw e;
        }
      }, 5_000);
    }
  });
async function run(args: string[], capture?: string) {
  if (interrupted) throw Error("O2_PACKAGE_TEST_INTERRUPTED");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MIGRATION_DATABASE_URL: migration.href,
    DATABASE_URL: runtime.href,
    O2_PACKAGE_TEST_DATABASE: database,
  };
  delete env.MIGRATION_SCOPE;
  delete env.MIGRATION_MAX_PREFIX;
  let output = "";
  await new Promise<void>((resolve, reject) => {
    child = spawn(process.execPath, ["--import", "tsx", ...args], {
      cwd: process.cwd(),
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (chunk: Buffer) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      output += chunk;
      process.stderr.write(chunk);
    });
    child.once("error", reject);
    child.once("close", async (code) => {
      if (escalation) clearTimeout(escalation);
      escalation = undefined;
      child = undefined;
      try {
        if (capture) await writeFile(resolvePath(evidence, capture), output);
        code === 0 && !interrupted
          ? resolve()
          : reject(Error(`O2 package command exited ${code}`));
      } catch (error) {
        reject(error);
      }
    });
  });
}
try {
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  await run(["server/src/migrate.ts"]);
  const namePattern = process.argv
    .slice(2)
    .filter((value) => value.startsWith("--test-name-pattern="));
  await run(
    [
      "--test",
      "--test-concurrency=1",
      ...namePattern,
      "tests/server/o2-meeting-panel.test.ts",
    ],
    "backend.tap",
  );
} finally {
  try {
    if (created)
      await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await writeFile(
      resolvePath(evidence, "backend-cleanup.json"),
      JSON.stringify(
        {
          database,
          removed: created,
          mainDatabaseTouched: false,
          workersStarted: false,
          externalInvitationsSent: false,
          migrationScope: "all",
        },
        null,
        2,
      ),
    );
  } finally {
    await admin.end();
  }
}
