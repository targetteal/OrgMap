import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("real automatic CLI: separate process, real circle adapter and persisted crash/restart without browser", async () => {
  const source =
    process.env.MIGRATION_DATABASE_URL ??
    "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap";
  const runtimeSource =
    process.env.DATABASE_URL ??
    "postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap";
  const admin = new pg.Pool({ connectionString: source }),
    suffix = randomBytes(12).toString("hex"),
    database = "orgmap_platform_cli_" + suffix,
    role = "platform_cli_" + suffix,
    password = randomBytes(24).toString("hex");
  const migration = new URL(source);
  migration.pathname = "/" + database;
  const runtime = new URL(runtimeSource);
  runtime.pathname = "/" + database;
  const dispatch = new URL(migration);
  dispatch.username = role;
  dispatch.password = password;
  const blobs = await mkdtemp(join(tmpdir(), "orgmap-platform-cli-"));
  const env = {
    ...process.env,
    MIGRATION_DATABASE_URL: migration.href,
    DATABASE_URL: runtime.href,
    PLATFORM_DISPATCH_DATABASE_URL: dispatch.href,
    PLATFORM_BLOBS_DIRECTORY: blobs,
    MIGRATION_MAX_PREFIX: "999",
  };
  async function run(args: string[]) {
    return new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", ...args], {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (v) => {
        output += v.toString();
      });
      child.stderr.on("data", (v) => {
        output += v.toString();
      });
      // This proof starts five independent --once workers, each with its own
      // bounded 20-second exit guard. Under the complete suite, process startup
      // and database work can exceed the old 45-second aggregate deadline.
      const timeoutMs = args.includes("server/modules/platform/cli-proof.ts") ? 150000 : 45000;
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(Error("CLI proof timed out; child=" + child.pid + "; output=" + output));
      }, timeoutMs);
      child.once("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        code === 0
          ? resolve(output)
          : reject(Error("Proof command failed: " + output));
      });
    });
  }
  let created = false,
    roleCreated = false;
  try {
    await admin.query('CREATE DATABASE "' + database + '"');
    created = true;
    await run(["server/src/migrate.ts"]);
    await admin.query(
      'CREATE ROLE "' +
        role +
        '" LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD ' +
        "'" +
        password +
        "'",
    );
    roleCreated = true;
    await admin.query('GRANT orgmap_platform_dispatcher TO "' + role + '"');
    const output = await run(["server/modules/platform/cli-proof.ts"]);
    assert.match(output, /"jobsCompleted":2/);
    assert.match(output, /"browserRequired":false/);
    assert.match(output, /"schedulingAtomic":true/);
    assert.match(output, /"interopLocalHttpDelivered":2/);
    assert.match(output, /"futureRetryPreserved":true/);
    assert.match(output, /"importDestinationDiscovery":true/);
    await run(["server/src/migrate.ts"]);
  } finally {
    if (created)
      await admin.query('DROP DATABASE "' + database + '" WITH (FORCE)');
    if (roleCreated) await admin.query('DROP ROLE "' + role + '"');
    await admin.end();
    await rm(blobs, { recursive: true, force: true });
  }
});
