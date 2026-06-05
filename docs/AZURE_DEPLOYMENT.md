# Deploying the Liftoff platform to Azure

This describes how the **Liftoff platform itself** is hosted and continuously
deployed on Azure. It is unrelated to what Liftoff does at runtime — user apps
are still built and provisioned to **DigitalOcean** via Pulumi. This is only
about running the SaaS (API, dashboard, marketing site) in the cloud.

## Topology

| Component        | Azure resource                                   | Notes                                              |
| ---------------- | ------------------------------------------------ | -------------------------------------------------- |
| API (NestJS)     | Container App `liftoff-api`                       | External HTTPS :4000, always-on (BullMQ + sockets) |
| Web (Next.js)    | Container App `liftoff-web`                       | External HTTPS :3000                               |
| Website (Next.js)| Container App `liftoff-website`                   | External HTTPS :3001, scales to zero               |
| PostgreSQL       | Container App `liftoff-postgres` (internal TCP)   | Data on an Azure Files share                        |
| Redis            | Container App `liftoff-redis` (internal TCP)      | Ephemeral (queues + socket pub/sub)                |
| Image registry   | Azure Container Registry `liftoffacr0413`         | Basic tier                                          |
| Secrets          | Azure Key Vault `liftoff-kv-0413`                 | RBAC; runtime secrets, read by the managed identity |
| Compute host     | Container Apps env `liftoff-env`                  | Log Analytics `liftoff-logs`                        |
| CI/CD identity   | User-assigned MI `liftoff-cicd-mi`               | GitHub OIDC; Contributor (RG) + AcrPush only        |
| Runtime identity | User-assigned MI `liftoff-app-mi`                | Attached to apps; AcrPull + KV Secrets User only    |

Region: **UAE North**. Resource group: **liftoff-rg**.

## Why a user-assigned managed identity (not a service principal)?

This subscription lives on a university Entra tenant where
`allowedToCreateApps = false` — normal users **cannot** create app registrations
or service principals. The standard GitHub→Azure auth (SP secret or
app-registration OIDC) is therefore impossible.

A **user-assigned managed identity** is an ARM resource (not a directory object),
so the subscription Owner can create it and attach a **GitHub Actions federated
credential** to it. GitHub's OIDC token is exchanged directly for an Azure token
as that identity — **no secret is ever stored in GitHub**, and all app secrets
stay in Key Vault.

Two identities are used so CI and the running apps never share privileges
(least privilege — a compromised app pod can't escalate, and CI can't read secrets):

```
GitHub Actions ──OIDC token──▶ Entra ──(federated cred on liftoff-cicd-mi)──▶ Azure token
                                          │
                       Contributor on RG ─┤── az containerapp update (roll out images)
                       AcrPush on ACR  ───┘── docker push
   (liftoff-cicd-mi is NEVER attached to an app and has NO Key Vault access.)

Container Apps ──(runtime identity liftoff-app-mi)──▶ AcrPull (pull images) + Key Vault Secrets User (read secrets)
   (liftoff-app-mi has NO push/deploy rights and is the only identity on the pods.)
```

## Secrets

All runtime secrets live in Key Vault and are referenced by the Container Apps
via the managed identity. The mapping (Key Vault secret → env var) is in
`infra/azure/apps.bicep`. Non-secret config (URLs, DO Spaces bucket/region,
throttle limits) is set as plain env vars.

Seed/update them from your local `apps/api/.env`:

```powershell
./scripts/azure/set-secrets.ps1 -KeyVaultName liftoff-kv-0413 -ResourceGroup liftoff-rg
```

> This deploys `infra/azure/secrets.bicep`, which creates the secrets via the
> **control plane** (ARM) — it only needs the Owner/Contributor role you already
> have. It deliberately avoids the data-plane `az keyvault secret set`, which on
> an RBAC vault would additionally require a "Key Vault Secrets Officer" role.
> Secret values are passed as `@secure()` params via a temp file that is deleted
> immediately and never logged.
>
> A new Postgres password is generated each run; after the DB exists, pass
> `-PostgresPassword <original>` (or just don't re-run) to avoid a mismatch.

## First-time provisioning (idempotent)

```powershell
# Logged into az CLI with the target subscription selected:
./scripts/azure/bootstrap.ps1
```

This creates the resource group, deploys `main.bicep` (infra), seeds Key Vault,
builds & pushes the three images, then deploys `data.bicep` (Postgres + Redis)
and `apps.bicep` (API + web + website).

## Continuous deployment

`.github/workflows/deploy-platform.yml` runs on every push to `main`:

1. **test** — `pnpm install`, `pnpm typecheck`, `pnpm test`
2. **deploy** — OIDC login as the managed identity → `az acr build` the three
   images → `az containerapp update --image` to roll them out.

Wire the repo once (sets non-sensitive Actions *variables* only):

```powershell
./scripts/azure/setup-github.ps1 -Repo munimx/liftoff   # needs `gh auth login`
```

The data services (`liftoff-postgres`, `liftoff-redis`) are intentionally **not**
touched by CI, so code deploys never restart the database. For config/topology
changes, re-run the relevant Bicep deployment manually.

## Post-deploy checklist (functional, not just "boots")

These are required for the app to fully work end-to-end:

1. **GitHub OAuth app** — set the callback URL to
   `https://liftoff-api.<env-domain>/api/v1/auth/github/callback` and the
   homepage to the web URL. (Boot succeeds regardless; login needs this.)
2. **GitHub webhooks** — `WEBHOOK_BASE_URL` is set to the API's public URL, so
   webhooks registered after deploy will reach Azure.
3. **Cross-subdomain auth cookies** — `web` and `api` are on different
   `*.azurecontainerapps.io` subdomains. The refresh-token cookie is currently
   `sameSite: 'strict'`, which browsers will not send cross-site. To make login
   work in the cloud, set the refresh cookie to `sameSite: 'none'; secure` in
   production (`apps/api/src/auth/auth.controller.ts`,
   `apps/api/src/users/users.controller.ts`) — or front both apps with a single
   hostname. See "Known follow-ups" below.

## Known follow-ups

These were surfaced by an adversarial review and accepted as low/medium for an
FYP/demo. None block deployment; each is a hardening step for production.

- **Refresh-cookie SameSite** (above) — small code change gated on `NODE_ENV`;
  required for cross-subdomain login to work in the cloud.
- **Postgres durability** — runs as a container on an Azure Files (SMB) volume
  mounted with `uid/gid=70`. Fine for an FYP/demo; for production switch to
  Azure Database for PostgreSQL Flexible Server (one Bicep change).
- **Non-root containers** — the three images run as root (no `USER`). Add
  `USER node` (alpine ships uid 1000); for the API ensure the Prisma cache /
  migrate step stays writable.
- **Runtime image slimming** — `production` stages inherit the full dependency
  tree (incl. devDeps). Web could use Next.js `standalone` output (like the
  website image); the API could `pnpm prune --prod` after promoting `prisma` to
  a runtime dependency.
- **Redis AUTH** — Redis runs without `requirepass` on internal TCP; any app in
  the same Container Apps environment can reach it. Add a password via a Key
  Vault `secretRef` (mirror the Postgres pattern) if the env becomes multi-tenant.
- **Key Vault purge protection** — off by default (so the student vault stays
  deletable). Set `-p enableKvPurgeProtection=true` on a fresh deploy for prod
  (irreversible). Soft-delete retention defaults to 90 days on fresh vaults
  (the existing vault is fixed at 7 — it can't be changed after creation).
- **Rollout atomicity** — the deploy job rolls out api/web/website with three
  sequential `az containerapp update` calls and no retry; a mid-sequence
  transient error can leave a brief version skew (re-running the job self-heals).
- **Custom domains / TLS** — add via `az containerapp hostname add` if you move
  off the default `*.azurecontainerapps.io` domains.
