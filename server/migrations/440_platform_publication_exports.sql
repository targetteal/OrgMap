-- Add the native publication package without changing applied report/export SQL.
ALTER TABLE platform_jobs DROP CONSTRAINT platform_jobs_report_format_check;
ALTER TABLE platform_jobs ADD CONSTRAINT platform_jobs_report_format_check CHECK (
  (format IN ('JSON','CSV','XLSX')) OR
  (kind='EXPORT' AND resource_type='meeting-export' AND
   ((format='PDF' AND export_kind='MEETING_REPORT_PDF') OR
    (format='ZIP' AND export_kind='MEETING_REPORT_BUNDLE'))) OR
  (kind='EXPORT' AND resource_type='publication-export' AND format='ZIP' AND
   export_kind='PUBLICATIONS' AND NOT include_private)
);
