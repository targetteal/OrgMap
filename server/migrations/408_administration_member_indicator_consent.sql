CREATE TABLE administration_indicator_consent_books (
 organization_id uuid NOT NULL,
 subject_member_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision > 0),
 PRIMARY KEY(organization_id,subject_member_id),
 FOREIGN KEY(organization_id,subject_member_id) REFERENCES members(organization_id,id)
);
CREATE TABLE administration_indicator_consents (
 organization_id uuid NOT NULL,
 id uuid NOT NULL,
 subject_member_id uuid NOT NULL,
 delegate_member_id uuid NOT NULL,
 actions text[] NOT NULL CHECK(actions=ARRAY['DEFINE']::text[]),
 version integer NOT NULL DEFAULT 1 CHECK(version > 0),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,id),
 FOREIGN KEY(organization_id,subject_member_id) REFERENCES administration_indicator_consent_books(organization_id,subject_member_id),
 FOREIGN KEY(organization_id,delegate_member_id) REFERENCES members(organization_id,id),
 CHECK(expires_at>created_at)
);
CREATE INDEX administration_indicator_consents_lookup ON administration_indicator_consents(organization_id,subject_member_id,delegate_member_id) WHERE revoked_at IS NULL;
CREATE TABLE administration_indicator_consent_history (
 organization_id uuid NOT NULL,
 subject_member_id uuid NOT NULL,
 book_revision integer NOT NULL,
 snapshot jsonb NOT NULL,
 actor_id uuid NOT NULL REFERENCES accounts(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,subject_member_id,book_revision),
 FOREIGN KEY(organization_id,subject_member_id) REFERENCES administration_indicator_consent_books(organization_id,subject_member_id)
);
ALTER TABLE administration_indicator_consent_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE administration_indicator_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE administration_indicator_consent_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON administration_indicator_consent_books USING(organization_id::text=current_setting('orgmap.organization_id',true));
CREATE POLICY tenant ON administration_indicator_consents USING(organization_id::text=current_setting('orgmap.organization_id',true));
CREATE POLICY tenant ON administration_indicator_consent_history USING(organization_id::text=current_setting('orgmap.organization_id',true));
GRANT SELECT,INSERT,UPDATE ON administration_indicator_consent_books,administration_indicator_consents TO orgmap_app;
GRANT SELECT,INSERT ON administration_indicator_consent_history TO orgmap_app;
