import type { PoolClient } from 'pg';
import type { MigrationPlan } from './migration-plan.js';

// The four additive migrations were installed before 508 on old hosts, but the
// reviewed 928/930 path executes them afterwards. This bridge runs only inside
// the migrator's uncommitted, schema-locked transaction for the exact 507 ledger.
const legacy927Fingerprint = '367ffd5b743e7c0e6b5fdb3d9f09bd01b9cae0657b0979aa2a8998668c3d2c66';
const reviewed927Fingerprint = 'bf26181b4fb02c3941673a3378cb2076665458f8f4f6388bce97eb19569fb4f2';
const deferredTables = [
  'structure_governance_models', 'structure_model_revisions',
  'structure_model_functions', 'structure_model_circles',
  'structure_model_occupancy_context', 'structure_model_events',
  'meeting_o2_panels', 'meeting_o2_processes', 'meeting_o2_treatments',
  'meeting_o2_circle_templates', 'meeting_o2_reviews',
] as const;

async function fingerprint(c: PoolClient): Promise<string> {
  return (await c.query('SELECT orgmap_deletion_schema_fingerprint_internal() AS fingerprint')).rows[0].fingerprint;
}

/** Called immediately before executing historical 928. No state escapes the transaction. */
export async function suspendLegacyDeferredSchema(c: PoolClient): Promise<void> {
  if (await fingerprint(c) !== legacy927Fingerprint) throw Error('MIGRATION_LEGACY_927_SCHEMA_NOT_RECOGNIZED');
  await c.query(`CREATE TEMP TABLE orgmap_legacy_entities ON COMMIT DROP AS
    SELECT organization_id,id,responsibilities,artifacts FROM public.entities`);
  for (const table of deferredTables)
    await c.query(`CREATE TEMP TABLE orgmap_legacy_${table} ON COMMIT DROP AS SELECT * FROM public.${table}`);
  await c.query(`DROP TABLE ${deferredTables.map(table => `public.${table}`).join(', ')}`);
  await c.query('ALTER TABLE public.entities DROP COLUMN responsibilities, DROP COLUMN artifacts');
  if (await fingerprint(c) !== reviewed927Fingerprint) throw Error('MIGRATION_LEGACY_928_BRIDGE_MISMATCH');
}

/** Called after 930, at the normal deferred position in the frozen plan. */
export async function restoreLegacyDeferredSchema(c: PoolClient, plan: MigrationPlan): Promise<void> {
  for (const name of plan.deferred) await c.query(plan.sources.get(name)!.source);
  await c.query(`UPDATE public.entities e SET responsibilities=s.responsibilities,artifacts=s.artifacts
    FROM pg_temp.orgmap_legacy_entities s WHERE e.organization_id=s.organization_id AND e.id=s.id`);
  for (const table of deferredTables) {
    await c.query(`INSERT INTO public.${table} SELECT * FROM pg_temp.orgmap_legacy_${table}`);
    const difference = (await c.query(`SELECT EXISTS(
      (SELECT to_jsonb(row) FROM pg_temp.orgmap_legacy_${table} row EXCEPT ALL SELECT to_jsonb(row) FROM public.${table} row)
      UNION ALL
      (SELECT to_jsonb(row) FROM public.${table} row EXCEPT ALL SELECT to_jsonb(row) FROM pg_temp.orgmap_legacy_${table} row)
    ) AS differs`)).rows[0].differs;
    if (difference) throw Error(`MIGRATION_LEGACY_DATA_MISMATCH: ${table}`);
  }
  const entityDifference = (await c.query(`SELECT EXISTS(
    (SELECT organization_id,id,responsibilities,artifacts FROM pg_temp.orgmap_legacy_entities
      EXCEPT ALL SELECT organization_id,id,responsibilities,artifacts FROM public.entities)
    UNION ALL
    (SELECT organization_id,id,responsibilities,artifacts FROM public.entities
      EXCEPT ALL SELECT organization_id,id,responsibilities,artifacts FROM pg_temp.orgmap_legacy_entities)
  ) AS differs`)).rows[0].differs;
  if (entityDifference) throw Error('MIGRATION_LEGACY_ENTITY_DATA_MISMATCH');
}
