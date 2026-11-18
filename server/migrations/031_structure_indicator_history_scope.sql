-- An entity and membership may share a UUID; history must preserve the namespace.
ALTER TABLE structure_history ADD COLUMN indicator_subject_kind text
  CHECK (indicator_subject_kind IS NULL OR indicator_subject_kind IN ('CIRCLE','ROLE','MEMBER'));
CREATE INDEX structure_member_indicator_history ON structure_history(organization_id,resource_id,at,id)
WHERE indicator_subject_kind='MEMBER';
