ALTER TABLE interop_connections DROP CONSTRAINT interop_connections_provider_check;
ALTER TABLE interop_connections ADD CONSTRAINT interop_connections_provider_check CHECK(provider IN ('GOOGLE','OUTLOOK','SLACK','OIDC','SAML','LOCAL','TRELLO'));
CREATE TABLE interop_provider_grants (
 organization_id uuid NOT NULL, id uuid NOT NULL, owner_member_id uuid NOT NULL,
 provider text NOT NULL CHECK(provider='TRELLO'),
 state text NOT NULL DEFAULT 'PENDING_CONSENT' CHECK(state IN ('PENDING_CONSENT','AUTHORIZED','REAUTHORIZATION_REQUIRED','REVOKED')),
 scopes text[] NOT NULL DEFAULT '{}', access_encrypted text, refresh_encrypted text, expires_at timestamptz,
 authorization_revision integer NOT NULL DEFAULT 1, version integer NOT NULL DEFAULT 1,
 refresh_lease uuid, refresh_lease_until timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,id),
 FOREIGN KEY(organization_id,id) REFERENCES interop_connections(organization_id,id),
 FOREIGN KEY(organization_id,owner_member_id) REFERENCES members(organization_id,id)
);
CREATE TABLE interop_provider_oauth_flows (
 organization_id uuid NOT NULL, state_hash text NOT NULL, grant_id uuid NOT NULL, grant_revision integer NOT NULL,
 verifier_encrypted text NOT NULL, expires_at timestamptz NOT NULL, consumed_at timestamptz,
 PRIMARY KEY(organization_id,state_hash),
 FOREIGN KEY(organization_id,grant_id) REFERENCES interop_provider_grants(organization_id,id)
);
CREATE TABLE interop_project_output_configs (
 organization_id uuid NOT NULL, id uuid NOT NULL, project_id uuid NOT NULL, provider text NOT NULL CHECK(provider='TRELLO'),
 connection_id uuid NOT NULL, owner_member_id uuid NOT NULL, board_id text NOT NULL, list_id text NOT NULL,
 enabled boolean NOT NULL, version integer NOT NULL DEFAULT 1, activated_at timestamptz,
 PRIMARY KEY(organization_id,id), UNIQUE(organization_id,project_id),
 FOREIGN KEY(organization_id,connection_id) REFERENCES interop_provider_grants(organization_id,id),
 FOREIGN KEY(organization_id,owner_member_id) REFERENCES members(organization_id,id)
);
CREATE TABLE interop_project_output_deliveries (
 organization_id uuid NOT NULL, id uuid NOT NULL, config_id uuid NOT NULL, config_revision integer NOT NULL,
 project_id uuid NOT NULL, task_id uuid NOT NULL, task_version integer NOT NULL,
 kind text NOT NULL CHECK(kind='WORK_TASK_CREATED'), owner_member_id uuid NOT NULL,
 title text NOT NULL, description_plain text NOT NULL, occurred_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','PROCESSING','CONFIRMED','RETRY','FAILED','OUTCOME_UNKNOWN','CANCELLED')),
 marker uuid NOT NULL UNIQUE, remote_id text, remote_effect_possible boolean NOT NULL DEFAULT false,
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
 lease_token uuid, lease_until timestamptz, io_started_at timestamptz, last_error text,
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,id), UNIQUE(organization_id,config_id,task_id,kind),
 FOREIGN KEY(organization_id,config_id) REFERENCES interop_project_output_configs(organization_id,id),
 FOREIGN KEY(organization_id,owner_member_id) REFERENCES members(organization_id,id)
);
CREATE INDEX interop_project_output_due ON interop_project_output_deliveries(organization_id,owner_member_id,available_at) WHERE state IN ('PENDING','RETRY','PROCESSING');
ALTER TABLE interop_provider_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON interop_provider_grants USING (organization_id = nullif(current_setting('orgmap.organization_id',true),'')::uuid) WITH CHECK (organization_id = nullif(current_setting('orgmap.organization_id',true),'')::uuid);
ALTER TABLE interop_provider_oauth_flows ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON interop_provider_oauth_flows USING (organization_id = nullif(current_setting('orgmap.organization_id',true),'')::uuid) WITH CHECK (organization_id = nullif(current_setting('orgmap.organization_id',true),'')::uuid);
ALTER TABLE interop_project_output_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON interop_project_output_configs USING (organization_id = nullif(current_setting('orgmap.organization_id',true),'')::uuid) WITH CHECK (organization_id = nullif(current_setting('orgmap.organization_id',true),'')::uuid);
ALTER TABLE interop_project_output_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON interop_project_output_deliveries USING (organization_id = nullif(current_setting('orgmap.organization_id',true),'')::uuid) WITH CHECK (organization_id = nullif(current_setting('orgmap.organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON interop_provider_grants,interop_provider_oauth_flows,interop_project_output_configs,interop_project_output_deliveries TO orgmap_app;
