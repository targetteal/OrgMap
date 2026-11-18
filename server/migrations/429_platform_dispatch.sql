DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='orgmap_platform_dispatcher') THEN CREATE ROLE orgmap_platform_dispatcher NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF; END $$;
CREATE TABLE platform_worker_scopes(organization_id uuid NOT NULL,member_id uuid NOT NULL,lease_token uuid,lease_until timestamptz,available_at timestamptz NOT NULL DEFAULT now(),claimed_at timestamptz,PRIMARY KEY(organization_id,member_id),FOREIGN KEY(organization_id,member_id) REFERENCES members(organization_id,id));
ALTER TABLE platform_worker_scopes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON platform_worker_scopes USING(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON platform_worker_scopes TO orgmap_app;
CREATE INDEX platform_jobs_dispatch ON platform_jobs(state,available_at,lease_until);
CREATE INDEX platform_deliveries_dispatch ON platform_deliveries(state,available_at,lease_until);
CREATE FUNCTION platform_claim_scope(p_token uuid) RETURNS TABLE(organization_id uuid,member_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 INSERT INTO public.platform_worker_scopes(organization_id,member_id)
 SELECT j.organization_id,j.owner_id FROM public.platform_jobs j WHERE j.state IN ('PENDING','RUNNING')
 UNION SELECT d.organization_id,d.recipient_id FROM public.platform_deliveries d WHERE d.state='PENDING'
 ON CONFLICT DO NOTHING;
 RETURN QUERY WITH candidate AS (
 SELECT s.organization_id,s.member_id FROM public.platform_worker_scopes s
 WHERE s.available_at<=now() AND (s.lease_until IS NULL OR s.lease_until<now()) AND (
 EXISTS(SELECT 1 FROM public.platform_jobs j WHERE j.organization_id=s.organization_id AND j.owner_id=s.member_id AND ((j.state='PENDING' AND j.available_at<=now()) OR (j.state='RUNNING' AND j.lease_until<now()))) OR
 EXISTS(SELECT 1 FROM public.platform_deliveries d WHERE d.organization_id=s.organization_id AND d.recipient_id=s.member_id AND d.state='PENDING' AND d.available_at<=now() AND (d.lease_until IS NULL OR d.lease_until<now())))
 ORDER BY s.claimed_at NULLS FIRST,s.organization_id,s.member_id FOR UPDATE OF s SKIP LOCKED LIMIT 1)
 UPDATE public.platform_worker_scopes s SET lease_token=p_token,lease_until=now()+interval '60 seconds',claimed_at=now()
 FROM candidate c WHERE s.organization_id=c.organization_id AND s.member_id=c.member_id RETURNING s.organization_id,s.member_id;
END $$;
CREATE FUNCTION platform_release_scope(p_org uuid,p_member uuid,p_token uuid,p_failed boolean) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 WITH released AS(UPDATE public.platform_worker_scopes SET lease_token=NULL,lease_until=NULL,available_at=now()+CASE WHEN p_failed THEN interval '60 seconds' ELSE interval '0 seconds' END WHERE organization_id=p_org AND member_id=p_member AND lease_token=p_token RETURNING 1) SELECT EXISTS(SELECT FROM released);
$$;
CREATE FUNCTION platform_heartbeat_scope(p_org uuid,p_member uuid,p_token uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 WITH renewed AS(UPDATE public.platform_worker_scopes SET lease_until=now()+interval '60 seconds' WHERE organization_id=p_org AND member_id=p_member AND lease_token=p_token AND lease_until>now() RETURNING 1) SELECT EXISTS(SELECT FROM renewed);
$$;
REVOKE ALL ON FUNCTION platform_claim_scope(uuid),platform_release_scope(uuid,uuid,uuid,boolean),platform_heartbeat_scope(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_claim_scope(uuid),platform_release_scope(uuid,uuid,uuid,boolean),platform_heartbeat_scope(uuid,uuid,uuid) TO orgmap_platform_dispatcher;
