CREATE INDEX meeting_updates_actor_time ON meeting_updates(organization_id,actor_id,created_at DESC);
CREATE INDEX meeting_occurrences_calendar ON meeting_occurrences(organization_id,start_at,id);
CREATE INDEX meeting_participants_member ON meeting_participants(organization_id,member_id,meeting_id);
