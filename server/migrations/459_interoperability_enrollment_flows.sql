ALTER TABLE interop_auth_flows ADD COLUMN flow_kind text NOT NULL DEFAULT 'LOGIN' CHECK(flow_kind IN ('LOGIN','LINK','ENROLLMENT'));
ALTER TABLE interop_auth_flows ADD COLUMN enrollment_flow_id text;
ALTER TABLE interop_auth_flows ADD CONSTRAINT interop_enrollment_flow_binding CHECK((flow_kind='ENROLLMENT') = (enrollment_flow_id IS NOT NULL));
