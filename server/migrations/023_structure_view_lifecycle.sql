-- Additive lifecycle; preserve applied 020-022 and immutable audit history.
ALTER TABLE structure_views ADD COLUMN deleted_at timestamptz;
CREATE INDEX structure_views_owner_live ON structure_views(organization_id,member_id,id) WHERE deleted_at IS NULL;
