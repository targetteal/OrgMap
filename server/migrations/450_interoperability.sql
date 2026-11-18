CREATE TABLE interop_credentials (
 organization_id uuid NOT NULL REFERENCES organizations(id), id uuid NOT NULL,
 member_id uuid NOT NULL, label text NOT NULL, kind text NOT NULL CHECK(kind IN ('API','SCIM','CALENDAR')),
 token_hash text NOT NULL UNIQUE, scopes text[] NOT NULL, expires_at timestamptz NOT NULL,
 revoked_at timestamptz, version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,id), FOREIGN KEY(organization_id,member_id) REFERENCES members(organization_id,id)
);
CREATE TABLE interop_connections (
 organization_id uuid NOT NULL REFERENCES organizations(id), id uuid NOT NULL,
 provider text NOT NULL CHECK(provider IN ('GOOGLE','OUTLOOK','SLACK','OIDC','SAML','LOCAL')),
 label text NOT NULL, state text NOT NULL DEFAULT 'EXTERNAL_CONFIGURATION_REQUIRED'
 CHECK(state IN ('EXTERNAL_CONFIGURATION_REQUIRED','CONFIGURED','REVOKED')),
 version integer NOT NULL DEFAULT 1, PRIMARY KEY(organization_id,id)
);
CREATE TABLE interop_calendar_events (
 organization_id uuid NOT NULL REFERENCES organizations(id), id uuid NOT NULL,
 uid text NOT NULL, sequence integer NOT NULL CHECK(sequence>=0), summary text NOT NULL,
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, source text NOT NULL,
 cancelled boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1,
 PRIMARY KEY(organization_id,id), UNIQUE(organization_id,uid), CHECK(ends_at>starts_at)
);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['interop_credentials','interop_connections','interop_calendar_events'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant ON %I USING (organization_id = nullif(current_setting(''orgmap.organization_id'',true),'''')::uuid) WITH CHECK (organization_id = nullif(current_setting(''orgmap.organization_id'',true),'''')::uuid)',t);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO orgmap_app',t);
END LOOP; END $$;
