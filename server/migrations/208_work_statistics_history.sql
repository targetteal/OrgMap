-- Unknown legacy creation dates remain NULL; observation is not creation.
ALTER TABLE work_tasks ADD COLUMN created_at timestamptz;
ALTER TABLE work_tasks ALTER COLUMN created_at SET DEFAULT clock_timestamp();
CREATE TABLE work_task_observations (
 organization_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),sequence bigint GENERATED ALWAYS AS IDENTITY,task_id uuid NOT NULL,
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 kind text NOT NULL CHECK(kind IN ('BASELINE','CREATED','CHANGED')),
 status text NOT NULL CHECK(status IN ('TODO','IN_PROGRESS','BLOCKED','DONE')),
 archived boolean NOT NULL,actor_member_id uuid,
 PRIMARY KEY(organization_id,id),
 FOREIGN KEY(organization_id,task_id) REFERENCES work_tasks(organization_id,id),
 FOREIGN KEY(organization_id,actor_member_id) REFERENCES members(organization_id,id)
);
CREATE INDEX work_observations_task_time ON work_task_observations(organization_id,task_id,observed_at DESC,sequence DESC);
DO $$ DECLARE tenant record; previous_scope text := current_setting('orgmap.organization_id',true); BEGIN
 FOR tenant IN SELECT id FROM organizations LOOP
  PERFORM set_config('orgmap.organization_id',tenant.id::text,true);
  INSERT INTO work_task_observations(organization_id,task_id,kind,status,archived)
   SELECT organization_id,id,'BASELINE',status,archived FROM work_tasks WHERE organization_id=tenant.id;
 END LOOP;
 PERFORM set_config('orgmap.organization_id',coalesce(previous_scope,''),true);
END $$;
ALTER TABLE work_task_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_task_observations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON work_task_observations USING(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid);
GRANT SELECT,INSERT ON work_task_observations TO orgmap_app;
GRANT USAGE,SELECT ON SEQUENCE work_task_observations_sequence_seq TO orgmap_app;
CREATE FUNCTION work_observe_task() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO work_task_observations(organization_id,task_id,kind,status,archived,actor_member_id)
 VALUES(NEW.organization_id,NEW.id,CASE WHEN TG_OP='INSERT' THEN 'CREATED' ELSE 'CHANGED' END,NEW.status,NEW.archived,nullif(current_setting('orgmap.work_actor_member_id',true),'')::uuid);
 RETURN NEW;
END $$;
CREATE TRIGGER work_task_observation AFTER INSERT OR UPDATE ON work_tasks FOR EACH ROW EXECUTE FUNCTION work_observe_task();
