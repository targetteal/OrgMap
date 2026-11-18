CREATE TABLE administration_admission_policies (
 organization_id uuid PRIMARY KEY REFERENCES organizations(id),
 id uuid NOT NULL UNIQUE,
 version integer NOT NULL CHECK(version > 0),
 configuration jsonb NOT NULL
);
CREATE TABLE administration_admission_policy_revisions (
 organization_id uuid NOT NULL REFERENCES administration_admission_policies(organization_id),
 version integer NOT NULL,
 snapshot jsonb NOT NULL,
 actor_id uuid NOT NULL REFERENCES accounts(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,version)
);
ALTER TABLE administration_admission_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE administration_admission_policy_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON administration_admission_policies USING (organization_id::text=current_setting('orgmap.organization_id',true));
CREATE POLICY tenant ON administration_admission_policy_revisions USING (organization_id::text=current_setting('orgmap.organization_id',true));
GRANT SELECT,INSERT,UPDATE ON administration_admission_policies TO orgmap_app;
GRANT SELECT,INSERT ON administration_admission_policy_revisions TO orgmap_app;
