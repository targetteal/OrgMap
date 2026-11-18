ALTER TABLE goals ADD COLUMN circle_id uuid;
ALTER TABLE goals ADD FOREIGN KEY(organization_id,circle_id) REFERENCES entities(organization_id,id);
UPDATE goals SET circle_id=owner_id WHERE owner_type='CIRCLE';
UPDATE goals g SET circle_id=e.parent_id FROM entities e WHERE e.organization_id=g.organization_id AND e.id=CASE WHEN g.owner_type='ROLE' THEN g.owner_id ELSE g.owner_via_role_id END;
CREATE TABLE goal_origins(organization_id uuid NOT NULL,goal_id uuid NOT NULL,source_kind text NOT NULL CHECK(source_kind='TENSION'),source_id uuid NOT NULL,PRIMARY KEY(organization_id,source_kind,source_id),FOREIGN KEY(organization_id,goal_id) REFERENCES goals(organization_id,id));
ALTER TABLE goal_origins ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_origins FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON goal_origins USING(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON goal_origins TO orgmap_app;
