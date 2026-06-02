-- CreateEnum
CREATE TYPE "ResourceKind" AS ENUM ('POSTGRES', 'REDIS', 'SPACES_BUCKET');

-- CreateEnum
CREATE TYPE "ResourceStatus" AS ENUM ('DRAFT', 'PROVISIONING', 'ACTIVE', 'FAILED', 'DESTROYING');

-- CreateEnum
CREATE TYPE "ConnectionKind" AS ENUM ('RESOURCE_BINDING', 'SERVICE_LINK');

-- CreateTable
CREATE TABLE "resources" (
    "id" TEXT NOT NULL,
    "environment_id" TEXT NOT NULL,
    "kind" "ResourceKind" NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB,
    "status" "ResourceStatus" NOT NULL DEFAULT 'DRAFT',
    "do_resource_id" TEXT,
    "outputs" JSONB,
    "canvas_position" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connections" (
    "id" TEXT NOT NULL,
    "environment_id" TEXT NOT NULL,
    "kind" "ConnectionKind" NOT NULL,
    "source_resource_id" TEXT,
    "source_service_id" TEXT,
    "target_service_id" TEXT NOT NULL,
    "inject_config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "resources_environment_id_idx" ON "resources"("environment_id");

-- CreateIndex
CREATE UNIQUE INDEX "resources_environment_id_name_key" ON "resources"("environment_id", "name");

-- CreateIndex
CREATE INDEX "connections_environment_id_idx" ON "connections"("environment_id");

-- CreateIndex
CREATE INDEX "connections_target_service_id_idx" ON "connections"("target_service_id");

-- CreateIndex
CREATE INDEX "connections_source_resource_id_idx" ON "connections"("source_resource_id");

-- CreateIndex
CREATE INDEX "connections_source_service_id_idx" ON "connections"("source_service_id");

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_environment_id_fkey" FOREIGN KEY ("environment_id") REFERENCES "environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_environment_id_fkey" FOREIGN KEY ("environment_id") REFERENCES "environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_source_resource_id_fkey" FOREIGN KEY ("source_resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_source_service_id_fkey" FOREIGN KEY ("source_service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_target_service_id_fkey" FOREIGN KEY ("target_service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Backfill: project existing provisioned infra into the new graph model.
-- Source of truth = pulumi_stacks.outputs (what is actually live). Only NON-SECRET
-- output fields are cached on resources.outputs (never dbUri / password). The
-- backfilled connections are INERT until the Phase B wiring engine ships, and
-- even then the variable-merge precedence keeps any existing manual DATABASE_URL
-- winning — so this migration changes data only, never deploy behaviour.
-- Idempotent via NOT EXISTS guards.
-- ============================================================================

-- Managed Postgres → one "main-db" resource per env whose stack provisioned a DB.
INSERT INTO "resources" ("id", "environment_id", "kind", "name", "status", "outputs", "created_at", "updated_at")
SELECT gen_random_uuid()::text, e."id", 'POSTGRES', 'main-db', 'ACTIVE',
       jsonb_strip_nulls(jsonb_build_object(
         'clusterName', ps."outputs" ->> 'dbClusterName',
         'host',        ps."outputs" ->> 'databaseHost'
       )),
       now(), now()
FROM "environments" e
JOIN "pulumi_stacks" ps ON ps."environment_id" = e."id"
WHERE e."deleted_at" IS NULL
  AND (ps."outputs" ->> 'dbUri' IS NOT NULL
       OR ps."outputs" ->> 'dbClusterName' IS NOT NULL
       OR ps."outputs" ->> 'databaseHost' IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM "resources" r WHERE r."environment_id" = e."id" AND r."name" = 'main-db'
  );

-- Spaces bucket → one "main-bucket" resource per env whose stack provisioned a bucket.
INSERT INTO "resources" ("id", "environment_id", "kind", "name", "status", "outputs", "created_at", "updated_at")
SELECT gen_random_uuid()::text, e."id", 'SPACES_BUCKET', 'main-bucket', 'ACTIVE',
       jsonb_strip_nulls(jsonb_build_object(
         'bucketName', COALESCE(ps."outputs" ->> 'bucketName', ps."outputs" ->> 'spacesBucket'),
         'endpoint',   ps."outputs" ->> 'bucketEndpoint'
       )),
       now(), now()
FROM "environments" e
JOIN "pulumi_stacks" ps ON ps."environment_id" = e."id"
WHERE e."deleted_at" IS NULL
  AND (ps."outputs" ->> 'bucketName' IS NOT NULL OR ps."outputs" ->> 'spacesBucket' IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM "resources" r WHERE r."environment_id" = e."id" AND r."name" = 'main-bucket'
  );

-- Wire each backfilled resource to its env's FIRST service (oldest), matching the
-- edge the old output-derived canvas drew. Users can re-wire after Phase A.
INSERT INTO "connections" ("id", "environment_id", "kind", "source_resource_id", "target_service_id", "created_at")
SELECT gen_random_uuid()::text, r."environment_id", 'RESOURCE_BINDING', r."id", first_svc."id", now()
FROM "resources" r
JOIN LATERAL (
  SELECT s."id" FROM "services" s
  WHERE s."environment_id" = r."environment_id" AND s."deleted_at" IS NULL
  ORDER BY s."created_at" ASC
  LIMIT 1
) first_svc ON true
WHERE NOT EXISTS (
  SELECT 1 FROM "connections" c
  WHERE c."source_resource_id" = r."id" AND c."target_service_id" = first_svc."id"
);
