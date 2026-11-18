ALTER TABLE goals ADD COLUMN description_rich jsonb;
ALTER TABLE goal_key_results ADD COLUMN description_rich jsonb;
ALTER TABLE goals ADD CONSTRAINT goals_rich_envelope CHECK(description_rich IS NULL OR (description_rich->>'format'='orgmap-richtext' AND description_rich->>'version'='1'));
ALTER TABLE goal_key_results ADD CONSTRAINT goal_key_results_rich_envelope CHECK(description_rich IS NULL OR (description_rich->>'format'='orgmap-richtext' AND description_rich->>'version'='1'));
