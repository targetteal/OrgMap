CREATE TABLE administration_branding_assets (
 organization_id uuid NOT NULL REFERENCES organizations(id), purpose text NOT NULL CHECK(purpose IN ('WORKSPACE_LOGO','EMAIL_LOGO','LOGIN_BACKGROUND')),
 revision integer NOT NULL CHECK(revision>0), origin text NOT NULL CHECK(origin IN ('UPLOADED','NONE')),
 asset_id uuid, blob_key uuid, sha256 text, size integer, mime text, width integer, height integer, public_ref uuid UNIQUE,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,purpose),
 CHECK((origin='NONE' AND asset_id IS NULL AND blob_key IS NULL AND sha256 IS NULL AND size IS NULL AND mime IS NULL AND width IS NULL AND height IS NULL AND public_ref IS NULL)
 OR (origin='UPLOADED' AND asset_id IS NOT NULL AND blob_key IS NOT NULL AND sha256 ~ '^[0-9a-f]{64}$' AND size>0 AND size<=5242880 AND mime='image/png' AND width>0 AND height>0 AND ((purpose='LOGIN_BACKGROUND' AND public_ref IS NOT NULL) OR (purpose<>'LOGIN_BACKGROUND' AND public_ref IS NULL))))
);
CREATE TABLE administration_branding_gc (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, purpose text NOT NULL, blob_key uuid NOT NULL, sha256 text NOT NULL, size integer NOT NULL,
 reason text NOT NULL CHECK(reason IN ('UNPUBLISHED','REPLACED','DELETED')), available_at timestamptz NOT NULL DEFAULT clock_timestamp(), attempts integer NOT NULL DEFAULT 0
);
CREATE TABLE administration_branding_commands (
 organization_id uuid NOT NULL, actor_id uuid NOT NULL, purpose text NOT NULL, operation text NOT NULL, key text NOT NULL, hash text NOT NULL,
 PRIMARY KEY(organization_id,actor_id,purpose,operation,key)
);
CREATE TABLE administration_branding_history (
 organization_id uuid NOT NULL, purpose text NOT NULL, revision integer NOT NULL, origin text NOT NULL, actor_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,purpose,revision)
);
ALTER TABLE administration_branding_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE administration_branding_gc ENABLE ROW LEVEL SECURITY;
ALTER TABLE administration_branding_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE administration_branding_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON administration_branding_assets USING (organization_id::text=current_setting('orgmap.organization_id',true));
CREATE POLICY tenant ON administration_branding_gc USING (organization_id::text=current_setting('orgmap.organization_id',true));
CREATE POLICY tenant ON administration_branding_commands USING (organization_id::text=current_setting('orgmap.organization_id',true));
CREATE POLICY tenant ON administration_branding_history USING (organization_id::text=current_setting('orgmap.organization_id',true));
GRANT SELECT,INSERT,UPDATE,DELETE ON administration_branding_assets,administration_branding_gc TO orgmap_app;
GRANT SELECT,INSERT ON administration_branding_commands,administration_branding_history TO orgmap_app;
-- Reveals only the owner of an unguessable current public reference; lifecycle is checked separately under lock.
CREATE FUNCTION administration_branding_public_owner(requested uuid) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT organization_id FROM administration_branding_assets WHERE purpose='LOGIN_BACKGROUND' AND origin='UPLOADED' AND public_ref=requested
$$;
REVOKE ALL ON FUNCTION administration_branding_public_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION administration_branding_public_owner(uuid) TO orgmap_app;
