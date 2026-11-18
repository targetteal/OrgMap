import pg from "pg";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

const operatorSource =
  process.env.MIGRATION_DATABASE_URL ??
  "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap";
const runtimeSource =
  process.env.DATABASE_URL ??
  "postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap";
const operator = new URL(operatorSource);
const runtime = new URL(runtimeSource);
const allowedHosts = ["127.0.0.1", "localhost", "[::1]"];
if (
  !allowedHosts.includes(operator.hostname) ||
  !allowedHosts.includes(runtime.hostname) ||
  operator.protocol !== "postgres:" ||
  runtime.protocol !== "postgres:"
)
  throw Error("LOCAL_DATABASE_REQUIRED");

// Validate the source pair before creating a database or invoking migrations.
if (operator.host !== runtime.host || operator.pathname !== runtime.pathname)
  throw Error("MATCHING_LOCAL_DATABASE_SOURCES_REQUIRED");

const database = "orgmap_guest_core_" + randomBytes(8).toString("hex");
const migrationUrl = new URL(operatorSource);
const runtimeUrl = new URL(runtimeSource);
migrationUrl.pathname = runtimeUrl.pathname = "/" + database;
const admin = new pg.Pool({ connectionString: operatorSource });

async function run(args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", ...args], {
      stdio: "inherit",
      env: {
        ...process.env,
        MIGRATION_DATABASE_URL: migrationUrl.href,
        MIGRATION_MAX_PREFIX: undefined,
        MIGRATION_SCOPE: "foundation",
        DATABASE_URL: runtimeUrl.href,
      },
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(Error("GUEST_CORE_TEST_FAILED")),
    );
  });
}

let created = false;
try {
  await admin.query('CREATE DATABASE "' + database + '"');
  created = true;
  await run(["server/src/migrate.ts"]);
  await run(["--test", "--test-concurrency=1", "tests/server/guest-core.test.ts"]);
  console.log("guest core PostgreSQL integration passed");
} finally {
  try {
    if (created)
      await admin.query('DROP DATABASE IF EXISTS "' + database + '" WITH (FORCE)');
  } finally {
    await admin.end();
  }
}
