ALTER TABLE goal_key_results ADD COLUMN confidence_level text CHECK (confidence_level IN ('LOW','MEDIUM','HIGH'));
