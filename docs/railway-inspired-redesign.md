# Liftoff Railway-Inspired Redesign Notes

## Direction

Liftoff now uses a canvas-first product model inspired by Railway, translated into a rocket/launch-control theme. The goal is to make the canvas feel like the primary workspace rather than a secondary setup screen.

The redesign keeps Liftoff's DigitalOcean-only platform model intact. No AWS product language or AWS infrastructure assumptions were introduced.

## What Changed

- Replaced the broad dashboard sidebar with a compact icon rail and dark console styling.
- Reworked Projects into a launchpad surface with a large empty-state canvas, compact project tiles, and a `New` flow that feels closer to Railway's create menu.
- Reworked the project canvas chrome with a top command bar, project/environment breadcrumbs, status pill, activity toggle, agent affordance, and `Add` entry point.
- Kept React Flow as the canvas engine, but restyled the canvas, nodes, dotted background, and empty state to match the new spatial model.
- Added placeholder creation options for databases, templates, Docker images, functions, buckets, and empty projects. These are intentionally UI-first affordances for future endpoint work.
- Restyled metrics and logs empty states around Railway-like observability panels.
- Restyled project settings into a split settings layout with left navigation and a dark launch-control panel.

## Product Suggestions

- Make `/projects/:id/canvas` the canonical project destination. All project cards should continue linking directly to the canvas.
- Add backend endpoints for canvas add actions in this order: database, bucket, worker service, cron/function, Docker image.
- Introduce an environment selector backed by real project environments instead of the current static `production` label.
- Add a notifications/activity API so the right-side activity panel can display deployment events, environment changes, and failed provisioning steps.
- Add canvas-level undo/redo and persisted viewport state. The toolbar already leaves space for these controls.
- Consider a command-driven creation model where a prompt can scaffold a basic `liftoff.yml` plus suggested services before the user deploys.
- Keep rocket language light and operational: launch, mission control, launchpad, orbit, telemetry. Avoid turning core deployment states into novelty copy.

## Implementation Notes

- The visual system is defined mostly in `apps/web/app/globals.css` with reusable `liftoff-canvas`, `liftoff-panel`, and `liftoff-button` classes.
- The project canvas still uses existing hooks and React Flow data. Empty add endpoints are UI placeholders and do not call new APIs yet.
- The create-project flow still uses existing project, repository, environment, and auto-setup mutations.
- Observability pages currently present designed empty states because the metrics/logs endpoint behavior needs a separate product pass.

## Follow-Up Risks

- Auth-gated local browser verification needs seeded auth/API data for visual QA beyond typecheck/build.
- Some old dashboard/account settings surfaces still use older card patterns and should be brought into the same shell in a second pass.
- Mobile behavior should get a dedicated responsive pass once the desktop canvas direction is accepted.
