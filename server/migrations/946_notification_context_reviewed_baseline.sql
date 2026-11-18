-- Fingerprint independently measured after 945 in two disposable local databases.
DO $$
DECLARE
  reviewed constant text := 'ad14da07cee4ebf73566b6dceb6c506790e459d0120de3f87c4bf80e22847f6a';
  source_digest constant text := 'f0945012aefce28d53349c5167b0c3bb33da19efba9197f09a1b71fe28586b3b';
  prior record;
BEGIN
  PERFORM pg_advisory_xact_lock(730184);
  IF public.orgmap_deletion_schema_fingerprint_internal() IS DISTINCT FROM reviewed THEN
    RAISE EXCEPTION 'DELETION_REVIEWED_SCHEMA_MISMATCH' USING ERRCODE='55000';
  END IF;
  SELECT fingerprint,reviewed_snapshot_sha256 INTO prior
    FROM public.organization_deletion_schema_baseline WHERE singleton FOR UPDATE;
  IF NOT FOUND OR prior.fingerprint IS DISTINCT FROM '5b04241a722887e94aaaac54a7fa6d93f169ddb503f4cb920ba26b46ec77a24e'
    OR prior.reviewed_snapshot_sha256 IS DISTINCT FROM '58bdec00a6f1d0c7d14dfeba763ce932e3da112af0e21788c32857661890b4ef' THEN
    RAISE EXCEPTION 'DELETION_REVIEWED_BASELINE_CONFLICT' USING ERRCODE='55000';
  END IF;
  UPDATE public.organization_deletion_schema_baseline
    SET fingerprint=reviewed,reviewed_snapshot_sha256=source_digest WHERE singleton;
END $$;
