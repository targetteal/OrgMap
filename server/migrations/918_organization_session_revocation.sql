-- A revoked A-origin session remains a FEDERATED technical tombstone; it can
-- never become a usable global LEGACY session by clearing provenance.
ALTER TABLE sessions ADD COLUMN deletion_revoked_at timestamptz;
ALTER TABLE sessions ADD COLUMN deletion_revoked_job_id uuid REFERENCES organization_deletion_jobs(id);
ALTER TABLE sessions DROP CONSTRAINT federated_session_provenance;
ALTER TABLE sessions ADD CONSTRAINT federated_session_provenance CHECK (
 (deletion_revoked_at IS NULL AND deletion_revoked_job_id IS NULL AND
  (auth_method<>'FEDERATED' OR (auth_organization_id IS NOT NULL AND auth_connection_id IS NOT NULL AND auth_issuer IS NOT NULL AND auth_subject IS NOT NULL))) OR
 (deletion_revoked_at IS NOT NULL AND deletion_revoked_job_id IS NOT NULL AND auth_method='FEDERATED' AND
  auth_organization_id IS NOT NULL AND auth_connection_id IS NOT NULL AND expires_at<=deletion_revoked_at)
);

CREATE FUNCTION orgmap_session_deletion_revocation_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE allowed boolean:=false;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.deletion_revoked_at IS NOT NULL OR NEW.deletion_revoked_job_id IS NOT NULL THEN
   RAISE EXCEPTION 'SESSION_REVOCATION_FORGED' USING ERRCODE='42501'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN
  IF OLD.deletion_revoked_at IS NULL THEN RETURN OLD; END IF;
  -- DELETE holds a row lock which blocks concurrent new FK references. A
  -- fresh snapshot and unfiltered visibility are mandatory before allowing it.
  IF current_setting('transaction_isolation')<>'read committed' OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
   RAISE EXCEPTION 'SESSION_REVOCATION_VISIBILITY_REQUIRED' USING ERRCODE='42501'; END IF;
  PERFORM set_config('row_security','off',true);
  IF EXISTS(SELECT 1 FROM public.provisioned_enrollment_reauth WHERE session_id=OLD.id) THEN RETURN NULL; END IF;
  RETURN OLD;
 END IF;
 IF OLD.deletion_revoked_at IS NULL AND NEW.deletion_revoked_at IS NULL AND NEW.deletion_revoked_job_id IS NULL THEN RETURN NEW; END IF;
 IF OLD.deletion_revoked_at IS NOT NULL AND (NEW.id,NEW.account_id,NEW.auth_method,NEW.auth_organization_id,NEW.auth_connection_id,NEW.deletion_revoked_at,NEW.deletion_revoked_job_id)
   IS DISTINCT FROM (OLD.id,OLD.account_id,OLD.auth_method,OLD.auth_organization_id,OLD.auth_connection_id,OLD.deletion_revoked_at,OLD.deletion_revoked_job_id) THEN
  RAISE EXCEPTION 'SESSION_REVOCATION_IMMUTABLE' USING ERRCODE='42501'; END IF;
 IF OLD.deletion_revoked_at IS NOT NULL AND NEW.expires_at>OLD.expires_at THEN
  RAISE EXCEPTION 'SESSION_REVOCATION_IMMUTABLE' USING ERRCODE='42501'; END IF;
 IF OLD.deletion_revoked_at IS NULL THEN
  -- Private acceptance service may mark only an already-created cut job.
  IF pg_has_role(session_user,'orgmap_lifecycle_acceptance','MEMBER') AND NOT pg_has_role('orgmap_app','orgmap_lifecycle_acceptance','MEMBER') AND
    NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND (rolsuper OR rolbypassrls)) AND EXISTS(
      SELECT 1 FROM public.organization_deletion_jobs j JOIN public.organization_lifecycle l ON l.organization_id=j.organization_id
      WHERE j.id=NEW.deletion_revoked_job_id AND j.organization_id=OLD.auth_organization_id AND l.state='DELETION_PENDING' AND l.fence=j.lifecycle_fence) THEN allowed:=true; END IF;
  -- Restricted maintenance uses the live row-specific 510 authority.
  IF NOT allowed AND public.orgmap_deletion_maintenance_row_allowed(OLD.auth_organization_id) AND
    nullif(current_setting('orgmap.deletion_job_id',true),'')::uuid=NEW.deletion_revoked_job_id THEN allowed:=true; END IF;
  IF NOT allowed OR OLD.auth_method<>'FEDERATED' OR NEW.auth_method IS DISTINCT FROM OLD.auth_method OR
     NEW.auth_organization_id IS DISTINCT FROM OLD.auth_organization_id OR NEW.auth_connection_id IS DISTINCT FROM OLD.auth_connection_id OR
     NEW.expires_at>NEW.deletion_revoked_at THEN RAISE EXCEPTION 'SESSION_REVOCATION_FORGED' USING ERRCODE='42501'; END IF;
  RETURN NEW;
 END IF;
 -- Only verified maintenance may replace sensitive credential/provenance
 -- content with the fixed inert projection while preserving technical IDs.
 IF (NEW.token_hash,NEW.csrf,NEW.auth_issuer,NEW.auth_subject,NEW.auth_amr,NEW.auth_time,NEW.mfa_verified_at,NEW.mfa_factor_revision)
   IS DISTINCT FROM (OLD.token_hash,OLD.csrf,OLD.auth_issuer,OLD.auth_subject,OLD.auth_amr,OLD.auth_time,OLD.mfa_verified_at,OLD.mfa_factor_revision) THEN
  IF NOT public.orgmap_deletion_maintenance_row_allowed(OLD.auth_organization_id) OR
    nullif(current_setting('orgmap.deletion_job_id',true),'')::uuid IS DISTINCT FROM OLD.deletion_revoked_job_id OR
    NEW.token_hash IS DISTINCT FROM ('revoked:'||OLD.id::text) OR NEW.csrf IS DISTINCT FROM 'revoked' OR
    NEW.auth_issuer IS NOT NULL OR NEW.auth_subject IS NOT NULL OR NEW.auth_amr IS DISTINCT FROM '[]'::jsonb OR
    NEW.auth_time IS NOT NULL OR NEW.mfa_verified_at IS NOT NULL OR NEW.mfa_factor_revision IS NOT NULL THEN
   RAISE EXCEPTION 'SESSION_REVOCATION_IMMUTABLE' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION orgmap_session_deletion_revocation_guard() FROM PUBLIC,orgmap_app;
CREATE TRIGGER session_deletion_revocation_guard BEFORE INSERT OR UPDATE OR DELETE ON sessions
 FOR EACH ROW EXECUTE FUNCTION orgmap_session_deletion_revocation_guard();
