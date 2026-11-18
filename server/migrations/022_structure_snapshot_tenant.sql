ALTER TABLE structure_snapshots ADD CONSTRAINT structure_snapshot_org_fk FOREIGN KEY(organization_id) REFERENCES organizations(id);
