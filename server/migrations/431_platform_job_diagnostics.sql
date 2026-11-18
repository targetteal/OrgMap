ALTER TABLE platform_jobs ADD COLUMN request_id uuid;
CREATE TABLE platform_job_attempts(organization_id uuid NOT NULL,id uuid NOT NULL,job_id uuid NOT NULL,trace_id uuid NOT NULL,request_id uuid,attempt integer NOT NULL CHECK(attempt BETWEEN 1 AND 5),stage text NOT NULL,error_code text NOT NULL,retryable boolean NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(organization_id,id),FOREIGN KEY(organization_id,job_id) REFERENCES platform_jobs(organization_id,id));
ALTER TABLE platform_job_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON platform_job_attempts USING(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid);
GRANT SELECT,INSERT ON platform_job_attempts TO orgmap_app;
