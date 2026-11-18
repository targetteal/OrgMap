CREATE TABLE work_subtask_groups (
 organization_id uuid NOT NULL,id uuid NOT NULL,parent_task_id uuid NOT NULL,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),position int NOT NULL DEFAULT 0,
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,parent_task_id,id),
 FOREIGN KEY(organization_id,parent_task_id) REFERENCES work_tasks(organization_id,id)
);
ALTER TABLE work_tasks ADD COLUMN subtask_group_id uuid;
ALTER TABLE work_tasks ADD FOREIGN KEY(organization_id,parent_id,subtask_group_id) REFERENCES work_subtask_groups(organization_id,parent_task_id,id);
ALTER TABLE work_tasks ADD CHECK(subtask_group_id IS NULL OR parent_id IS NOT NULL);
ALTER TABLE work_subtask_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_subtask_groups FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON work_subtask_groups USING(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON work_subtask_groups TO orgmap_app;
