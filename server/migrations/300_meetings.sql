CREATE TABLE meeting_templates (
 organization_id uuid NOT NULL REFERENCES organizations(id), id uuid NOT NULL, name text NOT NULL,
 sections jsonb NOT NULL CHECK(jsonb_array_length(sections)>0), method text NOT NULL CHECK(method IN ('CUSTOM','HOLACRACY')),
 version int NOT NULL DEFAULT 1, PRIMARY KEY(organization_id,id));
CREATE TABLE meeting_series (
 organization_id uuid NOT NULL REFERENCES organizations(id),id uuid NOT NULL,title text NOT NULL,circle_id uuid NOT NULL,
 local_start text NOT NULL,time_zone text NOT NULL,duration_minutes int NOT NULL CHECK(duration_minutes BETWEEN 1 AND 10080),
 recurrence jsonb NOT NULL,template_snapshot jsonb NOT NULL,participants jsonb NOT NULL,policy jsonb NOT NULL,
 version int NOT NULL DEFAULT 1,split_from uuid,PRIMARY KEY(organization_id,id),
 FOREIGN KEY(organization_id,circle_id) REFERENCES entities(organization_id,id),
 FOREIGN KEY(organization_id,split_from) REFERENCES meeting_series(organization_id,id));
CREATE TABLE meeting_occurrences (
 organization_id uuid NOT NULL,id uuid NOT NULL,series_id uuid NOT NULL,sequence int NOT NULL,start_at timestamptz NOT NULL,
 local_start text NOT NULL,time_zone text NOT NULL,duration_minutes int NOT NULL,title text NOT NULL,circle_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'SCHEDULED' CHECK(state IN ('SCHEDULED','RUNNING','CLOSED','CANCELLED')),
 sections jsonb NOT NULL,method text NOT NULL,policy jsonb NOT NULL,notetaker_id uuid,facilitator_id uuid NOT NULL,
 current_step text,version int NOT NULL DEFAULT 1,started_at timestamptz,closed_at timestamptz,
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,series_id,sequence),
 FOREIGN KEY(organization_id,series_id) REFERENCES meeting_series(organization_id,id),
 FOREIGN KEY(organization_id,circle_id) REFERENCES entities(organization_id,id),
 FOREIGN KEY(organization_id,facilitator_id) REFERENCES members(organization_id,id),
 FOREIGN KEY(organization_id,notetaker_id) REFERENCES members(organization_id,id));
CREATE TABLE meeting_participants (
 organization_id uuid NOT NULL,meeting_id uuid NOT NULL,member_id uuid NOT NULL,
 access text NOT NULL CHECK(access IN ('EDIT','READ','DENY')),
 can_manage boolean NOT NULL DEFAULT false,can_publish boolean NOT NULL DEFAULT false,can_restore boolean NOT NULL DEFAULT false,
 attendance text NOT NULL DEFAULT 'INVITED' CHECK(attendance IN ('INVITED','PRESENT','ABSENT')),
 PRIMARY KEY(organization_id,meeting_id,member_id),
 FOREIGN KEY(organization_id,meeting_id) REFERENCES meeting_occurrences(organization_id,id),
 FOREIGN KEY(organization_id,member_id) REFERENCES members(organization_id,id));
CREATE TABLE meeting_agenda (
 organization_id uuid NOT NULL,id uuid NOT NULL,meeting_id uuid NOT NULL,title text NOT NULL,presenter_id uuid NOT NULL,
 duration_minutes int NOT NULL CHECK(duration_minutes BETWEEN 0 AND 1440),status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','COMPLETED','TRANSFERRED')),
 skipped boolean NOT NULL DEFAULT false,source_id uuid,transferred_from uuid,version int NOT NULL DEFAULT 1,
 PRIMARY KEY(organization_id,id),FOREIGN KEY(organization_id,meeting_id) REFERENCES meeting_occurrences(organization_id,id),
 FOREIGN KEY(organization_id,presenter_id) REFERENCES members(organization_id,id),
 FOREIGN KEY(organization_id,transferred_from) REFERENCES meeting_agenda(organization_id,id));
CREATE TABLE meeting_actions (
 organization_id uuid NOT NULL,id uuid NOT NULL,meeting_id uuid NOT NULL,agenda_id uuid,title text NOT NULL,
 assignee_id uuid NOT NULL,state text NOT NULL DEFAULT 'OPEN' CHECK(state IN ('OPEN','DONE')),version int NOT NULL DEFAULT 1,
 PRIMARY KEY(organization_id,id),FOREIGN KEY(organization_id,meeting_id) REFERENCES meeting_occurrences(organization_id,id),
 FOREIGN KEY(organization_id,agenda_id) REFERENCES meeting_agenda(organization_id,id),
 FOREIGN KEY(organization_id,assignee_id) REFERENCES members(organization_id,id));
CREATE TABLE meeting_reports (
 organization_id uuid NOT NULL,id uuid NOT NULL,meeting_id uuid NOT NULL,version int NOT NULL DEFAULT 1,
 state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','PUBLISHED')),first_published_at timestamptz,
 window_days int NOT NULL CHECK(window_days BETWEEN 0 AND 3650),epoch int NOT NULL DEFAULT 1,
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,meeting_id),
 FOREIGN KEY(organization_id,meeting_id) REFERENCES meeting_occurrences(organization_id,id));
CREATE TABLE meeting_documents (
 organization_id uuid NOT NULL,meeting_id uuid NOT NULL,section_id text NOT NULL,epoch int NOT NULL DEFAULT 1,
 sequence int NOT NULL DEFAULT 0,snapshot bytea NOT NULL,
 PRIMARY KEY(organization_id,meeting_id,section_id),
 FOREIGN KEY(organization_id,meeting_id) REFERENCES meeting_occurrences(organization_id,id));
CREATE TABLE meeting_updates (
 organization_id uuid NOT NULL,meeting_id uuid NOT NULL,section_id text NOT NULL,epoch int NOT NULL,update_id uuid NOT NULL,
 sequence int NOT NULL,hash text NOT NULL,actor_id uuid NOT NULL,content bytea NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,meeting_id,section_id,epoch,update_id),UNIQUE(organization_id,meeting_id,section_id,epoch,sequence),
 FOREIGN KEY(organization_id,meeting_id,section_id) REFERENCES meeting_documents(organization_id,meeting_id,section_id),
 FOREIGN KEY(organization_id,actor_id) REFERENCES members(organization_id,id));
CREATE TABLE meeting_report_versions (
 organization_id uuid NOT NULL,report_id uuid NOT NULL,version int NOT NULL,epoch int NOT NULL,snapshot jsonb NOT NULL,
 actor_id uuid NOT NULL,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,report_id,version),FOREIGN KEY(organization_id,report_id) REFERENCES meeting_reports(organization_id,id),
 FOREIGN KEY(organization_id,actor_id) REFERENCES members(organization_id,id));
CREATE TABLE meeting_tickets (
 organization_id uuid NOT NULL,token_hash text NOT NULL,meeting_id uuid NOT NULL,section_id text NOT NULL,epoch int NOT NULL,
 member_id uuid NOT NULL,expires_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,token_hash),FOREIGN KEY(organization_id,meeting_id,section_id) REFERENCES meeting_documents(organization_id,meeting_id,section_id),
 FOREIGN KEY(organization_id,member_id) REFERENCES members(organization_id,id));
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['meeting_templates','meeting_series','meeting_occurrences','meeting_participants','meeting_agenda','meeting_actions','meeting_reports','meeting_documents','meeting_updates','meeting_report_versions','meeting_tickets'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant ON %I USING (organization_id = nullif(current_setting(''orgmap.organization_id'',true),'''')::uuid) WITH CHECK (organization_id = nullif(current_setting(''orgmap.organization_id'',true),'''')::uuid)',t);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO orgmap_app',t);
END LOOP; END $$;
