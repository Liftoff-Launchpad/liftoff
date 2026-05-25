# Phase 12 — Railway-Inspired Canvas UI
## AI Agent Instructions

**Read `.github/copilot-instructions.md` before this file. All global rules apply.**
**Phases 1–11 are complete. Do not modify any existing backend services, processors, or DB schema.**

---

## Overview

Phase 12 replaces the current multi-step "connect repo → configure environment → deploy" workflow with a single, spatial, Railway-inspired canvas experience. The user's **only required action** is selecting a GitHub repository. Everything else (environment detection, build, deploy, canvas population) happens automatically. The existing "Developer Mode" remains accessible for advanced users who want to edit `liftoff.yml` directly.

---

## Core UX Principles

1. **Zero-config first**: The user picks a repo. Liftoff does the rest automatically.
2. **Spatial over tabular**: Services live on a pannable, zoomable 2D canvas, not a list.
3. **Staged changes, never immediate**: Infrastructure mutations are queued and applied together on "Deploy".
4. **Live feedback, always**: Every node on the canvas reflects real-time build/deploy state.
5. **Wiring over copy-paste**: Environment variables are linked between nodes, not typed manually.
6. **Developer Mode as escape hatch**: The existing liftoff.yml editor is still accessible but hidden by default.

---

## What Gets Built

### New Pages / Routes

```
app/(dashboard)/projects/[id]/canvas/page.tsx          ← Main canvas page (NEW default view)
app/(dashboard)/projects/[id]/canvas/layout.tsx        ← Canvas layout (full-screen, no padding)
```

### New Component Tree

```
components/canvas/
├── project-canvas.tsx                 ← Root: React Flow wrapper, staged-changes bus
├── canvas-toolbar.tsx                 ← Top bar: project name, Deploy button, staged-changes badge
├── canvas-empty-state.tsx             ← Shown before first repo connect: repo picker
├── service-node.tsx                   ← Generic node (Web App, Worker, Cron)
├── database-node.tsx                  ← Postgres / Redis node variant
├── node-state-badge.tsx               ← QUEUED / BUILDING / LIVE / FAILED badge
├── build-log-stream.tsx               ← WebSocket-driven terminal (inside drawer)
├── config-drawer/
│   ├── config-drawer.tsx              ← Slide-out right panel
│   ├── drawer-deployments-tab.tsx     ← Build log stream + deployment history
│   ├── drawer-variables-tab.tsx       ← Env vars with node-linking autocomplete
│   ├── drawer-metrics-tab.tsx         ← CPU / RAM sparklines (recharts)
│   └── drawer-settings-tab.tsx        ← Domains, scaling, danger zone
├── staged-changes/
│   ├── staged-changes-bar.tsx         ← Floating bottom bar ("2 Staged Changes · Deploy")
│   └── staged-changes-store.ts        ← Zustand store for pending mutations
└── command-palette/
    ├── command-palette.tsx             ← Cmd+K overlay
    └── command-palette-items.ts        ← "Add Postgres", "Add Redis", "Add Worker", etc.
```

### New API Endpoints (Backend — `apps/api/src/`)

```
POST /projects/:projectId/canvas/auto-setup
     Body: { githubRepoId, fullName, branch, doAccountId?, environmentId? }
     → Creates Project + Environment + connects repo + triggers first build
     → Returns: { projectId, environmentId, deploymentId, nodes, edges }

GET  /projects/:projectId/canvas
     → Returns canvas node/edge layout for the project
     → Merges: environments, pulumiStack outputs, latest deployments, DO account regions

PATCH /projects/:projectId/canvas/layout
     Body: { nodes: [{ id, position }] }
     → Persists only node X/Y positions (does not trigger deploy)
```

---

## Detailed Build Spec

---

### 1. Canvas Entry Point — The New Default View

**Change the project detail page** (`app/(dashboard)/projects/[id]/page.tsx`) to redirect to `/projects/[id]/canvas` instead of rendering the environment list.

**`app/(dashboard)/projects/[id]/canvas/layout.tsx`**

```tsx
// Full-screen layout — no padding, no header, no sidebar scroll
// The canvas takes 100% of viewport height
// The sidebar and global header are still rendered but the main content area is edge-to-edge
export default function CanvasLayout({ children }) {
  return (
    <div className="h-screen w-full overflow-hidden">
      {children}
    </div>
  );
}
```

---

### 2. Empty State — Repo Picker (First User Action)

When a project has **no connected repository**, render `<CanvasEmptyState />` centered on the canvas instead of the node graph.

**`components/canvas/canvas-empty-state.tsx`**

```
┌─────────────────────────────────────────────┐
│                                             │
│   🚀  Deploy your GitHub repo               │
│                                             │
│   [ Search your repositories...    ▾ ]     │
│                                             │
│   ────  Recent repos  ────                  │
│   ○  liftoff/my-nextjs-app    main          │
│   ○  liftoff/express-api      main          │
│   ○  liftoff/django-app       main          │
│                                             │
│   DigitalOcean Account: [ nyc3 ▾ ]         │
│                                             │
│   [ 🚀  Auto-Deploy ]                       │
│                                             │
└─────────────────────────────────────────────┘
```

**Behavior:**
1. On mount, call `GET /projects/:id/repository/available` to populate the list.
2. User selects a repo (search + scroll list).
3. User optionally changes the DO account / region.
4. User clicks **Auto-Deploy**.
5. Call `POST /projects/:projectId/canvas/auto-setup`.
6. Show a full-canvas loading overlay: "Analyzing your code with Railpack…" → "Provisioning DigitalOcean infrastructure…" → "Building your image…"
7. When the response comes back, transition to the populated canvas.

---

### 3. The Project Canvas

**`components/canvas/project-canvas.tsx`**

Uses `@xyflow/react` (already installed). The canvas has:

- **Background**: `BackgroundVariant.Dots` with `gap={20}`, `size={1}`, very subtle opacity.
- **Controls**: Bottom-left zoom buttons, styled to match Liftoff's dark card aesthetic.
- **MiniMap**: Disabled by default. Accessible via toolbar toggle.
- **Panning**: Enabled. Mouse wheel zooms. Space+drag pans.
- **Node selection**: Single click selects and opens Config Drawer. No multi-select required in v1.
- **Edge style**: Animated, curved bezier edges. Color: `hsl(var(--muted-foreground) / 0.4)`. No labels on edges by default.
- **Right-click**: Opens `<CommandPalette />` anchored at cursor position.

**Canvas Node Layout (auto-populated after first deploy):**

The backend `GET /projects/:projectId/canvas` determines initial positions. Layout algorithm:

```
Trigger (left)  →  App Service (center)  →  [ Database (below-right), Spaces (below-right+1) ]
                                         ↑
                                    [ EnvVars (above) ]
```

Suggested positions (in React Flow units):
- App Service node: `{ x: 400, y: 200 }`
- Postgres node: `{ x: 680, y: 380 }`
- Redis node: `{ x: 680, y: 520 }`
- EnvVars node: `{ x: 400, y: 60 }`

---

### 4. Service Node Design

**`components/canvas/service-node.tsx`**

Each node is a styled card. Width: `240px`. Use `React.memo`.

```
┌─────────────────────────────────┐
│  🟢  ●  Web Service             │  ← state dot (color = status)
│      my-nextjs-app              │  ← service name
│      registry.do.com/…:abc1234  │  ← image tag (truncated)
│                                 │
│  ─────────────────────────────  │
│  🌐 https://app.ondigitalocean… │  ← live URL (if deployed)
│  nyc3  ·  1 vCPU  ·  512MB     │  ← region + instance size
│  Updated 2 min ago             │  ← last deploy timestamp
└─────────────────────────────────┘
```

**Node states** (drive the left border color and state dot color):

| State         | Border color      | Dot        | Dot animation |
|---------------|-------------------|------------|---------------|
| `PENDING`     | `border-muted`    | gray       | none          |
| `QUEUED`      | `border-blue-400` | blue       | pulse         |
| `BUILDING`    | `border-blue-500` | blue       | spin          |
| `PUSHING`     | `border-indigo-500`| indigo    | pulse         |
| `PROVISIONING`| `border-purple-500`| purple   | spin          |
| `DEPLOYING`   | `border-violet-500`| violet   | pulse         |
| `SUCCESS`     | `border-emerald-500`| green   | none (solid)  |
| `FAILED`      | `border-red-500`  | red        | none          |
| `STAGED`      | `border-amber-400`| amber      | none          |

**`components/canvas/database-node.tsx`**

Same card style, but:
- Shows database engine icon (🐘 for Postgres, ⚡ for Redis).
- Shows `hostname:port` instead of a URL.
- Shows storage size.
- No build log tab in drawer (replaced by Connection Info tab).

---

### 5. Config Drawer (Right Sidebar)

**`components/canvas/config-drawer/config-drawer.tsx`**

Slides in from the right when a node is clicked. Width: `420px`. Does **not** replace the canvas — it overlays it from the right edge.

Tabs:

#### Tab 1: Deployments

- Shows the last 5 deployment records in a compact list (status badge, commit SHA, timestamp, duration).
- The **active/most recent** deployment expands to show a streaming build log terminal.

**`components/canvas/config-drawer/drawer-deployments-tab.tsx`**

```
┌─ DEPLOYMENTS ──────────────────────────────────┐
│ ✅ abc1234  main  2m ago  45s                  │
│ ──────────────────────────────────────────── ▼ │
│  $ npm install                                  │
│  $ npm run build                                │
│  ✓ Build complete (38s)                         │
│  $ docker push registry.do.com/…               │
│  ✓ Pushed (7s)                                  │
│  ✓ Deployed to App Platform                     │
│ ──────────────────────────────────────────────  │
│ ⏳ def5678  main  5m ago  BUILDING…             │
│ ❌ ghi9012  main  1h ago  FAILED  View logs     │
└────────────────────────────────────────────────┘
```

- The log viewer reuses the existing `<LogViewer />` component from `components/deployments/log-viewer.tsx`.
- Subscribe to `WsEvents.DEPLOYMENT_LOG` and `WsEvents.DEPLOYMENT_STATUS` for the active deployment.
- Auto-scroll to bottom. "Pause" button to freeze scroll.

#### Tab 2: Variables

**`components/canvas/config-drawer/drawer-variables-tab.tsx`**

```
┌─ VARIABLES ────────────────────────────────────┐
│  NODE_ENV         production                   │
│  PORT             3000                         │
│  DATABASE_URL     ${{ Postgres.DATABASE_URL }} │  ← linked reference (chip style)
│                                                │
│  [ + Add Variable ]                            │
└────────────────────────────────────────────────┘
```

**Variable linking** (the "magic" feature):

When a user clicks **+ Add Variable**:
1. An inline row appears with Key and Value inputs.
2. When the user focuses the **Value** input and types `${{`, an autocomplete dropdown appears.
3. The dropdown lists all **other nodes** on the canvas and their exported variables.
4. Example: selecting `Postgres → DATABASE_URL` inserts the literal string `${{ Postgres.DATABASE_URL }}` into the value field.
5. On save, the frontend resolves this reference into the actual environment variable format expected by Liftoff (a raw connection string from the PulumiStack outputs).
6. Linked variables render as a colored chip/badge instead of plain text, showing the source node name.

**Implementation note**: The "resolution" maps `${{ Postgres.DATABASE_URL }}` to the actual value from `pulumiStack.outputs.dbUri` at deploy time. Store the raw `${{ ... }}` syntax in a `linkedVars` field in local state; the API receives the resolved value.

#### Tab 3: Metrics

**`components/canvas/config-drawer/drawer-metrics-tab.tsx`**

- Three sparkline charts (recharts `AreaChart`, small, no axes labels): CPU %, Memory %, Network.
- Data from `GET /environments/:id/metrics/cpu`, etc.
- Auto-refreshes every 30 seconds.
- If no infra exists yet: "Deploy first to see metrics."

#### Tab 4: Settings

**`components/canvas/config-drawer/drawer-settings-tab.tsx`**

```
DOMAINS
[ + Add Custom Domain ]
  api.myapp.com  ✅ Active  [ Remove ]

SCALING
  Instance Size:  [ apps-s-1vcpu-0.5gb ▾ ]
  Replicas:       [ 1  ▾ ]

DANGER ZONE
  [ Redeploy ]   [ Delete Environment ]
```

- Changing Instance Size or Replicas adds a **staged change** (see Section 6).
- "Redeploy" triggers `POST /environments/:id/deployments` immediately (not staged).
- "Delete Environment" shows a confirmation dialog.

---

### 6. Staged Changes System

This is the most critical correctness feature. **No infrastructure mutation happens immediately.**

**`components/canvas/staged-changes/staged-changes-store.ts`**

```typescript
// Zustand store — separate from auth store
interface StagedChange {
  id: string;           // uuid
  nodeId: string;       // which canvas node this affects
  type: 'ADD_SERVICE' | 'REMOVE_SERVICE' | 'CHANGE_VARIABLE' | 'CHANGE_SCALING' | 'CHANGE_DOMAIN';
  label: string;        // human-readable: "Add PostgreSQL", "Change DATABASE_URL"
  payload: unknown;     // the actual mutation data
}

interface StagedChangesState {
  changes: StagedChange[];
  addChange: (change: Omit<StagedChange, 'id'>) => void;
  removeChange: (id: string) => void;
  clearAll: () => void;
}
```

**When a staged change is created:**
1. The affected node gets a `border-amber-400` border (STAGED state).
2. A small "Staged" badge appears on the node.
3. The Staged Changes Bar appears/updates.

**`components/canvas/staged-changes/staged-changes-bar.tsx`**

```
┌──────────────────────────────────────────────────────────────────┐
│  ⚡  2 Staged Changes  ·  Add PostgreSQL, Change DATABASE_URL    │
│                                          [ Discard ]  [ Deploy ] │
└──────────────────────────────────────────────────────────────────┘
```

- Fixed position: `bottom-6 left-1/2 -translate-x-1/2`.
- Only visible when `changes.length > 0`.
- **Discard**: calls `clearAll()`, nodes return to previous state.
- **Deploy**: calls the existing `POST /environments/:id/pipeline/deploy` flow after writing changes to the environment config. Then clears staged changes.

---

### 7. Command Palette

**`components/canvas/command-palette/command-palette.tsx`**

Triggered by:
- Right-clicking on empty canvas area.
- Pressing `Cmd+K` / `Ctrl+K` globally.

```
┌─────────────────────────────────────────┐
│  🔍  Search or add a service...         │
│  ─────────────────────────────────────  │
│  DATABASE                               │
│  🐘  Add PostgreSQL                     │
│  ⚡  Add Redis                           │
│  ─────────────────────────────────────  │
│  STORAGE                                │
│  🪣  Add Spaces Bucket                  │
│  ─────────────────────────────────────  │
│  COMPUTE                                │
│  ⚙️  Add Worker Service                 │
│  ⏰  Add Cron Job                       │
│  ─────────────────────────────────────  │
│  ACTIONS                                │
│  🚀  Redeploy All                       │
│  🔍  Developer Mode                     │
└─────────────────────────────────────────┘
```

**Adding a service** (e.g., "Add PostgreSQL"):
1. A new database node appears on the canvas at the cursor position, in `STAGED` state.
2. A staged change is added: `{ type: 'ADD_SERVICE', label: 'Add PostgreSQL', payload: { engine: 'postgres' } }`.
3. The edge from the app node to the new DB node is drawn immediately (visual only).
4. The config drawer opens for the new node so the user can configure it.
5. Nothing is provisioned until "Deploy" is clicked.

---

### 8. Canvas Toolbar

**`components/canvas/canvas-toolbar.tsx`**

Fixed top bar overlaying the canvas:

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ← Projects    my-webapp    [LIVE ✅]            [ Dev Mode ]  [ ··· ]   │
└──────────────────────────────────────────────────────────────────────────┘
```

- **← Projects**: navigates to `/projects`.
- **Project name**: the project name.
- **[LIVE ✅]**: badge showing the overall project status. Green when all services are `SUCCESS`. Yellow if any are active. Red if any `FAILED`.
- **[Dev Mode]**: navigates to the existing environment settings page (`/projects/[id]/environments/[envId]`) where the user can edit `liftoff.yml` directly, manage the pipeline builder, etc.
- **[···]**: overflow menu with: Rename Project, View Deployment History, Project Settings, Delete Project.

---

### 9. Backend: Auto-Setup Endpoint

**`apps/api/src/canvas/canvas.controller.ts`**

```typescript
@Controller('projects/:projectId/canvas')
@UseGuards(JwtAuthGuard)
export class CanvasController {

  // POST /projects/:projectId/canvas/auto-setup
  // The "magic button" — does everything in one call
  async autoSetup(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
    @Body() dto: AutoSetupDto,
  ): Promise<AutoSetupResult>

  // GET /projects/:projectId/canvas
  // Returns the enriched canvas state (nodes + edges + live status)
  async getCanvas(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
  ): Promise<CanvasState>

  // PATCH /projects/:projectId/canvas/layout
  // Saves only node positions (no deploy side effects)
  async saveLayout(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
    @Body() dto: SaveLayoutDto,
  ): Promise<void>
}
```

**`apps/api/src/canvas/canvas.service.ts`**

`autoSetup(projectId, userId, dto)`:
1. Assert user is OWNER of the project.
2. Call existing `RepositoriesService.connect(projectId, userId, dto)` — creates webhook + commits workflow.
3. Find the environment that matches `dto.branch` (or the first active environment).
4. Call existing `DeploymentsService.trigger(environmentId, userId, {})` to queue the first deployment.
5. Return `{ projectId, environmentId, deploymentId }` — the frontend subscribes to WebSocket events for live status updates.

`getCanvas(projectId, userId)`:
1. Fetch all non-deleted environments for the project.
2. For each environment, fetch: latest deployment (status + endpoint), pulumiStack (outputs), DO account (region).
3. Compose canvas nodes:
   - One `ServiceNode` per environment.
   - One `DatabaseNode` per environment where `pulumiStack.outputs.dbUri` exists.
   - One `DatabaseNode` per environment where `pulumiStack.outputs.bucketName` exists.
4. Compute edges from stored `PipelineGraph` OR derive them from the config.
5. Return positions from stored canvas layout (if any), else use the default layout algorithm above.

**`apps/api/src/canvas/dto/auto-setup.dto.ts`**

```typescript
export class AutoSetupDto {
  @IsInt() @Min(1)
  githubRepoId: number;

  @IsString() @IsNotEmpty()
  fullName: string;       // "owner/repo"

  @IsString() @IsNotEmpty()
  branch: string;

  @IsString() @IsOptional()
  doAccountId?: string;

  @IsString() @IsOptional()
  environmentId?: string;
}
```

**`apps/api/src/canvas/canvas.module.ts`** — imports: ProjectsModule, RepositoriesModule, EnvironmentsModule, DeploymentsModule, InfrastructureModule.

---

### 10. Frontend: Live Status via WebSocket

In `project-canvas.tsx`, after the canvas mounts:

```typescript
useEffect(() => {
  // For each environment node on the canvas:
  socket.emit(WsEvents.JOIN_DEPLOYMENT, { deploymentId: activeDeploymentId });
  socket.on(WsEvents.DEPLOYMENT_STATUS, (payload) => {
    // Update the node's state in React Flow's node data
    setNodes(nds => nds.map(n =>
      n.id === environmentId
        ? { ...n, data: { ...n.data, status: payload.status } }
        : n
    ));
  });
  socket.on(WsEvents.DEPLOYMENT_COMPLETE, (payload) => {
    // Refetch canvas to get updated endpoint URL
    queryClient.invalidateQueries(['canvas', projectId]);
  });
}, [activeDeploymentId]);
```

---

### 11. Hooks

**`hooks/queries/use-canvas.ts`**

```typescript
// useCanvas(projectId) — GET /projects/:id/canvas
// useAutoSetup(projectId) — POST /projects/:id/canvas/auto-setup (mutation)
// useSaveCanvasLayout(projectId) — PATCH /projects/:id/canvas/layout (debounced mutation)
```

`useSaveCanvasLayout` should be called with a **500ms debounce** on every `onNodesChange` event where the change type is `position`. This silently persists node positions without any user action.

---

### 12. Navigation Changes

**Update `components/layout/sidebar.tsx`**: The "Projects" nav item still exists. Clicking a project card on the projects list now routes to `/projects/[id]/canvas` instead of `/projects/[id]`.

**Update `app/(dashboard)/projects/[id]/page.tsx`**: Redirect to `/projects/[id]/canvas`.

**Add a persistent "Developer Mode" link** within the canvas toolbar that navigates to:
`/projects/[id]/environments/[envId]` — the existing tabbed environment detail page with pipeline builder, config editor, etc. This preserves all Phase 1–11 functionality as the "advanced" view.

---

### 13. Database Schema Addition

Add one column to store canvas layout positions (no new table needed):

**`prisma/migrations/YYYYMMDD_canvas_layout/migration.sql`**

```sql
ALTER TABLE "environments"
ADD COLUMN "canvas_position" JSONB;
-- Stores: { x: number, y: number }
-- Null = use default auto-layout
```

**Update `prisma/schema.prisma`** — add `canvasPosition Json? @map("canvas_position")` to the `Environment` model.

---

## File Map Summary

```
apps/api/src/canvas/
├── canvas.module.ts
├── canvas.controller.ts
├── canvas.service.ts
└── dto/
    ├── auto-setup.dto.ts
    ├── canvas-state.dto.ts
    └── save-layout.dto.ts

apps/web/
├── app/(dashboard)/projects/[id]/
│   ├── page.tsx                          ← MODIFY: redirect to /canvas
│   └── canvas/
│       ├── layout.tsx                    ← NEW: full-screen layout
│       └── page.tsx                      ← NEW: main canvas page
└── src/components/canvas/
    ├── project-canvas.tsx
    ├── canvas-toolbar.tsx
    ├── canvas-empty-state.tsx
    ├── service-node.tsx
    ├── database-node.tsx
    ├── node-state-badge.tsx
    ├── config-drawer/
    │   ├── config-drawer.tsx
    │   ├── drawer-deployments-tab.tsx
    │   ├── drawer-variables-tab.tsx
    │   ├── drawer-metrics-tab.tsx
    │   └── drawer-settings-tab.tsx
    ├── staged-changes/
    │   ├── staged-changes-bar.tsx
    │   └── staged-changes-store.ts
    └── command-palette/
        ├── command-palette.tsx
        └── command-palette-items.ts

hooks/queries/use-canvas.ts               ← NEW
```

---

## Explicit Non-Goals for Phase 12

- **Do NOT modify** any BullMQ processor, Pulumi runner, or infrastructure provisioning logic.
- **Do NOT change** any existing API endpoints (only ADD new ones under `/canvas`).
- **Do NOT remove** the existing pipeline builder page — it becomes "Developer Mode".
- **Do NOT add** a new Prisma migration beyond the single `canvas_position` column.
- **Do NOT implement** multi-user real-time cursors (post-MVP).

---

## Build Order

Complete steps in this order. Each step is independently testable.

| Step | What | Done when |
|------|------|-----------|
| **12A** | `canvas_position` migration + CanvasModule + controller stub | `GET /projects/:id/canvas` returns 200 |
| **12B** | `getCanvas()` service method: enriches environments into nodes/edges | Response contains correct node shapes |
| **12C** | `autoSetup()` service method: calls existing connect + trigger | First deploy queued via one POST call |
| **12D** | Canvas layout + empty state + repo picker UI | User can select a repo and click Auto-Deploy |
| **12E** | Service node + database node components | Nodes render with correct status badges |
| **12F** | Config drawer (all 4 tabs) | Clicking a node opens drawer with correct data |
| **12G** | Staged changes store + staged changes bar | Adding a DB node shows amber border + bottom bar |
| **12H** | Command palette | Cmd+K opens palette; "Add PostgreSQL" creates staged node |
| **12I** | Variable linking autocomplete | `${{ Postgres.DATABASE_URL }}` chip renders in Variables tab |
| **12J** | WebSocket live node state updates | Node border animates during build/deploy cycle |
| **12K** | Canvas toolbar + Dev Mode link + project list navigation | Full end-to-end flow works |

---

## Acceptance Criteria

```bash
# Unit tests
pnpm --filter api test src/canvas/
pnpm typecheck

# Manual E2E:
# 1. Create a new project
# 2. Canvas shows empty state with repo picker
# 3. Select a GitHub repo → click Auto-Deploy
# 4. Canvas populates with a Service node in QUEUED state
# 5. Node animates through BUILDING → DEPLOYING → SUCCESS (green)
# 6. Click the node → Config Drawer opens
# 7. Deployments tab shows live streaming logs
# 8. Variables tab shows env vars with linked references
# 9. Metrics tab shows CPU/RAM charts after deploy succeeds
# 10. Right-click canvas → "Add PostgreSQL" → node appears in STAGED (amber)
# 11. Staged Changes bar shows "1 Staged Change"
# 12. Click Deploy → Postgres is provisioned, DATABASE_URL auto-linked
# 13. Click "Dev Mode" in toolbar → navigates to existing environment page
# 14. Node positions persist after page refresh (layout saved on drag)
```

---

## Notes for the AI Agent

- Reuse `@xyflow/react` — already installed from Phase 11.
- Reuse `<LogViewer />` from `components/deployments/log-viewer.tsx` for the build log stream inside the drawer.
- Reuse `useDeployments`, `useDeploymentLogs` hooks from `hooks/queries/use-deployments.ts`.
- Reuse all WebSocket event subscriptions — pattern is established in `app/(dashboard)/projects/[id]/environments/[envId]/deployments/[deployId]/page.tsx`.
- The `autoSetup` endpoint internally calls `RepositoriesService.connect()` — do not duplicate that logic.
- The `getCanvas` response shape must match what `project-canvas.tsx` passes to React Flow's `nodes` and `edges` props.
- Use `useSaveCanvasLayout` with a 500ms debounce inside `onNodesChange` — never on every keystroke.
- The staged changes system is **purely frontend state** (Zustand). The backend only sees the final resolved mutations when "Deploy" is clicked.
- Variable linking (`${{ Postgres.DATABASE_URL }}`) is resolved client-side by mapping node IDs to their `pulumiStack.outputs` before calling the deploy endpoint.
- Tailwind CSS only — no new CSS files. Use existing CSS variables (`--background`, `--card`, `--border`, etc.).
- All new components must be `'use client'` where they use state or effects.
- Respect the existing `JwtAuthGuard` on all new API endpoints.
