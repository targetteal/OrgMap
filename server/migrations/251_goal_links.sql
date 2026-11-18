ALTER TABLE goal_key_results ADD UNIQUE(organization_id,goal_id,id);
ALTER TABLE goal_assignments ADD FOREIGN KEY(organization_id,goal_id,key_result_id) REFERENCES goal_key_results(organization_id,goal_id,id);
CREATE TABLE goal_resource_links(organization_id uuid NOT NULL,goal_id uuid NOT NULL,key_result_id uuid NOT NULL,resource_kind text NOT NULL CHECK(resource_kind IN ('TASK','PROJECT')),resource_id uuid NOT NULL,PRIMARY KEY(organization_id,key_result_id,resource_kind,resource_id),FOREIGN KEY(organization_id,goal_id,key_result_id) REFERENCES goal_key_results(organization_id,goal_id,id));
ALTER TABLE goal_resource_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_resource_links FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON goal_resource_links USING(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON goal_resource_links TO orgmap_app;
