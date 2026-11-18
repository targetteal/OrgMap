CREATE TABLE administration_settings (
 organization_id uuid PRIMARY KEY REFERENCES organizations(id), id uuid NOT NULL, version integer NOT NULL DEFAULT 1,
 settings jsonb NOT NULL DEFAULT '{}', UNIQUE(organization_id,id)
);
CREATE TABLE administration_records (
 organization_id uuid NOT NULL REFERENCES organizations(id), id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('policy','field','template','group','profile','page')),
 version integer NOT NULL DEFAULT 1, value jsonb NOT NULL, PRIMARY KEY(organization_id,id)
);
CREATE TABLE administration_revisions (
 organization_id uuid NOT NULL, id uuid NOT NULL, version integer NOT NULL, value jsonb NOT NULL, actor_id uuid NOT NULL REFERENCES accounts(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,id,version), FOREIGN KEY(organization_id,id) REFERENCES administration_records(organization_id,id)
);
CREATE TABLE administration_publications (
 organization_id uuid NOT NULL, id uuid NOT NULL, token uuid NOT NULL UNIQUE, revision integer NOT NULL, snapshot jsonb NOT NULL, active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(organization_id,id), FOREIGN KEY(organization_id,id) REFERENCES administration_records(organization_id,id)
);
ALTER TABLE administration_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE administration_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE administration_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE administration_publications ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON administration_settings USING (organization_id::text=current_setting('orgmap.organization_id',true));
CREATE POLICY tenant ON administration_records USING (organization_id::text=current_setting('orgmap.organization_id',true));
CREATE POLICY tenant ON administration_revisions USING (organization_id::text=current_setting('orgmap.organization_id',true));
CREATE POLICY tenant ON administration_publications USING (organization_id::text=current_setting('orgmap.organization_id',true));
GRANT SELECT,INSERT,UPDATE ON administration_settings,administration_records,administration_revisions,administration_publications TO orgmap_app;
-- Anonymous reader can see approved snapshots only, with no organization lookup or draft access.
CREATE FUNCTION administration_read_public(requested uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT snapshot FROM administration_publications WHERE token=requested AND active $$;
REVOKE ALL ON FUNCTION administration_read_public(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION administration_read_public(uuid) TO orgmap_app;
