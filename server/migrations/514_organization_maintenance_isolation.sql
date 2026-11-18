-- Additive guard: a post-lock fresh snapshot is required by this protocol.
CREATE OR REPLACE FUNCTION orgmap_assert_deletion_maintenance(p_org uuid,p_job uuid,p_fence bigint,p_token uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j record; l record;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'DELETION_READ_COMMITTED_REQUIRED' USING ERRCODE='25001'; END IF;
 IF NOT pg_has_role(session_user,'orgmap_lifecycle_maintenance','MEMBER') OR pg_has_role(session_user,'orgmap_app','MEMBER') OR
    EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'DELETION_MAINTENANCE_AUTHORITY_REQUIRED' USING ERRCODE='42501';
 END IF;
 PERFORM 1 FROM public.organizations WHERE id=p_org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'DELETION_MAINTENANCE_TARGET_INVALID' USING ERRCODE='42501'; END IF;
 SELECT * INTO l FROM public.organization_lifecycle WHERE organization_id=p_org;
 SELECT * INTO j FROM public.organization_deletion_jobs WHERE organization_id=p_org AND id=p_job FOR UPDATE;
 IF NOT FOUND OR l.state NOT IN ('DELETION_PENDING','PURGING') OR l.fence<>p_fence OR
    j.lifecycle_fence<>p_fence OR j.ledger_state<>'CONFIRMED' OR j.state<>'RUNNING' OR
    j.lease_token IS DISTINCT FROM p_token OR p_token IS NULL OR j.lease_until<=clock_timestamp() THEN
  RAISE EXCEPTION 'DELETION_MAINTENANCE_LEASE_INVALID' USING ERRCODE='42501';
 END IF;
END $$;
