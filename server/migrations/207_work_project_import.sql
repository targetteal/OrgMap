CREATE TABLE work_project_import_items (
 organization_id uuid NOT NULL, account_id uuid NOT NULL REFERENCES accounts(id), command_key text NOT NULL,
 project_id uuid NOT NULL, PRIMARY KEY(organization_id,account_id,command_key,project_id),
 FOREIGN KEY(organization_id,project_id) REFERENCES work_projects(organization_id,id)
);
ALTER TABLE work_project_import_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_project_import_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON work_project_import_items USING(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON work_project_import_items TO orgmap_app;
