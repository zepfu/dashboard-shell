# Dashboard Shell

Host application for project dashboard modules. This repo currently starts from
the shadcn-admin shell and is being adapted into a Module Federation host.

## Local Module Integration

The current remote dashboards are sibling repos:

- `../aawm-dashboard`, exposed as `aawm-dashboard/module` at `/aawm`.
- `../aawm-tap-dashboard`, exposed as `aawm-tap-dashboard/module` at
  `/aawm-tap`.
- `../aawm-observe-dashboard`, exposed as `aawm-observe-dashboard/module` at
  `/aawm-observe`.
- `../aegis-dashboard`, exposed as `aegis-dashboard/module` at `/aegis`.
- `../sluice-dashboard`, exposed as `sluice/module` at `/sluice`.

Run the live dev container stack:

```bash
pnpm docker:dev
```

Then open the shell-mounted routes:

- `http://localhost:3006/aawm`
- `http://localhost:3006/aawm-tap/overview`
- `http://localhost:3006/aawm-observe/overview`
- `http://localhost:3006/aegis`
- `http://localhost:3006/sluice/overview`

In `docker-compose.dev.yml`, all dev stack publish entries default to
`127.0.0.1` loopback via `DASHBOARD_DEV_BIND_HOST`. If you need intentional LAN
access, set `DASHBOARD_DEV_BIND_HOST=0.0.0.0` for the shell and remote dev
services before running `pnpm docker:dev`.

This stack runs Vite servers in containers with bind-mounted source from this
repo and the sibling dashboard repos, so changes in any checkout are served live
without a Docker image rebuild. The shell dev server proxies `/api/aawm-tap/*`,
`/api/aawm/*`, `/api/aawm-observe/*`, `/api/aegis/*`, and `/api/sluice/*` to
the shell report service, which then forwards to `AAWM_TAP_API_TARGET`,
`AAWM_API_TARGET`, `AAWM_OBSERVE_API_TARGET`, `AEGIS_API_TARGET`, or
`SLUICE_API_TARGET`. The AAWM dashboard's legacy hook-log route is also
proxied through `/hook-api/*` to `AAWM_HOOK_API_TARGET`.

The same dev stack starts the shell report API on `SHELL_REPORT_PORT`, which
defaults to `3010`. The browser reads the General dashboard report through
`/api/shell/reports/usage`; `DATABASE_URL` is only read by that server-side
service. Usage report grouping and filters support first-class
`session_history.inbound_model_alias`, `agent_name`, and `agent_id` identity
fields when the source database exposes them; quota rows keep percentage fields
stable while exposing normalized billing details under per-lane
`billing_details` for operator drilldowns.

The default General dashboard cold-load path keeps `/api/shell/reports/usage`
bounded enough to complete through PgBouncer on the local `session_history`
dataset. Heavy row-level latency percentiles and detailed score aggregates are
left for focused drilldowns, while the top agent-score reasons are sampled from
recent rows so the Ledger hover remains useful. `/api/shell/reports/usage/tool-activity`
also reads a recent bounded tool-activity window by default, but the browser
waits for the main usage report before starting the secondary Token Trend,
Provider Status quota-history, and tool-activity report requests so cold loads
do not fan out every large payload at once. The tool-activity,
token-trend-summary, and quota-history routes use their own bounded statement
timeouts and, if Postgres still cancels a cold query under load, return degraded
empty payloads with `metadata.degraded=true` instead of surfacing a raw 500.
Operators can tune those bounds with
`SHELL_REPORT_AGENT_SCORE_REASON_RECENT_ROW_LIMIT` and
`SHELL_REPORT_TOOL_ACTIVITY_RECENT_ROW_LIMIT`, and can tune the route timeout
with `SHELL_REPORT_TOOL_ACTIVITY_STATEMENT_TIMEOUT_MS`,
`SHELL_REPORT_TOKEN_TREND_SUMMARY_STATEMENT_TIMEOUT_MS`,
`SHELL_REPORT_TOKEN_TREND_SUMMARY_RAW_LANE_MAX_DAYS` (default `7`), and
`SHELL_REPORT_QUOTA_HISTORY_STATEMENT_TIMEOUT_MS`. Provider Status p95 latency
is displayed only when the report has a passive latency sample for the selected
provider; an empty value means unmeasured in the current health window, not
zero-millisecond latency.

When `token-trend-summary` ranges exceed the configured raw-lane window, the
service skips `hours`, `scores`, `versions`, and `modelFirstSeen` raw
`session_history` lanes and keeps returning `health` as a partial payload so the
`TREND` section remains visible. Degraded metadata includes
`skippedSubqueries`, `unavailableSubqueries`,
`tokenTrendSummaryRawLaneMaxDays`, and `tokenTrendSummaryRangeDays`.
This bounded raw-lane mode is intended behavior and does not render a section
`Degraded` badge for `TREND`.

Session-level debugging lives behind the General dashboard `STATUS` section's
`Diagnostics` tab and is served by
`/api/shell/reports/usage/session-diagnostics`. That endpoint returns bounded
recent `session_history` rows with exact-key metadata for route identity, alias
routing audit events, output-contract evidence, tool-definition snapshots, xAI
Responses request-shape sanitization, and Claude transcript attribution repair
state. It intentionally stays separate from the high-level usage report so
debug-only rows can remain visible without changing Provider Status, Ledger, or
Token Trend attribution.

The dev shell, dev remote, and dev report service all join the external
`aawm-tap_default` network used by the aawm-tap model containers. The dev report
service also joins `aawm_default` so host-style database URLs can be rewritten to
the internal `aawm-pgbouncer:6432` runtime pooler while development stays
containerized. If TAP
requires a dashboard key, set `AAWM_TAP_API_KEY` in this repo's `.env`; the shell
service injects it as `X-API-Key` and strips client-sent auth before forwarding.
Do not keep a real TAP key in `../aawm-tap-dashboard/.env` as a `VITE_*` value,
because Vite exposes those values to browser code.

### Container runtime boundary (D1-446)

Both shell and report-service images currently run as `root` in this repo’s local compose workflows:

- The nginx shell image is intentionally root today because it serves on port 80 and follows stock `nginx:1.27-alpine` runtime behavior (entrypoint and stock path layout).
- The report-service image is intentionally root because local operator mode reads a read-only host Docker JSON log mount and writes repo-local `.analysis` intake through the bind-mounted `/dashboard-shell-analysis`.

This is a deliberate trusted-host/local-operator choice, not a hardened untrusted-host profile. If you need non-root hardening, plan the migration as a separate follow-up that includes explicit port binding, writable temp/cache/pid ownership, and log/intake path ownership controls.

Container-build dependency-tree hygiene for this operator model is handled by `.dockerignore` rather than Dockerfile behavior, so changes here are documentation and operator-boundary alignment only.

Stop the live dev stack with:

```bash
pnpm docker:dev:down
```

You can also run the original TAP-only live setup directly on the host with
separate terminals:

```bash
cd ../aawm-tap-dashboard
npm run dev:standalone -- --host 0.0.0.0 --port 5173 --strictPort --cors

cd ../dashboard-shell
pnpm dev:reports

cd ../dashboard-shell
pnpm dev:with-tap
```

`pnpm dev:with-tap` is the canonical remote TAP dev entrypoint. `pnpm dev:with-aawm` is retained as a compatibility alias.

Run the container stack:

```bash
pnpm docker:up
```

Then open `http://localhost:3005/aawm`, `http://localhost:3005/aawm-tap/overview`,
`http://localhost:3005/aawm-observe/overview`, `http://localhost:3005/aegis`,
or `http://localhost:3005/sluice/overview`. Set
`DASHBOARD_SHELL_PORT=3000` if you want to publish the container on port 3000.
The compose services run detached and use `restart: unless-stopped`, so Docker
will bring the shell and remotes back after a system restart unless they were
intentionally stopped.

The static compose stack also starts `dashboard-shell-reports`, and nginx proxies
`/api/shell/*`, `/api/aawm-tap/*`, `/api/aawm/*`, `/api/aawm-observe/*`,
`/api/aegis/*`, `/api/sluice/*`, and `/hook-api/*` to that service. Set
`DATABASE_URL` in `.env` or the process environment before starting compose if
the General dashboard should query live report data. Set remote backend secrets
here, not in browser bundles. The static shell, remotes, and report service all
join `aawm-tap_default`; the report service also joins `aawm_default` so a
host-published database URL such as `127.0.0.1:6432` can be rewritten to the
internal `aawm-pgbouncer:6432` endpoint. Runtime report queries should use
PgBouncer; direct Postgres access is reserved for admin and migration work. The
local static compose report
service bind-mounts `./server` into the container, so
`server/report-service.mjs` edits need a report-service restart, not an image
rebuild. Dependency changes under `server/package.json` still require rebuilding
the report image.

The shell defaults to loading remotes through `/modules/<base>/remoteEntry.js`,
which `nginx.conf.template` (the single nginx source; the image COPYs it into
`/etc/nginx/templates/default.conf.template`) proxies to the sibling static
containers. For local Vite development, the dev compose file sets
browser-accessible localhost remote entries such as
`AAWM_DASHBOARD_REMOTE_ENTRY`, `AAWM_TAP_REMOTE_ENTRY`,
`AAWM_OBSERVE_REMOTE_ENTRY`, `AEGIS_REMOTE_ENTRY`, and `SLUICE_REMOTE_ENTRY`.
`AEGIS_DB_PASSWORD` in `.env.example` remains the local-dev default only; treat it as non-production and
override it for non-local operators before starting either compose stack.

## Remote Dashboard Contract

Dashboard remotes should follow the shell contract in
[`docs/remote-dashboard-integration-contract.md`](docs/remote-dashboard-integration-contract.md).
Runtime boundaries for the shared QueryClient, lazy remote routes, source maps,
and static-host CSP are documented in
[`docs/runtime-contracts.md`](docs/runtime-contracts.md).
The shell-side process for adding a sibling repo, including live dev containers
and static/prod-style containers, is documented in
[`docs/sibling-dashboard-setup.md`](docs/sibling-dashboard-setup.md).
The current component sharing model is vendor-and-sync: a remote vendors the
shell's shadcn primitives, `theme.css`, and `cn()` helper locally, then uses
shell runtime CSS variables through token-backed Tailwind classes. The shell
consumes a remote manifest's `accentColor` in module chrome.

To scaffold a new remote dashboard with that baseline:

```bash
pnpm scaffold:dashboard ../example-dashboard --module-id example-dashboard --name "Example" --base-path /example
```

`pnpm scaffold:dashboard` is the canonical command. `pnpm scaffold:tap` remains as a compatibility alias.

# Shadcn Admin Dashboard

Admin Dashboard UI crafted with Shadcn and Vite. Built with responsiveness and accessibility in mind.

![alt text](public/images/shadcn-admin.png)

[![Sponsored by Clerk](https://img.shields.io/badge/Sponsored%20by-Clerk-5b6ee1?logo=clerk)](https://go.clerk.com/GttUAaK)

I've been creating dashboard UIs at work and for my personal projects. I always wanted to make a reusable collection of dashboard UI for future projects; and here it is now. While I've created a few custom components, some of the code is directly adapted from ShadcnUI examples.

> This is not a starter project (template) though. I'll probably make one in the future.

## Features

- Light/dark mode
- Responsive
- Accessible
- With built-in Sidebar component
- Global search command
- 10+ pages
- Extra custom components
- RTL support

<details>
<summary>Customized Components (click to expand)</summary>

This project uses Shadcn UI components, but some have been slightly modified for better RTL (Right-to-Left) support and other improvements. These customized components differ from the original Shadcn UI versions.

If you want to update components using the Shadcn CLI (e.g., `npx shadcn@latest add <component>`), it's generally safe for non-customized components. For the listed customized ones, you may need to manually merge changes to preserve the project's modifications and avoid overwriting RTL support or other updates.

> If you don't require RTL support, you can safely update the 'RTL Updated Components' via the Shadcn CLI, as these changes are primarily for RTL compatibility. The 'Modified Components' may have other customizations to consider.

### Modified Components

- scroll-area
- sonner
- separator

### RTL Updated Components

- alert-dialog
- calendar
- command
- dialog
- dropdown-menu
- select
- table
- sheet
- sidebar
- switch

**Notes:**

- **Modified Components**: These have general updates, potentially including RTL adjustments.
- **RTL Updated Components**: These have specific changes for RTL language support (e.g., layout, positioning).
- For implementation details, check the source files in `src/components/ui/`.
- All other Shadcn UI components in the project are standard and can be safely updated via the CLI.

</details>

## Tech Stack

**UI:** [ShadcnUI](https://ui.shadcn.com) (TailwindCSS + RadixUI)

**Build Tool:** [Vite](https://vitejs.dev/)

**Routing:** [TanStack Router](https://tanstack.com/router/latest)

**Type Checking:** [TypeScript](https://www.typescriptlang.org/)

**Linting/Formatting:** [ESLint](https://eslint.org/) & [Prettier](https://prettier.io/)

**Icons:** [Lucide Icons](https://lucide.dev/icons/), [Tabler Icons](https://tabler.io/icons) (Brand icons only)

**Auth (partial):** [Clerk](https://go.clerk.com/GttUAaK)

## Run Locally

Clone the project

```bash
  git clone https://github.com/satnaing/shadcn-admin.git
```

Go to the project directory

```bash
  cd shadcn-admin
```

Install dependencies

```bash
  pnpm install
```

Start the server

```bash
  pnpm run dev
```

## Sponsoring this project ❤️

If you find this project helpful or use this in your own work, consider [sponsoring me](https://github.com/sponsors/satnaing) to support development and maintenance. You can [buy me a coffee](https://buymeacoffee.com/satnaing) as well. Don’t worry, every penny helps. Thank you! 🙏

For questions or sponsorship inquiries, feel free to reach out at [satnaingdev@gmail.com](mailto:satnaingdev@gmail.com).

### Current Sponsor

- [Clerk](https://go.clerk.com/GttUAaK) - authentication and user management for the modern web

## Author

Crafted with 🤍 by [@satnaing](https://github.com/satnaing)

## License

Licensed under the [MIT License](https://choosealicense.com/licenses/mit/)
