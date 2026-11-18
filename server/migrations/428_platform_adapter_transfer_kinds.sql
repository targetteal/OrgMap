ALTER TABLE platform_jobs DROP CONSTRAINT platform_jobs_export_kind_check;
ALTER TABLE platform_jobs ADD CONSTRAINT platform_jobs_export_kind_check CHECK(export_kind ~ '^[A-Za-z][A-Za-z0-9_-]{0,49}$');
