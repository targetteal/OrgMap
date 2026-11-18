CREATE TABLE platform_scope_wakes(organization_id uuid NOT NULL,id uuid NOT NULL,member_id uuid NOT NULL,participant text NOT NULL CHECK(participant ~ '^[a-z][a-z0-9-]{0,49}$'),available_at timestamptz NOT NULL DEFAULT now(),claim_token uuid,PRIMARY KEY(organization_id,id),FOREIGN KEY(organization_id,member_id) REFERENCES platform_worker_scopes(organization_id,member_id));
ALTER TABLE platform_scope_wakes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON platform_scope_wakes USING(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON platform_scope_wakes TO orgmap_app;
CREATE INDEX platform_scope_wakes_due ON platform_scope_wakes(organization_id,member_id,participant,available_at);
CREATE FUNCTION platform_claim_scope(p_token uuid,p_participants text[]) RETURNS TABLE(organization_id uuid,member_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 INSERT INTO public.platform_worker_scopes(organization_id,member_id)
 SELECT j.organization_id,j.owner_id FROM public.platform_jobs j WHERE j.state IN ('PENDING','RUNNING')
 UNION SELECT d.organization_id,d.recipient_id FROM public.platform_deliveries d WHERE d.state='PENDING'
 ON CONFLICT DO NOTHING;
 RETURN QUERY WITH candidate AS (
 SELECT s.organization_id,s.member_id FROM public.platform_worker_scopes s
 WHERE s.available_at<=now() AND (s.lease_until IS NULL OR s.lease_until<now()) AND (
 EXISTS(SELECT 1 FROM public.platform_jobs j WHERE j.organization_id=s.organization_id AND j.owner_id=s.member_id AND ((j.state='PENDING' AND j.available_at<=now()) OR (j.state='RUNNING' AND j.lease_until<now()))) OR
 EXISTS(SELECT 1 FROM public.platform_deliveries d WHERE d.organization_id=s.organization_id AND d.recipient_id=s.member_id AND d.state='PENDING' AND d.available_at<=now() AND (d.lease_until IS NULL OR d.lease_until<now())) OR
 EXISTS(SELECT 1 FROM public.platform_scope_wakes w WHERE w.organization_id=s.organization_id AND w.member_id=s.member_id AND w.participant=ANY(p_participants) AND w.available_at<=now()))
 ORDER BY s.claimed_at NULLS FIRST,s.organization_id,s.member_id FOR UPDATE OF s SKIP LOCKED LIMIT 1),
 claimed AS(UPDATE public.platform_worker_scopes s SET lease_token=p_token,lease_until=now()+interval '60 seconds',claimed_at=now()
 FROM candidate c WHERE s.organization_id=c.organization_id AND s.member_id=c.member_id RETURNING s.organization_id,s.member_id),
 marked AS(UPDATE public.platform_scope_wakes w SET claim_token=p_token FROM claimed c WHERE w.organization_id=c.organization_id AND w.member_id=c.member_id AND w.participant=ANY(p_participants) AND w.available_at<=now() RETURNING w.id)
 SELECT c.organization_id,c.member_id FROM claimed c;
END $$;
CREATE OR REPLACE FUNCTION platform_claim_scope(p_token uuid) RETURNS TABLE(organization_id uuid,member_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$SELECT * FROM public.platform_claim_scope(p_token,ARRAY[]::text[]);$$;
CREATE FUNCTION platform_release_scope(p_org uuid,p_member uuid,p_token uuid,p_failed boolean,p_repeat text[]) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM 1 FROM public.platform_worker_scopes WHERE organization_id=p_org AND member_id=p_member AND lease_token=p_token FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF p_failed THEN UPDATE public.platform_scope_wakes SET claim_token=NULL WHERE organization_id=p_org AND member_id=p_member AND claim_token=p_token;
 ELSE
 DELETE FROM public.platform_scope_wakes WHERE organization_id=p_org AND member_id=p_member AND claim_token=p_token;
 INSERT INTO public.platform_scope_wakes(organization_id,id,member_id,participant) SELECT p_org,gen_random_uuid(),p_member,name FROM (SELECT DISTINCT unnest(p_repeat) AS name) names;
 END IF;
 UPDATE public.platform_worker_scopes SET lease_token=NULL,lease_until=NULL,available_at=now()+CASE WHEN p_failed THEN interval '60 seconds' ELSE interval '0 seconds' END WHERE organization_id=p_org AND member_id=p_member AND lease_token=p_token;
 RETURN true;
END $$;
CREATE OR REPLACE FUNCTION platform_release_scope(p_org uuid,p_member uuid,p_token uuid,p_failed boolean) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$SELECT public.platform_release_scope(p_org,p_member,p_token,p_failed,ARRAY[]::text[]);$$;
REVOKE ALL ON FUNCTION platform_claim_scope(uuid,text[]),platform_release_scope(uuid,uuid,uuid,boolean,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_claim_scope(uuid,text[]),platform_release_scope(uuid,uuid,uuid,boolean,text[]) TO orgmap_platform_dispatcher;
