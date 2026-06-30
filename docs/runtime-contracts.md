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
trailing responsive column. Provider Status and Provider Health omit Google and Antigravity
entirely (no provider cards, quota buckets, lanes, or health rows for those
providers in the STATUS Health and Quota tabs). Token Trend, Ledger, and raw
provider attribution continue to preserve `google` and `antigravity` as distinct
source providers.

Secondary General dashboard reports must fail visibly instead of hanging the
page-load path. The `token-trend-summary`, `quota-history`, and
`quota-range-history` routes use endpoint-specific statement timeouts, and
`GET /api/shell/reports/quotas` uses the bounded report statement timeout; on
database timeout they return
`metadata.degraded=true`, a `database_timeout` reason, and a section-level
`Degraded` badge in the dashboard.

`GET /api/shell/reports/usage/token-trend-summary` treats provider latency
health as an opt-in lane. Unless the caller passes a truthy `include_health`
query parameter (`1`, `true`, or `yes`), the service does not run the `health`
subquery and the response omits populated `tokenTrendHealth` data:

- `tokenTrendHealth` is returned as an empty array.
- `metadata.includeTokenTrendHealth` is `false`.
- `metadata.tokenTrendHealthOmitted` is `true`.

When `include_health=1` is present, the service runs the `health` lane,
returns `tokenTrendHealth` rows, and sets `metadata.includeTokenTrendHealth`
to `true` (without `tokenTrendHealthOmitted`). The General dashboard polls this
route on the heavy report cadence without `include_health`, then falls back to
`providerLatencyHealth` / summary-report health rows in the UI when
`tokenTrendHealthOmitted` is set.

`token-trend-summary` also enforces a bounded raw-lane policy for broad
date windows. For requests where `to - from` exceeds
`SHELL_REPORT_TOKEN_TREND_SUMMARY_RAW_LANE_MAX_DAYS` (default `7`), the
service intentionally skips the raw `session_history` lanes `hours`, `scores`,
`versions`, and `modelFirstSeen`. The `health` lane runs only when
`include_health` is truthy. When raw lanes are skipped, the payload is degraded
with `degradedReason: 'bounded_raw_lane_policy'` and metadata fields:

- `skippedSubqueries`
- `unavailableSubqueries`
- `tokenTrendSummaryRawLaneMaxDays`
- `tokenTrendSummaryRangeDays`

This is an intentional partial-data mode; the dashboard keeps the `TREND`
section visible and suppresses the section-level `Degraded` badge for this
reason.

If a SQL timeout still occurs under the same request, `degradedReason` remains
`database_timeout` and `timedOutSubqueries` names the unavailable timed-out
lane set.

### General Dashboard Report Polling

The federated General dashboard keeps heavyweight usage and quota report
queries on slower visible polling instead of background refresh. React Query
uses `refetchIntervalInBackground: false` on these routes so hidden tabs do not
keep refetching report SQL.

Current cadence in `src/features/dashboard/index.tsx` and
`src/features/dashboard/components/phosphor-dashboard.tsx`:

- Primary usage report (`fetchUsageReport`): `staleTime` and `refetchInterval`
  of `120_000` ms (`LIVE_DASHBOARD_HEAVY_REFETCH_INTERVAL_MS`).
- Token trend summary (`fetchUsageReportTokenTrendSummary`): same
  `120_000` ms visible polling; default requests omit `include_health`.
- Shared quota snapshot (`usageReportQuotasQueryOptions` for
  `GET /api/shell/reports/quotas`): `60_000` ms (`LIVE_DASHBOARD_QUOTAS_REFETCH_INTERVAL_MS`)
  so the General dashboard and sidebar quota strip share one cache entry.
- Quota history and quota-range-history: `staleTime` aligned to the heavy
  report window but `refetchInterval: false` (manual refresh / cache-bust only).
- Shell health (`fetchShellHealth`): lightweight `60_000` ms polling when enabled.

`quota-history` first attempts to return a partial degraded payload from base quota rows when enrichment times out, with
`metadata.timedOutSubqueries` naming the unavailable lane. `quota-range-history`
uses the same base-row fallback for the range-aware Quota tab, preserving static
quota bars with empty usage enrichment when the `session_history` join times
out.


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


## Provider Health — Provider Credit Lifecycle (D1-417 / D1-422)

`GET /api/shell/reports/usage` may include a sibling field
`providerCreditLifecycle` on `UsageReportResponse`. This is **not** merged into
`providerLatencyHealth`, `providerStatusUsage`, quota rows, or
`rate_limit_observations`.

Data source:

- Primary: `public.provider_credit_current` (current credit rows for OpenAI
  Codex rate-limit reset credits: `provider = openai` and
  `credit_family = codex_rate_limit_reset`).

The API labels the payload as current provider credit lifecycle from
`provider_credit_current`. Empty `entries` means **not observed**, not zero
credits. Do not infer availability from quota reset windows.

Projected / normalized fields per entry:

- `observed_at`, `environment`, `provider`, `credit_family`, `credit_type`
- `account_hash_short` (prefix only, not full `account_hash`)
- `available_count`, `expires_at`, `source`, `credit_identity`, `granted_at`
- `status` (`available`, `used`, `expired` preserved as distinct)
- `redeem_started_at`, `redeemed_at`
- sanitized `operator_annotation`, sanitized `source_url` (http/https only,
  query/hash/userinfo stripped), truncated `source`

Report-level `summaries` aggregate per environment/provider/credit_family:
`available_count` sums current available units without double-counting legacy
aggregate rows when per-credit detail rows exist for the same
environment/provider/account_hash/credit_family/source group.

Legacy aggregate filtering (SQL, before `LIMIT`):

- `buildProviderCreditLifecycleQuery` uses a `filtered_credit_rows` CTE so rows
  with empty `credit_identity` are omitted when detail rows exist for the same
  environment, provider, `account_hash`, credit_family, and source **before**
  the row limit is applied.
- Aggregate fallback rows remain when no detail rows exist for that group.
- `filterLegacyProviderCreditAggregateRows` remains for unit tests and direct-row
  normalization; production correctness does not rely on post-`LIMIT` filtering.

Redaction rules (server normalization and SQL projection):

- Do **not** expose `raw_provider_fields`, `evidence`, full `account_hash`,
  unfiltered `metadata`, `SELECT *`, or raw JSON blobs.
- `source_url` must be http/https with credentials, query, and hash removed.

UI placement: General dashboard **Health** tab (STATUS > Health), immediately
after Provider auth health and before provider health cards.

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

Every dashboard-shell-owned compose container runs
`scripts/container-error-intake.sh` as its PID 1 wrapper. The wrapper forwards
`SIGTERM`/`SIGINT` to the child process, keeps stdout/stderr on the Docker log
stream, classifies actionable failures, and appends JSONL rows to
`$SHELL_CONTAINER_ERROR_INTAKE_DIR/<safe-container-name>-error.jsonl` (compose
mounts repo `./.analysis` at `/dashboard-shell-analysis` and sets
`SHELL_CONTAINER_NAME` per service).

`dashboard-shell-reports` and `dashboard-shell-reports-dev` still tail Docker JSON
logs from a read-only host mount (`SHELL_REPORT_DOCKER_LOG_ROOT`, default
`/host/docker/containers`) and expose bounded `dockerLogErrors` on usage reports
for dashboard alerts. That path is aggregation and alerting only; it is not the
sole durable writer for repo-owned containers.

Durable intake layout:

- Path pattern: `.analysis/<safe-container-name>-error.jsonl`
- Repo-owned writer: per-container `container-error-intake.sh`
  (`source_identity`: `container-self-log`, `source_path`: `null`)
- External fallback writer: `server/report-service.mjs` via
  `server/docker-log-error-intake.mjs` for configured external containers only
  (default `SHELL_REPORT_DOCKER_LOG_EXTERNAL_CONTAINERS=aawm-litellm,litellm-dev`)
- Intake directory: `SHELL_CONTAINER_ERROR_INTAKE_DIR` and
  `SHELL_REPORT_ERROR_INTAKE_DIR` (compose default `/dashboard-shell-analysis`,
  bind-mounted to repo-local `./.analysis`)

Each JSONL record includes normalized fields such as `observed_at`, `container`,
`stream`, `level`, `status_code`, `provider`, compact `message`,
`source_identity`, `source_path` (host log path when report-service tails external
containers), `fingerprint`, and `ingested_at`. Real failures (errors, exceptions,
tracebacks, 5xx, connection refused, timeouts) are classified at `error` or
`critical`, not downgraded to `warning`.

Informational or debug lines that only mention the word `error` in a
non-failure context (for example report-service `INFO: appended N docker log error
row(s)` intake summaries) are not classified as actionable and are not appended
to `*-error.jsonl`.

Successful HTTP access-log lines are also ignored when the request completed
with a 2xx/3xx status, even if the URL path contains `error` (for example static
error-boundary chunk names). Matching 4xx/5xx access logs remain actionable and
retain their `status_code`.

Container scope for Docker JSON log tailing defaults to repo-owned compose
services plus configured external containers. Legacy LiteLLM tails remain available
through `SHELL_REPORT_DOCKER_LOG_EXTERNAL_CONTAINERS` (default
`aawm-litellm,litellm-dev`). Setting `SHELL_REPORT_DOCKER_LOG_CONTAINERS`
replaces the default scope entirely for operator overrides.

Report-service JSONL append skips repo-owned container names (see
`filterDockerLogErrorsForCentralizedIntake` in `server/docker-log-error-intake.mjs`)
so per-container writers and centralized external intake do not double-append the
same repo-owned rows.

Per `AGENTS.md`, new intake rows should be evaluated alongside handoffs and may
open or update TODO items before unrelated feature work continues.
