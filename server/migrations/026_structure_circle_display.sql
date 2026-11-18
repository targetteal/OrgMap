CREATE TABLE structure_circle_display(organization_id uuid NOT NULL,circle_id uuid NOT NULL,labels boolean NOT NULL DEFAULT true,avatars boolean NOT NULL DEFAULT true,minimap boolean NOT NULL DEFAULT true,version int NOT NULL DEFAULT 1,PRIMARY KEY(organization_id,circle_id),FOREIGN KEY(organization_id,circle_id) REFERENCES entities(organization_id,id));
ALTER TABLE structure_circle_display ENABLE ROW LEVEL SECURITY;
ALTER TABLE structure_circle_display FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON structure_circle_display USING (organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid) WITH CHECK (organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON structure_circle_display TO orgmap_app;
