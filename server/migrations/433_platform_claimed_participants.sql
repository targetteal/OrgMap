-- Only static consumer names for wakes attached to the caller's current lease.
-- No domain payload or unrestricted table access is granted to the dispatcher.
CREATE FUNCTION platform_claimed_participants(p_org uuid,p_member uuid,p_token uuid)
RETURNS TABLE(participant text) LANGUAGE sql SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
 SELECT DISTINCT w.participant FROM public.platform_scope_wakes w
 JOIN public.platform_worker_scopes s USING(organization_id,member_id)
 WHERE s.organization_id=p_org AND s.member_id=p_member
 AND s.lease_token=p_token AND s.lease_until>now() AND w.claim_token=p_token
 ORDER BY w.participant;
$$;
REVOKE ALL ON FUNCTION platform_claimed_participants(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_claimed_participants(uuid,uuid,uuid) TO orgmap_platform_dispatcher;
