-- Account-global mailbox change uses the existing ACCOUNT scope, never a
-- fabricated organization. Metadata dispatch can discover it without secrets.
CREATE OR REPLACE FUNCTION iam_mail_claim() RETURNS TABLE(kind text,organization_id uuid,lease_token uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
RETURN QUERY WITH scopes AS (
 SELECT 'ACCOUNT'::text k,'00000000-0000-0000-0000-000000000000'::uuid o FROM public.account_mail WHERE state IN ('PENDING','FAILED','PROCESSING') AND next_attempt_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp())
 UNION SELECT 'ACCOUNT','00000000-0000-0000-0000-000000000000'::uuid FROM public.account_email_change_mail WHERE state IN ('PENDING','FAILED','PROCESSING') AND next_attempt_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp())
 UNION SELECT 'INVITATION',d.organization_id FROM public.invitation_delivery d WHERE state IN ('PENDING','FAILED','PROCESSING') AND next_attempt_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp())
 UNION SELECT 'ENROLLMENT',d.organization_id FROM public.provisioned_enrollment_mail d WHERE state IN ('PENDING','FAILED','PROCESSING') AND next_attempt_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp())
 UNION SELECT 'ADMISSION',d.organization_id FROM public.admission_mail d WHERE state IN ('PENDING','FAILED','PROCESSING') AND next_attempt_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp())
), claimed AS (INSERT INTO public.iam_mail_scope_leases AS l SELECT k,o,gen_random_uuid(),clock_timestamp()+interval '90 seconds' FROM scopes LIMIT 30 ON CONFLICT ON CONSTRAINT iam_mail_scope_leases_pkey DO UPDATE SET lease_token=EXCLUDED.lease_token,lease_until=EXCLUDED.lease_until WHERE l.lease_until<clock_timestamp() RETURNING l.kind,l.organization_id,l.lease_token) SELECT * FROM claimed;
END $$;
