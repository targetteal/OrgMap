ALTER TABLE platform_comments ADD COLUMN content_rich jsonb;
ALTER TABLE platform_comments ADD CONSTRAINT platform_comment_rich_object CHECK(content_rich IS NULL OR jsonb_typeof(content_rich)='object');
