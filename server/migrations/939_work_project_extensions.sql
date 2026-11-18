-- Project-owned content and preferences. No grants or fixture data are created.
ALTER TABLE work_projects
 ADD COLUMN project_checklists jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(project_checklists)='array'),
 ADD COLUMN external_links jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(external_links)='array'),
 ADD COLUMN planning_intent jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(planning_intent)='object'),
 ADD COLUMN priority text NOT NULL DEFAULT 'NONE' CHECK(priority IN ('NONE','LOW','MEDIUM','HIGH','URGENT')),
 ADD COLUMN section_name text NOT NULL DEFAULT '' CHECK(length(section_name)<=200),
 ADD COLUMN lead_member_id uuid,
 ADD CONSTRAINT work_project_lead_member_fk FOREIGN KEY(organization_id,lead_member_id) REFERENCES members(organization_id,id);
ALTER TABLE work_tasks
 ADD COLUMN external_links jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(external_links)='array'),
 ADD COLUMN task_checklists jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(task_checklists)='array'),
 ADD COLUMN planning_intent jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(planning_intent)='object');
ALTER TABLE work_settings
 ADD COLUMN custom_field_definitions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(custom_field_definitions)='array');
ALTER TABLE work_layouts
 ADD COLUMN task_views jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(task_views)='array'),
 ADD COLUMN task_views_version integer NOT NULL DEFAULT 0 CHECK (task_views_version >= 0);
ALTER TABLE work_layouts DROP CONSTRAINT work_layouts_view_check;
ALTER TABLE work_layouts ADD CONSTRAINT work_layouts_view_check CHECK(view IN ('LIST','BOARD','GALLERY','TIMELINE','CALENDAR'));
