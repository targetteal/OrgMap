-- Private local-host drain evidence. This does not enable QUIESCE or certify
-- remote delivery. Only the trusted supervisor login receives this role.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='orgmap_lifecycle_drain') THEN
  CREATE ROLE orgmap_lifecycle_drain NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='orgmap_lifecycle_drain' AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)) THEN
  RAISE EXCEPTION 'DELETION_DRAIN_GROUP_UNSAFE';
 END IF;
END $$;
CREATE TABLE organization_deletion_drain_receipts (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, job_id uuid NOT NULL,
 lifecycle_fence bigint NOT NULL, lease_token uuid NOT NULL,
 authority_id uuid NOT NULL, instance_id uuid NOT NULL, binding_epoch bigint NOT NULL,
 ledger_record_sha256 text NOT NULL, ledger_snapshot_sha256 text NOT NULL,
 transaction_id bigint NOT NULL, issued_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON organization_deletion_drain_receipts FROM PUBLIC,orgmap_app,orgmap_lifecycle_maintenance,orgmap_lifecycle_drain;

-- Invoked only by the stopped-host supervisor in the same transaction as
-- observation. All effects are conservative: never infer NOT_SENT from time.
CREATE FUNCTION orgmap_deletion_drain_reconcile(p_org uuid,p_job uuid,p_fence bigint,p_token uuid,p_owner text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'DELETION_READ_COMMITTED_REQUIRED' USING ERRCODE='25001'; END IF;
 IF NOT pg_has_role(session_user,'orgmap_lifecycle_drain','MEMBER') OR pg_has_role(session_user,'orgmap_app','MEMBER') OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND rolcanlogin AND NOT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)) THEN RAISE EXCEPTION 'DELETION_DRAIN_AUTHORITY_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM public.orgmap_assert_deletion_maintenance(p_org,p_job,p_fence,p_token);
 IF NOT EXISTS(SELECT 1 FROM public.organization_deletion_jobs WHERE id=p_job AND phase='QUIESCE') THEN RAISE EXCEPTION 'DELETION_DRAIN_PHASE_INVALID'; END IF;
 IF p_owner='iam' THEN
  -- ACCOUNT is valid only at the global sentinel, never on a tenant ID.
  -- Unknown kinds are neither consumed nor treated as a completed source.
  IF EXISTS(SELECT 1 FROM public.iam_mail_scope_leases WHERE organization_id=p_org AND kind NOT IN ('INVITATION','ADMISSION','ENROLLMENT')) THEN
   RAISE EXCEPTION 'DELETION_DRAIN_IAM_SCOPE_UNCLASSIFIED' USING ERRCODE='55000'; END IF;
  UPDATE public.organization_effects SET state='OUTCOME_UNKNOWN',completed_at=clock_timestamp() WHERE organization_id=p_org AND owner='IAM' AND state='AUTHORIZED';
  UPDATE public.invitation_delivery SET state=CASE WHEN state='PROCESSING' THEN 'OUTCOME_UNKNOWN' ELSE state END,lease_token=NULL,lease_until=NULL WHERE organization_id=p_org AND (state='PROCESSING' OR lease_token IS NOT NULL);
  UPDATE public.admission_mail SET state=CASE WHEN state='PROCESSING' THEN 'OUTCOME_UNKNOWN' ELSE state END,lease_token=NULL,lease_until=NULL WHERE organization_id=p_org AND (state='PROCESSING' OR lease_token IS NOT NULL);
  UPDATE public.provisioned_enrollment_mail SET state=CASE WHEN state='PROCESSING' THEN 'OUTCOME_UNKNOWN' ELSE state END,lease_token=NULL,lease_until=NULL WHERE organization_id=p_org AND (state='PROCESSING' OR lease_token IS NOT NULL);
  DELETE FROM public.iam_mail_scope_leases WHERE organization_id=p_org AND kind IN ('INVITATION','ADMISSION','ENROLLMENT');
 ELSIF p_owner='platform' THEN
  UPDATE public.organization_effects SET state='OUTCOME_UNKNOWN',completed_at=clock_timestamp() WHERE organization_id=p_org AND owner='PLATFORM' AND state='AUTHORIZED';
  UPDATE public.platform_jobs SET state=CASE WHEN state='RUNNING' THEN 'FAILED' ELSE state END,error_code=CASE WHEN state='RUNNING' THEN 'DRAIN_OUTCOME_UNKNOWN' ELSE error_code END,lease_token=NULL,lease_until=NULL,version=version+1 WHERE organization_id=p_org AND (state='RUNNING' OR lease_token IS NOT NULL);
  UPDATE public.platform_deliveries SET state=CASE WHEN state='PENDING' THEN 'OUTCOME_UNKNOWN' ELSE state END,lease_token=NULL,lease_until=NULL WHERE organization_id=p_org AND lease_token IS NOT NULL;
  UPDATE public.platform_scope_wakes SET claim_token=NULL WHERE organization_id=p_org AND claim_token IS NOT NULL;
  UPDATE public.platform_worker_scopes SET lease_token=NULL,lease_until=NULL WHERE organization_id=p_org AND lease_token IS NOT NULL;
 ELSIF p_owner='interop' THEN
  -- Refresh uses provider credentials outside the effect-intent protocol;
  -- leave it blocked until the owner supplies a safe reconciliation port.
  IF EXISTS(SELECT 1 FROM public.interop_provider_grants WHERE organization_id=p_org AND refresh_lease IS NOT NULL) THEN RAISE EXCEPTION 'DELETION_DRAIN_REFRESH_UNRESOLVED' USING ERRCODE='55000'; END IF;
  UPDATE public.organization_effects SET state='OUTCOME_UNKNOWN',completed_at=clock_timestamp() WHERE organization_id=p_org AND owner='INTEROP' AND state='AUTHORIZED';
  UPDATE public.interop_deliveries SET state=CASE WHEN state='SENDING' THEN 'OUTCOME_UNKNOWN' ELSE state END,lease_token=NULL,lease_until=NULL,last_error=CASE WHEN state='SENDING' THEN 'DRAIN_OUTCOME_UNKNOWN' ELSE last_error END,version=version+1 WHERE organization_id=p_org AND (state='SENDING' OR lease_token IS NOT NULL);
  UPDATE public.interop_project_output_deliveries SET state=CASE WHEN state='PROCESSING' THEN 'OUTCOME_UNKNOWN' ELSE state END,remote_effect_possible=remote_effect_possible OR state='PROCESSING',lease_token=NULL,lease_until=NULL,last_error=CASE WHEN state='PROCESSING' THEN 'DRAIN_OUTCOME_UNKNOWN' ELSE last_error END,version=version+1 WHERE organization_id=p_org AND (state='PROCESSING' OR lease_token IS NOT NULL);
 ELSE RAISE EXCEPTION 'DELETION_DRAIN_OWNER_INVALID' USING ERRCODE='22023'; END IF;
END $$;
REVOKE ALL ON FUNCTION orgmap_deletion_drain_reconcile(uuid,uuid,bigint,uuid,text) FROM PUBLIC,orgmap_app,orgmap_lifecycle_maintenance;
GRANT EXECUTE ON FUNCTION orgmap_deletion_drain_reconcile(uuid,uuid,bigint,uuid,text) TO orgmap_lifecycle_drain;

-- Host stop and external ledger evidence are checked by the supervisor, while
-- holding its exclusive lease and ledger lock. This function independently
-- validates database binding, job/lease, actual queues and every effect.
-- The role is trusted operator authority, never assigned to ordinary app users.
CREATE FUNCTION orgmap_deletion_drain_observe(
 p_org uuid,p_job uuid,p_fence bigint,p_token uuid,p_authority uuid,p_instance uuid,p_epoch bigint,p_accepted_fence bigint,p_accepted_at timestamptz,p_record_hash text,p_snapshot_hash text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE rid uuid:=gen_random_uuid(); j record;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'DELETION_READ_COMMITTED_REQUIRED' USING ERRCODE='25001'; END IF;
 IF NOT pg_has_role(session_user,'orgmap_lifecycle_drain','MEMBER') OR pg_has_role(session_user,'orgmap_app','MEMBER') OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND rolcanlogin AND NOT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)) THEN
  RAISE EXCEPTION 'DELETION_DRAIN_AUTHORITY_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM public.orgmap_assert_deletion_maintenance(p_org,p_job,p_fence,p_token);
 SELECT * INTO j FROM public.organization_deletion_jobs WHERE organization_id=p_org AND id=p_job;
 IF j.phase NOT IN ('QUIESCE','INVENTORY','PURGE','BLOBS') OR j.accepted_fence IS DISTINCT FROM p_accepted_fence OR date_trunc('milliseconds',j.accepted_at) IS DISTINCT FROM p_accepted_at OR j.ledger_authority_id IS DISTINCT FROM p_authority OR j.ledger_record_sha256 IS DISTINCT FROM p_record_hash OR p_record_hash IS NULL OR p_snapshot_hash IS NULL OR p_snapshot_hash !~ '^[a-f0-9]{64}$' OR NOT EXISTS(
  SELECT 1 FROM public.organization_runtime_identity i JOIN public.organization_runtime_mode m ON m.singleton=i.singleton
  WHERE i.singleton AND m.managed AND i.authority_id=p_authority AND i.instance_id=p_instance AND i.epoch=p_epoch
 ) THEN RAISE EXCEPTION 'DELETION_DRAIN_BINDING_INVALID' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.administration_branding_stages WHERE organization_id=p_org AND state='WRITING') THEN
  RAISE EXCEPTION 'DELETION_DRAIN_BRANDING_WRITING' USING ERRCODE='55000'; END IF;
 -- A missing or expired lease never proves a finished transport. Source state
 -- remains an independent blocker until its owner reconciles it explicitly.
 IF EXISTS(SELECT 1 FROM public.iam_mail_scope_leases WHERE organization_id=p_org)
 OR EXISTS(SELECT 1 FROM public.invitation_delivery WHERE organization_id=p_org AND lease_token IS NOT NULL)
 OR EXISTS(SELECT 1 FROM public.admission_mail WHERE organization_id=p_org AND lease_token IS NOT NULL)
 OR EXISTS(SELECT 1 FROM public.provisioned_enrollment_mail WHERE organization_id=p_org AND lease_token IS NOT NULL)
 OR EXISTS(SELECT 1 FROM public.platform_worker_scopes WHERE organization_id=p_org AND lease_token IS NOT NULL)
 OR EXISTS(SELECT 1 FROM public.platform_scope_wakes WHERE organization_id=p_org AND claim_token IS NOT NULL)
 OR EXISTS(SELECT 1 FROM public.platform_jobs WHERE organization_id=p_org AND (state='RUNNING' OR lease_token IS NOT NULL))
 OR EXISTS(SELECT 1 FROM public.platform_deliveries WHERE organization_id=p_org AND lease_token IS NOT NULL)
 OR EXISTS(SELECT 1 FROM public.interop_deliveries WHERE organization_id=p_org AND (state='SENDING' OR lease_token IS NOT NULL))
 OR EXISTS(SELECT 1 FROM public.interop_project_output_deliveries WHERE organization_id=p_org AND (state='PROCESSING' OR lease_token IS NOT NULL))
 OR EXISTS(SELECT 1 FROM public.interop_provider_grants WHERE organization_id=p_org AND refresh_lease IS NOT NULL)
 THEN RAISE EXCEPTION 'DELETION_DRAIN_SOURCE_UNRESOLVED' USING ERRCODE='55000'; END IF;
 UPDATE public.organization_effects SET state='OUTCOME_UNKNOWN',completed_at=clock_timestamp() WHERE organization_id=p_org AND state='AUTHORIZED';
 INSERT INTO public.organization_deletion_drain_receipts(id,organization_id,job_id,lifecycle_fence,lease_token,authority_id,instance_id,binding_epoch,ledger_record_sha256,ledger_snapshot_sha256,transaction_id)
 VALUES(rid,p_org,p_job,p_fence,p_token,p_authority,p_instance,p_epoch,p_record_hash,p_snapshot_hash,txid_current());
 RETURN rid;
END $$;
REVOKE ALL ON FUNCTION orgmap_deletion_drain_observe(uuid,uuid,bigint,uuid,uuid,uuid,bigint,bigint,timestamptz,text,text) FROM PUBLIC,orgmap_app,orgmap_lifecycle_maintenance;
GRANT EXECUTE ON FUNCTION orgmap_deletion_drain_observe(uuid,uuid,bigint,uuid,uuid,uuid,bigint,bigint,timestamptz,text,text) TO orgmap_lifecycle_drain;
-- Any future consumer must call this before completing the very same SQL
-- transaction, while the supervisor still holds the external host guard.
CREATE FUNCTION orgmap_deletion_drain_assert(p_receipt uuid,p_org uuid,p_job uuid,p_fence bigint,p_token uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r record;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'DELETION_READ_COMMITTED_REQUIRED' USING ERRCODE='25001'; END IF;
 IF NOT pg_has_role(session_user,'orgmap_lifecycle_drain','MEMBER') OR pg_has_role(session_user,'orgmap_app','MEMBER') OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND rolcanlogin AND NOT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)) THEN RAISE EXCEPTION 'DELETION_DRAIN_AUTHORITY_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM public.orgmap_assert_deletion_maintenance(p_org,p_job,p_fence,p_token);
 IF EXISTS(SELECT 1 FROM public.iam_mail_scope_leases WHERE organization_id=p_org) THEN RAISE EXCEPTION 'DELETION_DRAIN_IAM_SCOPE_UNRESOLVED' USING ERRCODE='55000'; END IF;
 SELECT * INTO r FROM public.organization_deletion_drain_receipts WHERE id=p_receipt AND organization_id=p_org AND job_id=p_job AND lifecycle_fence=p_fence AND lease_token=p_token AND transaction_id=txid_current();
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.organization_runtime_identity i JOIN public.organization_runtime_mode m ON m.singleton=i.singleton WHERE i.singleton AND m.managed AND i.authority_id=r.authority_id AND i.instance_id=r.instance_id AND i.epoch=r.binding_epoch) THEN RAISE EXCEPTION 'DELETION_DRAIN_RECEIPT_INVALID' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION orgmap_deletion_drain_assert(uuid,uuid,uuid,bigint,uuid) FROM PUBLIC,orgmap_app,orgmap_lifecycle_maintenance;
GRANT EXECUTE ON FUNCTION orgmap_deletion_drain_assert(uuid,uuid,uuid,bigint,uuid) TO orgmap_lifecycle_drain;
