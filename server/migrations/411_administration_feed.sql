CREATE TABLE administration_feed_posts (
 organization_id uuid NOT NULL REFERENCES organizations(id), id uuid NOT NULL, group_id uuid NOT NULL, author_member_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('DRAFT','PUBLISHED','ARCHIVED')), version integer NOT NULL CHECK(version>0),
 draft_title text NOT NULL, draft_body jsonb NOT NULL, published_version integer,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,id), FOREIGN KEY(organization_id,group_id) REFERENCES administration_group_relations(organization_id,id),
 FOREIGN KEY(organization_id,author_member_id) REFERENCES members(organization_id,id)
);
CREATE TABLE administration_feed_versions (
 organization_id uuid NOT NULL, post_id uuid NOT NULL, number integer NOT NULL CHECK(number>0), title text NOT NULL, body jsonb NOT NULL,
 published_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(organization_id,post_id,number),
 FOREIGN KEY(organization_id,post_id) REFERENCES administration_feed_posts(organization_id,id)
);
CREATE TABLE administration_feed_selections (
 organization_id uuid NOT NULL REFERENCES organizations(id), id uuid NOT NULL, account_id uuid NOT NULL REFERENCES accounts(id), member_id uuid NOT NULL,
 as_of timestamptz NOT NULL, snapshot jsonb NOT NULL, PRIMARY KEY(organization_id,id),
 FOREIGN KEY(organization_id,member_id) REFERENCES members(organization_id,id)
);
ALTER TABLE administration_feed_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE administration_feed_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE administration_feed_selections ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON administration_feed_posts USING (organization_id::text=current_setting('orgmap.organization_id',true)) WITH CHECK (organization_id::text=current_setting('orgmap.organization_id',true));
CREATE POLICY tenant ON administration_feed_versions USING (organization_id::text=current_setting('orgmap.organization_id',true)) WITH CHECK (organization_id::text=current_setting('orgmap.organization_id',true));
CREATE POLICY tenant ON administration_feed_selections USING (organization_id::text=current_setting('orgmap.organization_id',true)) WITH CHECK (organization_id::text=current_setting('orgmap.organization_id',true));
GRANT SELECT,INSERT,UPDATE ON administration_feed_posts TO orgmap_app;
GRANT SELECT,INSERT ON administration_feed_versions,administration_feed_selections TO orgmap_app;
