import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import pg from "pg";
import { loadMigrationPlan, receiptAttestation, integratedAttestation, mareAttestation, workAttestation, tenantCommandAttestation, invitationLifecycleAttestation, notificationContextAttestation, hasReviewedReceiptReconciliation, classifyMigrationUpgrade, corePublicationFingerprint } from "../../server/src/migration-plan.js";
import { selectMigrationNames } from "../../server/src/migration-selection.js";

const plan = await loadMigrationPlan({ scope: "all" });
const publication = "931_meeting_report_publication.sql";
const receipt = "929_organization_deletion_operator_receipt.sql";
async function migrate(url: string, maxPrefix?: number) {
  const env: NodeJS.ProcessEnv = { ...process.env, MIGRATION_DATABASE_URL: url };
  delete env.MIGRATION_SCOPE; delete env.MIGRATION_MAX_PREFIX;
  if (maxPrefix !== undefined) env.MIGRATION_MAX_PREFIX = String(maxPrefix);
  return new Promise<{ code: number | null; log: string }>((resolve, reject) => {
    let log = "";
    const child = spawn(process.execPath, ["--import", "tsx", "server/src/migrate.ts"], { env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", bytes => log += bytes); child.stderr.on("data", bytes => log += bytes);
    child.once("error", reject); child.once("close", code => resolve({ code, log }));
  });
}
async function schema(c: pg.PoolClient) {
  await c.query("BEGIN; SELECT pg_advisory_xact_lock(730184)");
  try { const value = (await c.query("SELECT orgmap_deletion_schema_fingerprint_internal() AS value")).rows[0].value;
    await c.query("COMMIT"); return value;
  } catch (error) { await c.query("ROLLBACK"); throw error; }
}
async function ledger(pool: pg.Pool) { return (await pool.query("SELECT name,checksum,applied_at FROM schema_migrations ORDER BY name")).rows; }

test("closed migration plan preserves selected sets, frozen SQL and historical source checksums", async () => {
  const ordered = plan.selected.map(item => item.name);
  assert.deepEqual([...ordered].sort(), selectMigrationNames([...plan.sources.keys()], { scope: "all" }));
  for (const name of plan.deferred) assert.ok(ordered.indexOf(name) > ordered.indexOf(receiptAttestation));
  assert.ok(ordered.indexOf(publication) > ordered.indexOf(plan.deferred.at(-1)!));
  assert.equal(ordered.at(-1), notificationContextAttestation);
  await assert.rejects(loadMigrationPlan({ maxPrefix: 945 }), /MIGRATION_NOTIFICATION_CONTEXT_REQUIRES_946/);
  await assert.rejects(loadMigrationPlan({ maxPrefix: 943 }), /MIGRATION_INVITATION_LIFECYCLE_REQUIRES_944/);
  await assert.rejects(loadMigrationPlan({ maxPrefix: 939 }), /MIGRATION_WORK_REQUIRES_940/);
  await assert.rejects(loadMigrationPlan({ maxPrefix: 941 }), /MIGRATION_TENANT_COMMAND_REQUIRES_942/);
  assert.equal((await loadMigrationPlan({ maxPrefix: 938 })).selected.at(-1)?.name, mareAttestation);
  for (const maxPrefix of [935, 936, 937]) await assert.rejects(loadMigrationPlan({ maxPrefix }), /MIGRATION_MARE_REQUIRES_938/);
  const limited = await loadMigrationPlan({ maxPrefix: 899 });
  assert.ok(limited.selected.every(item => Number(item.name.slice(0, 3)) <= 899));
  const dir = await mkdtemp(join(tmpdir(), "orgmap-migration-source-"));
  try {
    await cp(new URL("../../server/migrations/", import.meta.url), dir, { recursive: true });
    const url = pathToFileURL(dir + "/"), frozen = await loadMigrationPlan({ scope: "all" }, url);
    const first = frozen.sources.get("001_foundation.sql")!;
    await writeFile(join(dir, first.name), first.source + "\n-- changed after snapshot\n");
    assert.equal(createHash("sha256").update(first.source).digest("hex"), first.checksum);
    await assert.rejects(loadMigrationPlan({ scope: "all" }, url), /HISTORICAL_MIGRATION_SOURCE_MISMATCH/);
    await writeFile(join(dir, first.name), first.source);
    const marePath = join(dir, "reviewed/mare-938.json");
    const mareOriginal = await readFile(marePath, "utf8");
    await writeFile(marePath, mareOriginal + " ");
    await assert.rejects(loadMigrationPlan({ scope: "all" }, url), /MARE_REVIEW_DIGEST_MISMATCH/);
    await writeFile(marePath, mareOriginal);
    const workPath = join(dir, "reviewed/work-940.json");
    const workOriginal = await readFile(workPath, "utf8");
    await writeFile(workPath, workOriginal + " ");
    await assert.rejects(loadMigrationPlan({ scope: "all" }, url), /WORK_REVIEW_DIGEST_MISMATCH/);
    await writeFile(workPath, workOriginal);
    const tenantReviewPath = join(dir, "reviewed/tenant-command-942.json");
    const tenantReviewOriginal = await readFile(tenantReviewPath, "utf8");
    await writeFile(tenantReviewPath, tenantReviewOriginal + " ");
    await assert.rejects(loadMigrationPlan({ scope: "all" }, url), /TENANT_COMMAND_REVIEW_DIGEST_MISMATCH/);
    await writeFile(tenantReviewPath, tenantReviewOriginal);
    const tenantMigration = frozen.sources.get("941_tenant_command_root_definitions.sql")!;
    await writeFile(join(dir, tenantMigration.name), tenantMigration.source + "\n-- changed after review\n");
    await assert.rejects(loadMigrationPlan({ scope: "all" }, url), /TENANT_COMMAND_REVIEW_SOURCE_MISMATCH/);
    await writeFile(join(dir, tenantMigration.name), tenantMigration.source);
    const invitationReviewPath = join(dir, "reviewed/invitation-lifecycle-944.json");
    const invitationReviewOriginal = await readFile(invitationReviewPath, "utf8");
    await writeFile(invitationReviewPath, invitationReviewOriginal + " ");
    await assert.rejects(loadMigrationPlan({ scope: "all" }, url), /INVITATION_LIFECYCLE_REVIEW_DIGEST_MISMATCH/);
    await writeFile(invitationReviewPath, invitationReviewOriginal);
    const invitationMigration = frozen.sources.get("943_invitation_lifecycle.sql")!;
    await writeFile(join(dir, invitationMigration.name), invitationMigration.source + "\n-- changed after review\n");
    await assert.rejects(loadMigrationPlan({ scope: "all" }, url), /INVITATION_LIFECYCLE_REVIEW_SOURCE_MISMATCH/);
    await writeFile(join(dir, invitationMigration.name), invitationMigration.source);
    const notificationReviewPath=join(dir,'reviewed/notification-context-946.json');
    const notificationOriginal=await readFile(notificationReviewPath,'utf8');
    await writeFile(notificationReviewPath,notificationOriginal+' ');
    await assert.rejects(loadMigrationPlan({scope:'all'},url),/NOTIFICATION_CONTEXT_REVIEW_DIGEST_MISMATCH/);
    await writeFile(notificationReviewPath,notificationOriginal);
    const notificationMigration=frozen.sources.get('945_notification_context.sql')!;
    await writeFile(join(dir,notificationMigration.name),notificationMigration.source+'\n-- changed after review\n');
    await assert.rejects(loadMigrationPlan({scope:'all'},url),/NOTIFICATION_CONTEXT_REVIEW_SOURCE_MISMATCH/);
    await writeFile(join(dir,notificationMigration.name),notificationMigration.source);
    for (const name of [mareAttestation, "939_work_project_extensions.sql"]) {
      const original = frozen.sources.get(name)!;
      await writeFile(join(dir, name), original.source + "\n-- changed after review\n");
      await assert.rejects(loadMigrationPlan({ scope: "all" }, url), /WORK_REVIEW_SOURCE_MISMATCH/);
      await writeFile(join(dir, name), original.source);
    }
    await writeFile(join(dir, "939_unreviewed.sql"), "SELECT 1;");
    await assert.rejects(loadMigrationPlan({ scope: "all" }, url), /WORK_REVIEW_SOURCE_MISMATCH/);
    await rm(join(dir, "939_unreviewed.sql"));
    await writeFile(join(dir, "035_unknown.sql"), "SELECT 1;");
    await assert.rejects(loadMigrationPlan({ scope: "all" }, url), /UNREVIEWED_PRE_BASELINE_MIGRATION/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("939 selection fails source validation before attempting a connection", async () => {
  const result = await migrate("postgres://invalid:invalid@127.0.0.1:1/not_a_database", 939);
  assert.notEqual(result.code, 0);
  assert.match(result.log, /MIGRATION_WORK_REQUIRES_940/);
  assert.doesNotMatch(result.log, /ECONNREFUSED/);
});

test("normal fresh bootstrap and recognized CORE upgrade preserve history, data and schema guards", async t => {
  const source = new URL(process.env.MIGRATION_DATABASE_URL ?? "postgres://invalid/");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(source.hostname), "LOCAL_DATABASE_REQUIRED");
  const admin = new pg.Pool({ connectionString: source.href });
  const fixtures: { name: string; url: string; pool: pg.Pool }[] = [];
  async function fixture() {
    const name = "orgmap_migration_plan_" + randomUUID().replaceAll("-", "");
    await admin.query(`CREATE DATABASE "${name}"`);
    const url = new URL(source); url.pathname = "/" + name;
    const value = { name, url: url.href, pool: new pg.Pool({ connectionString: url.href }) };
    fixtures.push(value); return value;
  }
  async function seedHistorical(pool: pg.Pool, core: boolean) {
    const c = await pool.connect();
    try {
      await c.query("BEGIN; SELECT pg_advisory_xact_lock(730184); CREATE TABLE schema_migrations(name text PRIMARY KEY,applied_at timestamptz DEFAULT now(),checksum text)");
      const names = [...plan.historical.keys()].filter(name => !core || (name !== receipt && name !== receiptAttestation));
      if (core) names.push(publication);
      for (const name of names) {
        const sql = plan.sources.get(name)!;
        await c.query(sql.source); await c.query("INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)", [name, sql.checksum]);
      }
      await c.query("COMMIT");
    } catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
  }
  async function sentinels(pool: pg.Pool) {
    const org = randomUUID(), account = randomUUID(), member = randomUUID(), circle = randomUUID(), project = randomUUID(), task = randomUUID(), checklist = randomUUID();
    await pool.query("INSERT INTO accounts(id,email,display_name,password_hash) VALUES($1,$2,'Preserve Unicode ç Ω','not-a-login')", [account, account + "@example.test"]);
    await pool.query("INSERT INTO organizations(id,name,locale,time_zone) VALUES($1,'Retained organization','pt-BR','America/Sao_Paulo')", [org]);
    await pool.query("INSERT INTO members(organization_id,id,account_id,org_role) VALUES($1,$2,$3,'OWNER')", [org, member, account]);
    await pool.query("INSERT INTO entities(organization_id,id,node_id,kind,name,purpose) VALUES($1,$2,$3,'CIRCLE','Retained root','Existing rich purpose')", [org, circle, randomUUID()]);
    await pool.query("INSERT INTO work_projects(organization_id,id,title,description,visibility,creator_id) VALUES($1,$2,'Retained project','Projeto ç Ω','PRIVATE',$3)", [org, project, member]);
    await pool.query("INSERT INTO work_tasks(organization_id,id,project_id,creator_id,title,description,status) VALUES($1,$2,$3,$4,'Retained task','Tarefa ç Ω','IN_PROGRESS')", [org, task, project, member]);
    await pool.query("INSERT INTO work_checklist(organization_id,id,task_id,title,done) VALUES($1,$2,$3,'Retained legacy checklist',true)", [org, checklist, task]);
    async function proof() {
      return Promise.all([
        pool.query("SELECT * FROM accounts WHERE id=$1", [account]), pool.query("SELECT * FROM organizations WHERE id=$1", [org]),
        pool.query("SELECT * FROM members WHERE organization_id=$1", [org]),
        pool.query("SELECT organization_id,id,title,description,visibility,creator_id,version FROM work_projects WHERE organization_id=$1", [org]),
        pool.query("SELECT organization_id,id,project_id,creator_id,title,description,status,version FROM work_tasks WHERE organization_id=$1", [org]),
        pool.query("SELECT * FROM work_checklist WHERE organization_id=$1", [org]),
        // Compare the original columns: 033 adds definition lists without rewriting old content.
        pool.query("SELECT organization_id,id,node_id,kind,parent_id,name,purpose,purpose_rich,archived,version FROM entities WHERE organization_id=$1", [org]),
      ]).then(values => values.map(value => value.rows));
    }
    return { before: await proof(), proof, ids: {org, member, circle} };
  }
  try {
    const fresh = await fixture();
    await t.test("fresh default migrator executes historical pins and reaches the reviewed 946 pin", async () => {
      const result = await migrate(fresh.url); assert.equal(result.code, 0, result.log);
      const applied = await ledger(fresh.pool);
      assert.equal(applied.length, plan.selected.length);
      assert.ok(applied.some(row => row.name === receiptAttestation));
      assert.equal((await fresh.pool.query("SELECT count(*)::int AS count FROM schema_migration_reconciliations")).rows[0].count, 0);
      const c = await fresh.pool.connect(); try { assert.equal(await schema(c), plan.notificationContextReview!.schemaFingerprint); } finally { c.release(); }
      assert.equal((await fresh.pool.query("SELECT orgmap_migration_schema_ready() AS ready")).rows[0].ready, true);
      assert.equal(await classifyMigrationUpgrade(fresh.pool, await loadMigrationPlan({scope:"foundation"}),new Map(applied.map(row=>[row.name,row.checksum]))),"NATIVE");
    });
    const native934 = await fixture();
    await t.test("native 934 upgrades to 946 and replay preserves ledger", async () => {
      const first = await migrate(native934.url, 934); assert.equal(first.code, 0, first.log);
      const before = await ledger(native934.pool), sent = await sentinels(native934.pool);
      await native934.pool.query("CREATE TABLE migration_checkpoint_drift(id int)");
      const rejected = await migrate(native934.url); assert.notEqual(rejected.code, 0); assert.match(rejected.log, /MIGRATION_REVIEWED_SCHEMA_MISMATCH/);
      assert.deepEqual(await ledger(native934.pool), before);
      await native934.pool.query("DROP TABLE migration_checkpoint_drift");
      const result = await migrate(native934.url); assert.equal(result.code, 0, result.log);
      const after = await ledger(native934.pool);
      assert.deepEqual(after.filter(row => before.some(old => old.name === row.name)), before);
      assert.deepEqual(await sent.proof(), sent.before);
      const replay = await migrate(native934.url); assert.equal(replay.code, 0, replay.log);
      assert.deepEqual(await ledger(native934.pool), after);
      const limitedReplay = await migrate(native934.url, 934); assert.equal(limitedReplay.code, 0, limitedReplay.log);
      assert.deepEqual(await ledger(native934.pool), after);
    });
    const native942 = await fixture();
    await t.test("native 942 invitation upgrade preserves unknown chronology, active token and RLS through 944 replay", async () => {
      const first = await migrate(native942.url, 942); assert.equal(first.code, 0, first.log);
      const retained = await sentinels(native942.pool), org = retained.ids.org;
      const invitation = randomUUID(), currentJob = randomUUID(), historicalJob = randomUUID();
      const token = "a".repeat(64), tokenHash = createHash("sha256").update(token).digest("hex");
      await native942.pool.query("INSERT INTO invitations(organization_id,id,email,token_hash,expires_at,invited_by_member_id,version) VALUES($1,$2,'legacy@example.test',$3,clock_timestamp()+interval '1 day',$4,3)", [org, invitation, tokenHash, retained.ids.member]);
      await native942.pool.query("INSERT INTO invitation_delivery(organization_id,id,invitation_id,token) VALUES($1,$2,$3,$4)", [org, currentJob, invitation, token]);
      await native942.pool.query("INSERT INTO invitation_delivery(organization_id,id,invitation_id,state) VALUES($1,$2,$3,'DELIVERED')", [org, historicalJob, invitation]);
      const before = await ledger(native942.pool);
      const result = await migrate(native942.url); assert.equal(result.code, 0, result.log);
      assert.deepEqual((await ledger(native942.pool)).filter(row => before.some(old => old.name === row.name)), before);
      const row = (await native942.pool.query("SELECT created_at,accepted_at,revoked_at,delivery_generation,token_hash,version FROM invitations WHERE id=$1", [invitation])).rows[0];
      assert.deepEqual(row, { created_at: null, accepted_at: null, revoked_at: null, delivery_generation: 3, token_hash: tokenHash, version: 3 });
      const jobs = (await native942.pool.query("SELECT id,generation,created_at FROM invitation_delivery WHERE invitation_id=$1", [invitation])).rows;
      assert.equal(jobs.find(row => row.id === currentJob).generation, 3);
      assert.equal(jobs.find(row => row.id === historicalJob).generation, null);
      assert.ok(jobs.every(row => row.created_at === null));
      assert.deepEqual(await retained.proof(), retained.before);
      assert.equal((await native942.pool.query("SELECT orgmap_migration_schema_ready() AS ready")).rows[0].ready, true);
      for (const prefix of [942, 944]) {
        const replay = await migrate(native942.url, prefix); assert.equal(replay.code, 0, replay.log);
      }
      const saved = (await native942.pool.query("DELETE FROM schema_migrations WHERE name=$1 RETURNING *", [invitationLifecycleAttestation])).rows[0];
      const rejected = await migrate(native942.url); assert.notEqual(rejected.code, 0); assert.match(rejected.log, /MIGRATION_INVITATION_LIFECYCLE_LEDGER_INCOMPLETE/);
      await native942.pool.query("INSERT INTO schema_migrations(name,applied_at,checksum) VALUES($1,$2,$3)", [saved.name, saved.applied_at, saved.checksum]);
    });
    const native938 = await fixture();
    await t.test("native 938 reaches 940; 938/940 replay keeps data, ledger, baseline and readiness", async () => {
      const first = await migrate(native938.url, 938); assert.equal(first.code, 0, first.log);
      const before = await ledger(native938.pool), sent = await sentinels(native938.pool);
      assert.deepEqual((await native938.pool.query("SELECT fingerprint,reviewed_snapshot_sha256 FROM organization_deletion_schema_baseline WHERE singleton")).rows[0], {
        fingerprint: plan.mareReview!.schemaFingerprint, reviewed_snapshot_sha256: plan.mareReview!.sourceSnapshotSha256,
      });
      const baseline938 = (await native938.pool.query("SELECT * FROM organization_deletion_schema_baseline")).rows;
      const c = await native938.pool.connect();
      try {
        await c.query("BEGIN");
        await assert.rejects(c.query(plan.sources.get(workAttestation)!.source), /DELETION_REVIEWED_SCHEMA_MISMATCH/);
        await c.query("ROLLBACK");
        await c.query("BEGIN");
        await c.query(plan.sources.get("939_work_project_extensions.sql")!.source);
        assert.equal((await c.query("SELECT orgmap_migration_schema_ready() AS ready")).rows[0].ready, false);
        await c.query("UPDATE organization_deletion_schema_baseline SET reviewed_snapshot_sha256=$1", ['0'.repeat(64)]);
        await assert.rejects(c.query(plan.sources.get(workAttestation)!.source), /DELETION_REVIEWED_BASELINE_CONFLICT/);
        await c.query("ROLLBACK");
      } finally { await c.query("ROLLBACK"); c.release(); }
      assert.deepEqual(await ledger(native938.pool), before);
      assert.deepEqual((await native938.pool.query("SELECT * FROM organization_deletion_schema_baseline")).rows, baseline938);
      assert.equal((await native938.pool.query("SELECT orgmap_migration_schema_ready() AS ready")).rows[0].ready, true);
      const result = await migrate(native938.url, 940); assert.equal(result.code, 0, result.log);
      const after = await ledger(native938.pool);
      assert.deepEqual(after.filter(row => before.some(old => old.name === row.name)), before);
      assert.deepEqual(await sent.proof(), sent.before);
      const baseline = (await native938.pool.query("SELECT * FROM organization_deletion_schema_baseline")).rows;
      assert.equal(baseline[0].fingerprint, plan.workReview!.schemaFingerprint);
      assert.equal(baseline[0].reviewed_snapshot_sha256, plan.workReview!.sourceSnapshotSha256);
      for (const prefix of [938, 940]) {
        const replay = await migrate(native938.url, prefix); assert.equal(replay.code, 0, replay.log);
        assert.deepEqual(await ledger(native938.pool), after);
        assert.deepEqual((await native938.pool.query("SELECT * FROM organization_deletion_schema_baseline")).rows, baseline);
        assert.equal((await native938.pool.query("SELECT orgmap_migration_schema_ready() AS ready")).rows[0].ready, true);
      }
      for (const name of ["939_work_project_extensions.sql", workAttestation, mareAttestation]) {
        const saved = (await native938.pool.query("DELETE FROM schema_migrations WHERE name=$1 RETURNING *", [name])).rows[0];
        const remaining = await ledger(native938.pool);
        const rejected = await migrate(native938.url); assert.notEqual(rejected.code, 0);
        assert.match(rejected.log, /MIGRATION_WORK_LEDGER_INCOMPLETE/);
        assert.deepEqual(await ledger(native938.pool), remaining);
        assert.deepEqual((await native938.pool.query("SELECT * FROM organization_deletion_schema_baseline")).rows, baseline);
        await native938.pool.query("INSERT INTO schema_migrations(name,applied_at,checksum) VALUES($1,$2,$3)", [saved.name,saved.applied_at,saved.checksum]);
      }
      await native938.pool.query("INSERT INTO schema_migrations(name,checksum) VALUES('941_unknown.sql',$1)", ['0'.repeat(64)]);
      const unknown = await migrate(native938.url); assert.notEqual(unknown.code, 0); assert.match(unknown.log, /MIGRATION_LEDGER_NOT_RECOGNIZED/);
      await native938.pool.query("DELETE FROM schema_migrations WHERE name='941_unknown.sql'");
      assert.deepEqual(await ledger(native938.pool), after);
    });
    const legacy507 = await fixture();
    await t.test("exact pre-508 upgrade preserves deferred rows and entity definitions through the reviewed checkpoints", async () => {
      const initial = await migrate(legacy507.url, 507); assert.equal(initial.code, 0, initial.log);
      const retained = await sentinels(legacy507.pool);
      const {org,member,circle} = retained.ids;
      const role=randomUUID();
      await legacy507.pool.query("INSERT INTO entities(organization_id,id,node_id,kind,parent_id,name) VALUES($1,$2,$3,'ROLE',$4,'Historical function')",[org,role,randomUUID(),circle]);
      const beforeProof=await retained.proof();
      await legacy507.pool.query("UPDATE entities SET responsibilities=$2,artifacts=$3 WHERE organization_id=$1", [org, JSON.stringify([{id:randomUUID(),text:'Responsabilidade histórica'}]), JSON.stringify([{id:randomUUID(),text:'Artefato histórico'}])]);
      await legacy507.pool.query("INSERT INTO structure_governance_models(organization_id,package_id,package_version,source_reference,phase) VALUES($1,'targetteal.o2','1','{}','PREPARATION')",[org]);
      await legacy507.pool.query("INSERT INTO structure_model_revisions(organization_id,revision,snapshot,actor_id) VALUES($1,1,'{}',$2)",[org,member]);
      await legacy507.pool.query("INSERT INTO structure_model_functions(organization_id,role_id,function_code) VALUES($1,$2,'FACILITATOR')",[org,role]);
      await legacy507.pool.query("INSERT INTO structure_model_circles(organization_id,circle_id,self_assignment) VALUES($1,$2,true)",[org,circle]);
      await legacy507.pool.query("INSERT INTO structure_model_occupancy_context(organization_id,occupancy_id,source,model_revision,origin) VALUES($1,$2,'OCCUPANCY',1,'legacy')",[org,randomUUID()]);
      await legacy507.pool.query("INSERT INTO structure_model_events(organization_id,id,resource_id,action,model_revision,snapshot,actor_id) VALUES($1,$2,$3,'INSTALL',1,'{}',$4)",[org,randomUUID(),circle,member]);
      const meeting = randomUUID();
      await legacy507.pool.query("INSERT INTO meeting_o2_panels(organization_id,meeting_id,notes) VALUES($1,$2,'Anotação histórica')",[org,meeting]);
      await legacy507.pool.query("INSERT INTO meeting_o2_processes(organization_id,meeting_id,proposal_id,revision) VALUES($1,$2,$3,1)",[org,meeting,randomUUID()]);
      await legacy507.pool.query("INSERT INTO meeting_o2_treatments(organization_id,meeting_id,agenda_id,mode,description) VALUES($1,$2,$3,'SYNC','Tratamento histórico')",[org,meeting,randomUUID()]);
      await legacy507.pool.query("INSERT INTO meeting_o2_circle_templates(organization_id,circle_id,sections) VALUES($1,$2,'[]')",[org,circle]);
      await legacy507.pool.query("INSERT INTO meeting_o2_reviews(organization_id,meeting_id) VALUES($1,$2)",[org,meeting]);
      const deferredTables = ['structure_governance_models','structure_model_revisions','structure_model_functions','structure_model_circles','structure_model_occupancy_context','structure_model_events','meeting_o2_panels','meeting_o2_processes','meeting_o2_treatments','meeting_o2_circle_templates','meeting_o2_reviews'];
      const extra = async () => Promise.all([
        legacy507.pool.query("SELECT responsibilities,artifacts FROM entities WHERE organization_id=$1 AND id=$2",[org,circle]).then(result=>result.rows),
        ...deferredTables.map(table=>legacy507.pool.query(`SELECT to_jsonb(row) AS value FROM ${table} row WHERE organization_id=$1 ORDER BY to_jsonb(row)::text`,[org]).then(result=>result.rows)),
      ]);
      const beforeExtra = await extra(), beforeLedger = await ledger(legacy507.pool);
      const result = await migrate(legacy507.url); assert.equal(result.code, 0, result.log);
      assert.deepEqual(await extra(),beforeExtra);
      assert.deepEqual(await retained.proof(),beforeProof);
      assert.deepEqual((await ledger(legacy507.pool)).filter(row=>beforeLedger.some(old=>old.name===row.name)),beforeLedger);
      const c=await legacy507.pool.connect(); try {assert.equal(await schema(c),plan.notificationContextReview!.schemaFingerprint);} finally {c.release();}
      assert.equal((await legacy507.pool.query("SELECT orgmap_migration_schema_ready() AS ready")).rows[0].ready,true);
      const replay=await migrate(legacy507.url);assert.equal(replay.code,0,replay.log);
      assert.deepEqual(await extra(),beforeExtra);
    });
    const legacyDrift = await fixture();
    await t.test("pre-508 ledger with schema drift fails before the 928 attestation and rolls back", async () => {
      const initial=await migrate(legacyDrift.url,507);assert.equal(initial.code,0,initial.log);
      const before=await ledger(legacyDrift.pool);
      await legacyDrift.pool.query('CREATE TABLE legacy_unreviewed_drift(id int)');
      const result=await migrate(legacyDrift.url);assert.notEqual(result.code,0);
      assert.match(result.log,/MIGRATION_LEGACY_927_SCHEMA_NOT_RECOGNIZED/);
      assert.deepEqual(await ledger(legacyDrift.pool),before);
    });
    const canonical = await fixture();
    await t.test("upgrade from native 930 preserves existing checksums, timestamps and tenant data", async () => {
      await seedHistorical(canonical.pool, false); const sent = await sentinels(canonical.pool), before = await ledger(canonical.pool);
      const result = await migrate(canonical.url); assert.equal(result.code, 0, result.log);
      const after = await ledger(canonical.pool);
      assert.deepEqual(after.filter(row => before.some(old => old.name === row.name)), before);
      assert.deepEqual(await sent.proof(), sent.before);
      assert.equal((await canonical.pool.query("SELECT orgmap_migration_schema_ready() AS ready")).rows[0].ready, true);
    });
    const coreStaged = await fixture();
    await t.test("CORE reconciles through 934 before a later 944 upgrade", async () => {
      await seedHistorical(coreStaged.pool, true);
      const first = await migrate(coreStaged.url, 934); assert.equal(first.code, 0, first.log);
      const before = await ledger(coreStaged.pool);
      const journal = (await coreStaged.pool.query("SELECT * FROM schema_migration_reconciliations")).rows;
      const second = await migrate(coreStaged.url); assert.equal(second.code, 0, second.log);
      const after = await ledger(coreStaged.pool);
      assert.deepEqual(after.filter(row => before.some(old => old.name === row.name)), before);
      assert.deepEqual((await coreStaged.pool.query("SELECT * FROM schema_migration_reconciliations")).rows, journal);
    });
    const core = await fixture();
    await seedHistorical(core.pool, true);
    const c = await core.pool.connect(); try { assert.equal(await schema(c), corePublicationFingerprint); } finally { c.release(); }
    const retained = await sentinels(core.pool), oldLedger = await ledger(core.pool);
    await t.test("the exact 928+931 host requires full 934, then honestly reconciles 930 without forging its execution", async () => {
      const limited = await migrate(core.url, 933); assert.notEqual(limited.code, 0); assert.match(limited.log, /MIGRATION_CORE_UPGRADE_REQUIRES_934/);
      assert.deepEqual(await ledger(core.pool), oldLedger);
      const result = await migrate(core.url); assert.equal(result.code, 0, result.log);
      const current = await ledger(core.pool), map = new Map<string, string>(current.map(row => [row.name, row.checksum]));
      assert.deepEqual(current.filter(row => oldLedger.some(old => old.name === row.name)), oldLedger);
      assert.deepEqual(await retained.proof(), retained.before);
      assert.ok(!map.has(receiptAttestation)); assert.ok(map.has(receipt));
      assert.equal(await hasReviewedReceiptReconciliation(core.pool, plan, map), true);
      assert.equal((await core.pool.query("SELECT orgmap_migration_schema_ready() AS ready")).rows[0].ready, true);
      const row = (await core.pool.query("SELECT * FROM schema_migration_reconciliations")).rows[0];
      assert.equal(row.transition, "CORE_928_PUBLICATION_931_TO_934");
      assert.equal(row.from_schema_fingerprint, corePublicationFingerprint);
      const again = await migrate(core.url); assert.equal(again.code, 0, again.log);
      assert.deepEqual(await ledger(core.pool), current);
      assert.deepEqual((await core.pool.query("SELECT * FROM schema_migration_reconciliations")).rows[0], row);
    });
    await t.test("schema drift, altered journals and native checksum corruption stay blocked", async () => {
      const savedLedger = (await core.pool.query("DELETE FROM schema_migrations WHERE name='936_work_mare.sql' RETURNING *")).rows[0];
      const incomplete = await migrate(core.url); assert.notEqual(incomplete.code, 0); assert.match(incomplete.log, /MIGRATION_MARE_LEDGER_INCOMPLETE/);
      await core.pool.query("INSERT INTO schema_migrations(name,applied_at,checksum) VALUES($1,$2,$3)",[savedLedger.name,savedLedger.applied_at,savedLedger.checksum]);
      await core.pool.query("CREATE TABLE migration_plan_unreviewed(id int)");
      assert.equal((await core.pool.query("SELECT orgmap_migration_schema_ready() AS ready")).rows[0].ready, false);
      const drift = await migrate(core.url); assert.notEqual(drift.code, 0); assert.match(drift.log, /MIGRATION_REVIEWED_SCHEMA_MISMATCH/);
      await core.pool.query("DROP TABLE migration_plan_unreviewed");
      const row = (await core.pool.query("SELECT * FROM schema_migration_reconciliations")).rows[0];
      await core.pool.query("UPDATE schema_migration_reconciliations SET superseding_checksum=$1", ["0".repeat(64)]);
      const badJournal = await migrate(core.url); assert.notEqual(badJournal.code, 0); assert.match(badJournal.log, /MIGRATION_REVIEWED_BASELINE_RECOVERY_REQUIRED/);
      await core.pool.query("UPDATE schema_migration_reconciliations SET superseding_checksum=$1", [row.superseding_checksum]);
      const hash = plan.sources.get("928_organization_deletion_reviewed_baseline.sql")!.checksum;
      await core.pool.query("UPDATE schema_migrations SET checksum=$1 WHERE name='928_organization_deletion_reviewed_baseline.sql'", ["0".repeat(64)]);
      const corrupt = await migrate(core.url); assert.notEqual(corrupt.code, 0); assert.match(corrupt.log, /Migration checksum mismatch/);
      await core.pool.query("UPDATE schema_migrations SET checksum=$1 WHERE name='928_organization_deletion_reviewed_baseline.sql'", [hash]);
      assert.deepEqual(await retained.proof(), retained.before);
    });
    await t.test("RLS/ACL checks and private reconciliation writes retain their authority boundaries", async () => {
      const c = await core.pool.connect();
      try {
        await c.query("BEGIN; ALTER TABLE entities DISABLE ROW LEVEL SECURITY");
        assert.equal((await c.query("SELECT orgmap_migration_schema_ready() AS ready")).rows[0].ready, false);
        await c.query("ROLLBACK");
        await c.query("BEGIN; REVOKE SELECT ON entities FROM orgmap_app");
        assert.equal((await c.query("SELECT orgmap_migration_schema_ready() AS ready")).rows[0].ready, false);
        await c.query("ROLLBACK");
        await c.query("SET ROLE orgmap_app");
        assert.equal((await c.query("SELECT * FROM entities")).rowCount, 0);
        assert.equal((await c.query("SELECT orgmap_migration_schema_ready() AS ready")).rows[0].ready, true);
        const applied = new Map<string,string>((await ledger(core.pool)).map(row=>[row.name,row.checksum]));
        assert.equal(await hasReviewedReceiptReconciliation(c, plan, applied, "readiness"), true);
        await assert.rejects(c.query("SELECT fingerprint FROM organization_deletion_schema_baseline"), /permission denied/);
        await assert.rejects(c.query("DELETE FROM schema_migration_reconciliations"), /permission denied/);
      } finally { await c.query("RESET ROLE"); c.release(); }
    });
    const partial = await fixture();
    await t.test("unreviewed partial expanded fixtures are rejected with transaction rollback", async () => {
      const initial = await migrate(partial.url, 899); assert.equal(initial.code, 0, initial.log);
      const before = await ledger(partial.pool), result = await migrate(partial.url);
      assert.notEqual(result.code, 0); assert.match(result.log, /MIGRATION_REVIEWED_BASELINE_RECOVERY_REQUIRED/);
      assert.deepEqual(await ledger(partial.pool), before);
      assert.equal((await partial.pool.query("SELECT to_regclass('public.schema_migration_reconciliations') AS relation")).rows[0].relation, null);
    });
  } finally {
    for (const fixture of fixtures.reverse()) {
      await fixture.pool.end();
      // A normal DROP lets PostgreSQL finish socket shutdown; FORCE can deliver
      // an asynchronous error to a pg client whose pool has just ended.
      await admin.query(`DROP DATABASE IF EXISTS "${fixture.name}"`);
      assert.equal((await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [fixture.name])).rowCount, 0);
    }
    console.log("migration-plan-fixture-cleanup", JSON.stringify({databasesRemoved: fixtures.length}));
    await admin.end();
  }
});
