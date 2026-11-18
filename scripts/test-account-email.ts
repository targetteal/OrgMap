import pg from "pg";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

const operatorSource = process.env.MIGRATION_DATABASE_URL ?? "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap";
const runtimeSource = process.env.DATABASE_URL ?? "postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap";
const operator = new URL(operatorSource), runtime = new URL(runtimeSource);
const loopback = ["127.0.0.1", "localhost", "[::1]"];
if (!loopback.includes(operator.hostname) || !loopback.includes(runtime.hostname) ||
  operator.protocol !== "postgres:" || runtime.protocol !== "postgres:")
  throw Error("LOCAL_DATABASE_REQUIRED");
// Validate both source endpoints before CREATE or any application query.
if (operator.host !== runtime.host || operator.pathname !== runtime.pathname)
  throw Error("MATCHING_LOCAL_DATABASE_SOURCES_REQUIRED");

const database = "orgmap_account_email_" + randomBytes(8).toString("hex");
if (!/^orgmap_account_email_[a-f0-9]{16}$/.test(database)) throw Error("EXCLUSIVE_ACCOUNT_EMAIL_DATABASE_REQUIRED");
const migrationUrl = new URL(operatorSource), runtimeUrl = new URL(runtimeSource);
migrationUrl.pathname = runtimeUrl.pathname = "/" + database;
const admin = new pg.Pool({ connectionString: operatorSource });
async function run(args: string[]) {
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  delete childEnv.MIGRATION_MAX_PREFIX;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", ...args], {
      stdio: "inherit", env: { ...childEnv, MIGRATION_DATABASE_URL: migrationUrl.href,
        DATABASE_URL: runtimeUrl.href, MIGRATION_SCOPE: "foundation" },
    });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(Error("ACCOUNT_EMAIL_TEST_FAILED")));
  });
}
let created = false;
try {
  await admin.query('CREATE DATABASE "' + database + '"');
  created = true;
  await run(["server/src/migrate.ts"]);
  await run(["--test", "--test-concurrency=1", "tests/server/account-email.test.ts"]);
  console.log("Account email exclusive PostgreSQL + real HTTP + TCP SMTP integration passed");
} finally {
  try {
    if (created) await admin.query('DROP DATABASE IF EXISTS "' + database + '" WITH (FORCE)');
  } finally { await admin.end(); }
}
