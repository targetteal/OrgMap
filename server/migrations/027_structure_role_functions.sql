-- Explicit canonical role function, independent from name and flags.
CREATE TABLE structure_role_functions(organization_id uuid NOT NULL,role_id uuid NOT NULL,function_code text CHECK(function_code IS NULL OR function_code='LEAD_LINK'),version int NOT NULL DEFAULT 1,PRIMARY KEY(organization_id,role_id),FOREIGN KEY(organization_id,role_id) REFERENCES entities(organization_id,id));
ALTER TABLE structure_role_functions ENABLE ROW LEVEL SECURITY;
ALTER TABLE structure_role_functions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON structure_role_functions USING (organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid) WITH CHECK (organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON structure_role_functions TO orgmap_app;
