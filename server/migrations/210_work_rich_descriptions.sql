ALTER TABLE work_projects ADD COLUMN description_rich jsonb;
ALTER TABLE work_tasks ADD COLUMN description_rich jsonb;
ALTER TABLE work_projects ADD CONSTRAINT work_project_rich_envelope CHECK(description_rich IS NULL OR (description_rich->>'format'='orgmap-richtext' AND description_rich->>'version'='1'));
ALTER TABLE work_tasks ADD CONSTRAINT work_task_rich_envelope CHECK(description_rich IS NULL OR (description_rich->>'format'='orgmap-richtext' AND description_rich->>'version'='1'));
