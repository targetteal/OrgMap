-- Fingerprint independently measured after 941 in two disposable local databases.
-- Source review: server/migrations/reviewed/tenant-command-942.json
DO $$
DECLARE
  reviewed constant text := '3cad98db49494f4cf59ed4641cbb3da457fabb7eb93a240b3c4663892e9cd030';
  source_digest constant text := '124213c62b53f1680e064e3f5444b578a30a9378009ae50655300675e056a592';
  prior record;
BEGIN
  PERFORM pg_advisory_xact_lock(730184);
  IF public.orgmap_deletion_schema_fingerprint_internal() IS DISTINCT FROM reviewed THEN
    RAISE EXCEPTION 'DELETION_REVIEWED_SCHEMA_MISMATCH' USING ERRCODE='55000';
  END IF;
  SELECT fingerprint,reviewed_snapshot_sha256 INTO prior
    FROM public.organization_deletion_schema_baseline WHERE singleton FOR UPDATE;
  IF NOT FOUND
    OR prior.fingerprint IS DISTINCT FROM 'ac714b95a8ffe26855ee086451e65e432de62a10486a5ecef48678c1e12e3ff8'
    OR prior.reviewed_snapshot_sha256 IS DISTINCT FROM 'bb282a2c4cf9593107b79eac81120d84c3bd9198aae49e2d0e2caa142f491d22'
  THEN
    RAISE EXCEPTION 'DELETION_REVIEWED_BASELINE_CONFLICT' USING ERRCODE='55000';
  END IF;
  UPDATE public.organization_deletion_schema_baseline
    SET fingerprint=reviewed,reviewed_snapshot_sha256=source_digest WHERE singleton;
END $$;
