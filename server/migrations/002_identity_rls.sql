ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_scope ON organizations USING(id = nullif(current_setting('orgmap.organization_id',true),'')::uuid OR id IN (SELECT organization_id FROM members WHERE account_id=nullif(current_setting('orgmap.account_id',true),'')::uuid AND status='ACTIVE')) WITH CHECK(id=nullif(current_setting('orgmap.organization_id',true),'')::uuid);
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
CREATE POLICY member_scope ON members USING(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid OR account_id=nullif(current_setting('orgmap.account_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid);
