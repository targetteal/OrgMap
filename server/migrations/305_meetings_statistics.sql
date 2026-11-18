-- Observation starts when this migration is applied. No historical activity is inferred.
CREATE TABLE meeting_statistics_observation (
 organization_id uuid PRIMARY KEY REFERENCES organizations(id),
 covered_from timestamptz NOT NULL DEFAULT clock_timestamp(),
 source text NOT NULL DEFAULT 'NATIVE_OBSERVATION' CHECK (source='NATIVE_OBSERVATION')
);
INSERT INTO meeting_statistics_observation(organization_id) SELECT id FROM organizations;
CREATE FUNCTION meeting_statistics_observe_organization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO meeting_statistics_observation(organization_id) VALUES(NEW.id);
 RETURN NEW;
END $$;
CREATE TRIGGER meeting_statistics_new_organization AFTER INSERT ON organizations
 FOR EACH ROW EXECUTE FUNCTION meeting_statistics_observe_organization();

-- Independent of mutable report publication, restore and collaboration epochs.
CREATE TABLE meeting_first_close_snapshots (
 organization_id uuid NOT NULL,
 meeting_id uuid NOT NULL,
 report_id uuid NOT NULL,
 report_version int NOT NULL,
 report_epoch int NOT NULL,
 occurrence_version int NOT NULL,
 started_at timestamptz,
 first_closed_at timestamptz NOT NULL,
 captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
 PRIMARY KEY(organization_id,meeting_id),
 FOREIGN KEY(organization_id,meeting_id) REFERENCES meeting_occurrences(organization_id,id),
 FOREIGN KEY(organization_id,report_id,report_version) REFERENCES meeting_report_versions(organization_id,report_id,version)
);
CREATE FUNCTION meeting_statistics_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Meeting statistics first-close snapshots and observation baselines are immutable'; END $$;
CREATE TRIGGER meeting_first_close_immutable BEFORE UPDATE OR DELETE ON meeting_first_close_snapshots
 FOR EACH ROW EXECUTE FUNCTION meeting_statistics_immutable();
CREATE TRIGGER meeting_statistics_observation_immutable BEFORE UPDATE OR DELETE ON meeting_statistics_observation
 FOR EACH ROW EXECUTE FUNCTION meeting_statistics_immutable();
ALTER TABLE meeting_statistics_observation ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_first_close_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON meeting_statistics_observation
 USING (organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid)
 WITH CHECK (organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid);
CREATE POLICY tenant ON meeting_first_close_snapshots
 USING (organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid)
 WITH CHECK (organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid);
GRANT SELECT,INSERT ON meeting_statistics_observation,meeting_first_close_snapshots TO orgmap_app;
