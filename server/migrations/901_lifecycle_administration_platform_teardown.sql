-- Administration and Platform participant primitives. No blob deletion; no app grant.
-- Caller must persist every inventory page and its cursor atomically before PURGE.
CREATE OR REPLACE FUNCTION administration_read_public(requested uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE oid uuid; result jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'PUBLIC_READ_COMMITTED_REQUIRED' USING ERRCODE='25001'; END IF;
 SELECT organization_id INTO oid FROM public.administration_publications WHERE token=requested AND active;
 IF oid IS NULL THEN RETURN NULL; END IF;
 PERFORM 1 FROM public.organizations WHERE id=oid FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.organization_lifecycle WHERE organization_id=oid AND state='ACTIVE') THEN RETURN NULL; END IF;
 SELECT snapshot INTO result FROM public.administration_publications WHERE organization_id=oid AND token=requested AND active;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION administration_branding_public_owner(requested uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE oid uuid; current_oid uuid;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'PUBLIC_READ_COMMITTED_REQUIRED' USING ERRCODE='25001'; END IF;
 SELECT organization_id INTO oid FROM public.administration_branding_assets WHERE purpose='LOGIN_BACKGROUND' AND origin='UPLOADED' AND public_ref=requested;
 IF oid IS NULL THEN RETURN NULL; END IF;
 PERFORM 1 FROM public.organizations WHERE id=oid FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.organization_lifecycle WHERE organization_id=oid AND state='ACTIVE') THEN RETURN NULL; END IF;
 SELECT organization_id INTO current_oid FROM public.administration_branding_assets WHERE organization_id=oid AND purpose='LOGIN_BACKGROUND' AND origin='UPLOADED' AND public_ref=requested;
 RETURN current_oid;
END $$;

-- Immutable sources cannot be rewritten. DELETE is restricted to a valid
-- maintenance login and live row-specific job/fence/lease, including under a
-- SECURITY DEFINER caller. Ordinary app GUCs cannot mint this authority.
CREATE FUNCTION orgmap_administration_platform_immutable_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='UPDATE' OR NOT public.orgmap_deletion_maintenance_row_allowed(OLD.organization_id) THEN
  RAISE EXCEPTION 'IMMUTABLE_HISTORY' USING ERRCODE='42501';
 END IF;
 RETURN OLD;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['administration_revisions','administration_settings_revisions','administration_credential_policy_revisions','administration_admission_policy_revisions','administration_upload_policy_revisions','administration_indicator_consent_history','administration_branding_history','administration_feed_versions','administration_feed_selections','platform_job_attempts'] LOOP
  EXECUTE format('CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.orgmap_administration_platform_immutable_guard()',t);
 END LOOP;
END $$;

CREATE FUNCTION orgmap_administration_platform_teardown_batch(
 p_owner text,p_org uuid,p_job uuid,p_fence bigint,p_token uuid,p_phase text,p_cursor text,p_limit integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
 tables text[]; idx integer; t text; affected integer; total integer:=0; progress record; phase_now text;
 refs jsonb; last_key uuid; has_more boolean; invalid_refs boolean; leaf_filter text; ns text;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'DELETION_READ_COMMITTED_REQUIRED' USING ERRCODE='25001'; END IF;
 IF p_owner NOT IN ('administration','platform') OR p_phase NOT IN ('QUIESCE','INVENTORY','PURGE') OR p_limit IS NULL OR p_limit<1 OR p_limit>500 THEN
  RAISE EXCEPTION 'INVALID_TEARDOWN_BATCH' USING ERRCODE='22023';
 END IF;
 PERFORM public.orgmap_assert_deletion_maintenance(p_org,p_job,p_fence,p_token);
 SELECT phase INTO phase_now FROM public.organization_deletion_jobs WHERE id=p_job AND organization_id=p_org;
 IF phase_now IS DISTINCT FROM p_phase THEN RAISE EXCEPTION 'TEARDOWN_PHASE_MISMATCH' USING ERRCODE='42501'; END IF;
 SELECT cursor,done INTO progress FROM public.organization_deletion_progress WHERE job_id=p_job AND context_id=p_owner AND phase=p_phase;
 IF FOUND AND progress.done THEN
  IF p_phase='QUIESCE' THEN PERFORM public.orgmap_deletion_attest_quiescence(p_org,p_job,p_fence,p_token,p_owner); END IF;
  RETURN jsonb_build_object('done',true,'nextCursor',NULL,'counts','{}'::jsonb,'blobReferences','[]'::jsonb);
 END IF;
 IF (CASE WHEN FOUND THEN progress.cursor ELSE NULL END) IS DISTINCT FROM p_cursor THEN RAISE EXCEPTION 'TEARDOWN_CURSOR_MISMATCH' USING ERRCODE='42501'; END IF;
 IF p_owner='administration' THEN PERFORM pg_advisory_xact_lock(730409); END IF;
 IF p_phase='QUIESCE' THEN
  IF p_cursor IS NOT NULL THEN RAISE EXCEPTION 'INVALID_TEARDOWN_CURSOR' USING ERRCODE='22023'; END IF;
  IF p_owner='platform' AND (
   EXISTS(SELECT 1 FROM public.platform_worker_scopes WHERE organization_id=p_org AND lease_token IS NOT NULL) OR
   EXISTS(SELECT 1 FROM public.platform_jobs WHERE organization_id=p_org AND state='RUNNING') OR
   EXISTS(SELECT 1 FROM public.platform_deliveries WHERE organization_id=p_org AND lease_token IS NOT NULL)
  ) THEN RAISE EXCEPTION 'TEARDOWN_IO_QUIESCE_REQUIRED' USING ERRCODE='55000'; END IF;
  PERFORM public.orgmap_deletion_attest_quiescence(p_org,p_job,p_fence,p_token,p_owner);
  RETURN jsonb_build_object('done',true,'nextCursor',NULL,'counts','{}'::jsonb,'blobReferences','[]'::jsonb);
 END IF;
 -- Retired stages without a GC receipt must still be represented by durable
 -- metadata; otherwise silently omitting the key would lose cleanup evidence.
 IF p_owner='administration' AND EXISTS (
  SELECT 1 FROM public.administration_branding_stages s
  WHERE s.organization_id=p_org AND s.storage_removed_at IS NULL
   AND ((s.state='ABANDONED' AND NOT EXISTS (
      SELECT 1 FROM public.administration_branding_gc g WHERE g.organization_id=p_org
       AND g.blob_key=s.blob_key AND g.sha256=s.sha256 AND g.size=s.size))
    OR (s.state='PUBLISHED' AND NOT EXISTS (
      SELECT 1 FROM public.administration_branding_gc g WHERE g.organization_id=p_org
       AND g.blob_key=s.blob_key AND g.sha256=s.sha256 AND g.size=s.size)
     AND NOT EXISTS (SELECT 1 FROM public.administration_branding_assets a WHERE a.organization_id=p_org
       AND a.origin='UPLOADED' AND a.blob_key=s.blob_key AND a.sha256=s.sha256 AND a.size=s.size)))
 ) THEN RAISE EXCEPTION 'TEARDOWN_BRANDING_STAGE_REFERENCE_MISSING' USING ERRCODE='55000'; END IF;
 IF p_phase='PURGE' THEN PERFORM public.orgmap_deletion_assert_schema_current(p_org,p_job,p_fence,p_token); END IF;
 IF p_phase='INVENTORY' THEN
  IF NOT EXISTS(SELECT 1 FROM public.organization_deletion_progress WHERE job_id=p_job AND context_id=p_owner AND phase='QUIESCE' AND done) THEN
   RAISE EXCEPTION 'TEARDOWN_QUIESCE_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF p_cursor IS NOT NULL AND p_cursor !~ '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' THEN RAISE EXCEPTION 'INVALID_TEARDOWN_CURSOR' USING ERRCODE='22023'; END IF;
  ns:=CASE p_owner WHEN 'administration' THEN 'ORG_BRANDING' ELSE 'PLATFORM' END;
  IF p_owner='administration' THEN
   SELECT EXISTS(SELECT 1 FROM (SELECT blob_key,count(DISTINCT (sha256,size)) AS variants FROM (SELECT blob_key,sha256,size FROM public.administration_branding_assets WHERE organization_id=p_org AND origin='UPLOADED' UNION ALL SELECT blob_key,sha256,size FROM public.administration_branding_gc WHERE organization_id=p_org UNION ALL SELECT blob_key,sha256,size FROM public.administration_branding_stages WHERE organization_id=p_org AND state IN ('WRITING','READY')) b GROUP BY blob_key HAVING count(DISTINCT (sha256,size))>1) conflicts) INTO invalid_refs;
   IF invalid_refs THEN RAISE EXCEPTION 'TEARDOWN_BLOB_METADATA_CONFLICT' USING ERRCODE='22023'; END IF;
   WITH allrefs AS (SELECT blob_key,sha256,size FROM public.administration_branding_assets WHERE organization_id=p_org AND origin='UPLOADED' UNION SELECT blob_key,sha256,size FROM public.administration_branding_gc WHERE organization_id=p_org UNION SELECT blob_key,sha256,size FROM public.administration_branding_stages WHERE organization_id=p_org AND state IN ('WRITING','READY')), page AS (SELECT * FROM allrefs WHERE p_cursor IS NULL OR blob_key>p_cursor::uuid ORDER BY blob_key LIMIT p_limit)
   SELECT COALESCE(jsonb_agg(jsonb_build_object('namespace',ns,'key',blob_key,'sha256',sha256,'size',size) ORDER BY blob_key),'[]'::jsonb),max(blob_key::text)::uuid,count(*)::int INTO refs,last_key,total FROM page;
   SELECT EXISTS(SELECT 1 FROM (SELECT blob_key FROM public.administration_branding_assets WHERE organization_id=p_org AND origin='UPLOADED' UNION SELECT blob_key FROM public.administration_branding_gc WHERE organization_id=p_org UNION SELECT blob_key FROM public.administration_branding_stages WHERE organization_id=p_org AND state IN ('WRITING','READY')) b WHERE blob_key>last_key) INTO has_more;
  ELSE
   SELECT EXISTS(SELECT 1 FROM (SELECT blob_key FROM (SELECT blob_key,sha256,size FROM public.platform_files WHERE organization_id=p_org UNION ALL SELECT blob_key,sha256,size FROM public.platform_artifacts WHERE organization_id=p_org) b GROUP BY blob_key HAVING count(DISTINCT (sha256,size))>1) conflicts) INTO invalid_refs;
   IF invalid_refs THEN RAISE EXCEPTION 'TEARDOWN_BLOB_METADATA_CONFLICT' USING ERRCODE='22023'; END IF;
   WITH allrefs AS (SELECT blob_key,sha256,size FROM public.platform_files WHERE organization_id=p_org UNION SELECT blob_key,sha256,size FROM public.platform_artifacts WHERE organization_id=p_org), page AS (SELECT * FROM allrefs WHERE p_cursor IS NULL OR blob_key>p_cursor::uuid ORDER BY blob_key LIMIT p_limit)
   SELECT COALESCE(jsonb_agg(jsonb_build_object('namespace',ns,'key',blob_key,'sha256',sha256,'size',size) ORDER BY blob_key),'[]'::jsonb),max(blob_key::text)::uuid,count(*)::int INTO refs,last_key,total FROM page;
   SELECT EXISTS(SELECT 1 FROM (SELECT blob_key FROM public.platform_files WHERE organization_id=p_org UNION SELECT blob_key FROM public.platform_artifacts WHERE organization_id=p_org) b WHERE blob_key>last_key) INTO has_more;
  END IF;
  RETURN jsonb_build_object('done',NOT has_more,'nextCursor',CASE WHEN has_more THEN last_key::text ELSE NULL END,'counts',jsonb_build_object('blobReferences',total),'blobReferences',refs);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.organization_lifecycle WHERE organization_id=p_org AND state='PURGING' AND fence=p_fence) THEN
  RAISE EXCEPTION 'TEARDOWN_LIFECYCLE_PURGING_REQUIRED' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.organization_deletion_progress WHERE job_id=p_job AND context_id=p_owner AND phase='INVENTORY' AND done) OR
    NOT EXISTS(SELECT 1 FROM public.organization_deletion_progress WHERE job_id=p_job AND context_id=p_owner AND phase='QUIESCE' AND done) THEN
  RAISE EXCEPTION 'TEARDOWN_INVENTORY_REQUIRED' USING ERRCODE='42501';
 END IF;
 IF p_owner='administration' AND EXISTS(SELECT 1 FROM public.administration_branding_stages WHERE organization_id=p_org AND state='WRITING') THEN
  RAISE EXCEPTION 'TEARDOWN_BRANDING_WRITER_UNRESOLVED' USING ERRCODE='55000';
 END IF;
 -- Ref-check is repeated before every purge batch so metadata arriving late
 -- cannot be deleted without an already persisted matching manifest entry.
 IF p_owner='administration' AND EXISTS (
   SELECT 1 FROM (SELECT blob_key,sha256,size FROM public.administration_branding_assets WHERE organization_id=p_org AND origin='UPLOADED'
    UNION SELECT blob_key,sha256,size FROM public.administration_branding_gc WHERE organization_id=p_org UNION ALL SELECT blob_key,sha256,size FROM public.administration_branding_stages WHERE organization_id=p_org AND state IN ('WRITING','READY')) r
   WHERE NOT EXISTS(SELECT 1 FROM public.organization_deletion_blobs b WHERE b.job_id=p_job AND b.namespace='ORG_BRANDING' AND b.blob_key=r.blob_key AND b.sha256=r.sha256 AND b.size=r.size)
 ) THEN RAISE EXCEPTION 'TEARDOWN_BLOB_MANIFEST_INCOMPLETE' USING ERRCODE='42501'; END IF;
 IF p_owner='platform' AND EXISTS (
   SELECT 1 FROM (SELECT blob_key,sha256,size FROM public.platform_files WHERE organization_id=p_org
    UNION SELECT blob_key,sha256,size FROM public.platform_artifacts WHERE organization_id=p_org) r
   WHERE NOT EXISTS(SELECT 1 FROM public.organization_deletion_blobs b WHERE b.job_id=p_job AND b.namespace='PLATFORM' AND b.blob_key=r.blob_key AND b.sha256=r.sha256 AND b.size=r.size)
 ) THEN RAISE EXCEPTION 'TEARDOWN_BLOB_MANIFEST_INCOMPLETE' USING ERRCODE='42501'; END IF;
 IF p_owner='administration' THEN
  tables:=ARRAY['administration_assistant_commands','administration_assistant_personal','administration_assistant_workspace','administration_feed_versions','administration_feed_selections','administration_feed_posts','administration_indicator_consent_history','administration_indicator_consents','administration_indicator_consent_books','administration_entry_acknowledgements','administration_grants','administration_schema_plans','administration_group_members','administration_group_relations','administration_profile_relations','administration_publications','administration_revisions','administration_records','administration_settings_revisions','administration_settings','administration_credential_policy_revisions','administration_credential_policies','administration_admission_policy_revisions','administration_admission_policies','administration_upload_policy_revisions','administration_upload_policies','administration_branding_stages','administration_branding_history','administration_branding_commands','administration_branding_gc','administration_branding_assets'];
 ELSE
  tables:=ARRAY['platform_scope_wakes','platform_worker_scopes','platform_job_attempts','platform_artifacts','platform_jobs','platform_deliveries','platform_comments','platform_files','platform_views','platform_favorites','platform_preferences','platform_policy','platform_preference_revision','platform_follows'];
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
  leaf_filter:=CASE WHEN t='administration_group_relations' THEN ' AND NOT EXISTS (SELECT 1 FROM public.administration_group_relations child WHERE child.organization_id=x.organization_id AND child.parent_id=x.id)' ELSE '' END;
  EXECUTE format('DELETE FROM public.%I WHERE ctid IN (SELECT x.ctid FROM public.%I x WHERE x.organization_id=$1%s LIMIT $2)',t,t,leaf_filter) USING p_org,p_limit;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected>0 THEN RETURN jsonb_build_object('done',false,'nextCursor',idx::text,'counts',jsonb_build_object(t,affected),'blobReferences','[]'::jsonb); END IF;
  IF t='administration_group_relations' AND EXISTS(SELECT 1 FROM public.administration_group_relations WHERE organization_id=p_org) THEN RAISE EXCEPTION 'TEARDOWN_GROUP_RELATION_CYCLE' USING ERRCODE='23514'; END IF;
  idx:=idx+1;
  IF idx>cardinality(tables) THEN RETURN jsonb_build_object('done',true,'nextCursor',NULL,'counts','{}'::jsonb,'blobReferences','[]'::jsonb); END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION orgmap_administration_platform_teardown_batch(text,uuid,uuid,bigint,uuid,text,text,integer) FROM PUBLIC,orgmap_app,orgmap_lifecycle_maintenance;
CREATE FUNCTION administration_teardown_batch(uuid,uuid,bigint,uuid,text,text,integer) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT public.orgmap_administration_platform_teardown_batch('administration',$1,$2,$3,$4,$5,$6,$7) $$;
CREATE FUNCTION platform_teardown_batch(uuid,uuid,bigint,uuid,text,text,integer) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT public.orgmap_administration_platform_teardown_batch('platform',$1,$2,$3,$4,$5,$6,$7) $$;
REVOKE ALL ON FUNCTION administration_teardown_batch(uuid,uuid,bigint,uuid,text,text,integer),platform_teardown_batch(uuid,uuid,bigint,uuid,text,text,integer) FROM PUBLIC,orgmap_app;
GRANT EXECUTE ON FUNCTION administration_teardown_batch(uuid,uuid,bigint,uuid,text,text,integer),platform_teardown_batch(uuid,uuid,bigint,uuid,text,text,integer) TO orgmap_lifecycle_maintenance;
