ALTER TABLE meeting_participants ADD COLUMN participation_role text NOT NULL DEFAULT 'REQUIRED' CHECK(participation_role IN ('REQUIRED','OPTIONAL'));
ALTER TABLE meeting_participants ADD COLUMN origin text NOT NULL DEFAULT 'DIRECT' CHECK(origin IN ('DIRECT','CIRCLE','ROLE','UMBRELLA'));
CREATE TABLE meeting_report_access (
 organization_id uuid NOT NULL,report_id uuid NOT NULL,member_id uuid NOT NULL,
 can_read boolean NOT NULL,can_edit boolean NOT NULL,
 PRIMARY KEY(organization_id,report_id,member_id),
 FOREIGN KEY(organization_id,report_id) REFERENCES meeting_reports(organization_id,id),
 FOREIGN KEY(organization_id,member_id) REFERENCES members(organization_id,id),
 CHECK(can_read OR NOT can_edit));
ALTER TABLE meeting_report_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON meeting_report_access USING (organization_id = nullif(current_setting('orgmap.organization_id',true),'')::uuid) WITH CHECK (organization_id = nullif(current_setting('orgmap.organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON meeting_report_access TO orgmap_app;
