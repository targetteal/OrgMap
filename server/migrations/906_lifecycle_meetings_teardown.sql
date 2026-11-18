-- Keep ordinary update/delete denial and admit only the verified row-specific
-- maintenance authority to delete immutable statistics.
CREATE OR REPLACE FUNCTION meeting_statistics_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='UPDATE' OR NOT public.orgmap_deletion_maintenance_row_allowed(OLD.organization_id) THEN
  RAISE EXCEPTION 'Meeting statistics first-close snapshots and observation baselines are immutable' USING ERRCODE='42501';
 END IF;
 RETURN OLD;
END $$;
-- Meetings batches remain unreachable through the production runner until the
-- registry and a verified I/O barrier exist. No Foundation rows are removed.
CREATE FUNCTION meetings_teardown_batch(
 p_org uuid,p_job uuid,p_fence bigint,p_token uuid,p_phase text,p_cursor text,p_limit integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tables text[] := ARRAY[
 '_unlink_items','_unlink_agenda','_unlink_series',
 'meeting_first_close_snapshots','meeting_statistics_observation','meeting_actions',
 'meeting_participants','meeting_report_access','meeting_report_versions','meeting_reports',
 'meeting_updates','meeting_tickets','meeting_document_epochs','meeting_documents',
 'meeting_agenda','meeting_agenda_items','meeting_occurrences','meeting_series',
 'meeting_templates','meeting_export_selections'
]; idx integer; t text; affected integer; progress record; phase_now text;
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
 SELECT cursor,done INTO progress FROM public.organization_deletion_progress WHERE job_id=p_job AND context_id='meetings' AND phase=p_phase;
 IF FOUND AND progress.done THEN
  IF p_phase='QUIESCE' THEN PERFORM public.orgmap_deletion_attest_quiescence(p_org,p_job,p_fence,p_token,'meetings'); END IF;
  RETURN jsonb_build_object('done',true,'nextCursor',NULL,'counts','{}'::jsonb,'blobReferences','[]'::jsonb);
 END IF;
 IF (CASE WHEN FOUND THEN progress.cursor ELSE NULL END) IS DISTINCT FROM p_cursor THEN RAISE EXCEPTION 'TEARDOWN_CURSOR_MISMATCH' USING ERRCODE='42501'; END IF;
 IF p_phase='QUIESCE' THEN
  IF p_cursor IS NOT NULL THEN RAISE EXCEPTION 'INVALID_TEARDOWN_CURSOR' USING ERRCODE='22023'; END IF;
  PERFORM public.orgmap_deletion_attest_quiescence(p_org,p_job,p_fence,p_token,'meetings');
  RETURN jsonb_build_object('done',true,'nextCursor',NULL,'counts','{}'::jsonb,'blobReferences','[]'::jsonb);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.organization_deletion_progress WHERE job_id=p_job AND context_id='meetings' AND phase='QUIESCE' AND done) THEN
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
 IF NOT EXISTS(SELECT 1 FROM public.organization_deletion_progress WHERE job_id=p_job AND context_id='meetings' AND phase='INVENTORY' AND done) THEN
  RAISE EXCEPTION 'TEARDOWN_INVENTORY_REQUIRED' USING ERRCODE='42501';
 END IF;
 IF p_cursor IS NOT NULL AND p_cursor !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION 'INVALID_TEARDOWN_CURSOR' USING ERRCODE='22023'; END IF;
 idx:=COALESCE(p_cursor::integer,1);
 IF idx<1 OR idx>cardinality(tables) THEN RAISE EXCEPTION 'INVALID_TEARDOWN_CURSOR' USING ERRCODE='22023'; END IF;
 PERFORM set_config('orgmap.deletion_organization_id',p_org::text,true);
 PERFORM set_config('orgmap.deletion_job_id',p_job::text,true);
 PERFORM set_config('orgmap.deletion_fence',p_fence::text,true);
 PERFORM set_config('orgmap.deletion_lease_token',p_token::text,true);
 LOOP
  t:=tables[idx];
  IF t='_unlink_items' THEN
   UPDATE public.meeting_agenda_items SET current_placement_id=NULL,last_placement_id=NULL WHERE ctid IN (
    SELECT ctid FROM public.meeting_agenda_items WHERE organization_id=p_org AND (current_placement_id IS NOT NULL OR last_placement_id IS NOT NULL) LIMIT p_limit);
  ELSIF t='_unlink_agenda' THEN
   UPDATE public.meeting_agenda SET transferred_from=NULL WHERE ctid IN (
    SELECT ctid FROM public.meeting_agenda WHERE organization_id=p_org AND transferred_from IS NOT NULL LIMIT p_limit);
  ELSIF t='_unlink_series' THEN
   UPDATE public.meeting_series SET split_from=NULL WHERE ctid IN (
    SELECT ctid FROM public.meeting_series WHERE organization_id=p_org AND split_from IS NOT NULL LIMIT p_limit);
  ELSE
   EXECUTE format('DELETE FROM public.%I WHERE ctid IN (SELECT x.ctid FROM public.%I x WHERE x.organization_id=$1 LIMIT $2)',t,t) USING p_org,p_limit;
  END IF;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF t='_unlink_items' THEN t:='meeting_item_unlinks'; ELSIF t='_unlink_agenda' THEN t:='meeting_agenda_unlinks'; ELSIF t='_unlink_series' THEN t:='meeting_series_unlinks'; END IF;
  IF affected>0 THEN RETURN jsonb_build_object('done',false,'nextCursor',idx::text,'counts',jsonb_build_object(t,affected),'blobReferences','[]'::jsonb); END IF;
  idx:=idx+1;
  IF idx>cardinality(tables) THEN RETURN jsonb_build_object('done',true,'nextCursor',NULL,'counts','{}'::jsonb,'blobReferences','[]'::jsonb); END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION meetings_teardown_batch(uuid,uuid,bigint,uuid,text,text,integer) FROM PUBLIC,orgmap_app;
GRANT EXECUTE ON FUNCTION meetings_teardown_batch(uuid,uuid,bigint,uuid,text,text,integer) TO orgmap_lifecycle_maintenance;
