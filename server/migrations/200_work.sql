CREATE TABLE work_projects (
 organization_id uuid NOT NULL REFERENCES organizations(id), id uuid NOT NULL,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200), description text NOT NULL DEFAULT '',
 visibility text NOT NULL CHECK(visibility IN ('PUBLIC','PRIVATE')), creator_id uuid NOT NULL,
 frozen boolean NOT NULL DEFAULT false, archived boolean NOT NULL DEFAULT false,
 views text[] NOT NULL DEFAULT ARRAY['LIST','BOARD','TIMELINE','CALENDAR'],
 default_done_section_id uuid, version int NOT NULL DEFAULT 1,
 PRIMARY KEY(organization_id,id), FOREIGN KEY(organization_id,creator_id) REFERENCES members(organization_id,id),
 CHECK(cardinality(views)>0 AND views <@ ARRAY['LIST','BOARD','TIMELINE','CALENDAR']::text[])
);
CREATE TABLE work_access (
 organization_id uuid NOT NULL, project_id uuid NOT NULL, member_id uuid NOT NULL,
 role text NOT NULL CHECK(role IN ('MANAGER','EDITOR','READER')),
 PRIMARY KEY(organization_id,project_id,member_id),
 FOREIGN KEY(organization_id,project_id) REFERENCES work_projects(organization_id,id),
 FOREIGN KEY(organization_id,member_id) REFERENCES members(organization_id,id)
);
CREATE TABLE work_sections (
 organization_id uuid NOT NULL,id uuid NOT NULL,project_id uuid NOT NULL,name text NOT NULL,
 semantic text NOT NULL CHECK(semantic IN ('NONE','DONE')),position int NOT NULL,
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,project_id,id),
 FOREIGN KEY(organization_id,project_id) REFERENCES work_projects(organization_id,id)
);
ALTER TABLE work_projects ADD FOREIGN KEY(organization_id,id,default_done_section_id) REFERENCES work_sections(organization_id,project_id,id);
CREATE TABLE work_tasks (
 organization_id uuid NOT NULL,id uuid NOT NULL,project_id uuid,section_id uuid,parent_id uuid,
 creator_id uuid NOT NULL,title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200),description text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'TODO' CHECK(status IN ('TODO','IN_PROGRESS','BLOCKED','DONE')),
 starts_at timestamptz, ends_at timestamptz, date_provenance text NOT NULL DEFAULT 'USER_ENTERED',
 position int NOT NULL DEFAULT 0,duplicate_of uuid,archived boolean NOT NULL DEFAULT false,version int NOT NULL DEFAULT 1,
 PRIMARY KEY(organization_id,id),
 FOREIGN KEY(organization_id,project_id) REFERENCES work_projects(organization_id,id),
 FOREIGN KEY(organization_id,project_id,section_id) REFERENCES work_sections(organization_id,project_id,id),
 FOREIGN KEY(organization_id,parent_id) REFERENCES work_tasks(organization_id,id),
 FOREIGN KEY(organization_id,duplicate_of) REFERENCES work_tasks(organization_id,id),
 FOREIGN KEY(organization_id,creator_id) REFERENCES members(organization_id,id),
 CHECK(section_id IS NULL OR project_id IS NOT NULL),CHECK(ends_at IS NULL OR starts_at IS NULL OR ends_at>=starts_at),
 CHECK(id IS DISTINCT FROM parent_id AND id IS DISTINCT FROM duplicate_of),
 CHECK(date_provenance IN ('USER_ENTERED','SYNTHETIC_TEST'))
);
CREATE TABLE work_assignments (
 organization_id uuid NOT NULL,task_id uuid NOT NULL,member_id uuid NOT NULL,
 PRIMARY KEY(organization_id,task_id,member_id),
 FOREIGN KEY(organization_id,task_id) REFERENCES work_tasks(organization_id,id),
 FOREIGN KEY(organization_id,member_id) REFERENCES members(organization_id,id)
);
CREATE TABLE work_dependencies (
 organization_id uuid NOT NULL,predecessor_id uuid NOT NULL,successor_id uuid NOT NULL,
 type text NOT NULL CHECK(type IN ('FS','FF','SS','SF')),lag_minutes int NOT NULL DEFAULT 0,
 PRIMARY KEY(organization_id,predecessor_id,successor_id),
 FOREIGN KEY(organization_id,predecessor_id) REFERENCES work_tasks(organization_id,id),
 FOREIGN KEY(organization_id,successor_id) REFERENCES work_tasks(organization_id,id),
 CHECK(predecessor_id<>successor_id),CHECK(abs(lag_minutes::bigint)<=5256000)
);
CREATE TABLE work_checklist (
 organization_id uuid NOT NULL,id uuid NOT NULL,task_id uuid NOT NULL,title text NOT NULL,done boolean NOT NULL DEFAULT false,
 PRIMARY KEY(organization_id,id),FOREIGN KEY(organization_id,task_id) REFERENCES work_tasks(organization_id,id)
);
CREATE TABLE work_comments (
 organization_id uuid NOT NULL,id uuid NOT NULL,task_id uuid NOT NULL,author_id uuid NOT NULL,content text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,id),FOREIGN KEY(organization_id,task_id) REFERENCES work_tasks(organization_id,id),FOREIGN KEY(organization_id,author_id) REFERENCES members(organization_id,id)
);
CREATE TABLE work_links (
 organization_id uuid NOT NULL,id uuid NOT NULL,task_id uuid NOT NULL,target_task_id uuid NOT NULL,
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,task_id,target_task_id),
 FOREIGN KEY(organization_id,task_id) REFERENCES work_tasks(organization_id,id),FOREIGN KEY(organization_id,target_task_id) REFERENCES work_tasks(organization_id,id),CHECK(task_id<>target_task_id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['work_projects','work_access','work_sections','work_tasks','work_assignments','work_dependencies','work_checklist','work_comments','work_links'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant ON %I USING (organization_id=nullif(current_setting(''orgmap.organization_id'',true),'''')::uuid) WITH CHECK (organization_id=nullif(current_setting(''orgmap.organization_id'',true),'''')::uuid)',t);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO orgmap_app',t);
 END LOOP;
END $$;
