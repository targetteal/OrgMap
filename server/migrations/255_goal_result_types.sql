-- Binary has a fixed 0/1 range. Custom is an explicitly configured numeric scale.
ALTER TABLE goal_key_results DROP CONSTRAINT goal_key_results_result_type_check;
ALTER TABLE goal_key_results ADD CONSTRAINT goal_key_results_result_type_check
  CHECK(result_type IN ('QUANTITATIVE','PERCENTAGE','MILESTONE','BINARY','CUSTOM'));
ALTER TABLE goal_key_results ADD CONSTRAINT goal_key_results_binary_range
  CHECK(result_type <> 'BINARY' OR (initial_value=0 AND target_value=1 AND current_value IN (0,1)));
