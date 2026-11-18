ALTER TABLE structure_templates ADD COLUMN purpose text NOT NULL DEFAULT '';
ALTER TABLE structure_templates ADD COLUMN purpose_rich jsonb;
ALTER TABLE structure_templates ADD CONSTRAINT structure_template_purpose_rich_envelope CHECK (
  purpose_rich IS NULL OR (
    jsonb_typeof(purpose_rich) = 'object' AND
    purpose_rich->>'format' = 'orgmap-richtext' AND
    purpose_rich->>'version' = '1' AND
    purpose_rich->'doc'->>'type' = 'doc'
  ) IS TRUE
);
