# Runtime Contracts

This document supplements the integration contract for federated dashboards.

## Report Service Upstream Proxy Secret

Credential-injecting upstream proxy routes (`/api/aawm*`, `/api/aawm-tap*`, `/api/aawm-observe*`, `/api/aegis*`, `/api/sluice*`, `/hook-api*`) are internal-only. The shell static nginx container and Vite dev proxy must send `X-Dashboard-Shell-Proxy-Secret` on every request forwarded to `dashboard-shell-reports`. The report service rejects missing or wrong values before it injects upstream API credentials.

`GET /api/shell/*` report and health routes are not gated by this header.

Local compose and dev defaults use `SHELL_REPORT_PROXY_SHARED_SECRET=dashboard-shell-local-proxy-secret`. Override the same variable on the shell container, report-service container, and Vite dev environment for any non-local deployment.

## Report Service Env Surface and Dev-Port Boundary (D1-446)

- The report-service env surface is intentionally mirrored between
  `docker-compose.yml` and `docker-compose.dev.yml` (same variable names and
  local defaults) for drift visibility, not YAML factoring.
- Redis dependency/runtime follow-up work is owned by server-package/report-service TODOs.
- Redis cache support is optional for the report-service process:
  - If `redis` package import/connectivity is healthy, cached report payloads use Redis where configured.
  - If Redis is reachable, `buildShellHealthPayload` reports `redisPackageAvailable: true`, `redisStatus: ready`, and `redisConfigured: true`, `redisReady: true`.
  - If Redis client configuration exists but startup connect fails, startup logs emit `WARN: Redis report cache unavailable; falling back to SQL/local cache`, and health payload reports `redisPackageAvailable: true`, `redisStatus: disconnected`, `redisConfigured: true`, `redisReady: false`.
  - If the `redis` package is unavailable at startup, report-service writes one startup/runtime warning: `Redis package is unavailable; report-service is falling back to local/SQL cache`, and health payload reports `redisPackageAvailable: false`, `redisStatus: missing-package`.
  - In all failure modes, report cache fallback remains local/SQL.
- Dev compose ports are intentionally loopback-bound by default (`127.0.0.1`), with an intentional override path (`DASHBOARD_DEV_BIND_HOST`) for LAN operator sessions.

## Nginx and Public Surface Contract

- `/index.html` is served with the production CSP string `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'`.
- Fonts avoid external origins: `index.html` keeps only same-origin/system fallback fonts; all Google Fonts links were removed to avoid external font dependencies while preserving local typography fallback.
- The bootstrap watchdog must live in `public/bootstrap-watchdog.js` and be loaded from `/bootstrap-watchdog.js` so CSP blocks no inline script execution in production.
- API/hook prefixes use `^~` route matches (`/api/aawm-tap/`, `/api/aawm-observe/`, `/api/aawm/`, `/api/aegis/`, `/api/sluice/`, `/api/shell/`, `/hook-api/`) so regex static handlers do not shadow proxy routes.
- `/`-scoped static assets are served with gzip compression enabled for JS/CSS/SVG/font/media text types; caching behavior for immutable fingerprinted assets remains unchanged.

## Container Runtime User and Operator Blast Radius (D1-446)

- The shell nginx image (`Dockerfile`) intentionally runs as `root` in the current operator shape:
  - It serves on port 80 and uses nginx stock runtime behavior/paths from `nginx:1.27-alpine` (entrypoint, cache/temp directories, pid path).
  - A non-root migration requires explicit follow-up work for port binding strategy and writable temp/cache/pid ownership plus entrypoint/runtime compatibility.
- The report-service image (`Dockerfile.report-service`) intentionally runs as `root` in this repo’s local compose stacks:
  - It reads read-only host Docker JSON logs (default `SHELL_REPORT_DOCKER_LOG_ROOT=/host/docker/containers`) and writes report-service/report-shell operator intake under the bind-mounted `/dashboard-shell-analysis`.
  - This is a trusted local operator posture and is **not** hardened for untrusted or multi-tenant hosts.
- Blast-radius scope is explicit:
  - `.analysis` durability writes happen through repo bind mounts configured in compose.
  - Docker log error intake follows the mounted host log directory selected by `SHELL_REPORT_DOCKER_LOG_ROOT`.
- The host dependency-tree issue is handled by `.dockerignore` (for example `node_modules`, `dist`, `.analysis`, `.env*`, `.git`, and compose files) so it is not a Dockerfile runtime behavior gap.

## Usage Report Score-Reason Auxiliary Split (D1-493)

The core `usage_rows` SQL query no longer includes `agent_score_reasons` JSON
expansion CTEs (`reason_bounds`, `reason_cap_state`, `reason_source`,
`reason_counts`, `reason_ranked`, `reason_summary`) and does not select the
`sh.agent_score_reasons` column in its `filtered` CTE at all. Score-reason
enrichment runs as a separate auxiliary SQL task (`usage_score_reasons`), which
selects `sh.agent_score_reasons` through `scoreReasonsFilteredColumnSelects`
(extending the shared `usageFilteredColumnSelects` with only that one JSONB
column). The auxiliary query carries:

- The same date range, filter, grain, and group-by identity as the core query.
- The same `AGENT_SCORE_REASON_RECENT_ROW_LIMIT` recent-ID cap.
- Its own independent statement timeout budget (same 120000ms default).

Merge happens in application code on the full `bucket` + group-by dimension key
(`buildUsageScoreReasonsMergeKey`). Rows without a matching reason row receive
`agent_score_reasons_top: '[]'`. When the reason summary has no groups, the
auxiliary SQL returns one explicitly marked cap-state-only row. The loader does
not add that row to the merge map or output rows; it uses the row only to
preserve bounded min/max IDs and cap-truncation metadata on the report and its
existing core rows.

`usage_score_reasons` is an optional fanout section
(`USAGE_REPORT_OPTIONAL_FANOUT_SECTION_KEYS`). On timeout or failure:

- Core usage rows still return unchanged.
- Report metadata includes `degraded: true`,
  `degradedReason: 'auxiliary_fanout_failure'`,
  `unavailableAuxiliarySections` containing `'usage_score_reasons'`, and
  `agentScoreReasonsDegraded: true`.
- `agentScoreReasonsRecentIdCapTruncatesRequestedWindow` reports `false`.
- All rows receive `agent_score_reasons_top: '[]'`.

Core `usage_rows` failure still fails fast (rejects the entire report). The
split does not add DB indexes, broaden query windows, raise fanout concurrency,
or weaken timeouts.

## Report cache identity

`server/report-cache-identity.mjs` is the canonical owner of report Redis cache
semantics: default TTL, usage-report TTL, stale TTL, key prefix, cache entry
version, `cache_bust` exclusion from canonical params/hash, usage-scope TTL
classification, cache key/lock construction, and the Redis prewarm lock key.
`server/report-service.mjs` imports these values and helpers; it must not
duplicate prefix/version defaults.

Default key shape: `dashboard-shell:reports:v14:<scope>:<hash>`. Prewarm lock:
`dashboard-shell:reports:v14:prewarm:lock`.

## QueryClient

The shell owns the federated-mode `QueryClientProvider`. Remote dashboards should
not wrap shell-mounted routes in their own `QueryClientProvider`; doing so splits
React Query cache identity across the Module Federation boundary. Standalone
remote entrypoints may create their own provider for local development.

Current shell defaults in `src/main.tsx`:

- `staleTime`: `10_000` ms for normal queries.
- `refetchOnWindowFocus`: enabled in production and disabled in development.
- `retry`: delegated to `shouldRetryQuery(failureCount, error)` in
  `src/main.tsx` (wired on the shell `QueryClient` at line ~80). Disabled in
  development (`import.meta.env.DEV` via `isShellQueryRetryDevMode`). In
  production: no further retries once `failureCount > 3` (at most four failed
  attempts before giving up). The predicate reads HTTP status from `error.status`
  when present (`readHttpStatus`, lines ~45–51): do **not** retry `401`, `403`,
  or `404`; retry `408`, `429`, and `5xx`; retry when status is missing; do not
  retry other status codes. Broader shell routing / fetch-layer retry
  consolidation is tracked in **`D1-453-mf-shell-routing-src-main-tsx`**.
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
trailing responsive column.
xAI Grok **Build** billing quotas use explicit `quota_key` lanes and must not be
aggregated across period or unit:

- `xai_grok_build_weekly_credits:credits` → weekly **credits** remaining (from
  stored `remaining_pct` on `rate_limit_intervals`, sourced from LiteLLM
  `100 - creditUsagePercent` when usage percent is present).
- `xai_grok_build_monthly_requests:requests` → monthly **requests** remaining.

Alibaba Token Plan is a separate percentage-only quota family. The Status Quota
UI was intentionally removed in commit `6319ccd` and remains deprecated; this
does not restore a visible Quota tab or quota-history UI. D1-489 provides the
live Provider Status quota-only card and sidebar lanes, backed by
`GET /api/shell/reports/quotas`. The `quota-history` and `quota-range-history`
payloads and their display helpers still preserve both windows as distinct
lanes:

- `alibaba_token_plan_5h:credits` → **5h** **Credits** window.
- `alibaba_token_plan_7d:credits` → **7d** **Credits** window.

The provider is `alibaba_token_plan`, and the authoritative usage source is
`alibaba_token_plan_usage`. Each lane retains its `provider`, exact
`quota_key`, `quota_period`, `unit`, `source`, and freshness/observation
metadata across the `/api/shell/reports/quotas`, `quota-history`, and
`quota-range-history` payloads and display helpers. The live Provider Status
card and sidebar may show the reported percentage consumed or remaining and the
reported reset time. Percentages and reset state are source telemetry, not
derived absolute limits; freshness must remain visible so a stale or missing
snapshot is not presented as a current zero-use state.

Absolute quota values are unavailable when the source supplies null values.
The dashboard must preserve those nulls and must not calculate or infer a
credits total, daily quota, or monthly quota from the percentage, period, or
usage history. `account_hash` is grouping-only: it may keep independent
accounts' lanes separate, but full account-hash values must never be exposed
to the browser or rendered in tooltips.

Alibaba Token Plan must not be merged with Qwen request-token usage, Coding
Plan quotas, or any other Alibaba product or subscription. The 5h and 7d
Credit lanes remain separately identifiable in the Provider Status quota-only
card, quota payloads/display helpers, and sidebar even when one lane is absent,
stale, or unavailable.

Moonshot/Kimi Code is a separate absolute-value quota family (`quota_units`).
D1-492 provides first-class live Provider Status quota-only card and sidebar
lanes for `kimi_code`, backed by `GET /api/shell/reports/quotas`. The
`quota-history` and `quota-range-history` payloads and their display helpers
preserve both windows as distinct lanes:

- `kimi_code_5h:quota_units` → **5h** `quota_units` window.
- `kimi_code_7d:quota_units` → **7d** `quota_units` window.

The provider is `kimi_code`, the authoritative usage source is
`kimi_code_usage`, and the client identity is `kimi-code`. Backend Kimi Code
observation branches across current quota, velocity, history, history fallback,
range history, and range fallback filter exact `provider = kimi_code`,
`source = kimi_code_usage`, `client = kimi-code`, and the exact
`quota_key`/`quota_period` pairs (`kimi_code_5h:quota_units` + `5h`,
`kimi_code_7d:quota_units` + `7d`). Each lane retains its `provider`, exact
`quota_key`, `quota_period` (`5h` / `7d`), unit (`quota_units`, exact API
payload value, not a display label), `source`, `client`, absolute
`quota_limit` / `quota_used` / `quota_remaining` values from
`rate_limit_observations`, and freshness/observation metadata across the
`/api/shell/reports/quotas`, `quota-history`, and `quota-range-history`
payloads and display helpers.

Account identity is privacy-safe only: the report service projects a 12-character
lowercase hex `account_ref` via `left(md5(account_hash), 12)`. Frontend display
helpers may reconcile legacy 8-hex refs with current 12-hex refs, but full
`account_hash` values must never be exposed to the browser or rendered in
tooltips.

`kimi_code` is quota-only: exclude it from `session_history` usage enrichment
for quota history / range-history windows, Token Trend, and unrelated provider
identity merging. Do not alias or merge Moonshot API, other Moonshot products,
or unrelated Kimi/subscription accounts with this family. The 5h and 7d
`quota_units` lanes remain separately identifiable even when one lane is
absent, stale, or unavailable.

Anthropic Fable weekly overage-included (`7d_oi`) is a distinct quota family from
baseline unified weekly (`7d`) and retired Sonnet weekly (`weekly_special` →
internal `special`):

- `anthropic_unified_7d:7d` → `quota_type=weekly` (baseline All Models · 7d).
- `anthropic_unified_7d_oi:7d_oi` → `quota_type=weekly_overage_included`
  (Fable · 7d overage-included lane).
- `anthropic_unified_7d_sonnet:7d_sonnet` → `quota_type=weekly_special`, normalized
  to internal `special` for **Retired Sonnet · 7d** history only.

Provider Status, quota history, and sidebar quota visuals must not treat missing
`7d_oi` source rows as Sonnet or baseline weekly fallbacks.

Provider Status and Quota history render these as separate lanes. History rows
and current quota tooltips surface the best available per-lane `quota_key`,
`source`, and `client` from interval JSON first, then matching billing
observations; `rate_limit_intervals` may not always include `source` / `client`
columns, so missing values are shown as absent rather than defaulted. These
identity fields describe the rendered logical lane, not every raw observation in
the reset window.

Provider Status and Provider Health omit Google and Antigravity
entirely (no provider cards, quota buckets, lanes, or health rows for those
providers in the STATUS Health and Quota tabs). Token Trend, Ledger, and raw
provider attribution continue to preserve `google` and `antigravity` as distinct
source providers.

PgBouncer sidecar health is rendered in the independent **STATUS > PgBouncer**
tab, not inside the Health tab. When shell health reports a PgBouncer error,
degraded aggregate status, or a non-green sidecar, the PgBouncer tab shows a
flashing red circle indicator. An unknown shell-health response with no sidecars
is neutral and should not flash.

Secondary General dashboard reports must fail visibly instead of hanging the
page-load path. The `token-trend-summary`, `quota-history`, and
`quota-range-history` routes use endpoint-specific statement timeouts, and
`GET /api/shell/reports/quotas` uses the bounded report statement timeout; on
database timeout they return
`metadata.degraded=true`, a `database_timeout` reason, and a section-level
`Degraded` badge in the dashboard.

The report service applies PostgreSQL report-query settings with
transaction-local `set_config(...)` calls after `BEGIN`. This is intentional:
different report endpoints use different statement-timeout budgets, and
`max_parallel_workers_per_gather` must stay scoped to the report transaction
rather than the pooled connection. Do not move these settings into pool-wide
connection options unless all endpoint-specific timeout behavior is replaced by
an equivalent per-query mechanism.

Report query correlation is exposed on `GET /api/shell/health` under
`reportQueryPressure.inProcess`. That object carries process-level counters plus
bounded active and recent timeout/error records with endpoint, cache
scope/hash, refresh kind, date identity, usage task key, statement timeout, and
duration. Request IDs are hashed into a short `req:<digest>` reference and
bounded; raw request IDs and raw error secrets are not exposed.

Quota-history usage enrichment intentionally deduplicates logical usage windows,
groups them by provider/model envelope, then uses a parameterized `LATERAL`
`session_history` scan with a planner barrier (`OFFSET 0`) and the
`session_history_quota_provider_started_model_idx` expression. The usage-scan
canonical provider `CASE` must remain structurally compatible with that index.
Antigravity, Alibaba Token Plan, and Kimi Code (`kimi_code`) quota-only windows are excluded before the
scan. The 15s quota-history statement-timeout guardrail remains unchanged; if
enrichment times out, the existing degraded fallback behavior still applies.

Main usage can exceed short HTTP client deadlines even when every DB task stays
under its own 120s statement timeout, because those tasks run serially by
default (`SHELL_REPORT_SQL_FANOUT_CONCURRENCY` defaults to `1`). Distinguish
HTTP wall time from `reportQueryPressure` timeout/error counters: wall-clock
latency is not by itself a per-statement timeout.

`GET /api/shell/reports/usage` returns compact usage rows by default. The report
service omits row properties whose normalized value is `null`, `undefined`, or
an empty string, and marks the response with:

- `metadata.compactRows=true`
- `metadata.rowNullFieldsOmitted=true`
- `metadata.includeEmptyRowFields=false`

This keeps long-open dashboard tabs from repeatedly retaining thousands of
explicit empty fields. Callers that need the legacy full row object shape can
pass `include_empty_row_fields=1` (`true` and `yes` are also accepted). The full
shape sets `metadata.compactRows=false`,
`metadata.rowNullFieldsOmitted=false`, and
`metadata.includeEmptyRowFields=true`. Main usage-report cache entries use the
versioned `usage-v2` cache scope so compact rows and older cached full rows do
not share a cache identity.

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

### Materialized View Refresh Cron

Quota and provider-health materialized view refreshes are owned by `pg_cron`,
not by the HTTP report service. Apply
`scripts/configure-dashboard-refresh-cron.sql` to the PostgreSQL database used by
the shell report service `DATABASE_URL`: the target database must contain
`public.rate_limit_intervals`, `public.provider_latency_health_5m`, and the
`cron` schema from the `pg_cron` extension. For the local dashboard stack, that
means the same report database the `dashboard-shell-reports` service queries,
not the shell nginx container.

Operator application:

```bash
psql "$DATABASE_URL" -f scripts/configure-dashboard-refresh-cron.sql
```

The script enables `\set ON_ERROR_STOP on` internally so plain `psql -f`
application is fail-fast without relying on caller flags; the operator command
above remains valid.

The script creates or replaces
`public.dashboard_shell_maintain_materialized_view(view_name, operation)`, then
reconciles the four load-bearing cron jobs:

- `aawm_rate_limit_intervals_refresh`
- `aawm_rate_limit_intervals_analyze`
- `aawm_provider_latency_health_5m_refresh`
- `aawm_provider_latency_health_5m_analyze`

Keep those job names stable. On each apply, the script removes only the four
exact obsolete schedule names
(`dashboard_shell_rate_limit_intervals_refresh`,
`dashboard_shell_rate_limit_intervals_analyze`,
`dashboard_shell_provider_latency_health_5m_refresh`,
`dashboard_shell_provider_latency_health_5m_analyze`). It does not use a
`dashboard_shell_%` wildcard, so unrelated `dashboard_shell_*` jobs cannot be
removed. It then creates any missing stable `aawm_*` jobs and alters each
existing stable job to the intended schedule/command/active state. Existing job
24 `aawm_rate_limit_intervals_refresh` is preserved rather than replaced. After
creating any missing stable jobs (and before `cron.alter_job`), the script
enumerates the four expected stable names as a `VALUES` set, `LEFT JOIN`s
`cron.job`, and raises if any expected name has a count other than exactly one
(including missing zero-count jobs).
`GET /api/shell/health` looks up those exact names in `cron.job`, joins latest
status and messages from `cron.job_run_details`, and uses the result to report
materialized-view freshness, active refresh work, last success, and last
failure. If a job is renamed outside this script, health monitoring treats it as
missing even if a cron schedule still exists.

The maintenance function serializes refresh and analyze work through a shared
nonblocking advisory lock (`pg_try_advisory_lock`) with exception-safe unlock.
If one materialized-view job is still active when another starts, the later job
emits a PostgreSQL `NOTICE` and skips instead of queuing duplicate refresh work;
staleness should then be visible through the health payload's latest data age
and cron job status. `REFRESH MATERIALIZED VIEW CONCURRENTLY` inside this wrapper
is intentional. The fork-review concern about that syntax was retracted after
checking PostgreSQL behavior; the remaining runbook requirement is to make this
manually-applied script discoverable and to keep the health-monitored job names
intact.

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

UI placement: General dashboard **STATUS > Provider Auth** tab. Provider auth
health is not rendered inside the Health tab.

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

UI placement: General dashboard **STATUS > Provider Credits** tab. The Provider
Credits tab shows a steady green circle indicator when any summary or entry has
available credits. Provider credit lifecycle is not rendered inside the Health
tab.

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

## Session Diagnostics (Anthropic Context Window)

`/api/shell/reports/usage/session-diagnostics` exposes LiteLLM-persisted
Anthropic requested context-window classification as read-only diagnostic
metadata. These fields describe the requested/classified context window, not
actual prompt size, token volume, quota consumption, repository attribution, or
tenant attribution.

Projected metadata keys (when present on `session_history.metadata`):

- `anthropic_context_window_mode` as `mode`
  (`extended_1m`, `default_200k`, or `unknown`)
- `anthropic_context_window_requested_tokens` as `requested_tokens`
- `anthropic_context_window_source` as `source`
- `anthropic_context_window_beta` as `beta`
- `anthropic_context_window_classification` as `classification`

The diagnostics UI renders `extended_1m` as `1M extended`, `default_200k` as
`200k default`, and other or unknown modes as `unknown`. The source, beta, and
classification payload remain diagnostic breadcrumbs only. They are not consumed
by quota cards, token-trend charts, usage totals, or repository/tenant
inference.

Session diagnostics applies diagnostic metadata filters inside a bounded recent
`session_history` candidate scan; response metadata includes `candidateLimit`
for operators reviewing query scope.

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
- Centralized report-service writer: `server/report-service.mjs` via
  `server/docker-log-error-intake.mjs` for **non-repo-owned, non-external**
  containers discovered in Docker JSON logs (unknown upstream containers only)
- External containers (default `SHELL_REPORT_DOCKER_LOG_EXTERNAL_CONTAINERS=aawm-litellm,litellm-dev`)
  are **alert-only**: their rows appear in `dockerLogErrors` for dashboard
  correlation but must **not** create or append
  `.analysis/<external-container>-error.jsonl` in `dashboard-shell`
- Intake directory: `SHELL_CONTAINER_ERROR_INTAKE_DIR` and
  `SHELL_REPORT_ERROR_INTAKE_DIR` (compose default `/dashboard-shell-analysis`,
  bind-mounted to repo-local `./.analysis`)
- Centralized intake lock and dedupe behavior:
  - `acquireIntakeFileLock` keeps the per-container intake lock in a `.intake.lock`
    directory and recovers stale locks via `stat` + `rename` + `rm` on the stale
    path. Stale cleanup never removes a lock directory that has been re-created
    by another waiter in between stale observation and removal.
  - `loadPersistedDockerLogErrorFingerprintsFromJsonl` reads bounded recent rows
    (`128KiB` tail plus `1000` line cap defaults) before `Set`-based dedupe, so
    large files are not fully reread for every scan. A duplicate older than that
    bounded window can be appended again; this is accepted to keep each scan
    bounded and should be handled by cleanup/triage instead of unbounded rereads.
- Docker JSON scan budgets are bounded in-process and bounded by env:
  - `SHELL_REPORT_DOCKER_LOG_SCAN_MAX_SOURCES` (`1` to `128`, default `24`) caps
    sources considered per scan.
  - `SHELL_REPORT_DOCKER_LOG_SCAN_MAX_TOTAL_BYTES` (`256KiB` to `128MiB`,
    default `16MiB`) caps total tailed bytes across selected sources.
  - `SHELL_REPORT_DOCKER_LOG_TAIL_BYTES` (`64KiB` to `32MiB`, default `4MiB`)
    is the per-source byte cap before the shared total is exhausted.
  - `SHELL_REPORT_DOCKER_LOG_SCAN_CACHE_TTL_MS` (`0` to `600s`, default
    `45_000ms`) controls scan result cache freshness.
  - `SHELL_REPORT_DOCKER_LOG_INTAKE_FINGERPRINT_MAX` (`256` to `65_536`,
    default `8192`) bounds seen fingerprint retention for centralized intake
    dedupe.
  - After TTL expiry, unchanged Docker JSON sources reuse per-source cached rows when
    file `size` and `mtimeMs` match the last scan checkpoint, so unchanged files
    are not reread or reparsed.
- Compose-project marker matching is not hard-coded to `/projects/dashboard-shell`:
  if needed, set `SHELL_REPORT_DOCKER_COMPOSE_PROJECT_MARKERS` to one or more
  comma-separated path fragments so renamed checkouts can still match with
  `discoverDockerJsonLogSources` while unrelated projects remain excluded.

- Shell wrapper behavior: actionable lines written through `container-error-intake.sh`
  are appended as durable local rows by the wrapper process after a bounded
  fingerprint check over the recent local JSONL tail
  (`SHELL_CONTAINER_ERROR_DEDUPE_TAIL_LINES`, default `2000`). The wrapper does
  not take the report-service append lock; the directory-level no-dual-writer
  contract is enforced by keeping repo-owned wrapper containers, centralized
  unknown-container intake, and external alert-only containers disjoint.
- Wrapper deployment shape: the static nginx image intentionally keeps the
  shell wrapper because the final image has no Node runtime for reusing
  `server/docker-log-error-intake.mjs`. The wrapper therefore keeps a small
  POSIX-sh classifier in parity with the JS classifier and is covered by
  end-to-end wrapper tests for positive capture, status-code boundaries, JSON
  escaping, and bounded duplicate suppression.
- Wrapper performance and lifecycle: benign lines first pass through a
  zero-fork shell prefilter before the awk/grep classifier runs, so ordinary
  successful access logs do not all pay the full intake cost. FIFO paths are
  created with `mktemp`, converted with `mkfifo`, cleaned on `EXIT`, and a FIFO
  setup failure exits the wrapper instead of running with broken redirections.
  `TERM`, `INT`, `QUIT`, and `HUP` are forwarded to the child process; if a
  trapped signal interrupts `wait`, the wrapper waits again while the child is
  still alive so graceful child shutdown can complete.

Each JSONL record includes normalized fields such as `observed_at`, `container`,
`stream`, `level`, `status_code`, `provider`, compact `message`,
`source_identity`, `source_path` (host log path when report-service writes an
unknown non-repo, non-external Docker JSON log row), `fingerprint`, and
`ingested_at`. Real failures (errors, exceptions, tracebacks, 5xx, connection
refused, timeouts) are classified at `error` or `critical`, not downgraded to
`warning`.

For wrapper-authored rows, `observed_at` is the wrapper append time and equals
`ingested_at`; the wrapper is reading stdout/stderr streams and does not have the
Docker JSON log timestamp. Report-service Docker-tail rows use the Docker JSON
`time` value for `observed_at`.

The wrapper strips ANSI escape sequences with POSIX awk octal escape syntax,
normalizes remaining control characters before message compaction, JSON-escapes
all string fields, and caps wrapper messages at the JS intake cap of `280`
characters.

Informational or debug lines that only mention the word `error` in a
non-failure context (for example report-service `INFO: appended N docker log error
row(s)` intake summaries) are not classified as actionable and are not appended
to `*-error.jsonl`.

Successful HTTP access-log lines are also ignored when the request completed
with a 2xx/3xx status, even if the URL path contains `error` (for example static
error-boundary chunk names). Matching 4xx/5xx access logs remain actionable and
retain their `status_code`.

The `probe:ingestion` durability probe keeps a similar boundary for LiteLLM
access logs but preserves 3xx redirects as `http_redirect`, not `success` or
`http_error`, so redirect traffic does not inflate error counts. Its
source-table freshness comparison uses the same timestamp precedence as the
report-service health payload: `latestEventAt`, then `latestPersistedAt`, then
`latestDataAt`.

Container scope for Docker JSON log tailing defaults to repo-owned compose
services plus configured external containers. Legacy LiteLLM tails remain available
through `SHELL_REPORT_DOCKER_LOG_EXTERNAL_CONTAINERS` (default
`aawm-litellm,litellm-dev`). Setting `SHELL_REPORT_DOCKER_LOG_CONTAINERS`
replaces the default scope entirely for operator overrides.

Report-service JSONL append skips repo-owned container names and configured
external container names (see `filterDockerLogErrorsForCentralizedIntake` in
`server/docker-log-error-intake.mjs`) so per-container writers own repo-owned
rows and external LiteLLM incidents stay in the owning repo rather than
dashboard-shell `.analysis` intake files.

Per `AGENTS.md`, new intake rows should be evaluated alongside handoffs and may
open or update TODO items before unrelated feature work continues.
