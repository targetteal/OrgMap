/** Focused proof of global-suite isolation; every SQL write targets our disposable DB. */
import pg from "pg";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
const url = new URL(
  process.env.MIGRATION_DATABASE_URL ??
    "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap",
);
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
  throw Error("LOCAL_DATABASE_REQUIRED");
const operator = new pg.Pool({ connectionString: url.href }),
  name = "orgmap_test_" + randomBytes(8).toString("hex");
const migration = new URL(url);
migration.pathname = "/" + name;
const runtime = new URL(
  process.env.DATABASE_URL ??
    "postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap",
);
runtime.pathname = "/" + name;
const env: NodeJS.ProcessEnv = {
  ...process.env,
  MIGRATION_DATABASE_URL: migration.href,
  DATABASE_URL: runtime.href,
  MIGRATION_MAX_PREFIX: "999",
};
delete env.IAM_MAIL_PROOF_CHILD;
delete env.NODE_TEST_CONTEXT;
async function run(args: string[]) {
  await new Promise<void>((yes, no) => {
    const child = spawn(process.execPath, ["--import", "tsx", ...args], {
      env,
      stdio: "inherit",
    });
    child.on("error", no);
    child.on("exit", (code) =>
      code === 0 ? yes() : no(Error("IAM_MAIL_PROOF_FAILED:" + code)),
    );
  });
}
async function guard(file: string, expected: string) {
  await new Promise<void>((yes, no) => {
    const child = spawn(process.execPath, ["--import", "tsx", "--test", file], {
      env: {
        ...process.env,
        DATABASE_URL: "postgres://invalid/orgmap",
        MIGRATION_DATABASE_URL: "postgres://invalid/orgmap",
        IAM_MAIL_PROOF_CHILD: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (b) => (output += b.toString()));
    child.stderr.on("data", (b) => (output += b.toString()));
    child.on("error", no);
    child.on("exit", (code) =>
      code !== 0 && output.includes(expected)
        ? yes()
        : no(Error("EXPECTED_EXCLUSIVE_DATABASE_GUARD:" + file)),
    );
  });
}
await guard(
  "tests/server/iam-mail.test.ts",
  "EXCLUSIVE_IAM_MAIL_PARENT_DATABASE_REQUIRED",
);
await guard(
  "tests/server/foundation.test.ts",
  "EXCLUSIVE_FOUNDATION_DATABASE_REQUIRED",
);
let fixture: pg.Pool | undefined;
try {
  await operator.query('CREATE DATABASE "' + name + '"');
  await run(["server/src/migrate.ts"]);
  fixture = new pg.Pool({ connectionString: migration.href });
  if (!/^orgmap_test_[a-f0-9]{16}$/.test(name))
    throw Error("EXCLUSIVE_PARENT_FIXTURE_REQUIRED");
  const account = randomUUID(),
    org = randomUUID(),
    recovery = randomUUID(),
    enrollment = randomUUID();
  await fixture.query(
    "INSERT INTO accounts(id,email,password_hash,display_name) VALUES($1,$2,'unused','Existing suite fixture')",
    [account, account + "@local.test"],
  );
  await fixture.query(
    "INSERT INTO organizations(id,name,locale,time_zone) VALUES($1,'Earlier tenant fixture','pt-BR','UTC')",
    [org],
  );
  await fixture.query(
    "INSERT INTO password_recovery(id,account_id,token_hash,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')",
    [recovery, account, randomUUID()],
  );
  await fixture.query(
    "INSERT INTO account_mail(id,account_id,recovery_id,email,token,state,next_attempt_at) VALUES($1,$2,$3,$4,'parent-test-token','FAILED',clock_timestamp()+interval '2 hours')",
    [randomUUID(), account, recovery, account + "@local.test"],
  );
  await fixture.query(
    "INSERT INTO provisioned_enrollments(organization_id,id,connection_id,external_id,user_name,email,display_name,issuer,claim_name,claim_value,mapping_revision,active,state,created_by) VALUES($1,$2,$3,'earlier-external','Earlier user','earlier@local.test','Earlier user','https://earlier.local','sub','earlier-sub',1,true,'PENDING_ENROLLMENT',$4)",
    [org, enrollment, randomUUID(), account],
  );
  await fixture.query(
    "INSERT INTO provisioned_enrollment_mail(organization_id,id,enrollment_id,enrollment_version,token) VALUES($1,$2,$3,1,'earlier-enrollment-token')",
    [org, randomUUID(), enrollment],
  );
  const state = async () => ({
    account: (await fixture!.query("SELECT * FROM account_mail ORDER BY id"))
      .rows,
    enrollment: (
      await fixture!.query(
        "SELECT * FROM provisioned_enrollment_mail ORDER BY id",
      )
    ).rows,
  });
  const before = await state();
  await run(["--test", "tests/server/iam-mail.test.ts"]);
  assert.deepEqual(await state(), before);
  console.log(
    JSON.stringify({
      parentQueuesUntouched: true,
      priorEnrollmentPreserved: true,
      isolatedDaemonFixtureRan: true,
      unsafeDatabaseGuardsPassed: true,
    }),
  );
} finally {
  await fixture?.end();
  await operator.query('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)');
  await operator.end();
}
