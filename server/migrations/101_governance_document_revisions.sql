-- Resource concurrency version is distinct from immutable content revision.
ALTER TABLE gov_documents ADD COLUMN draft_version int NOT NULL DEFAULT 1;
UPDATE gov_documents d SET draft_version=(SELECT max(number) FROM gov_document_versions v WHERE v.organization_id=d.organization_id AND v.document_id=d.id);
ALTER TABLE gov_documents ADD FOREIGN KEY(organization_id,id,draft_version) REFERENCES gov_document_versions(organization_id,document_id,number) DEFERRABLE INITIALLY DEFERRED;
