-- Reserve the exact private key and digest before any storage write. WRITING
-- never expires into safety: a crashed writer requires verified reconciliation.
CREATE TABLE administration_branding_stages (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES organizations(id),
 actor_id uuid NOT NULL REFERENCES accounts(id),
 credential_scope text NOT NULL,
 purpose text NOT NULL CHECK(purpose IN ('WORKSPACE_LOGO','EMAIL_LOGO','LOGIN_BACKGROUND')),
 request_key text NOT NULL CHECK(length(request_key) BETWEEN 1 AND 128),
 request_hash text NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
 lifecycle_fence bigint NOT NULL CHECK(lifecycle_fence>0),
 base_revision integer NOT NULL CHECK(base_revision>=0),
 blob_key uuid NOT NULL UNIQUE,
 sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 size integer NOT NULL CHECK(size BETWEEN 1 AND 5242880),
 width integer NOT NULL CHECK(width BETWEEN 1 AND 2560),
 height integer NOT NULL CHECK(height BETWEEN 1 AND 1920),
 write_token uuid NOT NULL UNIQUE,
 writer_host text NOT NULL CHECK(length(writer_host) BETWEEN 1 AND 255),
 writer_pid integer NOT NULL CHECK(writer_pid>0),
 state text NOT NULL CHECK(state IN ('WRITING','READY','PUBLISHED','ABANDONED')),
 published_revision integer CHECK(published_revision>0),
 storage_removed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organization_id,actor_id,credential_scope,purpose,request_key),
 CHECK((state='PUBLISHED')=(published_revision IS NOT NULL)),
 CHECK(storage_removed_at IS NULL OR state IN ('PUBLISHED','ABANDONED'))
);
ALTER TABLE administration_branding_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE administration_branding_stages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON administration_branding_stages USING(organization_id::text=current_setting('orgmap.organization_id',true));
REVOKE ALL ON administration_branding_stages FROM PUBLIC,orgmap_app;
GRANT SELECT,INSERT,UPDATE ON administration_branding_stages TO orgmap_app;
CREATE FUNCTION administration_branding_stage_transition() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'WRITING' THEN RAISE EXCEPTION 'BRANDING_STAGE_INITIAL_STATE_INVALID'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.storage_removed_at IS NULL AND NEW.storage_removed_at IS NOT NULL AND NEW.state=OLD.state AND
    NEW.state IN ('PUBLISHED','ABANDONED') AND
    (to_jsonb(NEW)-ARRAY['storage_removed_at','updated_at'])=(to_jsonb(OLD)-ARRAY['storage_removed_at','updated_at']) THEN RETURN NEW; END IF;
 IF (to_jsonb(NEW)-ARRAY['state','published_revision','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','published_revision','updated_at']) OR
    NOT((OLD.state='WRITING' AND NEW.state IN ('READY','ABANDONED')) OR (OLD.state='READY' AND NEW.state IN ('PUBLISHED','ABANDONED'))) THEN
  RAISE EXCEPTION 'BRANDING_STAGE_TRANSITION_INVALID';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION administration_branding_stage_transition() FROM PUBLIC;
CREATE TRIGGER administration_branding_stage_transition BEFORE INSERT OR UPDATE ON administration_branding_stages FOR EACH ROW EXECUTE FUNCTION administration_branding_stage_transition();

-- Internal GC guard across every tenant, without revealing IDs or payloads.
-- Caller holds the same advisory lock as publication/storage/backup.
CREATE FUNCTION administration_branding_blob_referenced(p_org uuid,p_key uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'LIFECYCLE_ISOLATION_UNSUPPORTED' USING ERRCODE='25001'; END IF;
 RETURN EXISTS(SELECT 1 FROM public.administration_branding_assets WHERE origin='UPLOADED' AND blob_key=p_key)
     OR EXISTS(SELECT 1 FROM public.administration_branding_stages WHERE blob_key=p_key AND
          (state IN ('WRITING','READY') OR (organization_id<>p_org AND storage_removed_at IS NULL)))
     OR EXISTS(SELECT 1 FROM public.administration_branding_gc WHERE blob_key=p_key AND organization_id<>p_org);
END $$;
REVOKE ALL ON FUNCTION administration_branding_blob_referenced(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION administration_branding_blob_referenced(uuid,uuid) TO orgmap_app;
