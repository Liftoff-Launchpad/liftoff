ALTER TABLE "deployments"
ADD COLUMN "build_strategy" TEXT,
ADD COLUMN "build_run_url" TEXT,
ADD COLUMN "build_plan" JSONB;
