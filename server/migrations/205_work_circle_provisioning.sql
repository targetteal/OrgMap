ALTER TABLE work_settings ADD COLUMN auto_create_enabled_at timestamptz;
CREATE TABLE work_circle_provisioning (
 organization_id uuid NOT NULL,circle_id uuid NOT NULL,project_id uuid,result text NOT NULL CHECK(result IN ('CREATED','CAPACITY')),
 source_occurred_at timestamptz NOT NULL,source_event_id uuid,
 PRIMARY KEY(organization_id,circle_id),
 FOREIGN KEY(organization_id,circle_id) REFERENCES entities(organization_id,id),
 FOREIGN KEY(organization_id,project_id) REFERENCES work_projects(organization_id,id),
 CHECK((result='CREATED' AND project_id IS NOT NULL) OR (result='CAPACITY' AND project_id IS NULL))
);
ALTER TABLE work_circle_provisioning ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_circle_provisioning FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON work_circle_provisioning USING(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON work_circle_provisioning TO orgmap_app;
