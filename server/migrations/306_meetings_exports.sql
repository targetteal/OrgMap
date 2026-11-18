CREATE TABLE meeting_export_selections (
 organization_id uuid NOT NULL REFERENCES organizations(id), id uuid NOT NULL,
 owner_id uuid NOT NULL, account_id uuid NOT NULL REFERENCES accounts(id), command_key text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('MEETING_ROWS','MEETING_REPORT_PDF','MEETING_REPORT_BUNDLE','MEETING_MONTHLY_STATISTICS')),
 format text NOT NULL CHECK(format IN ('XLSX','PDF','ZIP')), include_private boolean NOT NULL,
 report_source text NOT NULL CHECK(report_source IN ('PUBLISHED','CURRENT_AUTHORIZED')),
 filters jsonb NOT NULL, authorized_ids uuid[] NOT NULL, report_refs jsonb NOT NULL,
 timezone text NOT NULL, as_of timestamptz NOT NULL, frozen_payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,id), UNIQUE(organization_id,account_id,command_key),
 FOREIGN KEY(organization_id,owner_id) REFERENCES members(organization_id,id),
 CHECK((kind IN ('MEETING_ROWS','MEETING_MONTHLY_STATISTICS') AND format='XLSX') OR (kind='MEETING_REPORT_PDF' AND format='PDF') OR (kind='MEETING_REPORT_BUNDLE' AND format='ZIP'))
);
ALTER TABLE meeting_export_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_export_selections FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON meeting_export_selections
 USING(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid)
 WITH CHECK(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid);
GRANT SELECT,INSERT ON meeting_export_selections TO orgmap_app;
