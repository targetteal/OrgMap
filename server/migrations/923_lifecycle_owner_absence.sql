-- Absence is checked from fixed reviewed ownership, never from a checkpoint or caller table names.
CREATE FUNCTION orgmap_deletion_assert_owner_empty(p_org uuid,p_job uuid,p_fence bigint,p_token uuid,p_owner text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t text; found_row boolean; owned text[];
BEGIN
 PERFORM public.orgmap_deletion_assert_schema_current(p_org,p_job,p_fence,p_token);
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'DELETION_ZERO_VISIBILITY_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM set_config('row_security','off',true);
 owned:=CASE p_owner
WHEN 'structure' THEN ARRAY['structure_aliases','structure_circle_creations','structure_circle_display','structure_circle_policies','structure_collective_policies','structure_field_revisions','structure_fields','structure_history','structure_indicators','structure_mandates','structure_records','structure_role_functions','structure_role_settings','structure_snapshots','structure_templates','structure_values','structure_views']
WHEN 'governance' THEN ARRAY['gov_ballots','gov_branches','gov_commits','gov_document_types','gov_document_versions','gov_documents','gov_history','gov_nominations','gov_objections','gov_policies','gov_proposals','gov_revisions','gov_rounds','gov_tension_links','gov_tensions']
WHEN 'work' THEN ARRAY['work_access','work_assignments','work_checklist','work_circle_provisioning','work_comments','work_created_projects','work_dependencies','work_export_selections','work_layouts','work_links','work_project_import_items','work_projects','work_role_assignments','work_sections','work_settings','work_subtask_groups','work_task_observations','work_tasks','work_templates']
WHEN 'goals' THEN ARRAY['goal_assignments','goal_history','goal_key_results','goal_origins','goal_period_links','goal_periods','goal_resource_links','goals']
WHEN 'meetings' THEN ARRAY['meeting_actions','meeting_agenda','meeting_agenda_items','meeting_document_epochs','meeting_documents','meeting_export_selections','meeting_first_close_snapshots','meeting_occurrences','meeting_participants','meeting_report_access','meeting_report_versions','meeting_reports','meeting_series','meeting_statistics_observation','meeting_templates','meeting_tickets','meeting_updates']
WHEN 'administration' THEN ARRAY['administration_admission_policies','administration_admission_policy_revisions','administration_assistant_commands','administration_assistant_personal','administration_assistant_workspace','administration_branding_assets','administration_branding_commands','administration_branding_gc','administration_branding_history','administration_branding_stages','administration_credential_policies','administration_credential_policy_revisions','administration_entry_acknowledgements','administration_feed_posts','administration_feed_selections','administration_feed_versions','administration_grants','administration_group_members','administration_group_relations','administration_indicator_consent_books','administration_indicator_consent_history','administration_indicator_consents','administration_profile_relations','administration_publications','administration_records','administration_revisions','administration_schema_plans','administration_settings','administration_settings_revisions','administration_upload_policies','administration_upload_policy_revisions']
WHEN 'platform' THEN ARRAY['platform_artifacts','platform_comments','platform_deliveries','platform_favorites','platform_files','platform_follows','platform_job_attempts','platform_jobs','platform_policy','platform_preference_revision','platform_preferences','platform_scope_wakes','platform_views','platform_worker_scopes']
WHEN 'interoperability' THEN ARRAY['interop_auth_flows','interop_calendar_events','interop_connections','interop_credentials','interop_deliveries','interop_federated_identities','interop_project_output_configs','interop_project_output_deliveries','interop_provider_grants','interop_provider_oauth_flows','interop_saml_cache','interop_saml_replays','interop_scim_sources','interop_scim_users','interop_webhook_inbox']
WHEN 'foundation' THEN ARRAY['members','entities','circle_memberships','occupancies','audit_events','domain_events','outbox','command_results','invitations','invitation_delivery','provisioned_enrollments','provisioned_enrollment_mail','provisioned_enrollment_reauth','provisioned_enrollment_flows','guest_resource_grants','credential_attestations','admission_link_state','admission_links','admission_requests','admission_mail']
 ELSE NULL END;
 IF owned IS NULL THEN RAISE EXCEPTION 'DELETION_OWNER_INVALID' USING ERRCODE='22023'; END IF;
 FOREACH t IN ARRAY owned LOOP
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE organization_id=$1)',t) INTO found_row USING p_org;
  IF found_row THEN RAISE EXCEPTION 'DELETION_OWNER_ROWS_REMAIN: %',t USING ERRCODE='55000'; END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION orgmap_deletion_assert_owner_empty(uuid,uuid,bigint,uuid,text) FROM PUBLIC,orgmap_app;
GRANT EXECUTE ON FUNCTION orgmap_deletion_assert_owner_empty(uuid,uuid,bigint,uuid,text) TO orgmap_lifecycle_maintenance;

-- Closed current writer contract. Unknown historical operations/shapes remain held.
CREATE FUNCTION orgmap_account_command_shape_valid(p_account uuid,p_key text,p_result jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE op text; suffix text; route_id text; m text[]; obj jsonb; keys text[]; expected text[]; kind text;
BEGIN
 IF jsonb_typeof(p_result) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 m:=regexp_match(p_key, '^account:(PATCH:/api/v1/account/preferences|PATCH:/api/v1/account|POST:/api/v1/auth/password/disable|POST:/api/v1/auth/password|POST:/api/v1/auth/sessions/[0-9a-fA-F-]{36}/revoke|POST:/api/v1/account/email-change/requests/[0-9a-fA-F-]{36}/revoke|POST:/api/v1/account/email-change/requests/[0-9a-fA-F-]{36}/complete|POST:/api/v1/account/email-change/requests):(.+)$');
 IF m IS NOT NULL THEN op:=m[1]; suffix:=m[2];
 ELSE
  m:=regexp_match(p_key,'^account-media:(POST|DELETE):(PHOTO|COVER):(.+)$');
  IF m IS NULL THEN RETURN false; END IF;
  op:='media:'||m[1];kind:=m[2];suffix:=m[3];
 END IF;
 IF char_length(suffix)>200 OR btrim(suffix)<>suffix OR suffix='' THEN RETURN false; END IF;
 SELECT array_agg(k ORDER BY k COLLATE "C") INTO keys FROM jsonb_object_keys(p_result) k;
 IF op='PATCH:/api/v1/account/preferences' THEN
  IF keys IS DISTINCT FROM ARRAY['preferences'] THEN RETURN false; END IF;
  obj:=p_result->'preferences';
  IF jsonb_typeof(obj) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  SELECT array_agg(k ORDER BY k COLLATE "C") INTO keys FROM jsonb_object_keys(obj) k;
  RETURN keys=ARRAY['accountId','dateFormat','locale','reducedMotion','theme','timeZone','version'] AND obj->>'accountId'=p_account::text
   AND jsonb_typeof(obj->'locale')='string' AND jsonb_typeof(obj->'timeZone')='string' AND obj->>'dateFormat' IN ('DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD')
   AND obj->>'theme' IN ('system','dark','light') AND jsonb_typeof(obj->'reducedMotion')='boolean' AND jsonb_typeof(obj->'version')='number' AND (obj->>'version')~'^[1-9][0-9]*$';
 ELSIF op LIKE 'media:%' THEN
  IF keys IS DISTINCT FROM ARRAY['media'] THEN RETURN false; END IF; obj:=p_result->'media';
  IF jsonb_typeof(obj) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  SELECT array_agg(k ORDER BY k COLLATE "C") INTO keys FROM jsonb_object_keys(obj) k;
  IF keys IS DISTINCT FROM ARRAY['assetId','height','kind','mime','readUrl','size','state','updatedAt','version','width'] OR obj->>'kind'<>kind OR jsonb_typeof(obj->'updatedAt')<>'string' OR jsonb_typeof(obj->'version')<>'number' OR (obj->>'version')!~'^[1-9][0-9]*$' THEN RETURN false; END IF;
  IF op='media:DELETE' THEN RETURN obj->>'state'='DELETED' AND obj->'assetId'='null'::jsonb AND obj->'mime'='null'::jsonb AND obj->'width'='null'::jsonb AND obj->'height'='null'::jsonb AND obj->'size'='null'::jsonb AND obj->'readUrl'='null'::jsonb; END IF;
  RETURN obj->>'state'='ACTIVE' AND obj->>'assetId'~*'^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' AND obj->>'mime' IN ('image/png','image/jpeg','image/webp') AND obj->>'readUrl'=CASE kind WHEN 'PHOTO' THEN '/api/v1/account/media/photo' ELSE '/api/v1/account/media/cover' END
   AND jsonb_typeof(obj->'width')='number' AND obj->>'width'~'^[1-9][0-9]*$' AND jsonb_typeof(obj->'height')='number' AND obj->>'height'~'^[1-9][0-9]*$' AND jsonb_typeof(obj->'size')='number' AND obj->>'size'~'^[1-9][0-9]*$';
 ELSIF op LIKE 'POST:/api/v1/auth/sessions/%/revoke' THEN
  RETURN op~*'^POST:/api/v1/auth/sessions/[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}/revoke$' AND keys=ARRAY['revoked'] AND p_result->'revoked'='true'::jsonb;
 ELSIF op LIKE 'POST:/api/v1/account/email-change/requests%' THEN
  IF op='POST:/api/v1/account/email-change/requests' THEN expected:=ARRAY['expiresAt','requestId','state'];
  ELSIF op LIKE '%/revoke' THEN expected:=ARRAY['expiresAt','requestId','state'];
  ELSE expected:=ARRAY['account','expiresAt','requestId','state']; END IF;
  IF keys IS DISTINCT FROM expected OR jsonb_typeof(p_result->'expiresAt')<>'string' OR p_result->>'requestId'!~*'^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' THEN RETURN false; END IF;
  IF op='POST:/api/v1/account/email-change/requests' THEN RETURN p_result->>'state'='PENDING_PROOF'; END IF;
  route_id:=split_part(op,'/',7);
  IF route_id!~*'^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' OR lower(route_id)<>lower(p_result->>'requestId') THEN RETURN false; END IF;
  IF op LIKE '%/revoke' THEN RETURN p_result->>'state'='REVOKED'; END IF;
  IF p_result->>'state'<>'COMPLETED' THEN RETURN false; END IF;
 ELSIF op='POST:/api/v1/auth/password' THEN
  IF keys IS DISTINCT FROM ARRAY['account','passwordChanged'] OR p_result->'passwordChanged'<>'true'::jsonb THEN RETURN false; END IF;
 ELSE
  IF keys IS DISTINCT FROM ARRAY['account'] THEN RETURN false; END IF;
 END IF;
 obj:=p_result->'account'; IF jsonb_typeof(obj) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 SELECT array_agg(k ORDER BY k COLLATE "C") INTO keys FROM jsonb_object_keys(obj) k;
 RETURN keys=ARRAY['displayName','email','id','passwordEnabled','version'] AND obj->>'id'=p_account::text AND jsonb_typeof(obj->'email')='string' AND jsonb_typeof(obj->'displayName')='string' AND jsonb_typeof(obj->'passwordEnabled')='boolean' AND jsonb_typeof(obj->'version')='number' AND (obj->>'version')~'^[1-9][0-9]*$' AND (op<>'POST:/api/v1/auth/password/disable' OR obj->'passwordEnabled'='false'::jsonb);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION orgmap_account_command_shape_valid(uuid,text,jsonb) FROM PUBLIC,orgmap_app;

-- Exact current shapes and explicit tombstones, including nested organization binding.
CREATE FUNCTION orgmap_tenant_command_shape_valid(p_account uuid,p_key text,p_result jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE keys text[]; o jsonb; m jsonb; root jsonb; oid text;
BEGIN
 IF jsonb_typeof(p_result) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 SELECT array_agg(k ORDER BY k COLLATE "C") INTO keys FROM jsonb_object_keys(p_result) k;
 IF p_key LIKE 'organization.create:%' THEN
  o:=p_result->'organization'; IF jsonb_typeof(o) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  oid:=o->>'id'; IF oid !~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' THEN RETURN false; END IF;
  IF keys=ARRAY['deleted','organization'] THEN
   SELECT array_agg(k ORDER BY k COLLATE "C") INTO keys FROM jsonb_object_keys(o) k;
   RETURN keys=ARRAY['id'] AND p_result->'deleted'='true'::jsonb;
  END IF;
  IF keys IS DISTINCT FROM ARRAY['membership','organization','rootCircle'] THEN RETURN false; END IF;
  SELECT array_agg(k ORDER BY k COLLATE "C") INTO keys FROM jsonb_object_keys(o) k;
  IF keys IS DISTINCT FROM ARRAY['authorizationRevision','id','locale','name','structureRevision','timeZone','version'] OR jsonb_typeof(o->'name')<>'string' OR jsonb_typeof(o->'locale')<>'string' OR jsonb_typeof(o->'timeZone')<>'string' OR jsonb_typeof(o->'version')<>'number' OR jsonb_typeof(o->'structureRevision')<>'number' OR jsonb_typeof(o->'authorizationRevision')<>'number' THEN RETURN false; END IF;
  m:=p_result->'membership'; root:=p_result->'rootCircle';
  IF jsonb_typeof(m) IS DISTINCT FROM 'object' OR jsonb_typeof(root) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  SELECT array_agg(k ORDER BY k COLLATE "C") INTO keys FROM jsonb_object_keys(m) k;
  IF keys IS DISTINCT FROM ARRAY['id','orgRole'] OR m->>'orgRole'<>'OWNER' OR m->>'id'!~*'^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' THEN RETURN false; END IF;
  SELECT array_agg(k ORDER BY k COLLATE "C") INTO keys FROM jsonb_object_keys(root) k;
  RETURN keys=ARRAY['archived','id','kind','name','nodeId','organizationId','parentCircleId','parentId','purpose','purposeRich','version'] AND root->>'organizationId'=oid AND root->>'kind'='CIRCLE' AND root->'archived'='false'::jsonb AND root->'parentId'='null'::jsonb AND root->'parentCircleId'='null'::jsonb AND root->'purposeRich'='null'::jsonb AND root->>'id'~*'^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' AND root->>'nodeId'~*'^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' AND jsonb_typeof(root->'name')='string' AND jsonb_typeof(root->'version')='number' AND jsonb_typeof(root->'purpose') IN ('string','null');
 ELSIF p_key LIKE 'invitation.accept:%' THEN
  oid:=p_result->>'organizationId'; IF oid !~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' THEN RETURN false; END IF;
  IF keys=ARRAY['deleted','organizationId'] THEN RETURN p_result->'deleted'='true'::jsonb; END IF;
  IF keys IS DISTINCT FROM ARRAY['membership','organizationId'] THEN RETURN false; END IF;
  m:=p_result->'membership'; IF jsonb_typeof(m) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  SELECT array_agg(k ORDER BY k COLLATE "C") INTO keys FROM jsonb_object_keys(m) k;
  RETURN keys=ARRAY['accountId','id','memberType','orgRole','organizationId','status','suspensionOrigin','version'] AND m->>'organizationId'=oid AND m->>'accountId'=p_account::text AND m->>'id'~*'^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' AND jsonb_typeof(m->'orgRole')='string' AND m->>'status'='ACTIVE' AND m->'suspensionOrigin'='null'::jsonb AND jsonb_typeof(m->'memberType')='string' AND jsonb_typeof(m->'version')='number';
 END IF;
 RETURN false;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION orgmap_tenant_command_shape_valid(uuid,text,jsonb) FROM PUBLIC,orgmap_app;

-- Foundation mixed data has independently checked minimal retained projections.
-- This is not proof of blob deletion, backup disposition, or remote effects.
CREATE FUNCTION orgmap_deletion_assert_mixed_empty(p_org uuid,p_job uuid,p_fence bigint,p_token uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM public.orgmap_deletion_assert_schema_current(p_org,p_job,p_fence,p_token);
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'DELETION_ZERO_VISIBILITY_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM set_config('row_security','off',true);
 IF EXISTS(SELECT 1 FROM public.iam_mail_scope_leases WHERE organization_id=p_org) THEN RAISE EXCEPTION 'DELETION_IAM_SCOPE_ROWS_REMAIN' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM public.sessions WHERE auth_organization_id=p_org AND (auth_method IS DISTINCT FROM 'FEDERATED' OR deletion_revoked_job_id IS DISTINCT FROM p_job OR deletion_revoked_at IS NULL OR expires_at>deletion_revoked_at OR token_hash IS DISTINCT FROM ('revoked:'||id::text) OR csrf IS DISTINCT FROM 'revoked' OR auth_issuer IS NOT NULL OR auth_subject IS NOT NULL OR auth_amr IS DISTINCT FROM '[]'::jsonb OR auth_time IS NOT NULL OR mfa_verified_at IS NOT NULL OR mfa_factor_revision IS NOT NULL)) THEN
  RAISE EXCEPTION 'FOUNDATION_SESSION_NOT_MINIMIZED' USING ERRCODE='55000'; END IF;
 -- Current global Account writer operations have explicit closed shapes.
 -- Unrecognized routes, fields or historical shapes remain blocked.
 IF EXISTS(SELECT 1 FROM public.account_commands WHERE (key LIKE 'account:%' OR key LIKE 'account-media:%') AND public.orgmap_account_command_shape_valid(account_id,key,result) IS NOT TRUE) THEN
  RAISE EXCEPTION 'FOUNDATION_ACCOUNT_COMMAND_PROOF_REQUIRED' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM public.account_commands WHERE (key LIKE 'organization.create:%' OR key LIKE 'invitation.accept:%') AND public.orgmap_tenant_command_shape_valid(account_id,key,result) IS NOT TRUE) THEN
  RAISE EXCEPTION 'FOUNDATION_TENANT_COMMAND_PROOF_REQUIRED' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM public.account_commands c WHERE
    (c.key LIKE 'organization.create:%' AND (jsonb_typeof(c.result)<>'object' OR jsonb_typeof(c.result->'organization') IS DISTINCT FROM 'object' OR jsonb_typeof(c.result->'organization'->'id') IS DISTINCT FROM 'string' OR (c.result->'organization'->>'id') !~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' OR c.result ? 'organizationId')) OR
    (c.key LIKE 'invitation.accept:%' AND (jsonb_typeof(c.result)<>'object' OR jsonb_typeof(c.result->'organizationId') IS DISTINCT FROM 'string' OR (c.result->>'organizationId') !~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' OR c.result ? 'organization')) OR
    (c.key NOT LIKE 'organization.create:%' AND c.key NOT LIKE 'invitation.accept:%' AND c.key NOT LIKE 'account:%' AND c.key NOT LIKE 'account-media:%')) THEN
  RAISE EXCEPTION 'FOUNDATION_ACCOUNT_COMMAND_UNCLASSIFIED' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM public.account_commands c WHERE
    (c.key LIKE 'organization.create:%' AND (c.result->'organization'->>'id')::uuid=p_org AND c.result IS DISTINCT FROM jsonb_build_object('organization',jsonb_build_object('id',p_org::text),'deleted',true)) OR
    (c.key LIKE 'invitation.accept:%' AND (c.result->>'organizationId')::uuid=p_org AND c.result IS DISTINCT FROM jsonb_build_object('organizationId',p_org::text,'deleted',true))) OR
    NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=p_org AND name='Deleted organization' AND locale='und' AND time_zone='UTC') THEN
  RAISE EXCEPTION 'FOUNDATION_MIXED_ROWS_REMAIN' USING ERRCODE='55000'; END IF;
END $$;
REVOKE ALL ON FUNCTION orgmap_deletion_assert_mixed_empty(uuid,uuid,bigint,uuid) FROM PUBLIC,orgmap_app;
GRANT EXECUTE ON FUNCTION orgmap_deletion_assert_mixed_empty(uuid,uuid,bigint,uuid) TO orgmap_lifecycle_maintenance;

CREATE FUNCTION orgmap_deletion_purge_initiator(p_org uuid,p_job uuid,p_fence bigint,p_token uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;
BEGIN
 PERFORM public.orgmap_deletion_assert_schema_current(p_org,p_job,p_fence,p_token);
 SELECT initiator_account_id INTO actor FROM public.organization_deletion_jobs WHERE id=p_job AND organization_id=p_org AND phase='PURGE';
 IF actor IS NULL THEN RAISE EXCEPTION 'DELETION_ACTOR_INVALID' USING ERRCODE='42501'; END IF;
 RETURN actor;
END $$;
REVOKE ALL ON FUNCTION orgmap_deletion_purge_initiator(uuid,uuid,bigint,uuid) FROM PUBLIC,orgmap_app;
GRANT EXECUTE ON FUNCTION orgmap_deletion_purge_initiator(uuid,uuid,bigint,uuid) TO orgmap_lifecycle_maintenance;
