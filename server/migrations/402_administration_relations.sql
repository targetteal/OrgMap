CREATE TABLE administration_profile_relations (
 organization_id uuid NOT NULL, id uuid NOT NULL, member_id uuid NOT NULL, manager_id uuid,
 PRIMARY KEY(organization_id,id), UNIQUE(organization_id,member_id),
 FOREIGN KEY(organization_id,id) REFERENCES administration_records(organization_id,id),
 FOREIGN KEY(organization_id,member_id) REFERENCES members(organization_id,id),
 FOREIGN KEY(organization_id,manager_id) REFERENCES members(organization_id,id), CHECK(member_id IS DISTINCT FROM manager_id)
);
CREATE TABLE administration_group_relations (
 organization_id uuid NOT NULL, id uuid NOT NULL, parent_id uuid,
 PRIMARY KEY(organization_id,id), FOREIGN KEY(organization_id,id) REFERENCES administration_records(organization_id,id),
 FOREIGN KEY(organization_id,parent_id) REFERENCES administration_group_relations(organization_id,id), CHECK(id IS DISTINCT FROM parent_id)
);
CREATE TABLE administration_group_members (
 organization_id uuid NOT NULL, group_id uuid NOT NULL, member_id uuid NOT NULL,
 PRIMARY KEY(organization_id,group_id,member_id),
 FOREIGN KEY(organization_id,group_id) REFERENCES administration_group_relations(organization_id,id),
 FOREIGN KEY(organization_id,member_id) REFERENCES members(organization_id,id)
);
CREATE TABLE administration_settings_revisions (
 organization_id uuid NOT NULL REFERENCES administration_settings(organization_id), version integer NOT NULL,
 settings jsonb NOT NULL, actor_id uuid NOT NULL REFERENCES accounts(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,version)
);
ALTER TABLE administration_profile_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE administration_group_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE administration_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE administration_settings_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON administration_profile_relations USING (organization_id::text=current_setting('orgmap.organization_id',true));
CREATE POLICY tenant ON administration_group_relations USING (organization_id::text=current_setting('orgmap.organization_id',true));
CREATE POLICY tenant ON administration_group_members USING (organization_id::text=current_setting('orgmap.organization_id',true));
CREATE POLICY tenant ON administration_settings_revisions USING (organization_id::text=current_setting('orgmap.organization_id',true));
GRANT SELECT,INSERT,UPDATE ON administration_profile_relations,administration_group_relations,administration_settings_revisions TO orgmap_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON administration_group_members TO orgmap_app;
