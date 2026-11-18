ALTER TABLE gov_proposals DROP CONSTRAINT gov_proposals_state_check;
ALTER TABLE gov_proposals ADD CONSTRAINT gov_proposals_state_check
  CHECK (state IN ('DRAFT','REVIEW','DECIDED','WITHDRAWN','ESCALATED'));

ALTER TABLE gov_rounds DROP CONSTRAINT gov_rounds_state_check;
ALTER TABLE gov_rounds ADD CONSTRAINT gov_rounds_state_check
  CHECK (state IN ('OPEN','CLOSED','SUPERSEDED','INTERRUPTED'));
