import pg from "pg";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
const adminUrl =
  process.env.MIGRATION_DATABASE_URL ??
  "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap";
const admin = new pg.Pool({ connectionString: adminUrl });
const name = "orgmap_goals_" + randomBytes(6).toString("hex");
let failed = false;
try {
  await admin.query("CREATE DATABASE " + name);
  const migration = new URL(adminUrl);
  migration.pathname = "/" + name;
  const runtime = new URL(
    process.env.DATABASE_URL ??
      "postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap",
  );
  runtime.pathname = "/" + name;
  const env = {
    ...process.env,
    MIGRATION_DATABASE_URL: migration.href,
    DATABASE_URL: runtime.href,
  };
  const full = process.env.GOALS_INTEGRATED === "1";
  const latest = full
    ? "server/src/migrate.ts"
    : "server/modules/goals/migrate-slice.ts";
  for (const [cut, args] of [
    ["250", ["server/modules/goals/migrate-slice.ts"]],
    ["299", [latest]],
    ["299", [latest]],
    [
      "299",
      [
        "--test",
        "tests/server/goals.test.ts",
        "tests/server/goals.rich-text.test.ts",
        "tests/server/goals.localization.test.ts",
        "tests/server/goals.conflict-dom.test.tsx",
        "tests/server/goals.guest.test.ts",
        ...(full ? ["tests/server/integration.test.ts","tests/server/goals.integration.test.ts"] : []),
      ],
    ],
  ] as const) {
    const r = spawnSync(process.execPath, ["--import", "tsx", ...args], {
      env: { ...env, GOALS_MIGRATION_CUT: cut, ...(args[0] === "--test" ? {TSX_TSCONFIG_PATH:"web/tsconfig.json"} : {}) },
      stdio: "inherit",
    });
    if (r.status !== 0) {
      failed = true;
      break;
    }
  }
} finally {
  await admin.query("DROP DATABASE IF EXISTS " + name + " WITH (FORCE)");
  await admin.end();
}
if (failed) process.exitCode = 1;
