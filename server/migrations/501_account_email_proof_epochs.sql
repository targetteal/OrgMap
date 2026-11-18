-- A mailbox change must not revive old Account-bound proof after A -> B -> A.
-- Backfill 1 is the pre-LF11 Account epoch: no older email-change API existed.
ALTER TABLE password_recovery ADD COLUMN email_revision bigint NOT NULL DEFAULT 1 CHECK(email_revision>0);
ALTER TABLE admission_requests ADD COLUMN email_revision bigint NOT NULL DEFAULT 1 CHECK(email_revision>0);
ALTER TABLE provisioned_enrollment_reauth ADD COLUMN email_revision bigint NOT NULL DEFAULT 1 CHECK(email_revision>0);
-- An attestation also evaluates personal email input. Its age remains that of
-- the password; the separate email epoch invalidates the cached evaluation.
ALTER TABLE credential_attestations ADD COLUMN email_revision bigint NOT NULL DEFAULT 0 CHECK(email_revision>=0);
