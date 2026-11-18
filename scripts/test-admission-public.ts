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
for (const url of [operator, runtime])
  if (
    url.protocol !== "postgres:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  )
    throw Error("LOCAL_DATABASE_REQUIRED");
if (operator.host !== runtime.host || operator.pathname !== runtime.pathname)
  throw Error("MATCHING_LOCAL_DATABASE_SOURCES_REQUIRED");
const database = "orgmap_admission_public_" + randomBytes(8).toString("hex");
const migrationUrl = new URL(operatorSource),
  runtimeUrl = new URL(runtimeSource);
migrationUrl.pathname = runtimeUrl.pathname = "/" + database;
const admin = new pg.Pool({ connectionString: operatorSource });
async function run(args: string[]) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", ...args], {
      stdio: "inherit",
      env: {
        ...env,
        MIGRATION_DATABASE_URL: migrationUrl.href,
        DATABASE_URL: runtimeUrl.href,
        MIGRATION_MAX_PREFIX: undefined,
        MIGRATION_SCOPE: "foundation",
      },
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(Error("PUBLIC_ADMISSION_TEST_FAILED")),
    );
  });
}
let created = false;
try {
  await admin.query('CREATE DATABASE "' + database + '"');
  created = true;
  await run(["server/src/migrate.ts"]);
  await run([
    "--test",
    "--test-concurrency=1",
    "tests/server/admission-public.test.ts",
  ]);
  console.log(
    "Public admission exclusive PostgreSQL + SMTP integration passed",
  );
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
