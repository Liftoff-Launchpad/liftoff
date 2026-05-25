# liftoff.yml — Configuration Reference

Place this file at the **root** of your repository. Liftoff detects it automatically when you connect a repo.

---

## Minimal Example

```yaml
version: "1.0"

service:
  name: test-app
  type: app
  region: nyc3

runtime:
  instance_size: apps-s-1vcpu-0.5gb
  port: 3000
  replicas: 1

healthcheck:
  path: /
```

---

## Full Example

```yaml
version: "1.0"

service:
  name: my-webapp
  type: app                           # "app" (App Platform) | "kubernetes" (DOKS — post-MVP)
  region: nyc3                        # DO region slug

build:
  strategy: auto                      # auto (Dockerfile-first, Nixpacks fallback) | dockerfile | nixpacks
  context: .                          # Build context (relative to repo root)
  dockerfile_path: Dockerfile         # Path to Dockerfile (used first when present)

runtime:
  instance_size: apps-s-1vcpu-0.5gb  # DO App Platform instance slug
  replicas: 2                         # Number of running containers (1–10)
  port: 3000                          # Port your app listens on inside the container

env:                                  # Non-secret environment variables
  NODE_ENV: production
  LOG_LEVEL: info
  API_VERSION: v1

secrets:                              # Injected as encrypted env vars via DO App Platform
  - DATABASE_URL
  - STRIPE_SECRET_KEY

database:
  enabled: true
  engine: postgres
  version: "15"
  size: db-s-1vcpu-1gb               # DO Managed DB size slug

storage:
  enabled: true                       # Creates a DO Spaces bucket, injects BUCKET_NAME env var

healthcheck:
  path: /health                       # HTTP GET path — must return 2xx
  interval: 30                        # Seconds between checks (5–300)
  timeout: 5                          # Seconds before timeout (2–60)

domain:
  name: api.example.com               # App Platform auto-configures HTTPS via Let's Encrypt
```

---

## Field Reference

### `version`
| Value | Required | Description |
|-------|----------|-------------|
| `"1.0"` | ✅ | Must be exactly `"1.0"` |

---

### `service`

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `name` | ✅ | string | Service name. Lowercase letters, numbers, hyphens. Max 40 chars. Used for DO resource naming. |
| `type` | ✅ | `app` \| `kubernetes` | Deployment target. Use `app` (App Platform) unless you need Kubernetes (DOKS — post-MVP). |
| `region` | ✅ | string | DO region slug (e.g. `nyc3`, `ams3`, `sgp1`). See [DO region list](https://docs.digitalocean.com/platform/regional-availability/). |

---

### `build`

| Field | Default | Type | Description |
|-------|---------|------|-------------|
| `strategy` | `auto` | `auto` \| `dockerfile` \| `nixpacks` | Build strategy. `auto` tries Dockerfile first, then falls back to Nixpacks. |
| `context` | `.` | string | Build context relative to repo root |
| `dockerfile_path` | `Dockerfile` | string | Path to Dockerfile from build context |

---

### `runtime`

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `instance_size` | ✅ | string | DO App Platform instance slug. See table below. |
| `replicas` | No | number | Number of running containers. Default: `1`. Range: 1–10. |
| `port` | ✅ | number | Port your app listens on inside the container. |

#### Instance Size Reference

| Slug | vCPU | RAM | Bandwidth |
|------|------|-----|-----------|
| `apps-s-1vcpu-0.5gb` | Shared | 512 MB | — |
| `apps-s-1vcpu-1gb` | Shared | 1 GB | — |
| `apps-s-1vcpu-2gb` | Shared | 2 GB | — |
| `apps-d-1vcpu-2gb` | 1 Dedicated | 2 GB | 1 TB |
| `apps-d-2vcpu-4gb` | 2 Dedicated | 4 GB | 2 TB |
| `apps-d-4vcpu-8gb` | 4 Dedicated | 8 GB | 4 TB |

See the full list in the [DO App Platform pricing docs](https://docs.digitalocean.com/products/app-platform/details/pricing/).

---

### `env`

Plain key/value pairs injected as environment variables at runtime.

```yaml
env:
  NODE_ENV: production
  PORT: "3000"              # Values must be strings
```

⚠️ **Do NOT put secrets here** — they will be visible in your repository and Liftoff dashboard. Use `secrets` instead.

---

### `secrets`

List of secret names. Each is stored as an encrypted environment variable in DO App Platform and injected at runtime. You set the values in the Liftoff dashboard or via the API — they are never stored in `liftoff.yml`.

```yaml
secrets:
  - DATABASE_URL
  - JWT_SECRET
  - STRIPE_SECRET_KEY
```

Set secret values before deploying:

```bash
# Via the Liftoff dashboard:
# Project → Environment → Secrets → Add Secret

# Via API:
curl -X POST https://app.liftoff.dev/api/v1/environments/{envId}/secrets \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "DATABASE_URL", "value": "postgresql://user:pass@host:5432/db"}'
```

Secrets are injected by DO App Platform as encrypted env vars and are never exposed in logs or the dashboard after being set.

---

### `database`

Provisions a DigitalOcean Managed PostgreSQL cluster. The connection string is automatically injected as `DATABASE_URL` in your container.

| Field | Default | Type | Description |
|-------|---------|------|-------------|
| `enabled` | `false` | boolean | Set to `true` to provision a Managed Postgres cluster |
| `engine` | `postgres` | string | Only `postgres` supported in v1.0 |
| `version` | `"15"` | string | PostgreSQL major version (`"14"` or `"15"`) |
| `size` | `db-s-1vcpu-1gb` | string | DO Managed DB size slug |

#### Database Size Reference

| Slug | vCPU | RAM | Storage |
|------|------|-----|---------|
| `db-s-1vcpu-1gb` | 1 | 1 GB | 10 GB |
| `db-s-1vcpu-2gb` | 1 | 2 GB | 25 GB |
| `db-s-2vcpu-4gb` | 2 | 4 GB | 38 GB |
| `db-s-4vcpu-8gb` | 4 | 8 GB | 115 GB |

⚠️ Provisioning a Managed Postgres cluster adds ~5 minutes to first deployment and incurs DO costs (from ~$15/month for `db-s-1vcpu-1gb`).

---

### `storage`

Provisions a DigitalOcean Spaces bucket. The bucket name is injected as `BUCKET_NAME` and the endpoint as `BUCKET_ENDPOINT` environment variables.

| Field | Default | Type | Description |
|-------|---------|------|-------------|
| `enabled` | `false` | boolean | Set to `true` to create a Spaces bucket |

The bucket is created with:
- S3-compatible API access
- Access key injected as `SPACES_KEY` and `SPACES_SECRET` env vars
- Bucket scoped to the same region as `service.region`
- Public access disabled by default

---

### `healthcheck`

Liftoff uses HTTP health checks to verify your app is running after deployment. DO App Platform also uses this path for its own health monitoring.

| Field | Default | Type | Description |
|-------|---------|------|-------------|
| `path` | `/health` | string | HTTP GET path. Must return 2xx status code. |
| `interval` | `30` | number | Seconds between health checks (5–300) |
| `timeout` | `5` | number | Seconds before check times out (2–60) |

**Your app must implement this endpoint.** Example (Node.js/Express):
```javascript
app.get('/health', (req, res) => res.json({ status: 'ok' }));
```

---

### `domain`

Configure a custom domain with automatic HTTPS. DO App Platform handles certificate provisioning via Let's Encrypt — no DNS zone configuration needed in Liftoff.

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `name` | ✅ | string | Full domain name (e.g., `api.example.com`) |

**Prerequisites:**
1. Add a CNAME record in your DNS provider pointing `your-domain.com` to the App Platform app URL (shown in the Liftoff dashboard after first deploy).
2. Liftoff will configure the domain in App Platform and Let's Encrypt will automatically issue and renew the certificate (~2 minutes).

There is no hosted zone or certificate manager configuration required.

---

## Validation

Validate your config without deploying:

```bash
# Via the Liftoff dashboard:
# Project → Environment → Configuration → Validate

# Via API:
curl -X POST https://app.liftoff.dev/api/v1/projects/{id}/environments/{envId}/config/validate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"configYaml": "version: \"1.0\"\nservice:\n  name: ..."}'
```

---

## Common Mistakes

| Mistake | Error | Fix |
|---------|-------|-----|
| `service.name: My App` | Name must be lowercase | Use `my-app` |
| `service.type: ecs` | Invalid type | Use `app` for App Platform |
| `instance_size: 512` | Must be a DO slug, not a number | Use e.g. `apps-s-1vcpu-0.5gb` |
| `port: 80` inside container | Works but not recommended | Use a high port like 3000 or 8080 |
| Missing `healthcheck.path` implementation | Deployment never becomes healthy | Add health endpoint to your app |
| Secret value in `liftoff.yml` under `env` | Secret visible in repo and dashboard | Move to `secrets` list and set value via dashboard/API |
| `version: 1.0` (without quotes) | YAML parses as float 1.0 | Use `version: "1.0"` with quotes |
| `region` not set | Defaults may conflict with DO account | Always set `service.region` explicitly |
