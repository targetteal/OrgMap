import pg from "pg";
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
const adminUrl =
  process.env.MIGRATION_DATABASE_URL ??
  "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap";
const admin = new pg.Pool({ connectionString: adminUrl });
let activeChild: ChildProcess | undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    activeChild?.kill(signal);
  });
const name =
  (process.argv.includes("--integration-proof")
    ? "orgmap_test_"
    : "orgmap_platform_") + randomBytes(8).toString("hex");
const dispatchRole = "platform_test_" + randomBytes(8).toString("hex"),
  dispatchPassword = randomBytes(24).toString("hex");
const dispatchUrl = new URL(adminUrl);
dispatchUrl.username = dispatchRole;
dispatchUrl.password = dispatchPassword;
dispatchUrl.pathname = "/" + name;
const migration = new URL(adminUrl);
migration.pathname = "/" + name;
const runtime = new URL(
  process.env.DATABASE_URL ??
    "postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap",
);
runtime.pathname = "/" + name;
const run = (args: string[]) =>
  new Promise<void>((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      MIGRATION_DATABASE_URL: migration.href,
      DATABASE_URL: runtime.href,
      PLATFORM_DISPATCH_DATABASE_URL: process.argv.includes("--global-fixture")
        ? ""
        : dispatchUrl.href,
      PLATFORM_ALL_MIGRATIONS: "1",
      PLATFORM_BACKUP_ISOLATED: process.argv.includes("--backup-only")
        ? "1"
        : "",
      PLATFORM_GUEST_DELIVERY_ISOLATED: process.argv.includes(
        "--guest-delivery-only",
      )
        ? "1"
        : "",
    };
    // This runner has always installed/replayed the complete schema. Parent
    // selection variables must not turn the official migrator into a slice.
    delete env.MIGRATION_SCOPE;
    delete env.MIGRATION_MAX_PREFIX;
    const p = spawn(process.execPath, ["--import", "tsx", ...args], {
      stdio: "inherit",
      env,
    });
    activeChild = p;
    p.on("error", reject);
    p.on("exit", (code) => {
      activeChild = undefined;
      code === 0 ? resolve() : reject(Error("Process exit " + code));
    });
  });
async function migrateSlice() {
  // Official ordering, immutable source checks and reviewed schema checkpoints
  // are required for bootstrap as well as the post-test checksum replay.
  await run(["server/src/migrate.ts"]);
}

try {
  await admin.query('CREATE DATABASE "' + name + '"');
  await migrateSlice();
  await admin.query(
    'CREATE ROLE "' +
      dispatchRole +
      '" LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD ' +
      "'" +
      dispatchPassword +
      "'",
  );
  await admin.query(
    'GRANT orgmap_platform_dispatcher TO "' + dispatchRole + '"',
  );
  await run(
    process.argv.includes("--preview") ||
      process.argv.includes("--preview-integrated")
      ? [
          "server/modules/platform/preview-server.ts",
          ...(process.argv.includes("--preview-integrated")
            ? ["--integrated"]
            : []),
        ]
      : process.argv.includes("--favorites-only")
        ? ["--test", "--test-name-pattern=platform real PostgreSQL: typed ACL|platform Guest wrapper intersects", "tests/server/platform.test.ts"]
      : process.argv.includes("--work-tabular-only")
        ? ["--test", "tests/server/platform-work-tabular.test.ts"]
        : process.argv.includes("--backup-only")
          ? [
              "--test",
              "--test-name-pattern=operator backup port",
              "tests/server/platform.test.ts",
            ]
          : process.argv.includes("--guest-delivery-only")
            ? [
                "--test",
                "--test-name-pattern=platform scoped Guest delivery worker",
                "tests/server/platform.test.ts",
              ]
            : [
                "--test",
                "tests/server/platform.test.ts",
                "tests/server/platform-localization.test.ts",
                "tests/server/platform-workbook.test.ts",
                "tests/server/platform-upload-policy.test.ts",
                "tests/server/platform-report-package.test.ts",
                "tests/server/platform-account-image.test.ts",
                ...(process.argv.includes("--all-migrations")
                  ? ["tests/server/platform-cli.test.ts"]
                  : []),
              ],
  );
  if (process.argv.includes("--integration-proof")) {
    if (!process.argv.includes("--all-migrations"))
      throw Error("Integration proof requires --all-migrations");
    await run([
      "--test",
      "--test-name-pattern=composed private export|root composition wires administrative read policy",
      "tests/server/integration.test.ts",
      "tests/server/meetings.integration.test.ts",
    ]);
  }
  await migrateSlice();
} finally {
  await admin.query('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)');
  await admin.query('DROP ROLE IF EXISTS "' + dispatchRole + '"');
  await admin.end();
}
