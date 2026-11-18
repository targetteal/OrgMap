ALTER TABLE platform_jobs ADD COLUMN include_private boolean NOT NULL DEFAULT false;
ALTER TABLE platform_jobs ADD CONSTRAINT platform_private_export_only CHECK(NOT include_private OR kind='EXPORT');
