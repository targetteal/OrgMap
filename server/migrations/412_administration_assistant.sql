-- Personal settings are scoped to an active organization membership, not a global Account preference.
CREATE TABLE administration_assistant_personal (
 organization_id uuid NOT NULL, member_id uuid NOT NULL, account_id uuid NOT NULL REFERENCES accounts(id),
 revision integer NOT NULL CHECK(revision>0), instructions text NOT NULL CHECK(length(instructions)<=10000), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,member_id), FOREIGN KEY(organization_id,member_id) REFERENCES members(organization_id,id)
);
CREATE TABLE administration_assistant_workspace (
 organization_id uuid PRIMARY KEY REFERENCES organizations(id), revision integer NOT NULL CHECK(revision>0), instructions text NOT NULL CHECK(length(instructions)<=10000), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE administration_assistant_commands (
 organization_id uuid NOT NULL, member_id uuid NOT NULL, scope text NOT NULL CHECK(scope IN ('personal','workspace')), key text NOT NULL, hash text NOT NULL,
 PRIMARY KEY(organization_id,member_id,scope,key), FOREIGN KEY(organization_id,member_id) REFERENCES members(organization_id,id)
);
ALTER TABLE administration_assistant_personal ENABLE ROW LEVEL SECURITY;
ALTER TABLE administration_assistant_workspace ENABLE ROW LEVEL SECURITY;
ALTER TABLE administration_assistant_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner ON administration_assistant_personal USING (organization_id::text=current_setting('orgmap.organization_id',true) AND member_id::text=current_setting('orgmap.assistant_member_id',true) AND account_id::text=current_setting('orgmap.assistant_account_id',true));
CREATE POLICY tenant ON administration_assistant_workspace USING (organization_id::text=current_setting('orgmap.organization_id',true));
CREATE POLICY owner ON administration_assistant_commands USING (organization_id::text=current_setting('orgmap.organization_id',true) AND member_id::text=current_setting('orgmap.assistant_member_id',true));
GRANT SELECT,INSERT,UPDATE ON administration_assistant_personal,administration_assistant_workspace TO orgmap_app;
GRANT SELECT,INSERT ON administration_assistant_commands TO orgmap_app;
