ALTER TABLE interop_deliveries ADD COLUMN owner_member_id uuid;
ALTER TABLE interop_deliveries ADD CONSTRAINT interop_delivery_owner FOREIGN KEY(organization_id,owner_member_id) REFERENCES members(organization_id,id);
ALTER TABLE interop_deliveries ADD COLUMN available_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE interop_deliveries ADD COLUMN lease_token uuid;
CREATE INDEX interop_pending_delivery ON interop_deliveries(organization_id,owner_member_id,available_at) WHERE state IN ('PENDING','FAILED','SENDING');
