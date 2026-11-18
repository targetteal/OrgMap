CREATE TABLE admission_link_state(
 organization_id uuid PRIMARY KEY REFERENCES organizations(id),version integer NOT NULL DEFAULT 0 CHECK(version>=0)
);
CREATE TABLE admission_links(
 organization_id uuid NOT NULL REFERENCES organizations(id),id uuid NOT NULL,
 token_hash text NOT NULL UNIQUE,version integer NOT NULL CHECK(version>0),
 created_by_member_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '7 days',
 max_acceptances integer NOT NULL DEFAULT 100 CHECK(max_acceptances=100),
 acceptance_count integer NOT NULL DEFAULT 0 CHECK(acceptance_count BETWEEN 0 AND 100),revoked_at timestamptz,
 PRIMARY KEY(organization_id,id),FOREIGN KEY(organization_id,created_by_member_id) REFERENCES members(organization_id,id)
);
CREATE UNIQUE INDEX admission_one_live_link ON admission_links(organization_id) WHERE revoked_at IS NULL;
CREATE TABLE admission_requests(
 organization_id uuid NOT NULL REFERENCES organizations(id),id uuid NOT NULL,
 account_id uuid NOT NULL REFERENCES accounts(id),email text NOT NULL,
 source text NOT NULL CHECK(source IN ('PUBLIC_JOIN','INVITATION_LINK')),link_id uuid,
 policy_revision integer NOT NULL CHECK(policy_revision>=0),token_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '30 minutes',
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 completed_at timestamptz,member_id uuid,
 PRIMARY KEY(organization_id,id),FOREIGN KEY(organization_id,link_id) REFERENCES admission_links(organization_id,id),
 FOREIGN KEY(organization_id,member_id) REFERENCES members(organization_id,id),
 CHECK((source='PUBLIC_JOIN' AND link_id IS NULL) OR (source='INVITATION_LINK' AND link_id IS NOT NULL)),
 CHECK((completed_at IS NULL AND member_id IS NULL) OR (completed_at IS NOT NULL AND member_id IS NOT NULL))
);
CREATE INDEX admission_request_rate ON admission_requests(organization_id,account_id,created_at);
CREATE TABLE admission_mail(
 organization_id uuid NOT NULL,id uuid NOT NULL,request_id uuid NOT NULL,token text,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','PROCESSING','DELIVERED','FAILED','CANCELLED')),
 attempts integer NOT NULL DEFAULT 0,lease_token uuid,lease_until timestamptz,
 next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),last_error text,
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,request_id),
 FOREIGN KEY(organization_id,request_id) REFERENCES admission_requests(organization_id,id)
);
CREATE INDEX admission_mail_dispatch ON admission_mail(organization_id,state,next_attempt_at);
ALTER TABLE admission_link_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE admission_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE admission_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE admission_mail ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON admission_link_state USING(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid);
CREATE POLICY tenant ON admission_links USING(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid);
CREATE POLICY tenant ON admission_requests USING(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid);
CREATE POLICY tenant ON admission_mail USING(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid) WITH CHECK(organization_id=nullif(current_setting('orgmap.organization_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON admission_link_state,admission_links,admission_requests,admission_mail TO orgmap_app;
