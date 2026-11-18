-- New outputs reference real owner-created resources. Legacy local actions keep
-- all four fields NULL; migration never guesses a source or destination.
ALTER TABLE meeting_actions
 ADD COLUMN target_kind text,
 ADD COLUMN target_id uuid,
 ADD COLUMN output_created_by uuid,
 ADD COLUMN output_command_key text,
 ADD CONSTRAINT meeting_actions_output_shape CHECK (
  (target_kind IS NULL AND target_id IS NULL AND output_created_by IS NULL AND output_command_key IS NULL)
  OR
  (target_kind IS NOT NULL AND target_kind IN ('TASK','PROJECT','GOAL','PROPOSAL') AND target_id IS NOT NULL
   AND output_created_by IS NOT NULL AND output_command_key IS NOT NULL
   AND length(output_command_key) BETWEEN 1 AND 200)
 ),
 ADD CONSTRAINT meeting_actions_output_creator_fk
  FOREIGN KEY(organization_id,output_created_by) REFERENCES members(organization_id,id);

CREATE UNIQUE INDEX meeting_actions_output_command_unique
 ON meeting_actions(organization_id,meeting_id,output_created_by,output_command_key)
 WHERE target_id IS NOT NULL;
CREATE INDEX meeting_actions_output_target
 ON meeting_actions(organization_id,target_kind,target_id)
 WHERE target_id IS NOT NULL;
