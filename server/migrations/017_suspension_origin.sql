-- Existing suspended memberships deliberately retain unknown (NULL) provenance.
ALTER TABLE members ADD COLUMN suspension_origin jsonb;
ALTER TABLE members ADD CONSTRAINT members_suspension_origin_shape CHECK (
 suspension_origin IS NULL OR COALESCE(
  status='SUSPENDED' AND jsonb_typeof(suspension_origin)='object' AND (
   (suspension_origin='{"type":"MANUAL"}'::jsonb) OR (
    suspension_origin->>'type'='SCIM'
    AND suspension_origin-ARRAY['type','connectionId','externalId','mappingRevision']::text[]='{}'::jsonb
    AND jsonb_typeof(suspension_origin->'connectionId')='string'
    AND suspension_origin->>'connectionId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND jsonb_typeof(suspension_origin->'externalId')='string'
    AND char_length(suspension_origin->>'externalId') BETWEEN 1 AND 512
    AND suspension_origin->>'externalId' !~ '[[:cntrl:]]'
    AND jsonb_typeof(suspension_origin->'mappingRevision')='number'
    AND suspension_origin->>'mappingRevision' ~ '^[1-9][0-9]*$'
   )
  ),false
 )
);
