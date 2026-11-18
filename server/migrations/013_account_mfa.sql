ALTER TABLE accounts ADD COLUMN mfa_revision bigint NOT NULL DEFAULT 1 CHECK(mfa_revision > 0);
ALTER TABLE sessions ADD COLUMN mfa_verified_at timestamptz;
ALTER TABLE sessions ADD COLUMN mfa_factor_revision bigint;
CREATE TABLE account_mfa_factors (
 account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
 encrypted_secret text NOT NULL,
 state text NOT NULL CHECK(state IN ('PENDING','ACTIVE')),
 pending_expires_at timestamptz,
 last_used_step bigint NOT NULL DEFAULT -1,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK ((state='PENDING' AND pending_expires_at IS NOT NULL) OR (state='ACTIVE' AND pending_expires_at IS NULL))
);
GRANT SELECT,INSERT,UPDATE,DELETE ON account_mfa_factors TO orgmap_app;
