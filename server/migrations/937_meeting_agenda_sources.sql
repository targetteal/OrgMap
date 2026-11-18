-- Classify only server-resolved references. Existing legacy entries remain unknown.
ALTER TABLE meeting_agenda_items DROP CONSTRAINT meeting_agenda_items_source_kind_check;
ALTER TABLE meeting_agenda_items ADD CONSTRAINT meeting_agenda_items_source_kind_check
 CHECK (source_kind IN ('MANUAL','TENSION','LEGACY_UNKNOWN','PROPOSAL','PROJECT','TASK','GOAL'));
ALTER TABLE meeting_agenda_items ADD CONSTRAINT meeting_agenda_items_linked_source_required
 CHECK (source_kind NOT IN ('TENSION','PROPOSAL','PROJECT','TASK','GOAL') OR source_id IS NOT NULL);
