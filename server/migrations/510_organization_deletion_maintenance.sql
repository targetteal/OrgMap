-- LF04 maintenance infrastructure. No HTTP endpoint or general application DELETE grant.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='orgmap_lifecycle_maintenance') THEN
  CREATE ROLE orgmap_lifecycle_maintenance NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='orgmap_lifecycle_maintenance' AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)) THEN
  RAISE EXCEPTION 'DELETION_MAINTENANCE_GROUP_UNSAFE';
 END IF;
END $$;

CREATE TABLE organization_deletion_jobs (
 organization_id uuid PRIMARY KEY REFERENCES organizations(id),
 id uuid NOT NULL UNIQUE,
 initiator_account_id uuid NOT NULL REFERENCES accounts(id),
 request_key text NOT NULL CHECK(length(request_key) BETWEEN 1 AND 128),
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 accepted_fence bigint NOT NULL CHECK(accepted_fence>1),
 lifecycle_fence bigint NOT NULL CHECK(lifecycle_fence>=accepted_fence),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','RUNNING','FAILED','COMPLETED')),
 phase text NOT NULL DEFAULT 'QUIESCE' CHECK(phase IN ('QUIESCE','INVENTORY','PURGE','BLOBS','FINALIZE','COMPLETED')),
 ledger_state text NOT NULL DEFAULT 'PENDING' CHECK(ledger_state IN ('PENDING','CONFIRMED')),
 ledger_authority_id uuid,
 ledger_record_sha256 text CHECK(ledger_record_sha256 IS NULL OR ledger_record_sha256 ~ '^[a-f0-9]{64}$'),
 lease_token uuid,
 lease_until timestamptz,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 error_code text CHECK(error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{0,79}$'),
 backup_copies text NOT NULL DEFAULT 'UNKNOWN' CHECK(backup_copies IN ('PENDING','COMPLETE','UNKNOWN')),
 last_retained_copy_expires_at timestamptz,
 accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 completed_at timestamptz,
 CHECK((lease_token IS NULL)=(lease_until IS NULL)),
 CHECK(ledger_state<>'CONFIRMED' OR (ledger_authority_id IS NOT NULL AND ledger_record_sha256 IS NOT NULL))
);
CREATE TABLE organization_deletion_progress (
 job_id uuid NOT NULL REFERENCES organization_deletion_jobs(id),
 context_id text NOT NULL CHECK(context_id ~ '^[a-z][a-z0-9-]{0,49}$'),
 phase text NOT NULL CHECK(phase IN ('QUIESCE','INVENTORY','PURGE')),
 cursor text,
 done boolean NOT NULL DEFAULT false,
 counts jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(counts)='object'),
 PRIMARY KEY(job_id,context_id,phase)
);
CREATE TABLE organization_deletion_blobs (
 job_id uuid NOT NULL REFERENCES organization_deletion_jobs(id),
 namespace text NOT NULL CHECK(namespace IN ('PLATFORM','ORG_BRANDING')),
 blob_key uuid NOT NULL,
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 size bigint NOT NULL CHECK(size>=0),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','REMOVED','HELD','FAILED')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 PRIMARY KEY(job_id,namespace,blob_key)
);
REVOKE ALL ON organization_deletion_jobs,organization_deletion_progress,organization_deletion_blobs FROM PUBLIC,orgmap_app;
ALTER TABLE organization_deletion_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_deletion_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY deletion_job_own_read ON organization_deletion_jobs FOR SELECT TO orgmap_app USING (
 organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid OR
 initiator_account_id=nullif(current_setting('orgmap.account_id',true),'')::uuid
);
GRANT SELECT ON organization_deletion_jobs TO orgmap_app;

-- Participants execute this before touching any owned row. A boolean GUC or SET
-- ROLE by the app cannot mint authority: the login must be a restricted member
-- of the maintenance group, and the persisted live job/fence/lease must match.
CREATE FUNCTION orgmap_assert_deletion_maintenance(p_org uuid,p_job uuid,p_fence bigint,p_token uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j record; l record;
BEGIN
 IF NOT pg_has_role(session_user,'orgmap_lifecycle_maintenance','MEMBER') OR pg_has_role(session_user,'orgmap_app','MEMBER') OR
    EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'DELETION_MAINTENANCE_AUTHORITY_REQUIRED' USING ERRCODE='42501';
 END IF;
 PERFORM 1 FROM public.organizations WHERE id=p_org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'DELETION_MAINTENANCE_TARGET_INVALID' USING ERRCODE='42501'; END IF;
 SELECT * INTO l FROM public.organization_lifecycle WHERE organization_id=p_org;
 SELECT * INTO j FROM public.organization_deletion_jobs WHERE organization_id=p_org AND id=p_job FOR UPDATE;
 IF NOT FOUND OR l.state NOT IN ('DELETION_PENDING','PURGING') OR l.fence<>p_fence OR
    j.lifecycle_fence<>p_fence OR j.ledger_state<>'CONFIRMED' OR j.state<>'RUNNING' OR
    j.lease_token IS DISTINCT FROM p_token OR p_token IS NULL OR j.lease_until<=clock_timestamp() THEN
  RAISE EXCEPTION 'DELETION_MAINTENANCE_LEASE_INVALID' USING ERRCODE='42501';
 END IF;
END $$;
REVOKE ALL ON FUNCTION orgmap_assert_deletion_maintenance(uuid,uuid,bigint,uuid) FROM PUBLIC,orgmap_app;
GRANT EXECUTE ON FUNCTION orgmap_assert_deletion_maintenance(uuid,uuid,bigint,uuid) TO orgmap_lifecycle_maintenance;

-- Trigger helpers may use this predicate, but ordinary roles always get false.
-- Each row supplies its actual tenant ID; no arbitrary JSON identifies a target.
CREATE FUNCTION orgmap_deletion_maintenance_row_allowed(p_org uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT pg_has_role(session_user,'orgmap_lifecycle_maintenance','MEMBER') OR pg_has_role(session_user,'orgmap_app','MEMBER') OR
    EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND (rolsuper OR rolbypassrls)) THEN RETURN false; END IF;
 IF nullif(current_setting('orgmap.deletion_organization_id',true),'')::uuid IS DISTINCT FROM p_org THEN RETURN false; END IF;
 PERFORM public.orgmap_assert_deletion_maintenance(p_org,
   nullif(current_setting('orgmap.deletion_job_id',true),'')::uuid,
   nullif(current_setting('orgmap.deletion_fence',true),'')::bigint,
   nullif(current_setting('orgmap.deletion_lease_token',true),'')::uuid);
 RETURN true;
EXCEPTION WHEN invalid_text_representation OR insufficient_privilege THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION orgmap_deletion_maintenance_row_allowed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION orgmap_deletion_maintenance_row_allowed(uuid) TO orgmap_app,orgmap_lifecycle_maintenance;
