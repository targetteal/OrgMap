ALTER TABLE accounts ADD COLUMN email_revision bigint NOT NULL DEFAULT 1 CHECK(email_revision>0);

CREATE TABLE account_email_change_requests (
 id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 old_email text NOT NULL,
 new_email text NOT NULL,
 email_revision bigint NOT NULL CHECK(email_revision>0),
 credential_revision bigint NOT NULL CHECK(credential_revision>0),
 primary_binding_hash text NOT NULL CHECK(length(primary_binding_hash)=64),
 token_hash text NOT NULL UNIQUE CHECK(length(token_hash)=64),
 state text NOT NULL DEFAULT 'PENDING_PROOF' CHECK(state IN ('PENDING_PROOF','COMPLETED','REVOKED','REPLACED','EXPIRED','LOCKED')),
 failed_attempts integer NOT NULL DEFAULT 0 CHECK(failed_attempts BETWEEN 0 AND 5),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 completed_at timestamptz,
 CHECK(new_email<>old_email),
 CHECK(expires_at>created_at),
 CHECK((state='COMPLETED')=(completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX account_email_change_one_active ON account_email_change_requests(account_id) WHERE state='PENDING_PROOF';
CREATE INDEX account_email_change_owner ON account_email_change_requests(account_id,created_at DESC,id);

-- Only this restricted, temporary delivery payload retains the plaintext proof.
-- HTTP, command results, events and request rows contain metadata/digests only.
CREATE TABLE account_email_change_mail (
 id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 request_id uuid NOT NULL UNIQUE REFERENCES account_email_change_requests(id) ON DELETE CASCADE,
 token text,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','PROCESSING','FAILED','DELIVERED','CANCELLED')),
 lease_token uuid,
 lease_until timestamptz,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 last_error text,
 CHECK((state='PROCESSING')=(lease_token IS NOT NULL AND lease_until IS NOT NULL)),
 CHECK(state NOT IN ('DELIVERED','CANCELLED') OR token IS NULL)
);
CREATE INDEX account_email_change_mail_due ON account_email_change_mail(next_attempt_at,id) WHERE state IN ('PENDING','PROCESSING','FAILED');

CREATE TABLE account_email_change_rate_budgets (
 account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 operation text NOT NULL CHECK(operation IN ('REQUEST','COMPLETE','REVOKE')),
 window_started_at timestamptz NOT NULL,
 attempts integer NOT NULL CHECK(attempts>0),
 PRIMARY KEY(account_id,operation)
);
REVOKE ALL ON account_email_change_requests,account_email_change_mail,account_email_change_rate_budgets FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON account_email_change_requests,account_email_change_mail,account_email_change_rate_budgets TO orgmap_app;
