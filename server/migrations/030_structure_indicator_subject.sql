-- Preserve every legacy indicator/record ID and version. MEMBER is an org membership,
-- never an entity, Account or Admin profile record.
ALTER TABLE structure_indicators ADD COLUMN subject_kind text;
ALTER TABLE structure_indicators ADD COLUMN member_id uuid;
UPDATE structure_indicators i SET subject_kind=e.kind
FROM entities e WHERE e.organization_id=i.organization_id AND e.id=i.entity_id;
ALTER TABLE structure_indicators ALTER COLUMN subject_kind SET NOT NULL;
ALTER TABLE structure_indicators ALTER COLUMN entity_id DROP NOT NULL;
ALTER TABLE structure_indicators ADD CONSTRAINT structure_indicator_member_fk
  FOREIGN KEY(organization_id,member_id) REFERENCES members(organization_id,id);
ALTER TABLE structure_indicators ADD CONSTRAINT structure_indicator_subject_xor CHECK (
  (subject_kind IN ('CIRCLE','ROLE') AND entity_id IS NOT NULL AND member_id IS NULL)
  OR (subject_kind='MEMBER' AND member_id IS NOT NULL AND entity_id IS NULL)
);
CREATE FUNCTION structure_indicator_subject_kind_guard() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.subject_kind IN ('CIRCLE','ROLE') AND NOT EXISTS (
    SELECT 1 FROM entities e WHERE e.organization_id=NEW.organization_id
      AND e.id=NEW.entity_id AND e.kind=NEW.subject_kind
  ) THEN RAISE EXCEPTION 'indicator entity kind mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER structure_indicator_subject_kind_guard
BEFORE INSERT OR UPDATE OF subject_kind,entity_id,member_id ON structure_indicators
FOR EACH ROW EXECUTE FUNCTION structure_indicator_subject_kind_guard();
CREATE INDEX structure_indicator_member_subject ON structure_indicators(organization_id,member_id,id)
WHERE subject_kind='MEMBER';
