-- Empty on migration: a managed host must be explicitly bound to its authority.
CREATE TABLE organization_runtime_identity (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 authority_id uuid NOT NULL,
 instance_id uuid NOT NULL,
 epoch bigint NOT NULL CHECK(epoch>0)
);
REVOKE ALL ON organization_runtime_identity FROM PUBLIC,orgmap_app;
GRANT SELECT ON organization_runtime_identity TO orgmap_app;
-- Managed restored databases cannot be silently served in legacy mode while unbound.
CREATE TABLE organization_runtime_mode (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), managed boolean NOT NULL DEFAULT false);
INSERT INTO organization_runtime_mode(singleton,managed) VALUES(true,false);
REVOKE ALL ON organization_runtime_mode FROM PUBLIC,orgmap_app;
GRANT SELECT ON organization_runtime_mode TO orgmap_app;
