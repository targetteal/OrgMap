-- Existing history is unknown unless a successful publish command receipt proves it.
ALTER TABLE meeting_report_versions
  ADD COLUMN publication_status text NOT NULL DEFAULT 'UNVERIFIED'
  CHECK (publication_status IN ('PUBLISHED', 'NOT_PUBLISHED', 'UNVERIFIED'));

UPDATE meeting_report_versions v
SET publication_status = 'PUBLISHED'
FROM meeting_reports r
WHERE r.organization_id = v.organization_id AND r.id = v.report_id
  AND EXISTS (
    SELECT 1 FROM command_results c
    WHERE c.organization_id = v.organization_id
      AND (c.operation = 'cookie:/api/v1/organizations/' || v.organization_id::text || '/meetings/' || r.meeting_id::text || '/report/actions/publish'
        OR (c.operation ~ '^credential:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:'
          AND substring(c.operation FROM 49) = '/api/v1/organizations/' || v.organization_id::text || '/meetings/' || r.meeting_id::text || '/report/actions/publish'))
      AND c.result #>> '{meeting,id}' = r.meeting_id::text
      AND c.result #>> '{report,id}' = v.report_id::text
      AND c.result #>> '{report,meetingId}' = r.meeting_id::text
      AND c.result #>> '{report,version}' = v.version::text
      AND c.result #>> '{report,epoch}' = v.epoch::text
      AND c.result #>> '{report,state}' = 'PUBLISHED'
  );

ALTER TABLE meeting_report_versions ALTER COLUMN publication_status SET DEFAULT 'NOT_PUBLISHED';
