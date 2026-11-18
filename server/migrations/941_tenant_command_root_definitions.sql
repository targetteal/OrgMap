-- Organization creation now returns the root circle's definition collections.
-- Keep the historical command shape valid for existing idempotency records.
DO $$
DECLARE
  definition text;
  old_clause constant text := 'RETURN keys=ARRAY[''archived'',''id'',''kind'',''name'',''nodeId'',''organizationId'',''parentCircleId'',''parentId'',''purpose'',''purposeRich'',''version''] AND root->>''organizationId''=oid';
  new_clause constant text := 'RETURN (keys=ARRAY[''archived'',''id'',''kind'',''name'',''nodeId'',''organizationId'',''parentCircleId'',''parentId'',''purpose'',''purposeRich'',''version''] OR (keys=ARRAY[''archived'',''artifacts'',''id'',''kind'',''name'',''nodeId'',''organizationId'',''parentCircleId'',''parentId'',''purpose'',''purposeRich'',''responsibilities'',''version''] AND root->''artifacts''=''[]''::jsonb AND root->''responsibilities''=''[]''::jsonb)) AND root->>''organizationId''=oid';
BEGIN
  definition := pg_get_functiondef('public.orgmap_tenant_command_shape_valid(uuid,text,jsonb)'::regprocedure);
  IF position(old_clause in definition) = 0 THEN
    RAISE EXCEPTION 'TENANT_COMMAND_VALIDATOR_SHAPE_UNEXPECTED' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition, old_clause, new_clause);
END $$;
