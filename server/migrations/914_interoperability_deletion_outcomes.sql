-- Minimal retained outcome evidence. No destination, payload, credentials,
-- provider response, message body, remote identifier, or member data.
-- A result is evidence of a local observation, never remote cancellation.
CREATE TABLE interoperability_deletion_outcomes (
 job_id uuid NOT NULL, organization_id uuid NOT NULL, source_kind text NOT NULL CHECK(source_kind IN ('WEBHOOK','PROJECT_OUTPUT','GRANT_REFRESH')),
 source_id uuid NOT NULL, accepted_fence bigint NOT NULL, classification text NOT NULL CHECK(classification IN ('NEVER_SENT','CONFIRMED','OUTCOME_UNKNOWN')),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(job_id,source_kind,source_id)
);
REVOKE ALL ON interoperability_deletion_outcomes FROM PUBLIC,orgmap_app,orgmap_lifecycle_maintenance,orgmap_lifecycle_drain;

-- A refresh can have rotated remote credentials despite a lost response.
-- Stage only from the stopped-host supervisor and require its same-transaction
-- 911 receipt at COMMIT. No expiry, elapsed lease or caller boolean is proof.
CREATE FUNCTION interoperability_deletion_refresh_receipt_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE rec record;
BEGIN
 SELECT * INTO rec FROM public.organization_deletion_drain_receipts WHERE organization_id=NEW.organization_id AND job_id=NEW.job_id AND lifecycle_fence=NEW.accepted_fence AND transaction_id=txid_current();
 IF NOT FOUND THEN RAISE EXCEPTION 'INTEROP_REFRESH_DRAIN_RECEIPT_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM public.orgmap_deletion_drain_assert(rec.id,rec.organization_id,rec.job_id,rec.lifecycle_fence,rec.lease_token);
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER interoperability_refresh_requires_drain AFTER INSERT ON interoperability_deletion_outcomes
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.source_kind='GRANT_REFRESH') EXECUTE FUNCTION interoperability_deletion_refresh_receipt_check();
REVOKE ALL ON FUNCTION interoperability_deletion_refresh_receipt_check() FROM PUBLIC,orgmap_app;

CREATE FUNCTION interoperability_deletion_prepare_refresh(p_org uuid,p_job uuid,p_fence bigint,p_token uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE n integer;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'DELETION_READ_COMMITTED_REQUIRED' USING ERRCODE='25001'; END IF;
 IF NOT pg_has_role(session_user,'orgmap_lifecycle_drain','MEMBER') OR pg_has_role(session_user,'orgmap_app','MEMBER') OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'DELETION_DRAIN_AUTHORITY_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM public.orgmap_assert_deletion_maintenance(p_org,p_job,p_fence,p_token);
 IF NOT EXISTS(SELECT 1 FROM public.organization_deletion_jobs WHERE organization_id=p_org AND id=p_job AND phase='QUIESCE') THEN RAISE EXCEPTION 'DELETION_DRAIN_PHASE_INVALID' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.interop_provider_grants g JOIN public.interoperability_deletion_outcomes o ON o.job_id=p_job AND o.source_kind='GRANT_REFRESH' AND o.source_id=g.id WHERE g.organization_id=p_org AND g.refresh_lease IS NOT NULL) THEN RAISE EXCEPTION 'INTEROP_REFRESH_REAPPEARED' USING ERRCODE='55000'; END IF;
 INSERT INTO public.interoperability_deletion_outcomes(job_id,organization_id,source_kind,source_id,accepted_fence,classification)
 SELECT p_job,p_org,'GRANT_REFRESH',id,p_fence,'OUTCOME_UNKNOWN' FROM public.interop_provider_grants WHERE organization_id=p_org AND refresh_lease IS NOT NULL;
 UPDATE public.interop_provider_grants SET state='REAUTHORIZATION_REQUIRED',access_encrypted=NULL,refresh_encrypted=NULL,refresh_lease=NULL,refresh_lease_until=NULL,authorization_revision=authorization_revision+1,version=version+1 WHERE organization_id=p_org AND refresh_lease IS NOT NULL;
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION interoperability_deletion_prepare_refresh(uuid,uuid,bigint,uuid) FROM PUBLIC,orgmap_app,orgmap_lifecycle_maintenance;
GRANT EXECUTE ON FUNCTION interoperability_deletion_prepare_refresh(uuid,uuid,bigint,uuid) TO orgmap_lifecycle_drain;

-- Record at most p_limit rows under the same transaction as drain observation.
-- A legacy delivery with attempts but no matching CONFIRMED intent is UNKNOWN.
-- Project-output lacks generic effect intents: only unattempted rows have a
-- provable outcome here; even legacy CONFIRMED is conservatively UNKNOWN.
CREATE FUNCTION interoperability_deletion_outcomes_batch(p_org uuid,p_job uuid,p_fence bigint,p_token uuid,p_receipt uuid,p_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE n integer; remaining boolean;
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>500 THEN RAISE EXCEPTION 'INVALID_TEARDOWN_BATCH' USING ERRCODE='22023'; END IF;
 PERFORM public.orgmap_deletion_drain_assert(p_receipt,p_org,p_job,p_fence,p_token);
 WITH candidates AS (
  SELECT 'WEBHOOK'::text AS k,d.id AS source_id,CASE
   WHEN EXISTS(SELECT 1 FROM public.organization_effects e WHERE e.organization_id=p_org AND e.owner='INTEROP' AND e.effect_key='delivery:'||d.id::text AND e.state='CONFIRMED') THEN 'CONFIRMED'
   WHEN d.state='PENDING' AND d.attempts=0 AND NOT EXISTS(SELECT 1 FROM public.organization_effects e WHERE e.organization_id=p_org AND e.owner='INTEROP' AND e.effect_key='delivery:'||d.id::text) THEN 'NEVER_SENT'
   ELSE 'OUTCOME_UNKNOWN' END AS outcome
  FROM public.interop_deliveries d WHERE d.organization_id=p_org
  UNION ALL
  SELECT 'PROJECT_OUTPUT',d.id,CASE WHEN d.state='PENDING' AND d.attempts=0 AND d.io_started_at IS NULL AND NOT d.remote_effect_possible THEN 'NEVER_SENT' ELSE 'OUTCOME_UNKNOWN' END
  FROM public.interop_project_output_deliveries d WHERE d.organization_id=p_org
 ), todo AS (
  SELECT c.* FROM candidates c WHERE NOT EXISTS(SELECT 1 FROM public.interoperability_deletion_outcomes o WHERE o.job_id=p_job AND o.source_kind=c.k AND o.source_id=c.source_id) ORDER BY c.k,c.source_id LIMIT p_limit
 ) INSERT INTO public.interoperability_deletion_outcomes(job_id,organization_id,source_kind,source_id,accepted_fence,classification)
 SELECT p_job,p_org,k,source_id,p_fence,outcome FROM todo ON CONFLICT(job_id,source_kind,source_id) DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;
 SELECT EXISTS(SELECT 1 FROM public.interop_deliveries d WHERE d.organization_id=p_org AND NOT EXISTS(SELECT 1 FROM public.interoperability_deletion_outcomes o WHERE o.job_id=p_job AND o.source_kind='WEBHOOK' AND o.source_id=d.id)) OR
 EXISTS(SELECT 1 FROM public.interop_project_output_deliveries d WHERE d.organization_id=p_org AND NOT EXISTS(SELECT 1 FROM public.interoperability_deletion_outcomes o WHERE o.job_id=p_job AND o.source_kind='PROJECT_OUTPUT' AND o.source_id=d.id)) INTO remaining;
 RETURN jsonb_build_object('recorded',n,'done',NOT remaining);
END $$;
REVOKE ALL ON FUNCTION interoperability_deletion_outcomes_batch(uuid,uuid,bigint,uuid,uuid,integer) FROM PUBLIC,orgmap_app,orgmap_lifecycle_maintenance;
GRANT EXECUTE ON FUNCTION interoperability_deletion_outcomes_batch(uuid,uuid,bigint,uuid,uuid,integer) TO orgmap_lifecycle_drain;

-- Before each owner purge batch, require a disposition for every remaining row.
-- This check does not certify removal of data at a remote provider.
CREATE FUNCTION interoperability_deletion_outcomes_assert(p_org uuid,p_job uuid,p_fence bigint,p_token uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM public.orgmap_assert_deletion_maintenance(p_org,p_job,p_fence,p_token);
 IF NOT EXISTS(SELECT 1 FROM public.organization_deletion_jobs WHERE id=p_job AND organization_id=p_org AND phase='PURGE') OR
 NOT EXISTS(SELECT 1 FROM public.organization_lifecycle WHERE organization_id=p_org AND state='PURGING' AND fence=p_fence) OR
 EXISTS(SELECT 1 FROM public.interop_deliveries d WHERE d.organization_id=p_org AND NOT EXISTS(SELECT 1 FROM public.interoperability_deletion_outcomes o WHERE o.job_id=p_job AND o.organization_id=p_org AND o.source_kind='WEBHOOK' AND o.source_id=d.id)) OR
 EXISTS(SELECT 1 FROM public.interop_project_output_deliveries d WHERE d.organization_id=p_org AND NOT EXISTS(SELECT 1 FROM public.interoperability_deletion_outcomes o WHERE o.job_id=p_job AND o.organization_id=p_org AND o.source_kind='PROJECT_OUTPUT' AND o.source_id=d.id)) OR
 EXISTS(SELECT 1 FROM public.interop_provider_grants g WHERE g.organization_id=p_org AND g.refresh_lease IS NOT NULL)
 THEN RAISE EXCEPTION 'TEARDOWN_INTEROP_EFFECT_PROOF_REQUIRED' USING ERRCODE='55000'; END IF;
END $$;
REVOKE ALL ON FUNCTION interoperability_deletion_outcomes_assert(uuid,uuid,bigint,uuid) FROM PUBLIC,orgmap_app;
GRANT EXECUTE ON FUNCTION interoperability_deletion_outcomes_assert(uuid,uuid,bigint,uuid) TO orgmap_lifecycle_maintenance;
