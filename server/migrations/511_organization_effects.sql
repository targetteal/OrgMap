-- Tenant mail must preserve an ambiguous outcome without dispatching it again.
ALTER TABLE admission_mail DROP CONSTRAINT admission_mail_state_check;
ALTER TABLE admission_mail ADD CONSTRAINT admission_mail_state_check CHECK(state IN ('PENDING','PROCESSING','DELIVERED','FAILED','CANCELLED','OUTCOME_UNKNOWN'));
ALTER TABLE provisioned_enrollment_mail DROP CONSTRAINT provisioned_enrollment_mail_state_check;
ALTER TABLE provisioned_enrollment_mail ADD CONSTRAINT provisioned_enrollment_mail_state_check CHECK(state IN ('PENDING','PROCESSING','DELIVERED','FAILED','CANCELLED','OUTCOME_UNKNOWN'));
-- Durable authorization records, containing no mail addresses, URLs or payloads.
-- The owner-specific producer must lock Org first and validate its real lease.
CREATE TABLE organization_effects (
 organization_id uuid NOT NULL REFERENCES organizations(id),
 id uuid NOT NULL,
 owner text NOT NULL CHECK(owner IN ('IAM','PLATFORM','INTEROP')),
 effect_key text NOT NULL CHECK(effect_key ~ '^[a-zA-Z0-9:_-]{1,160}$'),
 lifecycle_fence bigint NOT NULL CHECK(lifecycle_fence>0),
 source_lease_token uuid NOT NULL,
 effect_token uuid NOT NULL UNIQUE,
 state text NOT NULL DEFAULT 'AUTHORIZED' CHECK(state IN ('AUTHORIZED','CONFIRMED','OUTCOME_UNKNOWN','NOT_SENT','REJECTED')),
 authorized_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 completed_at timestamptz,
 PRIMARY KEY(organization_id,id), UNIQUE(organization_id,owner,effect_key,source_lease_token),
 CHECK((state='AUTHORIZED')=(completed_at IS NULL))
);
-- A potentially delivered or accepted effect blocks all further attempts.
-- Only a proven NOT_SENT/REJECTED outcome permits a distinct lease attempt.
CREATE UNIQUE INDEX organization_effects_no_unsafe_retry ON organization_effects(organization_id,owner,effect_key)
 WHERE state IN ('AUTHORIZED','CONFIRMED','OUTCOME_UNKNOWN');
ALTER TABLE organization_effects ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON organization_effects USING(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid)
 WITH CHECK(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid);
REVOKE ALL ON organization_effects FROM PUBLIC,orgmap_app;
GRANT SELECT,INSERT,UPDATE ON organization_effects TO orgmap_app;
CREATE FUNCTION orgmap_validate_effect_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'effect record deletion requires a future maintenance contract'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'AUTHORIZED' OR NEW.completed_at IS NOT NULL THEN RAISE EXCEPTION 'effect must start authorized'; END IF;
  RETURN NEW;
 END IF;
 IF (NEW.organization_id,NEW.id,NEW.owner,NEW.effect_key,NEW.lifecycle_fence,NEW.source_lease_token,NEW.effect_token,NEW.authorized_at)
    IS DISTINCT FROM (OLD.organization_id,OLD.id,OLD.owner,OLD.effect_key,OLD.lifecycle_fence,OLD.source_lease_token,OLD.effect_token,OLD.authorized_at)
    OR OLD.state<>'AUTHORIZED' OR NEW.state NOT IN ('CONFIRMED','OUTCOME_UNKNOWN','NOT_SENT','REJECTED') OR NEW.completed_at IS NULL THEN
   RAISE EXCEPTION 'invalid effect transition';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER organization_effect_transition BEFORE INSERT OR UPDATE OR DELETE ON organization_effects
FOR EACH ROW EXECUTE FUNCTION orgmap_validate_effect_transition();
