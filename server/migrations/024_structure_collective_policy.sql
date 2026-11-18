CREATE TABLE structure_collective_policies(organization_id uuid NOT NULL,circle_id uuid NOT NULL,enabled boolean,version int NOT NULL DEFAULT 1,PRIMARY KEY(organization_id,circle_id),FOREIGN KEY(organization_id,circle_id) REFERENCES entities(organization_id,id));
ALTER TABLE structure_collective_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE structure_collective_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON structure_collective_policies USING (organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid) WITH CHECK (organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON structure_collective_policies TO orgmap_app;
