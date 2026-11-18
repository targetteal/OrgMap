ALTER TABLE goals DROP CONSTRAINT goals_lifecycle_check;
ALTER TABLE goals ADD CONSTRAINT goals_lifecycle_check CHECK(lifecycle IN ('DRAFT','ACTIVE','CLOSED','ARCHIVED'));
