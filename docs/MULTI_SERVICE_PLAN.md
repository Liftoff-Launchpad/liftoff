# Plan: Multi-Service, Multi-Repo, and Vault Support

> **What this proposes:** evolve Liftoff from "1 env = 1 repo = 1 service" to "1 project = N repos = M services per env, with persistent encrypted env vars and per-service metrics." Phased so the existing single-service flow keeps working end-to-end at every step.

---

## TL;DR

Today the **shape** of a deployable thing is hardcoded everywhere:
- `Repository.projectId` is `@unique` → one repo per project
- `LiftoffConfig` has a single `service`/`runtime`/`build` block
- `createAppPlatformStack` produces one DO `App` with one `services[]` entry
- The workflow generator builds one image per push
- The Canvas renders one service node per env
- The Variables drawer stages local edits that **never persist anywhere**

To support monorepos with multiple services, multi-repo projects, and real env-var/secret management, every one of those needs to become multi-cardinal — but DO App Platform itself already supports the target shape (multiple `services[]`/`workers[]`/`jobs[]` per `App`, each with its own image source), so the cloud side isn't the constraint.

Recommended target: **one App Platform `App` per environment**, with multiple `services[]` inside it, each potentially built from a different repo. Vault is encrypted columns in Postgres (same pattern as DO tokens via `EncryptionService`). 5 phases, each individually shippable.

---

## Current state — what's wired vs what's mocked

| Area | Today | Where |
|---|---|---|
| Repo per project | **One** (unique constraint) | `apps/api/prisma/schema.prisma:122` (`Repository.projectId @unique`) |
| Services per env | **One** | `LiftoffConfigSchema.service` in `packages/shared/src/schemas/liftoff-yml.schema.ts` |
| Build matrix | Single image per workflow run | `apps/api/src/repositories/workflow-generator.service.ts:46` |
| Pulumi shape | One `App` with one `services[0]` | `packages/pulumi-components/src/app-platform/app-platform-app.ts:63` |
| Workers / cron | Not modeled | (Nothing) |
| Env vars (values) | **Not persisted anywhere** | Drawer stages locally → `apps/web/src/components/canvas/staged-changes/staged-changes-store.ts` → never sent |
| Secrets (values) | Schema accepts `secrets: [name]` (refs only); values never set | `liftoff-yml.schema.ts:84`, `app-platform-app.ts:145` (SECRET env wired but value === name) |
| Per-service metrics | Single env → one App → one set of metrics | `apps/api/src/monitoring/monitoring.service.ts:68` |
| Service-to-service links | UI shows `${{ node.var }}` autocomplete, no compiler | `drawer-variables-tab.tsx:75` |
| Custom domains | Drawer accepts input, ignored backend-side | `drawer-settings-tab.tsx:189` |
| Scaling changes | `addChange` stages locally, no apply | `drawer-settings-tab.tsx:75` |
| Multiple repos on one project | Impossible (DB constraint) | Schema unique |

What **does** work today: one repo → one service → Dockerfile or Nixpacks → DOCR → App Platform → live URL. The first deploy you just did is proof.

---

## Target architecture

### One `App` per `Environment`, many `Service`s per `App`

DO App Platform's `App` resource accepts:
- `services[]` — HTTP services, each with `name`, `image`, `httpPort`, `instanceCount`, `instanceSizeSlug`, `envs[]`, `healthCheck`, `routes[]`
- `workers[]` — non-HTTP long-running processes
- `jobs[]` — pre/post-deploy or cron jobs
- `databases[]`, `domains[]`, `static_sites[]`

So a monorepo's frontend, API, and worker can all live inside **one** `digitalocean.App` deployment, each as a different entry, sharing networking, env injection, and a single deploy lifecycle. This is also App Platform's natural unit of billing/rollback. Multi-repo works the same way — every repo just contributes one or more entries to the same App's spec, even if they're built by different GitHub Actions workflows.

### Data model evolution

```
Project ─┬─ ProjectRepository[]    (was: 1:1 Repository — drop unique)
         │      └─ Repository (githubId, fullName, branch, webhookId, webhookSecret)
         │
         ├─ Environment
         │     ├─ Service[]                    ← NEW
         │     │     ├─ projectRepositoryId? (which repo to build from; null = static-only)
         │     │     ├─ kind: SERVICE | WORKER | JOB | STATIC_SITE
         │     │     ├─ name, sourceDir, buildStrategy, dockerfilePath, port,
         │     │     │   instanceSize, replicas, healthcheckPath, routePath,
         │     │     │   workerCommand?, jobSchedule?
         │     │     ├─ ServiceVariable[]      ← NEW (encrypted)
         │     │     │     └─ key, encryptedValue, scope: BUILD|RUNTIME|BOTH,
         │     │     │        kind: PLAIN|SECRET, isLinked, linkedTo?
         │     │     ├─ ServiceDomain[]        ← NEW
         │     │     ├─ canvasPosition          (move from Env to Service)
         │     │     └─ Deployment[]           ← scoped per service
         │     │
         │     ├─ EnvironmentVariable[]        ← NEW (shared across services)
         │     ├─ PulumiStack                  (still 1:1 with env)
         │     ├─ InfrastructureResource[]
         │     └─ DeploymentBundle[]           ← NEW: groups per-service Deployments into one env-level deploy
```

Key invariants:
- One `Environment` ↔ one DO `App` ↔ one `PulumiStack`
- `Service` rows define the contents of that App's spec
- `Deployment` becomes per-service (which service got which image at what time); a `DeploymentBundle` represents "we rolled this set of services together" for atomic rollback
- `EnvironmentVariable` rows are env-wide vars injected into every service; `ServiceVariable` overrides them per-service
- `ProjectRepository` lets a project link multiple repos, each with its own webhook + workflow file

### LiftoffConfig v2 (additive — v1 stays valid via auto-upgrade)

```yaml
version: "2.0"

# Optional metadata about where services live
sources:
  - id: web
    repository: mohdzez/edgeLedger
    branch: main
  - id: api
    repository: mohdzez/edgeLedger-api
    branch: main

services:
  - name: frontend
    source: web                    # references sources[].id; omit if single-repo project
    type: service                  # service | worker | job | static_site
    runtime:
      instance_size: apps-s-1vcpu-0.5gb
      replicas: 1
      port: 3000
    build:
      strategy: auto               # auto | dockerfile | nixpacks
      dockerfile_path: web/Dockerfile
      context: web
    healthcheck:
      path: /
    routes:
      - path: /
    env:
      NODE_ENV: production
      API_URL: ${{ services.api.internal_url }}    # service-to-service link
    secrets:
      - STRIPE_KEY

  - name: api
    source: api
    type: service
    runtime:
      instance_size: apps-s-1vcpu-1gb
      port: 4000
    build:
      strategy: dockerfile
      context: .
    routes:
      - path: /api
    env:
      DATABASE_URL: ${{ resources.db.uri }}

  - name: worker
    source: api
    type: worker
    build:
      strategy: dockerfile
      context: worker
    command: node worker.js

  - name: cleanup-cron
    source: api
    type: job
    kind: pre_deploy               # cron | pre_deploy | post_deploy | failed_deploy
    schedule: "0 3 * * *"
    command: node scripts/cleanup.js

resources:
  db:
    type: postgres
    version: "15"
    size: db-s-1vcpu-1gb
  bucket:
    type: spaces
```

V1 configs (`version: "1.0"` with single `service`/`runtime`/`build`) get auto-promoted at parse time into one v2 service named after `service.name`. No user migration needed for existing envs.

---

## Pulumi component changes

Today `createAppPlatformStack(args)` takes one `LiftoffConfig` with one `service` block and builds:
- 1× `DocrRepository` (registry creds + repo URL)
- Optional 1× `ManagedPostgres`
- Optional 1× `SpacesBucket`
- 1× `AppPlatformApp` with `services: [oneService]`

**Target:**

```ts
createAppPlatformStack(args: {
  ...meta,
  config: LiftoffConfigV2,
  serviceImages: Record<string, string>,   // serviceName → fully-qualified DOCR image URI
}) => {
  appId, appUrl, services: Record<string, { internalUrl, externalUrl }>,
  resources: { db?, bucket? }
}
```

Inside, instead of one `services: [...]`, the `AppPlatformApp` component builds the spec by iterating `config.services[]` and dispatching by `type`:
- `service` → entry in `services[]` (with route)
- `worker` → entry in `workers[]`
- `job` → entry in `jobs[]` with `kind` + `schedule`
- `static_site` → entry in `static_sites[]` (App Platform's native static hosting, no container needed — direct from a build output dir)

Image source can be either DOCR (built by Liftoff) or DO App Platform's git-based source for ultra-simple cases. We default to DOCR.

Env injection per service merges `EnvironmentVariable[]` (env-wide) with `ServiceVariable[]` (per-service overrides), resolves `${{ services.x.internal_url }}` placeholders against App Platform's predictable internal hostnames (`<service>.internal.<app-id>.ondigitalocean.app`), and tags secrets as `SECRET` type.

`Deployment` rows reference both an `environmentId` and a `serviceId`, so the existing image-patch logic in `deployments.processor.ts:362` (`buildUpdatedAppSpec` → `patchImageCollection`) just needs to patch the entry matching the deployed service's name rather than every services/workers/jobs entry.

---

## Workflow / build pipeline

Each `ProjectRepository` has its own `.github/workflows/liftoff-deploy.yml`. The generator changes from "build one image" to "build N images" — one per `Service` whose `source` matches this repository.

```yaml
# liftoff-deploy.yml (regenerated)
on:
  push:
    branches: [main]

jobs:
  build:
    strategy:
      matrix:
        service:
          - { name: frontend, dockerfile: web/Dockerfile, context: web,    strategy: dockerfile }
          - { name: worker,   dockerfile: worker/Dockerfile, context: worker, strategy: dockerfile }
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - <doctl + DOCR login>
      - <build + push to DOCR with image tag including service.name>
      - <curl deploy-complete with per-service payload>
```

Backend changes:
- `WorkflowGeneratorService.generate` accepts `services: GenerateServiceBuild[]` instead of single build config
- `WebhooksController.deploy-complete` DTO accepts an array of `{ serviceName, imageUri, commitSha, status, buildStrategy, buildPlan }` — or stays single-item but is called once per matrix job (simpler, less change)
- `WebhooksService.handleDeployComplete` looks up `Service` by `(environmentId, serviceName)` and updates that service's latest `Deployment`
- `DeploymentBundle` aggregates: once all repos for an env have reported, kick the Pulumi `up` (or wait for a "deploy bundle" timeout)

For monorepos, `paths:` filters per matrix entry can avoid rebuilding services that didn't change. (Phase 2 polish.)

---

## Vault — encrypted env vars and secrets

### Storage

```prisma
model ServiceVariable {
  id              String   @id @default(cuid())
  serviceId       String   @map("service_id")
  key             String
  encryptedValue  String   @map("encrypted_value")    // AES-256-GCM via EncryptionService
  scope           VarScope @default(RUNTIME)           // BUILD | RUNTIME | BOTH
  kind            VarKind  @default(PLAIN)              // PLAIN | SECRET (SECRET hides value in UI)
  linkedTo        Json?    @map("linked_to")            // {serviceId, outputKey} for ${{...}} refs
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")
  service         Service  @relation(fields: [serviceId], references: [id], onDelete: Cascade)

  @@unique([serviceId, key])
  @@map("service_variables")
}

model EnvironmentVariable {
  id              String   @id @default(cuid())
  environmentId   String   @map("environment_id")
  key             String
  encryptedValue  String   @map("encrypted_value")
  scope           VarScope @default(RUNTIME)
  kind            VarKind  @default(PLAIN)
  // ... same shape, env-scoped

  @@unique([environmentId, key])
  @@map("environment_variables")
}
```

### API surface

```
GET    /environments/:eid/variables                   List env-wide vars (values redacted for SECRET kind)
PUT    /environments/:eid/variables                   Bulk replace
PATCH  /environments/:eid/variables/:key              Update one
DELETE /environments/:eid/variables/:key

GET    /services/:sid/variables                       Per-service
PUT    /services/:sid/variables
PATCH  /services/:sid/variables/:key
DELETE /services/:sid/variables/:key

GET    /environments/:eid/variables/resolved          DEBUG: shows fully resolved env per service
                                                       (with secrets redacted unless explicit consent)
```

All endpoints `@UseGuards(JwtAuthGuard)` + project-role check (OWNER/ADMIN can write; DEVELOPER/VIEWER read with redaction).

### How it gets to the app

- **RUNTIME vars** → injected into App Platform service `envs[]` (as `GENERAL` or `SECRET` type)
- **BUILD vars** → uploaded to GitHub Actions secrets (so `docker build --build-arg` or `nixpacks build --env` can use them)
- **Both** → both places
- Re-applied on every Pulumi `up`; build-time vars synced to GitHub on every variable mutation (since they need to exist before the next push)

### Linked variables

`${{ services.api.internal_url }}` is resolved at Pulumi compile time using App Platform's deterministic internal URL pattern. `${{ resources.db.uri }}` uses Pulumi stack outputs. Reject cycles (linked var graph must be a DAG; checked in the variables-resolver service).

### Encryption

Reuse `EncryptionService` (AES-256-GCM, `ENCRYPTION_KEY` 64 hex chars). Same pattern as `DOAccount.doToken`. Values are never returned in plaintext from the API — for `kind: SECRET`, the API returns `"<encrypted>"` or `null` to UI; for `kind: PLAIN`, the actual value can show. (Bigger envs might want HashiCorp Vault or DO's own Secret Manager — that's a v3 conversation; in-house keeps parity with how DO tokens already work.)

---

## Per-service metrics

DO's monitoring API endpoints accept a `component_name` query param:
- `GET /v2/monitoring/metrics/apps/cpu_percentage?app_id=...&app_component=<service-name>`
- Same for memory_percentage, restart_count, etc.

Today `DoApiService.getAppMetrics` doesn't pass `app_component`, so it aggregates everything. Change:

```ts
getAppMetrics(token, appId, metricType, doAccountId?, component?: string)
```

API:
```
GET /environments/:eid/services/:sid/metrics/cpu
GET /environments/:eid/services/:sid/metrics/memory
GET /environments/:eid/services/:sid/metrics/bandwidth
GET /environments/:eid/services/:sid/metrics/restart-count
```

Old env-level endpoints stay (return aggregate across all services for back-compat).

Frontend: `drawer-metrics-tab.tsx` already exists per node; just needs to call the service-scoped endpoints when `selectedNode.type === 'service'`.

---

## Canvas / UI changes

### Canvas (`apps/web/src/components/canvas/`)

- `CanvasService.getCanvas` (server) emits one `service`-type node per `Service` row + the existing `database/redis/storage` child nodes from Pulumi outputs.
- Add a `repo` node type — one per `ProjectRepository`; edges from `repo → service` show which repo builds which service.
- `staged-changes-store.ts` becomes the source of truth for unsaved edits; `StagedChangesBar` "Deploy" button does a `POST /environments/:eid/apply` that:
  1. Persists all staged variable/scaling/domain changes
  2. Re-runs Pulumi (if structural changes)
  3. Triggers per-service deployments for services whose image/build changed

### Drawer (`apps/web/src/components/canvas/config-drawer/`)

| Tab | Current | After |
|---|---|---|
| Variables | Local-only edits, no persistence | Real CRUD against `/services/:sid/variables`; SECRET kind toggle; linked-var autocomplete resolves to actual node outputs |
| Settings — Source | Mock "Disconnect" | Real repo picker (which `ProjectRepository` to build from), `sourceDir` field, build strategy override per service |
| Settings — Networking | Local domain input | Real CRUD against `/services/:sid/domains`; DNS verification status from App Platform spec |
| Settings — Scale | Stages change, no apply | Real `PATCH /services/:sid` with `instanceSize`/`replicas`; triggers a Pulumi up |
| Metrics | Env-scoped | Service-scoped |
| Deployments | Env's deployment list | Service's deployment list |

### Add new node types

The `command-palette.tsx` already has slots for postgres/redis/storage/worker/cron/empty-project. Wire the worker/cron ones to actually create `Service` rows with `type: WORKER` / `type: JOB`. Add a "Service from existing repo" and "Service from new repo" action.

---

## API surface deltas

### New endpoints

```
# Services
POST   /environments/:eid/services
GET    /environments/:eid/services
GET    /services/:sid
PATCH  /services/:sid
DELETE /services/:sid

# Variables (env + service scopes)
GET    /environments/:eid/variables
PUT    /environments/:eid/variables
PATCH  /environments/:eid/variables/:key
DELETE /environments/:eid/variables/:key
GET    /services/:sid/variables
PUT    /services/:sid/variables
PATCH  /services/:sid/variables/:key
DELETE /services/:sid/variables/:key
GET    /environments/:eid/variables/resolved

# Domains
GET    /services/:sid/domains
POST   /services/:sid/domains
DELETE /services/:sid/domains/:domainId

# Multi-repo
POST   /projects/:pid/repositories                    (was POST /projects/:pid/repository)
GET    /projects/:pid/repositories
DELETE /projects/:pid/repositories/:repoId

# Service-scoped metrics + deployments
GET    /services/:sid/metrics/{cpu|memory|bandwidth|restart-count}
GET    /services/:sid/deployments
POST   /services/:sid/deployments/trigger

# Apply staged changes atomically
POST   /environments/:eid/apply
```

### Modified

- `POST /webhooks/deploy-complete` — accept array form `{ services: [{ name, imageUri, ... }] }` OR keep single-item but call per matrix job (less change, keeps GitHub Actions YAML simple). I'd start with **single-item, called N times**, and aggregate server-side via `DeploymentBundle`.
- `POST /projects/:pid/canvas/auto-setup` — if project already has the repo, register it as an additional `ProjectRepository`; for single-service repos, behave exactly as today (no breaking change).

### Deprecated (but kept working)

- The single-`Repository`-per-project endpoints (`/projects/:pid/repository`) keep working — they just become aliases for "the first/default repository" of the project. Remove after v2 UI fully ships.

---

## Phasing

Each phase should be shippable on its own — no half-broken intermediate states. Single-service single-repo deploys keep working through every phase.

### Phase 1 — Multi-service per env (single repo)

**Goal:** monorepo where one repo defines 2+ services (e.g., frontend + API), all deployed to one App Platform app.

Files / changes:
- **Prisma:** add `Service`, `ServiceVariable`, `EnvironmentVariable` models; add migration; move `canvasPosition` from `Environment` to `Service`; deployment gains `serviceId` (nullable for back-compat); add `DeploymentBundle`
- **Shared schema:** `LiftoffConfigSchema` v2 with `services: []`; add v1→v2 auto-upgrade helper `promoteV1ToV2(rawConfig)`
- **Default seed:** `environments.service.ts:369` `buildDefaultEnvironmentConfig` emits a v2 config with one service named after the project
- **Canvas service:** `getCanvas` emits one node per `Service`; `autoSetup` creates the default `Service` row
- **Pulumi component:** rewrite `app-platform-app.ts` to take `services: ServiceSpec[]` and build `services[]`/`workers[]`/`jobs[]` arrays in the DO spec
- **Pulumi runner:** pass per-service image URIs (still one image for now; matrix in phase 4)
- **Webhook deploy-complete:** add optional `serviceName` to DTO; if absent, defaults to the first service in the env (back-compat)
- **Deployments processor:** patch only the matching service's image slot
- **Frontend:** canvas renders multiple service nodes; drawer "Source" tab gets a real `sourceDir` field

**Test:** create an env with two services, configure each to point at a different folder, push → both build → both deploy in one App.

### Phase 2 — Vault: persistent env vars + secrets

**Goal:** "Variables" tab actually persists and reaches the app.

Files / changes:
- **Prisma:** `ServiceVariable`, `EnvironmentVariable` (created in phase 1 but unused) become first-class
- **Variables service** (`apps/api/src/variables/variables.service.ts` + module): CRUD with role checks, encryption via `EncryptionService`
- **Variables controllers:** env-scoped + service-scoped
- **Variable resolver service:** walks `${{ ... }}` references, detects cycles, produces flat `Record<string, string>` per service
- **Pulumi component:** accept resolved env per service; emit `GENERAL` or `SECRET` env entries
- **GitHub Actions secrets sync:** when a `scope: BUILD` or `scope: BOTH` variable is created/changed, upsert it as a repo Actions secret (reuse `GitHubService.upsertActionsSecret`)
- **Apply endpoint:** `POST /environments/:eid/apply` runs Pulumi up + reapplies env (no rebuild needed)
- **Frontend:** rewire `drawer-variables-tab.tsx` to real mutations; add SECRET visibility toggle; linked-var autocomplete reads `outputs` from siblings

**Test:** set `DATABASE_URL` on the API service, deploy, hit a route in the API that prints `process.env.DATABASE_URL`.

### Phase 3 — Per-service metrics + scaling

**Goal:** drawer metrics + scale controls actually apply.

Files / changes:
- **DoApiService:** `getAppMetrics` accepts `component` arg
- **Monitoring service + controller:** new service-scoped endpoints
- **Services service:** `PATCH /services/:sid` accepts `instanceSize`, `replicas`, `healthcheckPath`, `routePath`; persists + triggers Pulumi up
- **Frontend:** drawer Scale tab → real mutation; metrics tab uses service-scoped endpoints

**Test:** scale a service from 1→2 replicas via UI, confirm `doctl apps get …` shows the change and metrics chart shows 2 instances.

### Phase 4 — Multi-repo per project

**Goal:** one project links N repos, each contributing services.

Files / changes:
- **Prisma:** drop `Repository.projectId @unique`; new `ProjectRepository` join model (or just lift the constraint); `Service.repositoryId?` references which repo it builds from
- **Repositories service:** `connect` no longer requires "no existing repo"; supports adding additional repos to an existing project
- **Workflow generator:** when emitting `.github/workflows/liftoff-deploy.yml` for a repo, includes a `matrix.service` with all services whose `repositoryId` matches that repo
- **Webhook handler:** GitHub push event finds **all** services that map to the pushed repo+branch, creates one `Deployment` per service, aggregates into a `DeploymentBundle`
- **Canvas service:** emits `repo`-type nodes with edges to dependent services
- **Frontend:** canvas command palette gets "Add repository" action; setup wizard supports picking multiple repos

**Test:** monorepo-frontend + monorepo-backend (separate repos) under one project, both deploy to one App Platform app with path routing (`/api` → backend, `/` → frontend).

### Phase 5 — Smart defaults, static sites, workers, jobs

**Goal:** any repo deploys cleanly without manual config.

Files / changes:
- **Schema:** add `kind: STATIC_SITE | SERVICE | WORKER | JOB` and per-kind defaults (static site → no healthcheck, App Platform native static hosting; worker → no port; job → cron schedule field)
- **Healthcheck:** become fully optional in the App Platform spec when omitted → DO uses TCP probe
- **Nixpacks build plan parsing:** after build, persist `buildPlan` → infer port + start command → suggest config update in UI (don't auto-apply, just show a "detected port: 8080, want to use it?" banner)
- **Dockerfile templates:** add `static.ts` (nginx) to `packages/shared/src/dockerfile-templates/`; auto-inject for static-detected repos that have no Dockerfile, no `package.json`, just `*.html`
- **Workers/jobs:** add command palette actions + drawer config; map to `workers[]`/`jobs[]` in Pulumi
- **Per-AppType default config:** `wizard-defaults.ts` gets extended to include `static`, `worker`, `cron` kinds

**Test:** plain static HTML repo deploys without any config edits; a Node worker repo deploys as `workers[]`; a cron repo runs on schedule.

---

## Decisions / tradeoffs

| Decision | Recommendation | Why |
|---|---|---|
| One `App` per env vs one `App` per service | **One per env** | Native to App Platform, single billing unit, atomic rollback, internal networking out of the box. Costs more per env but matches the user mental model of "this environment." |
| Multi-repo: shared App or app-per-repo? | **Shared App** | Same reasoning. The repos are linked at the env level, not the deploy unit. |
| Secrets storage | **Postgres column, AES-256-GCM (in-house)** | Parity with how `DOAccount.doToken` already works; no new infra dep. Phase 6+ could swap for HashiCorp Vault or DO Secret Manager behind the same `VariablesService` interface. |
| LiftoffConfig v1 → v2 | **Auto-upgrade at parse time, never write v1 again** | Avoids forcing users to edit YAML; v1 envs keep working forever. |
| Per-service vs per-env webhooks | **Per-repo webhook (unchanged)** | One webhook per `ProjectRepository`. Inside, find all services for that repo+branch and dispatch per-service deployments. |
| Bundling per-service deploys into one App Platform deploy | **Yes — `DeploymentBundle`** | App Platform deploys are atomic by spec — when we run `pulumi up`, ALL services in the spec re-deploy. So the natural unit is "all services with new images get applied together." Track the bundle for rollback (one App Platform deployment ID → many image versions). |
| Variable scopes | **BUILD / RUNTIME / BOTH** | Build-time vars need GitHub Actions secret upserts; runtime-only stays in our DB and is injected per Pulumi run. Both is rare but valid (DB URL needed at both `npm run build` for static gen and at runtime). |
| Linked variables resolution | **At Pulumi compile time, not at runtime** | App Platform sets env vars statically. Refs like `${{ services.api.internal_url }}` get baked at deploy time. Cycle detection happens at apply time, returning a clear error. |

---

## Open questions for you

1. **Static sites:** Do you want to use App Platform's native static site hosting (`static_sites[]` — cheaper, faster, no container) when the kind is static, or always go through the container path? I'd default to native static, container as opt-out — but it changes the cost model.
2. **Routing:** When multiple services share one App, do you want path-based routing (`/api → api service, / → frontend`) as default, or subdomain-based (`api.<env>.ondigitalocean.app`)? Path-based is simpler and free; subdomains need DO domain config.
3. **Default service scaling on monorepo split:** if a user has a monorepo with frontend + API + worker, should each default to its own service node, or do we offer "I'll figure it out — just deploy something" mode that picks one entry point?
4. **Phase order:** the order above is "build the data model out, then wire the UI" — does that match what you'd want shown in demos along the way? An alternative is to do Phase 2 (vault) first as it has the most visible UX impact even on a single-service env.
5. **Scope of "any repo deployable":** does that include static-only sites without any backend (App Platform native static hosting), or only containerized apps? Phase 5 currently assumes "yes to native static."
6. **Service-to-service networking:** do you want public service URLs (each gets its own subdomain) or only internal-by-default with explicit `routes: [path: ...]` per service to expose? Internal-by-default is safer.

Let me know which of these matter most and I'll narrow the next steps. Otherwise, my suggested order is: **Phase 2 (vault, big visible win) → Phase 1 (multi-service) → Phase 3 (metrics+scale) → Phase 5 smart defaults → Phase 4 multi-repo** — leading with what makes the existing single-service path noticeably better before introducing more cardinality.
