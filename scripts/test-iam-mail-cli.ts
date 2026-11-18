import pg from "pg";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
const base =
  process.env.MIGRATION_DATABASE_URL ??
  "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap";
const admin = new pg.Pool({ connectionString: base });
const name = "orgmap_mail_cli_test_" + randomBytes(8).toString("hex");
const migration = new URL(base);
migration.pathname = "/" + name;
const runtime = new URL(
  process.env.DATABASE_URL ??
    "postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap",
);
runtime.pathname = "/" + name;
try {
  await admin.query("CREATE DATABASE " + name);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MIGRATION_DATABASE_URL: migration.href,
    DATABASE_URL: runtime.href,
    MIGRATION_MAX_PREFIX: "999",
  };
  delete env.NODE_TEST_CONTEXT;
  for (const args of [
    ["server/src/migrate.ts"],
    ["--test", "tests/server/iam-mail-cli.test.ts"],
  ]) {
    const result = spawnSync(process.execPath, ["--import", "tsx", ...args], {
      env,
      stdio: "inherit",
    });
    if (result.status !== 0) throw Error("IAM_MAIL_CLI_TEST_FAILED");
  }
} finally {
  await admin.query("DROP DATABASE IF EXISTS " + name + " WITH (FORCE)");
  await admin.end();
}
