-- O2 package state belongs to Structure; O2 meeting state belongs to Meetings.
-- Both owners must be empty before Foundation removes entities.
-- Extend only the fixed ownership arrays of the existing lifecycle functions.
-- Preserve historical migrations, privileges, lease/schema gates and cursor order.
-- This does NOT attest or replace the project's reviewed schema baseline.
DO $migration$
DECLARE
 signature text;
 definition text;
 marker text;
 addition text;
 structure_addition constant text := ',''structure_governance_models'',''structure_model_revisions'',''structure_model_functions'',''structure_model_circles'',''structure_model_occupancy_context'',''structure_model_events''';
 meetings_addition constant text := ',''meeting_o2_panels'',''meeting_o2_processes'',''meeting_o2_treatments'',''meeting_o2_circle_templates'',''meeting_o2_reviews''';
BEGIN
 FOR signature,marker,addition IN SELECT * FROM (VALUES
  ('public.structure_teardown_batch(uuid,uuid,bigint,uuid,text,text,integer)',quote_literal('structure_views'),structure_addition),
  ('public.meetings_teardown_batch(uuid,uuid,bigint,uuid,text,text,integer)',quote_literal('meeting_export_selections'),meetings_addition),
  ('public.foundation_teardown_batch(uuid,uuid,bigint,uuid,text,text,integer)',quote_literal('structure_views'),structure_addition),
  ('public.foundation_teardown_batch(uuid,uuid,bigint,uuid,text,text,integer)',quote_literal('meeting_export_selections'),meetings_addition),
  ('public.orgmap_deletion_assert_tenant_owned_empty(uuid,uuid,bigint,uuid)',quote_literal('structure_views'),structure_addition),
  ('public.orgmap_deletion_assert_tenant_owned_empty(uuid,uuid,bigint,uuid)',quote_literal('meeting_export_selections'),meetings_addition),
  ('public.orgmap_deletion_assert_owner_empty(uuid,uuid,bigint,uuid,text)',quote_literal('structure_views'),structure_addition),
  ('public.orgmap_deletion_assert_owner_empty(uuid,uuid,bigint,uuid,text)',quote_literal('meeting_export_selections'),meetings_addition)
 ) AS extensions(function_signature,array_marker,array_addition) LOOP
  SELECT pg_get_functiondef(signature::regprocedure) INTO definition;
  -- Refuse an unexpected definition instead of dropping any existing guard or
  -- appending names to the wrong array. Each owner marker occurs only once.
  IF (length(definition)-length(replace(definition,marker,'')))/length(marker) <> 1
     OR position(addition IN definition)>0 THEN
   RAISE EXCEPTION 'O2_LIFECYCLE_EXTENSION_CONFLICT: %',signature USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,marker,marker||addition);
 END LOOP;
END $migration$;
