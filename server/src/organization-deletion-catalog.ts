/** Reviewed migration-name inventory, not a proof that a table is safe to purge.
 * The live database must match this closed set; foundation entries remain under review.
 */
export const deletionTableInventory = {
  structure: [
    "structure_aliases",
    "structure_circle_creations",
    "structure_circle_display",
    "structure_circle_policies",
    "structure_collective_policies",
    "structure_field_revisions",
    "structure_fields",
    "structure_governance_models",
    "structure_history",
    "structure_indicators",
    "structure_mandates",
    "structure_model_circles",
    "structure_model_events",
    "structure_model_functions",
    "structure_model_occupancy_context",
    "structure_model_revisions",
    "structure_records",
    "structure_role_functions",
    "structure_role_settings",
    "structure_snapshots",
    "structure_templates",
    "structure_values",
    "structure_views",
  ],
  governance: [
    "gov_ballots",
    "gov_branches",
    "gov_commits",
    "gov_document_types",
    "gov_document_versions",
    "gov_documents",
    "gov_history",
    "gov_nominations",
    "gov_objections",
    "gov_policies",
    "gov_proposals",
    "gov_revisions",
    "gov_rounds",
    "gov_tension_links",
    "gov_tensions",
  ],
  work: [
    "work_access",
    "work_assignments",
    "work_checklist",
    "work_circle_provisioning",
    "work_comments",
    "work_created_projects",
    "work_dependencies",
    "work_export_selections",
    "work_layouts",
    "work_links",
    "work_project_import_items",
    "work_projects",
    "work_role_assignments",
    "work_sections",
    "work_settings",
    "work_subtask_groups",
    "work_task_observations",
    "work_tasks",
    "work_templates",
  ],
  goals: [
    "goal_assignments",
    "goal_history",
    "goal_key_results",
    "goal_origins",
    "goal_period_links",
    "goal_periods",
    "goal_resource_links",
    "goals",
  ],
  meetings: [
    "meeting_actions",
    "meeting_agenda",
    "meeting_agenda_items",
    "meeting_document_epochs",
    "meeting_documents",
    "meeting_export_selections",
    "meeting_first_close_snapshots",
    "meeting_occurrences",
    "meeting_o2_circle_templates",
    "meeting_o2_panels",
    "meeting_o2_processes",
    "meeting_o2_reviews",
    "meeting_o2_treatments",
    "meeting_participants",
    "meeting_report_access",
    "meeting_report_versions",
    "meeting_reports",
    "meeting_series",
    "meeting_statistics_observation",
    "meeting_templates",
    "meeting_tickets",
    "meeting_updates",
  ],
  administration: [
    "administration_admission_policies",
    "administration_admission_policy_revisions",
    "administration_assistant_commands",
    "administration_assistant_personal",
    "administration_assistant_workspace",
    "administration_branding_assets",
    "administration_branding_commands",
    "administration_branding_gc",
    "administration_branding_history",
    "administration_branding_stages",
    "administration_credential_policies",
    "administration_credential_policy_revisions",
    "administration_entry_acknowledgements",
    "administration_feed_posts",
    "administration_feed_selections",
    "administration_feed_versions",
    "administration_grants",
    "administration_group_members",
    "administration_group_relations",
    "administration_indicator_consent_books",
    "administration_indicator_consent_history",
    "administration_indicator_consents",
    "administration_profile_relations",
    "administration_publications",
    "administration_records",
    "administration_revisions",
    "administration_schema_plans",
    "administration_settings",
    "administration_settings_revisions",
    "administration_upload_policies",
    "administration_upload_policy_revisions",
  ],
  platform: [
    "platform_artifacts",
    "platform_comments",
    "platform_deliveries",
    "platform_favorites",
    "platform_files",
    "platform_follows",
    "platform_job_attempts",
    "platform_jobs",
    "platform_policy",
    "platform_preference_revision",
    "platform_preferences",
    "platform_scope_wakes",
    "platform_views",
    "platform_worker_scopes",
  ],
  interoperability: [
    "interop_auth_flows",
    "interop_calendar_events",
    "interop_connections",
    "interop_credentials",
    "interop_deliveries",
    "interop_federated_identities",
    "interop_project_output_configs",
    "interop_project_output_deliveries",
    "interop_provider_grants",
    "interop_provider_oauth_flows",
    "interop_saml_cache",
    "interop_saml_replays",
    "interop_scim_sources",
    "interop_scim_users",
    "interop_webhook_inbox",
  ],
  schema_control: [
    "organization_deletion_schema_baseline",
  ],
  interoperability_control: [
    "interoperability_deletion_outcomes",
  ],
  drain_control: [
    "organization_deletion_drain_receipts",
    "organization_deletion_quiescence_attestations",
  ],
  acceptance_control: [
    "organization_deletion_acceptance_receipts",
  ],
  blob_removal_control: [
    "organization_blob_removal_intents",
  ],
  database_metadata: [
    "schema_migrations",
    "schema_migration_reconciliations",
  ],
  foundation_review: [
    "account_commands",
    "account_email_change_mail",
    "account_email_change_rate_budgets",
    "account_email_change_requests",
    "account_events",
    "account_mail",
    "account_media",
    "account_media_gc",
    "account_mfa_factors",
    "account_preferences",
    "accounts",
    "admission_link_state",
    "admission_links",
    "admission_mail",
    "admission_requests",
    "audit_events",
    "circle_memberships",
    "command_results",
    "credential_attestations",
    "domain_events",
    "entities",
    "guest_resource_grants",
    "iam_mail_scope_leases",
    "invitation_delivery",
    "invitations",
    "members",
    "occupancies",
    "organization_deletion_blobs",
    "organization_deletion_jobs",
    "organization_deletion_progress",
    "organization_effects",
    "organization_lifecycle",
    "organization_runtime_identity",
    "organization_runtime_mode",
    "organizations",
    "outbox",
    "password_recovery",
    "provisioned_enrollment_flows",
    "provisioned_enrollment_mail",
    "provisioned_enrollment_reauth",
    "provisioned_enrollments",
    "sessions",
  ],
} as const;

/** Initial scope classification only: not deletion predicates or readiness. */
export const foundationDisposition = {
  accountGlobal: ["accounts","account_preferences","account_events","password_recovery","account_mail","account_mfa_factors","account_email_change_requests","account_email_change_mail","account_email_change_rate_budgets","account_media","account_media_gc"],
  mixedProvenance: ["sessions","account_commands","iam_mail_scope_leases"],
  retainedControl: ["organizations","organization_lifecycle","organization_deletion_jobs","organization_deletion_progress","organization_deletion_blobs","organization_effects","organization_runtime_identity","organization_runtime_mode"],
  tenantCandidate: ["members","entities","circle_memberships","occupancies","audit_events","domain_events","outbox","command_results","invitations","invitation_delivery","provisioned_enrollments","provisioned_enrollment_mail","provisioned_enrollment_reauth","provisioned_enrollment_flows","guest_resource_grants","credential_attestations","admission_link_state","admission_links","admission_requests","admission_mail"],
} as const;

export function assertFoundationDispositionCoverage(): void {
  const items = Object.values(foundationDisposition).flat() as readonly string[];
  const expected: readonly string[] = deletionTableInventory.foundation_review;
  if (new Set(items).size !== items.length || items.length !== expected.length || expected.some(name => !items.includes(name)))
    throw Error("DELETION_FOUNDATION_CLASSIFICATION_MISMATCH");
}

export function assertDeletionTableInventory(actual: readonly string[]): void {
  const expected = Object.values(deletionTableInventory).flat() as readonly string[];
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  if (expectedSet.size !== expected.length || actualSet.size !== actual.length)
    throw Error("DELETION_TABLE_INVENTORY_DUPLICATE");
  const unknown = [...actualSet].filter((name) => !expectedSet.has(name)).sort();
  const missing = [...expectedSet].filter((name) => !actualSet.has(name)).sort();
  if (unknown.length || missing.length)
    throw Error(`DELETION_TABLE_INVENTORY_MISMATCH unknown=${unknown.join(",")} missing=${missing.join(",")}`);
}

/** Caller must use the same maintenance transaction and search path as the batch. */
export async function assertLiveDeletionTableInventory(c: import("pg").PoolClient): Promise<void> {
  const { rows } = await c.query<{ schema: string; name: string }>(`
    SELECT n.nspname AS schema, c.relname AS name FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname <> 'information_schema' AND left(n.nspname, 3) <> 'pg_'
      AND c.relkind IN ('r','p')
    ORDER BY n.nspname, c.relname
  `);
  assertDeletionTableInventory(rows.map((row) => row.schema === "public" ? row.name : `${row.schema}.${row.name}`));
}
