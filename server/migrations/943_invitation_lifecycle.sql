-- Historical UUIDs do not carry chronology: existing timestamps stay unknown.
ALTER TABLE invitations ADD COLUMN created_at timestamptz;
ALTER TABLE invitations ALTER COLUMN created_at SET DEFAULT clock_timestamp();
ALTER TABLE invitations ADD COLUMN accepted_at timestamptz;
ALTER TABLE invitations ADD COLUMN revoked_at timestamptz;
ALTER TABLE invitations ADD COLUMN accepted_event_id uuid;
ALTER TABLE invitations ADD COLUMN delivery_generation integer NOT NULL DEFAULT 1;
UPDATE invitations SET delivery_generation=version;
ALTER TABLE invitation_delivery ADD COLUMN generation integer;
ALTER TABLE invitation_delivery ADD COLUMN created_at timestamptz;
ALTER TABLE invitation_delivery ALTER COLUMN created_at SET DEFAULT clock_timestamp();
ALTER TABLE invitation_delivery ADD COLUMN last_attempt_at timestamptz;
ALTER TABLE invitation_delivery ADD COLUMN completed_at timestamptz;
ALTER TABLE invitation_delivery ADD COLUMN terminal_at timestamptz;
ALTER TABLE invitation_delivery ADD COLUMN failure_event_id uuid;
ALTER TABLE invitation_delivery ADD COLUMN failure_notified_at timestamptz;
-- A pending token proves its exact generation even for historical jobs. Delivered
-- historical jobs without tokens remain unassigned rather than guessed by UUID.
UPDATE invitation_delivery d SET generation=i.version FROM invitations i
 WHERE d.organization_id=i.organization_id AND d.invitation_id=i.id
 AND d.token IS NOT NULL AND encode(sha256(convert_to(d.token,'UTF8')),'hex')=i.token_hash;
CREATE INDEX invitation_delivery_generation ON invitation_delivery(organization_id,invitation_id,generation);
CREATE INDEX invitations_tracking_created ON invitations(organization_id,created_at DESC,id);

-- Keep terminal failures out of the global dispatcher claim; bounded recovery
-- still selects exhausted live jobs once to publish their terminal outcome.
DO $$
DECLARE definition text;
BEGIN
  definition := pg_get_functiondef('public.iam_mail_claim()'::regprocedure);
  IF position('FROM public.invitation_delivery d WHERE state IN' in definition)=0 THEN
    RAISE EXCEPTION 'INVITATION_CLAIM_SHAPE_UNEXPECTED' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,'FROM public.invitation_delivery d WHERE state IN','FROM public.invitation_delivery d WHERE d.terminal_at IS NULL AND state IN');
END $$;
