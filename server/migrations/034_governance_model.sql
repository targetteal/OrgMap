-- Additive, tenant-scoped package instances. Existing memberships/flags stay untouched.
CREATE TABLE structure_governance_models (
 organization_id uuid PRIMARY KEY REFERENCES organizations(id),
 package_id text NOT NULL, package_version text NOT NULL, source_reference jsonb NOT NULL,
 phase text NOT NULL CHECK(phase IN ('PREPARATION','OPERATING')),
 overrides jsonb NOT NULL DEFAULT '{}', revision int NOT NULL DEFAULT 1,
 installed_at timestamptz NOT NULL DEFAULT clock_timestamp(), started_at timestamptz
);
CREATE TABLE structure_model_revisions (
 organization_id uuid NOT NULL REFERENCES organizations(id), revision int NOT NULL,
 snapshot jsonb NOT NULL, actor_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,revision)
);
CREATE TABLE structure_model_functions (
 organization_id uuid NOT NULL, role_id uuid NOT NULL, function_code text,
 version int NOT NULL DEFAULT 1,
 PRIMARY KEY(organization_id,role_id),
 FOREIGN KEY(organization_id,role_id) REFERENCES entities(organization_id,id),
 CHECK(function_code IS NULL OR function_code IN ('GUIDE','REPRESENTATIVE','FACILITATOR','SCRIBE'))
);
CREATE TABLE structure_model_circles (
 organization_id uuid NOT NULL, circle_id uuid NOT NULL, self_assignment boolean NOT NULL DEFAULT false,
 version int NOT NULL DEFAULT 0,
 PRIMARY KEY(organization_id,circle_id),
 FOREIGN KEY(organization_id,circle_id) REFERENCES entities(organization_id,id)
);
CREATE TABLE structure_model_occupancy_context (
 organization_id uuid NOT NULL REFERENCES organizations(id), occupancy_id uuid NOT NULL,
 source text NOT NULL CHECK(source IN ('OCCUPANCY','MANDATE')), model_revision int NOT NULL,
 origin text NOT NULL, exit_not_before timestamptz, exit_agreement text,
 PRIMARY KEY(organization_id,source,occupancy_id)
);
CREATE TABLE structure_model_events (
 organization_id uuid NOT NULL REFERENCES organizations(id), id uuid NOT NULL,
 resource_id uuid NOT NULL, action text NOT NULL, model_revision int NOT NULL,
 snapshot jsonb NOT NULL, actor_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['structure_governance_models','structure_model_revisions','structure_model_functions','structure_model_circles','structure_model_occupancy_context','structure_model_events'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant ON %I USING (organization_id=nullif(current_setting(''orgmap.organization_id'',true),'''')::uuid) WITH CHECK (organization_id=nullif(current_setting(''orgmap.organization_id'',true),'''')::uuid)',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO orgmap_app',t);
 END LOOP;
END $$;
