// Dedicated disposable database; never migrate/reset the shared development database.
import pg from "pg";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
const source =
  process.env.MIGRATION_DATABASE_URL ??
  "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap";
const admin = new pg.Pool({ connectionString: source }),
  name = "orgmap_meetings_test_" + randomBytes(8).toString("hex");
const migration = new URL(source);
migration.pathname = "/" + name;
const runtime = new URL(
  process.env.DATABASE_URL ??
    "postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap",
);
runtime.pathname = "/" + name;
async function run(args: string[], extraEnv: Record<string, string> = {}) {
  await new Promise<void>((resolve, reject) => {
    const p = spawn(process.execPath, ["--import", "tsx", ...args], {
      stdio: "inherit",
      env: {
        ...process.env,
        MIGRATION_DATABASE_URL: migration.href,
        DATABASE_URL: runtime.href,
        ...extraEnv,
      },
    });
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(Error("Validation failed: " + code)),
    );
  });
}
try {
  const selected = process.argv.slice(2);
  if (
    selected.some(
      (path) =>
        !/^tests\/server\/meetings(?:[.-][a-z-]+)?\.test\.ts$/.test(path),
    )
  )
    throw Error("Only owned meetings test files are accepted");
  await admin.query(`CREATE DATABASE "${name}"`);
  // The complete reviewed plan is atomic; a pre-review partial install cannot
  // be upgraded as an ordinary baseline. Historical migrations have dedicated tests.
  await run(["server/src/migrate.ts"], { MIGRATION_MAX_PREFIX: "999" });
  await run(["server/src/migrate.ts"], { MIGRATION_MAX_PREFIX: "999" });
  await run([
    "--test",
    ...(selected.length
      ? selected
      : [
          "tests/server/meetings.test.ts",
          "tests/server/meetings.integration.test.ts",
          "tests/server/meetings.oversight.test.ts",
          "tests/server/meetings.richtext.test.ts",
          "tests/server/meetings.publication.test.ts",
          "tests/server/meetings.agenda-port.test.ts",
          "tests/server/meetings.guest.test.ts",
          "tests/server/meetings.guest-composition.test.ts",
          "tests/server/meetings.agenda-items.test.ts",
          "tests/server/meetings.agenda-migration.test.ts",
          "tests/server/meetings.statistics.test.ts",
          "tests/server/meetings.exports.test.ts",
          "tests/server/meetings.regional.test.ts",
          "tests/server/meetings.artifacts.test.ts",
        ]),
  ]);
} finally {
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.end();
}
