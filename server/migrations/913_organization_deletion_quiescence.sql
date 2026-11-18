-- Receipt-bound QUIESCE checkpoint. Generic 513 remains incapable of issuing Q.
ALTER TABLE organization_deletion_progress ADD COLUMN drain_receipt_id uuid REFERENCES organization_deletion_drain_receipts(id);
CREATE TABLE organization_deletion_quiescence_attestations (
 job_id uuid NOT NULL REFERENCES organization_deletion_jobs(id), context_id text NOT NULL,
 receipt_id uuid NOT NULL REFERENCES organization_deletion_drain_receipts(id), transaction_id bigint NOT NULL,
 PRIMARY KEY(job_id,context_id,receipt_id)
);
ALTER TABLE organization_deletion_quiescence_attestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_deletion_quiescence_attestations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON organization_deletion_quiescence_attestations FROM PUBLIC,orgmap_app,orgmap_lifecycle_maintenance,orgmap_lifecycle_drain;
-- Recheck the live supervisor lease and binding at deferred-trigger time,
-- immediately before COMMIT. A late timeout rolls back Q, inventory and refs.
CREATE FUNCTION orgmap_deletion_quiescence_commit_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r record;
BEGIN
 SELECT * INTO r FROM public.organization_deletion_drain_receipts WHERE id=NEW.receipt_id AND job_id=NEW.job_id AND transaction_id=txid_current();
 IF NOT FOUND THEN RAISE EXCEPTION 'DELETION_DRAIN_RECEIPT_INVALID' USING ERRCODE='42501'; END IF;
 PERFORM public.orgmap_deletion_drain_assert(r.id,r.organization_id,r.job_id,r.lifecycle_fence,r.lease_token);
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER organization_deletion_quiescence_commit_guard
 AFTER INSERT ON organization_deletion_quiescence_attestations DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION public.orgmap_deletion_quiescence_commit_guard();
REVOKE ALL ON FUNCTION orgmap_deletion_quiescence_commit_guard() FROM PUBLIC,orgmap_app;
CREATE FUNCTION orgmap_deletion_assert_quiescence_receipt(p_org uuid,p_job uuid,p_fence bigint,p_token uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_receipt uuid;
BEGIN
 BEGIN v_receipt:=nullif(current_setting('orgmap.deletion_drain_receipt',true),'')::uuid;
 EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'TEARDOWN_IO_DRAIN_PROOF_REQUIRED' USING ERRCODE='55000'; END;
 IF v_receipt IS NULL THEN RAISE EXCEPTION 'TEARDOWN_IO_DRAIN_PROOF_REQUIRED' USING ERRCODE='55000'; END IF;
 PERFORM public.orgmap_deletion_drain_assert(v_receipt,p_org,p_job,p_fence,p_token);
 RETURN v_receipt;
END $$;
REVOKE ALL ON FUNCTION orgmap_deletion_assert_quiescence_receipt(uuid,uuid,bigint,uuid) FROM PUBLIC,orgmap_app,orgmap_lifecycle_maintenance;

-- Internal helper: only the owner functions can mint their fixed context's
-- attestation after executing their QUIESCE checks.
CREATE FUNCTION orgmap_deletion_attest_quiescence(p_org uuid,p_job uuid,p_fence bigint,p_token uuid,p_context text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_receipt uuid;
BEGIN
 v_receipt:=public.orgmap_deletion_assert_quiescence_receipt(p_org,p_job,p_fence,p_token);
 IF p_context NOT IN ('foundation','structure','governance','work','goals','meetings','administration','platform','interoperability') THEN
  RAISE EXCEPTION 'DELETION_CONTEXT_INVALID' USING ERRCODE='22023'; END IF;
 INSERT INTO public.organization_deletion_quiescence_attestations(job_id,context_id,receipt_id,transaction_id)
 VALUES(p_job,p_context,v_receipt,txid_current()) ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION orgmap_deletion_attest_quiescence(uuid,uuid,bigint,uuid,text) FROM PUBLIC,orgmap_app,orgmap_lifecycle_maintenance,orgmap_lifecycle_drain;

CREATE FUNCTION orgmap_deletion_quiescence_checkpoint(p_org uuid,p_job uuid,p_fence bigint,p_token uuid,p_context text,p_expected_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_receipt uuid; progress record;
BEGIN
 v_receipt:=public.orgmap_deletion_assert_quiescence_receipt(p_org,p_job,p_fence,p_token);
 IF NOT EXISTS(SELECT 1 FROM public.organization_deletion_quiescence_attestations
  WHERE job_id=p_job AND context_id=p_context AND organization_deletion_quiescence_attestations.receipt_id=v_receipt AND transaction_id=txid_current()) THEN
  RAISE EXCEPTION 'DELETION_OWNER_QUIESCENCE_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM public.orgmap_deletion_read_progress(p_org,p_job,p_fence,p_token,p_context,'QUIESCE');
 SELECT * INTO progress FROM public.organization_deletion_progress WHERE job_id=p_job AND context_id=p_context AND phase='QUIESCE' FOR UPDATE;
 IF progress.cursor IS NOT NULL OR p_expected_revision IS NULL OR progress.revision<>p_expected_revision THEN
  RAISE EXCEPTION 'DELETION_CHECKPOINT_CONFLICT' USING ERRCODE='40001';
 END IF;
 UPDATE public.organization_deletion_progress SET done=true,cursor=NULL,revision=revision+1,drain_receipt_id=v_receipt
 WHERE job_id=p_job AND context_id=p_context AND phase='QUIESCE' RETURNING * INTO progress;
 RETURN jsonb_build_object('cursor',progress.cursor,'done',progress.done,'counts',progress.counts,'revision',progress.revision::text);
END $$;
REVOKE ALL ON FUNCTION orgmap_deletion_quiescence_checkpoint(uuid,uuid,bigint,uuid,text,bigint) FROM PUBLIC,orgmap_app,orgmap_lifecycle_maintenance;
GRANT EXECUTE ON FUNCTION orgmap_deletion_quiescence_checkpoint(uuid,uuid,bigint,uuid,text,bigint) TO orgmap_lifecycle_drain;

CREATE FUNCTION orgmap_deletion_advance_inventory(p_org uuid,p_job uuid,p_fence bigint,p_token uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_receipt uuid;
BEGIN
 v_receipt:=public.orgmap_deletion_assert_quiescence_receipt(p_org,p_job,p_fence,p_token);
 IF (SELECT count(*) FROM public.organization_deletion_progress WHERE job_id=p_job AND phase='QUIESCE'
  AND context_id IN ('foundation','structure','governance','work','goals','meetings','administration','platform','interoperability')
  AND done AND drain_receipt_id=v_receipt)<>9 THEN RAISE EXCEPTION 'DELETION_QUIESCENCE_INCOMPLETE' USING ERRCODE='55000'; END IF;
 UPDATE public.organization_deletion_jobs SET phase='INVENTORY',updated_at=clock_timestamp()
 WHERE id=p_job AND organization_id=p_org AND phase='QUIESCE';
 IF NOT FOUND THEN RAISE EXCEPTION 'DELETION_CHECKPOINT_TARGET_INVALID' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION orgmap_deletion_advance_inventory(uuid,uuid,bigint,uuid) FROM PUBLIC,orgmap_app,orgmap_lifecycle_maintenance;
GRANT EXECUTE ON FUNCTION orgmap_deletion_advance_inventory(uuid,uuid,bigint,uuid) TO orgmap_lifecycle_drain;

CREATE FUNCTION orgmap_deletion_quiescence_initiator(p_org uuid,p_job uuid,p_fence bigint,p_token uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;
BEGIN
 PERFORM public.orgmap_deletion_assert_quiescence_receipt(p_org,p_job,p_fence,p_token);
 SELECT initiator_account_id INTO actor FROM public.organization_deletion_jobs WHERE id=p_job AND organization_id=p_org;
 IF actor IS NULL THEN RAISE EXCEPTION 'DELETION_ACTOR_INVALID' USING ERRCODE='42501'; END IF;
 RETURN actor;
END $$;
REVOKE ALL ON FUNCTION orgmap_deletion_quiescence_initiator(uuid,uuid,bigint,uuid) FROM PUBLIC,orgmap_app,orgmap_lifecycle_maintenance;
GRANT EXECUTE ON FUNCTION orgmap_deletion_quiescence_initiator(uuid,uuid,bigint,uuid) TO orgmap_lifecycle_drain;
