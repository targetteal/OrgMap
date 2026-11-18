ALTER TABLE meeting_documents ADD COLUMN protocol text NOT NULL DEFAULT 'orgmap-ytext-v1' CHECK(protocol IN ('orgmap-ytext-v1','orgmap-richtext-yjs-v1'));
ALTER TABLE meeting_documents ADD COLUMN schema_version int NOT NULL DEFAULT 1 CHECK(schema_version=1);
ALTER TABLE meeting_tickets ADD COLUMN protocol text NOT NULL DEFAULT 'orgmap-ytext-v1' CHECK(protocol IN ('orgmap-ytext-v1','orgmap-richtext-yjs-v1'));
ALTER TABLE meeting_tickets ADD COLUMN schema_version int NOT NULL DEFAULT 1 CHECK(schema_version=1);
CREATE TABLE meeting_document_epochs (
 organization_id uuid NOT NULL,meeting_id uuid NOT NULL,section_id text NOT NULL,epoch int NOT NULL,
 protocol text NOT NULL CHECK(protocol IN ('orgmap-ytext-v1','orgmap-richtext-yjs-v1')),schema_version int NOT NULL CHECK(schema_version=1),
 sequence int NOT NULL,snapshot bytea NOT NULL,sha256 text NOT NULL CHECK(length(sha256)=64),
 actor_id uuid NOT NULL,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,meeting_id,section_id,epoch),
 FOREIGN KEY(organization_id,meeting_id,section_id) REFERENCES meeting_documents(organization_id,meeting_id,section_id),
 FOREIGN KEY(organization_id,actor_id) REFERENCES members(organization_id,id));
ALTER TABLE meeting_document_epochs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON meeting_document_epochs USING (organization_id = nullif(current_setting('orgmap.organization_id',true),'')::uuid) WITH CHECK (organization_id = nullif(current_setting('orgmap.organization_id',true),'')::uuid);
GRANT SELECT,INSERT ON meeting_document_epochs TO orgmap_app;
