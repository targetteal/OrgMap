ALTER TABLE members ADD COLUMN member_type text NOT NULL DEFAULT 'MEMBER' CHECK(member_type IN ('MEMBER','GUEST'));
ALTER TABLE members ADD CONSTRAINT guest_cannot_own CHECK(member_type<>'GUEST' OR org_role<>'OWNER');
ALTER TABLE invitations ADD COLUMN member_type text NOT NULL DEFAULT 'MEMBER' CHECK(member_type IN ('MEMBER','GUEST'));
ALTER TABLE invitations ADD COLUMN access_plan jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(access_plan)='array');
ALTER TABLE invitations ADD COLUMN invited_by_member_id uuid;
ALTER TABLE invitations ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE invitations ADD FOREIGN KEY(organization_id,invited_by_member_id) REFERENCES members(organization_id,id);
ALTER TABLE provisioned_enrollments ADD COLUMN requested_member_type text NOT NULL DEFAULT 'MEMBER' CHECK(requested_member_type IN ('MEMBER','GUEST'));
CREATE TABLE guest_resource_grants(
 organization_id uuid NOT NULL REFERENCES organizations(id),id uuid NOT NULL,
 member_id uuid NOT NULL,grantor_member_id uuid NOT NULL,
 context text NOT NULL,kind text NOT NULL,resource_id uuid NOT NULL,
 actions jsonb NOT NULL CHECK(jsonb_typeof(actions)='array'),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),revoked_at timestamptz,
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,member_id,context,kind,resource_id),
 FOREIGN KEY(organization_id,member_id) REFERENCES members(organization_id,id),
 FOREIGN KEY(organization_id,grantor_member_id) REFERENCES members(organization_id,id)
);
ALTER TABLE guest_resource_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON guest_resource_grants USING(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON guest_resource_grants TO orgmap_app;
