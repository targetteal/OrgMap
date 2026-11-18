-- Restricted service boundary, unprovisioned by default. This migration does
-- not expose a deletion endpoint or authorize a cut.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='orgmap_lifecycle_acceptance') THEN
  CREATE ROLE orgmap_lifecycle_acceptance NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='orgmap_lifecycle_acceptance'
  AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)) THEN
  RAISE EXCEPTION 'DELETION_ACCEPTANCE_GROUP_UNSAFE';
 END IF;
 IF pg_has_role('orgmap_app','orgmap_lifecycle_acceptance','MEMBER') THEN
  RAISE EXCEPTION 'DELETION_ACCEPTANCE_APP_MEMBERSHIP_UNSAFE';
 END IF;
END $$;

-- No secrets, names, passwords or OTPs. The issuing service must run the real
-- reauthentication and continuity checks in the same transaction before mint.
CREATE TABLE organization_deletion_acceptance_receipts (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
 actor_account_id uuid NOT NULL REFERENCES accounts(id), session_id uuid NOT NULL,
 request_hash text NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
 lifecycle_fence bigint NOT NULL CHECK(lifecycle_fence>0), account_scope uuid[] NOT NULL, transaction_id bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
 consumed_at timestamptz, CHECK(expires_at>created_at)
);
REVOKE ALL ON organization_deletion_acceptance_receipts FROM PUBLIC,orgmap_app,orgmap_lifecycle_acceptance;
ALTER TABLE organization_deletion_acceptance_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_deletion_acceptance_receipts FORCE ROW LEVEL SECURITY;

-- Only the private acceptance service invokes these functions. It must run
-- actual reauthentication and continuity preflight in the SAME transaction;
-- neither a boolean from HTTP nor application role is authority.
CREATE FUNCTION orgmap_acceptance_assert_service() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT pg_has_role(session_user,'orgmap_lifecycle_acceptance','MEMBER') OR
    pg_has_role('orgmap_app','orgmap_lifecycle_acceptance','MEMBER') OR
    EXISTS(SELECT 1 FROM pg_roles WHERE rolname='orgmap_lifecycle_acceptance' AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)) OR
    NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND rolcanlogin AND NOT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)) THEN
  RAISE EXCEPTION 'DELETION_ACCEPTANCE_AUTHORITY_REQUIRED' USING ERRCODE='42501';
 END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'DELETION_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';
 END IF;
END $$;
REVOKE ALL ON FUNCTION orgmap_acceptance_assert_service() FROM PUBLIC,orgmap_app,orgmap_lifecycle_acceptance;

CREATE FUNCTION orgmap_acceptance_mint_receipt(p_org uuid,p_actor uuid,p_session uuid,p_hash text,p_fence bigint,p_accounts uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE receipt_id uuid:=gen_random_uuid(); actual_accounts uuid[];
BEGIN
 PERFORM public.orgmap_acceptance_assert_service();
 IF p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'DELETION_REQUEST_HASH_INVALID'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=p_org FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.organization_lifecycle WHERE organization_id=p_org AND state='ACTIVE' AND fence=p_fence) THEN RAISE EXCEPTION 'DELETION_TARGET_NOT_ACTIVE' USING ERRCODE='42501'; END IF;
 SELECT array_agg(id ORDER BY id) INTO actual_accounts FROM (
  SELECT p_actor AS id UNION SELECT account_id FROM public.interop_federated_identities WHERE organization_id=p_org
  UNION SELECT account_id FROM public.sessions WHERE auth_method='FEDERATED' AND auth_organization_id=p_org AND deletion_revoked_at IS NULL
 ) x;
 IF actual_accounts IS DISTINCT FROM p_accounts THEN RAISE EXCEPTION 'DELETION_ACCOUNT_SCOPE_CHANGED' USING ERRCODE='40001'; END IF;
 PERFORM 1 FROM public.accounts WHERE id=ANY(p_accounts) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.sessions WHERE id=p_session AND account_id=p_actor AND expires_at>clock_timestamp() FOR SHARE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.members WHERE organization_id=p_org AND account_id=p_actor AND status='ACTIVE' AND org_role='OWNER' AND member_type='MEMBER') THEN
  RAISE EXCEPTION 'DELETION_ACTOR_INVALID' USING ERRCODE='42501';
 END IF;
 INSERT INTO public.organization_deletion_acceptance_receipts(id,organization_id,actor_account_id,session_id,request_hash,lifecycle_fence,account_scope,transaction_id,expires_at)
 VALUES(receipt_id,p_org,p_actor,p_session,p_hash,p_fence,p_accounts,txid_current(),clock_timestamp()+interval '1 minute');
 RETURN receipt_id;
END $$;
REVOKE ALL ON FUNCTION orgmap_acceptance_mint_receipt(uuid,uuid,uuid,text,bigint,uuid[]) FROM PUBLIC,orgmap_app;
GRANT EXECUTE ON FUNCTION orgmap_acceptance_mint_receipt(uuid,uuid,uuid,text,bigint,uuid[]) TO orgmap_lifecycle_acceptance;

CREATE FUNCTION orgmap_acceptance_cut(p_receipt uuid,p_org uuid,p_actor uuid,p_session uuid,p_hash text,p_fence bigint,p_version integer,p_name text,p_key text,p_job uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org record; rec record; n integer; new_fence bigint; actual_accounts uuid[];
BEGIN
 PERFORM public.orgmap_acceptance_assert_service();
 IF p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 128 OR p_job IS NULL THEN RAISE EXCEPTION 'DELETION_REQUEST_INVALID'; END IF;
 SELECT * INTO org FROM public.organizations WHERE id=p_org FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.organization_lifecycle WHERE organization_id=p_org AND state='ACTIVE' AND fence=p_fence) THEN RAISE EXCEPTION 'DELETION_TARGET_NOT_ACTIVE' USING ERRCODE='42501'; END IF;
 -- Discovery does not lock receipt before Accounts. Any new Account scope
 -- invalidates the preflight; never acquire an unplanned Account after Session.
 SELECT * INTO rec FROM public.organization_deletion_acceptance_receipts WHERE id=p_receipt;
 IF NOT FOUND THEN RAISE EXCEPTION 'DELETION_RECEIPT_INVALID' USING ERRCODE='42501'; END IF;
 SELECT array_agg(id ORDER BY id) INTO actual_accounts FROM (
  SELECT p_actor AS id UNION SELECT account_id FROM public.interop_federated_identities WHERE organization_id=p_org
  UNION SELECT account_id FROM public.sessions WHERE auth_method='FEDERATED' AND auth_organization_id=p_org AND deletion_revoked_at IS NULL
 ) x;
 IF actual_accounts IS DISTINCT FROM rec.account_scope THEN RAISE EXCEPTION 'DELETION_ACCOUNT_SCOPE_CHANGED' USING ERRCODE='40001'; END IF;
 PERFORM 1 FROM public.accounts WHERE id=ANY(rec.account_scope) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.sessions WHERE id=p_session AND account_id=p_actor AND expires_at>clock_timestamp() FOR SHARE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.members WHERE organization_id=p_org AND account_id=p_actor AND status='ACTIVE' AND org_role='OWNER' AND member_type='MEMBER') THEN RAISE EXCEPTION 'DELETION_ACTOR_INVALID' USING ERRCODE='42501'; END IF;
 SELECT * INTO rec FROM public.organization_deletion_acceptance_receipts WHERE id=p_receipt FOR UPDATE;
 IF NOT FOUND OR rec.organization_id IS DISTINCT FROM p_org OR rec.actor_account_id IS DISTINCT FROM p_actor OR rec.session_id IS DISTINCT FROM p_session OR
   rec.request_hash IS DISTINCT FROM p_hash OR rec.lifecycle_fence IS DISTINCT FROM p_fence OR rec.transaction_id<>txid_current() OR
   rec.consumed_at IS NOT NULL OR rec.expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION 'DELETION_RECEIPT_INVALID' USING ERRCODE='42501';
 END IF;
 IF org.version IS DISTINCT FROM p_version OR org.name IS DISTINCT FROM p_name THEN RAISE EXCEPTION 'DELETION_CONFIRMATION_STALE' USING ERRCODE='22023'; END IF;
 SELECT count(*)::integer INTO n FROM public.sessions WHERE auth_method='FEDERATED' AND auth_organization_id=p_org AND deletion_revoked_at IS NULL;
 IF n>500 THEN RAISE EXCEPTION 'DELETION_SESSION_LIMIT_EXCEEDED' USING ERRCODE='54000'; END IF;
 UPDATE public.organization_lifecycle SET state='DELETION_PENDING',fence=fence+1 WHERE organization_id=p_org RETURNING fence INTO new_fence;
 INSERT INTO public.organization_deletion_jobs(organization_id,id,initiator_account_id,request_key,request_hash,accepted_fence,lifecycle_fence)
 VALUES(p_org,p_job,p_actor,p_key,p_hash,new_fence,new_fence);
 UPDATE public.sessions SET expires_at=LEAST(expires_at,clock_timestamp()),deletion_revoked_at=clock_timestamp(),deletion_revoked_job_id=p_job
 WHERE auth_method='FEDERATED' AND auth_organization_id=p_org AND deletion_revoked_at IS NULL;
 UPDATE public.organization_deletion_acceptance_receipts SET consumed_at=clock_timestamp() WHERE id=p_receipt;
 RETURN jsonb_build_object('jobId',p_job,'fence',new_fence::text,'expiredSessions',n);
END $$;
REVOKE ALL ON FUNCTION orgmap_acceptance_cut(uuid,uuid,uuid,uuid,text,bigint,integer,text,text,uuid) FROM PUBLIC,orgmap_app;
GRANT EXECUTE ON FUNCTION orgmap_acceptance_cut(uuid,uuid,uuid,uuid,text,bigint,integer,text,text,uuid) TO orgmap_lifecycle_acceptance;

-- Closed-job replay is authorized to the initiator with a currently live
-- independent session; do not reopen or replay organization payload.
CREATE FUNCTION orgmap_acceptance_replay(p_org uuid,p_token_hash text,p_csrf text,p_key text,p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j record; sess record;
BEGIN
 PERFORM public.orgmap_acceptance_assert_service();
 PERFORM 1 FROM public.organizations WHERE id=p_org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'DELETION_TARGET_NOT_FOUND' USING ERRCODE='42501'; END IF;
 SELECT * INTO j FROM public.organization_deletion_jobs WHERE organization_id=p_org;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT id,account_id INTO sess FROM public.sessions WHERE token_hash=p_token_hash AND expires_at>clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION 'DELETION_REPLAY_UNAUTHORIZED' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.accounts WHERE id=sess.account_id FOR UPDATE;
 PERFORM 1 FROM public.sessions WHERE id=sess.id AND account_id=sess.account_id AND token_hash=p_token_hash AND csrf=p_csrf AND expires_at>clock_timestamp() FOR SHARE;
 IF NOT FOUND OR sess.account_id<>j.initiator_account_id THEN RAISE EXCEPTION 'DELETION_REPLAY_UNAUTHORIZED' USING ERRCODE='42501'; END IF;
 IF j.request_key IS DISTINCT FROM p_key OR j.request_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'DELETION_IDEMPOTENCY_CONFLICT' USING ERRCODE='23505'; END IF;
 RETURN jsonb_build_object('jobId',j.id,'fence',j.lifecycle_fence::text,'replayed',true);
END $$;
REVOKE ALL ON FUNCTION orgmap_acceptance_replay(uuid,text,text,text,text) FROM PUBLIC,orgmap_app;
GRANT EXECUTE ON FUNCTION orgmap_acceptance_replay(uuid,text,text,text,text) TO orgmap_lifecycle_acceptance;
