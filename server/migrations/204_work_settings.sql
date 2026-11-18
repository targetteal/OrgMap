CREATE TABLE work_settings (
 organization_id uuid PRIMARY KEY REFERENCES organizations(id),
 show_all_unassigned boolean NOT NULL DEFAULT true,
 auto_create_for_new_circles boolean NOT NULL DEFAULT false,
 allow_multiple_projects_per_circle boolean NOT NULL DEFAULT true,
 default_privacy text NOT NULL DEFAULT 'PUBLIC' CHECK(default_privacy IN ('PUBLIC','PRIVATE')),
 lock_project_configuration boolean NOT NULL DEFAULT false,
 default_assignment_mode text NOT NULL DEFAULT 'MULTIPLE' CHECK(default_assignment_mode IN ('SINGLE','MULTIPLE')),
 default_assignment_permission text NOT NULL DEFAULT 'EDITORS' CHECK(default_assignment_permission IN ('EDITORS','MANAGERS')),
 version int NOT NULL DEFAULT 1
);
ALTER TABLE work_projects ADD COLUMN assignment_mode text NOT NULL DEFAULT 'MULTIPLE' CHECK(assignment_mode IN ('SINGLE','MULTIPLE'));
ALTER TABLE work_projects ADD COLUMN assignment_permission text NOT NULL DEFAULT 'EDITORS' CHECK(assignment_permission IN ('EDITORS','MANAGERS'));
ALTER TABLE work_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON work_settings USING(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON work_settings TO orgmap_app;
CREATE TABLE work_created_projects (
 organization_id uuid NOT NULL,account_id uuid NOT NULL REFERENCES accounts(id),command_key text NOT NULL,
 project_id uuid NOT NULL,PRIMARY KEY(organization_id,account_id,command_key),
 FOREIGN KEY(organization_id,project_id) REFERENCES work_projects(organization_id,id)
);
ALTER TABLE work_created_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_created_projects FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON work_created_projects USING(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON work_created_projects TO orgmap_app;
