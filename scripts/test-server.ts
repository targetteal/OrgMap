import pg from "pg";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
const adminUrl =
  process.env.MIGRATION_DATABASE_URL ??
  "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap";
const admin = new pg.Pool({ connectionString: adminUrl });
const name = "orgmap_test_" + randomBytes(8).toString("hex");
const migration = new URL(adminUrl);
migration.pathname = "/" + name;
const runtimeSource = new URL(
  process.env.DATABASE_URL ??
    "postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap",
);
const runtime = new URL(runtimeSource);
runtime.pathname = "/" + name;
const meetingsGuest = [
  "server/modules/meetings/validate.ts",
  "tests/server/meetings.guest.test.ts",
  "tests/server/meetings.guest-composition.test.ts",
  "tests/server/meetings.agenda-port.test.ts",
  "tests/server/meetings.agenda-items.test.ts",
  "tests/server/meetings.artifacts.test.ts",
  "tests/server/meetings.statistics.test.ts",
  "tests/server/meetings.publication.test.ts",
];
const platformMain = [
  "server/modules/platform/test-runner.ts",
  "--all-migrations",
  "--global-fixture",
];
const isolatedFixtures: Record<string, string[]> = {
  "structure-definition.test.ts": ["server/modules/structure/test-isolated.ts", "--definition"],
  "structure-purpose-direct.test.ts": ["server/modules/structure/test-isolated.ts", "--definition"],
  "structure-purpose.test.ts": ["server/modules/structure/test-isolated.ts", "--definition"],
  "structure-guest-leadlink.test.ts": ["server/modules/structure/test-isolated.ts", "--definition"],
  "o2-meeting-panel.test.ts": ["scripts/test-o2-meeting-panel.ts"],
  "o2-package.test.ts": ["scripts/test-o2-package.ts"],
  "asynchronous-governance-journey.test.ts": ["server/integration/test-runner.ts", "--test-file=tests/server/asynchronous-governance-journey.test.ts"],
  "meeting-outcomes-http.test.ts": ["server/integration/test-runner.ts", "--test-file=tests/server/meeting-outcomes-http.test.ts"],
  "governance-document-archive.test.ts": ["server/integration/test-runner.ts", "--test-file=tests/server/governance-document-archive.test.ts"],
  "meetings.circle-filter.test.ts": ["server/integration/test-runner.ts", "--test-file=tests/server/meetings.circle-filter.test.ts"],
  "meeting-outcome-destinations.test.ts": ["server/integration/test-runner.ts", "--test-file=tests/server/meeting-outcome-destinations.test.ts"],
  "tension-work-project.test.ts": ["server/integration/test-runner.ts", "--test-file=tests/server/tension-work-project.test.ts"],
  "organization-deletion-http.test.ts": ["scripts/test-lifecycle-snapshot.ts", "organization-deletion-http"],
  "organization-deletion-operator-receipt.test.ts": ["scripts/test-lifecycle-snapshot.ts", "organization-deletion-operator-receipt"],
  "organization-deletion-runner.test.ts": ["scripts/test-lifecycle-snapshot.ts", "organization-deletion-runner"],
  "organization-deletion-readiness.test.ts": ["scripts/test-lifecycle-snapshot.ts", "organization-deletion-readiness"],
  "organization-deletion-reviewed-baseline.test.ts": ["scripts/test-lifecycle-snapshot.ts", "organization-deletion-reviewed-baseline"],
  "governance.test.ts": ["scripts/test-traceability-journey.ts", "--suite=governance"],
  "meeting-decision-journey.test.ts": ["scripts/test-traceability-journey.ts", "--suite=meeting"],
  "traceability-journey.test.ts": ["scripts/test-traceability-journey.ts", "--suite=journey"],
  "administration-platform-teardown.test.ts": ["scripts/test-lifecycle-snapshot.ts", "teardown"],
  "tenant-command-real.test.ts": ["scripts/test-lifecycle-snapshot.ts", "tenant-command-real"],
  "foundation-teardown.test.ts": ["scripts/test-lifecycle-snapshot.ts", "foundation"],
  "organization-deletion-composition.test.ts": ["scripts/test-lifecycle-snapshot.ts", "composition"],
  "organization-deletion-barrier.test.ts": ["scripts/test-lifecycle-snapshot.ts", "organization-deletion-barrier"],
  "interoperability-deletion-outcomes.test.ts": ["scripts/test-lifecycle-snapshot.ts", "interoperability-deletion-outcomes"],
  "organization-deletion-jobs.test.ts": ["scripts/test-lifecycle-snapshot.ts", "organization-deletion-jobs"],
  "organization-deletion-footprint-extra.test.ts": ["scripts/test-lifecycle-snapshot.ts", "organization-deletion-footprint-extra"],
  "organization-ledger-confirmation.test.ts": ["scripts/test-lifecycle-snapshot.ts", "organization-ledger-confirmation"],
  "organization-host-ops.test.ts": ["scripts/test-lifecycle-snapshot.ts", "organization-host-ops"],
  "organization-deletion-transitions.test.ts": ["scripts/test-lifecycle-snapshot.ts", "organization-deletion-transitions"],
  "organization-blob-removal.test.ts": ["scripts/test-lifecycle-snapshot.ts", "organization-blob-removal"],
  "organization-lifecycle.test.ts": ["scripts/test-lifecycle-snapshot.ts", "organization-lifecycle"],
  "lifecycle-dispatch-fences.test.ts": ["scripts/test-lifecycle-snapshot.ts", "lifecycle-dispatch-fences"],
  "lifecycle-iam-effects.test.ts": ["scripts/test-lifecycle-snapshot.ts", "lifecycle-iam-effects"],
  "administration-branding.test.ts": ["server/modules/administration/branding-test-runner.ts"],
  "administration-feed.test.ts": ["server/modules/administration/feed-test-runner.ts"],
  "administration-assistant.test.ts": ["server/modules/administration/assistant-test-runner.ts"],
  "branding-notification.test.ts": ["server/integration/test-runner.ts", "--test-file=tests/server/branding-notification.test.ts"],
  "notification-structure-governance.test.ts": ["server/integration/test-runner.ts", "--test-file=tests/server/notification-structure-governance.test.ts"],
  "notification-work-goals-meetings.test.ts": ["server/integration/test-runner.ts", "--test-file=tests/server/notification-work-goals-meetings.test.ts"],
  "branding-stages.test.ts": ["server/integration/test-runner.ts", "--test-file=tests/server/branding-stages.test.ts"],
  "organization-maintenance.test.ts": ["server/integration/test-runner.ts", "--test-file=tests/server/organization-maintenance.test.ts"],
  "foundation-migrations.test.ts": ["scripts/test-foundation-migrations.ts"],
  "account-email.test.ts": ["scripts/test-account-email.ts"],
  "account-media.test.ts": ["scripts/test-account-media.ts"],
  "admission-public.test.ts": ["scripts/test-admission-public.ts"],
  "admission-invitations.test.ts": ["scripts/test-admission-invitations.ts"],
  "admission-scim.test.ts": ["scripts/test-admission-scim.ts"],
  "admission-mail-cli.test.ts": ["scripts/test-admission-mail-cli.ts"],
  "mfa.test.ts": ["scripts/test-mfa.ts"],
  "credential-policy.test.ts": ["scripts/test-credential-policy.ts"],
  "ops-backup.test.ts": ["scripts/test-ops-backup.ts"],
  "foundation-collective.test.ts": ["scripts/test-foundation-collective.ts"],
  "iam-mail-cli.test.ts": ["scripts/test-iam-mail-cli.ts"],
  "guest-core.test.ts": ["scripts/test-guest-core.ts"],
  "meetings.guest.test.ts": meetingsGuest,
  "meetings.guest-composition.test.ts": meetingsGuest,
  "meetings.agenda-port.test.ts": meetingsGuest,
  "meetings.agenda-items.test.ts": meetingsGuest,
  "meetings.artifacts.test.ts": meetingsGuest,
  "meetings.statistics.test.ts": meetingsGuest,
  "meetings.publication.test.ts": meetingsGuest,
  "platform.test.ts": platformMain,
  "platform-localization.test.ts": platformMain,
  "platform-workbook.test.ts": platformMain,
  "platform-cli.test.ts": platformMain,
  "platform-work-tabular.test.ts": [
    "server/modules/platform/test-runner.ts",
    "--all-migrations",
    "--work-tabular-only",
  ],
  "integration.test.ts": ["server/integration/test-runner.ts"],
};
// Each complete owner group runs once, even when it replaces several shared files.
const isolatedCommands = [
  ...new Map(
    Object.values(isolatedFixtures).map((args) => [JSON.stringify(args), args]),
  ).values(),
];
const operatorSource = new URL(adminUrl);
if (
  [operatorSource, runtimeSource].some(
    (url) =>
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.protocol !== "postgres:",
  )
)
  throw Error("LOCAL_DATABASE_REQUIRED");
if (
  operatorSource.host !== runtimeSource.host ||
  operatorSource.pathname !== runtimeSource.pathname
)
  throw Error("MATCHING_LOCAL_DATABASE_SOURCES_REQUIRED");
async function run(args: string[], isolated = false) {
  const childEnv = { ...process.env };
  // Each isolated owner runner chooses its own schema. Integral runs must not
  // inherit a narrowed selection from the calling shell.
  delete childEnv.MIGRATION_SCOPE;
  delete childEnv.MIGRATION_MAX_PREFIX;
  await new Promise<void>((resolve, reject) => {
    const p = spawn(process.execPath, ["--import", "tsx", ...args], {
      stdio: "inherit",
      env: {
        ...childEnv,
        ORGMAP_PUBLIC_URL: "http://localhost:5173",
        MIGRATION_DATABASE_URL: isolated ? adminUrl : migration.href,
        ...(process.argv.includes("--foundation") && !isolated
          ? { MIGRATION_SCOPE: "foundation" }
          : {}),
        DATABASE_URL: isolated
          ? (process.env.DATABASE_URL ??
            "postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap")
          : runtime.href,
      },
    });
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(Error("Test process failed: " + code)),
    );
  });
}
let created = false;
try {
  const failures: unknown[] = [];
  const listOnly = process.argv.includes("--list-fixtures");
  if (listOnly)
    console.log(
      JSON.stringify(
        {
          excludedFromShared: Object.keys(isolatedFixtures),
          commands: isolatedCommands,
        },
        null,
        2,
      ),
    );
  if (!listOnly && !process.argv.includes("--isolated-fixtures")) {
    await admin.query('CREATE DATABASE "' + name + '"');
    created = true;
    await run(["server/src/migrate.ts"]);
    const tests = (await readdir("tests/server"))
      .filter(
        (x) =>
          x.endsWith(".test.ts") &&
          !isolatedFixtures[x] &&
          (!process.argv.includes("--foundation") ||
            x === "foundation.test.ts"),
      )
      .map((x) => "tests/server/" + x);
    try {
      await run(["--test", "--test-concurrency=1", ...tests]);
    } catch (error) {
      failures.push(error);
    }
  }
  if (!listOnly && !process.argv.includes("--foundation"))
    for (const args of isolatedCommands)
      try {
        await run(args, true);
      } catch (error) {
        failures.push(error);
      }
  if (failures.length)
    throw new AggregateError(failures, "Server test slices failed");
} finally {
  try {
    if (created)
      await admin.query('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)');
  } finally {
    await admin.end();
  }
}
