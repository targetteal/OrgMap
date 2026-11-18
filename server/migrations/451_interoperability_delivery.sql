CREATE TABLE interop_webhook_inbox (
 organization_id uuid NOT NULL REFERENCES organizations(id),id uuid NOT NULL,connection_id uuid NOT NULL,
 event_id text NOT NULL,payload_hash text NOT NULL,received_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,connection_id,event_id),
 FOREIGN KEY(organization_id,connection_id) REFERENCES interop_connections(organization_id,id)
);
CREATE TABLE interop_deliveries (
 organization_id uuid NOT NULL REFERENCES organizations(id),id uuid NOT NULL,connection_id uuid NOT NULL,
 event_id text NOT NULL,payload jsonb NOT NULL,state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','DELIVERED','FAILED','REVOKED')),
 attempts integer NOT NULL DEFAULT 0,version integer NOT NULL DEFAULT 1,last_error text,
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,connection_id,event_id),
 FOREIGN KEY(organization_id,connection_id) REFERENCES interop_connections(organization_id,id)
);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['interop_webhook_inbox','interop_deliveries'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant ON %I USING (organization_id = nullif(current_setting(''orgmap.organization_id'',true),'''')::uuid) WITH CHECK (organization_id = nullif(current_setting(''orgmap.organization_id'',true),'''')::uuid)',t);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO orgmap_app',t);
END LOOP; END $$;
