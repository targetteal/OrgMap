-- Account status is independent of tenant access. The app cannot read request
-- keys, request hashes, lease authority or internal manifests through this table.
REVOKE SELECT ON organization_deletion_jobs FROM orgmap_app;
GRANT SELECT (id,organization_id,initiator_account_id,state,phase,accepted_at,completed_at,error_code,completion_receipt)
 ON organization_deletion_jobs TO orgmap_app;
DROP POLICY deletion_job_own_read ON organization_deletion_jobs;
CREATE POLICY deletion_job_own_read ON organization_deletion_jobs FOR SELECT TO orgmap_app USING (
 initiator_account_id=nullif(current_setting('orgmap.account_id',true),'')::uuid
);
