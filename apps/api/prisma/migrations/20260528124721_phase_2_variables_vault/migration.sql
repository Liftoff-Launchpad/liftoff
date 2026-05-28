-- CreateEnum
CREATE TYPE "VariableScope" AS ENUM ('BUILD', 'RUNTIME', 'BOTH');

-- CreateEnum
CREATE TYPE "VariableKind" AS ENUM ('PLAIN', 'SECRET');

-- CreateTable
CREATE TABLE "environment_variables" (
    "id" TEXT NOT NULL,
    "environment_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "encrypted_value" TEXT NOT NULL,
    "scope" "VariableScope" NOT NULL DEFAULT 'RUNTIME',
    "kind" "VariableKind" NOT NULL DEFAULT 'PLAIN',
    "created_by" TEXT,
    "last_rotated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "environment_variables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_variables" (
    "id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "encrypted_value" TEXT NOT NULL,
    "scope" "VariableScope" NOT NULL DEFAULT 'RUNTIME',
    "kind" "VariableKind" NOT NULL DEFAULT 'PLAIN',
    "created_by" TEXT,
    "last_rotated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_variables_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "environment_variables_environment_id_idx" ON "environment_variables"("environment_id");

-- CreateIndex
CREATE UNIQUE INDEX "environment_variables_environment_id_key_key" ON "environment_variables"("environment_id", "key");

-- CreateIndex
CREATE INDEX "service_variables_service_id_idx" ON "service_variables"("service_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_variables_service_id_key_key" ON "service_variables"("service_id", "key");

-- AddForeignKey
ALTER TABLE "environment_variables" ADD CONSTRAINT "environment_variables_environment_id_fkey" FOREIGN KEY ("environment_id") REFERENCES "environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_variables" ADD CONSTRAINT "service_variables_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
