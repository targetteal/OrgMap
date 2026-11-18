ALTER TABLE goal_history ADD COLUMN comment text NOT NULL DEFAULT '' CHECK(length(comment)<=1000);
