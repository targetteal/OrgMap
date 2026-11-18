CREATE TABLE meeting_o2_circle_templates (
 organization_id uuid NOT NULL REFERENCES organizations(id), circle_id uuid NOT NULL,
 sections jsonb NOT NULL, review_items jsonb NOT NULL DEFAULT '[]', version int NOT NULL DEFAULT 1,
 PRIMARY KEY(organization_id,circle_id), FOREIGN KEY(organization_id,circle_id) REFERENCES entities(organization_id,id)
);
CREATE TABLE meeting_o2_reviews (
 organization_id uuid NOT NULL REFERENCES organizations(id),meeting_id uuid NOT NULL,
 items jsonb NOT NULL DEFAULT '[]',version int NOT NULL DEFAULT 1,
 PRIMARY KEY(organization_id,meeting_id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['meeting_o2_circle_templates','meeting_o2_reviews'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format($policy$CREATE POLICY tenant ON %I USING (organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid) WITH CHECK (organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid)$policy$,t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO orgmap_app',t);
 END LOOP;
END $$;
