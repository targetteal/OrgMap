-- Goals batches remain unreachable through the production runner until the
-- registry and a verified I/O barrier exist. No Foundation rows are removed.
CREATE FUNCTION goals_teardown_batch(
 p_org uuid,p_job uuid,p_fence bigint,p_token uuid,p_phase text,p_cursor text,p_limit integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tables text[] := ARRAY['goal_assignments','goal_resource_links','goal_history','goal_origins','goal_period_links','goal_key_results','goals','goal_periods'];
 idx integer; t text; affected integer; progress record; phase_now text; leaf_filter text;
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
 SELECT cursor,done INTO progress FROM public.organization_deletion_progress WHERE job_id=p_job AND context_id='goals' AND phase=p_phase;
 IF FOUND AND progress.done THEN
  IF p_phase='QUIESCE' THEN PERFORM public.orgmap_deletion_attest_quiescence(p_org,p_job,p_fence,p_token,'goals'); END IF;
  RETURN jsonb_build_object('done',true,'nextCursor',NULL,'counts','{}'::jsonb,'blobReferences','[]'::jsonb);
 END IF;
 IF (CASE WHEN FOUND THEN progress.cursor ELSE NULL END) IS DISTINCT FROM p_cursor THEN RAISE EXCEPTION 'TEARDOWN_CURSOR_MISMATCH' USING ERRCODE='42501'; END IF;
 IF p_phase='QUIESCE' THEN
  IF p_cursor IS NOT NULL THEN RAISE EXCEPTION 'INVALID_TEARDOWN_CURSOR' USING ERRCODE='22023'; END IF;
  PERFORM public.orgmap_deletion_attest_quiescence(p_org,p_job,p_fence,p_token,'goals');
  RETURN jsonb_build_object('done',true,'nextCursor',NULL,'counts','{}'::jsonb,'blobReferences','[]'::jsonb);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.organization_deletion_progress WHERE job_id=p_job AND context_id='goals' AND phase='QUIESCE' AND done) THEN
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
 IF NOT EXISTS(SELECT 1 FROM public.organization_deletion_progress WHERE job_id=p_job AND context_id='goals' AND phase='INVENTORY' AND done) THEN
  RAISE EXCEPTION 'TEARDOWN_INVENTORY_REQUIRED' USING ERRCODE='42501';
 END IF;
 IF p_cursor IS NOT NULL AND p_cursor !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION 'INVALID_TEARDOWN_CURSOR' USING ERRCODE='22023'; END IF;
 idx:=COALESCE(p_cursor::integer,1);
 IF idx<1 OR idx>cardinality(tables) THEN RAISE EXCEPTION 'INVALID_TEARDOWN_CURSOR' USING ERRCODE='22023'; END IF;
 LOOP
  t:=tables[idx];
  leaf_filter:=CASE WHEN t='goals' THEN ' AND NOT EXISTS (SELECT 1 FROM public.goals child WHERE child.organization_id=x.organization_id AND child.parent_id=x.id)' ELSE '' END;
  EXECUTE format('DELETE FROM public.%I WHERE ctid IN (SELECT x.ctid FROM public.%I x WHERE x.organization_id=$1%s LIMIT $2)',t,t,leaf_filter) USING p_org,p_limit;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected>0 THEN RETURN jsonb_build_object('done',false,'nextCursor',idx::text,'counts',jsonb_build_object(t,affected),'blobReferences','[]'::jsonb); END IF;
  IF t='goals' AND EXISTS(SELECT 1 FROM public.goals WHERE organization_id=p_org) THEN RAISE EXCEPTION 'TEARDOWN_GOAL_PARENT_CYCLE' USING ERRCODE='23514'; END IF;
  idx:=idx+1;
  IF idx>cardinality(tables) THEN RETURN jsonb_build_object('done',true,'nextCursor',NULL,'counts','{}'::jsonb,'blobReferences','[]'::jsonb); END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION goals_teardown_batch(uuid,uuid,bigint,uuid,text,text,integer) FROM PUBLIC,orgmap_app;
GRANT EXECUTE ON FUNCTION goals_teardown_batch(uuid,uuid,bigint,uuid,text,text,integer) TO orgmap_lifecycle_maintenance;
