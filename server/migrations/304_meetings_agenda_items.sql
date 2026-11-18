-- An intention survives its placements. Legacy authorship is deliberately unknown.
CREATE TABLE meeting_agenda_items (
 organization_id uuid NOT NULL REFERENCES organizations(id), id uuid NOT NULL,
 title text NOT NULL, description_rich jsonb NOT NULL, description text NOT NULL DEFAULT '',
 state text NOT NULL CHECK(state IN ('PARKED','ASSIGNED','NEEDS_RESCHEDULE','COMPLETED','ARCHIVED')),
 creator_id uuid, owner_id uuid, circle_id uuid, expected_duration_minutes int CHECK(expected_duration_minutes BETWEEN 0 AND 1440),
 source_kind text NOT NULL CHECK(source_kind IN ('MANUAL','TENSION','LEGACY_UNKNOWN')), source_id uuid,
 identity_coverage text NOT NULL CHECK(identity_coverage IN ('NATIVE','LEGACY_PLACEMENT')),
 creator_coverage text NOT NULL CHECK(creator_coverage IN ('KNOWN','UNKNOWN')),
 created_at timestamptz, version int NOT NULL DEFAULT 1,
 current_placement_id uuid, last_placement_id uuid,
 adopted_by uuid, adopted_at timestamptz, adoption_reason text, archive_reason text, withdrawal_reason text,
 PRIMARY KEY(organization_id,id),
 FOREIGN KEY(organization_id,creator_id) REFERENCES members(organization_id,id),
 FOREIGN KEY(organization_id,owner_id) REFERENCES members(organization_id,id),
 FOREIGN KEY(organization_id,adopted_by) REFERENCES members(organization_id,id),
 FOREIGN KEY(organization_id,circle_id) REFERENCES entities(organization_id,id),
 FOREIGN KEY(organization_id,current_placement_id) REFERENCES meeting_agenda(organization_id,id),
 FOREIGN KEY(organization_id,last_placement_id) REFERENCES meeting_agenda(organization_id,id)
);
ALTER TABLE meeting_agenda ADD COLUMN agenda_item_id uuid;
ALTER TABLE meeting_agenda ADD COLUMN is_active boolean NOT NULL DEFAULT false;
ALTER TABLE meeting_agenda ADD COLUMN description_rich jsonb;
ALTER TABLE meeting_agenda ALTER COLUMN duration_minutes DROP NOT NULL;
ALTER TABLE meeting_agenda DROP CONSTRAINT meeting_agenda_status_check;
ALTER TABLE meeting_agenda ADD CONSTRAINT meeting_agenda_status_check CHECK(status IN ('OPEN','COMPLETED','TRANSFERRED','WITHDRAWN'));
INSERT INTO meeting_agenda_items(organization_id,id,title,description_rich,state,circle_id,expected_duration_minutes,
 source_kind,source_id,identity_coverage,creator_coverage,current_placement_id,last_placement_id)
SELECT a.organization_id,a.id,a.title,'{"format":"orgmap-richtext","version":1,"doc":{"type":"doc","content":[{"type":"paragraph"}]}}'::jsonb,
 CASE WHEN a.status='COMPLETED' THEN 'COMPLETED' WHEN a.status='TRANSFERRED' THEN 'ARCHIVED'
      WHEN m.state IN ('CLOSED','CANCELLED') THEN 'NEEDS_RESCHEDULE' ELSE 'ASSIGNED' END,
 m.circle_id,a.duration_minutes,'LEGACY_UNKNOWN',a.source_id,'LEGACY_PLACEMENT','UNKNOWN',
 CASE WHEN a.status='OPEN' AND m.state IN ('SCHEDULED','RUNNING') THEN a.id ELSE NULL END,a.id
FROM meeting_agenda a JOIN meeting_occurrences m ON m.organization_id=a.organization_id AND m.id=a.meeting_id;
UPDATE meeting_agenda a SET agenda_item_id=a.id,is_active=(a.status='OPEN' AND m.state IN ('SCHEDULED','RUNNING'))
FROM meeting_occurrences m WHERE m.organization_id=a.organization_id AND m.id=a.meeting_id;
ALTER TABLE meeting_agenda ALTER COLUMN agenda_item_id SET NOT NULL;
ALTER TABLE meeting_agenda ADD FOREIGN KEY(organization_id,agenda_item_id) REFERENCES meeting_agenda_items(organization_id,id);
CREATE UNIQUE INDEX meeting_agenda_one_active_item ON meeting_agenda(organization_id,agenda_item_id) WHERE is_active;
CREATE INDEX meeting_agenda_items_owner ON meeting_agenda_items(organization_id,owner_id,state,id);
ALTER TABLE meeting_agenda_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON meeting_agenda_items USING (organization_id = nullif(current_setting('orgmap.organization_id',true),'')::uuid)
 WITH CHECK (organization_id = nullif(current_setting('orgmap.organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON meeting_agenda_items TO orgmap_app;
