-- LF04 infrastructure only: no request, maintenance runner, or transition grant.
CREATE TABLE organization_lifecycle (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id),
  state text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','DELETION_PENDING','PURGING','DELETED')),
  fence bigint NOT NULL DEFAULT 1 CHECK (fence > 0)
);
INSERT INTO organization_lifecycle(organization_id) SELECT id FROM organizations;
REVOKE ALL ON organization_lifecycle FROM PUBLIC, orgmap_app;
GRANT SELECT ON organization_lifecycle TO orgmap_app;

CREATE FUNCTION orgmap_initialize_organization_lifecycle() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.organization_lifecycle(organization_id) VALUES (NEW.id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION orgmap_initialize_organization_lifecycle() FROM PUBLIC;
CREATE TRIGGER organization_lifecycle_initialize AFTER INSERT ON organizations
FOR EACH ROW EXECUTE FUNCTION orgmap_initialize_organization_lifecycle();

-- Even the table owner cannot accidentally skip/reverse a state or reset a fence.
-- The future runner must additionally validate job, actor and fence under the org lock.
CREATE FUNCTION orgmap_validate_lifecycle_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'lifecycle tombstone cannot be deleted'; END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
     NOT ((OLD.state = 'ACTIVE' AND NEW.state = 'DELETION_PENDING') OR
          (OLD.state = 'DELETION_PENDING' AND NEW.state = 'PURGING') OR
          (OLD.state = 'PURGING' AND NEW.state = 'DELETED')) OR
     NEW.fence <> OLD.fence + 1 THEN
    RAISE EXCEPTION 'invalid lifecycle transition';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER organization_lifecycle_transition BEFORE UPDATE OR DELETE ON organization_lifecycle
FOR EACH ROW EXECUTE FUNCTION orgmap_validate_lifecycle_transition();
