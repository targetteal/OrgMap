CREATE TABLE interop_saml_cache (
 organization_id uuid NOT NULL REFERENCES organizations(id),connection_id uuid NOT NULL,key text NOT NULL,value text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,connection_id,key),FOREIGN KEY(organization_id,connection_id) REFERENCES interop_connections(organization_id,id)
);
CREATE TABLE interop_saml_replays (
 organization_id uuid NOT NULL REFERENCES organizations(id),connection_id uuid NOT NULL,assertion_hash text NOT NULL,expires_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,connection_id,assertion_hash),FOREIGN KEY(organization_id,connection_id) REFERENCES interop_connections(organization_id,id)
);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['interop_saml_cache','interop_saml_replays'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant ON %I USING (organization_id = nullif(current_setting(''orgmap.organization_id'',true),'''')::uuid) WITH CHECK (organization_id = nullif(current_setting(''orgmap.organization_id'',true),'''')::uuid)',t);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO orgmap_app',t);
END LOOP; END $$;
