# AGENT.md — Liftoff Full Context Map

> **What this is:** a self-contained reference of how the Liftoff codebase is wired so a fresh agent (or future-me) can navigate it without re-reading every file. Companion to `CLAUDE.md` (rules) — this is the *map*. File paths use `file_path:line` so they're clickable in Claude Code.

---

## 1. The 30-second summary

Liftoff is a **Deploy-as-a-Service** platform. Developers paste a DigitalOcean API token, connect a GitHub repo, and Liftoff:

1. Generates a GitHub Actions workflow that builds the user's image (Dockerfile-first, **Nixpacks** fallback) and pushes to the user's DOCR.
2. The workflow calls back to Liftoff (`/webhooks/deploy-complete`) with the image URI.
3. Liftoff runs a **Pulumi subprocess** that provisions a DO App Platform app **in the user's own DO account** using `new digitalocean.Provider({ token: userToken })`.
4. Liftoff updates the App Platform spec with the new image and polls until it goes `ACTIVE`.
5. State + logs stream over Socket.io to the React Flow **canvas UI** (Railway-style).

**Everything is DigitalOcean.** No AWS — Pulumi state lives in DO Spaces using the S3-compatible API, that's the only S3-shaped thing.

---

## 2. Repository layout

```
liftoff/
├── apps/
│   ├── api/                 NestJS 10 backend, port 4000
│   └── web/                 Next.js 14 (App Router), port 3000
├── packages/
│   ├── shared/              Shared types, Zod schemas, error codes, WS events, dockerfile templates
│   ├── pulumi-components/   Reusable Pulumi DO components (App Platform, Postgres, DOCR, Spaces)
│   └── config/              Shared tsconfig bases
├── infra/                   Pulumi program for the LIFTOFF PLATFORM itself (not user infra)
├── docs/                    Architecture, env reference, phases
├── prisma → apps/api/prisma Schema lives under apps/api
├── docker-compose.yml       Local dev: Postgres 15, Redis 7, api, web (with hot-reload volume mounts)
├── Dockerfile.api           Multi-stage; production image includes Pulumi CLI (alpine + curl install)
├── Dockerfile.web           Multi-stage Next.js
├── .github/
│   ├── copilot-instructions.md   ← READ THIS for rules; this AGENT.md is the map
│   └── workflows/deploy-platform.yml   Builds liftoff itself, pushes to liftoff DOCR
├── pnpm-workspace.yaml      packages/* + apps/*
└── turbo.json               build/dev/test/lint/typecheck/clean tasks
```

Tooling: **pnpm 9 + Turborepo + TypeScript strict + Node 20**. Each app/package has its own `package.json`. `dev` uses `nest start --watch` for API and `next dev` for web.

---

## 3. apps/api — the NestJS backend

### 3.1 Bootstrap

| File | Purpose |
|---|---|
| `apps/api/src/main.ts` | Bootstraps Nest with `rawBody: true` (needed for GitHub webhook HMAC), helmet, CORS to `FRONTEND_URL`, cookie-parser, global `ValidationPipe` (whitelist + transform), global `HttpExceptionFilter`, `LoggingInterceptor`, Swagger at `/api/docs` (dev only). URI versioning, default `v1`. Listens on `PORT` (default 4000). |
| `apps/api/src/app.module.ts` | Wires every feature module. **Joi-validates all env vars at startup** (lines 36–62). Registers BullMQ root with `REDIS_URL`, Throttler (default 100 req/60s), `@nestjs/schedule` for cron, and a global `LiftoffThrottlerGuard`. |
| `apps/api/src/app.controller.ts` | `GET /health` (public) and `GET /health/detailed` (Postgres + Redis ping). |

### 3.2 Module wiring (root → leaves)

`AppModule` imports: `PrismaModule`, `CommonModule`, `DoApiModule`, `QueuesModule`, `EventsModule`, `AuthModule`, `UsersModule`, `ProjectsModule`, `EnvironmentsModule`, `RepositoriesModule`, `DeploymentsModule`, `DOAccountsModule`, `InfrastructureModule`, `MonitoringModule`, `WebhooksModule`, `UploadModule`, `PipelineModule`, **`CanvasModule`** (apps/api/src/app.module.ts:103).

### 3.3 Feature modules

#### Auth — `apps/api/src/auth/`
- **Flow:** GitHub OAuth → JWT access (15 min, in-memory) + refresh (7d, HTTP-only cookie). Refresh tokens are persisted, **bcrypt-hashed**, and single-use (rotated on every refresh).
- `auth.controller.ts` — `GET /auth/github`, `GET /auth/github/callback` (sets refresh cookie, redirects to `${FRONTEND_URL}/auth/callback?token=…`), `POST /auth/refresh`, `DELETE /auth/logout`.
- `auth.service.ts:30` `generateTokens` — issues access JWT, then a refresh JWT with random `jti`, hashes it, persists to `refresh_tokens` table.
- `auth.service.ts:68` `refreshTokens` — validates record, revokes the old one (`updateMany` for race safety), issues a new pair.
- `strategies/github.strategy.ts` — Passport scopes: `read:user user:email repo write:repo_hook workflow` (needed to create Actions secrets + commit workflow file).
- `strategies/jwt.strategy.ts` — bearer-from-header, looks up user by `payload.sub`.
- `strategies/jwt-refresh.strategy.ts` — pulls refresh token from cookie, verifies + bcrypt-compares against stored hash.

#### Users — `apps/api/src/users/`
- `users.service.ts:34` `findOrCreateFromGitHub` — upsert on `githubId`. Stores the **GitHub access token encrypted** (AES-256-GCM) in `users.github_token` — needed later for creating webhooks/Actions secrets on the user's behalf.
- `users.controller.ts` — `GET /users/me`, `PATCH /users/me`, soft delete.

#### DO Accounts — `apps/api/src/do-accounts/`
- `do-accounts.service.ts:39` `create` — validates token via `GET /v2/account`, then **encrypts and stores** (`doToken` column).
- `do-accounts.service.ts:105` `validate` — re-validates an existing token; clears `validatedAt` if 401.
- `do-accounts.service.ts:168` `getDecryptedToken` — returns plaintext for internal use; **never exposed via API responses** (`DOAccountResponseDto` omits `doToken`).
- `do-accounts.controller.ts` — `POST /do-accounts`, `GET`, `GET /:id`, `POST /:id/validate`, `DELETE /:id`.

#### Projects — `apps/api/src/projects/`
- `projects.service.ts:66` `create` — wraps in `$transaction` to also create the OWNER `TeamMember`.
- `projects.service.ts:244` `assertProjectRole(projectId, userId, allowedRoles?)` — **central RBAC check** used by every other module before mutating project-scoped data.
- Roles (Prisma enum): `OWNER`, `ADMIN`, `DEVELOPER`, `VIEWER`. Owner is automatic; team membership lives in `team_members`.
- `projects.controller.ts` — `POST /projects`, `GET /projects` (paginated), `GET /:id`, `PATCH /:id`, `DELETE /:id` (soft delete; cascades soft-delete to environments).

#### Environments — `apps/api/src/environments/`
- `environments.service.ts:87` `create` — asserts OWNER/ADMIN, asserts DO account ownership, generates a per-environment **liftoff deploy secret** (encrypted, used by GitHub Actions webhook callback), seeds a default `liftoff.yml`, then `syncRepositoryActionsSecretsIfConnected` upserts `LIFTOFF_DEPLOY_SECRET` and `DIGITALOCEAN_ACCESS_TOKEN` to the connected repo's Actions secrets.
- `environments.service.ts:268` `updateConfig` — validates YAML against `LiftoffConfigSchema` (Zod), persists both `configYaml` and `configParsed`.
- `environments.service.ts:306` `validateConfig` — same validation, no write.
- `environments.controller.ts` — full CRUD plus `PUT /:id/config` and `POST /:id/config/validate`.

#### Repositories — `apps/api/src/repositories/`
- `github.service.ts` — pure HTTP wrapper around GitHub REST (`api.github.com`). Notable methods:
  - `listRepositories`, `getRepository`, `createRepository`, `pushFiles` (Git Data API for multi-file commit), `commitFile` (single-file PUT)
  - `createWebhook`, `getWebhook`, `updateWebhookUrl`, `deleteWebhook`
  - `upsertActionsSecret` — uses **libsodium sealed-box** to encrypt secret with the repo's public key before PUT
  - `verifyWebhookSignature` — HMAC-SHA256 with `timingSafeEqual`, requires `sha256=` prefix
- `repositories.service.ts:75` `connect`:
  1. Asserts OWNER/ADMIN, generates a 20-byte HMAC `webhookSecret`, encrypts it
  2. Calls `githubService.createWebhook` (URL = `${WEBHOOK_BASE_URL}/api/v1/webhooks/github`, events `push, pull_request`)
  3. In a DB transaction creates the `Repository` row and assigns a deploy secret per environment
  4. Upserts `LIFTOFF_DEPLOY_SECRET` and `DIGITALOCEAN_ACCESS_TOKEN` Actions secrets
  5. Generates and commits `.github/workflows/liftoff-deploy.yml` via `WorkflowGeneratorService`
  6. On any post-DB error: rolls back GitHub webhook + DB row
- `repositories.service.ts:64` `onModuleInit` → `syncWebhookUrlsOnBoot` — on every API boot, updates webhook URLs to match the current `WEBHOOK_BASE_URL` (so a new ngrok tunnel doesn't break dev).
- `workflow-generator.service.ts` — emits the YAML. The generated workflow:
  - Installs `doctl`, logs in to DOCR with `expiry-seconds 1200`
  - **Build strategy detection**: if `Dockerfile` exists → docker build; else if config `strategy: dockerfile` → docker build with configured path; else → **Nixpacks** (`curl -fsSL https://nixpacks.com/install.sh | bash`, then `nixpacks plan --format json` + `nixpacks build`)
  - `docker push` to DOCR
  - Always (`if: always()`) POSTs to `${liftoffApiUrl}/api/v1/webhooks/deploy-complete` with `X-Liftoff-Secret` header and JSON body `{ environmentId, imageUri, commitSha, status, runUrl, buildStrategy, buildPlan }`
- `repositories.controller.ts` — `GET /projects/:pid/repository/available`, `GET /projects/:pid/repository`, `POST /projects/:pid/repository` (connect), `DELETE` (disconnect).

#### Webhooks — `apps/api/src/webhooks/`
- `webhooks.controller.ts` — public endpoints. **Re-parses raw body** for HMAC (needed because `main.ts` enabled `rawBody`).
- `webhooks.service.ts:67` `handleGitHubPush`:
  1. Find repository by `full_name`; ignore if not connected.
  2. Decrypt webhook secret, verify `X-Hub-Signature-256` (returns silently for unknown repos, 401 on bad signature).
  3. Find environment matching `gitBranch`; ignore if none.
  4. Reject if there's already an active deployment for this environment (`ACTIVE_STATUSES`).
  5. Create `Deployment(PENDING)` and enqueue `DEPLOY` job in `deployments` queue (3 attempts, exponential backoff, 20-min timeout).
- `webhooks.service.ts:186` `handleDeployComplete` — callback from the generated GitHub Actions workflow:
  - Verifies `X-Liftoff-Secret` header against the env's `liftoff_deploy_secret` (decrypted, `timingSafeEqual`).
  - Finds the latest deployment in `QUEUED|BUILDING|PUSHING`.
  - If GitHub Actions reported `status=failure` → mark `FAILED` with the run URL in `errorMessage`.
  - If a Pulumi stack already exists for this environment (resolved via `pulumiStack.outputs.appId/appUrl`) → skip provisioning, go straight to `DEPLOYING` and enqueue `DEPLOY` job (image-only redeploy path).
  - Otherwise: enqueue `PROVISION` job on `infrastructure` queue with the `configYaml`.

#### Deployments — `apps/api/src/deployments/`
- `deployments.controller.ts` — environment-scoped: `GET /environments/:eid/deployments`, `GET /:id`, `GET /:id/logs`, `POST /` (manual trigger), `POST /:id/rollback`, `POST /:id/cancel`.
- `public-deployments.controller.ts` — `GET /deployments/:id/status` (no auth, for Simple Mode shareable status pages).
- `deployments.service.ts:46` `trigger` — manual deploy: uses provided `imageUri` or finds latest SUCCESS/ROLLED_BACK image, enqueues `DEPLOY` job.
- `deployments.service.ts:152` `rollback` — validates the target is a SUCCESS deployment with an `imageUri`, creates a new rollback deployment with `attempts: 1` (no retries on rollback).
- `deployments.service.ts:259` `cancel` — only PENDING/QUEUED can be cancelled; removes job from queue, sets `CANCELLED`, broadcasts both `status` + `complete`.
- **`deployments.processor.ts` (`@Processor('deployments')`)** — the core deploy worker:
  - `handleDeploy(job)`:
    1. If deployment has no `imageUri` yet → just transition `PENDING→BUILDING→PUSHING` (the actual build happens in GitHub Actions; we're waiting for `/webhooks/deploy-complete`).
    2. If `imageUri` exists → resolve `appContext` from `pulumiStack.outputs` (`appId`, `appUrl`). If missing → fail with `DEPLOYMENT_NO_INFRA`.
    3. `deployImageToApp`: get current app spec → patch every `services[].image` / `workers[].image` / `jobs[].image` with new `{registry, repository, tag}` → `PUT /v2/apps/:id` → `POST /v2/apps/:id/deployments` (force) → `waitForDeployment` (polls every 10s up to `DEPLOYMENT_JOB_TIMEOUT_MS` = 20min).
    4. On `ACTIVE` → `SUCCESS` with `endpoint = appUrl`. On `ERROR|TIMEOUT` → attach last 200 run-log lines as `DeploymentLog` rows, fail, then `queueAutoRollback` (find last successful deployment, create + enqueue a rollback job).
  - All errors are passed through `sanitizeErrorMessage` which strips `dop_v1_*` tokens and `Bearer …` headers before logging.
  - Every state transition calls `EventsGateway.broadcastDeploymentStatus` — that's how the UI updates live.

#### Infrastructure — `apps/api/src/infrastructure/`
- `infrastructure.controller.ts` — `POST /environments/:eid/infrastructure/preview`, `DELETE /environments/:eid/infrastructure` (destroy), `GET /environments/:eid/infrastructure/resources`.
- `infrastructure.service.ts` — request-time wrappers (preview, destroy, list resources).
- **`infrastructure.processor.ts` (`@Processor('infrastructure')`)** — Pulumi provisioning worker:
  - `handleProvision(job)`:
    1. Build `stackName = organization/{projectId}/{environmentName}`, `stateSpacesKey = .pulumi/stacks/{stackName}.json`.
    2. Decrypt user DO token, parse `liftoff.yml`.
    3. Status → `PROVISIONING`. Call `pulumiRunnerService.run` with a 20-min timeout (Promise.race against the runner).
    4. Stream every Pulumi log line into `deployment_logs` table + `EventsGateway.broadcastDeploymentLog`. Forward `resourcePreEvent`/`resOutputsEvent` as `broadcastInfraProgress`.
    5. On success: in a `$transaction` upsert `PulumiStack` (with `outputs.appId/appUrl/repositoryUrl/dbClusterName/dbUri/bucketName/bucketEndpoint`), wipe old `InfrastructureResource` rows and insert new ones (one per DO resource for the UI list), then set deployment → `DEPLOYING` → `SUCCESS`.
  - `handleDestroy(job)` — runs `pulumi destroy`, clears `pulumiStack.outputs` and `infrastructure_resources` rows.
- `infrastructure-active-deployment-checker.service.ts` — `@Cron(EVERY_5_MINUTES)`: marks deployments stuck in active state for >30 min as FAILED (safety net for crashed workers).
- **`pulumi-runner.service.ts`** — the Pulumi subprocess driver:
  - For each run, creates a temp dir under `os.tmpdir()/liftoff-pulumi-{uuid}`.
  - `generatePulumiProgram` writes 4 files: `package.json` (deps on `@pulumi/digitalocean` and `@pulumi/pulumi`), `tsconfig.json`, `Pulumi.yaml` (`name: <projectId>`), and `index.ts` which imports `createAppPlatformStack` from a **resolved absolute path** to `packages/pulumi-components/src/stacks/app-platform-stack.ts`. The DO token comes via `process.env.DIGITALOCEAN_TOKEN` (never serialized into the program).
  - Builds child-process env: `PULUMI_BACKEND_URL=s3://<bucket>?endpoint=<spaces-endpoint>&region=<region>`, `AWS_*=<spaces-keys>`, `AWS_S3_FORCE_PATH_STYLE=true`, `AWS_ENDPOINT_URL_S3=<spaces-endpoint>`, `PULUMI_CONFIG_PASSPHRASE=<passphrase>`, `DIGITALOCEAN_TOKEN=<user-token>`.
  - Runs `npm install` (silent), `pulumi login`, `pulumi stack select --create`, then `pulumi up|preview|destroy --json --non-interactive`.
  - Parses JSON event stream line-by-line: `diagnosticEvent` → log callback, `resourcePreEvent`/`resOutputsEvent` → resource progress callback, `summaryEvent.resourceChanges` → summary callback.
  - `sanitizeErrorMessage` redacts DO tokens and bearer headers from any leaked output (cap 2000 chars).
- `types/pulumi.types.ts` — shared types for stack args/outputs/progress.

#### Monitoring — `apps/api/src/monitoring/`
- `monitoring.controller.ts` — `GET /environments/:eid/logs?type=BUILD|DEPLOY|RUN|RUN_RESTARTED&limit=`, `GET /environments/:eid/metrics/cpu|memory|bandwidth`.
- `monitoring.service.ts:39` `getLogs` — pulls runtime log lines via `DoApiService.getAppRuntimeLogs`, slices last N, tags `level` via simple regex.
- `monitoring.service.ts:89` `streamLogs` — WebSocket pump. Called from `EventsGateway` on `start:log-stream` event; uses `DoApiService.getLiveAppLogs` (async generator, polls every 5s, yields only new lines).
- `monitoring.service.ts:68` `getMetrics` — maps `cpu|memory|bandwidth` to DO's `cpu_percentage|memory_percentage|network_bandwidth` and returns timeseries.

#### Pipeline — `apps/api/src/pipeline/` (legacy visual builder, kept around)
- `pipeline.controller.ts` — `GET /environments/:eid/pipeline`, `PUT` (save), `POST /validate`, `POST /compile`, `POST /deploy`.
- `pipeline.service.ts` — CRUD on `PipelineGraph` (nodes/edges/compiledYaml/isValid/validationErrors).
- `pipeline-compiler.service.ts` — walks the React Flow graph and emits a `LiftoffConfig`:
  - Node types: `GitHubPushTrigger | ManualTrigger | ScheduleTrigger | DockerBuild | AutoDetectBuild | AppService | PostgresDatabase | SpacesBucket | CustomDomain | EnvVars | Secret`.
  - Validation: requires at least one `AppService`, edges must flow trigger→build→service.
  - `compile` resolves the AppService and follows incoming edges to populate runtime/database/storage/env/secrets/domain on the config.
- **Note:** The current UI primarily uses the newer **Canvas** module below; the pipeline endpoints + types are still exported but the canvas is the active surface.

#### Canvas — `apps/api/src/canvas/` (the **current** UI backend)
- `canvas.controller.ts` — `POST /projects/:pid/canvas/auto-setup`, `GET /projects/:pid/canvas`, `PATCH /projects/:pid/canvas/layout`.
- `canvas.service.ts:97` `getCanvas` — assembles `CanvasState = { projectId, projectName, hasConnectedRepo, nodes[], edges[] }`:
  - One **service node per environment** with status from the latest deployment, region from the DO account, runtime summary from the parsed liftoff config, position from `Environment.canvasPosition` (Json field).
  - Adds **database/redis/storage child nodes** when the env's `pulumiStack.outputs` contains the relevant URI/bucket fields. Connects them to the service node with edges.
- `canvas.service.ts:254` `autoSetup` — "magic button": connects repo via `RepositoriesService.connect` (which creates webhook + commits workflow + uploads Actions secrets), or if repo is already connected just calls `DeploymentsService.trigger` for the matching environment.
- `canvas.service.ts:298` `saveLayout` — persists `{x,y}` per node into `Environment.canvasPosition` (skips child node IDs prefixed `db-`/`redis-`/`storage-`).

#### Upload — `apps/api/src/upload/` (Simple Mode)
- `upload.controller.ts` — `POST /upload` (multipart, 50 MB max), `POST /upload/template`.
- `upload.service.ts` — accepts a zip, extracts via `adm-zip`, detects root prefix, injects a Dockerfile template (`packages/shared/src/dockerfile-templates/`) if the user didn't ship one. Then: creates project → creates repo via GitHub API → pushes files in one commit → creates webhook → creates environment → writes config → triggers deployment. Templates load from DO Spaces (`DoApiService.getSpacesObject`).

#### Events / WebSocket — `apps/api/src/events/`
- `events.gateway.ts` — `@WebSocketGateway({ namespace: '/deployments' })`. Auth: extracts JWT from `handshake.auth.token` or `Authorization` header, verifies on connect, disconnects on failure.
- Subscribe events: `join:deployment`, `join:environment`, `leave:*`, `start:log-stream`.
- Emit events (called by processors/services): `deployment:status`, `deployment:log`, `deployment:complete`, `infrastructure:progress`. All scoped to `deployment:{id}` rooms.
- Event names + payload types: `packages/shared/src/constants/websocket-events.ts`.

#### Queues — `apps/api/src/queues/`
- `queue.constants.ts` — two queues, four jobs:
  - `QUEUE_NAMES.DEPLOYMENTS` with `JOB_NAMES.DEPLOYMENTS.DEPLOY` and `ROLLBACK`
  - `QUEUE_NAMES.INFRASTRUCTURE` with `JOB_NAMES.INFRASTRUCTURE.PROVISION` and `DESTROY`
  - `QUEUE_TIMEOUTS.DEPLOYMENT_JOB_TIMEOUT_MS = 20 * 60 * 1000`
  - `QUEUE_TIMEOUTS.ACTIVE_DEPLOYMENT_TIMEOUT_MS = 30 * 60 * 1000` (cron safety net)
- `queues.module.ts` — registers both queues with BullMQ; the root `BullModule.forRootAsync` in `app.module.ts` configures Redis.

#### Common — `apps/api/src/common/`
- `services/encryption.service.ts` — **AES-256-GCM** for secrets (IV:tag:ciphertext, all hex). Throws if `ENCRYPTION_KEY` isn't 32 bytes (64 hex chars). Also provides bcrypt `hash`/`compare` for refresh tokens.
- `exceptions/app.exception.ts` — `AppException` extends `HttpException` with typed `errorCode` and optional `details`. `Exceptions.{notFound,forbidden,badRequest,conflict,unauthorized,internalError}` factories. **Always throw these — never raw `HttpException`** (see `CLAUDE.md`).
- `filters/http-exception.filter.ts` — global. Standardizes response: `{ statusCode, error, message, code, details?, timestamp, path }`. Logs `>=500` as error, others as warn.
- `interceptors/logging.interceptor.ts` — request/response logger.
- `guards/jwt-auth.guard.ts` — extends `AuthGuard('jwt')`, honors `@Public()` decorator.
- `guards/throttler.guard.ts` — wraps `ThrottlerGuard` with our error code.
- `decorators/` — `@CurrentUser()`, `@Public()`, `@Roles()`.

#### Prisma — `apps/api/src/prisma/` + `apps/api/prisma/`
- `prisma.service.ts` — connects on init, disconnects on destroy. Imported via `PrismaModule`.
- `prisma/schema.prisma` — single source of truth. Migrations in `prisma/migrations/`. Latest is `20260525110000_nixpacks_build_metadata` (adds `build_strategy`, `build_run_url`, `build_plan` to deployments).
- `prisma/seed.ts` + `prisma/set-environment-deploy-secret.ts` — utility scripts.

### 3.4 Database schema (the model graph)

```
User                                       RefreshToken
 │ githubId, email, githubToken (encrypted) │ id=jti, token (bcrypt hash), expiresAt, revokedAt
 ├─ DOAccount (doToken encrypted, region, validatedAt)
 ├─ Project (name unique per user, soft-delete via deletedAt)
 │   ├─ Repository (1:1; githubId, fullName, branch, webhookId, webhookSecret encrypted)
 │   ├─ TeamMember (User × Project, role: OWNER/ADMIN/DEVELOPER/VIEWER)
 │   └─ Environment (name unique per project; gitBranch, configYaml, configParsed,
 │                   canvasPosition Json, liftoffDeploySecret encrypted, serviceType=APP)
 │        ├─ Deployment (status enum, commitSha, imageUri, buildStrategy, buildRunUrl, buildPlan,
 │        │              endpoint, errorMessage, startedAt, completedAt)
 │        │    └─ DeploymentLog (level, message, source, timestamp)
 │        ├─ PulumiStack (1:1; stackName, stateSpacesKey, outputs Json, lastUpdated)
 │        ├─ InfrastructureResource[] (resourceType, doResourceId, doRegion, tags)
 │        ├─ Alert[]
 │        └─ PipelineGraph (1:1; nodes Json, edges Json, compiledYaml, isValid)
```

Conventions: `snake_case` DB columns via `@map()`, `camelCase` TS. Soft-delete via `deletedAt DateTime?`. CUIDs for ids.

### 3.5 DO API client — `apps/api/src/do-api/do-api.service.ts`

Single Axios-based wrapper for `api.digitalocean.com/v2/`. Methods used elsewhere:
- `validateToken(token, doAccountId?)` — `GET /v2/account`; if 401 and `doAccountId` given, clears `validatedAt` on that account.
- `getApp / updateApp / createDeployment / getDeployment / waitForDeployment` — App Platform.
- `getDeploymentLogs / getAppLogs / getAppRuntimeLogs / getLiveAppLogs` (async generator) — logs.
- `getAppMetrics(token, appId, 'cpu_percentage'|'memory_percentage'|'network_bandwidth')` — DO monitoring metrics.
- `getOrCreateContainerRegistryName(token, doAccountId?)` — `GET /v2/registry`, 404 → creates one named `liftoff-{randomHex}` with `subscription_tier_slug: 'starter'` (retries 5× on 422 conflict).
- `getSpacesObject(bucket, key)` — for the Simple Mode template downloader (signed with platform Spaces creds).

---

## 4. apps/web — the Next.js frontend

### 4.1 Shell

| File | Purpose |
|---|---|
| `apps/web/app/layout.tsx` | Root. Inter font, dark class, wraps `<Providers>`. |
| `apps/web/app/providers.tsx` | `QueryClientProvider` (staleTime 30s) + `<Toaster />`. |
| `apps/web/next.config.js`, `tailwind.config.ts`, `postcss.config.js` | Tailwind + shadcn setup. |

### 4.2 Route groups

```
app/
├── (auth)/
│   ├── auth/callback/page.tsx        Exchanges ?token= → calls /users/me → sets Zustand auth → /dashboard
│   └── login/page.tsx                "Sign in with GitHub" → ${NEXT_PUBLIC_API_URL}/api/auth/github
└── (dashboard)/
    ├── layout.tsx                    Sidebar shell; runs useAuthRehydration; mounts DoAccountOnboardingModal
    ├── dashboard/page.tsx            Welcome + 6 recent project cards + "Connect DigitalOcean" nudge
    ├── projects/page.tsx             Full project list + "New" dialog (name → repo picker → auto-deploy → /canvas)
    ├── projects/[id]/page.tsx        Project overview
    ├── projects/[id]/canvas/(layout|page).tsx   Renders <ProjectCanvas projectId=…>
    ├── projects/[id]/repository/page.tsx
    ├── projects/[id]/settings/page.tsx
    ├── projects/[id]/environments/[envId]/
    │   ├── layout.tsx               Top nav (Canvas / Metrics / Logs / Settings) + breadcrumb
    │   ├── page.tsx                 Env overview
    │   ├── deployments/[deployId]/page.tsx
    │   ├── history/page.tsx
    │   ├── logs/page.tsx
    │   ├── metrics/page.tsx
    │   └── settings/page.tsx
    └── settings/page.tsx             Account settings (DO accounts list, etc)
```

### 4.3 Canvas (the centerpiece UI) — `apps/web/src/components/canvas/`

The "Railway-style" interactive surface lives in **`project-canvas.tsx`**:
- Built on `@xyflow/react`. Custom node types: `service`, `database`, `redis`, `storage` (only `service` is editable via canvas; databases come from Pulumi outputs).
- Loads state from `useCanvas(projectId)` → `GET /projects/:id/canvas` (returns `CanvasState`).
- Drag-to-move persists positions via `useSaveCanvasLayout` (debounced 500 ms, `PATCH /projects/:id/canvas/layout`).
- **Real-time sync:** on mount, opens the `/deployments` Socket.io namespace with the current access token; listens for `WsEvents.DEPLOYMENT_STATUS` to update node `data.status`, and `DEPLOYMENT_COMPLETE` to refetch the canvas.
- **Empty state** (`canvas-empty-state.tsx`) — when a project has no nodes yet, shows a Railway-style "command palette" with GitHub repo picker → triggers `useAutoSetup` (which calls `POST /projects/:id/canvas/auto-setup`).
- **Dev Mode toggle** (`dev-mode-view.tsx`) — switches the canvas surface to a YAML editor for the environment's `liftoff.yml` with Validate/Save buttons; also shows recent deployments and metrics tab.
- **Toolbar** (`canvas-toolbar.tsx`) — project name + Live/Deploying/Failed badge derived from node statuses, Canvas/Dev mode switch, Add button, Activity, Notifications, ⌘K opens the command palette.
- **Command palette** (`command-palette/command-palette.tsx`) — categorized actions (Add PostgreSQL/Redis/Spaces Bucket/Worker/Cron, Redeploy All, Dev Mode). Selecting an Add action calls back to `project-canvas.tsx` `handleAddService` which stages a node + edge with `isStaged: true`.
- **Staged changes** (`staged-changes/`) — local Zustand store (`staged-changes-store.ts`) and bottom-bar component (`staged-changes-bar.tsx`). New nodes/variable changes accumulate here before being deployed; the bar surfaces a "Deploy" button.
- **Config drawer** (`config-drawer/`) — slide-over when a node is selected:
  - `config-drawer.tsx` — shell
  - `drawer-metrics-tab.tsx` — CPU/memory/bandwidth charts via `recharts`, hits `/environments/:eid/metrics/*`
  - `drawer-variables-tab.tsx` — env-var editor (writes to staged changes)
  - `drawer-settings-tab.tsx` — instance size, domains, etc
  - `drawer-deployments-tab.tsx` — list of deployments for the node's environment

The older **pipeline builder** at `apps/web/src/components/pipeline/` still exists (node palette, custom nodes, YAML preview panel) but isn't the primary surface — the canvas above replaced it.

### 4.4 Hooks (TanStack Query) — `apps/web/src/hooks/queries/`

| Hook file | Queries / mutations |
|---|---|
| `use-canvas.ts` | `useCanvas`, `useAutoSetup`, `useSaveCanvasLayout` |
| `use-projects.ts` | `useProjects`, `useProject`, `useCreateProject`, `useUpdateProject`, `useDeleteProject` |
| `use-environments.ts` | `useEnvironments`, `useEnvironment`, `useCreate/Update/DeleteEnvironment`, `useUpdateConfig`, `useValidateConfig` |
| `use-deployments.ts` | `useDeployments`, `useDeployment`, `useDeploymentLogs`, `useTriggerDeployment`, `useRollbackDeployment`, `useCancelDeployment` |
| `use-do-accounts.ts` | `useDoAccounts`, `useCreateDoAccount`, `useValidateDoAccount`, `useDeleteDoAccount` |
| `use-repositories.ts` | `useAvailableRepos`, `useConnectedRepo`, `useConnectRepo`, `useDisconnectRepo` |
| `use-pipeline.ts` | `usePipelineGraph`, `useSave/Validate/Compile/DeployPipeline` |
| `use-public-deployment.ts` | Public status fetch for share pages |

`apps/web/src/hooks/use-auth-rehydration.ts` — on dashboard mount, hits `POST /auth/refresh` then `GET /users/me` to repopulate the Zustand store after a page reload.

### 4.5 Libs & store

- `src/lib/api-client.ts` — Axios with `withCredentials: true` and `baseURL = ${NEXT_PUBLIC_API_URL}/api/v1`. Request interceptor adds `Authorization: Bearer <token>` from Zustand. Response interceptor: on 401 (and not `/auth/refresh`), shares a single `getRefreshRequestPromise()` so concurrent failures deduplicate to one refresh; on refresh failure clears auth and redirects to `/login`.
- `src/lib/ws-client.ts` — `getSocket(token)` returns a singleton `io(${NEXT_PUBLIC_WS_URL}/deployments)` with `autoConnect: false`. Updates `auth.token` on each call.
- `src/lib/utils.ts` — `cn(...)` (clsx + tailwind-merge).
- `src/store/auth.store.ts` — Zustand with `persist` middleware (`localStorage` key `auth-store`): `{ user, accessToken, isAuthenticated, isLoading, setAuth, clearAuth, setToken, setLoading }`.

### 4.6 UI primitives — `apps/web/src/components/ui/`

shadcn/ui generated components on Radix: `button`, `card`, `dialog`, `dropdown-menu`, `input`, `label`, `select`, `spinner`, `tabs`, `toast` (`use-toast`, `toaster`), `badge`, `alert`. Layout primitives in `layout/`: `sidebar`, `header`, `user-menu`. Onboarding modal: `onboarding/do-account-modal.tsx` (prompts for token + region when user has no DO accounts).

---

## 5. packages/shared — `@liftoff/shared`

All exports from `packages/shared/src/index.ts`:

| File | Exports |
|---|---|
| `schemas/liftoff-yml.schema.ts` | `LiftoffConfigSchema`, `LiftoffConfig` type, `parseLiftoffConfig`, `safeParseLiftoffConfig`. Defines `service`, `runtime`, `build` (strategy: `auto|dockerfile|nixpacks`), `database`, `storage`, `healthcheck`, `domain`, `env`, `secrets`. Region enum: 11 DO regions. Instance sizes: 7 DO App Platform slugs. |
| `schemas/pagination.schema.ts` | `PaginationQuerySchema` (page≥1, limit 1–100, default 20), `paginate({page, limit}) → {skip, take}`. |
| `constants/error-codes.ts` | `ErrorCodes` enum (~40 codes: AUTH_*, USER_*, DO_ACCOUNT_*, PROJECT_*, ENVIRONMENT_*, REPOSITORY_*, CONFIG_*, DEPLOYMENT_*, PULUMI_*, UPLOAD_*, PIPELINE_*, TEMPLATE_*, INTERNAL_ERROR, VALIDATION_ERROR, TOO_MANY_REQUESTS, NOT_FOUND). Use these — don't string-literal. |
| `constants/deployment-status.ts` | `DeploymentStatus` enum, `TERMINAL_STATUSES`, `ACTIVE_STATUSES`, `VALID_TRANSITIONS` (state machine), plus `DEPLOYMENT_STATUS_LABELS` / `_STEP` for Simple Mode UI. |
| `constants/websocket-events.ts` | `WsEvents` enum + `WsDeploymentStatusPayload`, `WsDeploymentLogPayload`, `WsDeploymentCompletePayload`, `WsInfraProgressPayload`. |
| `constants/deploy-secrets.ts` | `LIFTOFF_DEPLOY_SECRET_NAME`, `DIGITALOCEAN_ACCESS_TOKEN_SECRET_NAME`, `resolveEnvironmentDeploySecretName(envId)` (currently returns the constant — placeholder for per-env in the future). |
| `constants/limits.ts`, `roles.ts`, `wizard-defaults.ts`, `templates.ts` | App-type defaults, size tiers, starter templates (`nextjs-blog`, `portfolio`, `express-api`, `django-webapp`, `laravel-app`, `static-html` — all stored in DO Spaces under `liftoff-templates/`). |
| `dockerfile-templates/` | `getDockerfileTemplate(appType)` returns a Dockerfile string for `nextjs`/`django`/`laravel`/`express`. Used by `UploadService` when the user's zip has no Dockerfile. |
| `types/deployment.ts` | `DeploymentDto`, `DeploymentLogDto`. |
| `types/pipeline.ts` | `PipelineNode`, `PipelineEdge`, `PipelineValidationError`, `PipelineGraphDto`, `CompilePipelineResult`. |
| `types/project.ts`, `environment.ts`, `repository.ts`, `user.ts`, `do-account.ts` | Public DTOs. |

---

## 6. packages/pulumi-components — user-infra building blocks

All exports from `packages/pulumi-components/src/index.ts`:

| File | What it provisions |
|---|---|
| **`stacks/app-platform-stack.ts`** | The entry point. `createAppPlatformStack(args)` instantiates a `digitalocean.Provider('user-account', {token})` and composes the components below into one stack: always DOCR + App; Postgres if `config.database.enabled`; Spaces if `config.storage.enabled`. Returns `{appUrl, appId, repositoryUrl, dbClusterName?, dbUri? (pulumi.secret), bucketName?, bucketEndpoint?}`. |
| `app-platform/app-platform-app.ts` | `AppPlatformApp` ComponentResource → `digitalocean.App`. Parses the DOCR image URI into `{registry, repository, tag}`, sets `httpPort`, `instanceCount`, `instanceSizeSlug`, `healthCheck.httpPath`, and emits env vars: `GENERAL` for `envVars`, `SECRET` for `secretNames`. Attaches DB if provided. |
| `database/managed-postgres.ts` | `ManagedPostgres` ComponentResource → `digitalocean.DatabaseCluster` (engine `pg`, single node). Exposes `host`, `port`, `database`, `username`, `password`, `uri` outputs. |
| `registry/docr-repository.ts` | `DocrRepository` ComponentResource → `digitalocean.ContainerRegistryDockerCredentials` (write: true) and computes `repositoryUrl = registry.digitalocean.com/{docrName}/{projectName}/{environmentName}`. Note: it does **not** create the registry; the API creates it lazily via `DoApiService.getOrCreateContainerRegistryName`. |
| `storage/spaces-bucket.ts` | `SpacesBucket` ComponentResource → `digitalocean.SpacesBucket` (private + versioning) + `SpacesBucketCorsConfiguration` (allow all origins, GET/PUT/POST/DELETE/HEAD). |
| `utils/naming.ts` | `toKebabCase`, `truncateKebabCase`, `buildAppName(project, env)` (≤32 chars), `buildBucketName` (≤63). |
| `utils/tags.ts` | `createLiftoffTags(project, env)` → `{liftoff-project, liftoff-environment, liftoff-managed:true}`. `toDigitalOceanTagList` flattens to `key:value` strings (DO's format). |

These run as a **child Node process** spawned by `PulumiRunnerService` — they are not imported by the API directly; the API resolves the file path at runtime and writes a wrapper `index.ts` into a temp dir.

---

## 7. infra/ — platform infrastructure (separate Pulumi program)

`infra/index.ts` provisions the **Liftoff platform itself** on DigitalOcean:
- `digitalocean.DatabaseCluster` for platform Postgres 15 (`liftoff-platform-db`)
- `digitalocean.DatabaseCluster` for platform Redis 7 (`liftoff-platform-redis`)
- `digitalocean.App` with two services (`api`, `web`) pulling from `registry.digitalocean.com/liftoff/{api,web}:latest` with `deployOnPushes: true`, all env vars sourced from `pulumi config` (secrets are `requireSecret`).
- Attaches both managed DBs.

`infra/Pulumi.yaml` — `name: liftoff-platform, runtime: nodejs`. This is run manually or via `.github/workflows/deploy-platform.yml` (which builds and pushes the platform images to the platform DOCR, then calls `doctl apps create-deployment`).

---

## 8. The end-to-end deploy flow (cross-module trace)

```
1. User in web/app/(dashboard)/projects/page.tsx
   → useCreateProject       → POST /projects
   → useAutoSetup           → POST /projects/:id/canvas/auto-setup
       └── CanvasService.autoSetup
           ├── ProjectsService.assertProjectRole (OWNER|ADMIN)
           ├── resolveTargetEnvironment (creates 'production' env if none)
           └── RepositoriesService.connect
               ├── GitHubService.createWebhook
               ├── prisma.repository.create + env.liftoffDeploySecret upsert (txn)
               ├── GitHubService.upsertActionsSecret (LIFTOFF_DEPLOY_SECRET, DIGITALOCEAN_ACCESS_TOKEN)
               └── WorkflowGeneratorService.generate + GitHubService.commitFile
                   └── writes .github/workflows/liftoff-deploy.yml in user's repo

2. The commit itself triggers GitHub Actions (push event)
   → workflow checks for Dockerfile; uses Nixpacks if not
   → doctl registry login → docker build → docker push to user's DOCR
   → curl POST $LIFTOFF/api/v1/webhooks/deploy-complete  (always: success or failure)

3. Liftoff WebhooksController.handleDeployComplete
   → verify X-Liftoff-Secret (timingSafeEqual)
   → find latest deployment in QUEUED|BUILDING|PUSHING
   → if status=failure → mark FAILED with runUrl, done
   → if pulumiStack.outputs already has appId/appUrl → DEPLOYING + enqueue DEPLOY (image-only path)
   → else → PROVISIONING + enqueue PROVISION on infrastructure queue with imageUri + configYaml

4a. InfrastructureProcessor.handleProvision (first deploy)
   → decrypt user DO token, parse liftoff.yml
   → PulumiRunnerService.run({stackName: organization/{projectId}/{envName}, ...})
       ├── write temp package.json + index.ts → npm install → pulumi login → pulumi stack select --create
       ├── pulumi up --json → streams events (logs, resourcePre, resOutputs, summary)
       └── pulumi stack output --json
   → upsert PulumiStack(outputs), replace InfrastructureResource rows  (in a $transaction)
   → deployment → DEPLOYING → SUCCESS  (the very first deploy is fully done after Pulumi creates the App)
   → broadcast deployment:status and deployment:complete

4b. DeploymentProcessor.handleDeploy (subsequent deploys, image-only)
   → resolve appContext from pulumiStack.outputs
   → DoApiService.getApp → patch services[].image with new tag → updateApp → createDeployment (force)
   → waitForDeployment polls /v2/apps/:id/deployments/:id every 10s (≤20 min)
   → ACTIVE → SUCCESS  |  ERROR/TIMEOUT → attach last 200 RUN log lines, fail, queueAutoRollback

5. ProjectCanvas re-renders nodes in real-time via /deployments socket events
```

---

## 9. Environment variables (the ones that actually matter)

Validated by Joi in `app.module.ts`. Full reference: `docs/ENVIRONMENT.md`. Quick cheat:

| Var | Purpose | Where used |
|---|---|---|
| `DATABASE_URL` | Postgres | Prisma |
| `REDIS_URL` | Redis | BullMQ + ioredis health check |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | 32+ char each, MUST differ | Auth strategies |
| `JWT_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | `15m` / `7d` | JwtModule |
| `GITHUB_CLIENT_ID` / `_SECRET` / `_CALLBACK_URL` | OAuth | GithubStrategy |
| `GITHUB_WEBHOOK_SECRET` | Validated at boot (currently unused at runtime — per-repo secrets are random) | Joi schema |
| `FRONTEND_URL` | CORS + OAuth redirect target | main.ts, AuthController |
| `WEBHOOK_BASE_URL` | Public base URL for GitHub callbacks | RepositoriesService, WorkflowGeneratorService |
| `DO_API_TOKEN` | Liftoff's own DO token (not user-facing) | Joi schema |
| `DO_SPACES_ACCESS_KEY` / `_SECRET_KEY` / `_BUCKET` / `_ENDPOINT` / `_REGION` | Pulumi state backend (S3-compatible) | PulumiRunnerService, DoApiService.getSpacesObject |
| `PULUMI_PASSPHRASE` | Encrypts secrets in Pulumi state | PulumiRunnerService (as `PULUMI_CONFIG_PASSPHRASE`) |
| `ENCRYPTION_KEY` | 64 hex chars (32 bytes) | EncryptionService |
| `THROTTLE_TTL` / `THROTTLE_LIMIT` | Rate limit | ThrottlerModule |

Web: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL`.

**Docker compose** (local) hardcodes throwaway dev values for everything except the optional `DO_*` vars — see `docker-compose.yml:48`.

---

## 10. Where things live — fast lookup index

| If you need… | Look at |
|---|---|
| Add a new API endpoint | Create `dto/` + extend `*.controller.ts` in the relevant feature module. Use `JwtAuthGuard` unless explicitly `@Public()`. |
| Change deployment state machine | `packages/shared/src/constants/deployment-status.ts` (transitions) + `apps/api/src/deployments/deployments.processor.ts` |
| Add a Pulumi resource type | `packages/pulumi-components/src/{component}.ts`, then plug into `stacks/app-platform-stack.ts`. Remember the `Provider` arg. |
| Add a WebSocket event | Add to `packages/shared/src/constants/websocket-events.ts` then `events.gateway.ts` (broadcast method + subscribe handler if needed). |
| Add an error code | `packages/shared/src/constants/error-codes.ts`, then `throw Exceptions.xxx(message, ErrorCodes.YOUR_CODE)`. |
| Add a frontend page | `apps/web/app/(group)/route/page.tsx`. Use existing hooks under `src/hooks/queries/`. |
| Add a new TanStack Query hook | `apps/web/src/hooks/queries/use-thing.ts` — see `use-projects.ts` for the pattern. |
| Change the canvas | `apps/web/src/components/canvas/project-canvas.tsx` + `apps/api/src/canvas/canvas.service.ts` (for the data side). |
| Tweak the build workflow committed to user repos | `apps/api/src/repositories/workflow-generator.service.ts` |
| Tweak the platform's own infra | `infra/index.ts` (and `.github/workflows/deploy-platform.yml` if changing CI). |

---

## 11. Things easy to miss

- **No AWS.** "AWS_*" env vars in `PulumiRunnerService` are S3-compatible creds pointing at DO Spaces. The `digitalocean.Provider` is the only thing that talks to DO's API.
- **`liftoffDeploySecret` is per-environment** in the DB but `LIFTOFF_DEPLOY_SECRET` Actions secret is **a single name** (`resolveEnvironmentDeploySecretName` currently returns the constant). One repo currently maps to one connected environment for the secret; revisit if multi-env-per-repo becomes a real feature.
- **Pulumi stack name** is `organization/{projectId}/{environmentName}`. Don't change the prefix — `PulumiRunnerService.extractProjectNameFromStackName` enforces it.
- **Repository:Project is 1:1** (`Repository.projectId @unique`). Multiple branches → multiple environments under the same repo.
- **`Environment.canvasPosition` is a `Json` field** (not separate `x`/`y` columns). `CanvasService.saveLayout` writes `{x, y}` objects there. Child nodes (`db-…`, `redis-…`, `storage-…`) are *derived* from Pulumi outputs and don't have their own DB row.
- **`Pipeline*` is the legacy visual builder**; the active surface is `Canvas*`. Both backends are wired in `app.module.ts`. Don't delete the pipeline module without checking — at least `node-definitions.ts`, `pipeline-canvas.tsx`, `yaml-preview-panel.tsx` are still in the frontend tree.
- **Auto-rollback** kicks in only after a *deploy* failure (image push to App Platform), not after a *provision* failure. See `deployments.processor.ts:504`.
- **Cron safety net**: `InfrastructureActiveDeploymentCheckerService` fails deployments stuck in active state for >30 min. Anything that takes longer needs to either run async with its own state machine or bump `ACTIVE_DEPLOYMENT_TIMEOUT_MS`.
- **Rate limiting** is global via `LiftoffThrottlerGuard` (per-user/IP, 100 req/60s default). Per-route overrides via `@Throttle()` are possible but unused.
- **Tests live next to source** (`*.spec.ts`). There's a `test-e2e.sh` in `apps/api/` for end-to-end smoke testing.
- **Docker dev startup** runs `pnpm --filter shared build && prisma generate && prisma migrate deploy && pnpm dev` (see `Dockerfile.api:27`). The shared package must be built once before NestJS hot-reload picks it up.
- **`apps/web` has both `app/` and `src/`**: pages and route layouts go in `app/`, components/hooks/lib/store go in `src/`. The `@/` alias resolves to `src/`.
