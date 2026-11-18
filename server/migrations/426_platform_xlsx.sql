ALTER TABLE platform_jobs DROP CONSTRAINT platform_jobs_format_check;
ALTER TABLE platform_jobs ADD CONSTRAINT platform_jobs_format_check CHECK(format IN ('JSON','CSV','XLSX'));
