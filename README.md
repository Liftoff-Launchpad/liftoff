# Liftoff — Deploy-as-a-Service Platform

> **Vibe-coding tool:** GitHub Copilot CLI  
> **Platform hosting:** DigitalOcean (App Platform + Managed PostgreSQL + Managed Redis + Spaces + Container Registry)  
> **User infrastructure:** DigitalOcean (App Platform, Managed Databases, Spaces, DOCR — in the user's own DO account)  
> **Stack:** Next.js 14 · NestJS · Pulumi · Docker · PostgreSQL · Redis  
> **Monorepo:** pnpm workspaces + Turborepo

---

## What is Liftoff?

Liftoff is a developer-first **Deploy-as-a-Service (DaaS)** platform. Developers push code — Liftoff builds the Docker image and provisions DigitalOcean infrastructure in **the user's own DigitalOcean account** via Pulumi + GitHub Actions.

**Everything runs on DigitalOcean.** The Liftoff platform itself (API, frontend, database, queues) is hosted on DigitalOcean. User applications also deploy to DigitalOcean — into the user's own DO account using their own DO API token. There is no AWS anywhere.

```
┌────────────────────────────────────┐      ┌─────────────────────────────────┐
│  Liftoff Platform (DigitalOcean)   │      │  User's DigitalOcean Account    │
│                                    │      │                                  │
│  App Platform  (API + Web)         │─────▶│  App Platform (user's app)       │
│  Managed PostgreSQL                │  DO  │  DOCR (user's images)            │
│  Managed Redis                     │  API │  Managed PostgreSQL (optional)   │
│  Container Registry (DOCR)         │  Token Spaces (optional)               │
│  Spaces (Pulumi state)             │      │  Load Balancer (auto via App Plat)│
└────────────────────────────────────┘      └─────────────────────────────────┘
```

---

## Repository Structure

```
liftoff/
├── apps/
│   ├── web/                   # Next.js 14 frontend (App Router)
│   └── api/                   # NestJS backend
├── packages/
│   ├── pulumi-components/     # Reusable Pulumi DO infrastructure modules
│   ├── shared/                # Shared TypeScript types, Zod schemas, constants
│   └── config/                # Shared ESLint + TypeScript configs
├── infra/                     # Liftoff platform's own DO infrastructure (Pulumi)
├── docs/                      # Architecture, environment, setup guides
├── .github/
│   └── copilot-instructions.md    # AI agent instructions — READ THIS FIRST
├── docker-compose.yml         # Local dev: PostgreSQL + Redis + ngrok + API + Web
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

---

## Prerequisites — Human Developer Must Install

### Required Tools

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 20 LTS | https://nodejs.org |
| pnpm | 9.x | `npm install -g pnpm` |
| Docker Desktop | Latest | https://docker.com/products/docker-desktop |
| doctl (DigitalOcean CLI) | Latest | `brew install doctl` |
| Pulumi CLI | 3.x | `curl -fsSL https://get.pulumi.com \| sh` |
| Git | Latest | https://git-scm.com |
| GitHub CLI (`gh`) | Latest | https://cli.github.com |

### Required Accounts

- [ ] **DigitalOcean account** — everything runs here. Create API token at: Cloud → API → Generate New Token (read+write)
- [ ] **GitHub account** — OAuth App for user login + API for repo/webhook management

> **No AWS account required.** There is no AWS in this project.

---

## Local Development Setup

Choose one of the two setup methods below:

### Option A: Docker (Recommended for New Developers)

Complete containerized setup with hot-reloading — no need to install Node.js, pnpm, or PostgreSQL locally.

```bash
# 1. Clone and start everything with Docker
git clone https://github.com/YOUR_ORG/liftoff.git && cd liftoff

# 1.5 Export ngrok token (required for reserved domain tunnel)
export NGROK_AUTHTOKEN=your_ngrok_authtoken

# 2. Build and start all services (PostgreSQL, Redis, ngrok, API, Web)
docker compose build
docker compose up -d

# 3. Run database migrations inside the API container
docker compose exec api pnpm db:migrate

# 4. Access the application
# Web UI:  http://localhost:3000
# API:     http://localhost:4000
# ngrok inspector: http://localhost:4040
# Webhook base URL: https://aniya-preservable-harriett.ngrok-free.dev
# Postgres: localhost:5432 (user: liftoff, password: liftoff, db: liftoff)
# Redis:   localhost:6379

# 5. View logs
docker compose logs -f api
docker compose logs -f web
docker compose logs -f ngrok

# 6. Stop everything
docker compose down
```

> **Hot-reloading enabled:** Source code changes in `apps/api/src` and `apps/web/src` are reflected in the containers automatically via volume mounts.

### Option B: Native Development

```bash
# 1. Clone and install
git clone https://github.com/YOUR_ORG/liftoff.git && cd liftoff
pnpm install

# 2. Copy env files
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
# Fill in values — see docs/ENVIRONMENT.md

# 3. Start local dependencies
docker compose up -d        # PostgreSQL :5432, Redis :6379

# 4. Run migrations
pnpm --filter api db:migrate

# 5. Start dev servers
pnpm dev
# web → http://localhost:3000
# api → http://localhost:4000
```

---

## Key Commands

```bash
pnpm dev                      # Start all apps
pnpm build                    # Build all apps
pnpm test                     # Run all unit tests
pnpm typecheck                # TypeScript check all packages
pnpm lint                     # Lint all packages

pnpm --filter api db:migrate  # Run pending migrations
pnpm --filter api db:studio   # Open Prisma Studio

doctl auth init               # Authenticate DigitalOcean CLI
doctl apps list               # List App Platform apps
doctl registry login          # Authenticate Docker to DOCR
```

---

## Documentation Index

| Document | Purpose |
|----------|---------|
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | System design, DO-only architecture, data flow |
| [`docs/ENVIRONMENT.md`](./docs/ENVIRONMENT.md) | All environment variables explained |
| [`docs/DO_ACCOUNT_SETUP.md`](./docs/DO_ACCOUNT_SETUP.md) | How end users connect their DO account to Liftoff |
| [`docs/LIFTOFF_YML.md`](./docs/LIFTOFF_YML.md) | `liftoff.yml` config schema reference |
| [`.github/copilot-instructions.md`](./.github/copilot-instructions.md) | AI agent coding instructions |
| [`docs/phases/PHASE_INDEX.md`](./docs/phases/PHASE_INDEX.md) | Build phase map |
