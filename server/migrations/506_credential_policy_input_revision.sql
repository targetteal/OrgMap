-- Personal data is evaluator input, not a password change or new password age.
ALTER TABLE accounts ADD COLUMN credential_policy_input_revision bigint NOT NULL DEFAULT 1 CHECK(credential_policy_input_revision>0);
CREATE FUNCTION orgmap_credential_policy_input_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.credential_policy_input_revision := OLD.credential_policy_input_revision;
 IF NEW.email IS DISTINCT FROM OLD.email OR NEW.display_name IS DISTINCT FROM OLD.display_name THEN
  NEW.credential_policy_input_revision := OLD.credential_policy_input_revision+1;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER account_credential_policy_input_revision BEFORE UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION orgmap_credential_policy_input_revision();
-- Existing evaluations have no proven context stamp and remain stale.
ALTER TABLE credential_attestations ADD COLUMN credential_policy_input_revision bigint NOT NULL DEFAULT 0 CHECK(credential_policy_input_revision>=0);
