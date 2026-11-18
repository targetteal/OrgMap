-- Independently measured through 939 in two disposable PostgreSQL 18 databases.
-- Source review: server/migrations/reviewed/work-940.json
DO $$
DECLARE
 reviewed constant text := 'ac714b95a8ffe26855ee086451e65e432de62a10486a5ecef48678c1e12e3ff8';
 source_digest constant text := 'bb282a2c4cf9593107b79eac81120d84c3bd9198aae49e2d0e2caa142f491d22';
 prior record;
BEGIN
 PERFORM pg_advisory_xact_lock(730184);
 IF public.orgmap_deletion_schema_fingerprint_internal() IS DISTINCT FROM reviewed THEN
  RAISE EXCEPTION 'DELETION_REVIEWED_SCHEMA_MISMATCH' USING ERRCODE='55000';
 END IF;
 SELECT fingerprint,reviewed_snapshot_sha256 INTO prior
  FROM public.organization_deletion_schema_baseline WHERE singleton FOR UPDATE;
 IF NOT FOUND OR prior.fingerprint IS DISTINCT FROM 'e07243183515cbc26aa36b91cda52504685f8aa1eceffef48c52eb4a87a8f164'
  OR prior.reviewed_snapshot_sha256 IS DISTINCT FROM '280d4aae4b1e80e22369c610be819f31c42ef37daab025534b46c3563a2ead2a' THEN
  RAISE EXCEPTION 'DELETION_REVIEWED_BASELINE_CONFLICT' USING ERRCODE='55000';
 END IF;
 UPDATE public.organization_deletion_schema_baseline
  SET fingerprint=reviewed,reviewed_snapshot_sha256=source_digest WHERE singleton;
END $$;
