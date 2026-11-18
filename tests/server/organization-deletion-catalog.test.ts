import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { assertDeletionTableInventory, assertFoundationDispositionCoverage, foundationDisposition, deletionTableInventory } from "../../server/src/organization-deletion-catalog.js";
import { createWorkTeardownParticipant } from "../../server/modules/work/teardown.js";
import { createMeetingsTeardownParticipant } from "../../server/modules/meetings/teardown.js";
import { createInteroperabilityTeardownParticipant } from "../../server/modules/interoperability/teardown.js";
import { checkpointStoppedOrganizationQuiescenceAndInventory } from "../../server/ops/organization-deletion-barrier.js";
import { inspectDeletionRegistry, registeredDeletionParticipant, assertRegisteredDeletionParticipant } from "../../server/src/organization-deletion-registry.js";
import { runOrganizationDeletionBatch } from "../../server/src/organization-deletion-driver.js";
import { createAdministrationTeardownParticipant } from "../../server/modules/administration/teardown.js";

test("closed inventory rejects unknown, missing and duplicate relations", () => {
  const tables = Object.values(deletionTableInventory).flat();
  assert.equal(tables.length, 197);
  assert.doesNotThrow(() => assertDeletionTableInventory([...tables].reverse()));
  assert.throws(() => assertDeletionTableInventory([...tables, "new_tenant_table"]), /unknown=new_tenant_table/);
  assert.throws(() => assertDeletionTableInventory(tables.filter(t => t !== "accounts")), /missing=accounts/);
  assert.throws(() => assertDeletionTableInventory([...tables, "accounts"]), /DUPLICATE/);
  assert.throws(() => assertDeletionTableInventory([...tables, "other.private_rows"]), /unknown=other\.private_rows/);
});

test("batch remains unavailable before registry and real barrier exist", async () => {
  let connected = false;
  const pool = { connect: async () => { connected = true; throw Error("unexpected connection"); } };
  await assert.rejects(() => runOrganizationDeletionBatch(pool as never, createAdministrationTeardownParticipant(),
    { organizationId: "a", jobId: "b", lifecycleFence: "1", leaseToken: "c", actorAccountId: "d" },
    { phase: "PURGE", limit: 1 }), /DELETION_REGISTRY_NOT_READY/);
  assert.equal(connected, false);
});

test("partial registry exposes missing contexts and is not evidence of readiness", () => {
  assert.deepEqual(inspectDeletionRegistry().missing, []);
});

test("migration CREATE TABLE names are covered by the closed inventory", async () => {
  const dir = fileURLToPath(new URL("../../server/migrations/", import.meta.url));
  const names: string[] = [];
  for (const file of (await readdir(dir)).filter(name => name.endsWith(".sql"))) {
    const sql = await readFile(`${dir}/${file}`, "utf8");
    for (const match of sql.matchAll(/^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-z_][a-z_0-9]*)/gim)) names.push(match[1]);
  }
  // The migrator itself creates this global metadata table outside migrations.
  assertDeletionTableInventory([...names, "schema_migrations"]);
});

test("new participants describe every table in their inventory exactly once", () => {
  for (const [id, participant] of [["work", createWorkTeardownParticipant()], ["meetings", createMeetingsTeardownParticipant()], ["interoperability", createInteroperabilityTeardownParticipant()]] as const) {
    const sets = participant.describe().ownedSets;
    assert.equal(new Set(sets).size, sets.length);
    assert.deepEqual([...sets].sort(), [...deletionTableInventory[id]].sort());
  }
});

test("foundation inventory has one explicit, non-authorizing scope disposition per relation", () => {
  assert.doesNotThrow(() => assertFoundationDispositionCoverage());
});

test("registry binds the real object rather than a matching caller-supplied descriptor", () => {
  const trusted = registeredDeletionParticipant("administration");
  assert.doesNotThrow(() => assertRegisteredDeletionParticipant(trusted));
  assert.throws(() => assertRegisteredDeletionParticipant(createAdministrationTeardownParticipant()), /IDENTITY_MISMATCH/);
  assert.throws(() => registeredDeletionParticipant("unknown"), /NOT_REGISTERED/);
});

test("Q/inventory composition rejects an empty actor instead of silently observing only", async () => {
  await assert.rejects(checkpointStoppedOrganizationQuiescenceAndInventory({actorAccountId:""} as never), /DELETION_DRAIN_INPUT_INVALID/);
});

test("zero verifier names each tenant-owned set exactly once and excludes mixed controls", async () => {
  const sql=await readFile(fileURLToPath(new URL("../../server/migrations/916_organization_deletion_schema_attestation.sql",import.meta.url)),"utf8");
  const section=sql.match(/owned constant text\[\]:=ARRAY\[([\s\S]*?)\];/);
  assert.ok(section);
  const actual=[...section[1].matchAll(/'([a-z_0-9]+)'/g)].map(match=>match[1]);
  actual.push(...await o2LifecycleExtensionTables('structure'),...await o2LifecycleExtensionTables('meetings'));
  const expected=[...foundationDisposition.tenantCandidate,...deletionTableInventory.structure,...deletionTableInventory.governance,...deletionTableInventory.work,...deletionTableInventory.goals,...deletionTableInventory.meetings,...deletionTableInventory.administration,...deletionTableInventory.platform,...deletionTableInventory.interoperability];
  assert.equal(actual.length,167);
  assert.equal(new Set(actual).size,actual.length);
  assert.deepEqual([...actual].sort(),[...expected].sort());
});

test('private owner absence scanner covers each fixed owner exactly', async () => {
 const sql=await readFile(fileURLToPath(new URL('../../server/migrations/923_lifecycle_owner_absence.sql',import.meta.url)),'utf8');
 const expected={administration:deletionTableInventory.administration,platform:deletionTableInventory.platform,structure:deletionTableInventory.structure,governance:deletionTableInventory.governance,work:deletionTableInventory.work,goals:deletionTableInventory.goals,meetings:deletionTableInventory.meetings,interoperability:deletionTableInventory.interoperability,foundation:foundationDisposition.tenantCandidate};
 const branches=[...sql.matchAll(/WHEN '([a-z]+)' THEN ARRAY\[([^\]]*)\]/g)];
 assert.equal(branches.length,Object.keys(expected).length);
 for(const [,owner,body] of branches) {
  assert.ok(Object.hasOwn(expected,owner));
  const actual=[...body.matchAll(/'([a-z_0-9]+)'/g)].map(m=>m[1]);
  if(owner==='structure'||owner==='meetings') actual.push(...await o2LifecycleExtensionTables(owner));
  assert.deepEqual(actual.slice().sort(),[...expected[owner as keyof typeof expected]].sort(),owner);
 }
});

// Historical sources are immutable; 932 extends these fixed arrays additively.
async function o2LifecycleExtensionTables(owner:'structure'|'meetings'): Promise<string[]> {
 const sql=await readFile(fileURLToPath(new URL('../../server/migrations/932_o2_lifecycle_ownership.sql',import.meta.url)),'utf8');
 const addition=sql.match(new RegExp(owner+"_addition constant text := '([^\\n]+)';"));
 assert.ok(addition);
 return [...addition[1].matchAll(/''([a-z_0-9]+)''/g)].map(match=>match[1]);
}
