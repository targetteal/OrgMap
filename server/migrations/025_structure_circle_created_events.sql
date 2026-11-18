-- Canonical event is emitted only by actual new-circle writers, never inferred from history.
CREATE TABLE structure_circle_creations(organization_id uuid NOT NULL,circle_id uuid NOT NULL,event_id uuid NOT NULL,occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),request_id text,PRIMARY KEY(organization_id,circle_id),UNIQUE(organization_id,event_id),FOREIGN KEY(organization_id,circle_id) REFERENCES entities(organization_id,id));
ALTER TABLE structure_circle_creations ENABLE ROW LEVEL SECURITY;
ALTER TABLE structure_circle_creations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON structure_circle_creations USING (organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid) WITH CHECK (organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid);
GRANT SELECT,INSERT ON structure_circle_creations TO orgmap_app;
