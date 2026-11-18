-- 050 precedes meeting tables: references are scoped UUIDs; commands verify destinations.
CREATE TABLE meeting_o2_panels (
 organization_id uuid NOT NULL REFERENCES organizations(id), meeting_id uuid NOT NULL,
 focus_id uuid, notes text NOT NULL DEFAULT '', version int NOT NULL DEFAULT 1,
 PRIMARY KEY(organization_id,meeting_id)
);
CREATE TABLE meeting_o2_processes (
 organization_id uuid NOT NULL REFERENCES organizations(id), meeting_id uuid NOT NULL, proposal_id uuid NOT NULL,
 revision int NOT NULL, stage text NOT NULL DEFAULT 'PRESENT' CHECK(stage IN ('PRESENT','REACT','ADJUST','OBJECT','INTEGRATE','APPROVED')),
 objections jsonb NOT NULL DEFAULT '[]', version int NOT NULL DEFAULT 1,
 PRIMARY KEY(organization_id,meeting_id,proposal_id)
);
CREATE TABLE meeting_o2_treatments (
 organization_id uuid NOT NULL REFERENCES organizations(id), meeting_id uuid NOT NULL, agenda_id uuid NOT NULL,
 mode text NOT NULL CHECK(mode IN ('SYNC','ADAPT')), description text NOT NULL DEFAULT '',
 PRIMARY KEY(organization_id,meeting_id,agenda_id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['meeting_o2_panels','meeting_o2_processes','meeting_o2_treatments'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format($policy$CREATE POLICY tenant ON %I USING (organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid) WITH CHECK (organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid)$policy$,t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO orgmap_app',t);
 END LOOP;
END $$;
