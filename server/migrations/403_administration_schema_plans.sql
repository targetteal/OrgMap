CREATE TABLE administration_schema_plans (
 organization_id uuid NOT NULL, id uuid NOT NULL, field_id uuid NOT NULL, field_version integer NOT NULL,
 proposed jsonb NOT NULL, profile_versions jsonb NOT NULL, can_apply boolean NOT NULL, applied boolean NOT NULL DEFAULT false,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '1 hour',
 PRIMARY KEY(organization_id,id), FOREIGN KEY(organization_id,field_id) REFERENCES administration_records(organization_id,id)
);
ALTER TABLE administration_schema_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON administration_schema_plans USING (organization_id::text=current_setting('orgmap.organization_id',true));
GRANT SELECT,INSERT,UPDATE ON administration_schema_plans TO orgmap_app;
