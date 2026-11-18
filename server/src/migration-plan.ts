import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import type { PoolClient } from "pg";
import { selectMigrationNames, type MigrationSelection } from "./migration-selection.js";

export const receiptAttestation = "930_organization_deletion_receipt_reviewed_baseline.sql";
export const integratedAttestation = "934_integrated_reviewed_schema_baseline.sql";
export const mareAttestation = "938_mare_reviewed_schema_baseline.sql";
export const workAttestation = "940_work_mare_reviewed_schema_baseline.sql";
export const tenantCommandAttestation = "942_tenant_command_reviewed_baseline.sql";
export const invitationLifecycleAttestation = "944_invitation_lifecycle_reviewed_baseline.sql";
export const notificationContextAttestation = "946_notification_context_reviewed_baseline.sql";
const notificationContextDigest = "f0945012aefce28d53349c5167b0c3bb33da19efba9197f09a1b71fe28586b3b";
const invitationLifecycleDigest = "58bdec00a6f1d0c7d14dfeba763ce932e3da112af0e21788c32857661890b4ef";
const integratedDigest = "bda8c73b1ad3cd8b824c643ab5b8d5709719bc291a216c7ed92a77fcc3a3ec31";
const mareDigest = "280d4aae4b1e80e22369c610be819f31c42ef37daab025534b46c3563a2ead2a";
const workDigest = "bb282a2c4cf9593107b79eac81120d84c3bd9198aae49e2d0e2caa142f491d22";
const tenantCommandDigest = "124213c62b53f1680e064e3f5444b578a30a9378009ae50655300675e056a592";
const publicationMigration = "931_meeting_report_publication.sql";
const receiptMigration = "929_organization_deletion_operator_receipt.sql";
const transition = "CORE_928_PUBLICATION_931_TO_934";
const priorFingerprint = "bf26181b4fb02c3941673a3378cb2076665458f8f4f6388bce97eb19569fb4f2";
const priorSource = "1bec073c3e3ce3add94bfe4fe20a406be0c00d2bc46252be68a38f7b7f0c59f7";
const historicalSourceDigest = "fa7fecf8a79eaf40436e27bbfe2150b7b61b569654bee32ca214c62549216175";
const historicalReceiptChecksum = "ffb9e346339bbd7d31e6746a20cd36d751aff59985afca65d2304f14c8b2b2a9";
// Independently reproduced from the immutable historical manifest plus 931.
// This constant is never learned from the target database.
export const corePublicationFingerprint = "77ff37118d0f491e9a44b832ef9ba16d0a3b4feef229c4ebb718ca6aa77f1f97";
const migrationsDirectory = new URL("../migrations/", import.meta.url);
export type MigrationSource = { name: string; source: string; checksum: string };
export type MigrationPlan = {
  selected: MigrationSource[];
  sources: Map<string, MigrationSource>;
  historical: Map<string, string>;
  deferred: string[];
  review?: { schemaFingerprint: string; sourceSnapshotSha256: string };
  mareReview?: { schemaFingerprint: string; sourceSnapshotSha256: string };
  workReview?: { schemaFingerprint: string; sourceSnapshotSha256: string };
  tenantCommandReview?: { schemaFingerprint: string; sourceSnapshotSha256: string };
  invitationLifecycleReview?: { schemaFingerprint: string; sourceSnapshotSha256: string };
  notificationContextReview?: { schemaFingerprint: string; sourceSnapshotSha256: string };
};
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Selection remains literal. Only the execution order around the original
 * reviewed checkpoints is changed, using a closed, checksum-verified manifest. */
export async function loadMigrationPlan(selection: MigrationSelection, directory = migrationsDirectory): Promise<MigrationPlan> {
  const migrationsDirectory = directory;
  const names = (await readdir(migrationsDirectory)).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name));
  const sources = new Map<string, MigrationSource>();
  for (const name of names) {
    const source = await readFile(new URL(name, migrationsDirectory), "utf8");
    sources.set(name, { name, source, checksum: sha256(source) });
  }
  const manifest = JSON.parse(await readFile(new URL("reviewed/historical-930.json", migrationsDirectory), "utf8")) as {
    migrations: { name: string; checksum: string }[]; deferredAfter930: string[];
  };
  const historical = new Map(manifest.migrations.map(item => [item.name, item.checksum]));
  if (historical.size !== 154 || historical.size !== manifest.migrations.length)
    throw Error("INVALID_HISTORICAL_MIGRATION_MANIFEST");
  const snapshot = await readFile(new URL(`reviewed/orgmap-reviewed-source-${historicalSourceDigest}.sha256`, migrationsDirectory), "utf8");
  if (sha256(snapshot) !== historicalSourceDigest) throw Error("HISTORICAL_SOURCE_SNAPSHOT_MISMATCH");
  const original = new Map<string, string>();
  for (const line of snapshot.trimEnd().split("\n")) {
    const match = /^([a-f0-9]{64})  server\/migrations\/(\d{3}_[a-z0-9_]+\.sql)$/.exec(line);
    if (match) original.set(match[2], match[1]);
  }
  original.set(receiptAttestation, historicalReceiptChecksum);
  if (original.size !== historical.size || [...original].some(([name, checksum]) => historical.get(name) !== checksum))
    throw Error("HISTORICAL_MIGRATION_MANIFEST_MISMATCH");
  for (const [name, checksum] of historical) {
    if (sources.get(name)?.checksum !== checksum) throw Error(`HISTORICAL_MIGRATION_SOURCE_MISMATCH: ${name}`);
  }
  const deferred = manifest.deferredAfter930;
  if (JSON.stringify(deferred) !== JSON.stringify([
    "033_structure_definition_items.sql", "034_governance_model.sql",
    "050_o2_meeting_panel.sql", "051_o2_meeting_configuration.sql",
  ])) throw Error("INVALID_DEFERRED_MIGRATION_MANIFEST");
  const selected = selectMigrationNames(names, selection);
  if (selected.some(name => /^93[5-7]_/.test(name)) && !selected.includes(mareAttestation))
    throw Error("MIGRATION_MARE_REQUIRES_938");
  if (selected.some(name => /^939_/.test(name)) && !selected.includes(workAttestation))
    throw Error("MIGRATION_WORK_REQUIRES_940");
  if (selected.some(name => /^941_/.test(name)) && !selected.includes(tenantCommandAttestation))
    throw Error("MIGRATION_TENANT_COMMAND_REQUIRES_942");
  if (selected.includes(integratedAttestation) && selected.some(name => /^943_/.test(name)) && !selected.includes(invitationLifecycleAttestation))
    throw Error("MIGRATION_INVITATION_LIFECYCLE_REQUIRES_944");
  if (selected.includes(integratedAttestation) && selected.some(name => /^945_/.test(name)) && !selected.includes(notificationContextAttestation))
    throw Error("MIGRATION_NOTIFICATION_CONTEXT_REQUIRES_946");
  let ordered = selected;
  if (selected.includes(receiptAttestation)) {
    for (const name of selected) {
      if (Number(name.slice(0, 3)) <= 930 && !historical.has(name) && !deferred.includes(name))
        throw Error(`UNREVIEWED_PRE_BASELINE_MIGRATION: ${name}`);
    }
    ordered = [
      ...selected.filter(name => historical.has(name)),
      ...deferred.filter(name => selected.includes(name)),
      ...selected.filter(name => !historical.has(name) && !deferred.includes(name)),
    ];
  } else if (selected.some(name => /^92[89]_/.test(name)) && deferred.some(name => selected.includes(name))) {
    throw Error("HISTORICAL_CHECKPOINT_REQUIRES_COMPLETE_PLAN");
  }
  let review: MigrationPlan["review"];
  if (selected.includes(integratedAttestation)) {
    const source = await readFile(new URL("reviewed/integrated-934.json", migrationsDirectory), "utf8");
    if (sha256(source) !== integratedDigest) throw Error("INTEGRATED_REVIEW_DIGEST_MISMATCH");
    const reviewed = JSON.parse(source) as { schemaFingerprint: string; migrations: { name: string; checksum: string }[] };
    for (const entry of reviewed.migrations) {
      if (sources.get(entry.name)?.checksum !== entry.checksum) throw Error(`REVIEWED_MIGRATION_SOURCE_MISMATCH: ${entry.name}`);
    }
    review = { schemaFingerprint: reviewed.schemaFingerprint, sourceSnapshotSha256: sha256(source) };
  }
  let mareReview: MigrationPlan["mareReview"];
  if (sources.has(mareAttestation)) {
    const source = await readFile(new URL("reviewed/mare-938.json", migrationsDirectory), "utf8");
    if (sha256(source) !== mareDigest) throw Error("MARE_REVIEW_DIGEST_MISMATCH");
    const reviewed = JSON.parse(source) as { format: string; postgresMajor: number; through: number; predecessorSnapshotSha256: string; schemaFingerprint: string; migrations: {name:string; checksum:string}[] };
    if (reviewed.format !== "orgmap-mare-reviewed-schema-v1" || reviewed.postgresMajor !== 18 || reviewed.through !== 937 || reviewed.predecessorSnapshotSha256 !== integratedDigest || !/^[a-f0-9]{64}$/.test(reviewed.schemaFingerprint)) throw Error("INVALID_MARE_REVIEW");
    const integrated = JSON.parse(await readFile(new URL("reviewed/integrated-934.json", migrationsDirectory), "utf8")) as {migrations:{name:string;checksum:string}[]};
    const expectedNames = names.filter(name => Number(name.slice(0,3)) <= 937).sort();
    const all = [...integrated.migrations, ...reviewed.migrations];
    if (reviewed.migrations.length !== 4 || all.length !== 165 || new Set(all.map(e => e.name)).size !== all.length || JSON.stringify(all.map(e => e.name).sort()) !== JSON.stringify(expectedNames) || reviewed.migrations.some((e,i) => Number(e.name.slice(0,3)) !== 934+i || sources.get(e.name)?.checksum !== e.checksum)) throw Error("MARE_REVIEW_SOURCE_MISMATCH");
    mareReview = { schemaFingerprint: reviewed.schemaFingerprint, sourceSnapshotSha256: sha256(source) };
  }
  let workReview: MigrationPlan["workReview"];
  if (sources.has(workAttestation)) {
    const source = await readFile(new URL("reviewed/work-940.json", migrationsDirectory), "utf8");
    if (sha256(source) !== workDigest) throw Error("WORK_REVIEW_DIGEST_MISMATCH");
    const reviewed = JSON.parse(source) as { format: string; postgresMajor: number; through: number; predecessorSnapshotSha256: string; schemaFingerprint: string; migrations: {name:string; checksum:string}[] };
    if (reviewed.format !== "orgmap-work-reviewed-schema-v1" || reviewed.postgresMajor !== 18 || reviewed.through !== 939 || reviewed.predecessorSnapshotSha256 !== mareDigest || !/^[a-f0-9]{64}$/.test(reviewed.schemaFingerprint)) throw Error("INVALID_WORK_REVIEW");
    const integrated = JSON.parse(await readFile(new URL("reviewed/integrated-934.json", migrationsDirectory), "utf8")) as {migrations:{name:string;checksum:string}[]};
    const mare = JSON.parse(await readFile(new URL("reviewed/mare-938.json", migrationsDirectory), "utf8")) as {migrations:{name:string;checksum:string}[]};
    const all = [...integrated.migrations, ...mare.migrations, ...reviewed.migrations];
    const expectedNames = names.filter(name => Number(name.slice(0,3)) <= 939).sort();
    if (!mareReview || reviewed.migrations.length !== 2 || all.length !== 167 || new Set(all.map(e => e.name)).size !== all.length || JSON.stringify(all.map(e => e.name).sort()) !== JSON.stringify(expectedNames) || reviewed.migrations.some((e,i) => Number(e.name.slice(0,3)) !== 938+i || sources.get(e.name)?.checksum !== e.checksum)) throw Error("WORK_REVIEW_SOURCE_MISMATCH");
    workReview = { schemaFingerprint: reviewed.schemaFingerprint, sourceSnapshotSha256: sha256(source) };
  }
  let tenantCommandReview: MigrationPlan["tenantCommandReview"];
  if (sources.has(tenantCommandAttestation)) {
    const source = await readFile(new URL("reviewed/tenant-command-942.json", migrationsDirectory), "utf8");
    if (sha256(source) !== tenantCommandDigest) throw Error("TENANT_COMMAND_REVIEW_DIGEST_MISMATCH");
    const reviewed = JSON.parse(source) as {
      scope: string; sourceSha256: string; previousReviewedFingerprint: string;
      previousReviewedSnapshotSha256: string; measuredFingerprint: string;
    };
    if (!workReview || reviewed.scope !== "941_tenant_command_root_definitions.sql" ||
      reviewed.sourceSha256 !== sources.get(reviewed.scope)?.checksum ||
      reviewed.previousReviewedFingerprint !== workReview.schemaFingerprint ||
      reviewed.previousReviewedSnapshotSha256 !== workReview.sourceSnapshotSha256 ||
      !/^[a-f0-9]{64}$/.test(reviewed.measuredFingerprint) ||
      !sources.has(tenantCommandAttestation)) throw Error("TENANT_COMMAND_REVIEW_SOURCE_MISMATCH");
    tenantCommandReview = { schemaFingerprint: reviewed.measuredFingerprint, sourceSnapshotSha256: sha256(source) };
  }
  let invitationLifecycleReview: MigrationPlan["invitationLifecycleReview"];
  if (sources.has(invitationLifecycleAttestation)) {
    const source = await readFile(new URL("reviewed/invitation-lifecycle-944.json", migrationsDirectory), "utf8");
    if (sha256(source) !== invitationLifecycleDigest) throw Error("INVITATION_LIFECYCLE_REVIEW_DIGEST_MISMATCH");
    const reviewed = JSON.parse(source) as { scope: string; sourceSha256: string; previousReviewedFingerprint: string; previousReviewedSnapshotSha256: string; measuredFingerprint: string };
    if (!tenantCommandReview || reviewed.scope !== "943_invitation_lifecycle.sql" || reviewed.sourceSha256 !== sources.get(reviewed.scope)?.checksum ||
      reviewed.previousReviewedFingerprint !== tenantCommandReview.schemaFingerprint || reviewed.previousReviewedSnapshotSha256 !== tenantCommandReview.sourceSnapshotSha256 ||
      !/^[a-f0-9]{64}$/.test(reviewed.measuredFingerprint)) throw Error("INVITATION_LIFECYCLE_REVIEW_SOURCE_MISMATCH");
    invitationLifecycleReview = { schemaFingerprint: reviewed.measuredFingerprint, sourceSnapshotSha256: sha256(source) };
  }
  let notificationContextReview: MigrationPlan["notificationContextReview"];
  if (sources.has(notificationContextAttestation)) {
    const source = await readFile(new URL("reviewed/notification-context-946.json", migrationsDirectory), "utf8");
    if (sha256(source) !== notificationContextDigest) throw Error("NOTIFICATION_CONTEXT_REVIEW_DIGEST_MISMATCH");
    const reviewed = JSON.parse(source) as {scope:string;sourceSha256:string;previousReviewedFingerprint:string;previousReviewedSnapshotSha256:string;measuredFingerprint:string};
    if (!invitationLifecycleReview || reviewed.scope !== "945_notification_context.sql" || reviewed.sourceSha256 !== sources.get(reviewed.scope)?.checksum ||
      reviewed.previousReviewedFingerprint !== invitationLifecycleReview.schemaFingerprint || reviewed.previousReviewedSnapshotSha256 !== invitationLifecycleReview.sourceSnapshotSha256 ||
      !/^[a-f0-9]{64}$/.test(reviewed.measuredFingerprint)) throw Error("NOTIFICATION_CONTEXT_REVIEW_SOURCE_MISMATCH");
    notificationContextReview={schemaFingerprint:reviewed.measuredFingerprint,sourceSnapshotSha256:sha256(source)};
  }
  return { sources, historical, deferred, selected: ordered.map(name => sources.get(name)!), review, mareReview, workReview, tenantCommandReview, invitationLifecycleReview, notificationContextReview };
}

/** Replay may select an older prefix; authority follows the latest applied pin. */
function appliedReview(plan: MigrationPlan, applied: ReadonlyMap<string, string | null>) {
  return applied.has(notificationContextAttestation) ? plan.notificationContextReview : applied.has(invitationLifecycleAttestation) ? plan.invitationLifecycleReview : applied.has(tenantCommandAttestation) ? plan.tenantCommandReview : applied.has(workAttestation) ? plan.workReview : applied.has(mareAttestation) ? plan.mareReview : plan.review;
}

/** Only the recorded 930 attestation can be superseded. It remains absent from
 * schema_migrations: the journal never claims that its SQL was executed. */
export async function hasReviewedReceiptReconciliation(
  c: Pick<PoolClient, "query">, plan: MigrationPlan, applied: ReadonlyMap<string, string | null>,
  baselineAccess: "private" | "readiness" = "private",
): Promise<boolean> {
  if (applied.has(receiptAttestation)) return false;
  const superseding = plan.sources.get(integratedAttestation);
  if (!superseding || applied.get(integratedAttestation) !== superseding.checksum || !plan.review) return false;
  if (!(await c.query("SELECT to_regclass('public.schema_migration_reconciliations') AS relation")).rows[0]?.relation) return false;
  const row = (await c.query(
    "SELECT * FROM schema_migration_reconciliations WHERE migration_name=$1", [receiptAttestation],
  )).rows[0];
  const journalValid = !!row && row.migration_checksum === plan.sources.get(receiptAttestation)?.checksum &&
    row.superseding_migration === integratedAttestation && row.superseding_checksum === superseding.checksum &&
    row.transition === transition && row.from_schema_fingerprint === corePublicationFingerprint &&
    row.from_baseline_fingerprint === priorFingerprint && row.from_reviewed_snapshot_sha256 === priorSource;
  if (!journalValid) return false;
  // The application cannot read the private baseline. Its existing restricted
  // boolean function validates the live schema against that authoritative pin.
  // Migrator replay additionally checks the exact reviewed source/fingerprint.
  if (baselineAccess === "readiness")
    return (await c.query("SELECT orgmap_migration_schema_ready() AS ready")).rows[0]?.ready === true;
  const baseline = (await c.query("SELECT fingerprint,reviewed_snapshot_sha256 FROM organization_deletion_schema_baseline WHERE singleton")).rows[0];
  const review = appliedReview(plan, applied);
  return !!review && baseline?.fingerprint === review.schemaFingerprint && baseline.reviewed_snapshot_sha256 === review.sourceSnapshotSha256;
}

/** Called under the migrator's transaction and schema lock, before applying any
 * pending SQL. Unknown partial fixture states are held for explicit recovery. */
export async function classifyMigrationUpgrade(
  c: Pick<PoolClient, "query">, plan: MigrationPlan, applied: ReadonlyMap<string, string | null>,
): Promise<"NATIVE" | "RECONCILED" | "CORE_PUBLICATION" | "LEGACY_PRE_508"> {
  if ([...applied.keys()].some(name => !plan.sources.has(name))) throw Error("MIGRATION_LEDGER_NOT_RECOGNIZED");
  if (applied.has(integratedAttestation) && [...applied.keys()].some(name => /^943_/.test(name)) && !applied.has(invitationLifecycleAttestation)) throw Error("MIGRATION_INVITATION_LIFECYCLE_LEDGER_INCOMPLETE");
  if (applied.has(invitationLifecycleAttestation) && (!plan.invitationLifecycleReview || [tenantCommandAttestation, "943_invitation_lifecycle.sql", invitationLifecycleAttestation].some(name => applied.get(name) !== plan.sources.get(name)?.checksum))) throw Error("MIGRATION_INVITATION_LIFECYCLE_LEDGER_INCOMPLETE");
  if (applied.has(integratedAttestation) && [...applied.keys()].some(name => /^945_/.test(name)) && !applied.has(notificationContextAttestation)) throw Error("MIGRATION_NOTIFICATION_CONTEXT_LEDGER_INCOMPLETE");
  if (applied.has(notificationContextAttestation) && (!plan.notificationContextReview || [invitationLifecycleAttestation,"945_notification_context.sql",notificationContextAttestation].some(name=>applied.get(name)!==plan.sources.get(name)?.checksum))) throw Error("MIGRATION_NOTIFICATION_CONTEXT_LEDGER_INCOMPLETE");
  if ([...applied.keys()].some(name => /^941_/.test(name)) && !applied.has(tenantCommandAttestation)) throw Error("MIGRATION_TENANT_COMMAND_LEDGER_INCOMPLETE");
  if (applied.has(tenantCommandAttestation) && (!plan.tenantCommandReview || [workAttestation, "941_tenant_command_root_definitions.sql", tenantCommandAttestation].some(name => applied.get(name) !== plan.sources.get(name)?.checksum))) throw Error("MIGRATION_TENANT_COMMAND_LEDGER_INCOMPLETE");
  if ([...applied.keys()].some(name => /^939_/.test(name)) && !applied.has(workAttestation)) throw Error("MIGRATION_WORK_LEDGER_INCOMPLETE");
  if (applied.has(workAttestation) && (!plan.workReview || [mareAttestation, "939_work_project_extensions.sql", workAttestation].some(name => applied.get(name) !== plan.sources.get(name)?.checksum))) throw Error("MIGRATION_WORK_LEDGER_INCOMPLETE");
  if ([...applied.keys()].some(name => /^93[5-7]_/.test(name)) && !applied.has(mareAttestation)) throw Error("MIGRATION_MARE_LEDGER_INCOMPLETE");
  if (applied.has(mareAttestation) && (!plan.mareReview || [integratedAttestation, ...[...plan.sources.keys()].filter(name => /^93[5-7]_/.test(name)), mareAttestation].some(name => applied.get(name) !== plan.sources.get(name)?.checksum))) throw Error("MIGRATION_MARE_LEDGER_INCOMPLETE");
  if (applied.has(integratedAttestation) && plan.selected.some(item => item.name === integratedAttestation)) {
    const actual = (await c.query("SELECT orgmap_deletion_schema_fingerprint_internal() AS fingerprint")).rows[0]?.fingerprint;
    const review = appliedReview(plan, applied);
    const checkpoint = applied.has(notificationContextAttestation) ? 946 : applied.has(invitationLifecycleAttestation) ? 944 : applied.has(tenantCommandAttestation) ? 942 : applied.has(workAttestation) ? 940 : applied.has(mareAttestation) ? 938 : 934;
    if ([...plan.sources.values()].some(item => Number(item.name.slice(0,3)) <= checkpoint && item.name !== receiptAttestation && applied.get(item.name) !== item.checksum)) throw Error("MIGRATION_REVIEWED_LEDGER_INCOMPLETE");
    if (!review || actual !== review.schemaFingerprint) throw Error("MIGRATION_REVIEWED_SCHEMA_MISMATCH");
    const baseline = (await c.query("SELECT fingerprint,reviewed_snapshot_sha256 FROM organization_deletion_schema_baseline WHERE singleton")).rows[0];
    if (baseline?.fingerprint !== review.schemaFingerprint || baseline.reviewed_snapshot_sha256 !== review.sourceSnapshotSha256)
      throw Error("MIGRATION_REVIEWED_BASELINE_MISMATCH");
  }
  if (!plan.selected.some(item => item.name === receiptAttestation) || applied.has(receiptAttestation)) return "NATIVE";
  if (await hasReviewedReceiptReconciliation(c, plan, applied)) return "RECONCILED";
  // Old installations through 507 include all four later-deferred additive
  // migrations. Recognize only the complete, checksum-matched 507 ledger; the
  // bridge independently verifies its live schema at the 927 boundary.
  const legacy507 = [...plan.sources.values()].filter(item => Number(item.name.slice(0,3)) <= 507);
  if (applied.size === legacy507.length && legacy507.every(item => applied.get(item.name) === item.checksum)) {
    if (!plan.selected.some(item => item.name === integratedAttestation)) throw Error('MIGRATION_LEGACY_REQUIRES_934');
    return "LEGACY_PRE_508";
  }
  if (applied.has(integratedAttestation) || plan.deferred.some(name => applied.has(name)))
    throw Error("MIGRATION_REVIEWED_BASELINE_RECOVERY_REQUIRED");
  if (!applied.has(publicationMigration)) return "NATIVE";
  if (!plan.selected.some(item => item.name === integratedAttestation))
    throw Error("MIGRATION_CORE_UPGRADE_REQUIRES_934");
  const expected = new Map([...plan.historical].filter(([name]) => name !== receiptAttestation && name !== receiptMigration));
  expected.set(publicationMigration, plan.sources.get(publicationMigration)!.checksum);
  if (applied.size !== expected.size || [...expected].some(([name, checksum]) => applied.get(name) !== checksum))
    throw Error("MIGRATION_CORE_LEDGER_NOT_RECOGNIZED");
  const baseline = (await c.query("SELECT fingerprint,reviewed_snapshot_sha256 FROM organization_deletion_schema_baseline WHERE singleton")).rows[0];
  if (baseline?.fingerprint !== priorFingerprint || baseline.reviewed_snapshot_sha256 !== priorSource)
    throw Error("MIGRATION_CORE_BASELINE_NOT_RECOGNIZED");
  const actual = (await c.query("SELECT orgmap_deletion_schema_fingerprint_internal() AS fingerprint")).rows[0]?.fingerprint;
  if (actual !== corePublicationFingerprint) throw Error("MIGRATION_CORE_SCHEMA_NOT_RECOGNIZED");
  return "CORE_PUBLICATION";
}

export async function recordReceiptReconciliation(
  c: Pick<PoolClient, "query">, plan: MigrationPlan, applied: ReadonlyMap<string, string | null>,
): Promise<void> {
  const superseding = plan.sources.get(integratedAttestation)!;
  if (applied.get(integratedAttestation) !== superseding.checksum || !plan.review)
    throw Error("MIGRATION_RECONCILIATION_ATTESTATION_REQUIRED");
  const baseline = (await c.query("SELECT fingerprint,reviewed_snapshot_sha256 FROM organization_deletion_schema_baseline WHERE singleton")).rows[0];
  if (baseline?.fingerprint !== plan.review.schemaFingerprint || baseline.reviewed_snapshot_sha256 !== plan.review.sourceSnapshotSha256)
    throw Error("MIGRATION_RECONCILIATION_ATTESTATION_REQUIRED");
  await c.query(`INSERT INTO schema_migration_reconciliations
    (migration_name,migration_checksum,superseding_migration,superseding_checksum,transition,
     from_schema_fingerprint,from_baseline_fingerprint,from_reviewed_snapshot_sha256)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [receiptAttestation, plan.sources.get(receiptAttestation)!.checksum,
    integratedAttestation, superseding.checksum, transition, corePublicationFingerprint, priorFingerprint, priorSource]);
}
