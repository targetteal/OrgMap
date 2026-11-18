-- Context links are descriptive and never grant access; project ownership and
-- canonical teardown apply to the complete record, including its context.
ALTER TABLE work_projects ADD COLUMN starts_at timestamptz;
ALTER TABLE work_projects ADD COLUMN ends_at timestamptz;
ALTER TABLE work_projects ADD COLUMN tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE work_projects ADD COLUMN context_links jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(context_links) = 'array');
ALTER TABLE work_projects ADD CONSTRAINT work_project_dates_order CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at);
-- Configured task states have independent identities and map to a stable semantic
-- for older API consumers, statistics and completion rules.
ALTER TABLE work_projects ADD COLUMN task_states jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(task_states) = 'array');
ALTER TABLE work_tasks ADD COLUMN custom_status_id uuid;
ALTER TABLE work_settings ADD COLUMN project_states jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(project_states) = 'array');
ALTER TABLE work_projects ADD COLUMN project_state_id uuid;
ALTER TABLE work_layouts ADD COLUMN project_views jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(project_views) = 'array');
ALTER TABLE work_layouts ADD COLUMN project_views_version integer NOT NULL DEFAULT 0 CHECK (project_views_version >= 0);
ALTER TABLE work_projects ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(custom_fields) = 'object');
ALTER TABLE work_tasks ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(custom_fields) = 'object');
