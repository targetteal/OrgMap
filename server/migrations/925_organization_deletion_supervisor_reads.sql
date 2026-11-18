-- Narrow private supervisor reads. They never confer teardown authority.
CREATE FUNCTION orgmap_deletion_supervisor_job(p_org uuid,p_job uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j record;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'DELETION_READ_COMMITTED_REQUIRED' USING ERRCODE='25001'; END IF;
 IF NOT pg_has_role(session_user,'orgmap_lifecycle_maintenance','MEMBER') OR NOT pg_has_role(session_user,'orgmap_lifecycle_drain','MEMBER') OR pg_has_role(session_user,'orgmap_app','MEMBER') OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND rolcanlogin AND NOT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)) THEN RAISE EXCEPTION 'DELETION_MAINTENANCE_AUTHORITY_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=p_org FOR UPDATE;
 SELECT * INTO j FROM public.organization_deletion_jobs WHERE id=p_job AND organization_id=p_org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'DELETION_JOB_NOT_FOUND' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('organizationId',j.organization_id,'jobId',j.id,'fence',j.lifecycle_fence::text,'phase',j.phase,'state',j.state,'actorAccountId',j.initiator_account_id,'ledgerState',j.ledger_state,'ledgerAuthorityId',j.ledger_authority_id,'ledgerRecordSha256',j.ledger_record_sha256,'acceptedFence',j.accepted_fence::text,'acceptedAt',j.accepted_at);
END $$;
REVOKE ALL ON FUNCTION orgmap_deletion_supervisor_job(uuid,uuid) FROM PUBLIC,orgmap_app;
GRANT EXECUTE ON FUNCTION orgmap_deletion_supervisor_job(uuid,uuid) TO orgmap_lifecycle_maintenance;

CREATE FUNCTION orgmap_deletion_supervisor_blobs(p_org uuid,p_job uuid,p_fence bigint,p_token uuid,p_after_namespace text,p_after_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.orgmap_deletion_require_schema_lock();
 PERFORM public.orgmap_deletion_assert_schema_current(p_org,p_job,p_fence,p_token);
 IF NOT EXISTS(SELECT 1 FROM public.organization_deletion_jobs WHERE id=p_job AND organization_id=p_org AND phase='BLOBS') OR ((p_after_namespace IS NULL)<>(p_after_key IS NULL)) OR (p_after_namespace IS NOT NULL AND p_after_namespace NOT IN ('ORG_BRANDING','PLATFORM')) THEN RAISE EXCEPTION 'DELETION_BLOB_PAGE_INVALID' USING ERRCODE='22023'; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('namespace',namespace,'key',blob_key::text,'state',state) ORDER BY namespace,blob_key),'[]'::jsonb) INTO result FROM (SELECT namespace,blob_key,state FROM public.organization_deletion_blobs WHERE job_id=p_job AND (p_after_namespace IS NULL OR (namespace,blob_key)>(p_after_namespace,p_after_key)) ORDER BY namespace,blob_key LIMIT 200) b;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION orgmap_deletion_supervisor_blobs(uuid,uuid,bigint,uuid,text,uuid) FROM PUBLIC,orgmap_app;
GRANT EXECUTE ON FUNCTION orgmap_deletion_supervisor_blobs(uuid,uuid,bigint,uuid,text,uuid) TO orgmap_lifecycle_maintenance;
