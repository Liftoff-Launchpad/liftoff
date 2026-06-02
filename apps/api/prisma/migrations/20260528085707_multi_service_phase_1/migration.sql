-- CreateEnum
CREATE TYPE "ServiceKind" AS ENUM ('SERVICE', 'WORKER', 'JOB', 'STATIC_SITE');

-- CreateEnum
CREATE TYPE "BuildStrategy" AS ENUM ('AUTO', 'DOCKERFILE', 'NIXPACKS');

-- CreateEnum
CREATE TYPE "DeploymentBundleStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'SUCCESS', 'FAILED', 'PARTIAL', 'CANCELLED');

-- AlterTable
ALTER TABLE "deployments" ADD COLUMN     "bundle_id" TEXT,
ADD COLUMN     "service_id" TEXT;

-- CreateTable
CREATE TABLE "services" (
    "id" TEXT NOT NULL,
    "environment_id" TEXT NOT NULL,
    "repository_id" TEXT,
    "name" TEXT NOT NULL,
    "kind" "ServiceKind" NOT NULL DEFAULT 'SERVICE',
    "source_dir" TEXT NOT NULL DEFAULT '.',
    "build_strategy" "BuildStrategy" NOT NULL DEFAULT 'AUTO',
    "dockerfile_path" TEXT NOT NULL DEFAULT 'Dockerfile',
    "port" INTEGER NOT NULL DEFAULT 3000,
    "instance_size" TEXT NOT NULL DEFAULT 'apps-s-1vcpu-0.5gb',
    "replicas" INTEGER NOT NULL DEFAULT 1,
    "route_path" TEXT,
    "healthcheck_path" TEXT,
    "command" TEXT,
    "job_schedule" TEXT,
    "job_kind" TEXT,
    "canvas_position" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployment_bundles" (
    "id" TEXT NOT NULL,
    "environment_id" TEXT NOT NULL,
    "status" "DeploymentBundleStatus" NOT NULL DEFAULT 'PENDING',
    "triggered_by" TEXT,
    "commit_sha" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deployment_bundles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "services_environment_id_idx" ON "services"("environment_id");

-- CreateIndex
CREATE INDEX "services_repository_id_idx" ON "services"("repository_id");

-- CreateIndex
CREATE UNIQUE INDEX "services_environment_id_name_key" ON "services"("environment_id", "name");

-- CreateIndex
CREATE INDEX "deployment_bundles_environment_id_created_at_idx" ON "deployment_bundles"("environment_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "deployments_service_id_created_at_idx" ON "deployments"("service_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "deployments_bundle_id_idx" ON "deployments"("bundle_id");

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_environment_id_fkey" FOREIGN KEY ("environment_id") REFERENCES "environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_bundles" ADD CONSTRAINT "deployment_bundles_environment_id_fkey" FOREIGN KEY ("environment_id") REFERENCES "environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "deployment_bundles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Backfill: create one default Service row per existing (non-deleted) Environment,
-- extracting runtime/build values from the env's v1 config_parsed JSON. The default
-- service inherits the env name as a fallback, gets the root route ('/'), and
-- copies the env's canvasPosition. After this runs, all existing deployments are
-- relinked to point at the new default service.
-- -----------------------------------------------------------------------------

INSERT INTO "services" (
    "id",
    "environment_id",
    "repository_id",
    "name",
    "kind",
    "source_dir",
    "build_strategy",
    "dockerfile_path",
    "port",
    "instance_size",
    "replicas",
    "route_path",
    "healthcheck_path",
    "canvas_position",
    "created_at",
    "updated_at"
)
SELECT
    'svc_' || replace(gen_random_uuid()::text, '-', ''),
    e.id,
    r.id,
    COALESCE(
        NULLIF(e.config_parsed->'service'->>'name', ''),
        e.name
    ),
    'SERVICE'::"ServiceKind",
    COALESCE(NULLIF(e.config_parsed->'build'->>'context', ''), '.'),
    CASE upper(COALESCE(NULLIF(e.config_parsed->'build'->>'strategy', ''), 'AUTO'))
        WHEN 'DOCKERFILE' THEN 'DOCKERFILE'::"BuildStrategy"
        WHEN 'NIXPACKS'   THEN 'NIXPACKS'::"BuildStrategy"
        ELSE                   'AUTO'::"BuildStrategy"
    END,
    COALESCE(NULLIF(e.config_parsed->'build'->>'dockerfile_path', ''), 'Dockerfile'),
    COALESCE(NULLIF(e.config_parsed->'runtime'->>'port', '')::int, 3000),
    COALESCE(NULLIF(e.config_parsed->'runtime'->>'instance_size', ''), 'apps-s-1vcpu-0.5gb'),
    COALESCE(NULLIF(e.config_parsed->'runtime'->>'replicas', '')::int, 1),
    '/',
    NULLIF(e.config_parsed->'healthcheck'->>'path', ''),
    e.canvas_position,
    NOW(),
    NOW()
FROM "environments" e
LEFT JOIN "repositories" r ON r."project_id" = e."project_id"
WHERE e."deleted_at" IS NULL
ON CONFLICT ("environment_id", "name") DO NOTHING;

-- Link existing deployments to their env's default service.
UPDATE "deployments" d
SET "service_id" = s."id"
FROM "services" s
WHERE s."environment_id" = d."environment_id"
  AND d."service_id" IS NULL;
