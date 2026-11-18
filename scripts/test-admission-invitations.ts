import pg from "pg";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

const migrationSource =
  process.env.MIGRATION_DATABASE_URL ??
  "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap";
const runtimeSource =
  process.env.DATABASE_URL ??
  "postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap";
const operator = new URL(migrationSource),
  runtime = new URL(runtimeSource);
if (
  ![operator, runtime].every(
    (u) =>
      u.protocol === "postgres:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname),
  )
)
  throw Error("LOCAL_DATABASE_REQUIRED");
if (operator.host !== runtime.host || operator.pathname !== runtime.pathname)
  throw Error("MATCHING_LOCAL_DATABASE_SOURCES_REQUIRED");
const name = "orgmap_admission_invites_" + randomBytes(8).toString("hex");
const migration = new URL(migrationSource),
  app = new URL(runtimeSource);
migration.pathname = app.pathname = "/" + name;
const admin = new pg.Pool({ connectionString: migrationSource });
async function run(args: string[], guard = false) {
  await new Promise<void>((yes, no) => {
    const child = spawn(process.execPath, ["--import", "tsx", ...args], {
      env: {
        ...process.env,
        MIGRATION_DATABASE_URL: guard ? "postgres://invalid/" : migration.href,
        DATABASE_URL: guard ? "postgres://invalid/" : app.href,
        MIGRATION_MAX_PREFIX: undefined,
        MIGRATION_SCOPE: "foundation",
      },
      stdio: guard ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let output = "";
    if (guard) {
      child.stdout!.on("data", (value) => (output += value.toString()));
      child.stderr!.on("data", (value) => (output += value.toString()));
    }
    child.once("error", no);
    child.once("exit", (code) => {
      if (
        guard
          ? code !== 0 &&
            output.includes("EXCLUSIVE_ADMISSION_INVITATIONS_DATABASE_REQUIRED")
          : code === 0
      )
        yes();
      else
        no(
          Error(
            guard
              ? "EXCLUSIVE_GUARD_PROOF_FAILED"
              : "ADMISSION_INVITATIONS_TEST_FAILED",
          ),
        );
    });
  });
}
let created = false;
try {
  await run(["--test", "tests/server/admission-invitations.test.ts"], true);
  await admin.query('CREATE DATABASE "' + name + '"');
  created = true;
  await run(["server/src/migrate.ts"]);
  await run([
    "--test",
    "--test-concurrency=1",
    "tests/server/admission-invitations.test.ts",
  ]);
  console.log(
    "admission invitations: isolated PostgreSQL routes, policy, rollback and session barrier passed",
  );
} finally {
  try {
    if (created)
      await admin.query('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)');
  } finally {
    await admin.end();
  }
}
