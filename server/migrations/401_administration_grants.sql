CREATE TABLE administration_grants (
 organization_id uuid NOT NULL, id uuid NOT NULL, member_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('settings.manage','policy.manage','field.manage','template.manage','group.manage','profile.manage','page.manage')),
 resource_id uuid, version integer NOT NULL DEFAULT 1, active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(organization_id,id), FOREIGN KEY(organization_id,member_id) REFERENCES members(organization_id,id),
 FOREIGN KEY(organization_id,resource_id) REFERENCES administration_records(organization_id,id)
);
ALTER TABLE administration_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON administration_grants USING (organization_id::text=current_setting('orgmap.organization_id',true));
GRANT SELECT,INSERT,UPDATE ON administration_grants TO orgmap_app;
