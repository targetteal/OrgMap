CREATE TABLE interop_scim_users (
 organization_id uuid NOT NULL REFERENCES organizations(id),id uuid NOT NULL,external_id text NOT NULL,user_name text NOT NULL,
 member_id uuid NOT NULL,active boolean NOT NULL,version integer NOT NULL DEFAULT 1,
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,external_id),UNIQUE(organization_id,user_name),
 FOREIGN KEY(organization_id,member_id) REFERENCES members(organization_id,id)
);
ALTER TABLE interop_scim_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON interop_scim_users USING (organization_id = nullif(current_setting('orgmap.organization_id',true),'')::uuid) WITH CHECK (organization_id = nullif(current_setting('orgmap.organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON interop_scim_users TO orgmap_app;
