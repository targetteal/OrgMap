/** Isolated acceptance runner, excluding concurrently edited migrations of other contexts. */
import pg from "pg";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
const migration = new URL(
  process.env.MIGRATION_DATABASE_URL ??
    "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap",
);
const runtime = new URL(
  process.env.DATABASE_URL ??
    "postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap",
);
if (
  ![migration, runtime].every(
    (u) =>
      ["postgres:", "postgresql:"].includes(u.protocol) &&
      ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname),
  ) ||
  migration.hostname !== runtime.hostname ||
  (migration.port || "5432") !== (runtime.port || "5432") ||
  migration.pathname !== runtime.pathname ||
  migration.search !== runtime.search
)
  throw Error("Feed runner requires matching local PostgreSQL URLs");
const admin = new pg.Pool({ connectionString: migration.href });
const name = "orgmap_feed_test_" + randomUUID().replaceAll("-", "");
migration.pathname = "/" + name;
runtime.pathname = "/" + name;
let created = false;
try {
  await admin.query('CREATE DATABASE "' + name + '"');
  created = true;
  const db = new pg.Pool({ connectionString: migration.href });
  try {
    for (const file of (await readdir("server/migrations"))
      .filter((f) => /^(00\d|01\d|4[01]\d|42[0-4]|50\d|51\d)_.*\.sql$/.test(f))
      .sort())
      await db.query(await readFile("server/migrations/" + file, "utf8"));
  } finally {
    await db.end();
  }
  await new Promise<void>((resolve, reject) => {
    const p = spawn(
      process.execPath,
      ["--import", "tsx", "--test", "tests/server/administration-feed.test.ts"],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          DATABASE_URL: runtime.href,
          MIGRATION_DATABASE_URL: migration.href,
          ORGMAP_FEED_TEST_DATABASE: name,
        },
      },
    );
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(Error("Acceptance failed: " + code)),
    );
  });
} finally {
  if (created)
    await admin.query('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)');
  await admin.end();
}
