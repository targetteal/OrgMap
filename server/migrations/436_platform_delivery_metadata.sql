-- Closed queue operations for the restricted dispatcher. No payload/email/title is returned.
CREATE FUNCTION platform_scope_due_jobs(p_org uuid,p_member uuid,p_scope uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.platform_worker_scopes s WHERE s.organization_id=p_org AND s.member_id=p_member AND s.lease_token=p_scope AND s.lease_until>clock_timestamp())
 AND EXISTS(SELECT 1 FROM public.platform_jobs j WHERE j.organization_id=p_org AND j.owner_id=p_member AND ((j.state='PENDING' AND j.available_at<=clock_timestamp()) OR (j.state='RUNNING' AND j.lease_until<clock_timestamp())));
$$;
CREATE FUNCTION platform_claim_delivery_metadata(p_org uuid,p_member uuid,p_scope uuid,p_claim uuid)
RETURNS TABLE(delivery_id uuid,claim_token uuid,resource_type text,resource_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_claim IS NULL THEN RAISE EXCEPTION 'Invalid claim token' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.platform_worker_scopes s WHERE s.organization_id=p_org AND s.member_id=p_member AND s.lease_token=p_scope AND s.lease_until>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 UPDATE public.platform_deliveries d SET state='FAILED',lease_token=NULL,lease_until=NULL WHERE d.organization_id=p_org AND d.recipient_id=p_member AND d.state='PENDING' AND d.attempts>=5 AND d.lease_until<clock_timestamp();
 RETURN QUERY WITH candidate AS(
 SELECT d.id FROM public.platform_deliveries d WHERE d.organization_id=p_org AND d.recipient_id=p_member AND d.state='PENDING' AND d.attempts<5 AND d.available_at<=clock_timestamp() AND (d.lease_until IS NULL OR d.lease_until<clock_timestamp()) ORDER BY d.id FOR UPDATE SKIP LOCKED LIMIT 1)
 UPDATE public.platform_deliveries d SET lease_token=p_claim,lease_until=clock_timestamp()+interval '60 seconds',attempts=d.attempts+1
 FROM candidate c WHERE d.organization_id=p_org AND d.id=c.id RETURNING d.id,p_claim,d.resource_type,d.resource_id;
END $$;
CREATE FUNCTION platform_finish_delivery_metadata(p_org uuid,p_member uuid,p_delivery uuid,p_claim uuid,p_outcome text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_claim IS NULL OR p_outcome IS NULL OR p_outcome NOT IN ('DELIVERED','SUPPRESSED','RETRY') THEN RAISE EXCEPTION 'Invalid delivery outcome' USING ERRCODE='22023'; END IF;
 UPDATE public.platform_deliveries d SET
 state=CASE WHEN p_outcome='RETRY' THEN CASE WHEN d.attempts>=5 THEN 'FAILED' ELSE 'PENDING' END ELSE p_outcome END,
 available_at=CASE WHEN p_outcome='RETRY' THEN clock_timestamp()+((power(2,d.attempts)+random())*interval '1 second') ELSE d.available_at END,
 lease_token=NULL,lease_until=NULL
 WHERE d.organization_id=p_org AND d.recipient_id=p_member AND d.id=p_delivery AND d.lease_token=p_claim AND d.state='PENDING';
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION platform_scope_due_jobs(uuid,uuid,uuid),platform_claim_delivery_metadata(uuid,uuid,uuid,uuid),platform_finish_delivery_metadata(uuid,uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_scope_due_jobs(uuid,uuid,uuid),platform_claim_delivery_metadata(uuid,uuid,uuid,uuid),platform_finish_delivery_metadata(uuid,uuid,uuid,uuid,text) TO orgmap_platform_dispatcher;
