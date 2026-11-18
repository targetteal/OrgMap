-- Additive isolation guard for 509; preserve old migration and function privileges.
CREATE OR REPLACE FUNCTION iam_mail_claim() RETURNS TABLE(kind text,organization_id uuid,lease_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE item record; claimed record; f bigint;
BEGIN
 IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'LIFECYCLE_ISOLATION_UNSUPPORTED' USING ERRCODE='25001'; END IF;
 -- ACCOUNT is global and intentionally has no tenant lifecycle dependency.
 IF EXISTS(SELECT 1 FROM public.account_mail WHERE state IN ('PENDING','FAILED','PROCESSING') AND next_attempt_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp())) THEN
   INSERT INTO public.iam_mail_scope_leases AS l(kind,organization_id,lease_token,lease_until,lifecycle_fence)
   VALUES('ACCOUNT','00000000-0000-0000-0000-000000000000',gen_random_uuid(),clock_timestamp()+interval '90 seconds',NULL)
   ON CONFLICT ON CONSTRAINT iam_mail_scope_leases_pkey DO UPDATE SET lease_token=EXCLUDED.lease_token,lease_until=EXCLUDED.lease_until,lifecycle_fence=NULL
   WHERE l.lease_until<clock_timestamp() RETURNING l.kind,l.organization_id,l.lease_token INTO claimed;
   IF FOUND THEN kind:=claimed.kind;organization_id:=claimed.organization_id;lease_token:=claimed.lease_token;RETURN NEXT; END IF;
 END IF;
 -- Acquire organization locks in UUID order before touching lease rows.
 FOR item IN
   WITH scopes AS (
    SELECT 'INVITATION'::text AS k,d.organization_id AS o FROM public.invitation_delivery d WHERE state IN ('PENDING','FAILED','PROCESSING') AND next_attempt_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp())
    UNION SELECT 'ENROLLMENT',d.organization_id FROM public.provisioned_enrollment_mail d WHERE state IN ('PENDING','FAILED','PROCESSING') AND next_attempt_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp())
    UNION SELECT 'ADMISSION',d.organization_id FROM public.admission_mail d WHERE state IN ('PENDING','FAILED','PROCESSING') AND next_attempt_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp())
   ) SELECT o.id AS org_id,s.k FROM public.organizations o JOIN scopes s ON s.o=o.id
     ORDER BY o.id,s.k FOR UPDATE OF o SKIP LOCKED LIMIT 30
 LOOP
   SELECT l.fence INTO f FROM public.organization_lifecycle l WHERE l.organization_id=item.org_id AND l.state='ACTIVE';
   IF NOT FOUND THEN CONTINUE; END IF;
   INSERT INTO public.iam_mail_scope_leases AS l(kind,organization_id,lease_token,lease_until,lifecycle_fence)
   VALUES(item.k,item.org_id,gen_random_uuid(),clock_timestamp()+interval '90 seconds',f)
   ON CONFLICT ON CONSTRAINT iam_mail_scope_leases_pkey DO UPDATE SET lease_token=EXCLUDED.lease_token,lease_until=EXCLUDED.lease_until,lifecycle_fence=EXCLUDED.lifecycle_fence
   WHERE l.lease_until<clock_timestamp() RETURNING l.kind,l.organization_id,l.lease_token INTO claimed;
   IF FOUND THEN kind:=claimed.kind;organization_id:=claimed.organization_id;lease_token:=claimed.lease_token;RETURN NEXT; END IF;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION iam_mail_heartbeat(p_kind text,p_org uuid,p_token uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE f bigint;
BEGIN
 IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'LIFECYCLE_ISOLATION_UNSUPPORTED' USING ERRCODE='25001'; END IF;
 IF p_kind='ACCOUNT' AND p_org='00000000-0000-0000-0000-000000000000'::uuid THEN
   UPDATE public.iam_mail_scope_leases SET lease_until=clock_timestamp()+interval '90 seconds' WHERE kind=p_kind AND organization_id=p_org AND lease_token=p_token AND lease_until>clock_timestamp(); RETURN FOUND;
 END IF;
 PERFORM 1 FROM public.organizations WHERE id=p_org FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT fence INTO f FROM public.organization_lifecycle WHERE organization_id=p_org AND state='ACTIVE';
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE public.iam_mail_scope_leases SET lease_until=clock_timestamp()+interval '90 seconds' WHERE kind=p_kind AND organization_id=p_org AND lease_token=p_token AND lease_until>clock_timestamp() AND lifecycle_fence=f;
 RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION iam_mail_release(p_kind text,p_org uuid,p_token uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE f bigint;
BEGIN
 IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'LIFECYCLE_ISOLATION_UNSUPPORTED' USING ERRCODE='25001'; END IF;
 IF p_kind='ACCOUNT' AND p_org='00000000-0000-0000-0000-000000000000'::uuid THEN
   DELETE FROM public.iam_mail_scope_leases WHERE kind=p_kind AND organization_id=p_org AND lease_token=p_token AND lease_until>clock_timestamp(); RETURN FOUND;
 END IF;
 PERFORM 1 FROM public.organizations WHERE id=p_org FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT fence INTO f FROM public.organization_lifecycle WHERE organization_id=p_org AND state='ACTIVE';
 IF NOT FOUND THEN RETURN false; END IF;
 DELETE FROM public.iam_mail_scope_leases WHERE kind=p_kind AND organization_id=p_org AND lease_token=p_token AND lease_until>clock_timestamp() AND lifecycle_fence=f;
 RETURN FOUND;
END $$;
