import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import pg from "pg";
import { selectMigrationNames } from "../../server/src/migration-selection.js";
import { deletionTableInventory } from "../../server/src/organization-deletion-catalog.js";
import { registeredDeletionParticipant } from "../../server/src/organization-deletion-registry.js";
import type { OrganizationDeletionContext } from "../../server/src/organization-lifecycle-contract.js";

const structureTables = ["structure_governance_models", "structure_model_revisions", "structure_model_functions",
  "structure_model_circles", "structure_model_occupancy_context", "structure_model_events"] as const;
const meetingTables = ["meeting_o2_panels", "meeting_o2_processes", "meeting_o2_treatments",
  "meeting_o2_circle_templates", "meeting_o2_reviews"] as const;
const tables = [...structureTables, ...meetingTables];
const migrationName = "932_o2_lifecycle_ownership.sql";
const signatures = [
  "public.structure_teardown_batch(uuid,uuid,bigint,uuid,text,text,integer)",
  "public.meetings_teardown_batch(uuid,uuid,bigint,uuid,text,text,integer)",
  "public.foundation_teardown_batch(uuid,uuid,bigint,uuid,text,text,integer)",
  "public.orgmap_deletion_assert_tenant_owned_empty(uuid,uuid,bigint,uuid)",
  "public.orgmap_deletion_assert_owner_empty(uuid,uuid,bigint,uuid,text)",
];
const evidence = ".orgmap/qa/o2-package/lifecycle-verification.json";

test("O2 lifecycle ownership, additive upgrade and guarded tenant teardown in a disposable database", async t => {
  // The caller supplies a local cluster. Its existing database is never migrated.
  const source = new URL(process.env.MIGRATION_DATABASE_URL ?? "postgres://invalid/");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(source.hostname), "LOCAL_DATABASE_REQUIRED");
  assert.ok(["postgres:", "postgresql:"].includes(source.protocol));
  const database = "orgmap_o2life_" + randomUUID().replaceAll("-", "");
  const target = new URL(source), role = "orgmap_o2life_" + randomUUID().replaceAll("-", "");
  target.pathname = "/" + database;
  const admin = new pg.Pool({ connectionString: source.href });
  const connectionsClosed: Promise<void>[] = [];
  function disposablePool(connectionString: string) {
    const pool = new pg.Pool({ connectionString });
    pool.on("connect", client => connectionsClosed.push(new Promise<void>(resolve => client.once("end", resolve))));
    return pool;
  }
  let db: pg.Pool | undefined, worker: pg.Pool | undefined, created = false, roleCreated = false;
  const report: Record<string, unknown> = { database, mainDatabaseTouched: false,
    previewRestarted: false, previewFixtureChanged: false, reviewedBaselineChanged: false,
    scope: "six O2 package tables under Structure and five O2 meeting tables under Meetings; not full lifecycle/release acceptance" };
  async function schemaTransaction<T>(fn: (c: pg.PoolClient) => Promise<T>) {
    const c = await db!.connect();
    try {
      await c.query("BEGIN"); await c.query("SELECT pg_advisory_xact_lock(730184)");
      const result = await fn(c); await c.query("COMMIT"); return result;
    } catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
  }
  async function migrate(maxPrefix: number) {
    const env: NodeJS.ProcessEnv = { ...process.env, MIGRATION_DATABASE_URL: target.href, MIGRATION_MAX_PREFIX: String(maxPrefix) };
    delete env.MIGRATION_SCOPE;
    return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      let output = "";
      const child = spawn(process.execPath, ["--import", "tsx", "server/src/migrate.ts"], { env, stdio: ["ignore", "pipe", "pipe"] });
      child.stdout.on("data", chunk => output += chunk);
      child.stderr.on("data", chunk => output += chunk);
      child.once("error", reject); child.once("close", code => resolve({ code, output }));
    });
  }
  try {
    await admin.query(`CREATE DATABASE "${database}"`); created = true;
    db = disposablePool(target.href);
    await t.test("existing migration selections include O2 only with domain/lifecycle dependencies", async () => {
      const names = await readdir("server/migrations");
      for (const selection of [{ scope: "all" }, { maxPrefix: 999 }] as const) {
        const selected = selectMigrationNames(names, selection);
        assert.ok(selected.includes("034_governance_model.sql"));
        assert.ok(selected.includes(migrationName));
        assert.ok(selected.indexOf("923_lifecycle_owner_absence.sql") < selected.indexOf(migrationName));
      }
      assert.ok(selectMigrationNames(names, { maxPrefix: 899 }).includes("034_governance_model.sql"));
      assert.ok(!selectMigrationNames(names, { maxPrefix: 899 }).includes(migrationName));
      assert.ok(!selectMigrationNames(names, { scope: "foundation" }).includes("034_governance_model.sql"));
      assert.ok(!selectMigrationNames(names, { scope: "foundation" }).includes(migrationName));
      for (const [owner, owned] of [["structure", structureTables], ["meetings", meetingTables]] as const) {
        for (const name of owned) {
          assert.equal(deletionTableInventory[owner].filter(x => x === name).length, 1);
          assert.equal(registeredDeletionParticipant(owner).describe().ownedSets.filter(x => x === name).length, 1);
          assert.equal(Object.values(deletionTableInventory).flat().filter(x => x === name).length, 1);
        }
      }
    });
    await t.test("full normal bootstrap reaches the reviewed integrated pin without weakening historical guards", async () => {
      const all = await migrate(999);
      assert.equal(all.code, 0, all.output);
      assert.equal((await db!.query("SELECT orgmap_migration_schema_ready() AS ready")).rows[0].ready,true);
      const baseline=(await db!.query("SELECT fingerprint,reviewed_snapshot_sha256 FROM organization_deletion_schema_baseline WHERE singleton")).rows[0];
      await assert.rejects(db!.query(await readFile("server/migrations/928_organization_deletion_reviewed_baseline.sql", "utf8")), /DELETION_REVIEWED_SCHEMA_MISMATCH/);
      report.fullBootstrap = {status:"passed",normalMigrator:true,baseline,historicalGuardRetained:true};
    });
    await t.test("additive lifecycle extension preserves original function bodies outside the eleven owned sets", async () => {
      const origins=["902_lifecycle_structure_teardown.sql","906_lifecycle_meetings_teardown.sql","909_lifecycle_foundation_teardown.sql","916_organization_deletion_schema_attestation.sql","923_lifecycle_owner_absence.sql"];
      const structureAddition=structureTables.map(x=>",'"+x+"'").join("");
      const meetingsAddition=meetingTables.map(x=>",'"+x+"'").join("");
      for(let i=0;i<signatures.length;i++){
        const name=signatures[i].split('.')[1].split('(')[0];
        const original=await readFile("server/migrations/"+origins[i],"utf8");
        const declaration=original.slice(original.indexOf("CREATE FUNCTION "+name+"("));
        const body=declaration.slice(declaration.indexOf("AS $$")+5,declaration.indexOf("END $$;")+4);
        const current=(await db!.query("SELECT prosrc,prosecdef FROM pg_proc WHERE oid=$1::regprocedure",[signatures[i]])).rows[0];
        assert.equal(current.prosrc.replace(structureAddition,"").replace(meetingsAddition,""),body,signatures[i]);
        assert.equal(current.prosecdef,true);
        const expected:readonly string[]=i===0?structureTables:i===1?meetingTables:tables;
        for(const table of tables)assert.equal(current.prosrc.split("'"+table+"'").length-1,expected.includes(table)?1:0);
      }
      await assert.rejects(db!.query(await readFile("server/migrations/"+migrationName,"utf8")),/O2_LIFECYCLE_EXTENSION_CONFLICT/);
      report.additiveUpgrade={status:"passed",affectedFunctions:signatures,historicalMigrationsEdited:false,duplicateExtensionRejected:true};
    });

    const actor = randomUUID(), A = { id: randomUUID(), circle: randomUUID(), role: randomUUID() },
      B = { id: randomUUID(), circle: randomUUID(), role: randomUUID() }, job = randomUUID(), token = randomUUID();
    const connection = new URL(target); connection.username = role; connection.password = randomUUID();
    await admin.query(`CREATE ROLE "${role}" LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${connection.password}'`);
    roleCreated = true;
    await admin.query(`GRANT orgmap_lifecycle_maintenance TO "${role}"`);
    worker = disposablePool(connection.href);
    await db.query("INSERT INTO accounts(id,email,display_name,password_hash) VALUES($1,$2,'Synthetic O2 lifecycle','not-a-login')", [actor, actor + "@example.test"]);
    for (const org of [A, B]) {
      await db.query("INSERT INTO organizations(id,name,locale,time_zone) VALUES($1,'Synthetic O2 lifecycle','pt-BR','America/Sao_Paulo')", [org.id]);
      await db.query("INSERT INTO entities(organization_id,id,node_id,kind,name) VALUES($1,$2,$3,'CIRCLE','Root')", [org.id, org.circle, randomUUID()]);
      await db.query("INSERT INTO entities(organization_id,id,node_id,kind,parent_id,name) VALUES($1,$2,$3,'ROLE',$4,'Guide')", [org.id, org.role, randomUUID(), org.circle]);
      await db.query("INSERT INTO structure_governance_models(organization_id,package_id,package_version,source_reference,phase) VALUES($1,'targetteal.o2','0.1.0','{}','PREPARATION')", [org.id]);
      for (const revision of [1, 2]) {
        await db.query("INSERT INTO structure_model_revisions(organization_id,revision,snapshot,actor_id) VALUES($1,$2,'{}',$3)", [org.id, revision, actor]);
        await db.query("INSERT INTO structure_model_events(organization_id,id,resource_id,action,model_revision,snapshot,actor_id) VALUES($1,$2,$3,'FIXTURE',$4,'{}',$5)", [org.id, randomUUID(), org.role, revision, actor]);
      }
      await db.query("INSERT INTO structure_model_functions(organization_id,role_id,function_code) VALUES($1,$2,'GUIDE')", [org.id, org.role]);
      await db.query("INSERT INTO structure_model_circles(organization_id,circle_id) VALUES($1,$2)", [org.id, org.circle]);
      for (const source of ["OCCUPANCY", "MANDATE"]) await db.query("INSERT INTO structure_model_occupancy_context(organization_id,occupancy_id,source,model_revision,origin) VALUES($1,$2,$3,1,'FIXTURE')", [org.id, randomUUID(), source]);
      const meetingId = randomUUID();
      await db.query("INSERT INTO meeting_o2_panels(organization_id,meeting_id,focus_id) VALUES($1,$2,$3)", [org.id, meetingId, randomUUID()]);
      await db.query("INSERT INTO meeting_o2_processes(organization_id,meeting_id,proposal_id,revision) VALUES($1,$2,$3,1)", [org.id, meetingId, randomUUID()]);
      await db.query("INSERT INTO meeting_o2_treatments(organization_id,meeting_id,agenda_id,mode) VALUES($1,$2,$3,'SYNC')", [org.id, meetingId, randomUUID()]);
      await db.query("INSERT INTO meeting_o2_circle_templates(organization_id,circle_id,sections) VALUES($1,$2,'[]')", [org.id, org.circle]);
      await db.query("INSERT INTO meeting_o2_reviews(organization_id,meeting_id,items) VALUES($1,$2,'[]')", [org.id, meetingId]);
    }
    await db.query("BEGIN");
    await db.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [A.id]);
    await db.query("UPDATE organization_lifecycle SET state='DELETION_PENDING',fence=2 WHERE organization_id=$1", [A.id]);
    await db.query("UPDATE organization_lifecycle SET state='PURGING',fence=3 WHERE organization_id=$1", [A.id]);
    await db.query("COMMIT");
    await db.query("INSERT INTO organization_deletion_jobs(organization_id,id,initiator_account_id,request_key,request_hash,accepted_fence,lifecycle_fence,state,phase,ledger_state,ledger_authority_id,ledger_record_sha256,lease_token,lease_fence,lease_until) VALUES($1,$2,$3,'synthetic',$4,2,3,'RUNNING','PURGE','CONFIRMED',$5,$4,$6,3,clock_timestamp()+interval '10 minutes')", [A.id, job, actor, "a".repeat(64), randomUUID(), token]);
    // Synthetic prerequisite checkpoints isolate this owner's contract. They do
    // not certify a real I/O drain, external ledger or project lifecycle readiness.
    for (const owner of ["structure", "meetings", "foundation"]) for (const phase of ["QUIESCE", "INVENTORY"])
      await db.query("INSERT INTO organization_deletion_progress(job_id,context_id,phase,done) VALUES($1,$2,$3,true)", [job, owner, phase]);
    for (const owner of ["administration", "platform", "governance", "work", "goals", "interoperability"])
      await db.query("INSERT INTO organization_deletion_progress(job_id,context_id,phase,done) VALUES($1,$2,'PURGE',true)", [job, owner]);
    const args = [A.id, job, "3", token];
    async function transaction<T>(fn: (c: pg.PoolClient) => Promise<T>, isolation = "READ COMMITTED") {
      const c = await worker!.connect();
      try { await c.query("BEGIN ISOLATION LEVEL " + isolation); await c.query("SELECT pg_advisory_xact_lock(730184)");
        const value = await fn(c); await c.query("COMMIT"); return value;
      } catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
    }
    const participant = registeredDeletionParticipant("structure");
    const context = (c: pg.PoolClient) => ({ c, organizationId: A.id, jobId: job, lifecycleFence: "3", leaseToken: token, actorAccountId: actor }) as OrganizationDeletionContext;
    async function snapshot(organizationId: string) {
      const rows: Record<string, unknown> = {};
      for (const table of tables) rows[table] = (await db!.query(`SELECT to_jsonb(x) AS row FROM ${table} x WHERE organization_id=$1 ORDER BY to_jsonb(x)::text`, [organizationId])).rows;
      return rows;
    }
    const beforeA = await snapshot(A.id), beforeB = await snapshot(B.id);
    await t.test("no schema attestation means no purge; only the reviewed pin is restored", async () => {
      const pin=(await db!.query("SELECT * FROM organization_deletion_schema_baseline WHERE singleton")).rows[0];
      await db!.query("DELETE FROM organization_deletion_schema_baseline WHERE singleton");
      try {
        await assert.rejects(transaction(c => participant.runBatch(context(c), { phase: "PURGE", cursor: null, limit: 1 })), /DELETION_SCHEMA_ATTESTATION_REQUIRED/);
        assert.deepEqual(await snapshot(A.id),beforeA);
      } finally {
        await db!.query("INSERT INTO organization_deletion_schema_baseline(singleton,fingerprint,reviewed_snapshot_sha256) VALUES(true,$1,$2)",[pin.fingerprint,pin.reviewed_snapshot_sha256]);
      }
      report.fixtureAttestation="reviewed integrated pin; no learned fixture baseline";
    });
    await t.test("authority, isolation, schema drift and independent absence checks retain their guards", async () => {
      await assert.rejects(transaction(c => participant.runBatch({ ...context(c), leaseToken: randomUUID() }, { phase: "PURGE", cursor: null, limit: 1 })), /DELETION_MAINTENANCE_LEASE_INVALID/);
      await assert.rejects(transaction(c => participant.runBatch(context(c), { phase: "PURGE", cursor: null, limit: 1 }), "REPEATABLE READ"), /DELETION_READ_COMMITTED_REQUIRED/);
      const app = await db!.connect();
      try {
        await app.query("SET ROLE orgmap_app");
        await assert.rejects(app.query("SELECT structure_teardown_batch($1,$2,3,$3,'PURGE',NULL,1)", [A.id, job, token]), /permission denied/);
      } finally { await app.query("RESET ROLE"); app.release(); }
      await assert.rejects(transaction(c => c.query("SELECT orgmap_deletion_assert_owner_empty($1,$2,$3,$4,'structure')", args)), /DELETION_OWNER_ROWS_REMAIN: structure_governance_models/);
      // Even forged completion of Structure cannot hide remaining O2 rows from Foundation.
      await db!.query("INSERT INTO organization_deletion_progress(job_id,context_id,phase,done) VALUES($1,'structure','PURGE',true)", [job]);
      await db!.query("INSERT INTO organization_deletion_progress(job_id,context_id,phase,done) VALUES($1,'meetings','PURGE',true)", [job]);
      await assert.rejects(transaction(c => c.query("SELECT foundation_teardown_batch($1,$2,$3,$4,'PURGE',NULL,1)", args)), /FOUNDATION_OWNER_ROWS_REMAIN: structure_governance_models/);
      await db!.query("DELETE FROM organization_deletion_progress WHERE job_id=$1 AND context_id='structure' AND phase='PURGE'", [job]);
      await db!.query("DELETE FROM organization_deletion_progress WHERE job_id=$1 AND context_id='meetings' AND phase='PURGE'", [job]);
      await db!.query("CREATE TABLE o2_lifecycle_test_drift(id int)");
      await assert.rejects(transaction(c => participant.runBatch(context(c), { phase: "PURGE", cursor: null, limit: 1 })), /DELETION_SCHEMA_ATTESTATION_REQUIRED/);
      await db!.query("DROP TABLE o2_lifecycle_test_drift");
      assert.deepEqual(await snapshot(A.id), beforeA);
    });
    async function purge(owner: "structure" | "meetings", owned: readonly string[]) {
      const party = registeredDeletionParticipant(owner);
      const counts: Record<string, number> = {};
      let done = false, batches = 0;
      while (!done && batches++ < 30) {
        done = await transaction(async c => {
          const prior = (await c.query("SELECT orgmap_deletion_read_progress($1,$2,$3,$4,$5,'PURGE') AS value", [...args, owner])).rows[0].value;
          const result = await party.runBatch(context(c), { phase: "PURGE", cursor: prior.cursor, limit: 1 });
          assert.ok(Object.values(result.counts).reduce((sum, n) => sum + n, 0) <= 1);
          assert.deepEqual(result.blobReferences, []);
          await c.query("SELECT orgmap_deletion_checkpoint($1,$2,$3,$4,$5,'PURGE',$6,$7,$8,$9,$10::jsonb,'[]')", [...args, owner, prior.revision, prior.cursor, result.nextCursor, result.done, JSON.stringify(result.counts)]);
          for (const [table, n] of Object.entries(result.counts)) counts[table] = (counts[table] ?? 0) + n;
          return result.done;
        });
      }
      assert.equal(done, true);
      for (const name of owned) assert.ok(counts[name] > 0, name);
      // Meetings already owns an observation row initialized by its existing
      // organization trigger; preserve that original teardown behavior too.
      assert.ok(Object.keys(counts).every(name => (deletionTableInventory[owner] as readonly string[]).includes(name)), JSON.stringify(counts));
      if (owner === "meetings") assert.equal(counts.meeting_statistics_observation, 1);
      const after = await snapshot(A.id);
      for (const name of owned) assert.deepEqual(after[name], []);
      assert.deepEqual(await snapshot(B.id), beforeB);
      assert.equal((await db!.query("SELECT count(*)::int AS count FROM entities WHERE organization_id=$1", [A.id])).rows[0].count, 2);
      assert.equal((await db!.query("SELECT count(*)::int AS count FROM accounts WHERE id=$1", [actor])).rows[0].count, 1);
      await transaction(c => c.query("SELECT orgmap_deletion_assert_owner_empty($1,$2,$3,$4,$5)", [...args, owner]));
      assert.equal((await transaction(c => party.runBatch(context(c), { phase: "PURGE", cursor: null, limit: 1 }))).done, true);
      report[owner + "Teardown"] = { status: "passed", counts, batches, tenantBUnchanged: true, foundationRowsPreserved: true,
        guards: ["schema attestation", "lease", "restricted role", "read committed", "schema drift", "owner absence", "foundation dependency"] };
    }
    await t.test("bounded real Structure batches checkpoint its six sets and preserve Meetings, B and Foundation", async () => {
      await purge("structure", structureTables);
      const after = await snapshot(A.id);
      for (const name of meetingTables) assert.deepEqual(after[name], beforeA[name]);
    });
    await t.test("bounded real Meetings batches checkpoint its five sets and preserve B and Foundation", async () => {
      const party = registeredDeletionParticipant("meetings");
      await assert.rejects(transaction(c => party.runBatch({ ...context(c), leaseToken: randomUUID() }, { phase: "PURGE", cursor: null, limit: 1 })), /DELETION_MAINTENANCE_LEASE_INVALID/);
      await assert.rejects(transaction(c => party.runBatch(context(c), { phase: "PURGE", cursor: null, limit: 1 }), "REPEATABLE READ"), /DELETION_READ_COMMITTED_REQUIRED/);
      await assert.rejects(transaction(c => c.query("SELECT orgmap_deletion_assert_owner_empty($1,$2,$3,$4,'meetings')", args)), /DELETION_OWNER_ROWS_REMAIN: meeting_o2_panels/);
      await db!.query("INSERT INTO organization_deletion_progress(job_id,context_id,phase,done) VALUES($1,'meetings','PURGE',true)", [job]);
      await assert.rejects(transaction(c => c.query("SELECT foundation_teardown_batch($1,$2,$3,$4,'PURGE',NULL,1)", args)), /FOUNDATION_OWNER_ROWS_REMAIN: meeting_o2_panels/);
      await db!.query("DELETE FROM organization_deletion_progress WHERE job_id=$1 AND context_id='meetings' AND phase='PURGE'", [job]);
      await purge("meetings", meetingTables);
      assert.deepEqual(await snapshot(A.id), Object.fromEntries(tables.map(name => [name, []])));
    });
  } finally {
    await worker?.end(); await db?.end();
    // pg-pool resolves end() after removing idle clients from its registry,
    // before their sockets necessarily close. Await the actual end events so
    // DROP DATABASE cannot terminate a client still delivering its shutdown.
    await Promise.all(connectionsClosed);
    if (created) { await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`); report.databaseRemoved = true; }
    if (roleCreated) { await admin.query(`DROP ROLE IF EXISTS "${role}"`); report.roleRemoved = true; }
    await admin.end();
    await mkdir(".orgmap/qa/o2-package", { recursive: true });
    await writeFile(evidence, JSON.stringify(report, null, 2) + "\n");
  }
});
