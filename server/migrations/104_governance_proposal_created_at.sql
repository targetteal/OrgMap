ALTER TABLE gov_proposals ADD COLUMN created_at timestamptz;
-- Existing drafts derive their original timestamp from the first immutable revision.
UPDATE gov_proposals p SET created_at=(SELECT r.created_at FROM gov_revisions r WHERE r.organization_id=p.organization_id AND r.proposal_id=p.id AND r.number=1);
ALTER TABLE gov_proposals ALTER COLUMN created_at SET DEFAULT clock_timestamp();
ALTER TABLE gov_proposals ALTER COLUMN created_at SET NOT NULL;
