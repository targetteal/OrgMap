import pg from "pg";
import { migrationSelectionFromEnvironment } from "./migration-selection.js";
import { loadMigrationPlan, classifyMigrationUpgrade, recordReceiptReconciliation, receiptAttestation, integratedAttestation } from "./migration-plan.js";
import { suspendLegacyDeferredSchema, restoreLegacyDeferredSchema } from './legacy-migration-bridge.js';
// Reject conflicting/invalid selections before opening a database connection.
const selection = migrationSelectionFromEnvironment(process.env);
// Freeze and validate every SQL buffer before opening a database connection.
const plan = await loadMigrationPlan(selection);
const p = new pg.Pool({
  connectionString:
    process.env.MIGRATION_DATABASE_URL ??
    "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap",
});
const c = await p.connect();
try {
  await c.query(
    "BEGIN; SELECT pg_advisory_xact_lock(730184); CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz DEFAULT now(),checksum text); ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text",
  );
  const applied = new Map<string, string | null>((await c.query("SELECT name,checksum FROM schema_migrations")).rows.map(row => [row.name,row.checksum]));
  for (const {name,checksum} of plan.selected) {
    if (applied.has(name)) {
      if (applied.get(name) === null)
        throw Error(
          `Legacy migration checksum missing: ${name}; explicit baseline required`,
        );
      if (applied.get(name) !== checksum)
        throw Error(`Migration checksum mismatch: ${name}`);
    }
  }
  const upgrade = await classifyMigrationUpgrade(c, plan, applied);
  let legacySuspended = false;
  for (const {name,source,checksum} of plan.selected) {
    if (upgrade === 'LEGACY_PRE_508' && name === '928_organization_deletion_reviewed_baseline.sql') {
      await suspendLegacyDeferredSchema(c);
      legacySuspended = true;
    }
    if (upgrade === 'LEGACY_PRE_508' && name === plan.deferred[0]) {
      if (!legacySuspended) throw Error('MIGRATION_LEGACY_BRIDGE_NOT_SUSPENDED');
      await restoreLegacyDeferredSchema(c,plan);
      legacySuspended = false;
    }
    if (applied.has(name) || (name === receiptAttestation && (upgrade === 'RECONCILED' || upgrade === 'CORE_PUBLICATION'))) continue;
      await c.query(source);
      await c.query(
        "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",
        [name, checksum],
      );
      applied.set(name,checksum);
      if (name === integratedAttestation && upgrade === "CORE_PUBLICATION") await recordReceiptReconciliation(c,plan,applied);
  }
  if (legacySuspended) throw Error('MIGRATION_LEGACY_BRIDGE_NOT_RESTORED');
  await c.query("COMMIT");
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  c.release();
  await p.end();
}
