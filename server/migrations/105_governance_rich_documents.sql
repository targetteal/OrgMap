ALTER TABLE gov_document_versions ADD COLUMN rich_content jsonb;
ALTER TABLE gov_document_versions ADD CONSTRAINT gov_document_versions_rich_envelope
CHECK (rich_content IS NULL OR (jsonb_typeof(rich_content)='object' AND rich_content->>'format'='orgmap-richtext' AND rich_content->>'version'='1'));
