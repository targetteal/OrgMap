-- Invitation-local presentation only. These values never update global Accounts.
ALTER TABLE invitations ADD COLUMN first_name text NOT NULL DEFAULT '' CHECK(char_length(first_name)<=200);
ALTER TABLE invitations ADD COLUMN last_name text NOT NULL DEFAULT '' CHECK(char_length(last_name)<=200);
ALTER TABLE invitations ADD COLUMN personal_message text NOT NULL DEFAULT '' CHECK(char_length(personal_message)<=2000);
-- Non-unique: legacy ambiguous pending invitations must be reconciled explicitly.
CREATE INDEX invitations_pending_email_idx ON invitations(organization_id,email) WHERE status='PENDING';
