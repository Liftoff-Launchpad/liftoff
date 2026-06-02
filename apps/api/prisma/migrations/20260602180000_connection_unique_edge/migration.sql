-- Atomic backstop for duplicate graph edges. The app-level findFirst check in
-- ConnectionsService.create is check-then-insert, so two concurrent POSTs for the
-- same source->target edge could both insert. This unique index makes duplicate
-- rejection atomic (the service catches P2002 and returns 409).
--
-- Postgres treats NULLs as DISTINCT by default, which would let duplicates through
-- since exactly one of source_resource_id / source_service_id is NULL per row.
-- NULLS NOT DISTINCT (Postgres 15+) treats NULLs as equal so both edge kinds are
-- covered by one index. This index cannot be expressed in the Prisma schema
-- (no partial / NULLS-NOT-DISTINCT support), so it is created here in raw SQL;
-- a future `prisma migrate dev` will report it as drift — keep it.
CREATE UNIQUE INDEX "connections_unique_edge"
  ON "connections" ("environment_id", "source_resource_id", "source_service_id", "target_service_id")
  NULLS NOT DISTINCT;
