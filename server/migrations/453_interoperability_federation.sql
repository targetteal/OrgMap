CREATE TABLE interop_auth_flows (
 organization_id uuid NOT NULL REFERENCES organizations(id),id uuid NOT NULL,connection_id uuid NOT NULL,
 state_hash text NOT NULL,nonce text NOT NULL,verifier text NOT NULL,link_account_id uuid REFERENCES accounts(id),
 expires_at timestamptz NOT NULL,consumed_at timestamptz,
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,state_hash),
 FOREIGN KEY(organization_id,connection_id) REFERENCES interop_connections(organization_id,id)
);
CREATE TABLE interop_federated_identities (
 organization_id uuid NOT NULL REFERENCES organizations(id),id uuid NOT NULL,connection_id uuid NOT NULL,
 issuer text NOT NULL,subject text NOT NULL,account_id uuid NOT NULL REFERENCES accounts(id),
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,connection_id,issuer,subject),UNIQUE(organization_id,connection_id,account_id),
 FOREIGN KEY(organization_id,connection_id) REFERENCES interop_connections(organization_id,id)
);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['interop_auth_flows','interop_federated_identities'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant ON %I USING (organization_id = nullif(current_setting(''orgmap.organization_id'',true),'''')::uuid) WITH CHECK (organization_id = nullif(current_setting(''orgmap.organization_id'',true),'''')::uuid)',t);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO orgmap_app',t);
END LOOP; END $$;
