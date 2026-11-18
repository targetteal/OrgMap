-- Fingerprint independently measured after 943 in two disposable local databases.
-- Source review: server/migrations/reviewed/invitation-lifecycle-944.json
DO $$
DECLARE
  reviewed constant text := '5b04241a722887e94aaaac54a7fa6d93f169ddb503f4cb920ba26b46ec77a24e';
  source_digest constant text := '58bdec00a6f1d0c7d14dfeba763ce932e3da112af0e21788c32857661890b4ef';
  prior record;
BEGIN
  PERFORM pg_advisory_xact_lock(730184);
  IF public.orgmap_deletion_schema_fingerprint_internal() IS DISTINCT FROM reviewed THEN
    RAISE EXCEPTION 'DELETION_REVIEWED_SCHEMA_MISMATCH' USING ERRCODE='55000';
  END IF;
  SELECT fingerprint,reviewed_snapshot_sha256 INTO prior
    FROM public.organization_deletion_schema_baseline WHERE singleton FOR UPDATE;
  IF NOT FOUND
    OR prior.fingerprint IS DISTINCT FROM '3cad98db49494f4cf59ed4641cbb3da457fabb7eb93a240b3c4663892e9cd030'
    OR prior.reviewed_snapshot_sha256 IS DISTINCT FROM '124213c62b53f1680e064e3f5444b578a30a9378009ae50655300675e056a592'
  THEN
    RAISE EXCEPTION 'DELETION_REVIEWED_BASELINE_CONFLICT' USING ERRCODE='55000';
  END IF;
  UPDATE public.organization_deletion_schema_baseline
    SET fingerprint=reviewed,reviewed_snapshot_sha256=source_digest WHERE singleton;
END $$;
