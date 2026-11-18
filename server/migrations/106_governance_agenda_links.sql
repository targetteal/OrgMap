ALTER TABLE gov_tension_links DROP CONSTRAINT gov_tension_links_target_kind_check;
ALTER TABLE gov_tension_links ADD CONSTRAINT gov_tension_links_target_kind_check
CHECK(target_kind IN ('TASK','GOAL','PROPOSAL','AGENDA'));
