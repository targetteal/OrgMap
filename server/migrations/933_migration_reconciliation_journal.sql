-- Database metadata, never tenant payload. An exceptional attestation upgrade
-- records its actual disposition instead of forging an executed migration row.
CREATE TABLE schema_migration_reconciliations (
 migration_name text PRIMARY KEY CHECK(migration_name='930_organization_deletion_receipt_reviewed_baseline.sql'),
 migration_checksum text NOT NULL CHECK(migration_checksum ~ '^[a-f0-9]{64}$'),
 superseding_migration text NOT NULL CHECK(superseding_migration='934_integrated_reviewed_schema_baseline.sql'),
 superseding_checksum text NOT NULL CHECK(superseding_checksum ~ '^[a-f0-9]{64}$'),
 transition text NOT NULL CHECK(transition='CORE_928_PUBLICATION_931_TO_934'),
 from_schema_fingerprint text NOT NULL CHECK(from_schema_fingerprint ~ '^[a-f0-9]{64}$'),
 from_baseline_fingerprint text NOT NULL CHECK(from_baseline_fingerprint ~ '^[a-f0-9]{64}$'),
 from_reviewed_snapshot_sha256 text NOT NULL CHECK(from_reviewed_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
 reconciled_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON schema_migration_reconciliations FROM PUBLIC,orgmap_app;
GRANT SELECT ON schema_migration_reconciliations TO orgmap_app;

-- Public readiness may learn a boolean, never a fingerprint or tenant data.
-- The same schema lock and private fingerprint calculator remain authoritative.
CREATE FUNCTION orgmap_migration_schema_ready() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE expected text;
BEGIN
 PERFORM pg_advisory_xact_lock(730184);
 SELECT fingerprint INTO expected FROM public.organization_deletion_schema_baseline WHERE singleton;
 RETURN expected IS NOT NULL AND public.orgmap_deletion_schema_fingerprint_internal()=expected;
END $$;
REVOKE ALL ON FUNCTION orgmap_migration_schema_ready() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION orgmap_migration_schema_ready() TO orgmap_app;
