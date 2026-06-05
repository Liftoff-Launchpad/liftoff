-- Phase F: allow many repositories per project.
-- Drop the 1:1 unique on repositories.project_id and replace it with a plain
-- index so a project can link N repos, each contributing services to one App.
DROP INDEX IF EXISTS "repositories_project_id_key";
CREATE INDEX IF NOT EXISTS "repositories_project_id_idx" ON "repositories"("project_id");
