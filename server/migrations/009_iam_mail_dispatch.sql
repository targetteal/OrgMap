ALTER TABLE invitation_delivery ADD COLUMN attempts integer NOT NULL DEFAULT 0;
ALTER TABLE invitation_delivery ADD COLUMN last_error text;
ALTER TABLE invitation_delivery ADD COLUMN lease_token uuid;
ALTER TABLE invitation_delivery ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp();
ALTER TABLE account_mail ADD COLUMN lease_token uuid;
ALTER TABLE account_mail ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp();
ALTER TABLE provisioned_enrollment_mail ADD COLUMN lease_token uuid;
ALTER TABLE provisioned_enrollment_mail ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp();
ALTER TABLE provisioned_enrollment_mail ADD COLUMN last_error text;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='orgmap_iam_mail_dispatcher') THEN CREATE ROLE orgmap_iam_mail_dispatcher NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF; END $$;
CREATE TABLE iam_mail_scope_leases(kind text NOT NULL,organization_id uuid NOT NULL,lease_token uuid NOT NULL,lease_until timestamptz NOT NULL,PRIMARY KEY(kind,organization_id));
REVOKE ALL ON iam_mail_scope_leases FROM PUBLIC,orgmap_app,orgmap_iam_mail_dispatcher;
CREATE FUNCTION iam_mail_claim() RETURNS TABLE(kind text,organization_id uuid,lease_token uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
RETURN QUERY WITH scopes AS (
 SELECT 'ACCOUNT'::text k,'00000000-0000-0000-0000-000000000000'::uuid o FROM public.account_mail WHERE state IN ('PENDING','FAILED','PROCESSING') AND next_attempt_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp())
 UNION SELECT 'INVITATION',d.organization_id FROM public.invitation_delivery d WHERE state IN ('PENDING','FAILED','PROCESSING') AND next_attempt_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp())
 UNION SELECT 'ENROLLMENT',d.organization_id FROM public.provisioned_enrollment_mail d WHERE state IN ('PENDING','FAILED','PROCESSING') AND next_attempt_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp())
), claimed AS (INSERT INTO public.iam_mail_scope_leases AS l SELECT k,o,gen_random_uuid(),clock_timestamp()+interval '90 seconds' FROM scopes LIMIT 30 ON CONFLICT ON CONSTRAINT iam_mail_scope_leases_pkey DO UPDATE SET lease_token=EXCLUDED.lease_token,lease_until=EXCLUDED.lease_until WHERE l.lease_until<clock_timestamp() RETURNING l.kind,l.organization_id,l.lease_token) SELECT * FROM claimed;
END $$;
CREATE FUNCTION iam_mail_heartbeat(p_kind text,p_org uuid,p_token uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ WITH changed AS (UPDATE public.iam_mail_scope_leases SET lease_until=clock_timestamp()+interval '90 seconds' WHERE kind=p_kind AND organization_id=p_org AND lease_token=p_token AND lease_until>clock_timestamp() RETURNING 1) SELECT EXISTS(SELECT 1 FROM changed) $$;
CREATE FUNCTION iam_mail_release(p_kind text,p_org uuid,p_token uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ WITH changed AS (DELETE FROM public.iam_mail_scope_leases WHERE kind=p_kind AND organization_id=p_org AND lease_token=p_token AND lease_until>clock_timestamp() RETURNING 1) SELECT EXISTS(SELECT 1 FROM changed) $$;
REVOKE ALL ON FUNCTION iam_mail_claim(),iam_mail_heartbeat(text,uuid,uuid),iam_mail_release(text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION iam_mail_claim(),iam_mail_heartbeat(text,uuid,uuid),iam_mail_release(text,uuid,uuid) TO orgmap_iam_mail_dispatcher;
