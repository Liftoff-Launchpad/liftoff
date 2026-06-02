# Plan: Interactive Infrastructure Graph (Railway / n8n-style)

> **What this proposes:** turn Liftoff's canvas from a read-only picture of one
> service into a **live, interactive graph** where nodes are services *and*
> resources (Postgres, Redis, Spaces bucket), edges are relationships the user
> draws, and **wiring an edge auto-injects the connection's env vars** (drag
> Postgres → API and the API boots with `DATABASE_URL` already set). Each phase
> ships on its own; single-service deploys keep working throughout.

> **Status of the prior plan:** [`MULTI_SERVICE_PLAN.md`](./MULTI_SERVICE_PLAN.md)
> Phases 1 (multi-service) and 2 (vault) are **shipped** and stay the foundation.
> Its remaining Phases 3/4/5 are **folded into this plan** as Phases E/F/D and
> reframed around the graph model. Treat this document as the source of truth.

---

## 1. The vision

Today: one environment = one canvas node = one deployed service. Adding a
database means editing config; connecting it means manually typing a
`DATABASE_URL`. The canvas is a setup screen, not a system.

Target: the canvas **is** the system.

- **Nodes are things** — services, Postgres, Redis, buckets, (later) repos.
- **Edges are relationships** — an edge from a Postgres node to a service means
  "inject this DB's connection string into that service." Drawn by hand,
  persisted, and **compiled into real env injection at deploy time.**
- **Adding + wiring a resource is one gesture** — drop a Postgres node, draw an
  edge to the API, hit Deploy. Liftoff provisions the DB and the API comes up
  with `DATABASE_URL` set. No manual secrets, no YAML.
- **Staged + atomic** — structural edits queue on the canvas and apply together
  as one Pulumi reconcile.

This is Railway's mental model (resources + auto-injected references) with
n8n's interaction model (draw the graph), on Liftoff's DigitalOcean-only stack.

---

## 2. Current state — grounded

Verified by reading the code (file:line). What's **real** vs **canvas decoration**:

| Capability | Reality | Evidence |
|---|---|---|
| Service nodes | **Real** — backed by `Service` rows, deploy + live URL | `apps/api/src/canvas/canvas.service.ts:191` |
| React Flow canvas | **Real** — `@xyflow/react`, draggable nodes, `onConnect` wired | `apps/web/src/components/canvas/project-canvas.tsx:48,131,314` |
| Resource nodes (db/redis/storage) | **Read-only projection** of Pulumi outputs | `canvas.service.ts:224-290` |
| **Edges** | **Derived, never stored** — recomputed from outputs each load; user-drawn edges vanish on reload | `canvas.service.ts:230-289`; `saveLayout` skips edges `canvas.service.ts:353-378` |
| Layout persistence | **Service positions only** — resource node positions recomputed each load | `canvas.service.ts:356-362` |
| Resource provisioning | **Real but binary** — `config.database.enabled` / `config.storage.enabled` toggle one Postgres + one bucket | `packages/pulumi-components/src/stacks/app-platform-stack.ts:88-120` |
| **Redis** | **Not modeled at all** — no schema, no config field, no Pulumi component | `liftoff-yml.schema.ts:184-196` (no redis) |
| **Auto-wiring (DATABASE_URL)** | **Does not exist** — DB provisions, but the connection string is *not* injected; users add `DATABASE_URL` by hand | `app-platform-app.ts:189-212` (`buildServiceEnvs` only merges metadata + vault vars) |
| First-class resource model | **None** — only `config.database.enabled` booleans + post-hoc `InfrastructureResource` audit rows | `schema.prisma:377-391` |
| `${{ resources.db.uri }}` linked vars | **Syntax recognized, no resolver** | `MULTI_SERVICE_PLAN.md:574` |
| Staged "Deploy" button | **No-op apply** — just invalidates the canvas query; mutations persist individually | `project-canvas.tsx:215-217` |
| Worker / cron palette items | **Placeholder** — UI only, no backend | command-palette frontend map |

**The core gap:** there is no graph *data model*. The canvas renders a graph but
the backend has no concept of a persisted edge, a named resource, or a binding.
Everything below builds that model and the engine that compiles it.

---

## 3. Target architecture — the graph

### 3.1 Nodes and edges

```
Environment (1 ⇄ 1 DO App ⇄ 1 PulumiStack)
  ├── Service[]        nodes: kind = SERVICE | WORKER | JOB | STATIC_SITE
  ├── Resource[]       nodes: kind = POSTGRES | REDIS | SPACES_BUCKET   ← NEW
  └── Connection[]     edges: source → targetService                    ← NEW
        ├── RESOURCE_BINDING : Resource  → Service  (inject DB/Redis/bucket vars)
        └── SERVICE_LINK     : Service   → Service  (inject INTERNAL_<NAME>_URL)
```

Invariants:
- One `Environment` ↔ one DO `App` ↔ one `PulumiStack` (unchanged).
- `Service` + `Resource` rows define the App's spec and what gets provisioned.
- `Connection` rows are the **source of truth for edges and for env injection.**
- The **graph (DB rows) is authoritative**; `liftoff.yml` becomes a compile
  target/export (§3.6), not the input.

### 3.2 Data model (Prisma)

```prisma
enum ResourceKind {
  POSTGRES
  REDIS
  SPACES_BUCKET
}

enum ResourceStatus {
  DRAFT          // staged on canvas, not yet provisioned
  PROVISIONING
  ACTIVE
  FAILED
  DESTROYING
}

enum ConnectionKind {
  RESOURCE_BINDING   // Resource → Service: inject connection env vars
  SERVICE_LINK       // Service  → Service: inject INTERNAL_<NAME>_URL
}

/// A provisionable infra node on the canvas (managed DB, Redis, bucket).
/// Replaces the binary config.database/storage flags with named, multi-cardinal rows.
model Resource {
  id             String         @id @default(cuid())
  environmentId  String         @map("environment_id")
  kind           ResourceKind
  name           String         // unique per env; stable handle for links + DO naming
  config         Json?          // kind-specific: { version, size, nodes, evictionPolicy, ... }
  status         ResourceStatus @default(DRAFT)
  doResourceId   String?        @map("do_resource_id")  // cluster id / bucket name once live
  /// Cached NON-SECRET outputs for UI display only (host, port, bucket, endpoint).
  /// Secret parts (password, full uri) are NEVER stored here — resolved inside Pulumi.
  outputs        Json?
  canvasPosition Json?          @map("canvas_position")
  createdAt      DateTime       @default(now()) @map("created_at")
  updatedAt      DateTime       @updatedAt @map("updated_at")
  deletedAt      DateTime?      @map("deleted_at")
  environment    Environment    @relation(fields: [environmentId], references: [id], onDelete: Cascade)
  connections    Connection[]   @relation("ResourceConnections")

  @@unique([environmentId, name])
  @@index([environmentId])
  @@map("resources")
}

/// A directed edge. Target is always the CONSUMER service. Source is a Resource
/// (binding) or a Service (link). Cascade-deletes with either endpoint.
model Connection {
  id               String         @id @default(cuid())
  environmentId    String         @map("environment_id")
  kind             ConnectionKind
  sourceResourceId String?        @map("source_resource_id")  // set for RESOURCE_BINDING
  sourceServiceId  String?        @map("source_service_id")   // set for SERVICE_LINK
  targetServiceId  String         @map("target_service_id")
  /// Optional override of injected var names / subset. null = binding-template defaults.
  /// e.g. { "rename": { "DATABASE_URL": "DB_URL" }, "include": ["DATABASE_URL"] }
  injectConfig     Json?          @map("inject_config")
  createdAt        DateTime       @default(now()) @map("created_at")
  environment      Environment    @relation(fields: [environmentId], references: [id], onDelete: Cascade)
  sourceResource   Resource?      @relation("ResourceConnections", fields: [sourceResourceId], references: [id], onDelete: Cascade)
  sourceService    Service?       @relation("ServiceOutgoing",    fields: [sourceServiceId], references: [id], onDelete: Cascade)
  targetService    Service        @relation("ServiceIncoming",    fields: [targetServiceId], references: [id], onDelete: Cascade)

  @@index([environmentId])
  @@index([targetServiceId])
  @@map("connections")
}
```

`Service` gains the inverse relations (`ServiceOutgoing`, `ServiceIncoming`) and
nothing else — `canvasPosition`, `command`, `kind` already exist (`schema.prisma:215-235`).
`InfrastructureResource` (audit table) stays as-is.

### 3.3 The wiring engine — binding templates

A static map in `@liftoff/shared` (`src/bindings/binding-templates.ts`) declares,
per source kind, the env vars it contributes and how to resolve them from the
source's Pulumi outputs:

```ts
export const BINDING_TEMPLATES = {
  POSTGRES: {
    // key = injected env var, value = token into the resource's Pulumi outputs
    DATABASE_URL: '${uri}',                    // default, always on
    // opt-in expansion via Connection.injectConfig.include:
    PGHOST: '${host}', PGPORT: '${port}', PGUSER: '${username}',
    PGPASSWORD: '${password}', PGDATABASE: '${database}',
  },
  REDIS:         { REDIS_URL: '${uri}' },
  SPACES_BUCKET: {
    SPACES_BUCKET: '${bucketName}', SPACES_ENDPOINT: '${endpoint}',
    SPACES_REGION: '${region}',
    SPACES_ACCESS_KEY: '${accessKey}', SPACES_SECRET_KEY: '${secretKey}',
  },
  SERVICE_LINK:  { 'INTERNAL_${SOURCE_NAME}_URL': '${internalUrl}' },
} as const

// Defaults that are injected without opt-in (keep the env clean):
export const BINDING_DEFAULTS = {
  POSTGRES: ['DATABASE_URL'],
  REDIS: ['REDIS_URL'],
  SPACES_BUCKET: ['SPACES_BUCKET', 'SPACES_ENDPOINT', 'SPACES_REGION', 'SPACES_ACCESS_KEY', 'SPACES_SECRET_KEY'],
  SERVICE_LINK: ['INTERNAL_${SOURCE_NAME}_URL'],
}
```

**Resolution happens inside the Pulumi program, not in the API.** The compiler
passes a `bindings[]` structure to the stack; `AppPlatformApp` resolves each
`${...}` token against the live source-resource `pulumi.Output` and adds the
result as a `SECRET`-typed env entry on the target service. Connection secrets
**never round-trip through the API/DB in plaintext.**

**Merge precedence** (lowest → highest), so users always win:
```
LIFTOFF_* metadata  <  edge-injected (binding)  <  env-scope vault  <  service-scope vault
```
A user who sets their own `DATABASE_URL` overrides the auto-injected one — which
also makes migration of existing envs safe (§7).

### 3.4 Compile pipeline

`GraphCompilerService.compile(environmentId) → CompiledStack`:

1. Load `Service[]`, `Resource[]` (DRAFT + ACTIVE), `Connection[]`, vault vars.
2. **Validate**: service-link graph is a DAG (reject cycles with a clear error);
   every `Connection` endpoint exists; resource + service names unique; a service
   isn't bound to two resources that inject the same var name without `rename`.
3. Build Pulumi args:
   - `resources: ResourceSpec[]` — every `Resource` row → provision intent.
   - `services: ServiceSpec[]` — every `Service` row (incl. kind dispatch, §Phase D).
   - `serviceImages` — latest SUCCESS image per service (reuse) or new bundle images.
   - `serviceVariables` — resolved **user** vault vars (real values).
   - `bindings: Binding[]` — `{ source: {kind, name}, targetServiceName, vars, injectConfig }`
     for the Pulumi program to resolve from live outputs.
4. Return `CompiledStack` consumed by the infrastructure processor's `pulumi up`.

The compiler also emits a `liftoff.yml` v3 export (§3.6) so the committed repo
file mirrors the graph for developer-mode users.

### 3.5 Apply flow

`POST /environments/:eid/apply` (the staged-changes "Deploy" button):
1. Persist any pending DRAFT resources / new connections from the request.
2. `GraphCompilerService.compile` → `CompiledStack`.
3. Create a `DeploymentBundle` + per-service `Deployment` rows (reuse images; no
   rebuild unless a service's source changed).
4. Enqueue one `INFRASTRUCTURE.PROVISION` job → `pulumi up` reconciles:
   - new `Resource` rows → create DB/Redis/bucket;
   - removed rows → destroy (guarded, §10);
   - services restarted with freshly resolved + injected envs.
5. On success: flip resources `DRAFT/PROVISIONING → ACTIVE`, cache non-secret
   outputs, broadcast status over the existing WebSocket.

Reuses the Phase 2 `applyVariables` machinery (`variables.service.ts:540-650`)
and the infra processor (`infrastructure.processor.ts:113-175`), extended to
provision N resources instead of the binary flags.

### 3.6 liftoff.yml v3 (export/import)

Graph is authoritative; v3 is a round-trippable view for power users. Additive
over v2: named `resources[]` and per-service `bind:`.

```yaml
version: "3.0"
services:
  - name: api
    type: service
    runtime: { instance_size: apps-s-1vcpu-1gb, port: 4000 }
    routes: [{ path: /api }]
    bind: [main-db, cache]          # ← edges, by resource name
resources:
  - { name: main-db, kind: postgres, version: "15", size: db-s-1vcpu-1gb }
  - { name: cache,   kind: redis,    version: "7" }
links:                               # ← service→service edges
  - { from: api, to: web }           # injects INTERNAL_API_URL into web
```
v1/v2 auto-promote to v3 at parse time (extend `safeParseLiftoffConfigAny`);
`promoteV2ToV3` turns `database.enabled` → a `main-db` resource + `bind` on every
service (matching today's env-wide DB), `storage.enabled` → a bucket resource.

---

## 4. Pulumi component changes

`packages/pulumi-components/src/`:

- **NEW `database/managed-redis.ts`** — `ManagedRedis` component wrapping DO
  Managed Redis/Valkey (`digitalocean.DatabaseCluster` engine `redis`). Outputs
  `{ host, port, password, uri }`.
- **`stacks/app-platform-stack.ts`** — accept `resources: ResourceSpec[]` and
  provision **each** (multiple Postgres/Redis/buckets), not the single
  `config.database`/`config.storage`. Keep config flags working via promotion.
- **`app-platform/app-platform-app.ts`** — accept `bindings: Binding[]`; after
  resources are constructed, resolve each binding's `${...}` tokens against the
  source resource's outputs and append `SECRET` env entries to the target
  service (`buildServiceEnvs`, currently `:189-212`). Service-link bindings
  resolve to App Platform's internal hostname for the source service.
- Internal URL format for `SERVICE_LINK`: use App Platform's documented private
  hostname (`http://<component>.internal:<port>` within the App). **Verify the
  exact form against a live App during Phase B** before relying on it.

---

## 5. API surface

```
# Resources (graph nodes)
POST   /environments/:eid/resources            { kind, name, config? }    → DRAFT row
GET    /environments/:eid/resources
PATCH  /environments/:eid/resources/:rid        { name?, config? }
DELETE /environments/:eid/resources/:rid        (blocked if wired — see §10)

# Connections (graph edges)
POST   /environments/:eid/connections           { kind, sourceId, targetServiceId, injectConfig? }
GET    /environments/:eid/connections
PATCH  /environments/:eid/connections/:cid       { injectConfig? }
DELETE /environments/:eid/connections/:cid

# Apply the whole graph atomically (staged "Deploy")
POST   /environments/:eid/apply                  { resources?, connections? }  ← persists pending + reconciles

# Preview what an edge injects (UI affordance, no mutation)
GET    /environments/:eid/connections/:cid/preview   → { service, injectedVars: ["DATABASE_URL", ...] }

# Per-service metrics + scaling (Phase E)
GET    /services/:sid/metrics/{cpu|memory|bandwidth|restart-count}
PATCH  /services/:sid                            { instanceSize?, replicas?, command?, ... }

# Multi-repo (Phase F)
POST   /projects/:pid/repositories
GET    /projects/:pid/repositories
DELETE /projects/:pid/repositories/:repoId
```

All `@UseGuards(JwtAuthGuard)` + project-role checks (OWNER/ADMIN write,
DEVELOPER/VIEWER read). `getCanvas` rewritten to read `Service` + `Resource` +
`Connection` rows; `saveLayout` persists positions for **all** node kinds and is
extended to upsert edges.

---

## 6. Frontend

`apps/web/src/components/canvas/`:

- **Edges become real**: `onConnect` → `POST /connections` (optimistic), edge
  delete → `DELETE /connections/:cid`. Edges load from `Connection` rows, persist
  across reload. Edge **label shows injected vars** (`DATABASE_URL`); hover/click
  opens a small popover to rename/subset (`injectConfig`).
- **Edge validation**: only legal edges connect (Resource→Service, Service→Service;
  block Resource→Resource, self-loops, duplicates). Illegal drags snap back with a
  toast.
- **Resource nodes first-class**: command palette "Add Postgres/Redis/Bucket" →
  `POST /resources` (DRAFT) → node appears, draggable, position persists. New
  `resource-node.tsx` (or extend `database-node.tsx`) with status pill
  (DRAFT/PROVISIONING/ACTIVE/FAILED) and connection details.
- **Resource drawer**: size/version/eviction config, status, danger-zone delete
  (guarded). Reuses the drawer shell.
- **Service drawer — "Auto-injected" section**: read-only list of vars coming
  from inbound connections (e.g. "`DATABASE_URL` ← main-db"), visually distinct
  from user-set vault vars. Closes the "where did this var come from?" gap.
- **Staged changes → real apply**: `StagedChangesBar` "Deploy" calls
  `POST /apply` with queued resource/connection/scale edits; "Discard" deletes
  DRAFT rows. Nodes reflect live build/deploy/provision status over WebSocket.
- Fix the pre-existing `@xyflow/react` type/import errors surfaced in `pnpm --filter web typecheck` as part of Phase A (they block clean typechecks).

---

## 7. Migration & back-compat

Migration `<ts>_interactive_graph_foundation`:
- Create `resources`, `connections` tables + enums.
- **Backfill**: for every env whose stored config has `database.enabled = true`,
  insert a `Resource{ kind: POSTGRES, name: "<env>-db" or "main-db", status: ACTIVE }`
  (it's already provisioned) and a `Connection{ RESOURCE_BINDING }` to **every**
  service in the env (today's DB is env-wide). Same for `storage.enabled` →
  `SPACES_BUCKET`. Cache known outputs from `PulumiStack.outputs`.
- **No clobber**: the binding only contributes `DATABASE_URL` when the service has
  no user-set `DATABASE_URL` (precedence in §3.3 guarantees this) — so existing
  manually-wired envs are unchanged, and newly-modeled ones gain the convenience.
- Single-service envs with no DB are untouched. Every existing deploy path keeps
  working — Phase A changes the data model only, not behavior.

---

## 8. Phasing

Each phase is independently shippable; nothing leaves the platform half-broken.

### Phase A — Graph data model & persistence (foundation)
**Goal:** resources and edges are real, persisted DB rows; the canvas survives a
reload exactly as the user arranged it. No new deploy behavior.
- Prisma: `Resource`, `Connection`, enums; migration + backfill (§7).
- Backend: `ResourcesModule` + `ConnectionsModule` (CRUD); `CanvasService.getCanvas`
  reads rows instead of deriving edges from outputs; `saveLayout` persists all
  node positions + edges.
- Frontend: resource nodes + edges load from rows; drawing an edge persists;
  dragging a resource persists; fix `@xyflow/react` typecheck errors.
- **Accept:** add a Postgres node, drag it, draw an edge to a service, reload →
  node position and edge are still there. `doctl`/DB unchanged (no apply yet).

### Phase B — Wiring engine + atomic apply (**headline**)
**Goal:** drawing Postgres → service and clicking Deploy makes the service boot
with `DATABASE_URL` set, automatically.
- Shared: `binding-templates.ts` + types.
- Backend: `GraphCompilerService` (graph → Pulumi args + `bindings`), var-merge
  precedence, DAG/cycle validation, `POST /environments/:eid/apply`, connection
  preview endpoint.
- Pulumi: `app-platform-app.ts` resolves `bindings` → `SECRET` envs on target
  services; `app-platform-stack.ts` provisions resources from `ResourceSpec[]`.
- Frontend: edge create/delete → connection API; edge labels show injected vars;
  service drawer "Auto-injected" section; "Deploy" → `/apply`.
- **Accept:** new env → add Postgres node → edge to API service → Deploy → API
  comes up; a route echoing `process.env.DATABASE_URL` shows the managed DB URI.
  The user never typed a connection string.

### Phase C — Redis + multi-resource
**Goal:** Redis is a first-class node; an env can hold several named resources.
- Pulumi: `ManagedRedis` component.
- Schema/compiler: `REDIS` kind end-to-end; multiple DBs/buckets/redis per env;
  resource drawer config (size/version/eviction).
- **Accept:** add Redis, wire to a worker → `REDIS_URL` injected; two Postgres in
  one env, each wired to a different service, both resolve correctly.

### Phase D — Smart defaults / static sites / workers / jobs
*(absorbs old Phase 5 + this session's `command` gap)*
**Goal:** any repo deploys cleanly; workers/jobs/static nodes are real.
- Wire `Service.command` → `nixpacks --start-cmd` / App Platform `run_command`
  (fixes the "No start command could be found" failure).
- `static_site` kind → App Platform native `static_sites[]`; `worker` → `workers[]`;
  `job` → `jobs[]` with schedule. Promote the placeholder palette items to real.
- Parse Nixpacks `buildPlan` → detect port/start command → non-destructive
  "detected port 8080 — use it?" banner. Optional static Dockerfile suggestion
  (commit-on-click, never auto-write user repos — old P5.2).
- **Accept:** a plain static HTML repo deploys with zero config; a Node worker
  repo deploys as a `worker`; a cron repo runs on schedule.

### Phase E — Per-service metrics + scaling
*(old Phase 3)*
**Goal:** the drawer Metrics + Scale tabs operate on individual services.
- `DoApiService.getAppMetrics` accepts `component`; service-scoped metrics
  endpoints; Scale tab `PATCH /services/:sid` (instanceSize/replicas) → apply.
- **Accept:** scale a service 1→2 replicas in the UI; `doctl apps get` and the
  metrics chart reflect two instances.

### Phase F — Multi-repo + repo nodes
*(old Phase 4 — last; depends on a solid graph)*
**Goal:** one project links N repos, each contributing services to one App.
- Drop `Repository.projectId @unique`; make `Service.repositoryId` meaningful;
  repo nodes with repo→service edges; per-repo workflow + service matrix; webhook
  maps a push to all services of that repo+branch → one `DeploymentBundle`.
- **Accept:** a separate frontend repo and backend repo under one project deploy
  to one App with path routing (`/` → web, `/api` → api).

---

## 9. Decisions (resolved — defaults chosen so this runs without back-and-forth)

| # | Decision | Choice | Why |
|---|---|---|---|
| D1 | Edge direction | Target is always the **consumer Service** | Bindings flow *into* services; keeps the model and FKs simple |
| D2 | Where secrets resolve | **Inside Pulumi**, from live outputs | Connection secrets never touch the API/DB in plaintext |
| D3 | Outputs cache | Store **non-secret** fields only (host/port/bucket/endpoint) | UI display without leaking credentials |
| D4 | Var precedence | metadata < binding < env-vault < service-vault | Users always override auto-injection; safe migration |
| D5 | Default Postgres binding | `DATABASE_URL` only; `PG*` expansion opt-in via `injectConfig` | Clean env by default |
| D6 | Resource delete while wired | **Block** with "N services depend on this; remove edges first" | Predictable; mirrors old N3 |
| D7 | Source of truth | **Graph (DB rows)**; `liftoff.yml` v3 is export/import | Matches "canvas is the system" |
| D8 | Redis engine | DO Managed Redis/Valkey via `DatabaseCluster` | Native to DO; no new infra dep |
| D9 | DRAFT lifecycle | Resources created `DRAFT`; provisioned on apply; discard = delete row | Lets users arrange before committing spend |
| D10 | Service-link URL | App Platform internal hostname, **verified live in Phase B** | Avoid hardcoding an unverified format |
| D11 | One App per env | Unchanged | App Platform's atomic deploy/rollback + billing unit |

---

## 10. Risks & guardrails

- **Destroying a DB is irreversible.** Removing a Postgres node + Deploy would
  `pulumi destroy` the cluster. Guard: explicit typed confirmation in the UI
  ("type the resource name"), and on the API a `?confirm=` requirement; consider a
  final DO snapshot before destroy. Never destroy on a normal redeploy — only when
  the resource row is actually removed.
- **Binding var collisions.** Two resources injecting the same var into one
  service → compiler error unless one uses `injectConfig.rename`. Surface at edge
  creation, not deploy.
- **Service-link cycles.** Rejected at compile with the cycle path in the message.
- **Internal URL format drift.** D10 — verify against a live App before shipping
  Phase B's service-link injection.
- **Secret exposure via outputs cache.** D3 — schema/test must assert no secret
  fields are persisted to `Resource.outputs`.
- **Migration mis-wiring.** Backfill must respect precedence (no clobber, §7) and
  be idempotent; cover with a migration test on a seeded env.
- **Pre-existing test/typecheck debt** (webhooks.spec, infra.processor.spec,
  `@xyflow/react`, upload Multer/adm-zip) — clean up opportunistically in the phase
  that touches each; don't let it mask new regressions.

---

## 11. Execution notes (for the ultra run)

- Build phases **in order A→B→C→D→E→F**; each ends green on `pnpm --filter api
  typecheck` + `pnpm --filter web typecheck` and its acceptance test.
- The infra runner ts-node-compiles `packages/pulumi-components/src` live — it's
  volume-mounted into `liftoff_api` (see the Pulumi-mount memory). After Pulumi
  component changes, verify the container sees them.
- Reuse, don't reinvent: `EncryptionService` (vault), `DeploymentBundle` +
  `infrastructure.processor` (apply), the WebSocket gateway (status), the existing
  drawer shell + React Flow wiring.
- Each phase's first task is a short **Understand** pass over the files it will
  change; last task is the acceptance test above.
```
