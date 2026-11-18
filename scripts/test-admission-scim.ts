import pg from "pg";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

const operatorSource =
  process.env.MIGRATION_DATABASE_URL ??
  "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap";
const runtimeSource =
  process.env.DATABASE_URL ??
  "postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap";
const operator = new URL(operatorSource),
  runtime = new URL(runtimeSource);
const local = ["127.0.0.1", "localhost", "[::1]"];
if (
  !local.includes(operator.hostname) ||
  !local.includes(runtime.hostname) ||
  operator.protocol !== "postgres:" ||
  runtime.protocol !== "postgres:"
)
  throw Error("LOCAL_DATABASE_REQUIRED");
if (operator.host !== runtime.host || operator.pathname !== runtime.pathname)
  throw Error("MATCHING_LOCAL_DATABASE_SOURCES_REQUIRED");
const database = "orgmap_admission_scim_" + randomBytes(8).toString("hex");
const migrationUrl = new URL(operatorSource),
  runtimeUrl = new URL(runtimeSource);
migrationUrl.pathname = runtimeUrl.pathname = "/" + database;
const admin = new pg.Pool({ connectionString: operatorSource });
async function run(args: string[], prefix?: string) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MIGRATION_DATABASE_URL: migrationUrl.href,
    DATABASE_URL: runtimeUrl.href,
  };
  delete env.NODE_TEST_CONTEXT;
  delete env.MIGRATION_MAX_PREFIX;
  if (prefix) env.MIGRATION_MAX_PREFIX = prefix;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", ...args], {
      stdio: "inherit",
      env,
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(Error("ADMISSION_SCIM_TEST_FAILED")),
    );
  });
}
let created = false;
try {
  await admin.query('CREATE DATABASE "' + database + '"');
  created = true;
  // Prove the IAM prefix independently; the real SCIM/OIDC authority then needs
  // its module migrations too. The test never connects to the development DB.
  await run(["server/src/migrate.ts"], "19");
  await run(["server/src/migrate.ts"]);
  await run([
    "--test",
    "--test-concurrency=1",
    "tests/server/admission-scim.test.ts",
  ]);
  console.log("SCIM admission/provenance PostgreSQL integration passed");
} finally {
  try {
    if (created)
      await admin.query(
        'DROP DATABASE IF EXISTS "' + database + '" WITH (FORCE)',
      );
  } finally {
    await admin.end();
  }
}
