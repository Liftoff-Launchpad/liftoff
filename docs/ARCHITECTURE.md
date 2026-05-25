# Liftoff — Architecture

## Everything is DigitalOcean

There is no AWS in this project. Both the Liftoff platform and user infrastructure run on DigitalOcean.

---

## System Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                  Liftoff Platform — DigitalOcean                         │
│                                                                          │
│  ┌──────────────┐  REST/WS  ┌──────────────────────────────────────┐   │
│  │  Next.js 14  │──────────▶│            NestJS API                │   │
│  │  App Platform│◀──────────│  Auth · Projects · Environments      │   │
│  └──────────────┘           │  Deployments · DO Accounts           │   │
│                             │  ┌──────────────────────────────┐    │   │
│  ┌──────────────┐           │  │      BullMQ Queues           │    │   │
│  │  Managed     │◀──────────│  │  deployments | infra         │    │   │
│  │  PostgreSQL  │           │  └──────────────────────────────┘    │   │
│  └──────────────┘           │  ┌─────────────┐  ┌──────────────┐  │   │
│                             │  │ Pulumi Runner│  │  DO API      │  │   │
│  ┌──────────────┐           │  │ (subprocess) │  │  Client      │  │   │
│  │  Managed     │◀──────────│  └──────┬───────┘  └──────┬───────┘  │   │
│  │  Redis       │           └─────────┼─────────────────┼──────────┘   │
│  └──────────────┘                     │ state            │ validate      │
│                             ┌─────────▼──────┐          │              │
│  ┌──────────────┐           │   DO Spaces    │          │              │
│  │  Container   │           │ (Pulumi state) │          │              │
│  │  Registry    │           └────────────────┘          │              │
│  └──────────────┘                                        │              │
└─────────────────────────────────────────────────────────┼──────────────┘
                                                          │ user DO token
                              ┌───────────────────────────▼──────────────┐
                              │        User's DigitalOcean Account        │
                              │                                           │
                              │  Pulumi (@pulumi/digitalocean) creates:   │
                              │                                           │
                              │  ┌─────────────────────────────────────┐ │
                              │  │  App Platform App                   │ │
                              │  │  • Docker component (user's image)  │ │
                              │  │  • Auto HTTPS (Let's Encrypt)       │ │
                              │  │  • Built-in logs + metrics          │ │
                              │  │  • Environment variables            │ │
                              │  └─────────────────────────────────────┘ │
                              │  ┌──────────────┐  ┌──────────────────┐  │
                              │  │ DOCR Repo    │  │ Managed Postgres  │  │
                              │  │ (user images)│  │ (optional)        │  │
                              │  └──────────────┘  └──────────────────┘  │
                              │  ┌──────────────┐                         │
                              │  │ Spaces Bucket│  (optional)             │
                              │  └──────────────┘                         │
                              └───────────────────────────────────────────┘
```

---

## Data Flow: Push-to-Deploy

```
Developer
   │ git push (to connected branch)
   ▼
GitHub
   │ webhook POST → $WEBHOOK_BASE_URL/api/v1/webhooks/github
   ▼
Liftoff API — WebhooksController
   │ verify HMAC-SHA256 signature
   │ find environment matching branch name
   │ create Deployment record (status: PENDING)
   ▼
BullMQ — deployments queue
   │ job: { deploymentId, environmentId, commitSha }
   ▼
Deployment Processor
   │
   ├─ 1. Status → BUILDING
   │     Trigger GitHub Actions workflow (Dockerfile-first build, Nixpacks fallback, then push to user's DOCR)
   │     via GitHub API workflow_dispatch
   │
   ├─ 2. Status → PUSHING
   │     GitHub Actions: docker build (or nixpacks build) → docker push to DOCR
   │     GitHub Actions calls POST /webhooks/deploy-complete { imageUri, commitSha, buildStrategy, buildPlan }
   │
   ├─ 3. Status → PROVISIONING
   │     Decrypt user's DO token from DOAccount table
   │     Pulumi subprocess: pulumi up (state in DO Spaces, resources in user's DO account)
   │     Stream Pulumi logs → DeploymentLog table + WebSocket
   │
   ├─ 4. Status → DEPLOYING
   │     Update App Platform app spec (new image tag)
   │     Poll App Platform deployment until active_deployment.phase == ACTIVE
   │
   └─ 5. Status → SUCCESS | FAILED
         Update Deployment.endpoint with App Platform live URL
         Broadcast deployment:complete via WebSocket
```

---

## User Account Connection (DO Token — No STS/IAM)

```
User                               Liftoff                    User's DO Account
  │                                    │                              │
  │  1. Create DO Personal Access      │                              │
  │     Token (read+write) in DO       │                              │
  │     console → API → Tokens         │                              │
  │                                    │                              │
  │  2. Paste token in Liftoff UI      │                              │
  │  ─────────────────────────────────▶│                              │
  │                                    │                              │
  │                                    │  3. Validate: GET /v2/account│
  │                                    │  ─────────────────────────────▶
  │                                    │◀─────────────────────────────
  │                                    │  Returns account info         │
  │                                    │                              │
  │                                    │  4. Encrypt token (AES-256)  │
  │                                    │     Store in DOAccount table  │
  │                                    │                              │
  │  5. Per deployment:                │                              │
  │     Decrypt token → use as         │                              │
  │     new digitalocean.Provider()    │                              │
  │     in Pulumi subprocess           │                              │
  │                                    │─────────────────────────────▶│
  │                                    │  Pulumi creates resources     │
```

The DO API token is the only credential Liftoff needs. It is:
- Encrypted at rest with AES-256-GCM (via `EncryptionService`)
- Never returned in any API response
- Never logged
- Decrypted only in the Pulumi runner subprocess environment

---

## Pulumi Credential Isolation

The Pulumi subprocess needs two things simultaneously:

| What | How it's provided |
|------|------------------|
| **State backend access** (DO Spaces) | `AWS_ACCESS_KEY_ID` = Spaces key, `AWS_SECRET_ACCESS_KEY` = Spaces secret, `AWS_ENDPOINT_URL_S3` = Spaces endpoint |
| **User infra access** (DO API) | `DIGITALOCEAN_TOKEN` = decrypted user DO token |

The Pulumi program uses an explicit provider so there's no ambiguity:

```typescript
// packages/pulumi-components/src/stacks/app-platform-stack.ts
const provider = new digitalocean.Provider('user-account', {
  token: args.doToken, // decrypted from DOAccount.doToken
});
// Every resource: new digitalocean.App('app', {...}, { provider })
```

---

## DO App Platform for User Apps

App Platform is the primary deployment target for user applications. It provides:
- **Automatic HTTPS** via Let's Encrypt — no load balancer config needed
- **Built-in logs** — accessible via DO API `/v2/apps/{id}/deployments/{id}/logs`
- **Basic metrics** — CPU, memory, bandwidth
- **Zero-config scaling** — `instance_count` controls replicas
- **Auto-deploy on image push** — or manually triggered (Liftoff controls this)
- **Environment variables** — injected securely, visible in DO console

App Platform limitations (acceptable for MVP):
- No custom VPC/networking (App Platform manages its own network)
- No persistent volumes (use Spaces for file storage)
- Cold starts on free/starter tiers

---

## Database Schema (ERD Summary)

```
User ──────────────────┐
 │                     │ (team membership)
 ├── DOAccount          ├── TeamMember
 │     │                │
 └── Project ───────────┘
       │
       ├── Repository
       │
       └── Environment
             │
             ├── Deployment ── DeploymentLog
             ├── PulumiStack
             ├── InfrastructureResource
             └── Alert
```

### Key Tables

| Table | Purpose |
|-------|---------|
| `User` | GitHub OAuth users |
| `DOAccount` | User's DO API token (encrypted), region, validated status |
| `Project` | Top-level grouping — one repo, multiple environments |
| `Environment` | dev/staging/prod — each has own Pulumi stack + DO App Platform app |
| `Repository` | GitHub repo + webhook ID + encrypted webhook secret |
| `Deployment` | Single deploy event: image URI, status, timestamps, live URL |
| `DeploymentLog` | Streaming log lines per deployment |
| `PulumiStack` | Spaces state key + stack outputs (app URL, registry URL) |
| `InfrastructureResource` | Each DO resource created (for display + cleanup) |
| `TeamMember` | RBAC: User ↔ Project with role |
| `Alert` | DO monitoring alert config per environment |

---

## API Structure

Base URL: `/api/v1`

| Domain | Prefix | Key Endpoints |
|--------|--------|---------------|
| Auth | `/auth` | `GET /github`, `GET /github/callback`, `POST /refresh`, `DELETE /logout` |
| Users | `/users` | `GET /me`, `PATCH /me` |
| DO Accounts | `/do-accounts` | `POST /`, `GET /`, `DELETE /:id`, `POST /:id/validate` |
| Projects | `/projects` | Full CRUD |
| Environments | `/projects/:pid/environments` | Full CRUD + `PUT /:id/config` |
| Repositories | `/projects/:pid/repository` | `POST /connect`, `DELETE /`, `GET /available` |
| Deployments | `/environments/:eid/deployments` | `GET /`, `GET /:id`, `GET /:id/logs`, `POST /`, `POST /:id/rollback` |
| Infrastructure | `/environments/:eid/infrastructure` | `POST /preview`, `DELETE /`, `GET /resources` |
| Monitoring | `/environments/:eid/logs` | `GET /` + WebSocket stream |
| Monitoring | `/environments/:eid/metrics` | `GET /cpu`, `GET /memory`, `GET /bandwidth` |
| Webhooks | `/webhooks/github` | `POST /` (GitHub push receiver) |
| Webhooks | `/webhooks/deploy-complete` | `POST /` (GitHub Actions callback after DOCR push, includes build strategy metadata) |

---

## liftoff.yml Schema (Quick Reference)

```yaml
version: "1.0"

service:
  name: my-app          # lowercase, hyphens, max 40 chars
  type: app             # "app" (App Platform) | "kubernetes" (DOKS — post-MVP)
  region: nyc3          # DO region slug

runtime:
  instance_size: apps-s-1vcpu-0.5gb  # DO App Platform instance slug
  replicas: 1
  port: 3000

env:
  NODE_ENV: production

secrets:
  - DATABASE_URL        # injected from DO App Platform secret env vars

database:
  enabled: true
  engine: postgres
  version: "15"
  size: db-s-1vcpu-1gb  # DO Managed DB size slug

storage:
  enabled: false        # DO Spaces bucket

healthcheck:
  path: /health

domain:
  name: api.example.com  # App Platform auto-configures with Let's Encrypt
```
