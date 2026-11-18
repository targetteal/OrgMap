-- Restricted local finalizer. The supervisor must hold stopped-host, ledger,
-- bound-root and all three advisory locks through commit; SQL cannot observe I/O.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='orgmap_lifecycle_finalize') THEN CREATE ROLE orgmap_lifecycle_finalize NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='orgmap_lifecycle_finalize' AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)) OR pg_has_role('orgmap_app','orgmap_lifecycle_finalize','MEMBER') THEN RAISE EXCEPTION 'DELETION_FINALIZER_GROUP_UNSAFE'; END IF;
END $$;
ALTER TABLE organization_deletion_jobs ADD COLUMN completion_receipt jsonb;
CREATE FUNCTION orgmap_deletion_finalize_manifest(p_org uuid,p_job uuid,p_fence bigint,p_token uuid,p_receipt uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE ctx text; n bigint; sz bigint; digest text; expected text; expected_n bigint; refs jsonb;
BEGIN
 IF NOT pg_has_role(session_user,'orgmap_lifecycle_finalize','MEMBER') OR pg_has_role(session_user,'orgmap_app','MEMBER') OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND rolcanlogin AND NOT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)) THEN RAISE EXCEPTION 'DELETION_FINALIZER_AUTHORITY_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM public.orgmap_deletion_require_schema_lock();
 IF NOT EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=0 AND objid=730409 AND objsubid=1 AND mode='ExclusiveLock' AND granted) OR NOT EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=0 AND objid=730502 AND objsubid=1 AND mode='ExclusiveLock' AND granted) THEN RAISE EXCEPTION 'DELETION_FINALIZER_LOCK_REQUIRED' USING ERRCODE='55000'; END IF;
 PERFORM public.orgmap_deletion_drain_assert(p_receipt,p_org,p_job,p_fence,p_token);
 PERFORM public.orgmap_deletion_assert_tenant_owned_empty(p_org,p_job,p_fence,p_token);
 IF NOT EXISTS(SELECT 1 FROM public.organization_deletion_jobs WHERE organization_id=p_org AND id=p_job AND phase='BLOBS' AND state='RUNNING') THEN RAISE EXCEPTION 'DELETION_FINALIZER_PHASE_REQUIRED' USING ERRCODE='55000'; END IF;
 IF (SELECT count(*) FROM public.organization_deletion_progress WHERE job_id=p_job AND phase='PURGE' AND done AND cursor IS NULL AND context_id=ANY(ARRAY['administration','platform','structure','governance','work','goals','meetings','interoperability','foundation']))<>9 THEN RAISE EXCEPTION 'DELETION_PURGE_INCOMPLETE' USING ERRCODE='55000'; END IF;
 FOREACH ctx IN ARRAY ARRAY['administration','platform','structure','governance','work','goals','meetings','interoperability','foundation'] LOOP PERFORM public.orgmap_deletion_assert_owner_empty(p_org,p_job,p_fence,p_token,ctx); END LOOP;
 PERFORM public.orgmap_deletion_assert_mixed_empty(p_org,p_job,p_fence,p_token);
 IF EXISTS(SELECT 1 FROM public.organization_deletion_blobs b LEFT JOIN public.organization_blob_removal_intents i ON i.job_id=b.job_id AND i.namespace=b.namespace AND i.blob_key=b.blob_key WHERE b.job_id=p_job AND (b.state<>'REMOVED' OR i.state IS DISTINCT FROM 'REMOVED' OR i.sha256 IS DISTINCT FROM b.sha256 OR i.size IS DISTINCT FROM b.size)) THEN RAISE EXCEPTION 'DELETION_BLOB_OUTCOME_INCOMPLETE' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM public.organization_deletion_blobs b WHERE b.job_id=p_job AND EXISTS(
  SELECT 1 FROM public.platform_files WHERE blob_key=b.blob_key UNION ALL SELECT 1 FROM public.platform_artifacts WHERE blob_key=b.blob_key
  UNION ALL SELECT 1 FROM public.account_media WHERE blob_key=b.blob_key UNION ALL SELECT 1 FROM public.account_media_gc WHERE blob_key=b.blob_key
  UNION ALL SELECT 1 FROM public.administration_branding_assets WHERE blob_key=b.blob_key UNION ALL SELECT 1 FROM public.administration_branding_gc WHERE blob_key=b.blob_key
  UNION ALL SELECT 1 FROM public.administration_branding_stages WHERE blob_key=b.blob_key AND storage_removed_at IS NULL
  UNION ALL SELECT 1 FROM public.organization_deletion_blobs other WHERE other.blob_key=b.blob_key AND other.job_id<>p_job AND other.state<>'REMOVED')) THEN
  RAISE EXCEPTION 'DELETION_SHARED_BLOB_REFERENCE_REMAINS' USING ERRCODE='55000'; END IF;
 SELECT count(*)::bigint,coalesce(sum(size),0)::bigint,encode(sha256(convert_to(COALESCE(jsonb_agg(jsonb_build_array(namespace,blob_key::text,sha256,size) ORDER BY namespace,blob_key),'[]'::jsonb)::text,'UTF8')),'hex'),coalesce(jsonb_agg(jsonb_build_object('namespace',namespace,'key',blob_key::text,'sha256',sha256,'size',size) ORDER BY namespace,blob_key),'[]'::jsonb) INTO n,sz,digest,refs FROM public.organization_deletion_blobs WHERE job_id=p_job;
 SELECT inventory_manifest_sha256,inventory_manifest_count INTO expected,expected_n FROM public.organization_deletion_jobs WHERE id=p_job AND inventory_seal_receipt IS NOT NULL;
 IF expected IS NULL OR expected IS DISTINCT FROM digest OR expected_n IS DISTINCT FROM n OR n>9007199254740991 OR sz>9007199254740991 THEN RAISE EXCEPTION 'DELETION_INVENTORY_MANIFEST_MISMATCH' USING ERRCODE='55000'; END IF;
 RETURN jsonb_build_object('refs',refs,'objects',n,'bytes',sz);
END $$;
REVOKE ALL ON FUNCTION orgmap_deletion_finalize_manifest(uuid,uuid,bigint,uuid,uuid) FROM PUBLIC,orgmap_app,orgmap_lifecycle_maintenance,orgmap_lifecycle_drain;
GRANT EXECUTE ON FUNCTION orgmap_deletion_finalize_manifest(uuid,uuid,bigint,uuid,uuid) TO orgmap_lifecycle_finalize;

CREATE FUNCTION orgmap_deletion_finalize(p_org uuid,p_job uuid,p_fence bigint,p_token uuid,p_receipt uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE manifest jsonb; completed timestamptz:=clock_timestamp(); result jsonb;
BEGIN
 manifest:=public.orgmap_deletion_finalize_manifest(p_org,p_job,p_fence,p_token,p_receipt);
 result:=jsonb_build_object('schemaVersion',1,'jobId',p_job,'organizationId',p_org,'primaryPurge','COMPLETE','completedAt',completed,'localObjects',manifest->'objects','localBytes',manifest->'bytes','remoteEffects','UNKNOWN','backupCopies','UNKNOWN','lastRetainedCopyExpiresAt',NULL,'retainedTechnicalControls',jsonb_build_array('organization_tombstone','deletion_job','ledger','effect_outcomes','blob_removal_intents','revoked_session_provenance','account_command_tombstones'));
 PERFORM set_config('orgmap.finalization_receipt_id',p_receipt::text,true);
 UPDATE public.organization_lifecycle SET state='DELETED',fence=p_fence+1 WHERE organization_id=p_org AND state='PURGING' AND fence=p_fence;
 IF NOT FOUND THEN RAISE EXCEPTION 'DELETION_FINALIZER_CONFLICT' USING ERRCODE='40001'; END IF;
 UPDATE public.organization_deletion_jobs SET state='COMPLETED',phase='COMPLETED',lifecycle_fence=p_fence+1,completed_at=completed,completion_receipt=result,lease_token=NULL,lease_fence=NULL,lease_until=NULL,version=version+1,updated_at=completed WHERE organization_id=p_org AND id=p_job AND state='RUNNING' AND phase='BLOBS' AND lifecycle_fence=p_fence AND lease_token=p_token AND lease_until>clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION 'DELETION_FINALIZER_CONFLICT' USING ERRCODE='40001'; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION orgmap_deletion_finalize(uuid,uuid,bigint,uuid,uuid) FROM PUBLIC,orgmap_app,orgmap_lifecycle_maintenance,orgmap_lifecycle_drain;
GRANT EXECUTE ON FUNCTION orgmap_deletion_finalize(uuid,uuid,bigint,uuid,uuid) TO orgmap_lifecycle_finalize;

CREATE FUNCTION orgmap_deletion_finalization_commit_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r record;
BEGIN
 IF OLD.state='RUNNING' AND NEW.state='COMPLETED' THEN
  SELECT * INTO r FROM public.organization_deletion_drain_receipts WHERE id=nullif(current_setting('orgmap.finalization_receipt_id',true),'')::uuid AND organization_id=NEW.organization_id AND job_id=NEW.id AND lifecycle_fence=OLD.lifecycle_fence AND lease_token=OLD.lease_token AND transaction_id=txid_current();
  IF NOT FOUND OR OLD.lease_until<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM public.organization_runtime_identity i JOIN public.organization_runtime_mode m ON m.singleton=i.singleton WHERE i.singleton AND m.managed AND i.authority_id=r.authority_id AND i.instance_id=r.instance_id AND i.epoch=r.binding_epoch) THEN RAISE EXCEPTION 'DELETION_FINALIZER_LEASE_EXPIRED' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER organization_deletion_finalization_commit_guard AFTER UPDATE ON organization_deletion_jobs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION orgmap_deletion_finalization_commit_guard();
REVOKE ALL ON FUNCTION orgmap_deletion_finalization_commit_guard() FROM PUBLIC,orgmap_app;

-- Replay does not require the now-invalid RUNNING lease; the supervisor still
-- validates the external host, ledger and physical endpoint before calling it.
CREATE FUNCTION orgmap_deletion_finalization_replay(p_org uuid,p_job uuid,p_authority uuid,p_record_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 IF NOT pg_has_role(session_user,'orgmap_lifecycle_finalize','MEMBER') OR pg_has_role(session_user,'orgmap_app','MEMBER') OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND rolcanlogin AND NOT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)) THEN RAISE EXCEPTION 'DELETION_FINALIZER_AUTHORITY_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT j.completion_receipt INTO result FROM public.organization_deletion_jobs j JOIN public.organization_lifecycle l ON l.organization_id=j.organization_id WHERE j.id=p_job AND j.organization_id=p_org AND j.state='COMPLETED' AND j.phase='COMPLETED' AND l.state='DELETED' AND l.fence=j.lifecycle_fence AND j.ledger_state='CONFIRMED' AND j.ledger_authority_id=p_authority AND j.ledger_record_sha256=p_record_hash;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION orgmap_deletion_finalization_replay(uuid,uuid,uuid,text) FROM PUBLIC,orgmap_app,orgmap_lifecycle_maintenance,orgmap_lifecycle_drain;
GRANT EXECUTE ON FUNCTION orgmap_deletion_finalization_replay(uuid,uuid,uuid,text) TO orgmap_lifecycle_finalize;
