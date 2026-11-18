ALTER TABLE platform_files ADD COLUMN upload_policy_revision integer;
ALTER TABLE platform_files ADD COLUMN classifier_version text;
ALTER TABLE platform_files ADD COLUMN classified_kind text;
ALTER TABLE platform_files ADD COLUMN validation_level text;
ALTER TABLE platform_files ADD CONSTRAINT platform_file_policy_revision CHECK(upload_policy_revision IS NULL OR upload_policy_revision>=0);
ALTER TABLE platform_files ADD CONSTRAINT platform_file_kind CHECK(classified_kind IS NULL OR classified_kind IN('PNG','PDF','JSON','UTF8_TEXT','OPAQUE'));
ALTER TABLE platform_files ADD CONSTRAINT platform_file_validation CHECK(validation_level IS NULL OR validation_level IN('OPAQUE','SIGNATURE','STRUCTURAL','TEXT'));
