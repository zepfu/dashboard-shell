# Runtime Contracts

This document supplements the integration contract for federated dashboards.

## QueryClient

The shell owns the federated-mode `QueryClientProvider`. Remote dashboards should
not wrap shell-mounted routes in their own `QueryClientProvider`; doing so splits
React Query cache identity across the Module Federation boundary. Standalone
remote entrypoints may create their own provider for local development.

Current shell defaults in `src/main.tsx`:

- `staleTime`: `10_000` ms for normal queries.
- `refetchOnWindowFocus`: enabled in production and disabled in development.
- `retry`: disabled in development. In production, retry non-auth Axios errors
  until the shell retry predicate returns false at `failureCount > 3`; never
  retry Axios `401` or `403`.
- `gcTime` / cache time: use TanStack Query defaults unless a route or component
  query overrides them.

Operator-critical workflows that need fresh state on every interaction should
set query-local options such as `staleTime: 0`, targeted polling, or explicit
manual invalidation/refetch. They should not create a second provider in
federated mode.

## Suspense And Lazy Routes

Remote `module.ts` route components should be lazy components. The shell wraps
both the remote module load and the selected remote route component in
`Suspense`, with an error boundary around the module load.

Shell smoke coverage for a remote must prove the shell-mounted route loads
through `remoteEntry.js`, not only that the standalone remote works. When a
remote adds a route in `module.ts`, update the shell smoke path list or test
coverage so the federated chunk is exercised.

## Source Maps

Development builds may use normal Vite source maps as needed.

Production policy is no browser-public source maps by default for the shell or
remote dashboards. If a release needs production stack trace symbolication, use
an upload-only or hidden-source-map workflow and verify the generated `.map`
files are not served from the public static containers.

## Provider Status Health Strips

Provider Status cards render vertical health strips as overlay affordances. The
strip shell must stay absolutely positioned inside the card and must not
participate in normal card layout flow, even when the strip has an auto-generated
tooltip. The shell uses `pointer-events: none` with an inner hover zone restoring
pointer events so the tooltip remains reachable without adding blank space above
the provider header.

The Provider Status Health card list uses masonry-style column stacks instead
of the shared Provider Status quota grid. Recent quota-history bars or Local
health chips may make one provider card taller than its neighbors, but sparse
provider cards should keep compact heights and later cards should pack upward
inside their column instead of reserving a row sized to the tallest provider
card. The aggregate totals card is the trailing Health card and belongs in the
trailing responsive column. Provider Status intentionally does not render a
standalone Antigravity card; Antigravity health, usage, WTU quota, and quota
history detail are displayed under Google while Token Trend, Ledger, and raw
provider attribution keep Antigravity as its own source provider.

Secondary General dashboard reports must fail visibly instead of hanging the
page-load path. The `token-trend-summary` and `quota-history` report routes use
endpoint-specific statement timeouts; on database timeout they return empty
payloads with `metadata.degraded=true`, a `database_timeout` reason, and a
section-level `Degraded` badge in the dashboard.


## Provider Health — Provider Auth Expiry (D1-338)

`GET /api/shell/reports/usage` may include a sibling field
`providerAuthHealth` on `UsageReportResponse`. This is **not** merged into
`providerLatencyHealth` rows.

Data source:

- Primary: `public.provider_auth_current` (latest row per environment,
  provider, auth_family, credential_scope, auth_file_hash).

The API labels the payload as current credential refresh state from
`provider_auth_current`. Empty `entries` means **not observed**, not healthy.

Projected / normalized fields per entry:

- `observed_at`, `environment`, `provider`, `auth_family`, `credential_scope`
- `auth_file_hash_short` (prefix only, not full hash)
- `status`, `attempted`, `refreshed`, `skipped`
- `expires_at`, `last_success_at`, `remaining_seconds`
- `auth_health_state` (`refreshed`, `skipped_valid`, `skipped_expired`,
  `failed`, `attempted`, `expired`, `unknown`)
- `source_task`, `error_class`, sanitized `error_message`
- `auth_file_source` from safe `metadata.auth_file_source` when present

Redaction rules (server normalization and SQL projection):

- Do **not** expose tokens, refresh tokens, raw auth JSON, raw auth-file paths,
  full `auth_file_hash`, or unfiltered `metadata` blobs.
- `skipped` must not classify as healthy when `expires_at` is missing or in the
  past (`skipped_expired`).
- Error messages are sanitized for token-like strings and filesystem paths.

UI placement: General dashboard **Health** tab, after PgBouncer and AAWM alias
routing panels and before provider health cards.

## CSP And Asset Loading

Static/prod-style shell hosting serves remotes from same-origin
`/modules/<base>/remoteEntry.js` paths and APIs from same-origin
`/api/<dashboard>/*` paths. The static shell CSP must therefore allow same-origin
scripts and same-origin XHR/fetch. Remotes should avoid direct upstream service
URLs in browser code so the shell proxy remains the only network boundary.

## Provider Health — AAWM Alias Routing (D1-323)

`GET /api/shell/reports/usage` may include a sibling field
`providerAliasRouting` on `UsageReportResponse`. This is **not** merged into
`providerLatencyHealth` rows.

Data source:

- Primary: recent `public.session_history.metadata` for `codex` and `anthropic`
  auto-agent alias traffic (24-hour lookback, bounded row limit).
- Supplemental: optional join to `public.aawm_alias_routing_audit` by
  `litellm_call_id` for compact cooldown/audit events only.

The API labels the payload as **recent observed session history**, not live
Redis/DualCache state. Dashboard copy must preserve that distinction.

Projected / normalized fields per entry:

- `family` (`codex` | `anthropic`)
- `alias_label`, `provider`, `model`, `route_family`
- `state_kind` (`affinity` | `cooldown`)
- `state_source` (`memory` | `durable_cache` | `local_fallback` |
  `unknown`)
- `observed_at`, `expires_at`, `cooldown_until`, `remaining_seconds` when
  derivable
- `selected` and `skipped_candidates` summaries (provider/model/route_family/
  reason only)

Redaction rules (server normalization and SQL projection):

- Do **not** expose raw prompts, tool arguments, credentials, auth files, full
  metadata blobs, `details` objects from audit tables, or unredacted Redis
  values.
- Skipped-candidate arrays are whitelisted to routing summary keys only; blocked
  keys include `api_key`, `authorization`, `access_token`, `refresh_token`,
  `auth_file`, `prompt`, `raw_prompt`, `tool_arguments`, `metadata`, and
  `sanitized_snapshot`.

Diagnostics tab behavior is unchanged: session diagnostics continues to expose
full `alias_route_events` for operator drill-down; Provider Health uses only the
sanitized `providerAliasRouting` sibling field.

## Session Diagnostics (Grok Side-Channel)

`/api/shell/reports/usage/session-diagnostics` exposes redacted Grok native
session side-channel **request-shape metadata only**. It does not return raw
request bodies, raw JSON payloads, authorization headers, OIDC credentials,
prompt text, tool arguments, terminal output, storage artifacts, or concrete
session IDs parsed from endpoint paths.

Projected metadata keys (when present on `session_history.metadata`):

- `grok_side_channel` (boolean flag on the row projection as `enabled`)
- `grok_side_channel_endpoint_type`
- `grok_side_channel_endpoint_path_template` (API/UI: `endpoint_template`)
- `grok_side_channel_request_content_type`
- `grok_side_channel_request_body_byte_length`
- `grok_side_channel_request_body_sha256` (correlation/digest only)
- `grok_side_channel_request_body_digest_source`
- `grok_side_channel_request_json_container_type`
- `grok_side_channel_request_top_level_key_types`
- `grok_side_channel_request_array_length`

Optional query filters:

- `grok_side_channel=true` — narrow to rows with side-channel shape metadata
- `grok_side_channel_endpoint_type` — comma-separated endpoint type filter

Side-channel diagnostic rows are included in session diagnostics when shape
metadata is present; they remain excluded from billable usage aggregation via
existing `no_usage` / reportable-session rules on usage totals.

## Container Error Intake (`.analysis/*-error.jsonl`)

`dashboard-shell-reports` and `dashboard-shell-reports-dev` tail Docker JSON
logs from a read-only host mount (`SHELL_REPORT_DOCKER_LOG_ROOT`, default
`/host/docker/containers`) and continue to expose compact `dockerLogErrors` rows
on usage reports for dashboard alerts.

In addition, actionable container log failures are appended durably under the
repo-local `.analysis/` directory:

- Path pattern: `.analysis/<safe-container-name>-error.jsonl`
- Writer: `server/report-service.mjs` via `server/docker-log-error-intake.mjs`
- Intake directory: `SHELL_REPORT_ERROR_INTAKE_DIR` (default
  `<process.cwd()>/.analysis`; compose sets `/app/.analysis` for prod reports
  and `/workspace/dashboard-shell/.analysis` for dev reports)

Each JSONL record includes normalized fields such as `observed_at`, `container`,
`stream`, `level`, `status_code`, `provider`, compact `message`,
`source_identity`, `source_path` (host log path when safe), `fingerprint`, and
`ingested_at`. Real failures (errors, exceptions, tracebacks, 5xx, connection
refused, timeouts) are classified at `error` or `critical`, not downgraded to
`warning`.

Informational or debug lines that only mention the word `error` in a
non-failure context (for example report-service `INFO: appended N docker log error
row(s)` intake summaries) are not classified as actionable and are not appended
to `*-error.jsonl`.

Container scope defaults to repo-owned compose services (shell, report service,
redis, and sibling remote dashboard containers in prod/dev compose). Legacy
LiteLLM tails remain available through
`SHELL_REPORT_DOCKER_LOG_EXTERNAL_CONTAINERS` (default
`aawm-litellm,litellm-dev`). Setting `SHELL_REPORT_DOCKER_LOG_CONTAINERS`
replaces the default scope entirely for operator overrides.

The report service dedupes using `fingerprint` in two layers: an in-process
`seenFingerprints` set for repeated poll cycles within one report-service
process, and a persisted read of each `.analysis/<container>-error.jsonl` file
before append so restarts and parallel `dashboard-shell-reports` /
`dashboard-shell-reports-dev` instances do not re-append rows already on disk.
Per intake file, a bounded directory lock (`<file>.intake.lock`, stale after
~120s) reduces obvious concurrent duplicate races between report-service
processes. Unseen fingerprints are committed only after a successful JSONL
append; a failed append leaves the row eligible for retry on the next poll. All actionable rows found in the bounded
tail are sorted and considered for intake; `SHELL_REPORT_DOCKER_LOG_ERROR_ROWS`
caps only the `dockerLogErrors` dashboard payload, not durable intake. `.analysis` remains
local-only and must not be committed to git.

Per `AGENTS.md`, new intake rows should be evaluated alongside handoffs and may
open or update TODO items before unrelated feature work continues.
