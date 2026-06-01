# Dashboard Shell TODO

Last updated: 2026-06-01

This is the active queue for `dashboard-shell`. Keep unresolved work here. Move verified work to `.analysis/completed.md` with date, evidence, commands, and changed paths.

## Active Context

- `dashboard-shell` is still mostly the upstream shadcn-admin React/Vite/TanStack Router app.
- The target architecture in `.analysis/dashboard-shell-plan.md` is a shell app that loads project dashboards as Module Federation remotes.
- The current sibling remotes are `../aawm-dashboard`, `../aawm-tap-dashboard`, `../aawm-observe-dashboard`, `../aegis-dashboard`, and `../sluice-dashboard`.
- `../aawm-dashboard` exposes `aawm-dashboard/module` with `basePath: /aawm` and `apiBase: /api/aawm`; its current shell default route is `/`, not `/overview`.
- `../aawm-tap-dashboard` exposes `aawm-tap-dashboard/module` with `basePath: /aawm-tap` and `apiBase: /api/aawm-tap`.
- `../aawm-observe-dashboard` exposes `aawm-observe-dashboard/module` with `basePath: /aawm-observe` and `apiBase: /api/aawm-observe`.
- `../aegis-dashboard` exposes `aegis-dashboard/module` with `basePath: /aegis` and `apiBase: /api/aegis`.
- `../sluice-dashboard` exposes `sluice/module` with `basePath: /sluice` and `apiBase: /api/sluice`.
- Docker hosting files are present and both static/prod and live dev compose services use `restart: unless-stopped`.
- Static compose runs the shell on host port `3005`; `dashboard-shell`, `aawm-dashboard`, `aawm-tap-dashboard`, `aawm-observe-dashboard`, `aegis-dashboard`, and `sluice-dashboard` join `aawm-tap_default`, while `dashboard-shell-reports` joins both `aawm-tap_default` and `aawm_default` and bind-mounts `./server` over `/app/server` so report-service source edits only need a service restart.
- `docker-compose.dev.yml` runs live Vite dev containers on host ports `3006`, `5176`, `5173`, `5177`, `5174`, and `5175`, bind-mounted to this repo and the sibling dashboard repos; the dev shell and remotes join `aawm-tap_default`, while `dashboard-shell-reports-dev` joins both `aawm-tap_default` and `aawm_default`.
- The dev shell Vite watcher uses a repo-local ignore predicate for scratch/tooling/build folders such as `.analysis`, `.codex`, `.claude`, `.gemini`, `@mf-types`, and `dist` so ignored analysis artifacts and symlink loops cannot crash the container watcher; ESLint ignores the same local scratch roots.
- Module Federation DTS/type-hints are disabled in the shell and should stay disabled in sibling remote Vite federation configs because the dev-only browser plugin can create noisy runtime errors or blank browser sessions in this local setup.
- The dev shell host uses Module Federation `loaded-first` sharing so the General dashboard can bootstrap without preloading the AAWM TAP remote entry; the dev server also sends `Cache-Control: no-store` through an early middleware so Vite virtual bootstrap modules cannot be retained by the browser. The remote still loads on demand when navigating into `/aawm-tap`.
- The shell now injects Module Federation host initialization at the entry and has a localhost-only bootstrap diagnostic panel that records window errors if React does not mount into `#root`.
- The shell bootstrap and root error boundary detect stale Vite/chunk-load failures from rebuilt hashed assets and force one guarded reload instead of leaving users on the generic `500` error page.
- The static nginx shell disables ETag/If-Modified-Since handling for `index.html` and SPA fallbacks and sends no-store/no-cache headers so browser tabs cannot keep a stale shell HTML document that points at removed hashed chunks.
- The shell now owns a server-side report/proxy API; `/api/shell/reports/usage` reads `DATABASE_URL` server-side and feeds the root General dashboard.
- The General dashboard now shows provider-colored token trends, Provider Status, latest-record freshness, provider/model and repository breakouts under Token Trend, and a separate `Health` tab instead of the older quota-low-points, usage-slices, repository-trend, and in-panel client sections; Token Trend uses an inline detail section that updates from the hovered bar instead of fixed hover panels and spans two report columns on desktop and three on ultrawide. The standalone Client Usage dashboard section has been removed; client filtering remains available through the slicer, and client version detail is shown in the Token Trend active-version lane. The shell UI default report range is the last 30 Eastern calendar days through tomorrow, while the report service fallback remains last 7 days through tomorrow for direct API calls without explicit date params. Health Metrics lives on its own General dashboard `Health` tab and the tab shows an accessible blinking destructive dot when `provider_error_observations` or aggregate health event counts include errors in the last 24 hours. Health Metrics and Provider Status health timelines now use control-network probes from `provider_latency_health_5m` to separate likely `Network`, `Provider path`, `Provider API`, and `Workload` causes without subtracting control ping from LLM request latency; provider-health report rows are scoped to the 24-hour status-bar window ending at now for live ranges and at the selected `to` boundary for historical ranges. Gemini quota is grouped into one provider card with Flash, Flash Lite, and Pro 24-hour request windows, while OpenAI Provider Status spans the two status subcolumns with 5-Hour/Spark 5-Hour on the left and Weekly/Spark Weekly on the right. Provider Status cards reuse stable provider colors, show tokens used since reset or over 24 hours with model-colored horizontal usage bars and model-breakdown hover popups, and add vertical current-to-window-start health timelines in 5-minute increments using `provider_latency_health_5m` plus raw `provider_error_observations` event markers. xAI, OpenRouter, and Local render as unmetered 24-hour Provider Status cards with infinity remaining and next-midnight reset labels.
- TREND renders above Model Ledger / Repository Breakdown as a full-width day-level timeline scaled by daily token totals, with a compact `Health`/`Score` signal graph directly above the Token graph. The signal graph aligns to the same day/hour spine, exposes TREND-local scope and metric multi-selects, supports `All`, provider, and nested model scope selections, and renders full-range health categories from `provider_latency_health_5m` plus Score `Eval` coverage and deterministic `session_history` score categories without treating missing scores as zero. The Token graph remains below it with 24 hourly provider-stacked slices per day, token scale markers, and lower-lane tabs for `Version`, `Request`, and `Tool` in the chart footer below the selected lower graph. The upper token chart and lower trend lane use alternating subtle grey day-column backgrounds so day boundaries remain visible across the stacked visual. The upper token chart renders restrained violet full-day outlines for Anthropic, OpenAI, xAI, and Google/Gemini model-first-seen days based on each actual `session_history.model` first observation; these outlines are model-first-seen indicators only, not TUI/client-version markers. The lower-lane chart area matches the top token chart height so the token chart and selected detail lane read as one stacked visual. The provider/version legend lives in a bottom-right trend footer so it does not compete with the lower-lane tab strip. The `Version` active-version lane is limited to TUI/CLI client identities for Claude, Codex, Gemini, and Grok families, packs concurrent versions onto separate rows, collapses routed provider/client variants into one visible family-version line, colors each line by the dominant routed provider, keeps provider/client breakdown in metadata, and collapses hash-suffixed build variants such as `2.1.118.ab0` into their base client version for display. Provider family rows in the Version lane use subtle alternating background variation so sparse version activity remains readable. Transport/library clients such as `python-httpx` and `curl` are intentionally excluded from the active-version lane and day-hover version detail. Day hovers separate actual model rows under `models first seen` from TUI/CLI rows under `client versions first seen`; client-version rows are not labeled as model releases. The `Request` and `Tool` lower lanes render hourly-by-day provider stacks using `traces` and `tool_call_count` respectively, with compact scale markers labeled in requests or tool calls. `/api/shell/reports/usage/token-trend-summary` supplies the lightweight page-load hourly/version/request/tool/model-first-seen metadata, while `/api/shell/reports/usage/token-trend-day` fetches per-day client-version detail lazily on chart hover and caches by date/filter scope. General dashboard sections expose refresh controls with visible `Updating` state for manual refresh and background refetch.
- The left sidebar footer includes a live quota remaining visual for OpenAI Weekly/Spark, Anthropic Weekly/Sonnet, and Gemini Flash/Lite/Pro, backed by `/api/shell/reports/quotas`.
- STATUS shows a compact header legend for health-strip state colors, quota consumed-percent colors, and quota burn velocity tiers, with heading-sized section-level `Health` and `Quota` tabs inline beside the `STATUS` heading. The `Health` tab preserves the Provider Status card grid. Burn velocity legend swatches use a distinct violet/rose ramp with a static sheen marker so they are not confused with quota-used bands. Provider Status quota bars still derive from 100 one-percent logical segments per bar. Current and prior/history bars use backend-derived velocity score arrays from `rate_limit_observations` to tier each consumed percent bucket (`slow`, `steady`, `fast`, `hot`, `peak`), render adjacent same-state buckets as merged visual runs, and render one masked stepped velocity sweep per bar for `fast`, `hot`, and `peak` runs. The `Quota` tab uses a separate range-aware `quotaRangeHistory` report payload and renders compact static quota-history bars grouped by provider, without velocity animations.
- The live `aawm_tristore` `public.rate_limit_intervals` materialized view includes Codex special quota keys `codex_bengalfox:primary` and `codex_bengalfox:secondary`; without those keys the OpenAI Spark buckets fall back to synthetic `0%` values.
- `/api/shell/reports/usage/quota-estimator` exposes the Phase 0-2 additive quota-weight estimator for Anthropic and OpenAI. It builds explicit observation intervals from `rate_limit_observations`, reset context from `rate_limit_intervals`, and 5-minute usage buckets from `session_history`; it keeps uncached input, output, cache read, cache create/write, and reasoning tokens separate, sweeps lag candidates, reports static and exponentially weighted non-negative estimates, and labels weak fits as `directional_only` or `not_identifiable`.
- The latest UI/a11y/state hardening pass labels Recharts chart SVGs, commits report date inputs on blur/Enter/Apply instead of per keystroke, removes upstream shadcn profile identity, derives TeamSwitcher state from the router, adds sidebar progressbar semantics, validates AAWM TAP route params/search, and keeps `src/components/ui` in ESLint coverage.
- The latest runtime/tooling hardening pass adds Docker healthchecks/readiness-gated compose dependencies, TAP proxy timeout and SIGINT shutdown handling, nginx proxy timeouts, rolling report default dates, bounded report health payloads, short in-process report API caching, and a service-specific report image package so the report runtime installs only `pg`.
- The General dashboard usage and quota queries now refetch every 60 seconds, including in background tabs, and the report-service cache refresh path clears completed in-flight promises so Redis stale-while-revalidate entries do not stay stuck in a permanent refreshing state. The report service also reads bounded Docker JSON log tails for `aawm-litellm` and `litellm-dev` through a read-only `/var/lib/docker/containers` mount and exposes compact `dockerLogErrors` rows for the dashboard alert hover.
- Provider Status health strips still represent 288 five-minute buckets, with oldest buckets at the top of vertical bars and current buckets at the bottom. Vertical provider strips render adjacent same-state buckets as merged proportional-height visual runs. Probe-backed no-passive-traffic buckets no longer render as no-data blue: clean status/control probes render green, degraded probes render orange/red, missing upstream latency keeps the `miss` semantic class but renders as blue with hatch marks, and truly unprobed no-traffic buckets remain blue. Health-strip hover tooltips auto-select the newest error/degraded bucket and prefer timestamped event-log rows with provider error messages or probe details before falling back to relative bucket summaries. The Σ Aggregate Totals card owns the former fleet pulse role by overlaying all non-`proxy_internal` provider health rows into its vertical health strip; the old header Fleet Health Pulse and attribution ledger are removed. Local provider health is synthesized in the report service from `session_history` local route latency when the materialized provider-health view has no local rows, and the Local provider card also surfaces live local infra/model probe chips including LiteLLM, Langfuse Web/Worker/Redis, ClickHouse, MinIO, and GROBID.
- Dashboard hover tooltips are portalled to `document.body`, reset legacy absolute-positioning offsets before applying fixed coordinates, and clamp measured panels to the visible viewport with internal scrolling for oversized score/metadata hovers, so quota/trend tooltip bodies keep the same opaque black background as their headers instead of overflowing outside a collapsed painted box.
- TOOL hover shell-command rows normalize path-prefixed executables and leading assignment prefixes before grouping, so variants such as `./.venv/bin/python`, `/home/.../.venv/bin/python`, and `worktree=... git` roll up under clean command labels; multi-part shell labels such as `git show`, `docker exec`, `gh run`, and `npm test` collapse to one executable-level row per command family. The TOOL hover now packs MCP server groups by visual row budget so small MCP groups can share columns, lets expanded MCP groups show up to 28 visual rows, uses that same visual-row budget for Shell columns before showing `+N more`, and renders the highest-priority Tools column directly beside the Shell breakout while extra Tools columns expand leftward. Model Ledger model names are display-normalized (for example `GPT 5.5`) while preserving `stealth` and `free` context from `:stealth`/`:free` suffixes.
- Model Ledger first-cell gutters use the same provider brand color as the row's Provider column and token-trend provider palette, instead of severity gutter classes.
- Model Ledger is labeled `LEDGER`, keeps `Model` and `Repository` tabs inline beside the heading, defaults to collapsed provider rows, expands to provider-specific families and then exact models, keeps aggregate rows free of exact-model tool/error hovers, and no longer renders non-sparkline microbars; Repository Breakdown merges rows that only differ by a trailing ` (memory)` suffix. Reasoning-token cells show reported+estimated as one number, add `*` when estimated tokens contribute, and expose reported/estimated breakdown on hover. The ledger also includes an Agent status summary from deterministic `session_history` score columns, with hover coverage, failure flags, family scores, and humanized top reason codes.
- `/api/aawm-tap/*` is wired through the shell report/proxy service, which forwards to `host.docker.internal:8010` because the current `aawm-tap` API dev service is host-networked; it injects `AAWM_TAP_API_KEY` server-side and strips browser-sent auth headers.
- `/api/aawm/*` and `/hook-api/*` are wired through the shell report/proxy service, defaulting to Docker service names `aawm-api:8000` and `aawm-hook-server:8318` on the shared `aawm_default` network; browser auth headers are stripped and configured AAWM secrets are injected server-side.
- `/api/aawm-observe/*` is wired through the shell report/proxy service with default target `host.docker.internal:34042`; the Observe dashboard currently renders placeholder telemetry content while its live API adapter contract is still evolving.
- The remote dashboard integration contract is documented in `docs/remote-dashboard-integration-contract.md`; the shell-side process for adding sibling repos in both live dev containers and static/prod-style containers is documented in `docs/sibling-dashboard-setup.md`; the current component-sharing decision is vendor-and-sync, `pnpm scaffold:dashboard` creates a new dashboard baseline with vendored shadcn primitives/theme tokens and an inline-style lint guard, `pnpm scaffold:tap` remains as a compatibility alias, and shell chrome consumes module `accentColor` for module icon and nav accents.

## Queue

### D1-094 - Deferred: quota Phase 3 cumulative interval-censored model

Goal: After the Phase 0-2 estimator has enough real residual and backtest
evidence, implement the Phase 3 cumulative interval-censored quota model from
`.analysis/anthropic_quota_weight_derivation_plan.md` so rounded provider quota
percentages, reset windows, and coefficient drift are modeled explicitly instead
of approximated only with static or exponentially weighted regression.

Main references:
- `.analysis/anthropic_quota_weight_derivation_plan.md`
- `server/report-service.mjs`
- `src/features/dashboard/api/usage-report.ts`
- `src/features/dashboard/lib/report-service-query-builders.test.ts`
- Phase 0-2 outputs from `D1-092`

Acceptance evidence:
- Deferred tag remains until `D1-092` has verified Phase 0-2 residual reports,
  lag sensitivity, identifiability scores, and rolling-vs-static backtests.
- Latent cumulative quota-burn model represents quota movement as interval
  censored observations rather than treating rounded displayed percentages as
  exact deltas.
- Latent burn features preserve uncached input, cache read, and cache
  create/write categories separately, with cache-read coefficient priors or
  constraints reviewed against the Phase 0-2 evidence before Phase 3 modeling.
- Phase 3 consumes the Phase 0-2 read-model/API contract from
  `/api/shell/reports/usage/quota-estimator`: observation intervals from
  `rate_limit_observations`, reset context from `rate_limit_intervals`, and
  5-minute usage buckets derived from `session_history`.
- Phase 3 keeps `cache_creation_input_tokens` as one generic cache-create/write
  feature until upstream telemetry provides verified 5-minute vs 1-hour
  cache-write buckets; it must not invent duration-specific cache-write
  coefficients from the current schema.
- Rounded/floored display-rule comparison is implemented and reported so the
  model can explain provider UI/API percentage granularity without overfitting
  to display artifacts.
- State-space drift estimates exist for provider/quota/model-family
  coefficients and separate gradual coefficient drift from data-quality
  contamination or reset-boundary artifacts.
- Retrospective smoothed coefficient history can be generated for Anthropic
  first, then OpenAI lanes once provider-specific semantics are validated.
- Evaluation shows better reset-window calibration, lower interval residual
  autocorrelation, and clear uncertainty intervals compared with the Phase 2
  rolling estimator.
- Tests cover rounded/floored observation likelihoods, reset-window calibration,
  residual autocorrelation checks, state drift behavior, and uncertainty
  widening under weak evidence.

Known hazards:
- Phase 3 adds statistical complexity that is not justified until Phase 0-2
  proves the telemetry is aligned and mixed enough to identify real weights.
- The Phase 0-2 live estimator currently reports many lanes as
  `directional_only` or `not_identifiable`; Phase 3 should treat those as
  prerequisites for more evidence or stronger priors, not as a reason to hide
  uncertainty in a more complex model.
- Rounded provider quota percentages can make multiple latent burn paths
  plausible; the model must preserve uncertainty instead of selecting a
  deceptively precise path.
- State-space drift can mislabel external provider usage, missing telemetry, or
  reset contamination as real model-family coefficient changes.
- Cache-read vs uncached-input ordering can be distorted by correlated workloads
  or missing cache-write-duration data; Phase 3 should preserve uncertainty
  instead of forcing a precise cache-read multiplier from weak evidence.
- OpenAI Spark/special quota semantics and Anthropic Sonnet-only semantics must
  remain provider-specific; Phase 3 must not collapse them into one generic
  latent model.

### D1-095 - Deferred: quota Phase 4 operational dashboard and alerts

Goal: After quota estimator outputs are trustworthy, implement the Phase 4
operational dashboard/API surface from
`.analysis/anthropic_quota_weight_derivation_plan.md` so operators can see
current quota burn forecasts, model-family quota weights, estimate confidence,
and data-quality alerts without replacing the existing Provider Status quota
bars.

Main references:
- `.analysis/anthropic_quota_weight_derivation_plan.md`
- `server/report-service.mjs`
- `src/features/dashboard/api/usage-report.ts`
- `src/features/dashboard/components/phosphor-dashboard.tsx`
- `src/features/dashboard/components/provider-card.tsx`
- Phase 0-2 outputs from `D1-092`
- Phase 3 outputs from `D1-094` when available

Acceptance evidence:
- Deferred tag remains until `D1-092` has reliable estimator output; if `D1-094`
  is not implemented, the dashboard labels estimates as Phase 2-derived and
  avoids implying interval-censored/state-space confidence.
- Initial Phase 4 integration should consume
  `/api/shell/reports/usage/quota-estimator` as an additive diagnostic payload
  with `phase: 0-2`, selected lag, identifiability status, residual metrics,
  cache-read ratio, coefficient confidence bands, and diagnostics; it should not
  wait for Phase 3 unless the UI claims interval-censored/state-space
  confidence.
- Dashboard/API output exposes current quota burn forecast, model-family quota
  weights, confidence or identifiability status, residual anomaly alerts, usage
  contamination alerts, and coefficient drift alerts.
- Forecast and weight detail expose cache-read and cache-create/write
  coefficients separately from uncached input, including the cache-read vs
  uncached-input ratio when identifiable.
- Operators can distinguish `high_confidence`, `directional_only`, and
  `not_identifiable` estimates at the point where quota weights or forecasts are
  displayed.
- Quota forecasts update after each new quota observation and clearly show the
  observation timestamp, provider/quota lane, lag assumption, and freshness.
- Forecast copy labels Anthropic `special` as weekly Sonnet-only and OpenAI
  `short_special` / `special` as Codex Spark lanes; OpenAI all-model lanes must
  remain separate from Spark/special lanes in labels, filters, and warnings.
- Large residuals trigger data-quality checks before model-weight changes are
  promoted into the displayed estimate or forecast.
- Existing Provider Status quota bars remain source-of-truth visuals for raw
  observed quota state; Phase 4 adds forecast/diagnostic layers rather than
  replacing the observed bars.
- Browser smoke tests verify the dashboard presentation in current Anthropic and
  OpenAI quota scenarios, including unknown/not-identifiable states and large
  residual alerts.

Known hazards:
- Forecasts can look more authoritative than the underlying estimate; status,
  confidence, freshness, and residual warnings need to stay visually attached to
  every forecast.
- Cache-read discounts should be visible as estimator output, not hidden inside
  a blended token total, but the UI should avoid implying certainty when
  cache-read coefficients are directional-only or not identifiable.
- Data-quality alerts should not spam operators when quota observations are
  missing, rounded, capped, or delayed; alert thresholds need hysteresis or
  suppression.
- Existing Provider Status cards are already dense, so Phase 4 should avoid
  adding unreadable hover walls or visual competition with the raw quota bars.
- The estimator endpoint intentionally caps recent plateau intervals per lane
  for operational responsiveness; Phase 4 needs to show sample/effective-sample
  counts and freshness so users do not mistake a bounded rolling estimate for a
  full-history fit.
- OpenAI and Anthropic lanes have different semantics; forecast and alert copy
  must identify the lane being modeled instead of presenting provider-wide
  certainty.
