-- Remove the legacy single-service "visual pipeline builder" (PipelineGraph).
-- It was superseded by the interactive Resource/Connection graph and is orphaned
-- (no UI route mounts it). Dropping the table; cascade FK goes with it.
DROP TABLE IF EXISTS "pipeline_graphs";
