ALTER TABLE accounts ADD COLUMN credential_revision bigint NOT NULL DEFAULT 1 CHECK(credential_revision>0);
-- Existing rows have unknown age. New credentials have a real creation time.
ALTER TABLE accounts ADD COLUMN credential_changed_at timestamptz;
ALTER TABLE accounts ALTER COLUMN credential_changed_at SET DEFAULT clock_timestamp();
CREATE FUNCTION orgmap_credential_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.password_hash IS DISTINCT FROM OLD.password_hash OR NEW.password_enabled IS DISTINCT FROM OLD.password_enabled THEN
  NEW.credential_revision:=OLD.credential_revision+1;
  NEW.credential_changed_at:=clock_timestamp();
 ELSE
  NEW.credential_revision:=OLD.credential_revision;
  NEW.credential_changed_at:=OLD.credential_changed_at;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER account_credential_revision BEFORE UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION orgmap_credential_revision();
ALTER TABLE sessions ADD COLUMN auth_amr jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(auth_amr)='array');
ALTER TABLE sessions ADD COLUMN auth_time timestamptz;
CREATE TABLE credential_attestations(
 organization_id uuid NOT NULL REFERENCES organizations(id),
 account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 credential_revision bigint NOT NULL,
 policy_id text NOT NULL,policy_revision bigint NOT NULL,
 evaluator_version text NOT NULL,
 evaluated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 valid_until timestamptz,
 method text NOT NULL CHECK(method IN ('PASSWORD','FEDERATED')),
 provenance jsonb,
 mfa_verified_at timestamptz,mfa_factor_revision bigint,
 PRIMARY KEY(organization_id,account_id)
);
ALTER TABLE credential_attestations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON credential_attestations USING(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON credential_attestations TO orgmap_app;
