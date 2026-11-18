-- Account-owned derivatives are global IAM data, deliberately unrelated to an organization.
CREATE TABLE account_media (
  account_id uuid NOT NULL REFERENCES accounts(id),
  kind text NOT NULL CHECK (kind IN ('PHOTO','COVER')),
  version integer NOT NULL CHECK (version > 0),
  state text NOT NULL CHECK (state IN ('ACTIVE','DELETED')),
  asset_id uuid,
  storage_namespace text,
  blob_key uuid,
  sha256 text,
  size integer,
  mime text,
  width integer,
  height integer,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (account_id,kind),
  UNIQUE (asset_id),
  UNIQUE (storage_namespace,blob_key),
  CHECK (
    (state='DELETED' AND asset_id IS NULL AND storage_namespace IS NULL AND blob_key IS NULL AND sha256 IS NULL AND size IS NULL AND mime IS NULL AND width IS NULL AND height IS NULL)
    OR
    (state='ACTIVE' AND asset_id IS NOT NULL AND storage_namespace ~ '^[a-z][a-z0-9-]{0,63}$' AND blob_key IS NOT NULL AND sha256 ~ '^[a-f0-9]{64}$' AND size > 0 AND size <= 8388608 AND mime IN ('image/png','image/jpeg','image/webp') AND width > 0 AND height > 0 AND ((kind='PHOTO' AND width<=512 AND height<=512) OR (kind='COVER' AND width<=1040 AND height<=480)))
  )
);

-- No Account FK here: rollback cleanup is recorded through an independent connection
-- while the request holds its Account lock, and must survive future owner retirement.
CREATE TABLE account_media_gc (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('PHOTO','COVER')),
  storage_namespace text NOT NULL CHECK (storage_namespace ~ '^[a-z][a-z0-9-]{0,63}$'),
  blob_key uuid NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  size integer NOT NULL CHECK (size > 0 AND size <= 8388608),
  reason text NOT NULL CHECK (reason IN ('UNPUBLISHED','REPLACED','DELETED')),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (storage_namespace,blob_key)
);
CREATE INDEX account_media_gc_due ON account_media_gc(available_at,id);
GRANT SELECT,INSERT,UPDATE,DELETE ON account_media,account_media_gc TO orgmap_app;
