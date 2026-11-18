ALTER TABLE gov_tensions ADD COLUMN description_rich jsonb;
ALTER TABLE gov_tensions ADD CONSTRAINT gov_tensions_description_rich_envelope
CHECK (description_rich IS NULL OR (jsonb_typeof(description_rich)='object' AND description_rich->>'format'='orgmap-richtext' AND description_rich->>'version'='1'));
