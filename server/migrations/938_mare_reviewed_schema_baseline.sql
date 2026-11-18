-- Independently measured through 937 in two disposable PostgreSQL 18 databases.
-- Source review: server/migrations/reviewed/mare-938.json
DO $$
DECLARE
 reviewed constant text := 'e07243183515cbc26aa36b91cda52504685f8aa1eceffef48c52eb4a87a8f164';
 source_digest constant text := '280d4aae4b1e80e22369c610be819f31c42ef37daab025534b46c3563a2ead2a';
 prior record;
BEGIN
 PERFORM pg_advisory_xact_lock(730184);
 IF public.orgmap_deletion_schema_fingerprint_internal() IS DISTINCT FROM reviewed THEN
  RAISE EXCEPTION 'DELETION_REVIEWED_SCHEMA_MISMATCH' USING ERRCODE='55000';
 END IF;
 SELECT fingerprint,reviewed_snapshot_sha256 INTO prior
  FROM public.organization_deletion_schema_baseline WHERE singleton FOR UPDATE;
 IF NOT FOUND OR prior.fingerprint IS DISTINCT FROM 'd3e02de6397aa0c9db77de4c675425d99503ea1b50025be56bbfa0c71902a802'
  OR prior.reviewed_snapshot_sha256 IS DISTINCT FROM 'bda8c73b1ad3cd8b824c643ab5b8d5709719bc291a216c7ed92a77fcc3a3ec31' THEN
  RAISE EXCEPTION 'DELETION_REVIEWED_BASELINE_CONFLICT' USING ERRCODE='55000';
 END IF;
 UPDATE public.organization_deletion_schema_baseline
  SET fingerprint=reviewed,reviewed_snapshot_sha256=source_digest WHERE singleton;
END $$;
