-- Reviewed schema through 929, independently measured in two fresh PostgreSQL
-- databases. Only the previously reviewed baseline may advance to this pin.
-- Source snapshot: fa7fecf8a79eaf40436e27bbfe2150b7b61b569654bee32ca214c62549216175
DO $$
DECLARE
 reviewed constant text := 'df5b3d9a979266cdd887894afa839d37dbb1aa3f7630bc649acff9b76804e2f9';
 source_digest constant text := 'fa7fecf8a79eaf40436e27bbfe2150b7b61b569654bee32ca214c62549216175';
 prior record;
BEGIN
 PERFORM pg_advisory_xact_lock(730184);
 IF public.orgmap_deletion_schema_fingerprint_internal() IS DISTINCT FROM reviewed THEN
  RAISE EXCEPTION 'DELETION_REVIEWED_SCHEMA_MISMATCH' USING ERRCODE='55000';
 END IF;
 SELECT fingerprint,reviewed_snapshot_sha256 INTO prior FROM public.organization_deletion_schema_baseline WHERE singleton FOR UPDATE;
 IF NOT FOUND OR NOT ((prior.fingerprint='bf26181b4fb02c3941673a3378cb2076665458f8f4f6388bce97eb19569fb4f2' AND prior.reviewed_snapshot_sha256='1bec073c3e3ce3add94bfe4fe20a406be0c00d2bc46252be68a38f7b7f0c59f7') OR
   (prior.fingerprint=reviewed AND prior.reviewed_snapshot_sha256=source_digest)) THEN
  RAISE EXCEPTION 'DELETION_REVIEWED_BASELINE_CONFLICT' USING ERRCODE='55000';
 END IF;
 UPDATE public.organization_deletion_schema_baseline SET fingerprint=reviewed,reviewed_snapshot_sha256=source_digest WHERE singleton;
END $$;
