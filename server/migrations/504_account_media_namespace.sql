-- Concrete store namespaces are typed provider labels, not HTTP paths.
-- Preserve frozen 502 and accept the Platform ACCOUNT_ASSETS namespace.
ALTER TABLE account_media DROP CONSTRAINT account_media_check;
ALTER TABLE account_media ADD CONSTRAINT account_media_check CHECK (
  (state='DELETED' AND asset_id IS NULL AND storage_namespace IS NULL AND blob_key IS NULL AND sha256 IS NULL AND size IS NULL AND mime IS NULL AND width IS NULL AND height IS NULL)
  OR
  (state='ACTIVE' AND asset_id IS NOT NULL AND storage_namespace ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$' AND blob_key IS NOT NULL AND sha256 ~ '^[a-f0-9]{64}$' AND size > 0 AND size <= 8388608 AND mime IN ('image/png','image/jpeg','image/webp') AND width > 0 AND height > 0 AND ((kind='PHOTO' AND width<=512 AND height<=512) OR (kind='COVER' AND width<=1040 AND height<=480)))
);
ALTER TABLE account_media_gc DROP CONSTRAINT account_media_gc_storage_namespace_check;
ALTER TABLE account_media_gc ADD CONSTRAINT account_media_gc_storage_namespace_check CHECK (storage_namespace ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$');
