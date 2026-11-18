ALTER TABLE interop_deliveries DROP CONSTRAINT interop_deliveries_state_check;
ALTER TABLE interop_deliveries ADD CONSTRAINT interop_deliveries_state_check CHECK(state IN ('PENDING','SENDING','DELIVERED','FAILED','REVOKED'));
ALTER TABLE interop_deliveries ADD COLUMN lease_until timestamptz;
