// Isolated DB runner, never migrates or resets shared development database.
import pg from "pg";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
const adminUrl =
  process.env.MIGRATION_DATABASE_URL ??
  "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap";
const admin = new pg.Pool({ connectionString: adminUrl });
const name = "orgmap_interop_" + randomBytes(8).toString("hex");
const migration = new URL(adminUrl);
migration.pathname = "/" + name;
const runtime = new URL(
  process.env.DATABASE_URL ??
    "postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap",
);
runtime.pathname = "/" + name;
async function run(args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", ...args], {
      stdio: "inherit",
      env: {
        ...process.env,
        MIGRATION_DATABASE_URL: migration.href,
        DATABASE_URL: runtime.href,
      },
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(Error("test exit " + code)),
    );
  });
}
try {
  await admin.query('CREATE DATABASE "' + name + '"');
  await run(["server/src/migrate.ts"]);
  const discovered = (await readdir("tests/server")).filter((x) => /^interoperability.*\.test\.ts$/.test(x));
  const selected = process.argv.slice(2);
  if (selected.some((name) => !discovered.includes(name))) throw Error("Unknown interoperability test file");
  await run(["--test", ...(selected.length ? selected : discovered).map((x) => "tests/server/" + x)]);
} finally {
  await admin.query('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)');
  await admin.end();
}
