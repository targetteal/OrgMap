CREATE TABLE work_layouts (
 organization_id uuid NOT NULL,member_id uuid NOT NULL,scope text NOT NULL,project_id uuid,
 view text NOT NULL CHECK(view IN ('LIST','BOARD','TIMELINE','CALENDAR')),
 sort text NOT NULL CHECK(sort IN ('POSITION','TITLE','DUE')),
 grouping text NOT NULL CHECK(grouping IN ('SECTION','STATUS','PROJECT')),
 version int NOT NULL DEFAULT 1,
 PRIMARY KEY(organization_id,member_id,scope),
 FOREIGN KEY(organization_id,member_id) REFERENCES members(organization_id,id),
 FOREIGN KEY(organization_id,project_id) REFERENCES work_projects(organization_id,id),
 CHECK((project_id IS NULL AND scope='PERSONAL') OR (project_id IS NOT NULL AND scope='PROJECT:'||project_id::text))
);
ALTER TABLE work_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_layouts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON work_layouts USING(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON work_layouts TO orgmap_app;
