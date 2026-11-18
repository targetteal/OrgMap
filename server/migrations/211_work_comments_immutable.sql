-- Existing historical rows stay in place. All new comments use the canonical Platform service.
REVOKE INSERT,UPDATE,DELETE ON work_comments FROM orgmap_app;
GRANT SELECT ON work_comments TO orgmap_app;
CREATE INDEX work_comments_task_cursor ON work_comments(organization_id,task_id,created_at,id);
