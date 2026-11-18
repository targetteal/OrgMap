-- Generic 513 cannot certify QUIESCE: 913 requires a transaction-bound 911
-- receipt. An unclassified Account replay or unattested owner is never purged.
CREATE FUNCTION foundation_teardown_batch(
 p_org uuid,p_job uuid,p_fence bigint,p_token uuid,p_phase text,p_cursor text,p_limit integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE phase_now text; progress record; idx integer; t text; affected integer; any_row boolean;
 owners constant text[] := ARRAY['structure_aliases',
   'structure_circle_creations',
   'structure_circle_display',
   'structure_circle_policies',
   'structure_collective_policies',
   'structure_field_revisions',
   'structure_fields',
   'structure_history',
   'structure_indicators',
   'structure_mandates',
   'structure_records',
   'structure_role_functions',
   'structure_role_settings',
   'structure_snapshots',
   'structure_templates',
   'structure_values',
   'structure_views',
   'gov_ballots',
   'gov_branches',
   'gov_commits',
   'gov_document_types',
   'gov_document_versions',
   'gov_documents',
   'gov_history',
   'gov_nominations',
   'gov_objections',
   'gov_policies',
   'gov_proposals',
   'gov_revisions',
   'gov_rounds',
   'gov_tension_links',
   'gov_tensions',
   'work_access',
   'work_assignments',
   'work_checklist',
   'work_circle_provisioning',
   'work_comments',
   'work_created_projects',
   'work_dependencies',
   'work_export_selections',
   'work_layouts',
   'work_links',
   'work_project_import_items',
   'work_projects',
   'work_role_assignments',
   'work_sections',
   'work_settings',
   'work_subtask_groups',
   'work_task_observations',
   'work_tasks',
   'work_templates',
   'goal_assignments',
   'goal_history',
   'goal_key_results',
   'goal_origins',
   'goal_period_links',
   'goal_periods',
   'goal_resource_links',
   'goals',
   'meeting_actions',
   'meeting_agenda',
   'meeting_agenda_items',
   'meeting_document_epochs',
   'meeting_documents',
   'meeting_export_selections',
   'meeting_first_close_snapshots',
   'meeting_occurrences',
   'meeting_participants',
   'meeting_report_access',
   'meeting_report_versions',
   'meeting_reports',
   'meeting_series',
   'meeting_statistics_observation',
   'meeting_templates',
   'meeting_tickets',
   'meeting_updates',
   'administration_admission_policies',
   'administration_admission_policy_revisions',
   'administration_assistant_commands',
   'administration_assistant_personal',
   'administration_assistant_workspace',
   'administration_branding_assets',
   'administration_branding_commands',
   'administration_branding_gc',
   'administration_branding_history',
   'administration_branding_stages',
   'administration_credential_policies',
   'administration_credential_policy_revisions',
   'administration_entry_acknowledgements',
   'administration_feed_posts',
   'administration_feed_selections',
   'administration_feed_versions',
   'administration_grants',
   'administration_group_members',
   'administration_group_relations',
   'administration_indicator_consent_books',
   'administration_indicator_consent_history',
   'administration_indicator_consents',
   'administration_profile_relations',
   'administration_publications',
   'administration_records',
   'administration_revisions',
   'administration_schema_plans',
   'administration_settings',
   'administration_settings_revisions',
   'administration_upload_policies',
   'administration_upload_policy_revisions',
   'platform_artifacts',
   'platform_comments',
   'platform_deliveries',
   'platform_favorites',
   'platform_files',
   'platform_follows',
   'platform_job_attempts',
   'platform_jobs',
   'platform_policy',
   'platform_preference_revision',
   'platform_preferences',
   'platform_scope_wakes',
   'platform_views',
   'platform_worker_scopes',
   'interop_auth_flows',
   'interop_calendar_events',
   'interop_connections',
   'interop_credentials',
   'interop_deliveries',
   'interop_federated_identities',
   'interop_project_output_configs',
   'interop_project_output_deliveries',
   'interop_provider_grants',
   'interop_provider_oauth_flows',
   'interop_saml_cache',
   'interop_saml_replays',
   'interop_scim_sources',
   'interop_scim_users',
   'interop_webhook_inbox'];
 tables constant text[] := ARRAY['admission_mail','admission_requests','admission_links','admission_link_state','provisioned_enrollment_mail','provisioned_enrollment_reauth','provisioned_enrollment_flows','provisioned_enrollments','invitation_delivery','invitations','guest_resource_grants','credential_attestations','circle_memberships','occupancies','outbox','domain_events','command_results','audit_events','entities','members'];
 v_accounts uuid[]; v_refs tid[]; already_done boolean := false;
BEGIN
 IF current_setting('transaction_isolation') <> 'read committed' THEN
  RAISE EXCEPTION 'DELETION_READ_COMMITTED_REQUIRED' USING ERRCODE='25001';
 END IF;
 IF p_phase IS NULL OR p_phase NOT IN ('QUIESCE','INVENTORY','PURGE') OR p_limit IS NULL OR p_limit<1 OR p_limit>500 THEN
  RAISE EXCEPTION 'INVALID_TEARDOWN_BATCH' USING ERRCODE='22023';
 END IF;
 PERFORM public.orgmap_assert_deletion_maintenance(p_org,p_job,p_fence,p_token);
 SELECT phase INTO phase_now FROM public.organization_deletion_jobs WHERE id=p_job AND organization_id=p_org;
 IF phase_now IS DISTINCT FROM p_phase THEN RAISE EXCEPTION 'TEARDOWN_PHASE_MISMATCH' USING ERRCODE='42501'; END IF;
 SELECT cursor,done INTO progress FROM public.organization_deletion_progress WHERE job_id=p_job AND context_id='foundation' AND phase=p_phase;
 IF FOUND AND progress.done AND p_phase='INVENTORY' THEN RETURN jsonb_build_object('done',true,'nextCursor',NULL,'counts','{}'::jsonb,'blobReferences','[]'::jsonb); END IF;
 IF FOUND AND progress.done THEN
  IF p_phase='QUIESCE' THEN PERFORM public.orgmap_deletion_attest_quiescence(p_org,p_job,p_fence,p_token,'foundation'); RETURN jsonb_build_object('done',true,'nextCursor',NULL,'counts','{}'::jsonb,'blobReferences','[]'::jsonb); END IF;
  IF p_cursor IS NOT NULL THEN RAISE EXCEPTION 'FOUNDATION_UNVERIFIED_COMPLETION' USING ERRCODE='55000'; END IF;
  already_done:=true;
 END IF;
 IF (CASE WHEN FOUND THEN progress.cursor ELSE NULL END) IS DISTINCT FROM p_cursor THEN RAISE EXCEPTION 'TEARDOWN_CURSOR_MISMATCH' USING ERRCODE='42501'; END IF;
 -- Expiring FEDERATED sessions through 908 is not proof that prior external
 -- effects have drained. Never call it on the strength of an expired lease.
 IF p_phase='QUIESCE' THEN
  IF p_cursor IS NOT NULL THEN RAISE EXCEPTION 'INVALID_TEARDOWN_CURSOR' USING ERRCODE='22023'; END IF;
  PERFORM public.orgmap_deletion_attest_quiescence(p_org,p_job,p_fence,p_token,'foundation');
  RETURN jsonb_build_object('done',true,'nextCursor',NULL,'counts','{}'::jsonb,'blobReferences','[]'::jsonb);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.organization_deletion_progress WHERE job_id=p_job AND context_id='foundation' AND phase='QUIESCE' AND done) THEN
  RAISE EXCEPTION 'TEARDOWN_QUIESCE_REQUIRED' USING ERRCODE='42501';
 END IF;
 IF p_phase='PURGE' THEN
  PERFORM public.orgmap_deletion_assert_schema_current(p_org,p_job,p_fence,p_token);
  IF EXISTS(SELECT 1 FROM public.account_commands WHERE (key LIKE 'organization.create:%' OR key LIKE 'invitation.accept:%') AND public.orgmap_tenant_command_shape_valid(account_id,key,result) IS NOT TRUE) THEN
   RAISE EXCEPTION 'FOUNDATION_TENANT_COMMAND_PROOF_REQUIRED' USING ERRCODE='55000'; END IF;
 END IF;
 IF p_phase='INVENTORY' THEN
  IF p_cursor IS NOT NULL THEN RAISE EXCEPTION 'INVALID_TEARDOWN_CURSOR' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('done',true,'nextCursor',NULL,'counts','{}'::jsonb,'blobReferences','[]'::jsonb);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.organization_lifecycle WHERE organization_id=p_org AND state='PURGING' AND fence=p_fence) OR
    NOT EXISTS(SELECT 1 FROM public.organization_deletion_progress WHERE job_id=p_job AND context_id='foundation' AND phase='INVENTORY' AND done) THEN
  RAISE EXCEPTION 'TEARDOWN_INVENTORY_REQUIRED' USING ERRCODE='42501';
 END IF;
 -- Check every fixed owned relation, not merely a caller-supplied checkpoint.
 IF (SELECT count(*) FROM public.organization_deletion_progress WHERE job_id=p_job AND phase='PURGE' AND done AND context_id=ANY(ARRAY['administration','platform','structure','governance','work','goals','meetings','interoperability'])) <> 8 THEN
  RAISE EXCEPTION 'FOUNDATION_OTHER_OWNERS_INCOMPLETE' USING ERRCODE='55000';
 END IF;
 PERFORM set_config('orgmap.organization_id',p_org::text,true);
 FOREACH t IN ARRAY owners LOOP
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE organization_id=$1)',t) INTO any_row USING p_org;
  IF any_row THEN RAISE EXCEPTION 'FOUNDATION_OWNER_ROWS_REMAIN: %',t USING ERRCODE='55000'; END IF;
 END LOOP;
 -- Refuse any schema change that could silently cascade a Foundation deletion.
 IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint f JOIN pg_catalog.pg_class c ON c.oid=f.confrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE f.contype='f' AND f.confdeltype NOT IN ('a','r') AND n.nspname='public' AND c.relname=ANY(tables)) THEN
  RAISE EXCEPTION 'FOUNDATION_CASCADING_FOREIGN_KEY' USING ERRCODE='55000';
 END IF;
 IF EXISTS(SELECT 1 FROM public.sessions WHERE auth_method='FEDERATED' AND auth_organization_id=p_org AND (deletion_revoked_job_id IS DISTINCT FROM p_job OR deletion_revoked_at IS NULL OR expires_at>deletion_revoked_at)) THEN
  RAISE EXCEPTION 'FOUNDATION_SESSION_EXPIRATION_REQUIRED' USING ERRCODE='55000';
 END IF;
 -- No textual UUID search: classify the two known organization result shapes.
 -- Unknown command families or malformed/ambiguous shapes stop the transaction.
 IF EXISTS(SELECT 1 FROM public.account_commands c WHERE
    (c.key LIKE 'organization.create:%' AND (jsonb_typeof(c.result)<>'object' OR jsonb_typeof(c.result->'organization') IS DISTINCT FROM 'object' OR
      jsonb_typeof(c.result->'organization'->'id') IS DISTINCT FROM 'string' OR (c.result->'organization'->>'id') !~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' OR c.result ? 'organizationId')) OR
    (c.key LIKE 'invitation.accept:%' AND (jsonb_typeof(c.result)<>'object' OR jsonb_typeof(c.result->'organizationId') IS DISTINCT FROM 'string' OR
      (c.result->>'organizationId') !~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' OR c.result ? 'organization')) OR
    (c.key NOT LIKE 'organization.create:%' AND c.key NOT LIKE 'invitation.accept:%' AND c.key NOT LIKE 'account:%' AND c.key NOT LIKE 'account-media:%')) THEN
  RAISE EXCEPTION 'FOUNDATION_ACCOUNT_COMMAND_UNCLASSIFIED' USING ERRCODE='55000';
 END IF;
 IF p_cursor IS NOT NULL AND p_cursor !~ '^[1-9][0-9]?$' THEN RAISE EXCEPTION 'INVALID_TEARDOWN_CURSOR' USING ERRCODE='22023'; END IF;
 idx:=CASE WHEN already_done THEN 23 ELSE COALESCE(p_cursor::integer,1) END;
 IF idx<1 OR idx>23 THEN RAISE EXCEPTION 'INVALID_TEARDOWN_CURSOR' USING ERRCODE='22023'; END IF;
 IF idx=1 THEN
  SELECT array_agg(DISTINCT account_id ORDER BY account_id),array_agg(ctid) INTO v_accounts,v_refs FROM (
   SELECT c.account_id,c.ctid FROM public.account_commands c WHERE
    (c.key LIKE 'organization.create:%' AND (c.result->'organization'->>'id')::uuid=p_org AND c.result IS DISTINCT FROM jsonb_build_object('organization',jsonb_build_object('id',p_org::text),'deleted',true)) OR
    (c.key LIKE 'invitation.accept:%' AND (c.result->>'organizationId')::uuid=p_org AND c.result IS DISTINCT FROM jsonb_build_object('organizationId',p_org::text,'deleted',true))
   ORDER BY c.account_id,c.key LIMIT p_limit) q;
  IF v_refs IS NOT NULL THEN
   PERFORM 1 FROM public.accounts WHERE id=ANY(v_accounts) ORDER BY id FOR UPDATE;
   UPDATE public.account_commands SET result=CASE WHEN key LIKE 'organization.create:%' THEN jsonb_build_object('organization',jsonb_build_object('id',p_org::text),'deleted',true) ELSE jsonb_build_object('organizationId',p_org::text,'deleted',true) END WHERE ctid=ANY(v_refs) AND account_id=ANY(v_accounts) AND ((key LIKE 'organization.create:%' AND (result->'organization'->>'id')::uuid=p_org) OR (key LIKE 'invitation.accept:%' AND (result->>'organizationId')::uuid=p_org));
   GET DIAGNOSTICS affected=ROW_COUNT;
   RETURN jsonb_build_object('done',false,'nextCursor','1','counts',jsonb_build_object('account_commands',affected),'blobReferences','[]'::jsonb);
  END IF;
  idx:=2;
 END IF;
 IF idx=2 THEN
  SELECT array_agg(DISTINCT account_id ORDER BY account_id),array_agg(ctid) INTO v_accounts,v_refs FROM
   (SELECT account_id,ctid FROM public.sessions WHERE auth_method='FEDERATED' AND auth_organization_id=p_org AND deletion_revoked_job_id=p_job AND (token_hash IS DISTINCT FROM ('revoked:'||id::text) OR csrf IS DISTINCT FROM 'revoked' OR auth_issuer IS NOT NULL OR auth_subject IS NOT NULL OR auth_amr IS DISTINCT FROM '[]'::jsonb OR auth_time IS NOT NULL OR mfa_verified_at IS NOT NULL OR mfa_factor_revision IS NOT NULL) ORDER BY account_id,id LIMIT p_limit) q;
  IF v_refs IS NOT NULL THEN
   PERFORM 1 FROM public.accounts WHERE id=ANY(v_accounts) ORDER BY id FOR UPDATE;
   PERFORM set_config('orgmap.deletion_organization_id',p_org::text,true);
   PERFORM set_config('orgmap.deletion_job_id',p_job::text,true);
   PERFORM set_config('orgmap.deletion_fence',p_fence::text,true);
   PERFORM set_config('orgmap.deletion_lease_token',p_token::text,true);
   UPDATE public.sessions SET token_hash='revoked:'||id::text,csrf='revoked',auth_issuer=NULL,auth_subject=NULL,auth_amr='[]'::jsonb,auth_time=NULL,mfa_verified_at=NULL,mfa_factor_revision=NULL
    WHERE ctid=ANY(v_refs) AND account_id=ANY(v_accounts) AND auth_method='FEDERATED' AND auth_organization_id=p_org AND deletion_revoked_job_id=p_job AND expires_at<=deletion_revoked_at;
   GET DIAGNOSTICS affected=ROW_COUNT;
   RETURN jsonb_build_object('done',false,'nextCursor','2','counts',jsonb_build_object('sessions_minimized',affected),'blobReferences','[]'::jsonb);
  END IF;
  idx:=3;
 END IF;
 WHILE idx<=22 LOOP
  t:=tables[idx-2];
  IF t='entities' THEN
   DELETE FROM public.entities x WHERE x.ctid IN (SELECT e.ctid FROM public.entities e WHERE e.organization_id=p_org AND NOT EXISTS(SELECT 1 FROM public.entities child WHERE child.organization_id=e.organization_id AND child.parent_id=e.id) LIMIT p_limit);
  ELSE
   EXECUTE format('DELETE FROM public.%I WHERE ctid IN (SELECT x.ctid FROM public.%I x WHERE x.organization_id=$1 LIMIT $2)',t,t) USING p_org,p_limit;
  END IF;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected>0 THEN RETURN jsonb_build_object('done',false,'nextCursor',idx::text,'counts',jsonb_build_object(t,affected),'blobReferences','[]'::jsonb); END IF;
  IF t='entities' AND EXISTS(SELECT 1 FROM public.entities WHERE organization_id=p_org) THEN RAISE EXCEPTION 'FOUNDATION_ENTITY_CYCLE' USING ERRCODE='23514'; END IF;
  idx:=idx+1;
 END LOOP;
 -- Cursor/checkpoint cannot establish absence: independently recheck all sets.
 FOREACH t IN ARRAY tables LOOP
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE organization_id=$1)',t) INTO any_row USING p_org;
  IF any_row THEN RAISE EXCEPTION 'FOUNDATION_ROWS_REMAIN: %',t USING ERRCODE='55000'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.sessions WHERE auth_method='FEDERATED' AND auth_organization_id=p_org AND (deletion_revoked_job_id IS DISTINCT FROM p_job OR deletion_revoked_at IS NULL OR expires_at>deletion_revoked_at OR token_hash IS DISTINCT FROM ('revoked:'||id::text) OR csrf IS DISTINCT FROM 'revoked' OR auth_issuer IS NOT NULL OR auth_subject IS NOT NULL OR auth_amr IS DISTINCT FROM '[]'::jsonb OR auth_time IS NOT NULL OR mfa_verified_at IS NOT NULL OR mfa_factor_revision IS NOT NULL)) OR EXISTS(SELECT 1 FROM public.account_commands c WHERE
    (c.key LIKE 'organization.create:%' AND (c.result->'organization'->>'id')::uuid=p_org AND c.result IS DISTINCT FROM jsonb_build_object('organization',jsonb_build_object('id',p_org::text),'deleted',true)) OR
    (c.key LIKE 'invitation.accept:%' AND (c.result->>'organizationId')::uuid=p_org AND c.result IS DISTINCT FROM jsonb_build_object('organizationId',p_org::text,'deleted',true))) THEN
  RAISE EXCEPTION 'FOUNDATION_MIXED_ROWS_REMAIN' USING ERRCODE='55000';
 END IF;
 IF already_done THEN
  IF NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=p_org AND name='Deleted organization' AND locale='und' AND time_zone='UTC') THEN RAISE EXCEPTION 'FOUNDATION_TOMBSTONE_INVALID' USING ERRCODE='55000'; END IF;
  RETURN jsonb_build_object('done',true,'nextCursor',NULL,'counts','{}'::jsonb,'blobReferences','[]'::jsonb);
 END IF;
 UPDATE public.organizations SET name='Deleted organization',locale='und',time_zone='UTC' WHERE id=p_org;
 RETURN jsonb_build_object('done',true,'nextCursor',NULL,'counts',jsonb_build_object('organization_tombstone',1),'blobReferences','[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION foundation_teardown_batch(uuid,uuid,bigint,uuid,text,text,integer) FROM PUBLIC,orgmap_app;
GRANT EXECUTE ON FUNCTION foundation_teardown_batch(uuid,uuid,bigint,uuid,text,text,integer) TO orgmap_lifecycle_maintenance;
