ALTER TABLE work_projects ADD COLUMN circle_id uuid;
ALTER TABLE work_projects ADD FOREIGN KEY(organization_id,circle_id) REFERENCES entities(organization_id,id);
ALTER TABLE work_tasks ADD COLUMN circle_id uuid;
ALTER TABLE work_tasks ADD COLUMN source_tension_id uuid;
ALTER TABLE work_tasks ADD FOREIGN KEY(organization_id,circle_id) REFERENCES entities(organization_id,id);
