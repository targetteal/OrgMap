-- Governance batches remain unreachable through the production runner until the
-- registry and a verified I/O barrier exist. No Foundation rows are removed.
CREATE FUNCTION governance_teardown_batch(
 p_org uuid,p_job uuid,p_fence bigint,p_token uuid,p_phase text,p_cursor text,p_limit integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tables text[] := ARRAY[
 'gov_tension_links','gov_ballots','gov_objections','gov_nominations','gov_commits',
 'gov_rounds','gov_revisions','gov_proposals','gov_tensions','gov_branches',
 'gov_history','gov_policies','gov_documents','gov_document_types'
]; idx integer; t text; affected integer; progress record; phase_now text; doc_id uuid;
  draft_no integer; published_no integer; pointed_count integer; constraint_names text[];
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'DELETION_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';
 END IF;
 IF p_phase NOT IN ('QUIESCE','INVENTORY','PURGE') OR p_limit IS NULL OR p_limit<1 OR p_limit>500 THEN
  RAISE EXCEPTION 'INVALID_TEARDOWN_BATCH' USING ERRCODE='22023';
 END IF;
 PERFORM public.orgmap_assert_deletion_maintenance(p_org,p_job,p_fence,p_token);
 SELECT phase INTO phase_now FROM public.organization_deletion_jobs WHERE id=p_job AND organization_id=p_org;
 IF phase_now IS DISTINCT FROM p_phase THEN RAISE EXCEPTION 'TEARDOWN_PHASE_MISMATCH' USING ERRCODE='42501'; END IF;
 SELECT cursor,done INTO progress FROM public.organization_deletion_progress WHERE job_id=p_job AND context_id='governance' AND phase=p_phase;
 IF FOUND AND progress.done THEN
  IF p_phase='QUIESCE' THEN PERFORM public.orgmap_deletion_attest_quiescence(p_org,p_job,p_fence,p_token,'governance'); END IF;
  RETURN jsonb_build_object('done',true,'nextCursor',NULL,'counts','{}'::jsonb,'blobReferences','[]'::jsonb);
 END IF;
 IF (CASE WHEN FOUND THEN progress.cursor ELSE NULL END) IS DISTINCT FROM p_cursor THEN RAISE EXCEPTION 'TEARDOWN_CURSOR_MISMATCH' USING ERRCODE='42501'; END IF;
 IF p_phase='QUIESCE' THEN
  IF p_cursor IS NOT NULL THEN RAISE EXCEPTION 'INVALID_TEARDOWN_CURSOR' USING ERRCODE='22023'; END IF;
  PERFORM public.orgmap_deletion_attest_quiescence(p_org,p_job,p_fence,p_token,'governance');
  RETURN jsonb_build_object('done',true,'nextCursor',NULL,'counts','{}'::jsonb,'blobReferences','[]'::jsonb);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.organization_deletion_progress WHERE job_id=p_job AND context_id='governance' AND phase='QUIESCE' AND done) THEN
  RAISE EXCEPTION 'TEARDOWN_QUIESCE_REQUIRED' USING ERRCODE='42501';
 END IF;
 IF p_phase='PURGE' THEN PERFORM public.orgmap_deletion_assert_schema_current(p_org,p_job,p_fence,p_token); END IF;
 IF p_phase='INVENTORY' THEN
  IF p_cursor IS NOT NULL THEN RAISE EXCEPTION 'INVALID_TEARDOWN_CURSOR' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('done',true,'nextCursor',NULL,'counts','{}'::jsonb,'blobReferences','[]'::jsonb);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.organization_lifecycle WHERE organization_id=p_org AND state='PURGING' AND fence=p_fence) THEN
  RAISE EXCEPTION 'TEARDOWN_LIFECYCLE_PURGING_REQUIRED' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.organization_deletion_progress WHERE job_id=p_job AND context_id='governance' AND phase='INVENTORY' AND done) THEN
  RAISE EXCEPTION 'TEARDOWN_INVENTORY_REQUIRED' USING ERRCODE='42501';
 END IF;
 IF p_cursor IS NOT NULL AND p_cursor !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION 'INVALID_TEARDOWN_CURSOR' USING ERRCODE='22023'; END IF;
 idx:=COALESCE(p_cursor::integer,1);
 IF idx<1 OR idx>cardinality(tables) THEN RAISE EXCEPTION 'INVALID_TEARDOWN_CURSOR' USING ERRCODE='22023'; END IF;
 LOOP
  t:=tables[idx];
  IF t='gov_documents' THEN
   -- First remove versions not referenced by the document. Every batch commits
   -- with both live pointers intact.
   DELETE FROM public.gov_document_versions v WHERE v.ctid IN (
    SELECT v2.ctid FROM public.gov_document_versions v2
    JOIN public.gov_documents d ON d.organization_id=v2.organization_id AND d.id=v2.document_id
    WHERE v2.organization_id=p_org AND v2.number<>d.draft_version
      AND v2.number IS DISTINCT FROM d.published_version LIMIT p_limit
   );
   GET DIAGNOSTICS affected=ROW_COUNT;
   IF affected>0 THEN RETURN jsonb_build_object('done',false,'nextCursor',idx::text,'counts',jsonb_build_object('gov_document_versions',affected),'blobReferences','[]'::jsonb); END IF;
   SELECT id,draft_version,published_version INTO doc_id,draft_no,published_no
    FROM public.gov_documents WHERE organization_id=p_org ORDER BY id LIMIT 1 FOR UPDATE;
   IF FOUND THEN
    SELECT count(*)::integer INTO pointed_count FROM public.gov_document_versions WHERE organization_id=p_org AND document_id=doc_id;
    -- The document and all remaining pointed versions are indivisible.
    IF pointed_count+1>p_limit THEN RAISE EXCEPTION 'TEARDOWN_ATOMIC_CYCLE_EXCEEDS_LIMIT' USING ERRCODE='54000'; END IF;
    SELECT array_agg(conname ORDER BY conname) INTO constraint_names FROM pg_catalog.pg_constraint
      WHERE conrelid='public.gov_documents'::regclass AND confrelid='public.gov_document_versions'::regclass
        AND contype='f' AND condeferrable;
    IF cardinality(constraint_names) IS DISTINCT FROM 2 OR EXISTS(
      SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.gov_documents'::regclass
       AND confrelid='public.gov_document_versions'::regclass AND contype='f' AND NOT condeferrable
    ) THEN RAISE EXCEPTION 'TEARDOWN_DOCUMENT_CONSTRAINTS_UNEXPECTED' USING ERRCODE='55000'; END IF;
    EXECUTE format('SET CONSTRAINTS %I,%I DEFERRED',constraint_names[1],constraint_names[2]);
    DELETE FROM public.gov_document_versions WHERE organization_id=p_org AND document_id=doc_id;
    DELETE FROM public.gov_documents WHERE organization_id=p_org AND id=doc_id;
    RETURN jsonb_build_object('done',false,'nextCursor',idx::text,'counts',jsonb_build_object('gov_document_versions',pointed_count,'gov_documents',1),'blobReferences','[]'::jsonb);
   END IF;
   affected:=0;
  ELSE
  EXECUTE format('DELETE FROM public.%I WHERE ctid IN (SELECT x.ctid FROM public.%I x WHERE x.organization_id=$1 LIMIT $2)',t,t) USING p_org,p_limit;
  END IF;
  IF t <> 'gov_documents' THEN GET DIAGNOSTICS affected=ROW_COUNT; END IF;
  IF affected>0 THEN RETURN jsonb_build_object('done',false,'nextCursor',idx::text,'counts',jsonb_build_object(t,affected),'blobReferences','[]'::jsonb); END IF;
  idx:=idx+1;
  IF idx>cardinality(tables) THEN RETURN jsonb_build_object('done',true,'nextCursor',NULL,'counts','{}'::jsonb,'blobReferences','[]'::jsonb); END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION governance_teardown_batch(uuid,uuid,bigint,uuid,text,text,integer) FROM PUBLIC,orgmap_app;
GRANT EXECUTE ON FUNCTION governance_teardown_batch(uuid,uuid,bigint,uuid,text,text,integer) TO orgmap_lifecycle_maintenance;
