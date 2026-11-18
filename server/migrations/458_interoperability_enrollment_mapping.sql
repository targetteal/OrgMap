ALTER TABLE interop_credentials ADD COLUMN connection_id uuid;
ALTER TABLE interop_credentials ADD CONSTRAINT interop_credential_connection FOREIGN KEY(organization_id,connection_id) REFERENCES interop_connections(organization_id,id);
CREATE TABLE interop_scim_sources (
 organization_id uuid NOT NULL REFERENCES organizations(id),id uuid NOT NULL,connection_id uuid NOT NULL,
 external_id text NOT NULL,user_name text NOT NULL,display_name text NOT NULL DEFAULT '',email text,
 immutable_subject text,iam_enrollment_id text,administrative_active boolean NOT NULL DEFAULT true,
 deleted_at timestamptz,version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,connection_id,external_id),UNIQUE(organization_id,connection_id,user_name),
 FOREIGN KEY(organization_id,connection_id) REFERENCES interop_connections(organization_id,id)
);
ALTER TABLE interop_scim_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON interop_scim_sources USING (organization_id = nullif(current_setting('orgmap.organization_id',true),'')::uuid) WITH CHECK (organization_id = nullif(current_setting('orgmap.organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON interop_scim_sources TO orgmap_app;
