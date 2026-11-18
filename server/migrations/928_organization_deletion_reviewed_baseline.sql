-- Reviewed local schema through 927, measured independently in two fresh
-- PostgreSQL 18.6 databases. This pins schema semantics, not filesystem state,
-- provider outcomes, backup deletion, or an authorization to cut a tenant.
-- Source review: 1bec073c3e3ce3add94bfe4fe20a406be0c00d2bc46252be68a38f7b7f0c59f7
-- Measurement log SHA256: 4bf458ce3b98c7a8250b3c083d324534fdd15e84c9078cf874a6f60921484130
DO $$
DECLARE
 reviewed constant text := 'bf26181b4fb02c3941673a3378cb2076665458f8f4f6388bce97eb19569fb4f2';
 source_digest constant text := '1bec073c3e3ce3add94bfe4fe20a406be0c00d2bc46252be68a38f7b7f0c59f7';
 actual text;
BEGIN
 PERFORM pg_advisory_xact_lock(730184);
 actual := public.orgmap_deletion_schema_fingerprint_internal();
 IF actual IS DISTINCT FROM reviewed THEN
  RAISE EXCEPTION 'DELETION_REVIEWED_SCHEMA_MISMATCH' USING ERRCODE='55000';
 END IF;
 IF EXISTS(SELECT 1 FROM public.organization_deletion_schema_baseline
   WHERE fingerprint IS DISTINCT FROM reviewed OR reviewed_snapshot_sha256 IS DISTINCT FROM source_digest) THEN
  RAISE EXCEPTION 'DELETION_REVIEWED_BASELINE_CONFLICT' USING ERRCODE='55000';
 END IF;
 INSERT INTO public.organization_deletion_schema_baseline(singleton,fingerprint,reviewed_snapshot_sha256)
 VALUES(true,reviewed,source_digest) ON CONFLICT(singleton) DO NOTHING;
END $$;
