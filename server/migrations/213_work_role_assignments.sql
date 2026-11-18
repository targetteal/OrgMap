CREATE TABLE work_role_assignments (
 organization_id uuid NOT NULL,task_id uuid NOT NULL,role_id uuid NOT NULL,
 PRIMARY KEY(organization_id,task_id,role_id),
 FOREIGN KEY(organization_id,task_id) REFERENCES work_tasks(organization_id,id),
 FOREIGN KEY(organization_id,role_id) REFERENCES entities(organization_id,id)
);
ALTER TABLE work_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_role_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON work_role_assignments
 USING(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid)
 WITH CHECK(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON work_role_assignments TO orgmap_app;
