import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import pg from "pg";
import {
  migrationSelectionFromEnvironment,
  selectMigrationNames,
  validateMigrationSelection,
  type MigrationSelection,
} from "../../server/src/migration-selection.js";

// No app import or SQL is allowed until both exclusive fixture pairs pass.
const cleanOperator = new URL(
  process.env.MIGRATION_DATABASE_URL ?? "postgres://invalid/",
);
const cleanRuntime = new URL(process.env.DATABASE_URL ?? "postgres://invalid/");
const upgradeOperator = new URL(
  process.env.FOUNDATION_MIGRATIONS_UPGRADE_MIGRATION_URL ??
    "postgres://invalid/",
);
const upgradeRuntime = new URL(
  process.env.FOUNDATION_MIGRATIONS_UPGRADE_DATABASE_URL ??
    "postgres://invalid/",
);
const cleanMatch = /^\/orgmap_foundation_migrations_([a-f0-9]{16})_clean$/.exec(
  cleanRuntime.pathname,
);
if (
  !cleanMatch ||
  upgradeRuntime.pathname !==
    `/orgmap_foundation_migrations_${cleanMatch[1]}_upgrade` ||
  [cleanOperator, cleanRuntime, upgradeOperator, upgradeRuntime].some(
    (url) =>
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      url.host !== cleanRuntime.host,
  ) ||
  cleanOperator.pathname !== cleanRuntime.pathname ||
  upgradeOperator.pathname !== upgradeRuntime.pathname
)
  throw Error("EXCLUSIVE_FOUNDATION_MIGRATIONS_DATABASES_REQUIRED");

function sanitizedEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.MIGRATION_SCOPE;
  delete env.MIGRATION_MAX_PREFIX;
  // A process spawned by node:test must not inherit its worker protocol.
  delete env.NODE_TEST_CONTEXT;
  return { ...env, ...extra };
}
async function child(args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; output: string }>(
    (resolve, reject) => {
      const processChild = spawn(
        process.execPath,
        ["--import", "tsx", ...args],
        {
          env: sanitizedEnv(env),
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 60_000,
        },
      );
      let output = "";
      processChild.stdout.on("data", (part) => {
        output += part;
      });
      processChild.stderr.on("data", (part) => {
        output += part;
      });
      processChild.once("error", reject);
      processChild.once("close", (code) => resolve({ code, output }));
    },
  );
}
function fixtureEnv(operator: URL, runtime: URL): NodeJS.ProcessEnv {
  return {
    MIGRATION_DATABASE_URL: operator.href,
    DATABASE_URL: runtime.href,
  };
}
async function migrate(
  operator: URL,
  runtime: URL,
  selector: NodeJS.ProcessEnv,
) {
  return child(["server/src/migrate.ts"], {
    ...fixtureEnv(operator, runtime),
    ...selector,
  });
}
async function manifest() {
  const names = selectMigrationNames(
    await readdir(new URL("../../server/migrations/", import.meta.url)),
    { scope: "foundation" },
  );
  return Promise.all(
    names.map(async (name) => ({
      name,
      checksum: createHash("sha256")
        .update(
          await readFile(
            new URL("../../server/migrations/" + name, import.meta.url),
          ),
        )
        .digest("hex"),
    })),
  );
}
const probeSource = String.raw`
const { buildApp } = await import("./server/src/app.ts");
const { pool } = await import("./server/src/db.ts");
const { randomUUID } = await import("node:crypto");
const explicitAll = process.env.FOUNDATION_MIGRATIONS_PROBE_ALL === "1";
const functional = process.env.FOUNDATION_MIGRATIONS_PROBE_FUNCTIONAL === "1";
let app;
try {
  app = await buildApp([], explicitAll ? { migrationMaxPrefix: 999 } : {});
  await app.ready();
  const ready = await app.inject({ method: "GET", url: "/api/ready" });
  const result = { statusCode: ready.statusCode, readiness: ready.json() };
  if (functional) {
    const origin = "http://foundation-migrations.localhost";
    const registered = await app.inject({
      method: "POST", url: "/api/v1/auth/register", headers: { origin },
      payload: { email: randomUUID()+"@example.test", password: "Synthetic-"+randomUUID(), displayName: "Migration fixture" },
    });
    result.registration = { statusCode: registered.statusCode, body: registered.json() };
    if (registered.statusCode === 201) {
      const cookie = registered.cookies.find(x => x.name === "orgmap_session");
      const headers = { origin, cookie: "orgmap_session="+cookie.value, "x-csrf-token": registered.json().data.csrfToken, "idempotency-key": randomUUID() };
      const media = await app.inject({ method: "GET", url: "/api/v1/account/media", headers });
      result.media = { statusCode: media.statusCode, body: media.json() };
      const organization = await app.inject({ method: "POST", url: "/api/v1/organizations", headers, payload: { name: "Foundation migration fixture" } });
      result.organization = { statusCode: organization.statusCode, body: organization.json() };
      if (organization.statusCode === 201) {
        const bootstrap = await app.inject({ method: "GET", url: "/api/v1/organizations/"+organization.json().data.organization.id+"/bootstrap", headers });
        result.bootstrap = { statusCode: bootstrap.statusCode, body: bootstrap.json() };
      }
    }
  }
  console.log("FOUNDATION_MIGRATIONS_PROBE:"+JSON.stringify(result));
} finally {
  if (app) await app.close();
  await pool.end();
}
`;
async function probe(
  operator: URL,
  runtime: URL,
  options: { all?: boolean; functional?: boolean } = {},
) {
  const result = await child(["--input-type=module", "--eval", probeSource], {
    ...fixtureEnv(operator, runtime),
    ALLOWED_ORIGINS: "http://foundation-migrations.localhost",
    // Explicit buildApp max 999 must remain full even under this environment.
    MIGRATION_SCOPE: "foundation",
    FOUNDATION_MIGRATIONS_PROBE_ALL: options.all ? "1" : "0",
    FOUNDATION_MIGRATIONS_PROBE_FUNCTIONAL: options.functional ? "1" : "0",
  });
  assert.equal(result.code, 0, result.output);
  const line = result.output
    .split("\n")
    .find((x) => x.startsWith("FOUNDATION_MIGRATIONS_PROBE:"));
  assert.ok(line, result.output);
  return JSON.parse(line.slice("FOUNDATION_MIGRATIONS_PROBE:".length));
}

async function verifyCredentialInputRevision(runtime: pg.Pool) {
  const client = await runtime.connect();
  const accountId = randomUUID();
  const projection =
    "credential_policy_input_revision::int AS input_revision,credential_revision::int AS credential_revision,credential_changed_at::text AS credential_changed_at";
  try {
    await client.query("BEGIN");
    const initial = (
      await client.query(
        "INSERT INTO accounts(id,email,display_name,password_hash,credential_changed_at) VALUES($1,$2,'Input fixture','synthetic-migration-fixture',$3) RETURNING " +
          projection,
        [accountId, `${accountId}@example.test`, "2001-02-03T04:05:06Z"],
      )
    ).rows[0];
    assert.equal(
      initial.input_revision,
      1,
      "new accounts start at input revision 1",
    );
    assert.equal(initial.credential_revision, 1);
    const update = async (change: string, values: unknown[] = []) =>
      (
        await client.query(
          `UPDATE accounts SET ${change} WHERE id=$1 RETURNING ${projection}`,
          [accountId, ...values],
        )
      ).rows[0];
    const personalChange = (row: typeof initial, expectedInput: number) => {
      assert.equal(row.input_revision, expectedInput);
      assert.equal(row.credential_revision, initial.credential_revision);
      assert.equal(row.credential_changed_at, initial.credential_changed_at);
    };
    personalChange(
      await update("version=version+1,credential_policy_input_revision=999"),
      1,
    );
    personalChange(await update("display_name=display_name,email=email"), 1);
    personalChange(
      await update(
        "display_name=$2,credential_changed_at=clock_timestamp(),credential_revision=999",
        ["Changed input fixture"],
      ),
      2,
    );
    personalChange(
      await update("email=$2", [`changed-${accountId}@example.test`]),
      3,
    );
    personalChange(
      await update("display_name=$2,email=$3", [
        "Both personal inputs changed",
        `both-${accountId}@example.test`,
      ]),
      4,
    );
    const passwordChange = await update("password_hash=$2", [
      "different-synthetic-migration-fixture",
    ]);
    assert.equal(
      passwordChange.input_revision,
      4,
      "password changes are not personal input changes",
    );
    assert.equal(passwordChange.credential_revision, 2);
    assert.notEqual(
      passwordChange.credential_changed_at,
      initial.credential_changed_at,
    );
  } finally {
    try {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  }
}

test("foundation selection includes the complete 500–519 IAM range and leaves numeric cuts literal", () => {
  const iam = Array.from(
    { length: 20 },
    (_, index) => `${500 + index}_iam.sql`,
  );
  const core = ["000_core.sql", "001_core.sql", "019_core.sql"];
  const domains = [
    "020_domain.sql",
    "100_domain.sql",
    "499_domain.sql",
    "520_domain.sql",
    "999_domain.sql",
  ];
  const names = [
    ...domains,
    ...iam.slice().reverse(),
    ...core,
    "invalid.sql",
    "500-IAM.sql",
    "1000_future.sql",
  ];
  assert.deepEqual(selectMigrationNames(names, { scope: "foundation" }), [
    ...core,
    ...iam,
  ]);
  assert.deepEqual(selectMigrationNames(names, { maxPrefix: 19 }), core);
  const full = [...core, ...domains, ...iam].sort();
  assert.deepEqual(selectMigrationNames(names, { scope: "all" }), full);
  assert.deepEqual(selectMigrationNames(names, { maxPrefix: 999 }), full);
  assert.deepEqual(migrationSelectionFromEnvironment({}), { scope: "all" });
  assert.deepEqual(
    migrationSelectionFromEnvironment({ MIGRATION_SCOPE: "foundation" }),
    { scope: "foundation" },
  );
  assert.deepEqual(
    migrationSelectionFromEnvironment({ MIGRATION_MAX_PREFIX: "019" }),
    { maxPrefix: 19 },
  );
});

test("invalid scopes, numeric cuts, and conflicting selectors are rejected", () => {
  for (const scope of ["", "Foundation", "core", "all "])
    assert.throws(
      () => migrationSelectionFromEnvironment({ MIGRATION_SCOPE: scope }),
      /INVALID_MIGRATION_SCOPE/,
    );
  for (const maxPrefix of ["", "-1", "1000", "19.0", " 19", "19 ", "NaN"])
    assert.throws(
      () =>
        migrationSelectionFromEnvironment({ MIGRATION_MAX_PREFIX: maxPrefix }),
      /INVALID_MIGRATION_MAX_PREFIX/,
    );
  for (const maxPrefix of [
    -1,
    1000,
    19.1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    undefined,
  ])
    assert.throws(
      () => validateMigrationSelection({ maxPrefix } as MigrationSelection),
      /INVALID_MIGRATION_MAX_PREFIX/,
    );
  assert.throws(
    () =>
      validateMigrationSelection({
        scope: "core",
      } as unknown as MigrationSelection),
    /INVALID_MIGRATION_SCOPE/,
  );
  assert.throws(
    () =>
      validateMigrationSelection({
        scope: "foundation",
        maxPrefix: 19,
      } as unknown as MigrationSelection),
    /MIGRATION_SELECTION_CONFLICT/,
  );
  assert.throws(
    () =>
      migrationSelectionFromEnvironment({
        MIGRATION_SCOPE: "foundation",
        MIGRATION_MAX_PREFIX: "19",
      }),
    /MIGRATION_SELECTION_CONFLICT/,
  );
});

test("migrate rejects invalid and conflicting selection before any database connection", async () => {
  for (const [selector, expected] of [
    [
      { MIGRATION_SCOPE: "foundation", MIGRATION_MAX_PREFIX: "19" },
      "MIGRATION_SELECTION_CONFLICT",
    ],
    [{ MIGRATION_SCOPE: "core" }, "INVALID_MIGRATION_SCOPE"],
    [{ MIGRATION_MAX_PREFIX: "1000" }, "INVALID_MIGRATION_MAX_PREFIX"],
  ] as const) {
    const result = await child(["server/src/migrate.ts"], {
      MIGRATION_DATABASE_URL:
        "postgres://unreachable:invalid@127.0.0.1:1/invalid",
      ...selector,
    });
    assert.notEqual(result.code, 0, result.output);
    assert.ok(result.output.includes(expected), result.output);
    assert.doesNotMatch(
      result.output,
      /ECONNREFUSED|ENOTFOUND|connect ECONN|password authentication failed/,
    );
  }
});

test("the exclusive runner rejects unsafe or mismatched sources before SQL", async () => {
  for (const [env, expected] of [
    [
      {
        MIGRATION_DATABASE_URL:
          "postgres://unreachable:invalid@127.0.0.1:1/source_a",
        DATABASE_URL: "postgres://unreachable:invalid@127.0.0.1:1/source_b",
      },
      "MATCHING_LOCAL_DATABASE_SOURCES_REQUIRED",
    ],
    [
      {
        MIGRATION_DATABASE_URL:
          "postgres://unreachable:invalid@127.0.0.1:1/source_a",
        DATABASE_URL:
          "postgres://unreachable:invalid@remote.invalid:1/source_a",
      },
      "LOCAL_DATABASE_REQUIRED",
    ],
  ] as const) {
    const result = await child(["scripts/test-foundation-migrations.ts"], env);
    assert.notEqual(result.code, 0, result.output);
    assert.ok(result.output.includes(expected), result.output);
    assert.doesNotMatch(
      result.output,
      /ECONNREFUSED|ENOTFOUND|connect ECONN|password authentication failed/,
    );
  }
});

test("clean and upgraded foundation databases agree, serve current core, and fail closed on checksum corruption", async () => {
  const expected = await manifest();
  assert.ok(
    expected.some((x) => Number(x.name.slice(0, 3)) >= 500),
    "latest IAM migration is required",
  );
  const clean = new pg.Pool({ connectionString: cleanOperator.href });
  const upgrade = new pg.Pool({ connectionString: upgradeOperator.href });
  const runtimePools = [cleanRuntime, upgradeRuntime].map(
    (url) => new pg.Pool({ connectionString: url.href }),
  );
  try {
    let result = await migrate(cleanOperator, cleanRuntime, {
      MIGRATION_SCOPE: "foundation",
    });
    assert.equal(result.code, 0, result.output);
    result = await migrate(upgradeOperator, upgradeRuntime, {
      MIGRATION_MAX_PREFIX: "19",
    });
    assert.equal(result.code, 0, result.output);
    const historical = (
      await upgrade.query(
        "SELECT name,checksum FROM schema_migrations ORDER BY name",
      )
    ).rows;
    assert.deepEqual(
      historical,
      expected.filter((x) => Number(x.name.slice(0, 3)) <= 19),
    );
    assert.ok(historical.every((x) => Number(x.name.slice(0, 3)) < 500));
    assert.equal(
      (
        await upgrade.query(
          "SELECT to_regclass('public.account_email_change_requests') AS relation",
        )
      ).rows[0].relation,
      null,
    );
    result = await migrate(upgradeOperator, upgradeRuntime, {
      MIGRATION_SCOPE: "foundation",
    });
    assert.equal(result.code, 0, result.output);
    const appliedClean = (
      await clean.query(
        "SELECT name,checksum FROM schema_migrations ORDER BY name",
      )
    ).rows;
    const appliedUpgrade = (
      await upgrade.query(
        "SELECT name,checksum FROM schema_migrations ORDER BY name",
      )
    ).rows;
    assert.deepEqual(appliedClean, expected);
    assert.deepEqual(appliedUpgrade, appliedClean);
    for (const runtime of runtimePools) {
      await runtime.query(
        "SELECT id,email_revision,credential_policy_input_revision FROM accounts LIMIT 0; SELECT id FROM organizations LIMIT 0; SELECT id,node_id,parent_id,version FROM entities LIMIT 0; SELECT id FROM members LIMIT 0; SELECT id FROM sessions LIMIT 0; SELECT id,initiating_session_id,completion_session_id FROM account_email_change_requests LIMIT 0; SELECT email_revision FROM password_recovery LIMIT 0; SELECT email_revision FROM admission_requests LIMIT 0; SELECT email_revision FROM provisioned_enrollment_reauth LIMIT 0; SELECT email_revision,credential_policy_input_revision FROM credential_attestations LIMIT 0; SELECT account_id,kind,version,state FROM account_media LIMIT 0; SELECT id FROM account_media_gc LIMIT 0",
      );
      await verifyCredentialInputRevision(runtime);
      const domainTables = [
        "structure_role_settings",
        "gov_proposals",
        "work_tasks",
        "goals",
        "meeting_series",
        "administration_settings",
        "platform_comments",
        "interop_connections",
      ];
      const tables = await runtime.query(
        "SELECT name,to_regclass('public.' || name)::text AS relation FROM unnest($1::text[]) AS name ORDER BY name",
        [domainTables],
      );
      assert.ok(
        tables.rows.every((x) => x.relation === null),
        JSON.stringify(tables.rows),
      );
    }
    for (const [operator, runtime] of [
      [cleanOperator, cleanRuntime],
      [upgradeOperator, upgradeRuntime],
    ]) {
      const current = await probe(operator, runtime, { functional: true });
      assert.equal(current.statusCode, 200, JSON.stringify(current));
      assert.deepEqual(current.readiness, {
        status: "ok",
        migrations: expected.length,
      });
      assert.equal(
        current.registration?.statusCode,
        201,
        JSON.stringify(current),
      );
      assert.equal(
        current.organization?.statusCode,
        201,
        JSON.stringify(current),
      );
      assert.equal(current.media?.statusCode, 200, JSON.stringify(current));
      assert.equal(current.media.body.data.ready, false);
      for (const kind of ["photo", "cover"]) {
        assert.equal(current.media.body.data[kind].state, "EMPTY");
        assert.equal(current.media.body.data[kind].version, 0);
      }
      assert.equal(current.bootstrap?.statusCode, 200, JSON.stringify(current));
      assert.ok(current.bootstrap.body.data.rootCircleId);
    }
    const full = await probe(cleanOperator, cleanRuntime, { all: true });
    assert.equal(full.statusCode, 503);
    assert.deepEqual(full.readiness, {
      status: "not_ready",
      code: "MIGRATION_MISMATCH",
    });

    const corrupted = expected
      .filter((x) => Number(x.name.slice(0, 3)) >= 500)
      .at(-1)!;
    try {
      await clean.query(
        "UPDATE schema_migrations SET checksum=$1 WHERE name=$2",
        ["0".repeat(64), corrupted.name],
      );
      const mismatch = await probe(cleanOperator, cleanRuntime);
      assert.equal(mismatch.statusCode, 503);
      assert.deepEqual(mismatch.readiness, {
        status: "not_ready",
        code: "MIGRATION_MISMATCH",
      });
      const refused = await migrate(cleanOperator, cleanRuntime, {
        MIGRATION_SCOPE: "foundation",
      });
      assert.notEqual(refused.code, 0, refused.output);
      assert.ok(
        refused.output.includes(
          "Migration checksum mismatch: " + corrupted.name,
        ),
        refused.output,
      );
    } finally {
      // Restore only the row deliberately corrupted in this private fixture.
      await clean.query(
        "UPDATE schema_migrations SET checksum=$1 WHERE name=$2",
        [corrupted.checksum, corrupted.name],
      );
    }
    assert.deepEqual(
      await manifest(),
      expected,
      "migration sources changed during execution; rerun after source freeze",
    );
    assert.deepEqual((await probe(cleanOperator, cleanRuntime)).readiness, {
      status: "ok",
      migrations: expected.length,
    });
  } finally {
    await Promise.all(
      [...runtimePools, clean, upgrade].map((pool) => pool.end()),
    );
  }
});
