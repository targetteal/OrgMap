-- Private phase transitions; no HTTP grants, caller-supplied done flags or
-- claims about remote effects. The 916 baseline must include this migration.
ALTER TABLE organization_deletion_jobs ADD COLUMN inventory_manifest_sha256 text CHECK(inventory_manifest_sha256 IS NULL OR inventory_manifest_sha256 ~ '^[a-f0-9]{64}$');
ALTER TABLE organization_deletion_jobs ADD COLUMN inventory_manifest_count bigint CHECK(inventory_manifest_count IS NULL OR inventory_manifest_count>=0);
ALTER TABLE organization_deletion_jobs ADD COLUMN inventory_seal_receipt uuid REFERENCES organization_deletion_drain_receipts(id);

CREATE FUNCTION orgmap_deletion_inventory_to_purge(p_org uuid,p_job uuid,p_fence bigint,p_token uuid,p_receipt uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE contexts constant text[]:=ARRAY['foundation','structure','governance','work','goals','meetings','administration','platform','interoperability'];
 qreceipt uuid; qcount integer; icount integer; bad boolean; manifest_hash text; manifest_count bigint; next_fence bigint;
BEGIN
 -- Caller already holds schema lock before Org; receipt proves the current
 -- stopped-host guard in this same SQL transaction, not a previous Q receipt.
 PERFORM public.orgmap_deletion_require_schema_lock();
 PERFORM public.orgmap_deletion_drain_assert(p_receipt,p_org,p_job,p_fence,p_token);
 PERFORM public.orgmap_deletion_assert_schema_current(p_org,p_job,p_fence,p_token);
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'DELETION_INVENTORY_VISIBILITY_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM set_config('row_security','off',true);
 IF NOT EXISTS(SELECT 1 FROM public.organization_deletion_jobs WHERE organization_id=p_org AND id=p_job AND phase='INVENTORY') OR
    NOT EXISTS(SELECT 1 FROM public.organization_lifecycle WHERE organization_id=p_org AND state='DELETION_PENDING' AND fence=p_fence) THEN
  RAISE EXCEPTION 'DELETION_INVENTORY_TRANSITION_INVALID' USING ERRCODE='42501'; END IF;
 SELECT count(*)::int,min(p.drain_receipt_id::text)::uuid INTO qcount,qreceipt
 FROM public.organization_deletion_progress p JOIN public.organization_deletion_drain_receipts r ON r.id=p.drain_receipt_id
 JOIN public.organization_deletion_quiescence_attestations a ON a.job_id=p.job_id AND a.context_id=p.context_id AND a.receipt_id=r.id AND a.transaction_id=r.transaction_id
 WHERE p.job_id=p_job AND p.phase='QUIESCE' AND p.context_id=ANY(contexts) AND p.done AND p.cursor IS NULL AND r.organization_id=p_org AND r.job_id=p_job AND r.lifecycle_fence=p_fence;
 IF qcount<>cardinality(contexts) OR (SELECT count(DISTINCT drain_receipt_id) FROM public.organization_deletion_progress WHERE job_id=p_job AND phase='QUIESCE' AND context_id=ANY(contexts) AND done)<>1 OR qreceipt IS NULL THEN RAISE EXCEPTION 'DELETION_QUIESCENCE_INCOMPLETE' USING ERRCODE='55000'; END IF;
 SELECT count(*)::int INTO icount FROM public.organization_deletion_progress WHERE job_id=p_job AND phase='INVENTORY' AND context_id=ANY(contexts) AND done AND cursor IS NULL;
 IF icount<>cardinality(contexts) THEN RAISE EXCEPTION 'DELETION_INVENTORY_INCOMPLETE' USING ERRCODE='55000'; END IF;
 -- Fail closed when an unpublished/published stage would disappear without a
 -- durable ref. Do not infer anything about whether physical bytes still exist.
 IF EXISTS(SELECT 1 FROM public.administration_branding_stages s WHERE s.organization_id=p_org AND s.state='WRITING') OR
    EXISTS(SELECT 1 FROM public.administration_branding_stages s WHERE s.organization_id=p_org AND s.storage_removed_at IS NULL AND s.state='ABANDONED'
      AND NOT EXISTS(SELECT 1 FROM public.administration_branding_gc g WHERE g.organization_id=p_org AND (g.blob_key,g.sha256,g.size)=(s.blob_key,s.sha256,s.size))) OR
    EXISTS(SELECT 1 FROM public.administration_branding_stages s WHERE s.organization_id=p_org AND s.storage_removed_at IS NULL AND s.state='PUBLISHED'
      AND NOT EXISTS(SELECT 1 FROM public.administration_branding_gc g WHERE g.organization_id=p_org AND (g.blob_key,g.sha256,g.size)=(s.blob_key,s.sha256,s.size))
      AND NOT EXISTS(SELECT 1 FROM public.administration_branding_assets a WHERE a.organization_id=p_org AND a.origin='UPLOADED' AND (a.blob_key,a.sha256,a.size)=(s.blob_key,s.sha256,s.size))) THEN
  RAISE EXCEPTION 'DELETION_INVENTORY_STAGE_UNRESOLVED' USING ERRCODE='55000'; END IF;
 -- Independent bidirectional comparison to the current owner tables; a forged
 -- checkpoint cannot hide, add or alter a reference. Rows must still be pending.
 WITH refs AS (
  SELECT 'ORG_BRANDING'::text AS ns,blob_key,sha256,size::bigint FROM public.administration_branding_assets WHERE organization_id=p_org AND origin='UPLOADED'
  UNION ALL SELECT 'ORG_BRANDING',blob_key,sha256,size::bigint FROM public.administration_branding_gc WHERE organization_id=p_org
  UNION ALL SELECT 'ORG_BRANDING',blob_key,sha256,size::bigint FROM public.administration_branding_stages WHERE organization_id=p_org AND state IN ('WRITING','READY')
  UNION ALL SELECT 'PLATFORM',blob_key,sha256,size::bigint FROM public.platform_files WHERE organization_id=p_org
  UNION ALL SELECT 'PLATFORM',blob_key,sha256,size::bigint FROM public.platform_artifacts WHERE organization_id=p_org
 ), expected AS (SELECT DISTINCT ns,blob_key,sha256,size FROM refs), actual AS (SELECT namespace AS ns,blob_key,sha256,size FROM public.organization_deletion_blobs WHERE job_id=p_job AND state='PENDING')
 SELECT EXISTS(SELECT 1 FROM (SELECT ns,blob_key FROM expected GROUP BY ns,blob_key HAVING count(*)>1) variants)
 OR EXISTS((SELECT * FROM expected EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected))
 OR EXISTS(SELECT 1 FROM public.organization_deletion_blobs WHERE job_id=p_job AND state<>'PENDING') INTO bad;
 IF bad THEN RAISE EXCEPTION 'DELETION_INVENTORY_MANIFEST_MISMATCH' USING ERRCODE='55000'; END IF;
 SELECT count(*)::bigint,encode(sha256(convert_to(COALESCE(jsonb_agg(jsonb_build_array(namespace,blob_key::text,sha256,size) ORDER BY namespace,blob_key),'[]'::jsonb)::text,'UTF8')),'hex')
 INTO manifest_count,manifest_hash FROM public.organization_deletion_blobs WHERE job_id=p_job;
 PERFORM public.orgmap_deletion_drain_assert(p_receipt,p_org,p_job,p_fence,p_token);
 next_fence:=p_fence+1;
 UPDATE public.organization_lifecycle SET state='PURGING',fence=next_fence WHERE organization_id=p_org AND state='DELETION_PENDING' AND fence=p_fence;
 IF NOT FOUND THEN RAISE EXCEPTION 'DELETION_LIFECYCLE_TRANSITION_CONFLICT' USING ERRCODE='40001'; END IF;
 UPDATE public.organization_deletion_jobs SET phase='PURGE',state='PENDING',lifecycle_fence=next_fence,lease_token=NULL,lease_fence=NULL,lease_until=NULL,inventory_manifest_sha256=manifest_hash,inventory_manifest_count=manifest_count,inventory_seal_receipt=p_receipt,version=version+1,updated_at=clock_timestamp() WHERE organization_id=p_org AND id=p_job;
 RETURN jsonb_build_object('phase','PURGE','fence',next_fence::text,'manifestSha256',manifest_hash,'manifestCount',manifest_count);
END $$;
REVOKE ALL ON FUNCTION orgmap_deletion_inventory_to_purge(uuid,uuid,bigint,uuid,uuid) FROM PUBLIC,orgmap_app,orgmap_lifecycle_maintenance;
GRANT EXECUTE ON FUNCTION orgmap_deletion_inventory_to_purge(uuid,uuid,bigint,uuid,uuid) TO orgmap_lifecycle_drain;

-- A fresh stopped-host receipt and independent absence checks are required;
-- checkpoint completion alone never authorizes the next phase.
CREATE FUNCTION orgmap_deletion_purge_to_blobs(p_org uuid,p_job uuid,p_fence bigint,p_token uuid,p_receipt uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE contexts constant text[]:=ARRAY['foundation','structure','governance','work','goals','meetings','administration','platform','interoperability'];
 ctx text; manifest_hash text; manifest_count bigint; sealed_hash text; sealed_count bigint;
BEGIN
 PERFORM public.orgmap_deletion_require_schema_lock();
 PERFORM public.orgmap_deletion_drain_assert(p_receipt,p_org,p_job,p_fence,p_token);
 IF NOT EXISTS(SELECT 1 FROM public.organization_deletion_jobs WHERE id=p_job AND organization_id=p_org AND phase='PURGE') OR
    NOT EXISTS(SELECT 1 FROM public.organization_lifecycle WHERE organization_id=p_org AND state='PURGING' AND fence=p_fence) THEN
  RAISE EXCEPTION 'DELETION_PURGE_TRANSITION_INVALID' USING ERRCODE='42501'; END IF;
 PERFORM public.orgmap_deletion_assert_tenant_owned_empty(p_org,p_job,p_fence,p_token);
 IF (SELECT count(*) FROM public.organization_deletion_progress WHERE job_id=p_job AND phase='PURGE' AND context_id=ANY(contexts) AND done AND cursor IS NULL)<>cardinality(contexts) THEN RAISE EXCEPTION 'DELETION_PURGE_INCOMPLETE' USING ERRCODE='55000'; END IF;
 FOREACH ctx IN ARRAY contexts LOOP
  PERFORM public.orgmap_deletion_assert_owner_empty(p_org,p_job,p_fence,p_token,ctx);
 END LOOP;
 PERFORM public.orgmap_deletion_assert_mixed_empty(p_org,p_job,p_fence,p_token);
 SELECT inventory_manifest_sha256,inventory_manifest_count INTO sealed_hash,sealed_count FROM public.organization_deletion_jobs WHERE id=p_job AND organization_id=p_org AND inventory_seal_receipt IS NOT NULL;
 SELECT count(*)::bigint,encode(sha256(convert_to(COALESCE(jsonb_agg(jsonb_build_array(namespace,blob_key::text,sha256,size) ORDER BY namespace,blob_key),'[]'::jsonb)::text,'UTF8')),'hex')
 INTO manifest_count,manifest_hash FROM public.organization_deletion_blobs WHERE job_id=p_job AND state='PENDING';
 IF sealed_hash IS NULL OR sealed_count IS NULL OR sealed_hash<>manifest_hash OR sealed_count<>manifest_count OR EXISTS(SELECT 1 FROM public.organization_deletion_blobs WHERE job_id=p_job AND state<>'PENDING') THEN
  RAISE EXCEPTION 'DELETION_INVENTORY_MANIFEST_MISMATCH' USING ERRCODE='55000'; END IF;
 PERFORM public.orgmap_deletion_drain_assert(p_receipt,p_org,p_job,p_fence,p_token);
 UPDATE public.organization_deletion_jobs SET phase='BLOBS',version=version+1,updated_at=clock_timestamp() WHERE id=p_job AND organization_id=p_org AND phase='PURGE';
 IF NOT FOUND THEN RAISE EXCEPTION 'DELETION_PURGE_TRANSITION_CONFLICT' USING ERRCODE='40001'; END IF;
END $$;
REVOKE ALL ON FUNCTION orgmap_deletion_purge_to_blobs(uuid,uuid,bigint,uuid,uuid) FROM PUBLIC,orgmap_app,orgmap_lifecycle_maintenance;
GRANT EXECUTE ON FUNCTION orgmap_deletion_purge_to_blobs(uuid,uuid,bigint,uuid,uuid) TO orgmap_lifecycle_drain;
