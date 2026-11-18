-- Native components of both ROLE and CIRCLE. No custom-field values are reinterpreted.
-- Items keep their identity in entity revisions, snapshots and governance changes.
ALTER TABLE entities
  ADD COLUMN responsibilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN artifacts jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT entity_responsibilities_array CHECK (jsonb_typeof(responsibilities)='array'),
  ADD CONSTRAINT entity_artifacts_array CHECK (jsonb_typeof(artifacts)='array');
