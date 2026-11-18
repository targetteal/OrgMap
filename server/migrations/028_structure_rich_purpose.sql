-- No backfill: a legacy plain string is never inferred to contain rich JSON/HTML.
ALTER TABLE entities ADD COLUMN purpose_rich jsonb;
ALTER TABLE entities ADD CONSTRAINT entity_purpose_rich_envelope CHECK (
  purpose_rich IS NULL OR (
    jsonb_typeof(purpose_rich) = 'object' AND
    purpose_rich->>'format' = 'orgmap-richtext' AND
    purpose_rich->>'version' = '1' AND
    purpose_rich->'doc'->>'type' = 'doc'
  ) IS TRUE
);
