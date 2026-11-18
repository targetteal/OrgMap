-- Private supervisor authority for confirming an externally durable tombstone.
-- This role is trusted to read the real ledger; SQL cannot inspect the file.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='orgmap_lifecycle_ledger_confirm') THEN
  CREATE ROLE orgmap_lifecycle_ledger_confirm NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='orgmap_lifecycle_ledger_confirm' AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)) OR pg_has_role('orgmap_app','orgmap_lifecycle_ledger_confirm','MEMBER') THEN
  RAISE EXCEPTION 'LEDGER_CONFIRM_GROUP_UNSAFE';
 END IF;
END $$;
CREATE FUNCTION orgmap_ledger_confirmation_read(p_org uuid,p_job uuid,p_authority uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j record; l record;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'DELETION_READ_COMMITTED_REQUIRED' USING ERRCODE='25001'; END IF;
 IF NOT pg_has_role(session_user,'orgmap_lifecycle_ledger_confirm','MEMBER') OR pg_has_role(session_user,'orgmap_app','MEMBER') OR
   NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND rolcanlogin AND NOT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)) THEN RAISE EXCEPTION 'LEDGER_CONFIRM_AUTHORITY_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=p_org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LEDGER_CONFIRM_TARGET_INVALID' USING ERRCODE='42501'; END IF;
 SELECT * INTO l FROM public.organization_lifecycle WHERE organization_id=p_org;
 SELECT * INTO j FROM public.organization_deletion_jobs WHERE organization_id=p_org AND id=p_job FOR UPDATE;
 IF NOT FOUND OR l.state NOT IN ('DELETION_PENDING','PURGING') OR l.fence IS DISTINCT FROM j.lifecycle_fence OR j.accepted_fence>j.lifecycle_fence OR
   j.state NOT IN ('PENDING','RUNNING') OR j.phase<>'QUIESCE' OR p_authority IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.organization_runtime_identity i JOIN public.organization_runtime_mode m USING(singleton)
    WHERE i.singleton AND m.managed AND i.authority_id=p_authority) THEN
  RAISE EXCEPTION 'LEDGER_CONFIRM_JOB_INVALID' USING ERRCODE='42501'; END IF;
 IF j.ledger_state='CONFIRMED' AND (j.ledger_authority_id IS DISTINCT FROM p_authority OR j.ledger_record_sha256 IS NULL) THEN
  RAISE EXCEPTION 'LEDGER_CONFIRM_CONFLICT' USING ERRCODE='42501'; END IF;
 IF j.ledger_state='PENDING' AND (j.ledger_authority_id IS NOT NULL OR j.ledger_record_sha256 IS NOT NULL) THEN
  RAISE EXCEPTION 'LEDGER_CONFIRM_CONFLICT' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('organizationId',p_org::text,'jobId',p_job::text,'fence',j.accepted_fence::text,
  'acceptedAt',to_char(date_trunc('milliseconds',j.accepted_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'ledgerState',j.ledger_state,'recordSha256',j.ledger_record_sha256);
END $$;
CREATE FUNCTION orgmap_ledger_confirmation_commit(p_org uuid,p_job uuid,p_authority uuid,p_fence bigint,p_accepted_at timestamptz,p_hash text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j jsonb; expected_hash text;
BEGIN
 j:=public.orgmap_ledger_confirmation_read(p_org,p_job,p_authority);
 IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR (j->>'fence')::bigint IS DISTINCT FROM p_fence OR
    (j->>'acceptedAt')::timestamptz IS DISTINCT FROM p_accepted_at THEN RAISE EXCEPTION 'LEDGER_CONFIRM_ENTRY_MISMATCH' USING ERRCODE='42501'; END IF;
 expected_hash:=encode(sha256(convert_to(format('{"organizationId":"%s","jobId":"%s","fence":"%s","acceptedAt":"%s"}',p_org::text,p_job::text,j->>'fence',j->>'acceptedAt'),'UTF8')),'hex');
 IF p_hash IS DISTINCT FROM expected_hash THEN RAISE EXCEPTION 'LEDGER_CONFIRM_HASH_MISMATCH' USING ERRCODE='42501'; END IF;
 IF j->>'ledgerState'='CONFIRMED' THEN
  IF j->>'recordSha256' IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'LEDGER_CONFIRM_CONFLICT' USING ERRCODE='42501'; END IF;
  RETURN;
 END IF;
 UPDATE public.organization_deletion_jobs SET ledger_state='CONFIRMED',ledger_authority_id=p_authority,ledger_record_sha256=p_hash,updated_at=clock_timestamp()
 WHERE organization_id=p_org AND id=p_job AND ledger_state='PENDING';
 IF NOT FOUND THEN RAISE EXCEPTION 'LEDGER_CONFIRM_CONFLICT' USING ERRCODE='40001'; END IF;
END $$;
REVOKE ALL ON FUNCTION orgmap_ledger_confirmation_read(uuid,uuid,uuid),orgmap_ledger_confirmation_commit(uuid,uuid,uuid,bigint,timestamptz,text) FROM PUBLIC,orgmap_app,orgmap_lifecycle_maintenance;
GRANT EXECUTE ON FUNCTION orgmap_ledger_confirmation_read(uuid,uuid,uuid),orgmap_ledger_confirmation_commit(uuid,uuid,uuid,bigint,timestamptz,text) TO orgmap_lifecycle_ledger_confirm;
