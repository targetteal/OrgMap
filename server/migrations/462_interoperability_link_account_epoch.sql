ALTER TABLE interop_auth_flows ADD COLUMN initiating_session_id uuid;
ALTER TABLE interop_auth_flows ADD COLUMN account_email_revision bigint;
ALTER TABLE interop_auth_flows ADD CONSTRAINT interop_link_stamp_paired CHECK ((initiating_session_id IS NULL) = (account_email_revision IS NULL));
ALTER TABLE interop_auth_flows ADD CONSTRAINT interop_link_epoch_positive CHECK (account_email_revision IS NULL OR account_email_revision>=1);
-- Legacy unstamped LINK rows deliberately remain unstamped and fail closed at consumption.
