-- Internal local-host only. Ledger/host/storage-root validation and file I/O are
-- performed by the supervisor. This migration does not enable BLOBS or DELETED.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='orgmap_lifecycle_blob') THEN CREATE ROLE orgmap_lifecycle_blob NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='orgmap_lifecycle_blob' AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)) OR pg_has_role('orgmap_app','orgmap_lifecycle_blob','MEMBER') THEN RAISE EXCEPTION 'BLOB_REMOVAL_GROUP_UNSAFE'; END IF;
END $$;
CREATE TABLE organization_blob_removal_intents (
 job_id uuid NOT NULL REFERENCES organization_deletion_jobs(id), namespace text NOT NULL,
 blob_key uuid NOT NULL, sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), size bigint NOT NULL CHECK(size>=0),
 state text NOT NULL CHECK(state IN ('PREPARED','REMOVED','HELD')), prepared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 completed_at timestamptz, PRIMARY KEY(job_id,namespace,blob_key),
 FOREIGN KEY(job_id,namespace,blob_key) REFERENCES organization_deletion_blobs(job_id,namespace,blob_key)
);
REVOKE ALL ON organization_blob_removal_intents FROM PUBLIC,orgmap_app,orgmap_lifecycle_maintenance;
CREATE FUNCTION orgmap_blob_removal_validate(p_org uuid,p_job uuid,p_fence bigint,p_token uuid,p_namespace text,p_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE b record; ref_exists boolean; held boolean;
BEGIN
 IF NOT pg_has_role(session_user,'orgmap_lifecycle_blob','MEMBER') OR pg_has_role(session_user,'orgmap_app','MEMBER') OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND rolcanlogin AND NOT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)) THEN RAISE EXCEPTION 'BLOB_REMOVAL_AUTHORITY_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM public.orgmap_deletion_require_schema_lock();
 IF NOT EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=0 AND objid=730409 AND objsubid=1 AND mode='ExclusiveLock' AND granted) OR
    NOT EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=0 AND objid=730502 AND objsubid=1 AND mode='ExclusiveLock' AND granted) THEN
  RAISE EXCEPTION 'BLOB_REMOVAL_LOCK_REQUIRED' USING ERRCODE='55000'; END IF;
 PERFORM public.orgmap_deletion_assert_schema_current(p_org,p_job,p_fence,p_token);
 IF p_namespace IS NULL OR p_namespace NOT IN ('PLATFORM','ORG_BRANDING') OR p_key IS NULL OR
   NOT EXISTS(SELECT 1 FROM public.organization_deletion_jobs WHERE organization_id=p_org AND id=p_job AND phase='BLOBS') OR
   NOT EXISTS(SELECT 1 FROM public.organization_lifecycle WHERE organization_id=p_org AND state='PURGING' AND fence=p_fence) THEN
  RAISE EXCEPTION 'BLOB_REMOVAL_TARGET_INVALID' USING ERRCODE='42501'; END IF;
 IF (SELECT count(*) FROM public.organization_deletion_progress WHERE job_id=p_job AND phase='PURGE' AND done AND context_id=ANY(ARRAY['administration','platform','structure','governance','work','goals','meetings','interoperability','foundation']))<>9 THEN RAISE EXCEPTION 'BLOB_REMOVAL_PURGE_INCOMPLETE' USING ERRCODE='55000'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'BLOB_REMOVAL_VISIBILITY_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM set_config('row_security','off',true);
 SELECT * INTO b FROM public.organization_deletion_blobs WHERE job_id=p_job AND namespace=p_namespace AND blob_key=p_key FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'BLOB_REMOVAL_NOT_IN_MANIFEST' USING ERRCODE='42501'; END IF;
 -- Conservative cross-namespace check: same UUID in any live/garbage ref or
 -- another job is held, even when namespaces have separate roots.
 SELECT EXISTS(SELECT 1 FROM public.platform_files WHERE blob_key=p_key UNION ALL SELECT 1 FROM public.platform_artifacts WHERE blob_key=p_key
  UNION ALL SELECT 1 FROM public.account_media WHERE blob_key=p_key UNION ALL SELECT 1 FROM public.account_media_gc WHERE blob_key=p_key
  UNION ALL SELECT 1 FROM public.administration_branding_assets WHERE blob_key=p_key UNION ALL SELECT 1 FROM public.administration_branding_gc WHERE blob_key=p_key
  UNION ALL SELECT 1 FROM public.administration_branding_stages WHERE blob_key=p_key AND storage_removed_at IS NULL
  UNION ALL SELECT 1 FROM public.organization_deletion_blobs WHERE blob_key=p_key AND job_id<>p_job AND state<>'REMOVED') INTO ref_exists;
 SELECT EXISTS(SELECT 1 FROM public.organization_blob_removal_intents WHERE job_id=p_job AND namespace=p_namespace AND blob_key=p_key AND state='PREPARED') INTO held;
 RETURN jsonb_build_object('authorityId',(SELECT ledger_authority_id::text FROM public.organization_deletion_jobs WHERE id=p_job),'recordSha256',(SELECT ledger_record_sha256 FROM public.organization_deletion_jobs WHERE id=p_job),'namespace',b.namespace,'key',b.blob_key::text,'sha256',b.sha256,'size',b.size,'state',b.state,'intent',held,'referenced',ref_exists);
END $$;
CREATE FUNCTION orgmap_blob_removal_prepare(p_org uuid,p_job uuid,p_fence bigint,p_token uuid,p_namespace text,p_key uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE b jsonb;
BEGIN
 b:=public.orgmap_blob_removal_validate(p_org,p_job,p_fence,p_token,p_namespace,p_key);
 IF b->>'state'<>'PENDING' OR (b->>'referenced')::boolean THEN RAISE EXCEPTION 'BLOB_REMOVAL_HELD' USING ERRCODE='55000'; END IF;
 INSERT INTO public.organization_blob_removal_intents(job_id,namespace,blob_key,sha256,size,state)
 VALUES(p_job,p_namespace,p_key,b->>'sha256',(b->>'size')::bigint,'PREPARED') ON CONFLICT DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM public.organization_blob_removal_intents WHERE job_id=p_job AND namespace=p_namespace AND blob_key=p_key AND sha256=b->>'sha256' AND size=(b->>'size')::bigint AND state='PREPARED') THEN RAISE EXCEPTION 'BLOB_REMOVAL_INTENT_CONFLICT' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION orgmap_blob_removal_finish(p_org uuid,p_job uuid,p_fence bigint,p_token uuid,p_namespace text,p_key uuid,p_result text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE b jsonb;
BEGIN
 b:=public.orgmap_blob_removal_validate(p_org,p_job,p_fence,p_token,p_namespace,p_key);
 IF p_result NOT IN ('REMOVED','HELD') THEN RAISE EXCEPTION 'BLOB_REMOVAL_RESULT_INVALID' USING ERRCODE='22023'; END IF;
 IF p_result='REMOVED' AND (NOT (b->>'intent')::boolean OR (b->>'referenced')::boolean OR b->>'state'<>'PENDING') THEN RAISE EXCEPTION 'BLOB_REMOVAL_INTENT_REQUIRED' USING ERRCODE='42501'; END IF;
 IF p_result='REMOVED' THEN UPDATE public.organization_blob_removal_intents SET state='REMOVED',completed_at=clock_timestamp() WHERE job_id=p_job AND namespace=p_namespace AND blob_key=p_key AND state='PREPARED';
 ELSIF (b->>'intent')::boolean THEN UPDATE public.organization_blob_removal_intents SET state='HELD',completed_at=clock_timestamp() WHERE job_id=p_job AND namespace=p_namespace AND blob_key=p_key AND state='PREPARED'; END IF;
 UPDATE public.organization_deletion_blobs SET state=p_result,attempts=attempts+1 WHERE job_id=p_job AND namespace=p_namespace AND blob_key=p_key AND state='PENDING';
 IF NOT FOUND THEN RAISE EXCEPTION 'BLOB_REMOVAL_STATE_INVALID' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION orgmap_blob_removal_validate(uuid,uuid,bigint,uuid,text,uuid),orgmap_blob_removal_prepare(uuid,uuid,bigint,uuid,text,uuid),orgmap_blob_removal_finish(uuid,uuid,bigint,uuid,text,uuid,text) FROM PUBLIC,orgmap_app;
GRANT EXECUTE ON FUNCTION orgmap_blob_removal_validate(uuid,uuid,bigint,uuid,text,uuid),orgmap_blob_removal_prepare(uuid,uuid,bigint,uuid,text,uuid),orgmap_blob_removal_finish(uuid,uuid,bigint,uuid,text,uuid,text) TO orgmap_lifecycle_blob;
