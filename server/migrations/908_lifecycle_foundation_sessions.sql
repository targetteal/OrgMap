-- Narrow maintenance port only. It is NOT the acceptance transaction, a
-- complete Foundation participant, or proof of minimal retained data.
CREATE FUNCTION foundation_expire_federated_sessions(
 p_org uuid,p_job uuid,p_fence bigint,p_token uuid,p_limit integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_ids uuid[]; v_accounts uuid[]; affected integer; remaining boolean; phase_now text;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'DELETION_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';
 END IF;
 IF p_limit IS NULL OR p_limit<1 OR p_limit>500 THEN RAISE EXCEPTION 'INVALID_SESSION_BATCH' USING ERRCODE='22023'; END IF;
 PERFORM public.orgmap_assert_deletion_maintenance(p_org,p_job,p_fence,p_token);
 SELECT phase INTO phase_now FROM public.organization_deletion_jobs WHERE id=p_job AND organization_id=p_org;
 IF phase_now IS DISTINCT FROM 'QUIESCE' THEN RAISE EXCEPTION 'TEARDOWN_PHASE_MISMATCH' USING ERRCODE='42501'; END IF;
 -- Org is already locked by 510. Discover bounded sessions, then lock their
 -- Accounts in stable order before obtaining any Session row locks.
 SELECT array_agg(id ORDER BY id),array_agg(DISTINCT account_id ORDER BY account_id)
  INTO v_ids,v_accounts FROM (SELECT id,account_id FROM public.sessions
   WHERE auth_method='FEDERATED' AND auth_organization_id=p_org
    AND deletion_revoked_at IS NULL ORDER BY id LIMIT p_limit) q;
 IF v_ids IS NULL THEN RETURN jsonb_build_object('expired',0,'remaining',false); END IF;
 PERFORM 1 FROM public.accounts WHERE id=ANY(v_accounts) ORDER BY id FOR UPDATE;
 PERFORM set_config('orgmap.deletion_organization_id',p_org::text,true);
 PERFORM set_config('orgmap.deletion_job_id',p_job::text,true);
 PERFORM set_config('orgmap.deletion_fence',p_fence::text,true);
 PERFORM set_config('orgmap.deletion_lease_token',p_token::text,true);
 UPDATE public.sessions SET expires_at=LEAST(expires_at,clock_timestamp()),deletion_revoked_at=clock_timestamp(),deletion_revoked_job_id=p_job
  WHERE id=ANY(v_ids) AND account_id=ANY(v_accounts) AND auth_method='FEDERATED'
   AND auth_organization_id=p_org AND deletion_revoked_at IS NULL;
 GET DIAGNOSTICS affected=ROW_COUNT;
 SELECT EXISTS(SELECT 1 FROM public.sessions WHERE auth_method='FEDERATED'
  AND auth_organization_id=p_org AND deletion_revoked_at IS NULL) INTO remaining;
 RETURN jsonb_build_object('expired',affected,'remaining',remaining);
END $$;
REVOKE ALL ON FUNCTION foundation_expire_federated_sessions(uuid,uuid,bigint,uuid,integer) FROM PUBLIC,orgmap_app;
GRANT EXECUTE ON FUNCTION foundation_expire_federated_sessions(uuid,uuid,bigint,uuid,integer) TO orgmap_lifecycle_maintenance;
