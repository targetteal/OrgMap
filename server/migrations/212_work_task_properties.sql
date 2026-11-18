-- Native Work task properties. Existing rows retain unknown/empty metadata.
CREATE FUNCTION work_task_tags_valid(values_ text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT (array_ndims(values_) IS NULL OR array_ndims(values_)=1)
   AND cardinality(values_)<=20
   AND NOT EXISTS(SELECT 1 FROM unnest(values_) AS tag
     WHERE tag IS NULL OR length(tag) NOT BETWEEN 1 AND 50 OR tag<>btrim(tag) OR tag ~ '[[:cntrl:]]')
   AND cardinality(values_)=(SELECT count(DISTINCT tag) FROM unnest(values_) AS tag)
$$;
ALTER TABLE work_tasks
 ADD COLUMN priority text NOT NULL DEFAULT 'NONE' CHECK(priority IN ('NONE','LOW','MEDIUM','HIGH','URGENT')),
 ADD COLUMN estimate_minutes integer CHECK(estimate_minutes BETWEEN 0 AND 525600),
 ADD COLUMN tags text[] NOT NULL DEFAULT '{}' CHECK(work_task_tags_valid(tags));
