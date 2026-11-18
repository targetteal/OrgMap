-- Preserve event facts for delayed delivery; historical chronology remains unknown.
ALTER TABLE platform_deliveries ADD COLUMN context jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(context)='object' AND octet_length(context::text)<=24000);
ALTER TABLE platform_deliveries ADD COLUMN actor_name text CHECK (length(actor_name) BETWEEN 1 AND 200);
ALTER TABLE platform_deliveries ADD COLUMN created_at timestamptz;
ALTER TABLE platform_deliveries ALTER COLUMN created_at SET DEFAULT clock_timestamp();
