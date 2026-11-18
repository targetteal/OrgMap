import pg from "pg";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

const operatorSource = new URL(
  process.env.MIGRATION_DATABASE_URL ??
    "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap",
);
const runtimeSource = new URL(
  process.env.DATABASE_URL ??
    "postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap",
);
// Validate both original sources before creating a Pool or issuing any SQL.
if (
  [operatorSource, runtimeSource].some(
    (url) =>
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      !["postgres:", "postgresql:"].includes(url.protocol),
  )
)
  throw Error("LOCAL_DATABASE_REQUIRED");
if (
  operatorSource.host !== runtimeSource.host ||
  operatorSource.pathname !== runtimeSource.pathname
)
  throw Error("MATCHING_LOCAL_DATABASE_SOURCES_REQUIRED");

const prefix = `orgmap_foundation_migrations_${randomBytes(8).toString("hex")}`;
const databases = [prefix + "_clean", prefix + "_upgrade"];
const fixtureUrl = (source: URL, database: string) => {
  const url = new URL(source);
  url.pathname = "/" + database;
  return url.href;
};
const childEnv = { ...process.env };
delete childEnv.MIGRATION_SCOPE;
delete childEnv.MIGRATION_MAX_PREFIX;
delete childEnv.NODE_TEST_CONTEXT;
const admin = new pg.Pool({ connectionString: operatorSource.href });
const created: string[] = [];
try {
  for (const database of databases) {
    await admin.query('CREATE DATABASE "' + database + '"');
    created.push(database);
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "--test",
        "--test-concurrency=1",
        "tests/server/foundation-migrations.test.ts",
      ],
      {
        stdio: "inherit",
        env: {
          ...childEnv,
          MIGRATION_DATABASE_URL: fixtureUrl(operatorSource, databases[0]),
          DATABASE_URL: fixtureUrl(runtimeSource, databases[0]),
          FOUNDATION_MIGRATIONS_UPGRADE_MIGRATION_URL: fixtureUrl(
            operatorSource,
            databases[1],
          ),
          FOUNDATION_MIGRATIONS_UPGRADE_DATABASE_URL: fixtureUrl(
            runtimeSource,
            databases[1],
          ),
        },
      },
    );
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(Error("FOUNDATION_MIGRATIONS_TEST_FAILED: " + code)),
    );
  });
  console.log("foundation migration checks passed");
} finally {
  const cleanupErrors: unknown[] = [];
  try {
    for (const database of created.reverse())
      try {
        await admin.query(
          'DROP DATABASE IF EXISTS "' + database + '" WITH (FORCE)',
        );
      } catch (error) {
        cleanupErrors.push(error);
      }
  } finally {
    await admin.end();
  }
  if (cleanupErrors.length)
    throw new AggregateError(
      cleanupErrors,
      "FOUNDATION_MIGRATIONS_CLEANUP_FAILED",
    );
  console.log("foundation migration fixtures removed: " + created.join(", "));
}
