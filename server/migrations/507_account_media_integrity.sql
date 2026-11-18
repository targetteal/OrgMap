-- PostgreSQL accepts a NULL CHECK result. Make ACTIVE completeness explicit
-- without changing the previously applied 502/504 checks or checksums.
ALTER TABLE account_media ADD CONSTRAINT account_media_active_fields_present CHECK (
  state <> 'ACTIVE' OR (
    asset_id IS NOT NULL AND
    storage_namespace IS NOT NULL AND
    blob_key IS NOT NULL AND
    sha256 IS NOT NULL AND
    size IS NOT NULL AND
    mime IS NOT NULL AND
    width IS NOT NULL AND
    height IS NOT NULL
  )
);
