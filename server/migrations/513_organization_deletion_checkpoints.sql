-- Restricted driver primitives only. QUIESCE cannot be certified by this API:
-- its I/O drain protocol must be installed and proved before enabling deletion.
ALTER TABLE organization_deletion_progress ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK(revision>0);

CREATE FUNCTION orgmap_deletion_read_progress(p_org uuid,p_job uuid,p_fence bigint,p_token uuid,p_context text,p_phase text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'DELETION_READ_COMMITTED_REQUIRED' USING ERRCODE='25001'; END IF;
 PERFORM public.orgmap_assert_deletion_maintenance(p_org,p_job,p_fence,p_token);
 IF p_context IS NULL OR p_context NOT IN ('foundation','structure','governance','work','goals','meetings','administration','platform','interoperability') OR
    p_phase IS NULL OR p_phase NOT IN ('QUIESCE','INVENTORY','PURGE') OR
    NOT EXISTS(SELECT 1 FROM public.organization_deletion_jobs WHERE id=p_job AND phase=p_phase) THEN
  RAISE EXCEPTION 'DELETION_CHECKPOINT_TARGET_INVALID' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.organization_deletion_progress(job_id,context_id,phase) VALUES(p_job,p_context,p_phase) ON CONFLICT DO NOTHING;
 SELECT jsonb_build_object('cursor',cursor,'done',done,'counts',counts,'revision',revision::text) INTO result
 FROM public.organization_deletion_progress WHERE job_id=p_job AND context_id=p_context AND phase=p_phase FOR UPDATE;
 RETURN result;
END $$;

CREATE FUNCTION orgmap_deletion_checkpoint(
 p_org uuid,p_job uuid,p_fence bigint,p_token uuid,p_context text,p_phase text,
 p_expected_revision bigint,p_expected_cursor text,p_next_cursor text,p_done boolean,p_counts_delta jsonb,p_refs jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE progress record; item record; reference record; oldref record; merged jsonb; n numeric;
BEGIN
 PERFORM public.orgmap_deletion_read_progress(p_org,p_job,p_fence,p_token,p_context,p_phase);
 -- No role can mint a successful drain attestation through a JSON checkpoint.
 IF p_phase='QUIESCE' THEN RAISE EXCEPTION 'TEARDOWN_IO_DRAIN_PROOF_REQUIRED' USING ERRCODE='55000'; END IF;
 SELECT * INTO progress FROM public.organization_deletion_progress WHERE job_id=p_job AND context_id=p_context AND phase=p_phase FOR UPDATE;
 IF p_expected_revision IS NULL OR progress.revision<>p_expected_revision OR progress.cursor IS DISTINCT FROM p_expected_cursor OR progress.done THEN
  RAISE EXCEPTION 'DELETION_CHECKPOINT_CONFLICT' USING ERRCODE='40001';
 END IF;
 IF p_done IS NULL OR (NOT p_done AND p_next_cursor IS NULL) OR length(p_next_cursor)>4096 OR
    p_counts_delta IS NULL OR jsonb_typeof(p_counts_delta)<>'object' OR octet_length(p_counts_delta::text)>65536 OR
    p_refs IS NULL OR jsonb_typeof(p_refs)<>'array' OR jsonb_array_length(p_refs)>500 THEN
  RAISE EXCEPTION 'DELETION_CHECKPOINT_INVALID' USING ERRCODE='22023';
 END IF;
 IF p_phase<>'INVENTORY' AND jsonb_array_length(p_refs)>0 THEN RAISE EXCEPTION 'DELETION_REFERENCE_PHASE_INVALID' USING ERRCODE='22023'; END IF;
 IF p_phase='PURGE' AND NOT EXISTS(SELECT 1 FROM public.organization_lifecycle WHERE organization_id=p_org AND state='PURGING' AND fence=p_fence) THEN
  RAISE EXCEPTION 'TEARDOWN_LIFECYCLE_PURGING_REQUIRED' USING ERRCODE='42501';
 END IF;
 merged:=progress.counts;
 FOR item IN SELECT key,value FROM jsonb_each(p_counts_delta) LOOP
  IF item.key !~ '^[a-zA-Z][a-zA-Z0-9_]{0,99}$' OR jsonb_typeof(item.value)<>'number' THEN RAISE EXCEPTION 'DELETION_COUNT_INVALID' USING ERRCODE='22023'; END IF;
  n:=item.value::text::numeric;
  IF n<0 OR n<>trunc(n) OR n>9007199254740991 THEN RAISE EXCEPTION 'DELETION_COUNT_INVALID' USING ERRCODE='22023'; END IF;
  n:=n+COALESCE((merged->>item.key)::numeric,0);
  IF n>9007199254740991 THEN RAISE EXCEPTION 'DELETION_COUNT_INVALID' USING ERRCODE='22023'; END IF;
  merged:=jsonb_set(merged,ARRAY[item.key],to_jsonb(n));
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_refs) LOOP
  IF jsonb_typeof(item.value)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(item.value))<>4 OR
     NOT(item.value ?& ARRAY['namespace','key','sha256','size']) OR
     jsonb_typeof(item.value->'namespace')<>'string' OR jsonb_typeof(item.value->'key')<>'string' OR
     jsonb_typeof(item.value->'sha256')<>'string' OR jsonb_typeof(item.value->'size')<>'number' OR
     (item.value->>'namespace') NOT IN ('ORG_BRANDING','PLATFORM') OR
     (item.value->>'key') !~ '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' OR
     (item.value->>'sha256') !~ '^[0-9a-f]{64}$' OR
     (item.value->>'size')::numeric<0 OR (item.value->>'size')::numeric<>trunc((item.value->>'size')::numeric) OR (item.value->>'size')::numeric>9007199254740991 THEN
   RAISE EXCEPTION 'DELETION_REFERENCE_INVALID' USING ERRCODE='22023';
  END IF;
  SELECT item.value->>'namespace' AS namespace,(item.value->>'key')::uuid AS blob_key,item.value->>'sha256' AS sha256,(item.value->>'size')::bigint AS size INTO reference;
  IF (reference.namespace='ORG_BRANDING' AND p_context<>'administration') OR (reference.namespace='PLATFORM' AND p_context<>'platform') THEN RAISE EXCEPTION 'DELETION_REFERENCE_OWNER_INVALID' USING ERRCODE='22023'; END IF;
  -- Inventory cannot register another tenant's bytes or an unowned key.
  IF reference.namespace='ORG_BRANDING' THEN
   IF NOT EXISTS(SELECT 1 FROM public.administration_branding_assets WHERE organization_id=p_org AND origin='UPLOADED' AND blob_key=reference.blob_key AND sha256=reference.sha256 AND size=reference.size UNION ALL SELECT 1 FROM public.administration_branding_gc WHERE organization_id=p_org AND blob_key=reference.blob_key AND sha256=reference.sha256 AND size=reference.size UNION ALL SELECT 1 FROM public.administration_branding_stages WHERE organization_id=p_org AND state IN ('WRITING','READY') AND blob_key=reference.blob_key AND sha256=reference.sha256 AND size=reference.size) THEN RAISE EXCEPTION 'DELETION_REFERENCE_NOT_OWNED' USING ERRCODE='42501'; END IF;
  ELSE
   IF NOT EXISTS(SELECT 1 FROM public.platform_files WHERE organization_id=p_org AND blob_key=reference.blob_key AND sha256=reference.sha256 AND size=reference.size UNION ALL SELECT 1 FROM public.platform_artifacts WHERE organization_id=p_org AND blob_key=reference.blob_key AND sha256=reference.sha256 AND size=reference.size) THEN RAISE EXCEPTION 'DELETION_REFERENCE_NOT_OWNED' USING ERRCODE='42501'; END IF;
  END IF;
  INSERT INTO public.organization_deletion_blobs(job_id,namespace,blob_key,sha256,size) VALUES(p_job,reference.namespace,reference.blob_key,reference.sha256,reference.size) ON CONFLICT DO NOTHING;
  SELECT sha256,size INTO oldref FROM public.organization_deletion_blobs WHERE job_id=p_job AND namespace=reference.namespace AND blob_key=reference.blob_key;
  IF oldref.sha256<>reference.sha256 OR oldref.size<>reference.size THEN RAISE EXCEPTION 'DELETION_REFERENCE_CONFLICT' USING ERRCODE='40001'; END IF;
 END LOOP;
 UPDATE public.organization_deletion_progress SET cursor=p_next_cursor,done=p_done,counts=merged,revision=revision+1 WHERE job_id=p_job AND context_id=p_context AND phase=p_phase;
 RETURN jsonb_build_object('cursor',p_next_cursor,'done',p_done,'counts',merged,'revision',(progress.revision+1)::text);
END $$;

REVOKE ALL ON FUNCTION orgmap_deletion_read_progress(uuid,uuid,bigint,uuid,text,text) FROM PUBLIC,orgmap_app;
REVOKE ALL ON FUNCTION orgmap_deletion_checkpoint(uuid,uuid,bigint,uuid,text,text,bigint,text,text,boolean,jsonb,jsonb) FROM PUBLIC,orgmap_app;
GRANT EXECUTE ON FUNCTION orgmap_deletion_read_progress(uuid,uuid,bigint,uuid,text,text) TO orgmap_lifecycle_maintenance;
GRANT EXECUTE ON FUNCTION orgmap_deletion_checkpoint(uuid,uuid,bigint,uuid,text,text,bigint,text,text,boolean,jsonb,jsonb) TO orgmap_lifecycle_maintenance;
