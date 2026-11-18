CREATE TABLE work_export_selections (
 organization_id uuid NOT NULL REFERENCES organizations(id),id uuid NOT NULL,
 owner_id uuid NOT NULL,account_id uuid NOT NULL REFERENCES accounts(id),command_key text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('TASKS','STATISTICS')),include_private boolean NOT NULL,
 project_ids uuid[] NOT NULL,months text[] NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,account_id,command_key),
 FOREIGN KEY(organization_id,owner_id) REFERENCES members(organization_id,id)
);
ALTER TABLE work_export_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_export_selections FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON work_export_selections USING(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid);
GRANT SELECT,INSERT ON work_export_selections TO orgmap_app;
