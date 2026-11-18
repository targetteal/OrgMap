ALTER TABLE interop_scim_sources ADD COLUMN requested_member_type text NOT NULL DEFAULT 'MEMBER' CHECK (requested_member_type IN ('MEMBER','GUEST'));
