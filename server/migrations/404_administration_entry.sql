CREATE TABLE administration_entry_acknowledgements (
 organization_id uuid NOT NULL,
 member_id uuid NOT NULL,
 settings_revision integer NOT NULL CHECK(settings_revision >= 0),
 acknowledged_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,member_id),
 FOREIGN KEY(organization_id,member_id) REFERENCES members(organization_id,id)
);
ALTER TABLE administration_entry_acknowledgements ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON administration_entry_acknowledgements USING (organization_id::text=current_setting('orgmap.organization_id',true));
GRANT SELECT,INSERT ON administration_entry_acknowledgements TO orgmap_app;
