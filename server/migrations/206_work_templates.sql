CREATE TABLE work_templates (
 organization_id uuid NOT NULL REFERENCES organizations(id), id uuid NOT NULL,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object'),
 is_default boolean NOT NULL DEFAULT false, version int NOT NULL DEFAULT 1,
 PRIMARY KEY(organization_id,id)
);
CREATE UNIQUE INDEX work_one_default_template ON work_templates(organization_id) WHERE is_default;
ALTER TABLE work_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON work_templates USING(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON work_templates TO orgmap_app;
