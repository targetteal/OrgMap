-- Immutable proof stamps deliberately have no sessions FK: successful email
-- completion deletes the initiating session while preserving its audit binding.
ALTER TABLE account_email_change_requests ADD COLUMN initiating_session_id uuid;
ALTER TABLE account_email_change_requests ADD COLUMN completion_session_id uuid;

-- Old intents cannot acquire a fabricated binding to a currently live session.
UPDATE account_email_change_requests SET state='EXPIRED' WHERE state='PENDING_PROOF' AND initiating_session_id IS NULL;
UPDATE account_email_change_mail m SET state='CANCELLED',token=NULL,lease_token=NULL,lease_until=NULL,last_error=NULL
 FROM account_email_change_requests r
 WHERE r.id=m.request_id AND r.initiating_session_id IS NULL AND m.state NOT IN ('DELIVERED','CANCELLED');
ALTER TABLE account_email_change_requests ADD CONSTRAINT account_email_pending_session_bound CHECK(state<>'PENDING_PROOF' OR initiating_session_id IS NOT NULL);
