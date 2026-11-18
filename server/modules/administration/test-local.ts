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
const admin = new pg.Pool({ connectionString: migration.href });
const name = "orgmap_admin_test_" + randomUUID().replaceAll("-", "");
migration.pathname = "/" + name;
runtime.pathname = "/" + name;
try {
  await admin.query('CREATE DATABASE "' + name + '"');
  const db = new pg.Pool({ connectionString: migration.href });
  try {
    for (const file of (await readdir("server/migrations"))
      .filter(
        (f) =>
          /^(00\d|01\d|4[01]\d|42[0-4]|50\d|51\d)_.*\.sql$/.test(f) ||
          (process.env.ADMINISTRATION_INCLUDE_PLATFORM === "1" &&
            /^(425|438)_.*\.sql$/.test(f)),
      )
      .sort())
      await db.query(await readFile("server/migrations/" + file, "utf8"));
  } finally {
    await db.end();
  }
  await new Promise<void>((resolve, reject) => {
    const p = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "--test",
        ...(process.env.ADMINISTRATION_TEST_NAME_PATTERN
          ? [
              "--test-name-pattern=" +
                process.env.ADMINISTRATION_TEST_NAME_PATTERN,
            ]
          : []),
        "tests/server/administration.test.ts",
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          DATABASE_URL: runtime.href,
          MIGRATION_DATABASE_URL: migration.href,
        },
      },
    );
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(Error("Acceptance failed: " + code)),
    );
  });
} finally {
  await admin.query('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)');
  await admin.end();
}
