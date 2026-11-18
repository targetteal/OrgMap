CREATE TABLE administration_credential_policies (
 organization_id uuid PRIMARY KEY REFERENCES organizations(id),
 id uuid NOT NULL UNIQUE,
 version integer NOT NULL DEFAULT 1 CHECK(version > 0),
 enabled boolean NOT NULL DEFAULT false,
 configuration jsonb NOT NULL
);
CREATE TABLE administration_credential_policy_revisions (
 organization_id uuid NOT NULL REFERENCES administration_credential_policies(organization_id),
 version integer NOT NULL,
 snapshot jsonb NOT NULL,
 actor_id uuid NOT NULL REFERENCES accounts(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,version)
);
ALTER TABLE administration_credential_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE administration_credential_policy_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON administration_credential_policies USING (organization_id::text=current_setting('orgmap.organization_id',true));
CREATE POLICY tenant ON administration_credential_policy_revisions USING (organization_id::text=current_setting('orgmap.organization_id',true));
GRANT SELECT,INSERT,UPDATE ON administration_credential_policies TO orgmap_app;
GRANT SELECT,INSERT ON administration_credential_policy_revisions TO orgmap_app;
