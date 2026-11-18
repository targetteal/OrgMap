-- Full composition only: serialize privileged Platform dispatch against Org cutover.
-- Existing leases lack fences and are deliberately unable to heartbeat or finish.
ALTER TABLE platform_worker_scopes ADD COLUMN lifecycle_fence bigint;
ALTER TABLE platform_deliveries ADD COLUMN lifecycle_fence bigint;
ALTER TABLE platform_deliveries DROP CONSTRAINT platform_deliveries_state_check;
ALTER TABLE platform_deliveries ADD CONSTRAINT platform_deliveries_state_check CHECK(state IN ('PENDING','DELIVERED','SUPPRESSED','FAILED','OUTCOME_UNKNOWN'));
ALTER TABLE interop_deliveries DROP CONSTRAINT interop_deliveries_state_check;
ALTER TABLE interop_deliveries ADD CONSTRAINT interop_deliveries_state_check CHECK(state IN ('PENDING','SENDING','DELIVERED','FAILED','REVOKED','OUTCOME_UNKNOWN'));

CREATE OR REPLACE FUNCTION platform_claim_scope(p_token uuid,p_participants text[])
RETURNS TABLE(organization_id uuid,member_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE candidate record; f bigint; acquired record;
BEGIN
 IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'LIFECYCLE_ISOLATION_UNSUPPORTED' USING ERRCODE='25001'; END IF;
 IF p_token IS NULL THEN RAISE EXCEPTION 'Invalid scope token' USING ERRCODE='22023'; END IF;
 -- Select without holding scope locks; lock each organization before scope rows.
 FOR candidate IN
  WITH candidates AS (
   SELECT j.organization_id,j.owner_id AS member_id FROM public.platform_jobs j
    WHERE (j.state='PENDING' AND j.available_at<=clock_timestamp()) OR (j.state='RUNNING' AND j.lease_until<clock_timestamp())
   UNION SELECT d.organization_id,d.recipient_id FROM public.platform_deliveries d
    WHERE d.state='PENDING' AND d.available_at<=clock_timestamp() AND (d.lease_until IS NULL OR d.lease_until<clock_timestamp())
   UNION SELECT w.organization_id,w.member_id FROM public.platform_scope_wakes w
    WHERE w.participant=ANY(p_participants) AND w.available_at<=clock_timestamp()
  ) SELECT o.id AS org_id,c.member_id FROM candidates c JOIN public.organizations o ON o.id=c.organization_id
   LEFT JOIN public.platform_worker_scopes s ON s.organization_id=c.organization_id AND s.member_id=c.member_id
   ORDER BY s.claimed_at NULLS FIRST,o.id,c.member_id FOR UPDATE OF o SKIP LOCKED
 LOOP
  SELECT l.fence INTO f FROM public.organization_lifecycle l WHERE l.organization_id=candidate.org_id AND l.state='ACTIVE';
  IF NOT FOUND THEN CONTINUE; END IF;
  INSERT INTO public.platform_worker_scopes(organization_id,member_id) VALUES(candidate.org_id,candidate.member_id) ON CONFLICT DO NOTHING;
  SELECT s.organization_id,s.member_id INTO acquired FROM public.platform_worker_scopes s
   WHERE s.organization_id=candidate.org_id AND s.member_id=candidate.member_id AND s.available_at<=clock_timestamp()
    AND (s.lease_until IS NULL OR s.lease_until<clock_timestamp()) FOR UPDATE OF s SKIP LOCKED;
  IF NOT FOUND THEN CONTINUE; END IF;
  UPDATE public.platform_worker_scopes s SET lease_token=p_token,lease_until=clock_timestamp()+interval '60 seconds',claimed_at=clock_timestamp(),lifecycle_fence=f
   WHERE s.organization_id=candidate.org_id AND s.member_id=candidate.member_id;
  UPDATE public.platform_scope_wakes w SET claim_token=p_token WHERE w.organization_id=candidate.org_id AND w.member_id=candidate.member_id
   AND w.participant=ANY(p_participants) AND w.available_at<=clock_timestamp();
  organization_id:=candidate.org_id;member_id:=candidate.member_id;RETURN NEXT; RETURN;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION platform_heartbeat_scope(p_org uuid,p_member uuid,p_token uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE f bigint;
BEGIN
 IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'LIFECYCLE_ISOLATION_UNSUPPORTED' USING ERRCODE='25001'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=p_org FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT fence INTO f FROM public.organization_lifecycle WHERE organization_id=p_org AND state='ACTIVE';
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE public.platform_worker_scopes SET lease_until=clock_timestamp()+interval '60 seconds'
 WHERE organization_id=p_org AND member_id=p_member AND lease_token=p_token AND lease_until>clock_timestamp() AND lifecycle_fence=f;
 RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION platform_release_scope(p_org uuid,p_member uuid,p_token uuid,p_failed boolean,p_repeat text[]) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE f bigint;
BEGIN
 IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'LIFECYCLE_ISOLATION_UNSUPPORTED' USING ERRCODE='25001'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=p_org FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT fence INTO f FROM public.organization_lifecycle WHERE organization_id=p_org AND state='ACTIVE';
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM public.platform_worker_scopes WHERE organization_id=p_org AND member_id=p_member AND lease_token=p_token AND lease_until>clock_timestamp() AND lifecycle_fence=f FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF p_failed THEN UPDATE public.platform_scope_wakes SET claim_token=NULL WHERE organization_id=p_org AND member_id=p_member AND claim_token=p_token;
 ELSE
  DELETE FROM public.platform_scope_wakes WHERE organization_id=p_org AND member_id=p_member AND claim_token=p_token;
  INSERT INTO public.platform_scope_wakes(organization_id,id,member_id,participant)
   SELECT p_org,gen_random_uuid(),p_member,name FROM (SELECT DISTINCT unnest(p_repeat) AS name) names;
 END IF;
 UPDATE public.platform_worker_scopes SET lease_token=NULL,lease_until=NULL,lifecycle_fence=NULL,available_at=clock_timestamp()+CASE WHEN p_failed THEN interval '60 seconds' ELSE interval '0 seconds' END
  WHERE organization_id=p_org AND member_id=p_member AND lease_token=p_token;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION platform_claimed_participants(p_org uuid,p_member uuid,p_token uuid)
RETURNS TABLE(participant text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE f bigint;
BEGIN
 IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'LIFECYCLE_ISOLATION_UNSUPPORTED' USING ERRCODE='25001'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=p_org FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT fence INTO f FROM public.organization_lifecycle WHERE organization_id=p_org AND state='ACTIVE';
 IF NOT FOUND THEN RETURN; END IF;
 RETURN QUERY SELECT DISTINCT w.participant FROM public.platform_scope_wakes w JOIN public.platform_worker_scopes s
  ON s.organization_id=w.organization_id AND s.member_id=w.member_id
  WHERE s.organization_id=p_org AND s.member_id=p_member AND s.lease_token=p_token AND s.lease_until>clock_timestamp()
   AND s.lifecycle_fence=f AND w.claim_token=p_token ORDER BY w.participant;
END $$;

CREATE OR REPLACE FUNCTION platform_scope_due_jobs(p_org uuid,p_member uuid,p_scope uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE f bigint;
BEGIN
 IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'LIFECYCLE_ISOLATION_UNSUPPORTED' USING ERRCODE='25001'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=p_org FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT fence INTO f FROM public.organization_lifecycle WHERE organization_id=p_org AND state='ACTIVE';
 IF NOT FOUND THEN RETURN false; END IF;
 RETURN EXISTS(SELECT 1 FROM public.platform_worker_scopes s WHERE s.organization_id=p_org AND s.member_id=p_member AND s.lease_token=p_scope AND s.lease_until>clock_timestamp() AND s.lifecycle_fence=f)
  AND EXISTS(SELECT 1 FROM public.platform_jobs j WHERE j.organization_id=p_org AND j.owner_id=p_member AND ((j.state='PENDING' AND j.available_at<=clock_timestamp()) OR (j.state='RUNNING' AND j.lease_until<clock_timestamp())));
END $$;

CREATE OR REPLACE FUNCTION platform_claim_delivery_metadata(p_org uuid,p_member uuid,p_scope uuid,p_claim uuid)
RETURNS TABLE(delivery_id uuid,claim_token uuid,resource_type text,resource_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE f bigint;
BEGIN
 IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'LIFECYCLE_ISOLATION_UNSUPPORTED' USING ERRCODE='25001'; END IF;
 IF p_claim IS NULL THEN RAISE EXCEPTION 'Invalid claim token' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=p_org FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT fence INTO f FROM public.organization_lifecycle WHERE organization_id=p_org AND state='ACTIVE';
 IF NOT FOUND THEN RETURN; END IF;
 PERFORM 1 FROM public.platform_worker_scopes s WHERE s.organization_id=p_org AND s.member_id=p_member AND s.lease_token=p_scope AND s.lease_until>clock_timestamp() AND s.lifecycle_fence=f FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 UPDATE public.platform_deliveries d SET state='FAILED',lease_token=NULL,lease_until=NULL WHERE d.organization_id=p_org AND d.recipient_id=p_member AND d.state='PENDING' AND d.attempts>=5 AND d.lease_until<clock_timestamp();
 RETURN QUERY WITH candidate AS (SELECT d.id FROM public.platform_deliveries d WHERE d.organization_id=p_org AND d.recipient_id=p_member AND d.state='PENDING' AND d.attempts<5 AND d.available_at<=clock_timestamp() AND (d.lease_until IS NULL OR d.lease_until<clock_timestamp()) ORDER BY d.id FOR UPDATE SKIP LOCKED LIMIT 1)
 UPDATE public.platform_deliveries d SET lease_token=p_claim,lease_until=clock_timestamp()+interval '60 seconds',attempts=d.attempts+1,lifecycle_fence=f
 FROM candidate c WHERE d.organization_id=p_org AND d.id=c.id RETURNING d.id,p_claim,d.resource_type,d.resource_id;
END $$;

CREATE OR REPLACE FUNCTION platform_finish_delivery_metadata(p_org uuid,p_member uuid,p_delivery uuid,p_claim uuid,p_outcome text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE f bigint;
BEGIN
 IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'LIFECYCLE_ISOLATION_UNSUPPORTED' USING ERRCODE='25001'; END IF;
 IF p_claim IS NULL OR p_outcome IS NULL OR p_outcome NOT IN ('DELIVERED','SUPPRESSED','RETRY','UNKNOWN') THEN RAISE EXCEPTION 'Invalid delivery outcome' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=p_org FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT fence INTO f FROM public.organization_lifecycle WHERE organization_id=p_org AND state='ACTIVE';
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE public.platform_deliveries d SET state=CASE WHEN p_outcome='RETRY' THEN CASE WHEN d.attempts>=5 THEN 'FAILED' ELSE 'PENDING' END WHEN p_outcome='UNKNOWN' THEN 'OUTCOME_UNKNOWN' ELSE p_outcome END,
  available_at=CASE WHEN p_outcome='RETRY' THEN clock_timestamp()+((power(2,d.attempts)+random())*interval '1 second') ELSE d.available_at END,
  lease_token=NULL,lease_until=NULL,lifecycle_fence=NULL
 WHERE d.organization_id=p_org AND d.recipient_id=p_member AND d.id=p_delivery AND d.lease_token=p_claim AND d.lease_until>clock_timestamp() AND d.state='PENDING' AND d.lifecycle_fence=f;
 RETURN FOUND;
END $$;
