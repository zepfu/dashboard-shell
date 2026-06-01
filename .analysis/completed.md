# Dashboard Shell Completed Work

Record completed work here immediately after verification. Keep entries concise but include enough evidence for the next agent to trust or reopen the result.

## Entry Format

### YYYY-MM-DD - D1-### - Short title

Status: Completed | Dead end / reopened

Changed paths:
- `path/to/file`

Evidence:
- What changed and why.
- Verification command(s) and important output.
- Runtime or database target when relevant.

Follow-up:
- Remaining risks or next task IDs.

### 2026-06-01 - D1-103 - Expand TREND Health/Score signal data

Status: Completed

Initiated: 2026-06-01 11:13:00 America/New_York
Completed: 2026-06-01 11:50:00 America/New_York
Duration: 37 minutes

Changed paths:
- `.analysis/completed.md`
- `.analysis/todo.md`
- `server/report-service.mjs`
- `src/features/dashboard/api/usage-report.ts`
- `src/features/dashboard/components/phosphor-dashboard.tsx`
- `src/features/dashboard/components/token-trend-chart.tsx`
- `src/features/dashboard/components/token-trend-chart.test.tsx`
- `src/features/dashboard/lib/report-service-query-builders.test.ts`

Evidence:
- Moved the TREND Health/Score panel off the sparse Provider Status/main-report fallbacks. `/api/shell/reports/usage/token-trend-summary` now returns full selected-range `tokenTrendHealth` rows from `provider_latency_health_5m` and hourly `tokenTrendScores` rows from deterministic `session_history` score fields.
- Kept missing score fields as missing instead of zero, and prefiltered Score SQL to rows that have at least one score source column.
- Switched token-trend summary `session_history` queries to the chart-aligned `created_at` date window so hourly buckets and filters use the same timestamp basis.
- Added Score `Eval` count coverage so evaluated no-risk rows are visible in the default Score graph instead of looking absent just because their risk value is `0`.
- Cached endpoint proof on `http://127.0.0.1:3006/api/shell/reports/usage/token-trend-summary?from=2026-05-02&to=2026-06-02&cache_bust=signal-full-range-smoke-20260601` returned `cacheScope: usage-token-trend-summary-v3`, `tokenTrendHealth: 3779`, `tokenTrendScores: 3517`, `tokenTrendHours: 1820`, `tokenTrendVersions: 93`, and `tokenTrendModelFirstSeen: 4`.
- Browser smoke on `http://127.0.0.1:3006/?verify=trend-signal-full-range` showed the Score graph with `Eval/Q/I/T/C/P/R`, `31` day envelopes, `744` hourly cells, `572` nonzero score bars, and no current console warnings/errors. Health showed `31` day envelopes, `744` hourly cells, and `321` nonzero health bars.

Verification:
- `node --check server/report-service.mjs` passed.
- `pnpm exec vitest run` passed: 39 files, 539 tests.
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec eslint .` passed with existing React Fast Refresh and TanStack Table React Compiler warnings, 0 errors.
- `git diff --check` passed.

Follow-up:
- Cold-cache token-trend summary generation can still exceed a 60s client cap under current live DB I/O because the endpoint still has to build hourly token/version/model metadata from `session_history`. The cached path is fast and dense; if cold misses become operationally noisy, add a separate performance item for preaggregation or a split summary endpoint.

### 2026-06-01 - D1-104 - Fill TREND Health/Score sparse signal gaps

Status: Completed

Initiated: 2026-06-01 15:45:00 America/New_York
Completed: 2026-06-01 15:57:45 America/New_York
Duration: 13 minutes

Changed paths:
- `.analysis/completed.md`
- `.analysis/todo.md`
- `server/report-service.mjs`
- `src/features/dashboard/api/usage-report.ts`
- `src/features/dashboard/components/token-trend-chart.tsx`
- `src/features/dashboard/components/token-trend-chart.test.tsx`
- `src/features/dashboard/lib/report-service-query-builders.test.ts`

Evidence:
- Confirmed the sparse display was not a timezone parse issue. The summary endpoint emits local wall-clock bucket strings and the chart parser already reads local hours directly.
- Added Health `Probes` as a selectable signal metric backed by `status_probe_count`, so probe-backed health rows remain visible even when passive request/error/rate-limit traffic is sparse.
- Expanded `/api/shell/reports/usage/token-trend-summary` Score rows to include the newer deterministic score fields already used elsewhere in the dashboard: discovery inventory coverage, terminal completion, ignored-path tracking policy, baseline deflection, and sleep/wellness interruption.
- Added chart Score metrics for `Ignored path pass`, `Baseline clear`, and `Sleep clear`; incident-oriented baseline/sleep scores are inverted for this chart so evaluated clean rows render as signal coverage instead of disappearing as zero-valued incidents.
- Restarted `dashboard-shell-reports-dev` after the report-service change.
- Live cache-miss probe on `http://127.0.0.1:3006/api/shell/reports/usage/token-trend-summary?from=2026-05-30&to=2026-06-02&cacheBust=debug-score-density-after-patch` returned `cacheScope: usage-token-trend-summary-v3`, `tokenTrendHealth: 692`, `tokenTrendScores: 145`, and score days `2026-05-30`, `2026-05-31`, and `2026-06-01`. The response had non-null counts `ignored: 121`, `baseline: 145`, `sleep: 145`, `quality: 43`, `risk: 67`, plus `691` health rows with `status_probe_count > 0`.

Verification:
- `node --check server/report-service.mjs` passed.
- `pnpm exec vitest run src/features/dashboard/lib/report-service-query-builders.test.ts src/features/dashboard/components/token-trend-chart.test.tsx` passed: 2 files, 42 tests.
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec eslint server/report-service.mjs src/features/dashboard/api/usage-report.ts src/features/dashboard/components/token-trend-chart.tsx src/features/dashboard/components/token-trend-chart.test.tsx src/features/dashboard/lib/report-service-query-builders.test.ts` passed.
- `pnpm exec vitest run` passed: 39 files, 539 tests.
- `git diff --check` passed.

Follow-up:
- Cold-cache token-trend summary generation is still slow on live DB misses; this pass fixed missing/sparse signal categories but did not change the query plan.

### 2026-06-01 - D1-102 - Fix TREND Health/Score scaling and selector responsiveness

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `src/features/dashboard/components/token-trend-chart.tsx`
- `src/features/dashboard/components/token-trend-chart.test.tsx`
- `src/styles/index.css`

Evidence:
- Replaced the Health/Score signal rows with a token-style day/hour envelope graph above the Token graph. Each selected metric is normalized against its own max and stacked as hour slices so mixed count, latency, and score units do not collapse the scale.
- Kept the signal graph aligned to the same day/hour spine as Token, including day envelopes, hourly bars, alternating day backgrounds, and compact metric legend labels.
- Replaced native `details` dropdowns with controlled popovers. Scope and metric option groups stay mounted and toggle `hidden`, so opening selectors does not remount long option lists.
- Moved Health/Score signal state into an isolated `TrendSignalPanel` child component, so dropdown/tab changes no longer rerender the main Token chart subtree.
- Browser smoke on `http://127.0.0.1:3006/?verify=signal-panel-isolated` showed the signal graph at `108px` high, non-zero scaled day envelope heights (`83.8%`, `100%`), `25` non-zero hourly signal bars, `63` scope options, `5` health metric options, scope open in about `45ms`, metric open in about `31ms`, and mutually exclusive hidden/expanded menu states. Browser console check reported 0 warnings and 0 errors.

Verification:
- `pnpm exec vitest run src/features/dashboard/components/token-trend-chart.test.tsx` passed: 1 file, 31 tests.
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec eslint src/features/dashboard/components/token-trend-chart.tsx src/features/dashboard/components/token-trend-chart.test.tsx` passed.
- `git diff --check` passed.

Follow-up:
- None.

### 2026-06-01 - D1-097 - Separate model first-seen indicators from client versions

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `.analysis/todo.md`
- `server/report-service.mjs`
- `src/features/dashboard/lib/report-service-query-builders.test.ts`
- `src/features/dashboard/components/token-trend-chart.tsx`
- `src/features/dashboard/components/token-trend-chart.test.tsx`

Evidence:
- Moved first-seen model hour columns into the upper Token Trend chart and removed them from the `Versions` lower lane.
- Kept the purple first-seen marker source limited to actual `session_history.model` rows for Anthropic, OpenAI, xAI, and Google/Gemini; TUI/CLI `client_name` / `client_version` intervals no longer create purple model markers or the `First seen model` legend.
- Changed the model-first-seen report query from “first seen inside the selected chart range” to “first observed across session history, then shown only when that first-observed day falls inside the visible trend range.”
- Updated the day hover copy so actual model rows render under `models first seen`, while TUI/CLI version rows render separately under `client versions first seen`; the hover no longer labels client-version first appearances as `releases`.
- Browser smoke on `http://127.0.0.1:3006/?verify=model-first-seen-token-chart` showed `11` `.tt-day-chart .tt-model-first-seen-column` markers, `0` `.tt-active-version-lane .tt-model-first-seen-column` markers, and the expected `Versions`, `Request`, `Tool` lower tabs.
- Browser hover over the `2026-05-02` day column showed `models first seen`, `gpt-5.5`, and `client versions first seen`, with no `releases` text. Browser console check reported 0 warnings and 0 errors.

Verification:
- `node --check server/report-service.mjs` passed.
- `pnpm exec vitest run src/features/dashboard/components/token-trend-chart.test.tsx src/features/dashboard/lib/report-service-query-builders.test.ts` passed: 2 files, 38 tests.
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec eslint server/report-service.mjs src/features/dashboard/components/token-trend-chart.tsx src/features/dashboard/components/token-trend-chart.test.tsx src/features/dashboard/lib/report-service-query-builders.test.ts` passed.
- `pnpm exec prettier --check server/report-service.mjs src/features/dashboard/components/token-trend-chart.tsx src/features/dashboard/components/token-trend-chart.test.tsx src/features/dashboard/lib/report-service-query-builders.test.ts src/styles/index.css .analysis/todo.md .analysis/completed.md` passed.
- `git diff --check` passed.

Follow-up:

### 2026-06-01 - D1-100 - Render model-first-seen markers as full-day outlines

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `.analysis/todo.md`
- `src/features/dashboard/components/token-trend-chart.tsx`
- `src/features/dashboard/components/token-trend-chart.test.tsx`
- `src/styles/index.css`

Evidence:
- Replaced the upper Token Trend model-first-seen hour columns with a single full-day outline per day shell when one or more actual models first appear on that day.
- Clustered all first-seen model rows for the same day into one outline summary and kept the marker source limited to actual `session_history.model` rows via the existing model-first-seen data path.
- Kept the active-version lane free of model-first-seen markers, left the hover shell behavior intact, and changed the legend swatch to match the outline treatment.

Verification:
- `pnpm exec vitest run src/features/dashboard/components/token-trend-chart.test.tsx` passed: 1 file, 29 tests.

Follow-up:
- None.

### 2026-06-01 - D1-098 - Add STATUS model-weighting tab for quota estimator detail

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `.analysis/todo.md`
- `src/features/dashboard/components/phosphor-dashboard.tsx`
- `src/features/dashboard/components/phosphor-dashboard.test.tsx`
- `src/styles/index.css`

Evidence:
- Added an additive `STATUS` `Weights` tab beside `Health` and `Quota`.
- Wired the tab to `/api/shell/reports/usage/quota-estimator` with the current dashboard date range and refresh state.
- Rendered Phase 0-2 estimator detail by provider/quota lane, including selected lag, trainable/effective samples, identifiability status, residual/backtest context, lag sensitivity, cache-read ratios, coefficients grouped by token category/model family, and diagnostics.
- Preserved existing Provider Status quota bars as the observed quota source of truth; the new tab is diagnostic only.
- Added loading, empty, `directional_only`, and `not_identifiable` states.

Verification:
- `pnpm exec vitest run src/features/dashboard/components/phosphor-dashboard.test.tsx` passed: 1 file, 78 tests.

Follow-up:
- None.

### 2026-06-01 - D1-099 - Fix empty STATUS Quota history tab

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `.analysis/todo.md`
- `src/features/dashboard/components/phosphor-dashboard.tsx`
- `src/features/dashboard/components/phosphor-dashboard.test.tsx`

Evidence:
- Traced the blank/weak Quota-tab state to the `ProviderQuotaHistoryBucket` empty renderer path: when a provider/range has zero history rows, the tab could show only generic or visually sparse empty content.
- Kept populated quota-history rendering intact, including provider grouping, zero-count lane tabs, and compact static history bars.
- Updated the empty state to include provider and selected range context, for example `no quota history for openai in 2026-05-20 to 2026-05-21`.
- Added component coverage for the empty range-aware `quotaRangeHistory` path while preserving the existing populated quota-tab coverage and refresh-routing coverage.

Verification:
- `pnpm exec vitest run src/features/dashboard/components/phosphor-dashboard.test.tsx` passed: 1 file, 79 tests.

Follow-up:
- None.

### 2026-06-01 - D1-101 - Add TREND Health/Score graph and scoped metric filters

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `.analysis/todo.md`
- `src/features/dashboard/components/anchor-bar.tsx`
- `src/features/dashboard/components/anchor-bar.test.tsx`
- `src/features/dashboard/components/phosphor-dashboard.tsx`
- `src/features/dashboard/components/token-trend-chart.tsx`
- `src/features/dashboard/components/token-trend-chart.test.tsx`
- `src/features/dashboard/index.tsx`
- `src/features/dashboard/index.test.tsx`
- `src/styles/index.css`

Evidence:
- Added a compact TREND signal graph directly above the Token graph, with `Health` and `Score` tabs.
- The `Health` graph uses existing provider health rows for requests, errors, rate limits, and P95 latency; the `Score` graph uses existing deterministic session-history score fields for quality, instruction, tool, contract, progress, and risk.
- Rendered the signal graph as separate metric rows aligned to the same day/hour spine as the Token graph, avoiding a single mixed scale for counts, latency, and percentages.
- Added TREND-local multi-select dropdowns for scope (`All`, provider, nested model under provider) and metrics, with empty states for no selected metrics, no matching data, and unavailable metric categories.
- Kept the existing Token graph below the new graph and preserved the `Request` and `Tool` lower lanes.
- Renamed the lower trend detail tab and keyboard shortcut copy from plural `Versions` / `[V]ersions` to singular `Version` / `[V]ersion`, while keeping `trend-versions` as a compatibility activation alias.

Verification:
- `pnpm exec vitest run src/features/dashboard/components/token-trend-chart.test.tsx` passed: 1 file, 31 tests.
- `pnpm exec vitest run src/features/dashboard/components/phosphor-dashboard.test.tsx` passed: 1 file, 79 tests.
- `pnpm exec vitest run src/features/dashboard/index.test.tsx src/features/dashboard/components/anchor-bar.test.tsx` passed: 2 files, 11 tests.
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec eslint src/features/dashboard/components/token-trend-chart.tsx src/features/dashboard/components/token-trend-chart.test.tsx src/features/dashboard/components/phosphor-dashboard.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx src/features/dashboard/components/anchor-bar.tsx src/features/dashboard/components/anchor-bar.test.tsx src/features/dashboard/index.tsx src/features/dashboard/index.test.tsx` passed with 0 errors and the existing Fast Refresh warning baseline in `phosphor-dashboard.tsx`.
- `git diff --check` passed.
- Browser smoke on `http://127.0.0.1:3006/?verify=d1-101-trend-health-score-final` showed `[V]ersion` in the anchor bar, `Version`/`Request`/`Tool` lower tabs, the Health/Score signal graph above the Token chart, successful Score tab switching, health rows (`Requests`, `Errors`, `Rate limits`, `P95 latency`), score rows (`Quality`, `Instruction`, `Tool`, `Contract`, `Progress`, `Risk`), provider plus nested-model scope options, metric options, and 0 console warnings/errors.

Follow-up:
- None.

### 2026-05-31 - D1-092 - Anthropic-first quota-weight estimator Phases 0-2 with OpenAI extension path

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `.analysis/todo.md`
- `.analysis/quota_weight_phase0_audit.md`
- `server/report-service.mjs`
- `src/features/dashboard/api/usage-report.ts`
- `src/features/dashboard/lib/report-service-query-builders.test.ts`

Evidence:
- Captured the Phase 0 data-shape audit in `.analysis/quota_weight_phase0_audit.md` from live `aawm_tristore` schema/sample checks. Verified `session_history` has separate `input_tokens`, `output_tokens`, `cache_read_input_tokens`, one generic `cache_creation_input_tokens`, reasoning tokens, cost, tool-call, client/version, and timing fields; verified `rate_limit_observations` has raw observed `remaining_pct` by `provider`, `quota_key`, `quota_type`, and `expected_reset_at`; verified current Anthropic and OpenAI quota keys.
- Added `/api/shell/reports/usage/quota-estimator` as an additive Phase 0-2 report. It does not replace or mutate existing Provider Status quota bars.
- Added read-model builders for quota-observation intervals and 5-minute usage buckets, plus the original dataset query builder for shape regression coverage. The runtime endpoint avoids a heavy SQL range join by aligning usage buckets to quota intervals in JS.
- Preserved token categories before estimator feature construction: uncached input, output, cache read, cache create/write, and reasoning. Cache read remains a separate feature and is not summed into normal input. Duration-specific cache-write buckets are reported unavailable because the live schema only verified `cache_creation_input_tokens`.
- Implemented Anthropic lanes for 5-hour all-model, weekly all-model, and weekly Sonnet-only. Sonnet-only keeps Haiku/Opus as diagnostic coefficients and warns when those coefficients are materially positive.
- Implemented OpenAI lanes for Codex all-model short/weekly and Codex Spark short/weekly, excluding synthetic fallback/unknown-window observations from training.
- Implemented non-negative static baseline and exponentially weighted rolling estimates, lag sensitivity across `0, 1, 5, 10, 30, 60` minutes, cache-read vs workload ratios, widened confidence bands for weak fits, identifiability status (`high_confidence`, `directional_only`, `not_identifiable`), residual metrics, and rolling-vs-static holdout backtest output.
- Updated deferred `D1-094` and `D1-095` with the concrete Phase 0-2 API contract, cache-write granularity constraint, bounded rolling estimator caveat, and Anthropic/OpenAI lane-labeling requirements.
- Restarted `dashboard-shell-reports-dev`; live API verification through `http://127.0.0.1:3006/api/shell/reports/usage/quota-estimator?from=2026-05-31&to=2026-06-01&cacheBust=d1-092-js-smoke` returned `status: 200`, `cacheStatus: miss`, `cacheScope: usage-quota-estimator-v1`, `phase: 0-2`, and 7 estimates covering Anthropic special/short/weekly plus OpenAI short/weekly/special/short_special. The response included selected lags, trainable interval counts, identifiability statuses, coefficient counts, diagnostics, and missing fields `cache_write_5m_tokens`, `cache_write_1h_tokens`, and shared account ID.

Verification:
- `node --check server/report-service.mjs` passed.
- `pnpm exec vitest run src/features/dashboard/lib/report-service-query-builders.test.ts` passed: 1 file, 10 tests.
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec eslint server/report-service.mjs src/features/dashboard/api/usage-report.ts src/features/dashboard/lib/report-service-query-builders.test.ts` passed.
- `pnpm exec prettier --check server/report-service.mjs src/features/dashboard/api/usage-report.ts src/features/dashboard/lib/report-service-query-builders.test.ts .analysis/todo.md .analysis/completed.md .analysis/quota_weight_phase0_audit.md` passed.
- `git diff --check` passed.
- `docker compose -f docker-compose.dev.yml restart dashboard-shell-reports-dev` completed and `docker ps --filter name=dashboard-shell-reports-dev --format "{{.Names}} {{.Status}}"` reported healthy.

Follow-up:
- D1-094 remains deferred for interval-censored/state-space modeling once Phase 0-2 residuals justify the added complexity.
- D1-095 remains deferred for dashboard/alert presentation using the Phase 0-2 estimator output or Phase 3 output when available.

### 2026-05-31 - D1-091 - Rename TREND TUI lane to Versions and show first-seen model columns

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `.analysis/todo.md`
- `server/report-service.mjs`
- `src/features/dashboard/api/usage-report.ts`
- `src/features/dashboard/lib/trend-utils.ts`
- `src/features/dashboard/lib/trend-utils.test.ts`
- `src/features/dashboard/lib/report-service-query-builders.test.ts`
- `src/features/dashboard/components/token-trend-chart.tsx`
- `src/features/dashboard/components/token-trend-chart.test.tsx`
- `src/features/dashboard/components/phosphor-dashboard.tsx`
- `src/features/dashboard/components/anchor-bar.tsx`
- `src/features/dashboard/components/anchor-bar.test.tsx`
- `src/features/dashboard/index.tsx`
- `src/features/dashboard/index.test.tsx`
- `src/styles/index.css`

Evidence:
- Renamed the TREND lower-lane tab and shortcut from `TUI` to `Versions` while preserving the existing observed client-version rows for Claude, Codex, Gemini, and Grok families.
- Added `tokenTrendModelFirstSeen` to the token-trend summary report/API payload and dashboard plumbing. The first-seen query is intentionally bounded to the selected report date/filter scope so the lightweight trend endpoint remains usable; labels use observed first-seen language rather than public release-date language.
- Rendered distinct restrained violet first-seen model columns in the Versions lane for Anthropic, OpenAI, xAI, and Google/Gemini model observations, with compact count/intensity behavior for same-hour clusters and accessible title/aria details containing model, provider, timestamp, observation count, and token total context.
- Added subtle alternating provider-family row backgrounds in the Versions lane so sparse version/model activity remains easier to scan.
- Updated the token-trend summary cache scope to `usage-token-trend-summary-v2` so live Redis entries cannot return stale payloads missing the first-seen field.
- Restarted `dashboard-shell-reports-dev`; live API verification through `http://127.0.0.1:3006/api/shell/reports/usage/token-trend-summary?from=2026-05-30&to=2026-06-01&cacheBust=d1-091-final` returned `status: 200`, `cacheStatus: miss`, `cacheScope: usage-token-trend-summary-v2`, `hours: 98`, `versions: 10`, and `modelFirstSeen: 16`.
- Browser smoke on `http://127.0.0.1:3006/?verify=d1-091-versions-final` showed lower tabs `Versions`, `Request`, `Tool`; `Versions` selected; 48 rendered `.tt-model-first-seen-column` elements; `First seen model` legend present; `[V]ersions` shortcut present; no `[T]UI` shortcut; and alternating family-row backgrounds.
- Browser console verification reported 0 warnings and 0 errors.

Verification:
- `node --check server/report-service.mjs` passed.
- `pnpm exec vitest run src/features/dashboard/lib/report-service-query-builders.test.ts src/features/dashboard/lib/trend-utils.test.ts src/features/dashboard/components/token-trend-chart.test.tsx src/features/dashboard/components/anchor-bar.test.tsx src/features/dashboard/index.test.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx` passed: 6 files, 131 tests.
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec eslint server/report-service.mjs src/features/dashboard/api/usage-report.ts src/features/dashboard/lib/trend-utils.ts src/features/dashboard/lib/trend-utils.test.ts src/features/dashboard/components/token-trend-chart.tsx src/features/dashboard/components/token-trend-chart.test.tsx src/features/dashboard/components/phosphor-dashboard.tsx src/features/dashboard/components/anchor-bar.tsx src/features/dashboard/components/anchor-bar.test.tsx src/features/dashboard/index.tsx src/features/dashboard/index.test.tsx src/styles/index.css src/features/dashboard/lib/report-service-query-builders.test.ts` passed with 0 errors and 12 existing warnings.
- `pnpm exec prettier --check server/report-service.mjs src/features/dashboard/api/usage-report.ts src/features/dashboard/lib/trend-utils.ts src/features/dashboard/lib/trend-utils.test.ts src/features/dashboard/components/token-trend-chart.tsx src/features/dashboard/components/token-trend-chart.test.tsx src/features/dashboard/components/phosphor-dashboard.tsx src/features/dashboard/components/anchor-bar.tsx src/features/dashboard/components/anchor-bar.test.tsx src/features/dashboard/index.tsx src/features/dashboard/index.test.tsx src/styles/index.css src/features/dashboard/lib/report-service-query-builders.test.ts .analysis/todo.md .analysis/completed.md` passed.
- `git diff --check` passed.
- `docker compose -f docker-compose.dev.yml restart dashboard-shell-reports-dev` completed and `docker ps --filter name=dashboard-shell-reports-dev --format "{{.Names}} {{.Status}}"` reported healthy.

Follow-up:
- If product requirements later require true all-time model first-seen independent of the selected range, add an indexed/materialized read model instead of running an unbounded first-seen query inside the lightweight trend summary endpoint.

### 2026-05-31 - D1-096 - Surface compact-summary session-history metrics

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `.analysis/todo.md`
- `.analysis/completed-handoff/handoff-session-history-compact-summary-d1-169.md`
- `server/report-service.mjs`
- `src/features/dashboard/api/usage-report.ts`
- `src/features/dashboard/lib/agent-quality.ts`
- `src/features/dashboard/lib/agent-quality.test.ts`
- `src/features/dashboard/lib/report-service-query-builders.test.ts`
- `src/features/dashboard/components/master-ledger-table.tsx`
- `src/features/dashboard/components/master-ledger-table.test.tsx`
- `src/features/dashboard/lib/usage-report-display.ts`

Evidence:
- Archived the consumed compact-summary handoff under `.analysis/completed-handoff/`.
- Added report-service aggregates for `is_compact_summary`, compact thread/id coverage, non-counted `resume_context` / `verify` rows, and compact source counts without inferring compact events from `/compact` prose.
- Extended API flat row types and agent-quality normalization/combination to preserve compact event, thread, id, resume, verify, and source-count signals.
- Surfaced compact summary counts and source breakouts in the Agent health hover's handoff-signal section.
- Live schema verification against `aawm_tristore.public.session_history` confirmed `is_compact_summary:boolean`, `compact_summary_source:text`, `compact_summary_id:text`, and `compact_summary_role:text`.
- Restarted `dashboard-shell-reports-dev`; live API probe returned `cacheStatus: miss`, `rowCount: 1`, provider `openai`, and compact fields including `agent_compact_summary_events: 431`, `agent_compact_summary_thread_count: 431`, `agent_compact_summary_id_count: 431`, `agent_compact_summary_resume_contexts: 1592`, and `agent_compact_summary_source_counts.codex: 431`.
- Fixed a pre-existing stray brace in `src/features/dashboard/lib/usage-report-display.ts` that blocked the ledger component test import.

Verification:
- `node --check server/report-service.mjs` passed.
- `pnpm exec vitest run src/features/dashboard/lib/agent-quality.test.ts src/features/dashboard/lib/report-service-query-builders.test.ts src/features/dashboard/components/master-ledger-table.test.tsx` passed: 3 files, 57 tests.
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec eslint server/report-service.mjs src/features/dashboard/api/usage-report.ts src/features/dashboard/lib/agent-quality.ts src/features/dashboard/lib/agent-quality.test.ts src/features/dashboard/components/master-ledger-table.tsx src/features/dashboard/components/master-ledger-table.test.tsx src/features/dashboard/lib/report-service-query-builders.test.ts src/features/dashboard/lib/usage-report-display.ts` passed with 0 errors and 3 existing warnings.
- `pnpm exec prettier --check ... .analysis/todo.md .analysis/completed.md` passed.
- `git diff --check` passed.
- `docker compose -f docker-compose.dev.yml restart dashboard-shell-reports-dev` completed and `docker ps --filter name=dashboard-shell-reports-dev --format "{{.Names}} {{.Status}}"` reported healthy.

Follow-up:
- None for compact-summary surfacing.

### 2026-05-31 - D1-093 - Surface discovery-inventory and terminal-completion agent scores

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `.analysis/todo.md`
- `.analysis/completed-handoff/handoff-session-history-discovery-terminal-d1-163-164.md`
- `server/report-service.mjs`
- `src/features/dashboard/api/usage-report.ts`
- `src/features/dashboard/lib/agent-quality.ts`
- `src/features/dashboard/lib/agent-quality.test.ts`
- `src/features/dashboard/lib/report-service-query-builders.test.ts`
- `src/features/dashboard/components/master-ledger-table.tsx`
- `src/features/dashboard/components/master-ledger-table.test.tsx`
- `src/features/dashboard/lib/usage-report-display.ts`

Evidence:
- Archived the consumed discovery/terminal handoff under `.analysis/completed-handoff/`.
- Added report-service aggregates for `discovery_inventory_coverage_score`, `discovery_inventory_missing_count`, and `terminal_completion_score` using the same evaluated-count and failure-count pattern as existing pass-oriented agent scores.
- Preserved `NULL` score semantics: query tests assert discovery score aggregation does not coalesce unevaluated `NULL` to zero.
- Extended API flat row types and agent-quality normalization/combination with `discoveryInventoryCoverage`, `discoveryInventoryMissingCount`, and `terminalCompletion`.
- Updated Agent health scoring and hover rows to include discovery inventory and terminal completion as score families, plus concise handoff-signal rows for missing inventory and terminal failures.
- Existing reason-code rendering now covers the new `discovery_inventory_coverage`, `discovery_inventory_evidence`, and `terminal_completion` reason families through the generic top-reason renderer; component tests assert those reason labels appear.
- Live schema verification against `aawm_tristore.public.session_history` confirmed `discovery_inventory_coverage_score:double precision`, `discovery_inventory_missing_count:integer`, and `terminal_completion_score:double precision`.
- Restarted `dashboard-shell-reports-dev`; live API probe returned the new discovery and terminal fields on a usage row, including evaluated/possible/failure aliases and missing-count alias.
- Fixed a pre-existing stray brace in `src/features/dashboard/lib/usage-report-display.ts` that blocked the ledger component test import.

Verification:
- `node --check server/report-service.mjs` passed.
- `pnpm exec vitest run src/features/dashboard/lib/agent-quality.test.ts src/features/dashboard/lib/report-service-query-builders.test.ts src/features/dashboard/components/master-ledger-table.test.tsx` passed: 3 files, 57 tests.
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec eslint server/report-service.mjs src/features/dashboard/api/usage-report.ts src/features/dashboard/lib/agent-quality.ts src/features/dashboard/lib/agent-quality.test.ts src/features/dashboard/components/master-ledger-table.tsx src/features/dashboard/components/master-ledger-table.test.tsx src/features/dashboard/lib/report-service-query-builders.test.ts src/features/dashboard/lib/usage-report-display.ts` passed with 0 errors and 3 existing warnings.
- `pnpm exec prettier --check ... .analysis/todo.md .analysis/completed.md` passed.
- `git diff --check` passed.
- `docker compose -f docker-compose.dev.yml restart dashboard-shell-reports-dev` completed and `docker ps --filter name=dashboard-shell-reports-dev --format "{{.Names}} {{.Status}}"` reported healthy.

Follow-up:
- None for discovery-inventory and terminal-completion surfacing.

### 2026-05-31 - D1-090 - Clamp oversized Model Ledger score hover panels to the viewport

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `.analysis/todo.md`
- `src/features/dashboard/components/primitives/hover-tooltip.tsx`
- `src/features/dashboard/components/primitives/hover-tooltip.test.tsx`

Evidence:
- Added distinct queue items for the Model Ledger score-hover viewport issue and
  the future TREND `Versions` model-release overlay; only the hover issue was
  implemented in this pass.
- Updated the shared portalled `HoverTooltip` primitive to measure the rendered
  panel, clamp the visual top within the viewport, flip the default tooltip to
  the left when the right edge would overflow, and apply bounded height with
  internal vertical scrolling.
- Added JSDOM regression coverage with explicit viewport/layout stubs for
  bottom-overflow and right-edge default tooltip placement.
- Live browser verification on `http://127.0.0.1:3006/?verify=score-hover-clamp`
  hovered the last visible Model Ledger score indicator at the bottom of the
  viewport; the open Agent health tooltip reported `top: 921.375`,
  `bottom: 1192`, `viewportHeight: 1200`, `withinViewport: true`,
  `maxHeight: 1184px`, and `overflowY: auto`.
- Browser console verification reported 0 warnings and 0 errors.

Verification:
- `pnpm exec vitest run src/features/dashboard/components/primitives/hover-tooltip.test.tsx src/features/dashboard/components/master-ledger-table.test.tsx` passed: 2 files, 56 tests.
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec eslint src/features/dashboard/components/primitives/hover-tooltip.tsx src/features/dashboard/components/primitives/hover-tooltip.test.tsx` passed.
- `pnpm exec prettier --check src/features/dashboard/components/primitives/hover-tooltip.tsx src/features/dashboard/components/primitives/hover-tooltip.test.tsx .analysis/todo.md .analysis/completed.md` passed.
- `git diff --check` passed.
- `curl -sS -I http://127.0.0.1:3006/` returned `200 OK`.

Follow-up:
- D1-091 remains open for renaming the TREND lower lane to `Versions` and adding
  true model-release markers from an explicit release catalog/API payload.

### 2026-05-30 - D1-089 - Surface session-history agent quality and latency handoffs

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `.analysis/todo.md`
- `.analysis/completed-handoff/2026-05-30-litellm-agent-quality-score-handoff.md`
- `.analysis/completed-handoff/handoff-session-history-agent-quality-d1-166-168.md`
- `.analysis/completed-handoff/handoff-session-history-latency-ms-fields.md`
- `server/report-service.mjs`
- `src/features/dashboard/api/usage-report.ts`
- `src/features/dashboard/lib/agent-quality.ts`
- `src/features/dashboard/lib/report-service-query-builders.test.ts`
- `src/features/dashboard/components/master-ledger-table.tsx`
- `src/features/dashboard/components/master-ledger-table.test.tsx`
- `src/features/dashboard/components/phosphor-dashboard.tsx`

Evidence:
- Processed the three unarchived session-history handoffs and archived them under `.analysis/completed-handoff/`.
- Extended the usage report SQL/API with the LiteLLM `_ms` latency split fields, coverage counts, upstream/stream output-token throughput percentiles, and handoff-specific D1-166/D1-167/D1-168 agent-quality aggregates.
- Preserved `NULL` score semantics for unevaluated rows; pass-oriented ignored-path scores remain separate from incident-oriented baseline-deflection and sleep/wellness scores.
- Updated Model Ledger rows and repository drilldowns to carry latency split summaries and show them from the `p50ms`/`p95ms` hover, including coverage counts and throughput rows.
- Updated the Agent Score hover to surface ignored-path, baseline-deflection, sleep/wellness, gate-trigger/fix/rerun, pushback, repeated, and top-reason details.
- Widened `agent_score_reasons` extraction to include string arrays and object evidence payloads using bounded reason/code/evidence fields.
- Live schema verification against `aawm_tristore.public.session_history` confirmed all requested agent-quality and latency columns exist.
- Live report verification through `http://127.0.0.1:3006/api/shell/reports/usage?from=2026-05-29&to=2026-05-31&grain=day&group_by=provider,model,repository&limit=5&sort=period_end&cacheBust=handoff-20260530` returned `cacheStatus: miss` and rows containing the new latency and agent-quality fields.
- The two original `aawm-codex-agent-auto` workers hit 429; the redispatched workers returned unrelated edits. Main thread removed that drift, completed the implementation locally, closed the agents, and wrote required investigation notes under `/home/zepfu/projects/litellm/.analysis/`.

Verification:
- `node --check server/report-service.mjs` passed.
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec vitest run src/features/dashboard/lib/report-service-query-builders.test.ts src/features/dashboard/components/master-ledger-table.test.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx` passed: 3 files, 129 tests.
- `pnpm exec eslint server/report-service.mjs src/features/dashboard/api/usage-report.ts src/features/dashboard/lib/agent-quality.ts src/features/dashboard/lib/report-service-query-builders.test.ts src/features/dashboard/components/master-ledger-table.tsx src/features/dashboard/components/master-ledger-table.test.tsx src/features/dashboard/components/phosphor-dashboard.tsx` passed with 0 errors and 14 existing warnings.
- `git diff --check` passed.
- `pnpm run build` passed.
- `docker compose -f docker-compose.dev.yml restart dashboard-shell-reports-dev` completed and `dashboard-shell-reports-dev` became healthy before live API verification.

Follow-up:
- None for these handoffs.

### 2026-05-26 - D1-085 - Alternating day bands for Trend charts

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `.analysis/todo.md`
- `src/features/dashboard/components/token-trend-chart.tsx`
- `src/features/dashboard/components/token-trend-chart.test.tsx`
- `src/styles/index.css`

Evidence:
- Added a shared non-interactive `.tt-day-stripe-layer` background behind the TREND hourly token chart and behind the lower TUI, Request, and Tool lanes.
- Day bands alternate subtle grey levels and sit at `z-index: 0`, while existing day hover shells, version families, metric day shells, and scale markers stay above the background layer.
- Regression coverage asserts the upper token chart renders alternating stripes, the active-version lane includes aligned stripes, and Request/Tool lower lanes include matching day stripes.
- Playwright live DOM verification on `http://127.0.0.1:3006/?verify=trend-day-stripes` showed 31 stripes in the top chart, 31 in TUI, 31 in Request, 31 in Tool, and alternating `is-even` / `is-odd` classes; browser console reported 0 warnings/errors.

Verification:
- `pnpm exec vitest run src/features/dashboard/components/token-trend-chart.test.tsx` passed: 1 file, 26 tests.
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec eslint src/features/dashboard/components/token-trend-chart.tsx src/features/dashboard/components/token-trend-chart.test.tsx src/styles/index.css` passed with 0 errors and the existing direct-CSS-target ignored-file warning.
- `pnpm exec prettier --check src/features/dashboard/components/token-trend-chart.tsx src/features/dashboard/components/token-trend-chart.test.tsx src/styles/index.css .analysis/todo.md` passed.
- `git diff --check` passed.
- `pnpm run build` passed.
- `curl -sS -I http://127.0.0.1:3006/` returned `200 OK`, and `docker ps --filter name=dashboard-shell` showed `dashboard-shell-dev` and `dashboard-shell-reports-dev` healthy.

Follow-up:
- D1-082 remains open for making Force Refresh non-blocking on heavy report surfaces.

### 2026-05-23 - D1-064 - Refresh controls, Eastern timezone audit, and ledger visual cleanup

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `.analysis/todo.md`
- `server/report-service.mjs`
- `src/features/dashboard/index.test.tsx`
- `src/features/dashboard/index.tsx`
- `src/features/dashboard/components/a11y.test.tsx`
- `src/features/dashboard/components/comparison-panel.test.tsx`
- `src/features/dashboard/components/date-controls.test.tsx`
- `src/features/dashboard/components/date-controls.tsx`
- `src/features/dashboard/components/master-ledger-table.test.tsx`
- `src/features/dashboard/components/master-ledger-table.tsx`
- `src/features/dashboard/components/phosphor-dashboard-tip-window.test.ts`
- `src/features/dashboard/components/phosphor-dashboard.test.tsx`
- `src/features/dashboard/components/phosphor-dashboard.tsx`
- `src/features/dashboard/lib/usage-report-display.test.ts`
- `src/features/dashboard/lib/usage-report-display.ts`
- `src/styles/index.css`

Evidence:
- Removed the low-value Model Ledger `$ /1k`, `$ /1k In`, and `$ /1k Out` columns and the corresponding row data. Added regression coverage that asserts those headers stay absent.
- Added refresh buttons to Provider Health Summary, Token Trend, Model Ledger, Repository Breakdown, and Provider Comparison. Manual refresh and React Query background refetch both drive the same visible `Updating` state.
- Audited General dashboard date handling: main usage totals, KPI totals, model/repo rows, tool activity, and token trend day/hour/version data were already Eastern-scoped server-side; fixed frontend default ranges, standalone fallback ranges, DateControls validation/order checks, provider health window bounds, provider error observation bounds, Errors KPI filtering, health event time display, quota interval labels, and cache-prewarm windows to use `America/New_York` calendar semantics where appropriate.
- Moved Token Trend above the Model Ledger / Repository Breakdown row in the DOM so the dashboard order is consistently Status -> Tokens -> Models/Repos, not breakpoint-dependent.
- Replaced Model Ledger's severity-looking shared microbar gradient with neutral volume bars and a separate cost-only warm gradient, with a minimum nonzero bar width.
- Subagent visual review recommended keeping Model Ledger / Repository Breakdown as lower drilldown tables and eventually adding dedicated Model/Repository Explorer surfaces with presets; no explorer surface was added in this pass.

Verification:
- Read-only subagents completed the timezone audit and visual ledger review; QA subagent found the unstable React Query dependency issue, which was fixed before final verification.
- `node --check server/report-service.mjs` passed.
- `pnpm exec tsc -b --pretty false` passed.
- `./node_modules/.bin/vitest run src/features/dashboard/lib/usage-report-display.test.ts src/features/dashboard/components/date-controls.test.tsx src/features/dashboard/components/master-ledger-table.test.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx src/features/dashboard/components/a11y.test.tsx src/features/dashboard/components/comparison-panel.test.tsx src/features/dashboard/index.test.tsx` passed: 7 files, 247 tests.
- `pnpm run lint` passed with 0 errors and the existing 24-warning baseline.
- `pnpm test` passed: 35 files, 480 tests.
- `pnpm run build` passed.
- `git diff --check` passed.
- Final rerun after stabilizing `src/features/dashboard/index.test.tsx` loading assertions: `./node_modules/.bin/vitest run src/features/dashboard/index.test.tsx` passed: 1 file, 2 tests; `pnpm test` passed: 35 files, 480 tests; `pnpm exec tsc -b --pretty false`, `pnpm run lint`, `pnpm run build`, and `git diff --check` passed.
- Dev runtime restarted with `docker compose -f docker-compose.dev.yml restart dashboard-shell-reports-dev dashboard-shell-dev`; both `dashboard-shell-dev` and `dashboard-shell-reports-dev` reported healthy.
- Browser verification on `http://127.0.0.1:3006/`: Model Ledger headers did not include `$ /1k`; section order was `status`, `tokens`, `models`, `repos`; all five refresh buttons rendered; a delayed manual refresh showed all affected buttons as disabled `Updating` with spinning icons and returned to `Refresh`; Model Ledger microbars rendered `microbar-volume` or `microbar-cost`; console reported 0 warnings/errors.
- Live API Eastern-boundary check for `from=2026-05-22&to=2026-05-23` returned metadata date strings unchanged, `summary.period_start: 2026-05-22T04:00:10.343Z`, oldest health bucket `2026-05-22T04:00:00.000Z`, and newest health bucket `2026-05-23T02:10:00.000Z`, matching Eastern midnight during DST.

Follow-up:
- The Token Trend summary query can show aborted requests in the dev network panel during React/Vite remounts, but recovered with `200` and no console warnings/errors in browser verification.
- A later dashboard IA pass should decide whether Model Ledger and Repository Breakdown become full-width detail sections or move behind dedicated explorer views.

### 2026-05-26 - D1-084 - Align top shortcut navigation with Status, Trend, and Ledger tabs

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `.analysis/todo.md`
- `src/features/dashboard/components/anchor-bar.tsx`
- `src/features/dashboard/components/anchor-bar.test.tsx`
- `src/features/dashboard/components/date-controls.tsx`
- `src/features/dashboard/components/phosphor-dashboard.tsx`
- `src/features/dashboard/components/slicer-bar.tsx`
- `src/features/dashboard/components/token-trend-chart.tsx`
- `src/features/dashboard/components/token-trend-chart.test.tsx`
- `src/features/dashboard/index.tsx`
- `src/features/dashboard/index.test.tsx`

Evidence:
- The top shortcut strip now displays `[S]tatus`, `[H]ealth`, `[Q]uota`, `[T]rend`, `T[U]I`, `[R]equest`, `T[O]ol`, `[L]edger`, `[M]odel`, `R[E]pository`, `[F]ilter`, and `[D]ate`.
- Shortcut activation is route-controlled: Status shortcuts scroll to `#status` and switch Health/Quota tabs, Trend shortcuts scroll to `#tokens` and switch TUI/Request/Tool lanes, Ledger shortcuts scroll to `#models` and switch Model/Repository tabs, and `F`/`D` focus the first filter/date controls.
- `PhosphorDashboard` and `TokenTrendChart` now support controlled tab/lane props while preserving internal fallback state for isolated renders.
- Playwright verification against `http://127.0.0.1:3006/?verify=shortcut-nav` confirmed the new shortcut labels and keyboard behavior: Q -> Quota, H -> Health, R -> Request, O -> Tool, U -> TUI, E -> Repository, M -> Model, F -> first filter, D -> first date. Browser console check reported 0 errors/warnings.

Verification:
- `pnpm exec vitest run src/features/dashboard/components/anchor-bar.test.tsx src/features/dashboard/components/token-trend-chart.test.tsx src/features/dashboard/index.test.tsx` passed: 3 files, 37 tests.
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec eslint src/features/dashboard/components/anchor-bar.tsx src/features/dashboard/components/anchor-bar.test.tsx src/features/dashboard/index.tsx src/features/dashboard/index.test.tsx src/features/dashboard/components/phosphor-dashboard.tsx src/features/dashboard/components/token-trend-chart.tsx src/features/dashboard/components/token-trend-chart.test.tsx src/features/dashboard/components/slicer-bar.tsx src/features/dashboard/components/date-controls.tsx` passed with existing Fast Refresh warnings in `phosphor-dashboard.tsx` and 0 errors.
- `pnpm exec prettier --check src/features/dashboard/components/anchor-bar.tsx src/features/dashboard/components/anchor-bar.test.tsx src/features/dashboard/index.tsx src/features/dashboard/index.test.tsx src/features/dashboard/components/phosphor-dashboard.tsx src/features/dashboard/components/token-trend-chart.tsx src/features/dashboard/components/token-trend-chart.test.tsx src/features/dashboard/components/slicer-bar.tsx src/features/dashboard/components/date-controls.tsx .analysis/todo.md` passed.
- `git diff --check` passed.
- `pnpm run build` passed.

Follow-up:
- D1-082 remains open for the slow Force Refresh path; this shortcut pass did not change refresh behavior.

### 2026-05-25 - D1-078 - PROVIDERS Health/Quota tabs

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `.analysis/todo.md`
- `docker-compose.dev.yml`
- `docker-compose.yml`
- `server/report-service.mjs`
- `src/features/dashboard/api/usage-report.ts`
- `src/features/dashboard/components/phosphor-dashboard.test.tsx`
- `src/features/dashboard/components/phosphor-dashboard.tsx`
- `src/features/dashboard/lib/report-service-query-builders.test.ts`
- `src/styles/index.css`

Evidence:
- Renamed the provider section to `PROVIDERS` and added `Health` / `Quota` section tabs. `Health` keeps the existing provider-card layout; `Quota` renders compact provider buckets with internally scrollable static quota-history bars.
- Added a separate range-aware `quotaRangeHistory` report payload so the Quota tab follows the dashboard date filter without changing the cadence-based `quotaHistory` used by Provider Status health cards.
- Bumped the report cache version to `v12` in both compose files and the code default because the live report container was still overriding the code default with `SHELL_REPORT_CACHE_VERSION=v10`, which returned stale Redis payloads without `quotaRangeHistory`.
- Live API verification after recreating `dashboard-shell-reports-dev`: `/api/shell/reports/usage?from=2026-04-25&to=2026-05-26&grain=day&group_by=provider%2Cmodel%2Crepository&limit=50000&sort=period_end` returned `cacheStatus: miss`, `quotaRangeHistory: 323`, and first quota provider `anthropic`.
- Browser verification on `http://127.0.0.1:3006/?verify=d1-v12-final`: desktop Health tab rendered 8 provider cards; Quota tab rendered 7 provider buckets and 323 quota rows with 0 detected animation/sweep elements; wide layout at `3840x1600` rendered 7 provider quota buckets and 323 rows.

Verification:
- `node --check server/report-service.mjs` passed.
- `pnpm exec vitest run src/features/dashboard/lib/report-service-query-builders.test.ts src/features/dashboard/lib/trend-utils.test.ts src/features/dashboard/components/token-trend-chart.test.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx` passed: 4 files, 109 tests.
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec eslint server/report-service.mjs src/features/dashboard/api/usage-report.ts src/features/dashboard/lib/trend-utils.ts src/features/dashboard/lib/trend-utils.test.ts src/features/dashboard/lib/report-service-query-builders.test.ts src/features/dashboard/components/token-trend-chart.tsx src/features/dashboard/components/token-trend-chart.test.tsx src/features/dashboard/components/phosphor-dashboard.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx src/styles/index.css` passed with 0 errors and the existing Fast Refresh / ignored CSS warnings.
- `pnpm run build` passed.
- `git diff --check` passed.
- `docker compose -f docker-compose.dev.yml up -d --force-recreate dashboard-shell-reports-dev` completed, and `dashboard-shell-reports-dev` reported healthy with `SHELL_REPORT_CACHE_VERSION=v12`.
- Browser console verification after a fresh reload reported 0 current warnings/errors.

Follow-up:
- The cold 30-day usage report remains expensive because the existing full report still includes broad tool-activity and trend queries. The new Quota tab data path was verified, but overall cold-cache latency may still deserve a separate performance item if it becomes operator-visible.

### 2026-05-25 - D1-079 - TREND TUI/Request/Tool lower lanes

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `.analysis/todo.md`
- `server/report-service.mjs`
- `src/features/dashboard/api/usage-report.ts`
- `src/features/dashboard/components/phosphor-dashboard.tsx`
- `src/features/dashboard/components/token-trend-chart.test.tsx`
- `src/features/dashboard/components/token-trend-chart.tsx`
- `src/features/dashboard/lib/report-service-query-builders.test.ts`
- `src/features/dashboard/lib/trend-utils.test.ts`
- `src/features/dashboard/lib/trend-utils.ts`
- `src/styles/index.css`

Evidence:
- Renamed the token trend section to `TREND` and added lower-lane tabs for `TUI`, `Request`, and `Tool`.
- Kept the TUI active-version lane as the default and added metric-specific lower-lane envelopes for hourly request counts from `traces` and tool-call counts from `tool_call_count`.
- Added `tool_calls` to the token-trend hourly summary API/type path and metric-specific envelope generation so the Tool lane is available at page load without hover-triggered day detail.
- Live trend summary verification after recreating `dashboard-shell-reports-dev`: `/api/shell/reports/usage/token-trend-summary?from=2026-04-25&to=2026-05-26` returned `cacheStatus: miss`, 1,631 hourly rows, and 1,121 rows with positive `tool_calls`; sample bucket `2026-04-25 00:00 anthropic` had `tool_calls: 332`.
- Browser verification on `http://127.0.0.1:3006/?verify=d1-v12-final`: `TREND` rendered; TUI lane rendered 1 active-version lane with 4 active tracks; Request rendered 31 day shells, 744 hour bars, and 1,631 provider slices; Tool rendered 31 day shells, 744 hour bars, and 1,121 provider slices.

Verification:
- `node --check server/report-service.mjs` passed.
- `pnpm exec vitest run src/features/dashboard/lib/report-service-query-builders.test.ts src/features/dashboard/lib/trend-utils.test.ts src/features/dashboard/components/token-trend-chart.test.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx` passed: 4 files, 109 tests.
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec eslint server/report-service.mjs src/features/dashboard/api/usage-report.ts src/features/dashboard/lib/trend-utils.ts src/features/dashboard/lib/trend-utils.test.ts src/features/dashboard/lib/report-service-query-builders.test.ts src/features/dashboard/components/token-trend-chart.tsx src/features/dashboard/components/token-trend-chart.test.tsx src/features/dashboard/components/phosphor-dashboard.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx src/styles/index.css` passed with 0 errors and the existing Fast Refresh / ignored CSS warnings.
- `pnpm run build` passed.
- `git diff --check` passed.
- Browser console verification after a fresh reload reported 0 current warnings/errors.

Follow-up:
- None for D1-079.

### 2026-05-25 - D1-080 - Inline dashboard tabs and trend detail sizing

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `.analysis/todo.md`
- `src/features/dashboard/components/master-ledger-table.tsx`
- `src/features/dashboard/components/phosphor-dashboard.test.tsx`
- `src/features/dashboard/components/phosphor-dashboard.tsx`
- `src/features/dashboard/components/token-trend-chart.test.tsx`
- `src/features/dashboard/components/token-trend-chart.tsx`
- `src/styles/index.css`

Evidence:
- `SectionTitle` now accepts heading-adjacent tab controls, and `PROVIDERS` plus `LEDGER` render their view tabs inline beside the section headings with the same heading-sized tab typography.
- `MasterLedgerTable` supports a controlled `ledgerView` so the dashboard can own the `Model` / `Repository` tab strip in the `LEDGER` heading while preserving an internal fallback tab strip for standalone table usage.
- The TREND lower-lane `TUI` / `Request` / `Tool` tabs remain below the token chart, and each lower lane uses the same pixel height as the top token chart.
- The trend provider/version legend moved into a bottom-right footer so it does not sit between the lower-lane tabs and the selected lower chart.

Verification:
- `pnpm exec vitest run src/features/dashboard/components/token-trend-chart.test.tsx src/features/dashboard/components/master-ledger-table.test.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx` passed: 3 files, 143 tests.
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec prettier --check src/features/dashboard/components/phosphor-dashboard.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx src/features/dashboard/components/master-ledger-table.tsx src/features/dashboard/components/master-ledger-table.test.tsx src/features/dashboard/components/token-trend-chart.tsx src/features/dashboard/components/token-trend-chart.test.tsx src/styles/index.css` passed.
- `pnpm exec eslint src/features/dashboard/components/phosphor-dashboard.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx src/features/dashboard/components/master-ledger-table.tsx src/features/dashboard/components/master-ledger-table.test.tsx src/features/dashboard/components/token-trend-chart.tsx src/features/dashboard/components/token-trend-chart.test.tsx` passed with 0 errors and the existing Fast Refresh / React Compiler warning baseline.
- `pnpm run build` passed.
- `git diff --check` passed.
- `curl -sS -I http://127.0.0.1:3006/` returned `200 OK`, and `docker ps --filter name=dashboard-shell` showed `dashboard-shell-dev` and `dashboard-shell-reports-dev` healthy.
- Playwright at `1920x1080` confirmed `PROVIDERS` and `LEDGER` title rows contain inline tab strips, TREND has no heading-level tab strip, the lower trend tab strip starts below the top token chart, the selected `TUI`, `Request`, and `Tool` lanes each match the top chart height at `224px`, and the trend legend is right-aligned in the footer.

Follow-up:
- None.

### 2026-05-23 - D1-065 - OpenRouter request quota lookup

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `server/report-service.mjs`

Evidence:
- Updated the usage report `requests` lateral join so OpenRouter `:free` session models can match the provider-level `public.rate_limit_intervals` request quota row instead of requiring exact model equality.
- Live DB verification against `postgresql://aawm@127.0.0.1:5434/aawm_tristore` showed the old strict predicate matched `0` OpenRouter free sessions, while the updated predicate matched `8` currently interval-covered sessions out of `279`.

Verification:
- `node --check server/report-service.mjs` passed.
- Live probe: strict request join vs updated join returned `0|8|279`.

Follow-up:
- Remaining unmatched OpenRouter free sessions appear outside the currently materialized request interval windows; reopen if a current free request with an active interval still does not show request quota state.

### 2026-05-23 - D1-066 - OpenRouter quota lane and cache refresh

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `server/report-service.mjs`
- `src/features/dashboard/components/phosphor-dashboard.test.tsx`
- `src/features/dashboard/components/phosphor-dashboard.tsx`

Evidence:
- Added OpenRouter to the lane-based Provider Status quota renderer as `Free Requests · 24h`, using the existing current-plus-prior reset lane layout instead of the old flat fallback path.
- Swapped OpenRouter ahead of NVIDIA in the canonical Provider Health Summary card order.
- Treated non-xAI `requests` quotas as 24-hour cadence for quota velocity/history fallback, so OpenRouter request rows do not inherit the 5-hour `short` fallback.
- Bumped the report cache version from `v7` to `v8` to prevent Redis stale entries from hiding newly backfilled Token Trend rows after service restart.

Verification:
- `node --check server/report-service.mjs` passed.
- `pnpm exec vitest run src/features/dashboard/components/phosphor-dashboard.test.tsx` passed: 1 file, 74 tests.
- `pnpm exec eslint server/report-service.mjs src/features/dashboard/components/phosphor-dashboard.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx` passed with 0 errors and the existing fast-refresh test-export warnings.
- `pnpm exec tsc -b --pretty false` passed.
- `git diff --check` passed.
- Restarted `dashboard-shell-reports-dev` and `dashboard-shell-dev`; both reported healthy.
- Live API after restart: `/api/shell/reports/quotas` returned an active OpenRouter short/request quota row with `short_remaining_pct: 99.6`, reset `2026-05-24T00:00:00.000Z`, and `short_velocity_sample_count: 7`.
- Live API after restart: `/api/shell/reports/usage/token-trend-summary?from=2026-05-22&to=2026-05-24...` returned `cacheStatus: miss` and populated May 22 / May 23 hourly rows.
- Browser verification on `http://127.0.0.1:3006/`: Provider cards rendered in order `Anthropic, OpenAI, Google, xAI, OpenRouter, NVIDIA_NIM, Local`; the OpenRouter card displayed `Free Requests · 24h`.

Follow-up:
- OpenRouter prior reset bars will appear after `public.rate_limit_intervals` contains older distinct OpenRouter `expected_reset_at` windows; the live DB currently only has the `2026-05-24T00:00:00Z` reset target for OpenRouter.

### 2026-05-22 - D1-021 - Right-size Token Trend version timeline placement and visibility

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `.analysis/todo.md`
- `src/features/dashboard/components/phosphor-dashboard.test.tsx`
- `src/features/dashboard/components/phosphor-dashboard.tsx`
- `src/features/dashboard/components/token-trend-chart.test.tsx`
- `src/features/dashboard/components/token-trend-chart.tsx`

Evidence:
- Moved Token Trend below the Model Ledger / Repository Breakdown row so the dense version timeline gets a full-width reading area after the tabular summaries.
- Increased day-envelope chart height to `248px` for dense ranges of 21+ days and `208px` for shorter day-envelope ranges.
- Reduced hourly bar opacity to `0.66` and strengthened version paths with a `5px` card-colored halo plus a `2px` foreground stroke at `0.96` opacity. Release dots keep a thicker card-colored stroke.
- Preserved full-column day hover and lazy day-detail fetch behavior from D1-020.

Verification:
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec vitest run src/features/dashboard/components/token-trend-chart.test.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx src/features/dashboard/lib/trend-utils.test.ts` passed: 3 files, 95 tests.
- `git diff --check` passed.
- `pnpm run lint` passed with 0 errors and the existing 24-warning baseline.
- `pnpm run build` passed.
- Browser verification on `http://127.0.0.1:3006/?d1_021=visual`: `#models` and `#repos` both precede `#tokens`; Token Trend section is full width below the ledger/repo row; `.tt-day-chart` measured `248px`; `.tt-day-strip` and `.tt-version-overlay` measured `230px`; SVG `overflow` was `hidden`; bars had opacity `0.66`; version lines had `stroke-width=2` / `stroke-opacity=0.96`; halos had `stroke-width=5` / `stroke-opacity=0.86`; browser console showed 0 current errors.

Follow-up:
- None.

### 2026-05-22 - D1-020 - Clip Token Trend version overlay and make day hover full-column

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `src/features/dashboard/components/phosphor-dashboard.test.tsx`
- `src/features/dashboard/components/token-trend-chart.test.tsx`
- `src/features/dashboard/components/token-trend-chart.tsx`

Evidence:
- Fixed the Token Trend version SVG overlay so it explicitly fills the chart strip (`width:100%`, `height:100%`) and clips overflow instead of using intrinsic SVG sizing that could bleed into Model Ledger / Repository Breakdown.
- Moved Token Trend tooltip ownership from individual hourly bars to one full-height day hover shell per day, so hovering empty space above the hourly bars still opens the day tooltip and starts the lazy day-detail fetch.
- Day tooltips now summarize provider totals for the whole day, list release rows for that day first, and fall back to aggregated active client/version detail when no releases are present.

Verification:
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec vitest run src/features/dashboard/components/token-trend-chart.test.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx src/features/dashboard/lib/trend-utils.test.ts` passed: 3 files, 93 tests.
- `git diff --check` passed.
- `pnpm run lint` passed with 0 errors and the existing 24-warning baseline.
- Browser verification on `http://127.0.0.1:3006/?layout_bug=token_trend_after_patch`: `.tt-version-overlay` and `.tt-day-strip` both measured `94px` tall with `overflowDelta: 0`; Model Ledger started below the token section; the chart rendered `31` day hover wrappers, `0` hourly tooltip wrappers, `744` hourly bars, and `364` release dots.
- Browser hover probe over the empty/top area of the `2026-04-22` day column opened the day tooltip and triggered `/api/shell/reports/usage/token-trend-day?from=2026-04-22&to=2026-05-23&date=2026-04-22` with `200`.

Follow-up:
- None.

### 2026-05-22 - D1-019 - Token Trend hourly day envelopes with lazy client-version details

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `.analysis/todo.md`
- `server/report-service.mjs`
- `src/features/dashboard/api/usage-report.ts`
- `src/features/dashboard/api/usage-report.test.ts`
- `src/features/dashboard/components/phosphor-dashboard.test.tsx`
- `src/features/dashboard/components/phosphor-dashboard.tsx`
- `src/features/dashboard/components/token-trend-chart.test.tsx`
- `src/features/dashboard/components/token-trend-chart.tsx`
- `src/features/dashboard/index.test.tsx`
- `src/features/dashboard/lib/trend-utils.test.ts`
- `src/features/dashboard/lib/trend-utils.ts`

Evidence:
- Added separate cached Token Trend report endpoints so the main `/api/shell/reports/usage` remains daily/window-oriented for Model Ledger, Repo Breakdown, and Client Usage:
  - `/api/shell/reports/usage/token-trend-summary` returns hourly provider totals plus sparse client-version interval metadata.
  - `/api/shell/reports/usage/token-trend-day?date=YYYY-MM-DD` returns day-scoped client/version rows for hover detail.
- Wired the dashboard to fetch the lightweight token-trend summary on page load and debounce lazy day-detail requests on chart hover; React Query keys include date/filter scope, use request abort signals, and cache same-day movement.
- Reworked `TokenTrendChart` to render day envelopes scaled by daily total, 24 hourly provider-stacked slices per day, provider-colored client-version release dots and continuation lines, and release-first/active-version hover content.
- Added focused unit coverage for API fetch helpers, day-envelope bucketing, scaled version-track overlay coordinates, lazy detail query/cache behavior, and chart render/hover structure.

Verification:
- `node --check server/report-service.mjs` passed.
- `git diff --check` passed.
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec vitest run src/features/dashboard/api/usage-report.test.ts src/features/dashboard/components/phosphor-dashboard.test.tsx src/features/dashboard/index.test.tsx src/features/dashboard/components/token-trend-chart.test.tsx src/features/dashboard/lib/trend-utils.test.ts` passed: 5 files, 98 tests.
- `pnpm run lint` passed with 0 errors and the existing warning baseline.
- `pnpm run build` passed.
- Static runtime rebuild: `docker compose -f docker-compose.yml up -d --build dashboard-shell-reports dashboard-shell`.
- Main 30-day usage probe returned `200` with `cacheScope: usage`, `rows: 1001`, and no `tokenTrendHours` payload, confirming hourly data was not folded into the main report.
- Summary endpoint probe for `2026-04-22` through `2026-05-23` returned `200` with `hours: 1539`, `days: 31`, `versions: 369`, and `cacheScope: usage-token-trend-summary`.
- Day detail endpoint probe returned `200` for `date=2026-05-22` with client/version rows including `claude-cli 2.1.148`.
- Browser runtime on `http://127.0.0.1:3005/?d1_019=final` rendered `31` day envelopes, `744` hourly bars, `364` release dots, and `393` version lines; the summary request returned `200`; synthetic hover fetched exactly one day-detail request for `date=2026-04-22` and repeated same-day hover did not refetch. Browser console reported 0 errors. Screenshot evidence saved under `.analysis/screenshots/d1-019-token-trend-hourly.png`.

Follow-up:
- Version continuation lines use lightweight first/last-seen interval metadata at page load and break only across provider-usage gaps; fully exact version-hour continuity would require heavier per-version hour data in a later iteration.

### 2026-05-22 - D1-063 - Make burn legend colors distinct from quota colors

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `.analysis/todo.md`
- `src/styles/index.css`

Evidence:
- Updated the Provider Health Summary legend's burn velocity swatches to use a separate velocity palette (`slow` slate, `steady` indigo, `fast` violet, `hot` magenta, `peak` rose) instead of reusing quota-used blue/teal/amber/red bands.
- Added a static diagonal sheen marker to burn swatches so they read as velocity/animation indicators rather than consumed-quota bands.

Verification:
- `./node_modules/.bin/vitest run src/features/dashboard/components/phosphor-dashboard.test.tsx` passed: 1 file, 61 tests.
- `npm run lint` passed with the existing 23-warning baseline and 0 errors.
- `npm run build` passed.
- `git diff --check` passed.
- Static runtime deployment: `docker compose -f docker-compose.yml up -d --build --no-deps dashboard-shell`; `docker ps --filter name=dashboard-shell-dashboard-shell-1` reported `Up ... (healthy)` on host port `3005`; `curl -sS -i http://127.0.0.1:3005/api/shell/health` returned `200` with `{"ok":true,"databaseConfigured":true,"redisConfigured":true,"redisReady":true}`.
- Browser verification on `http://127.0.0.1:3005/?legend_burn=1` found 15 legend items, no heading overlap, no right overflow, no background-color overlap between quota and burn swatches, and a static `::after` sheen gradient on all five burn swatches.

Follow-up:
- None.

### 2026-05-22 - D1-062 - Add Provider Health Summary color legend

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `.analysis/todo.md`
- `src/features/dashboard/components/phosphor-dashboard.test.tsx`
- `src/features/dashboard/components/phosphor-dashboard.tsx`
- `src/styles/index.css`

Evidence:
- Added a compact `ProviderStatusLegend` beside the `Provider Health Summary` section header. It decodes health strip colors (`ok`, `degraded`, `down`, `no data`, `miss`), quota consumed-percent bands (`0-5`, `5-10`, `10-25`, `25-50`, `50+`), and burn velocity tiers (`slow`, `steady`, `fast`, `hot`, `peak`).
- Updated `SectionTitle` to support an optional right-side accessory while preserving the existing standalone title rendering for other sections.
- Added responsive header/legend CSS so the legend wraps next to the header and stacks below it on narrow viewports.

Verification:
- `./node_modules/.bin/vitest run src/features/dashboard/components/phosphor-dashboard.test.tsx` passed: 1 file, 61 tests.
- `npm run lint` passed with the existing 23-warning baseline and 0 errors.
- `npm run build` passed.
- `git diff --check` passed.
- Static runtime deployment: `docker compose -f docker-compose.yml up -d --build --no-deps dashboard-shell`; `docker ps --filter name=dashboard-shell-dashboard-shell-1` reported `Up ... (healthy)` on host port `3005`; `curl -sS -i http://127.0.0.1:3005/api/shell/health` returned `200` with `{"ok":true,"databaseConfigured":true,"redisConfigured":true,"redisReady":true}`.
- Browser verification on `http://127.0.0.1:3005/?legend=1` found the `Provider health and quota color legend` with 15 items and no heading overlap or viewport overflow at `1600x900` and `1024x768`. At `390x844`, the legend stacked under the heading without heading overlap; the page's existing mobile shell layout still reports horizontal scroll independent of this legend.

Follow-up:
- None.

### 2026-05-22 - D1-061 - Replace per-segment quota shimmer with bar-level masked overlay

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `.analysis/todo.md`
- `src/features/dashboard/components/primitives/quota-interval-bar.module.css`
- `src/features/dashboard/components/primitives/quota-interval-bar.test.tsx`
- `src/features/dashboard/components/primitives/quota-interval-bar.tsx`
- `src/features/dashboard/components/provider-card.test.tsx`
- `src/styles/index.css`

Evidence:
- Replaced per-segment `fast`/`hot`/`peak` pseudo-element shimmer with one `.quota-row-velocity-overlay` per animated quota bar. The overlay gets a generated CSS mask from merged high-velocity runs, contains a single `.quota-row-velocity-sweep`, and leaves static velocity tier filters on the quota segments.
- Projection ticks now render above the masked overlay, the overlay uses `pointer-events: none`, and reduced-motion mode keeps the sweep static.
- Focused regression tests cover single-overlay rendering, mask stops for high-velocity runs, no overlay for slow/steady-only bars, projection tick layering, and provider prior-bar sweep rendering.

Verification:
- `./node_modules/.bin/vitest run src/features/dashboard/components/primitives/quota-interval-bar.test.tsx src/features/dashboard/components/provider-card.test.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx` passed: 3 files, 102 tests.
- `npm run lint` passed with the existing 23-warning baseline and 0 errors.
- `npm run build` passed.
- `git diff --check` passed.
- Static runtime deployment: `docker compose -f docker-compose.yml up -d --build --no-deps dashboard-shell`; `docker ps --filter name=dashboard-shell-dashboard-shell-1` reported `Up ... (healthy)` on host port `3005`; `curl -sS -i http://127.0.0.1:3005/api/shell/health` returned `200` with `{"ok":true,"databaseConfigured":true,"redisConfigured":true,"redisReady":true}`.
- Static browser verification on `http://127.0.0.1:3005/?d1_061=final`: 423 `.quota-interval` nodes, 253 `.quota-interval.high-velocity` nodes, 19 `.quota-row-velocity-overlay` nodes, 19 `.quota-row-velocity-sweep` nodes, `animationNames` included `quota-velocity-overlay-sweep: 19`, and `pseudoAnimatedCount: 0`.
- CPU evidence on the same Playwright Chrome profile: original per-segment pseudo-element baseline was about `229.6%` aggregate Chrome CPU over 20 seconds; the first masked background-position overlay attempt measured `62.9%`; the committed stepped-transform overlay measured `22.4%` after the rebuilt static deployment.

Follow-up:
- The headless Playwright sample uses SwiftShader and can exaggerate renderer/GPU CPU, but the before/after ratio confirms the dashboard no longer pays hundreds of independently animated segment costs.

### 2026-05-22 - D1-060 - Make AAWM dashboard consume shell-published API base

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `.analysis/todo.md`
- `../aawm-dashboard/src/client/apiBase.ts`
- `../aawm-dashboard/src/client/apiBase.test.ts`
- `../aawm-dashboard/src/vite-env.d.ts`

Evidence:
- Updated `../aawm-dashboard/src/client/apiBase.ts` so the shared `BASE_URL` source of truth resolves `window.__DASHBOARD_SHELL_REMOTES__['aawm-dashboard'].apiBase` first, then `VITE_API_URL`, then `/api/aawm`.
- Added the shell runtime config window type in `../aawm-dashboard/src/vite-env.d.ts`.
- Added `../aawm-dashboard/src/client/apiBase.test.ts` coverage for shell-over-env precedence, env/default fallback, `apiUrl()` absolute URL resolution in jsdom, and generated-client singleton configuration from the shell-published runtime API base.

Verification:
- `npm test -- --run src/client/apiBase.test.ts` in `../aawm-dashboard` passed: 1 file, 3 tests. The first sandboxed run also passed assertions but exited nonzero only because Vitest could not write `node_modules/.vite/vitest/results.json`; rerun with normal cache access exited 0.
- `npm run typecheck` in `../aawm-dashboard` passed.
- `npm run lint` in `../aawm-dashboard` passed with the existing 2-warning `src/standalone.tsx` fast-refresh baseline and 0 errors.
- `npm run build` in `../aawm-dashboard` passed.
- Static runtime rebuild: `docker compose -f docker-compose.yml up -d --build aawm-dashboard` rebuilt `aawm-dashboard-remote:local`; `docker compose -f docker-compose.yml ps aawm-dashboard dashboard-shell` reported both services healthy.
- Static and dev AAWM health probes returned `200` through the shell boundary for `http://127.0.0.1:3005/api/aawm/api/v1/health` and `http://127.0.0.1:3006/api/aawm/api/v1/health`.
- Static browser smoke for `http://127.0.0.1:3005/aawm` rendered the AAWM remote and loaded rebuilt assets from `/modules/aawm/*`; browser API traffic stayed under `/api/aawm/api/v1/*` with expected `401 Unauthorized` responses, and `window.__DASHBOARD_SHELL_REMOTES__['aawm-dashboard']` contained `{apiBase:'/api/aawm', basePath:'/aawm', moduleId:'aawm-dashboard'}`.
- Dev browser smoke for `http://127.0.0.1:3006/aawm` rendered the AAWM remote and loaded live source from `http://localhost:5176`; browser API traffic stayed under `/api/aawm/api/v1/*` with expected `401 Unauthorized` responses, and the shell runtime config contained the same AAWM api/base path values.

Follow-up:
- None.

### 2026-05-22 - D1-059 - Re-verify AAWM and Observe dashboard display integration

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `.analysis/todo.md`

Evidence:
- Read-only subagent audit found no shell-side wiring gap for AAWM or AAWM Observe: metadata, sidebar/team entries, route wrappers, Module Federation importers, and shell route props are all present for both remotes.
- Static and dev AAWM proxy probes returned healthy backend payloads through the shell boundary:
  - `curl -sS -i http://127.0.0.1:3005/api/aawm/api/v1/health` returned `200` with `{"status":"ok","database":"ok","version":"0.5.4",...}`.
  - `curl -sS -i http://127.0.0.1:3006/api/aawm/api/v1/health` returned `200` with `{"status":"ok","database":"ok","version":"0.5.4",...}`.
- Static and dev Observe proxy probes returned the expected current upstream-unavailable response:
  - `curl -sS -i http://127.0.0.1:3005/api/aawm-observe/health` returned `500 {"error":"fetch failed"}`.
  - `curl -sS -i http://127.0.0.1:3006/api/aawm-observe/health` returned `500 {"error":"fetch failed"}`.
  - Direct `curl -sS -i http://127.0.0.1:34042/health` failed with connection refused, matching the documented placeholder Observe adapter state and default `AAWM_OBSERVE_API_TARGET=http://host.docker.internal:34042`.
- Static browser smoke for `http://127.0.0.1:3005/aawm` rendered the shell sidebar plus AAWM remote header/nav and Overview content with the expected authenticated data-error state; remote assets loaded from `/modules/aawm/*`, and browser API traffic stayed under `/api/aawm/api/v1/*` with expected `401 Unauthorized` responses.
- Dev browser smoke for `http://127.0.0.1:3006/aawm` rendered the shell sidebar plus AAWM remote header/nav and Overview content with the expected authenticated data-error state; remote assets loaded from `http://localhost:5176/remoteEntry.js`, and browser API traffic stayed under `/api/aawm/api/v1/*` with expected `401 Unauthorized` responses.
- Static browser smoke for `http://127.0.0.1:3005/aawm-observe/overview` rendered the shell sidebar plus AAWM Observe remote header/nav and starter content, including displayed `Base path /aawm-observe` and `API base /api/aawm-observe`; remote assets loaded from `/modules/aawm-observe/*`, with zero console errors and no API bypass traffic.
- Dev browser smoke for `http://127.0.0.1:3006/aawm-observe/overview` rendered the shell sidebar plus AAWM Observe remote header/nav and starter content, including displayed `Base path /aawm-observe` and `API base /api/aawm-observe`; remote assets loaded from `http://localhost:5177/remoteEntry.js`, with zero console errors and no API bypass traffic.

Follow-up:
- `D1-060` tracks the stricter AAWM contract cleanup: the live AAWM generated API client currently reaches the correct shell proxy via its `/api/aawm` default/env helper rather than by consuming the shell-published runtime `apiBase`.

### 2026-05-22 - D1-011 - Verify Aegis and Sluice shell proxy data endpoints

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `.analysis/todo.md`
- `.env.example`
- `docker-compose.dev.yml`
- `docker-compose.yml`
- `server/report-service.mjs`
- `src/shell/remote-dashboard.tsx`
- `../aegis-dashboard/src/api/sdk-client.ts`
- `../aegis-dashboard/src/api/sdk-interceptors.ts`
- `../aegis-dashboard/src/api/sdkConfig.ts`
- `../aegis-dashboard/src/api/shellApiBase.ts`
- `../aegis-dashboard/src/api/shellApiBase.test.ts`
- `../aegis-dashboard/src/components/topbar/ProfilePanel.tsx`
- `../aegis-dashboard/src/hooks/useJobLogStream.ts`
- `../aegis-dashboard/src/hooks/usePipelineProgressStream.ts`
- `../aegis-dashboard/src/module.ts`

Evidence:
- Rebuilt the Aegis API container from `../aegis` after its previous startup failure; direct `http://127.0.0.1:8001/api/v1/health` returned `{"status":"ok"}` and the container import check found `aawm_observe` installed in site-packages.
- Started the Sluice backend from `../sluice` on host port `8002`; direct `http://127.0.0.1:8002/api/v1/health` returned `{"status":"ok","version":"0.1.0"}`.
- Updated shell proxy defaults so Aegis uses the shared Docker service route `http://aegis-api:8001/api/v1` and Sluice uses non-conflicting `http://host.docker.internal:8002/api/v1`.
- Added shell runtime publication of each remote dashboard `apiBase` and added an Aegis runtime request interceptor so generated `/api/v1/*` client calls are rewritten to the shell proxy `/api/aegis/*` when hosted by the shell.
- Cleaned Aegis direct `/api/v1` callers for profile and SSE helpers through the same shell-aware `apiPath()` helper.

Verification:
- `node --check server/report-service.mjs` passed.
- `pnpm exec tsc -b` in `dashboard-shell` passed.
- `pnpm lint` in `dashboard-shell` passed with the existing 23-warning baseline and 0 errors.
- `pnpm build` in `dashboard-shell` passed.
- `docker compose -f docker-compose.yml config --quiet` and `docker compose -f docker-compose.dev.yml config --quiet` passed.
- `npm run typecheck` in `../aegis-dashboard` passed.
- `npm run lint` in `../aegis-dashboard` passed with the existing 8-warning baseline and 0 errors.
- `npm test -- --run shellApiBase.test.ts` in `../aegis-dashboard` passed: 1 file, 3 tests.
- `npm run build` in `../aegis-dashboard` passed.
- Static/prod-style rebuild: `docker compose -f docker-compose.yml up -d --build dashboard-shell aegis-dashboard dashboard-shell-reports`, then a focused `docker compose -f docker-compose.yml up -d --build aegis-dashboard` after the module-entry interceptor import.
- Live dev refresh: `docker compose -f docker-compose.dev.yml up -d --force-recreate --no-deps dashboard-shell-dev aegis-dashboard-dev dashboard-shell-reports-dev`, then a focused `docker compose -f docker-compose.dev.yml up -d --force-recreate --no-deps aegis-dashboard-dev`.
- Static and dev proxy probes returned 200 for `http://127.0.0.1:3005/api/aegis/health`, `http://127.0.0.1:3006/api/aegis/health`, `http://127.0.0.1:3005/api/sluice/stats/overview`, and `http://127.0.0.1:3006/api/sluice/stats/overview`; Sluice stats returned `{"total_products":0,"active_listings":0,"total_revenue":0.0,"modules_active":0}`.
- Static browser smoke for `http://127.0.0.1:3005/aegis` rendered Aegis Overview with `Total Variants` populated as `4,906,740`; browser API resources were only `/api/aegis/overview` and `/api/aegis/overview/chromosome-ideogram`.
- Dev browser smoke for `http://127.0.0.1:3006/aegis` rendered Aegis Overview with `Total Variants` populated as `4,906,740`; browser API resources were only `/api/aegis/overview` and `/api/aegis/overview/chromosome-ideogram`.
- Static browser smoke for `http://127.0.0.1:3005/sluice/overview` rendered Sluice `Key Metrics` with all four zero-valued metrics and called `/api/sluice/stats/overview`.
- Dev browser smoke for `http://127.0.0.1:3006/sluice/overview` rendered Sluice `Key Metrics` with all four zero-valued metrics and called `/api/sluice/stats/overview`.

Follow-up:
- Dev Sluice still logs Module Federation dynamic type-hints plugin WebSocket errors from the remote dev server, but the page renders and the data API path succeeds.

### 2026-05-22 - D1-013 - Repair full compose rebuild for Aegis remote dependency image

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `.analysis/todo.md`
- `../aegis-dashboard/package-lock.json`
- `../aegis-dashboard/src/components/charts/DistributionPieChart.tsx`
- `../aegis-dashboard/src/components/charts/SignificancePieChart.tsx`

Evidence:
- Reproduced the full rebuild failure with `docker compose -f docker-compose.yml up -d --build dashboard-shell`; the first stop was the sibling `../aegis-dashboard` Docker `npm ci` step reporting missing `esbuild@0.28.0` and platform-specific `@esbuild/*@0.28.0` package-lock entries.
- Regenerated the Aegis lockfile with Docker Node/npm so the lockfile matches the image build environment and includes the missing optional esbuild 0.28 platform packages required by the current dependency graph.
- After the lockfile repair, the same full rebuild reached Aegis `npm run build` and exposed Recharts callback typing errors in `DistributionPieChart` and `SignificancePieChart`; both handlers now accept the Recharts sector payload shape and defensively extract `name` before calling `onSliceClick`.

Verification:
- `npm run build` in `../aegis-dashboard` passed after the chart callback fix.
- `docker compose -f docker-compose.yml up -d --build dashboard-shell` completed successfully, building `aawm-dashboard`, `aawm-observe-dashboard`, `aawm-tap-dashboard`, `aegis-dashboard`, `dashboard-shell`, `dashboard-shell-reports`, and `sluice-dashboard`.
- `docker compose -f docker-compose.yml ps dashboard-shell dashboard-shell-reports aegis-dashboard sluice-dashboard aawm-tap-dashboard aawm-dashboard aawm-observe-dashboard` reported all requested static services `Up` and `healthy`.
- `curl -sS http://127.0.0.1:3005/api/shell/health` returned `{"ok":true,"databaseConfigured":true,"redisConfigured":true,"redisReady":true}`.

Follow-up:
- `D1-011` still tracks live backend data verification for Aegis and Sluice through the shell proxy once those upstream backend targets are available and correctly pointed.

### 2026-05-22 - D1-021 - Integrate AAWM and AAWM Observe dashboards

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `.analysis/todo.md`
- `.env.example`
- `README.md`
- `docker-compose.dev.yml`
- `docker-compose.yml`
- `docs/sibling-dashboard-setup.md`
- `nginx.conf`
- `server/report-service.mjs`
- `src/components/layout/data/sidebar-data.test.ts`
- `src/features/dashboard/components/phosphor-sidebar.test.tsx`
- `src/routes/_authenticated/aawm/index.tsx`
- `src/routes/_authenticated/aawm/$.tsx`
- `src/routes/_authenticated/aawm-observe/index.tsx`
- `src/routes/_authenticated/aawm-observe/$.tsx`
- `src/routeTree.gen.ts`
- `src/shell/remote-dashboard-metadata.ts`
- `src/shell/remote-dashboard-pages.tsx`
- `src/shell/remote-dashboard-registry.ts`
- `src/vite-env.d.ts`
- `vite.config.ts`

Evidence:
- Source audits confirmed `../aawm-dashboard` already exposes `aawm-dashboard/module` with base `/aawm` and API `/api/aawm`, while its actual module default route is `/`; `../aawm-observe-dashboard` exposes `aawm-observe-dashboard/module` with base `/aawm-observe`, API `/api/aawm-observe`, and placeholder telemetry routes.
- Added shell metadata, sidebar navigation, TanStack route wrappers, Module Federation importers, Vite remote config, ambient module declarations, and generated route tree entries for AAWM and AAWM Observe.
- Added live-dev compose services for `aawm-dashboard-dev` on port `5176` and `aawm-observe-dashboard-dev` on port `5177`, plus static/prod-style services `aawm-dashboard` and `aawm-observe-dashboard`.
- Added nginx static module proxies for `/modules/aawm/*` and `/modules/aawm-observe/*`.
- Added shell report/proxy routes for `/api/aawm/*`, `/api/aawm-observe/*`, and the AAWM dashboard compatibility `/hook-api/*`, with browser auth stripping and server-side configured API key/access-token injection.
- Added exact static nginx proxy matches for bare `/api/aawm`, `/api/aawm-observe`, and `/hook-api` requests so static mode matches the report-service and Vite dev proxy prefix behavior.
- Documented the new sibling dashboard route bases, dev ports, API targets, and the current AAWM `/` default route and `/hook-api` compatibility path; corrected the generic setup example to avoid reusing the assigned AAWM dev port.

Verification:
- `git diff --check` passed.
- `node --check server/report-service.mjs` passed.
- `docker compose config --quiet` passed.
- `docker compose -f docker-compose.dev.yml config --quiet` passed.
- `./node_modules/.bin/vitest run src/components/layout/data/sidebar-data.test.ts src/features/dashboard/components/phosphor-sidebar.test.tsx` passed: 2 files, 4 tests.
- `npm run build` passed and emitted remote loader chunks for `aawm` and `aawm-observe`.
- `npm run lint` passed with the existing 23-warning baseline and 0 errors.
- Read-only subagent review found no blocking issue in route registration, Module Federation names, or `/api/aawm-observe` vs `/api/aawm` proxy ordering; follow-up findings on bare static API prefixes and docs were fixed before commit.
- Live dev compose reported `dashboard-shell-dev`, `dashboard-shell-reports-dev`, `aawm-dashboard-dev`, and `aawm-observe-dashboard-dev` healthy.
- Live dev browser smoke: `http://127.0.0.1:3006/aawm` loaded `http://localhost:5176/remoteEntry.js`, kept shell sidebar/header, rendered the AAWM dashboard authenticated data-error state, and browser fetches to `/api/aawm/api/v1/health` and `/hook-api/health` returned 200.
- Live dev browser smoke: `http://127.0.0.1:3006/aawm-observe/overview` loaded `http://localhost:5177/remoteEntry.js`, kept shell sidebar/header, rendered the Observe starter content, and had zero failed resource requests.
- Static/prod-style rebuild: `docker compose -f docker-compose.yml up -d --build aawm-dashboard aawm-observe-dashboard`; `docker compose -f docker-compose.yml up -d --force-recreate --no-deps dashboard-shell-reports`; `docker compose -f docker-compose.yml up -d --build --no-deps dashboard-shell`.
- Static compose reported `dashboard-shell`, `dashboard-shell-reports`, `aawm-dashboard`, and `aawm-observe-dashboard` healthy; `GET /api/shell/health` on port `3005` returned `{"ok":true,"databaseConfigured":true,"redisConfigured":true,"redisReady":true}`.
- Static module probes returned 200 for `http://127.0.0.1:3005/modules/aawm/remoteEntry.js` and `http://127.0.0.1:3005/modules/aawm-observe/remoteEntry.js`.
- Static bare-prefix proxy probes after rebuilding the shell returned non-SPA proxy responses for `http://127.0.0.1:3005/api/aawm` (200 AAWM API JSON), `http://127.0.0.1:3005/api/aawm-observe` (500 expected upstream fetch failure until the Observe API target exists), and `http://127.0.0.1:3005/hook-api` (404 from the hook server).
- Static browser smoke: `http://127.0.0.1:3005/aawm` loaded `/modules/aawm/remoteEntry.js`, kept shell sidebar/header, rendered the AAWM dashboard authenticated data-error state, and browser fetches to `/api/aawm/api/v1/health` and `/hook-api/health` returned 200.
- Static browser smoke: `http://127.0.0.1:3005/aawm-observe/overview` loaded `/modules/aawm-observe/remoteEntry.js`, kept shell sidebar/header, rendered the Observe starter content, and had zero failed resource requests.

Follow-up:
- `D1-011` still tracks live data verification for Aegis and Sluice sibling backend endpoints.
- AAWM dashboard data endpoints currently return expected 401 authenticated responses without configured AAWM credentials; route/proxy health is verified separately through health endpoints.
- AAWM Observe still needs a real upstream data adapter once its API contract stabilizes.


### 2026-05-22 - D1-019 and D1-020 - Merge quota and health visual runs

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `.analysis/todo.md`
- `src/features/dashboard/components/phosphor-dashboard.test.tsx`
- `src/features/dashboard/components/phosphor-dashboard.tsx`
- `src/features/dashboard/components/primitives/health-strip.test.tsx`
- `src/features/dashboard/components/primitives/health-strip.tsx`
- `src/features/dashboard/components/primitives/quota-interval-bar.test.tsx`
- `src/features/dashboard/components/primitives/quota-interval-bar.tsx`
- `src/features/dashboard/components/provider-card.test.tsx`

Evidence:
- Updated quota bar rendering so adjacent logical percent buckets with the same severity, velocity tier, and animation state render as one wider DOM run while preserving the 100-bucket segment model and proportional widths.
- Limited quota spectral animation to `velocity-fast`, `velocity-hot`, and `velocity-peak`; `velocity-slow` and `velocity-steady` remain color-coded but render static.
- Updated vertical provider health strips so adjacent five-minute buckets with the same derived background/extra class render as proportional-height visual runs. Horizontal health strips remain unmerged.
- Preserved `cat-miss` hatch semantics by merging miss buckets by class without adding inline background color.
- Added regression tests for quota run widths, velocity-tier merge boundaries, fast/hot/peak animation gating, vertical health run spans, sparse padding spans, and miss hatch preservation.

Verification:
- `./node_modules/.bin/vitest run src/features/dashboard/components/primitives/quota-interval-bar.test.tsx src/features/dashboard/components/primitives/health-strip.test.tsx src/features/dashboard/components/provider-card.test.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx` passed: 4 files, 132 tests.
- `npm run lint` passed with the existing warning baseline: 23 warnings, 0 errors.
- `npm run build` passed.
- `git diff --check` passed.
- Runtime deployment: rebuilt/recreated static `dashboard-shell` with `docker compose -f docker-compose.yml up -d --build --no-deps dashboard-shell`; `docker ps --filter name=dashboard-shell-dashboard-shell-1` reported `Up ... (healthy)` on host port `3005`.
- Runtime browser verification on `http://127.0.0.1:3005/`: report requests `/api/shell/reports/usage` and `/api/shell/reports/quotas` returned 200; there were zero console warnings/errors; 23 quota bars rendered 429 `.quota-interval` nodes with 252 `.high-velocity` nodes and zero slow/steady animated nodes; visible provider cards rendered 142 `.health-strip-cell` nodes.

Follow-up:
- `D1-021` tracks integrating `../aawm-observe-dashboard` and `../aawm-dashboard` into the shell display.

### 2026-05-21 - D1-019 - Add percent-bucket quota velocity bars

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `.analysis/todo.md`
- `server/report-service.mjs`
- `src/features/dashboard/api/usage-report.ts`
- `src/features/dashboard/components/phosphor-dashboard-tip-velocity.test.ts`
- `src/features/dashboard/components/phosphor-dashboard.test.tsx`
- `src/features/dashboard/components/phosphor-dashboard.tsx`
- `src/features/dashboard/components/primitives/quota-interval-bar.test.tsx`
- `src/features/dashboard/components/primitives/quota-interval-bar.tsx`
- `src/features/dashboard/components/provider-card.test.tsx`
- `src/features/dashboard/components/provider-card.tsx`
- `src/styles/index.css`

Evidence:
- Confirmed live data support in `aawm_tristore`: `public.rate_limit_observations` has timestamped `observed_at`, `quota_key`, `quota_type`, `expected_reset_at`, and `remaining_pct`; selected active quota lanes had current-window observation samples for Anthropic, OpenAI, Google, and xAI.
- Added backend quota velocity derivation from `rate_limit_observations`: each active quota lane now emits 100 boolean percent buckets, numeric velocity score buckets, and a sample count. A bucket is marked fast when observed consumption crosses more quota percent than the elapsed fraction of that quota window permits; the numeric score preserves how far above or below baseline the burn was.
- Bumped the report cache version so Redis cannot serve older quota payloads without velocity fields.
- Updated Provider Status quota bars from 12 coarse segments to 100 one-percent segments and wired current bars to backend velocity flags plus score tiers. Prior/history bars remain static through the existing `.is-prior` animation guard.
- Removed dense-bar inter-segment gaps so 100 percent buckets fit in the same visual width.
- Added visible velocity tier classes (`velocity-slow`, `velocity-steady`, `velocity-fast`, `velocity-hot`, `velocity-peak`) so the same quota bar can show troughs, normal burn, fast burn, and peak bursts instead of a flat spectral state.
- Fixed quota hover burn-rate labels to derive elapsed time from `resetAt - durationHours` instead of the latest interval change point, preventing long windows such as Sonnet 7d from showing inflated `%/h` rates. Long windows now render `%/d`; short windows render `%/h`.
- Added regression coverage for 100-segment rendering, backend velocity score tiers feeding current quota segments, the primitive rendering `velocityClass`, and reset-window-aware tooltip velocity labels.

Verification:
- `node --check server/report-service.mjs` passed.
- `./node_modules/.bin/vitest run src/features/dashboard/components/phosphor-dashboard-tip-velocity.test.ts src/features/dashboard/components/phosphor-dashboard.test.tsx src/features/dashboard/components/provider-card.test.tsx src/features/dashboard/components/primitives/quota-interval-bar.test.tsx` passed: 4 files, 101 tests.
- `npm run build` passed.
- `npm run lint` passed with the existing warning baseline: 23 warnings, 0 errors.
- Runtime deployment: restarted `dashboard-shell-reports` and `dashboard-shell-reports-dev`; rebuilt/recreated static `dashboard-shell` with `docker compose -f docker-compose.yml up -d --build --no-deps dashboard-shell`.
- Runtime API verification: both `http://127.0.0.1:3005/api/shell/reports/quotas` and `http://127.0.0.1:3006/api/shell/reports/quotas` returned 12 quota rows with populated `*_velocity_scores` and `*_velocity_segments` arrays length 100. Sample score-tier evidence included xAI monthly `steady=7 fast=28 hot=58 peak=6`, OpenAI special `slow=2 steady=1 fast=3 hot=22 peak=46`, and Anthropic short `slow=1 fast=1 hot=4 peak=3`.
- Runtime browser verification through headless Chrome: both `http://127.0.0.1:3005/` and `http://127.0.0.1:3006/` rendered 24 quota bars, 2,400 `.quota-interval` elements, 248 `.high-velocity` elements, and tiered velocity classes `slow=21`, `steady=26`, `fast=36`, `hot=89`, `peak=98`.

Follow-up:
- None.

### 2026-05-21 - D1-017 - Repair dashboard hover tooltip panels and TOOL shell grouping

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `.analysis/todo.md`
- `src/features/dashboard/components/master-ledger-table.tsx`
- `src/features/dashboard/components/master-ledger-table.test.tsx`
- `src/features/dashboard/components/primitives/hover-tooltip.tsx`
- `src/features/dashboard/components/primitives/hover-tooltip.test.tsx`

Evidence:
- Browser probe against `http://127.0.0.1:3006/` reproduced the transparent-body hover symptom: quota and trend `.v9-tip` panels had opaque `rgba(11, 16, 24, 0.96)` backgrounds but painted only `14px` high while content scroll heights were `91px` and `109px`.
- Fixed `HoverTooltip` by resetting legacy absolute-positioning offsets before applying fixed portal coordinates, preventing stale `.tip-quota` `bottom` rules from constraining the panel height.
- Runtime browser verification after the tooltip fix showed quota and trend tooltip panels painting at full content height: approximately `99px` and `117px`, with `scrollHeight` matching `clientHeight`.
- Local report API probe found raw TOOL shell labels split by path prefixes, including `./.venv/bin/python`, `/home/zepfu/projects/aawm-tap/.venv/bin/python`, and `/home/zepfu/projects/aawm-tap/.venv/bin/pytest`.
- Added TOOL shell-label normalization before client-side grouping: strips executable paths, handles leading assignment/env prefixes, preserves grouped command forms such as `git show`, drops comment-only labels, and treats null/empty labels as ignorable rows.
- Added regression tests covering the portalled tooltip offset reset, path-prefixed TOOL shell-label rollup, and null/undefined shell labels.
- Reproduced the temporary dashboard 500 after the first shell-label patch: browser console showed `TypeError: Cannot read properties of null (reading 'trim')` in the TOOL label normalizer. The null-safe normalizer fixed the crash.

Verification:
- `pnpm exec prettier --write src/features/dashboard/components/master-ledger-table.tsx src/features/dashboard/components/master-ledger-table.test.tsx src/features/dashboard/components/primitives/hover-tooltip.tsx src/features/dashboard/components/primitives/hover-tooltip.test.tsx` passed.
- `pnpm test src/features/dashboard/components/master-ledger-table.test.tsx src/features/dashboard/components/primitives/hover-tooltip.test.tsx` passed: 2 files, 31 tests.
- `pnpm lint` passed with the existing warning baseline and 0 errors.
- `pnpm build` passed.
- `git diff --check` passed.
- Runtime deployment: rebuilt and recreated the static shell with `docker compose -f docker-compose.yml up -d --build --no-deps dashboard-shell`.
- Runtime verification: `docker compose -f docker-compose.yml ps dashboard-shell dashboard-shell-reports dashboard-shell-redis` reported all three services healthy, and both `http://127.0.0.1:3005/api/shell/health` and `http://127.0.0.1:3006/api/shell/health` returned `{"ok":true,"databaseConfigured":true,"redisConfigured":true,"redisReady":true}`.
- Final browser probe against both `3005` and `3006` showed the General dashboard rendering again with 8 provider cards, zero page errors, zero failed requests, and 200 responses for both usage and quotas API calls.

Follow-up:
- None.

### 2026-05-21 - D1-015 - Render missing-upstream health cells as hatched blue

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `.analysis/todo.md`
- `src/styles/index.css`

Evidence:
- Updated `.health-strip-cell.cat-miss` so missing-upstream-latency cells keep the `cat-miss` semantic class but render as blue with a diagonal hatch overlay instead of the previous near-background blank style.
- Updated the `cat-miss` attribution legend swatch to use the same blue hatch treatment.
- Verification: `pnpm lint` passed with the existing 23-warning baseline and 0 errors.
- Verification: `pnpm build` passed and emitted `dist/assets/main-Caf5QQVk.css`.
- Verification: `git diff --check` passed.
- Runtime deployment: rebuilt and recreated the static shell with `docker compose -f docker-compose.yml up -d --build --no-deps dashboard-shell`.
- Runtime verification: `docker compose -f docker-compose.yml ps dashboard-shell dashboard-shell-reports dashboard-shell-redis` reported all three services healthy; `curl -sS http://127.0.0.1:3005/api/shell/health` returned `{"ok":true,"databaseConfigured":true,"redisConfigured":true,"redisReady":true}`.
- Runtime CSS verification: `http://127.0.0.1:3005/assets/main-Caf5QQVk.css` contains `.health-strip-cell.cat-miss{opacity:1;background:repeating-linear-gradient(135deg,#ffffff80 0 1px,#0000 1px 3px),#3a82f3d6}` and the matching `legend-cat.cat-miss` swatch rule.

Follow-up:
- None.

### 2026-05-21 - D1-014 - Reclassify probe-backed Provider Status health cells

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `.analysis/todo.md`
- `server/report-service.mjs`
- `src/features/dashboard/components/phosphor-dashboard.test.tsx`
- `src/features/dashboard/components/phosphor-dashboard.tsx`
- `src/features/dashboard/lib/usage-report-display.ts`

Evidence:
- Confirmed the blue decision path: `HealthStrip` maps a cell to no-data blue when `rawP95Ms === null` and `rawErrorCount === 0`. For xAI, the live `providerLatencyHealth` payload had status/control probe data but no passive LLM latency, so the old raw-metric path classified all latest 288 cells as blue.
- Canonicalized xAI health rows in `buildProviderLatencyHealthQuery()` so `x.ai` and `xai/*` collapse to `xai`, and added the same `x.ai` alias to the client-side health-row provider alias map.
- Updated `padHealthCells()` so no-passive-traffic buckets with active probe/control data become semantic health cells: clean probes -> green, degraded probes -> orange/red, missing upstream latency -> `miss`, and no-probe/no-passive buckets remain on the raw blue path.
- Added focused tests for probe-backed no-traffic classification, xAI alias inclusion, missing-upstream `miss`, and true no-probe no-traffic blue fallback.
- Verification: `node --check server/report-service.mjs` passed.
- Verification: `pnpm test src/features/dashboard/components/phosphor-dashboard.test.tsx` passed with 57 tests.
- Verification: `pnpm test src/features/dashboard/components/primitives/health-strip.test.tsx` passed with 30 tests.
- Verification: `pnpm build` passed.
- Verification: `pnpm lint` passed with the existing 23-warning baseline and 0 errors.
- Verification: `git diff --check` passed.
- Runtime deployment: recreated `dashboard-shell-reports` with `docker compose -f docker-compose.yml up -d --force-recreate --no-deps dashboard-shell-reports`; recreated `dashboard-shell-reports-dev` with `docker compose -f docker-compose.dev.yml up -d --force-recreate --no-deps dashboard-shell-reports-dev`; rebuilt/recreated the static shell with `docker compose -f docker-compose.yml up -d --build --no-deps dashboard-shell`.
- Runtime health verification: both `http://127.0.0.1:3005/api/shell/health` and `http://127.0.0.1:3006/api/shell/health` returned `{"ok":true,"databaseConfigured":true,"redisConfigured":true,"redisReady":true}`, and both compose stacks reported shell/report/Redis containers healthy.
- Runtime API verification: fresh cache-busted usage requests on both `3005` and `3006` returned `cacheStatus: miss`, `cacheBackend: redis`, `providerLatencyHealth: 4571`, `xaiRows: 481`, and xAI provider counts normalized to `{ "xai": 481 }`. Replaying the old UI rule against the latest 288 xAI buckets yielded `{ "blue": 288 }`; replaying the new rule yielded `{ "green": 276, "orange": 10, "red": 2 }`, with `probeBackedNoPassive: 288`, `trueNoProbeNoPassive: 0`, `requestBuckets: 0`, and `newBlueBuckets: 0`.

Follow-up:
- The remaining active queue is unchanged: D1-011 still tracks sibling backend endpoint verification, and D1-013 still tracks the Aegis remote dependency image rebuild gap.

### 2026-05-21 - D1-012 - Restore live General dashboard freshness

Status: Completed

Changed paths:
- `.analysis/completed.md`
- `.analysis/todo.md`
- `server/report-service.mjs`
- `src/features/dashboard/index.tsx`

Evidence:
- Confirmed the report APIs were not globally stale before the fix: `http://127.0.0.1:3005` and `http://127.0.0.1:3006` both returned `latestRecordAgeMinutes: 0`, `latestRecordStale: false`, and Redis-backed usage metadata for the default 30-day window.
- Added a 60-second React Query `refetchInterval` for the General dashboard usage and quota queries, with `refetchIntervalInBackground: true`, so the dashboard no longer depends on focus events or a manual reload after the first fetch.
- Fixed `refreshReportCache()` so successful cache refreshes clear the completed in-flight promise from the local report cache map. Before this, stale Redis entries could keep returning `cacheRefreshing: true` without starting a new SQL refresh.
- Verification: `node --check server/report-service.mjs` passed.
- Verification: `pnpm test src/features/dashboard/index.test.tsx` passed with 1 file and 2 tests.
- Verification: `pnpm build` passed.
- Verification: `pnpm lint` passed with the existing 23-warning baseline and 0 errors.
- Verification: `git diff --check` passed.
- Runtime deployment: rebuilt and restarted the static shell with `docker compose up -d --build --no-deps dashboard-shell`; rebuilt and restarted the static report service with `docker compose up -d --build --no-deps dashboard-shell-reports`; restarted the live dev report service with `docker compose -f docker-compose.dev.yml up -d --force-recreate --no-deps dashboard-shell-reports-dev`.
- Runtime verification: `docker compose ps dashboard-shell dashboard-shell-reports dashboard-shell-redis` showed all three static services healthy; `docker compose -f docker-compose.dev.yml ps dashboard-shell-dev dashboard-shell-reports-dev dashboard-shell-redis` showed all three dev services healthy.
- Runtime API verification: after the fixed refresh path ran, both `http://127.0.0.1:3005/api/shell/reports/usage?...` and `http://127.0.0.1:3006/api/shell/reports/usage?...` returned `cacheStatus: hit`, `cacheRefreshing: false`, `cacheBackend: redis`, `cacheGeneratedAt: 2026-05-21T14:27:07.981Z`, `latestRecordAt: 2026-05-21T14:23:48.578Z`, and `latestRecordStale: false`.

Follow-up:
- D1-013 tracks the unrelated `aegis-dashboard` lockfile mismatch that blocked a full dependency rebuild without `--no-deps`.

### 2026-05-20 - D1-004 - Registry-backed shell remotes and sibling integration

Status: Completed

Changed paths:
- `.env.example`
- `.gitignore`
- `README.md`
- `docker-compose.dev.yml`
- `docker-compose.yml`
- `docs/remote-dashboard-integration-contract.md`
- `docs/sibling-dashboard-setup.md`
- `docs/tap-ui-contract.md`
- `nginx.conf`
- `package.json`
- `scripts/scaffold-tap.mjs`
- `server/report-service.mjs`
- `src/components/layout/data/sidebar-data.ts`
- `src/routes/_authenticated/aegis/index.tsx`
- `src/routes/_authenticated/aegis/$.tsx`
- `src/routes/_authenticated/sluice/index.tsx`
- `src/routes/_authenticated/sluice/$.tsx`
- `src/routeTree.gen.ts`
- `src/shell/aawm-tap-dashboard.tsx`
- `src/shell/remote-dashboard-pages.tsx`
- `src/shell/remote-dashboard-registry.ts`
- `src/shell/remote-dashboard.tsx`
- `src/vite-env.d.ts`
- `vite.config.ts`

Evidence:
- Replaced the AAWM-only remote loader with a generic registry-backed remote dashboard loader and kept `src/shell/aawm-tap-dashboard.tsx` as a thin compatibility wrapper.
- Added registry entries, TanStack routes, ambient module declarations, Vite remote config, nginx module proxies, and API proxy config for `aegis-dashboard/module` under `/aegis` and `sluice/module` under `/sluice`.
- Updated sidebar/team data to derive dashboard navigation from the remote registry instead of per-dashboard static shell data.
- Added live dev compose services for `../aegis-dashboard` and `../sluice-dashboard` using bind-mounted source and their real Vite federation dev servers on ports `5174` and `5175`.
- Added static/prod-style compose services for Aegis and Sluice remote images, plus nginx `/modules/aegis/*`, `/modules/sluice/*`, `/api/aegis/*`, and `/api/sluice/*` proxying.
- Added `docs/sibling-dashboard-setup.md` for the shell-side process to add future sibling repos in both live dev containers and static/prod-style containers, and linked it from `README.md` and the remote dashboard contract.
- Fixed the generic remote route prop builder so `moduleId` is the remote module id, not a route `:id` param.
- Verification: `node --check server/report-service.mjs` passed.
- Verification: `docker compose config --quiet` passed.
- Verification: `docker compose -f docker-compose.dev.yml config --quiet` passed.
- Verification: `pnpm lint` passed with the existing 23-warning baseline and 0 errors.
- Verification: `pnpm build` passed after the final prop fix.
- Verification: `docker compose -f docker-compose.dev.yml up -d aawm-tap-dashboard-dev aegis-dashboard-dev sluice-dashboard-dev dashboard-shell-reports-dev dashboard-shell-dev` left dev services healthy.
- Verification: `docker compose up -d --build dashboard-shell` rebuilt the static shell image after the final prop fix; static shell, report service, AAWM TAP, Aegis, Sluice, and Redis containers were healthy.
- Runtime HTTP verification: `curl -sS http://127.0.0.1:3005/api/shell/health` and `curl -sS http://127.0.0.1:3006/api/shell/health` both returned `{"ok":true,"databaseConfigured":true,"redisConfigured":true,"redisReady":true}`.
- Runtime HTTP verification: `curl -sS -I http://127.0.0.1:3005/modules/aawm-tap/remoteEntry.js`, `/modules/aegis/remoteEntry.js`, and `/modules/sluice/remoteEntry.js` returned `200 OK` JavaScript responses.
- Runtime browser verification: `node /tmp/dashboard-shell-smoke.mjs` loaded `http://127.0.0.1:3006/aegis`, `http://127.0.0.1:3006/sluice/overview`, `http://127.0.0.1:3006/aawm-tap/overview`, `http://127.0.0.1:3005/aegis`, and `http://127.0.0.1:3005/sluice/overview` with no bootstrap or Module Federation failure text.
- Verification: `git diff --check` passed.

Follow-up:
- D1-011 tracks backend data endpoint verification once the Aegis and Sluice backend targets are confirmed running; current browser smoke proves the remote modules render, while dev Sluice reaches its own `Error loading stats` state and static Sluice remains in `Loading statistics...` during the smoke window.

### 2026-05-12 - D1-001 - Establish workflow ledger

Status: Completed

Changed paths:
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Created the active queue and completion ledger after confirming `.analysis/` existed but `todo.md` and `completed.md` did not.
- Captured the current shell/remote context and stable task IDs.
- Verification: explicit path creation through this entry and later ledger updates.

Follow-up:
- Continue moving verified work here before ending turns that change dashboard-shell status.

### 2026-05-12 - D1-002 - Host the first federated dashboard module

Status: Completed

Changed paths:
- `vite.config.ts`
- `package.json`
- `pnpm-lock.yaml`
- `src/vite-env.d.ts`
- `src/shell/types.ts`
- `src/shell/aawm-tap-dashboard.tsx`
- `src/shell/aawm-tap-page.tsx`
- `src/routes/_authenticated/aawm-tap/index.tsx`
- `src/routes/_authenticated/aawm-tap/$page.tsx`
- `src/routeTree.gen.ts`
- `src/components/layout/data/sidebar-data.ts`
- `README.md`
- `../aawm-tap-dashboard/package.json`
- `../aawm-tap-dashboard/package-lock.json`
- `../aawm-tap-dashboard/vite.config.ts`

Evidence:
- Added `@module-federation/vite` host config for `aawm-tap-dashboard/module`.
- Added typed remote module contract and TanStack routes for `/aawm-tap` and `/aawm-tap/$page`.
- Added shell navigation entries for AAWM TAP pages.
- Aligned the sibling remote to React 19/Tailwind 4 peer contract after browser smoke exposed the React 18 `ReactCurrentOwner` runtime failure.
- Verification: `pnpm lint` passed.
- Verification: `pnpm build` passed.
- Verification in sibling remote: `npm run build` passed.
- Runtime verification: Playwright loaded `http://127.0.0.1:3005/aawm-tap/overview` and returned `renderedOverview: true`, with no page errors or failed requests.

Follow-up:
- D1-004 should replace the remaining static demo shell chrome with registry-backed data.

### 2026-05-12 - D1-003 - Add container hosting for shell and remote

Status: Completed

Changed paths:
- `Dockerfile`
- `.dockerignore`
- `nginx.conf`
- `docker-compose.yml`
- `package.json`
- `README.md`

Evidence:
- Added a multi-stage shell Dockerfile using pinned `pnpm@10.30.2`.
- Added nginx SPA hosting with `/modules/aawm-tap/` proxying to the remote container and no-store handling for `remoteEntry.js`.
- Added compose services for `dashboard-shell` and sibling `aawm-tap-dashboard`.
- Default compose port changed to `3005` after `3000` was already bound on the host.
- Verification: `docker compose config` passed.
- Verification: `docker build -t dashboard-shell:local .` passed.
- Verification: `docker compose up --build -d` passed and `docker compose ps` showed both services running, with shell published on `0.0.0.0:3005->80/tcp`.
- Runtime HTTP verification: `curl http://127.0.0.1:3005/aawm-tap/overview` returned `200 text/html`.
- Runtime HTTP verification: `curl http://127.0.0.1:3005/modules/aawm-tap/remoteEntry.js` returned `200 application/javascript`.
- Runtime browser verification: Playwright loaded `/aawm-tap/overview` and observed the remote overview content.

Follow-up:
- D1-005 should wire the real `/api/aawm-tap` backend target.
- D1-006 should tighten the sibling remote Docker context.

### 2026-05-13 - D1-007 - Persist dashboard shell compose services across reboot

Status: Completed

Changed paths:
- `docker-compose.yml`
- `package.json`
- `README.md`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Added `restart: unless-stopped` to both the `dashboard-shell` service and the required `aawm-tap-dashboard` remote service.
- Updated `pnpm docker:up` to run the compose stack detached with `docker compose up --build -d`.
- Verification: `docker compose -f docker-compose.yml config` showed `restart: unless-stopped` on both services.
- Verification: `systemctl is-enabled docker` returned `enabled`.
- Verification: `docker compose -f docker-compose.yml up -d` recreated and started both services.
- Verification: `docker inspect --format '{{.Name}} {{.HostConfig.RestartPolicy.Name}} {{.State.Status}}' dashboard-shell-dashboard-shell-1 dashboard-shell-aawm-tap-dashboard-1` returned both containers as `unless-stopped running`.
- Runtime HTTP verification: `curl --retry 5 --retry-connrefused --retry-delay 1 -I http://127.0.0.1:3005/aawm-tap/overview` returned `200 OK`.
- Runtime HTTP verification: `curl --retry 5 --retry-connrefused --retry-delay 1 -I http://127.0.0.1:3005/modules/aawm-tap/remoteEntry.js` returned `200 OK`.

Follow-up:
- D1-005 should still wire the real `/api/aawm-tap` backend target.

### 2026-05-13 - D1-008 - Refresh hosted AAWM TAP remote after sibling updates

Status: Completed

Changed paths:
- `.analysis/completed.md`

Evidence:
- Confirmed the sibling remote contract still matches the shell: `aawm-tap-dashboard/module`, `remoteEntry.js`, `basePath: /aawm-tap`, and `apiBase: /api/aawm-tap`.
- Rebuilt only the `aawm-tap-dashboard` compose service from `../aawm-tap-dashboard`; no dashboard-shell source edit was needed.
- Verification: `docker compose -f docker-compose.yml up -d --build aawm-tap-dashboard` built image `sha256:b0faf5cca6e6ce5d7d96f4450e67a7bf105b5d7bd502f3db84067a4776af07ab` and recreated the remote container.
- Verification: `docker compose -f docker-compose.yml ps` showed `dashboard-shell-aawm-tap-dashboard-1` and `dashboard-shell-dashboard-shell-1` both running.
- Runtime HTTP verification: `curl --retry 5 --retry-connrefused --retry-delay 1 -I http://127.0.0.1:3005/modules/aawm-tap/remoteEntry.js` returned `200 OK` with `Last-Modified: Wed, 13 May 2026 17:24:17 GMT`.
- Runtime browser verification: Playwright loaded `http://127.0.0.1:3005/aawm-tap/overview` and returned `{ "renderedOverview": true, "pageErrors": [], "failedRequests": [] }`.

Follow-up:
- D1-006 should still tighten the sibling remote Docker context; this rebuild had to transfer a large context before the build could run.

### 2026-05-13 - D1-009 - Add live dev containers for shell and AAWM TAP remote

Status: Completed

Changed paths:
- `.dockerignore`
- `.gitignore`
- `README.md`
- `docker-compose.dev.yml`
- `eslint.config.js`
- `package.json`
- `vite.config.ts`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Added `docker-compose.dev.yml` with `dashboard-shell-dev` on port `3006` and `aawm-tap-dashboard-dev` on port `5173`, both using bind-mounted source and container-owned dependency volumes.
- The remote dev container runs the sibling dashboard's federation-enabled `npm run dev`, not the standalone test harness, so shared React stays valid.
- The shell dev container sets `AAWM_TAP_REMOTE_ENTRY=http://localhost:5173/remoteEntry.js`, keeps the remote type as `module`, and proxies `/api/aawm-tap/*` to `AAWM_TAP_API_TARGET` with a default of `http://127.0.0.1:8000`.
- Added `pnpm docker:dev`, `pnpm docker:dev:down`, and `pnpm docker:dev:logs`.
- Added `@mf-types` to git, Docker, and ESLint ignores because Module Federation generates declaration files there during dev.
- Verification: `docker compose -f docker-compose.dev.yml config` passed.
- Verification: `docker compose -f docker-compose.dev.yml up -d --force-recreate dashboard-shell-dev aawm-tap-dashboard-dev` started both live dev containers.
- Runtime HTTP verification: `curl -I http://127.0.0.1:3006/api/aawm-tap/docs` returned `200 OK` from uvicorn through the shell Vite proxy.
- Runtime browser verification: Playwright loaded `http://127.0.0.1:3006/aawm-tap/overview`, fetched `http://localhost:5173/remoteEntry.js`, `src/module.ts`, and `src/pages/Overview.tsx`, and returned `{ "renderedRemote": true, "failedFallback": false, "pageErrors": [], "failedRequests": [] }`.
- Verification: `pnpm lint` passed.
- Verification: `pnpm build` passed.

Follow-up:
- The shell still logs a nonfatal Module Federation type archive warning for `http://localhost:5173/@mf-types.zip`; runtime loading is unaffected.

### 2026-05-13 - D1-010 - Add shell-owned General usage report

Status: Completed

Changed paths:
- `.dockerignore`
- `.env.example`
- `.gitignore`
- `Dockerfile.report-service`
- `README.md`
- `docker-compose.dev.yml`
- `docker-compose.yml`
- `nginx.conf`
- `package.json`
- `pnpm-lock.yaml`
- `server/report-service.mjs`
- `src/features/dashboard/api/usage-report.ts`
- `src/features/dashboard/components/usage-report-dashboard.tsx`
- `src/features/dashboard/index.tsx`
- `vite.config.ts`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Added `server/report-service.mjs`, a shell-owned report API that reads `DATABASE_URL` server-side and exposes `GET /api/shell/reports/usage`.
- The usage query is parameterized and only accepts allowlisted `grain`, `group_by`, filter, and sort values; the browser cannot submit arbitrary SQL.
- Corrected the upstream elapsed alias to `llm_upstream_elapsed_average_ms`.
- Kept missing quota percentages as `null` instead of coercing them to `0`.
- Added daily/weekly/monthly slicing and group presets for environment, client, repository, provider, model, and provider/model.
- Replaced the demo root dashboard with the General usage report cards, token trend, quota low points, and slice table.
- Added `/api/shell` Vite proxying for dev and nginx proxying for static hosting.
- Initial implementation ran `dashboard-shell-reports` on host networking port `3011` so host-published database URLs such as `127.0.0.1:5434` remained reachable; this was superseded by D1-005, which moved the report services onto Docker bridge networks with database host/port rewrite support.
- Verification: `pnpm lint` passed.
- Verification: `pnpm build` passed.
- Runtime direct API verification: `curl http://127.0.0.1:3010/api/shell/health` returned `{"ok":true,"databaseConfigured":true}` before the temporary process was stopped.
- Runtime direct API verification: `curl 'http://127.0.0.1:3010/api/shell/reports/usage?from=2026-04-01&to=2026-06-02&grain=day&group_by=environment,client,repository,provider_model&limit=2'` returned live rows from `public.session_history`.
- Runtime dev compose verification: `curl http://127.0.0.1:3006/api/shell/health` returned `{"ok":true,"databaseConfigured":true}`.
- Runtime dev compose verification: `curl 'http://127.0.0.1:3006/api/shell/reports/usage?from=2026-04-01&to=2026-06-02&grain=day&group_by=provider&limit=1'` returned live report JSON.
- Runtime static compose verification: `curl http://127.0.0.1:3005/api/shell/health` returned `{"ok":true,"databaseConfigured":true}`.
- Runtime static compose verification: `curl 'http://127.0.0.1:3005/api/shell/reports/usage?from=2026-04-01&to=2026-06-02&grain=day&group_by=provider&limit=1'` returned live report JSON.
- Runtime browser verification: headless Chrome rendered `http://127.0.0.1:3006/` and found `General Dashboard`, `Token Trend`, and `Usage Slices`.
- Runtime browser verification: headless Chrome rendered `http://127.0.0.1:3005/` and found `General Dashboard`, `Token Trend`, and `Usage Slices`.

Follow-up:
- D1-004 still needs to replace the remaining hardcoded sidebar and command-menu demo chrome with registry-backed shell/module data.

### 2026-05-13 - D1-005 - Wire AAWM TAP backend and shared Docker networks

Status: Completed

Changed paths:
- `.env.example`
- `README.md`
- `docker-compose.dev.yml`
- `docker-compose.yml`
- `nginx.conf`
- `server/report-service.mjs`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Attached the static/prod shell and remote containers to external Docker network `aawm-tap_default`.
- Attached the static/prod report container to both `aawm-tap_default` and `aawm_default` so it can share the TAP-side network and reach the report database network.
- Removed host networking from the dev shell, dev remote, and dev report containers; the dev shell and remote now join `aawm-tap_default`, and the dev report container joins both `aawm-tap_default` and `aawm_default`.
- Kept `/api/aawm-tap/*` pointed at `host.docker.internal:8010` because the current `aawm-tap` API dev service is host-networked while the shell containers are bridge-networked.
- Added `SHELL_REPORT_DATABASE_PORT_REWRITE` so Dockerized report services can rewrite host-style `.env` database URLs such as `localhost:5434` to `aawm-postgres18:5432` on `aawm_default`.
- Verification: `docker compose -f docker-compose.yml config` passed.
- Verification: `docker compose -f docker-compose.dev.yml config` passed.
- Verification: `node --check server/report-service.mjs` passed.
- Verification: `docker compose -f docker-compose.dev.yml up -d --force-recreate` started the live dev stack.
- Verification: `docker compose -f docker-compose.yml up --build -d` rebuilt and started the static/prod stack.
- Runtime network verification: `docker inspect --format '{{.Name}} {{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}' dashboard-shell-dashboard-shell-1 dashboard-shell-dashboard-shell-reports-1 dashboard-shell-aawm-tap-dashboard-1 dashboard-shell-dev dashboard-shell-reports-dev dashboard-shell-aawm-tap-dashboard-dev` returned `aawm-tap_default` for both shell containers and both remote containers; both report containers returned `aawm-tap_default aawm_default`.
- Runtime container verification: `docker ps --filter name=dashboard-shell --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'` showed all six dashboard-shell containers running, with static shell on `3005`, dev shell on `3006`, and dev remote on `5173`.
- Runtime API verification: `curl -sS -o /dev/null -w '3005 aawm api -> %{http_code}\n' http://127.0.0.1:3005/api/aawm-tap/docs` returned `3005 aawm api -> 200`.
- Runtime API verification: `curl -sS -o /dev/null -w '3006 aawm api -> %{http_code}\n' http://127.0.0.1:3006/api/aawm-tap/docs` returned `3006 aawm api -> 200`.
- Runtime report health verification: `curl -sS http://127.0.0.1:3005/api/shell/health` and `curl -sS http://127.0.0.1:3006/api/shell/health` both returned `{"ok":true,"databaseConfigured":true}`.
- Runtime report data verification: `curl -sS 'http://127.0.0.1:3005/api/shell/reports/usage?from=2026-04-01&to=2026-06-02&grain=day&group_by=provider&limit=1'` and the same query on port `3006` both returned live usage JSON with `summary.traces: 5633` and a provider row for `openai`.
- Runtime browser verification: headless Chrome rendered `http://127.0.0.1:3005/` and `http://127.0.0.1:3006/` with `General Dashboard`, `Token Trend`, and `Usage Slices`, and rendered `http://127.0.0.1:3005/aawm-tap/overview` and `http://127.0.0.1:3006/aawm-tap/overview` with `Overview` and no `Usage Report Unavailable`, `Error loading dashboard module`, or `Unable to load module` markers.
- Verification: `pnpm lint` passed.
- Verification: `pnpm build` passed.
- Verification: `git diff --check` passed.

Follow-up:
- D1-006 should still tighten the sibling remote Docker context.

### 2026-05-13 - D1-006 - Tighten sibling remote Docker context

Status: Completed

Changed paths:
- `../aawm-tap-dashboard/.dockerignore`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Added a sibling remote `.dockerignore` so Docker builds exclude `node_modules`, `dist`, `coverage`, `reports`, `.env`, `.env.*`, and `npm-debug.log*`.
- This keeps the sibling `.env` out of the static remote image build now that TAP auth is handled by the shell-side proxy.
- Verification: `docker compose -f docker-compose.yml up --build -d` rebuilt `aawm-tap-dashboard:local` successfully after loading the new sibling `.dockerignore`.
- Runtime browser verification: headless Chrome rendered `http://127.0.0.1:3005/aawm-tap/overview` and `http://127.0.0.1:3006/aawm-tap/overview` with `Overview` and no module-loading error markers.

Follow-up:
- Keep real TAP credentials in shell/server-side environment variables, not sibling `VITE_*` variables.

### 2026-05-13 - D1-011 - Revise General usage report and shell TAP auth proxy

Status: Completed

Changed paths:
- `.env`
- `.env.example`
- `README.md`
- `docker-compose.dev.yml`
- `docker-compose.yml`
- `nginx.conf`
- `server/report-service.mjs`
- `src/features/dashboard/api/usage-report.ts`
- `src/features/dashboard/components/usage-report-dashboard.tsx`
- `vite.config.ts`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Replaced the General dashboard's quota-low-points panel with a provider quota panel showing short, weekly, and special quota state from `public.rate_limit_intervals`.
- Removed the Usage Slices table from the General dashboard.
- Changed the token trend to use provider-colored stacked bars over the full selected range, backed by a dedicated trend query grouped by bucket, provider, model, and repository.
- Added tooltip breakdowns showing model/repository percentages within each provider segment.
- Added latest-record freshness metadata from `MAX(public.session_history.created_at)` with a warning threshold of two hours.
- Moved `/api/aawm-tap/*` through `server/report-service.mjs`; the shell proxy strips browser-sent `Authorization`, `Cookie`, and `X-API-Key` headers, then injects server-side `AAWM_TAP_API_KEY`/`AAWM_TAP_ACCESS_TOKEN` when configured.
- Copied the sibling `VITE_TAP_API_KEY` value into this repo's ignored `.env` as `AAWM_TAP_API_KEY` without printing the value.
- Updated dev compose so the sibling remote dev container blanks `VITE_TAP_API_KEY` and related `VITE_*` auth values, preventing those `.env` values from being pulled into the browser bundle in the containerized dev path.
- Verification: `node --check server/report-service.mjs` passed.
- Verification: `docker compose -f docker-compose.yml config` passed before the local `.env` key was copied.
- Verification: `docker compose -f docker-compose.dev.yml config` passed before the local `.env` key was copied.
- Verification: `pnpm lint` passed.
- Verification: `pnpm build` passed.
- Runtime stack verification: `docker compose -f docker-compose.yml up --build -d` rebuilt and started the static stack.
- Runtime stack verification: `docker compose -f docker-compose.dev.yml up -d --force-recreate` recreated and started the live dev stack after the static rebuild completed.
- Runtime report verification: `GET /api/shell/reports/usage?from=2026-04-01&to=2026-06-02&grain=day&limit=1` returned `trend: 880`, `quotas: 10`, `latestRecordStale: false`, and providers including `anthropic`, `gemini`, `openai`, `chatgpt`, and `openrouter` on both ports `3005` and `3006`.
- Runtime TAP proxy verification: `curl -sS -o /dev/null -w '3005 docs -> %{http_code}\n' http://127.0.0.1:3005/api/aawm-tap/docs` returned `3005 docs -> 200`.
- Runtime TAP proxy verification: `curl -sS -o /dev/null -w '3006 docs -> %{http_code}\n' http://127.0.0.1:3006/api/aawm-tap/docs` returned `3006 docs -> 200`.
- Runtime TAP auth verification: `curl -sS -o /dev/null -w '3005 admin domains -> %{http_code}\n' http://127.0.0.1:3005/api/aawm-tap/admin/domains` returned `3005 admin domains -> 200`.
- Runtime TAP auth verification: `curl -sS -o /dev/null -w '3006 admin domains -> %{http_code}\n' http://127.0.0.1:3006/api/aawm-tap/admin/domains` returned `3006 admin domains -> 200`.
- Runtime browser verification: headless Chrome rendered `http://127.0.0.1:3005/` and `http://127.0.0.1:3006/` with `General Dashboard`, `Token Trend`, `Provider Quota`, and `Latest record`, and without `Usage Slices`, `Quota Low Points`, or `Usage Report Unavailable`.

Follow-up:
- Remove any real TAP API key from `../aawm-tap-dashboard/.env` if it remains there; the shell proxy is now the credential boundary.

### 2026-05-13 - D1-012 - Refine provider quota labels and Google model classes

Status: Completed

Changed paths:
- `src/features/dashboard/components/usage-report-dashboard.tsx`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Changed the Provider Quota panel so Google renders as one provider card instead of per-model rows.
- The Google card breaks request quota into `Flash`, `Flash Lite`, and `Pro` model-class windows, selected from the Google model-specific short/request rows.
- Anthropic's special quota label now renders as `Sonnet`.
- OpenAI's special quota label now renders as `Codex Spark`.
- Runtime data verification: `GET /api/shell/reports/usage?from=2026-04-01&to=2026-06-02&grain=day&limit=1` returned Google rows for `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-2.5-pro`, `gemini-3.1-flash-lite-preview`, `gemini-3.1-pro-preview`, `gemini-3-flash-preview`, and `gemini-3-pro-preview`; weekly and special percentages were `null` for Google rows.
- Verification: `pnpm lint` passed.
- Verification: `pnpm build` passed.
- Runtime stack verification: `docker compose -f docker-compose.yml up --build -d dashboard-shell` rebuilt and restarted the static shell.
- Runtime browser verification: headless Chrome rendered `http://127.0.0.1:3005/` and `http://127.0.0.1:3006/` with `Provider Quota`, `Google`, `Flash`, `Flash Lite`, `Pro`, `Sonnet`, and `Codex Spark`, and without `Usage Report Unavailable`, `Quota Low Points`, or `Usage Slices`.

Follow-up:
- If Google adds more model-class pools, extend `googleQuotaClasses` and `googleQuotaClass()` in the General dashboard component.

### 2026-05-14 - D1-014 - Strip client admin capability in TAP proxy

Status: Completed

Changed paths:
- `server/report-service.mjs`
- `.analysis/completed.md`

Evidence:
- Added `x-admin-capability` to the shell proxy's stripped client auth header set so browser-sent admin capability headers cannot be forwarded alongside the server-side injected TAP admin capability.
- Preserved the existing server-side credential boundary: `server/report-service.mjs` still injects configured `AAWM_TAP_API_KEY`, `AAWM_TAP_ACCESS_TOKEN`, and `AAWM_TAP_ADMIN_CAPABILITY` after stripping browser credentials.
- Verification: `pnpm lint` passed.
- Verification: `pnpm build` passed.
- Runtime stack verification: `docker compose -f docker-compose.dev.yml restart dashboard-shell-reports-dev` restarted the live dev report proxy.
- Runtime stack verification: `docker compose -f docker-compose.yml up --build -d dashboard-shell-reports` rebuilt and restarted the static report proxy image.
- Container verification: `docker ps --filter name=dashboard-shell --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'` showed both `dashboard-shell-reports-dev` and `dashboard-shell-dashboard-shell-reports-1` running after restart.
- Proxy header verification: a local mock-target smoke against the actual `server/report-service.mjs` returned status `200` and showed the upstream received the server-side admin capability and API key, while client `Authorization` and `Cookie` were not forwarded.
- Live TAP caveat: bounded direct requests to `http://127.0.0.1:8010/admin/graph/status` timed out during verification, so the live TAP route could not be used as the final proof surface in this pass.

Follow-up:
- Re-run the live `/api/aawm-tap/admin/*` smoke when the TAP admin API is responding promptly again.

### 2026-05-14 - D1-013 - Source OpenAI Codex Spark quota data

Status: Completed

Changed paths:
- `server/report-service.mjs`
- `src/features/dashboard/api/usage-report.ts`
- `src/features/dashboard/components/usage-report-dashboard.tsx`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Added `short_special` to the provider quota query and normalized API payload as `short_special_remaining_pct`, `short_special_reset_at`, `short_special_interval_start`, `short_special_interval_end`, and `short_special_active`.
- Added row-level report aggregates for `short_special`: `short_reset_special_first`, `short_reset_special_last`, `min_short_pct_special`, and `max_short_pct_special`.
- Updated frontend report types and the Provider Quota panel so OpenAI renders four windows: `Short`, `Weekly`, `Codex Spark weekly`, and `Codex Spark short`.
- Kept Google grouped only by request-window model classes, so the new `short_special` bucket does not feed the Google Flash/Flash Lite/Pro card.
- Database source verification: `public.rate_limit_intervals` returned OpenAI `short`, `weekly`, `weekly_special`, and `short_special` rows; OpenAI `short_special` had 331 rows with latest interval start `2026-05-12T21:45:05.115Z`.
- Verification: `node --check server/report-service.mjs` passed.
- Verification: `pnpm lint` passed.
- Verification: `pnpm build` passed.
- Runtime stack verification: `docker compose -f docker-compose.dev.yml restart dashboard-shell-reports-dev` restarted the live dev report service.
- Runtime stack verification: `docker compose -f docker-compose.yml up --build -d dashboard-shell dashboard-shell-reports` rebuilt and restarted the static shell/report stack.
- Runtime API verification: both `3005` and `3006` report APIs returned OpenAI `weekly_remaining_pct: 58`, `short_remaining_pct: 90`, `special_remaining_pct: 0`, and `short_special_remaining_pct: 5`, with all four active.
- Runtime browser verification: headless Chrome rendered `Provider Quota`, `Codex Spark weekly`, and `Codex Spark short` on both `http://127.0.0.1:3005/` and `http://127.0.0.1:3006/` without `Usage Report Unavailable`.

Follow-up:
- If OpenAI later splits Codex Spark windows by model, revisit the `provider, model, quota_type` partitioning in `buildQuotaQuery()`.

### 2026-05-14 - D1-015 - Shorten OpenAI Spark quota labels

Status: Completed

Changed paths:
- `src/features/dashboard/components/usage-report-dashboard.tsx`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Renamed the visible OpenAI quota labels from `Codex Spark weekly` and `Codex Spark short` to `Spark weekly` and `Spark short`.
- Updated the active context note so future dashboard work uses the shorter label wording.
- Verification: `pnpm lint` passed.
- Verification: `pnpm build` passed.
- Runtime stack verification: `docker compose -f docker-compose.yml up --build -d --no-deps dashboard-shell` rebuilt and restarted only the static shell container.
- Runtime browser verification: headless Chrome rendered `Spark weekly` and `Spark short` on both `http://127.0.0.1:3005/` and `http://127.0.0.1:3006/`, with no `Codex Spark` match in the checked dashboard text.

Follow-up:
- Keep the shorter `Spark` wording unless the quota source itself needs a more specific product label.

### 2026-05-14 - D1-016 - Improve token trend hover breakdown

Status: Completed

Changed paths:
- `src/features/dashboard/components/usage-report-dashboard.tsx`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Added provider and model/repository USD cost totals to the Token Trend hover breakdown using the existing `usd_cost` trend rows.
- Bounded the hover panel to an internal scroll area and pinned it near the top of the chart so long provider/model breakdowns no longer grow downward past the viewport.
- Reused the Recharts provider colors as a left border, dot, and tinted provider header background for each provider section.
- Verification: `pnpm lint` passed.
- Verification: `pnpm build` passed.
- Runtime stack verification: `docker compose -f docker-compose.yml up --build -d --no-deps dashboard-shell` rebuilt and restarted only the static shell container.
- Runtime container verification: `docker ps --filter name=dashboard-shell --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'` showed static shell on `3005` and dev shell on `3006` running.
- Runtime HTTP verification: `curl -I http://127.0.0.1:3005/` and `curl -I http://127.0.0.1:3006/` both returned `200 OK`.
- Runtime browser verification: headless Chrome rendered `http://127.0.0.1:3005/`, hovered a Token Trend bar, and observed `includesCurrency: true`, provider row border/background colors matching chart series colors, and `visibleWithinViewport: true` with tooltip bounds `y: 565`, `height: 320`, `bottom: 885` in a `1000px` viewport.

Follow-up:
- If the breakdown grows beyond comfortable tooltip scanning, consider adding an explicit provider/model drilldown panel instead of further increasing tooltip density.

### 2026-05-14 - D1-017 - Move repository drilldown into daily repository chart

Status: Completed

Changed paths:
- `src/features/dashboard/components/usage-report-dashboard.tsx`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Changed the Token Trend hover back to a mouse-tracking Recharts tooltip by removing the fixed tooltip position and scroll-bounded tooltip content.
- Kept provider/model cost detail in the Token Trend hover, but removed repository rows from that hover.
- Set chart tooltip wrappers to `pointer-events: none` so the tooltip itself does not become an interactive hover target.
- Added a Repository Trend stacked bar chart that shows daily token breakdown by repository, with a separate repository color palette and an `Other` bucket after the top repository series.
- The repository chart reuses the existing `trend` payload when the selected grain is `day`; for week/month provider grain, it fetches a second daily report so repository breakdown remains per day.
- Verification: `pnpm lint` passed.
- Verification: `pnpm build` passed.
- Runtime stack verification: `docker compose -f docker-compose.yml up --build -d --no-deps dashboard-shell` rebuilt and restarted only the static shell container.
- Runtime HTTP verification: `curl -I http://127.0.0.1:3005/` and `curl -I http://127.0.0.1:3006/` both returned `200 OK`.
- Runtime browser verification: headless Chrome rendered `http://127.0.0.1:3005/` with `Repository Trend`, two data charts, and repository legend entries including `aawm`, `aawm-tap`, `aegis`, `litellm`, `unknown`, and `Other`.
- Runtime hover verification: the Token Trend tooltip returned `hasScrollClass: false`, `containsRepositoryDelimiter: false`, `includesCurrency: true`, and `wrapperPointerEvents: "none"`.
- Runtime repository-chart hover verification: hovering the repository chart returned a tooltip with known repository names, daily percentages/token totals, USD cost, and `pointerEvents: "none"`.

Follow-up:
- If repository cardinality grows, tune `MAX_REPOSITORY_SERIES` or add a repository filter instead of expanding the legend indefinitely.

### 2026-05-14 - D1-018 - Add provider-colored quota usage bars

Status: Completed

Changed paths:
- `server/report-service.mjs`
- `src/features/dashboard/api/usage-report.ts`
- `src/features/dashboard/components/usage-report-dashboard.tsx`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Extended the Provider Quota query to compute tokens used since each selected reset window, with model-level token/cost/trace breakdowns for weekly, 5-hour, special, and Spark 5-hour windows.
- Applied the requested window semantics: OpenAI/Anthropic short windows use 5 hours, weekly windows use 7 days, Google model request windows use 24 hours, Anthropic special usage is Sonnet-only while still included in general Anthropic usage, and OpenAI Spark usage is excluded from general OpenAI weekly/5-hour buckets.
- Added typed quota usage breakdown fields to the report API contract.
- Updated Provider Quota cards to reuse the Token Trend provider colors, avoiding red/green/yellow chart palettes; OpenAI is `#2563eb`, Anthropic is `#7c3aed`, and Google/Gemini is `#0891b2` for the verified live data ordering.
- Renamed OpenAI/Anthropic `Short` labels to `5-Hour` and OpenAI short-special to `Spark 5-Hour`.
- Added a `tokens since reset` model-colored horizontal usage bar under each quota window.
- Verification: `node --check server/report-service.mjs` passed.
- Verification: `pnpm lint` passed.
- Verification: `pnpm build` passed.
- Runtime stack verification: `docker compose -f docker-compose.yml up --build -d --no-deps dashboard-shell dashboard-shell-reports` rebuilt and restarted the static shell/report stack.
- Runtime stack verification: `docker compose -f docker-compose.dev.yml restart dashboard-shell-reports-dev` restarted the live dev report service.
- Runtime stack verification after the final JSX cleanup: `docker compose -f docker-compose.yml up --build -d --no-deps dashboard-shell` rebuilt the static shell image from the current working tree.
- Runtime health verification: `curl -sS -o /dev/null -w '3005 %{http_code}\n' http://127.0.0.1:3005/api/shell/health` and the same command on `3006` both returned `200`.
- Runtime API verification: both `3005` and `3006` report APIs returned `quotas: 10`, `trendRows: 930`, `latestRecordStale: false`, and latest record `2026-05-14T12:02:32.136Z`.
- Runtime API verification: OpenAI general weekly/5-hour usage had `generalHasSpark=false`, while Spark weekly and Spark 5-hour usage contained only `gpt-5.3-codex-spark`; Anthropic special usage returned `anthropic specialOnlySonnet=true`.
- Runtime API verification: Google rows returned 24-hour model usage for request windows, including `gemini-2.5-flash` and `gemini-3.1-flash-lite-preview` in the verified response.
- Runtime browser verification: headless Chrome rendered `http://127.0.0.1:3005/` with `Token Trend`, `Provider Quota`, `Repository Trend`, `5-Hour`, `Spark 5-Hour`, and repeated `tokens since reset` labels.
- Runtime browser color verification: the rendered Token Trend used non-red/green/yellow fills such as `#2563eb`, `#7c3aed`, and `#0891b2`; the Provider Quota cards rendered matching left borders `rgb(37, 99, 235)`, `rgb(124, 58, 237)`, and `rgb(8, 145, 178)`.
- Runtime network verification: `docker inspect dashboard-shell-dashboard-shell-1 dashboard-shell-dashboard-shell-reports-1 dashboard-shell-dev dashboard-shell-reports-dev --format '{{.Name}} {{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'` returned shell containers on `aawm-tap_default` and report containers on `aawm-tap_default aawm_default`.

Follow-up:
- If OpenAI or Anthropic adds non-name-based quota classifications, replace the current model-name matching for `spark` and `sonnet` with a stable server-side quota class.

### 2026-05-14 - D1-019 - Add sidebar quota summary and quota bar hovers

Status: Completed

Changed paths:
- `server/report-service.mjs`
- `src/components/layout/app-sidebar.tsx`
- `src/components/layout/sidebar-quota-remaining.tsx`
- `src/features/dashboard/api/usage-report.ts`
- `src/features/dashboard/components/usage-report-dashboard.tsx`
- `src/features/dashboard/lib/usage-report-display.ts`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Added `GET /api/shell/reports/quotas` so the sidebar can render quota state without loading the full usage report payload.
- Added a live left-sidebar quota visual in `SidebarFooter` above the user menu, showing OpenAI Weekly/Spark, Anthropic Weekly/Sonnet, and Gemini Flash/Lite/Pro percent remaining.
- Moved provider/model/repository chart color helpers into `src/features/dashboard/lib/usage-report-display.ts` and made provider colors stable by provider key, keeping OpenAI blue, Anthropic purple, and Google/Gemini cyan across Token Trend, Provider Quota, and the sidebar.
- Changed the General dashboard grid so Provider Quota spans alongside both Token Trend and Repository Trend, reducing the Token Trend height from `390px` to `320px`.
- Reordered OpenAI Provider Quota to `5-Hour`, `Weekly`, then `Spark 5-Hour`, `Spark weekly`, so both rows read 5-hour then weekly.
- Added the Spark reset display rule: if Spark weekly remaining is `0` and Spark 5-hour reset is earlier than the Spark weekly reset, the Spark 5-hour cell displays the Spark weekly reset instead.
- Added a hover popup on each Provider Quota token usage bar showing model-level percent, token total, and USD cost.
- Verification: `node --check server/report-service.mjs` passed.
- Verification: `pnpm lint` passed.
- Verification: `pnpm build` passed.
- Runtime stack verification: `docker compose -f docker-compose.yml up --build -d --no-deps dashboard-shell dashboard-shell-reports` rebuilt and restarted the static shell/report stack.
- Runtime stack verification: `docker compose -f docker-compose.dev.yml restart dashboard-shell-reports-dev` restarted the live dev report service.
- Runtime quota endpoint verification: `curl -sS -o /tmp/dashboard-shell-3005-quotas.json -w '3005 quotas %{http_code}\n' http://127.0.0.1:3005/api/shell/reports/quotas` and the same command on `3006` both returned `200`.
- Runtime quota data verification: both ports returned `quotas: 10`, latest record `2026-05-14T12:25:53.782Z`, OpenAI weekly `49`, OpenAI Spark weekly `0`, Anthropic weekly `5`, Anthropic Sonnet `28`, and Google model rows for Flash/Lite/Pro classes.
- Runtime browser verification: headless Chrome rendered `http://127.0.0.1:3005/` with sidebar labels `OpenAI Weekly`, `OpenAI Spark`, `Anthropic Weekly`, `Anthropic Sonnet`, `Gemini Flash`, `Gemini Lite`, and `Gemini Pro`.
- Runtime browser verification: headless Chrome rendered `Provider Quota`, `Token Trend`, and `Repository Trend`; Provider Quota bounds spanned from `top: 490` to `bottom: 1418`, matching the combined Token Trend and Repository Trend right-side height.
- Runtime browser verification: OpenAI rendered `Spark 5-Hour` before `Spark weekly`, and because Spark weekly was `0` while the Spark 5-hour reset was earlier, the rendered Spark 5-hour reset displayed `May 18`, matching the Spark weekly reset.
- Runtime hover verification: a CDP-driven hover over a Provider Quota usage bar found `10` hoverable reset bars and opened a tooltip with model-level rows including `gemini-3-flash-preview`, `98.4% / 5.5M`, and `$2.57`.
- Runtime network verification: `docker inspect dashboard-shell-dashboard-shell-1 dashboard-shell-dashboard-shell-reports-1 dashboard-shell-dev dashboard-shell-reports-dev --format '{{.Name}} {{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'` returned shell containers on `aawm-tap_default` and report containers on `aawm-tap_default aawm_default`.

Follow-up:
- If the sidebar quota visual becomes too dense after more providers are added, split it into provider-filtered compact groups instead of expanding the footer height further.

### 2026-05-14 - D1-020 - Publish tap UI contract and consume module accent color

Status: Completed

Changed paths:
- `README.md`
- `docs/tap-ui-contract.md`
- `package.json`
- `scripts/scaffold-tap.mjs`
- `src/lib/accent-color.ts`
- `src/components/layout/data/sidebar-data.ts`
- `src/components/layout/nav-group.tsx`
- `src/components/layout/team-switcher.tsx`
- `src/components/layout/top-nav.tsx`
- `src/components/layout/types.ts`
- `src/shell/aawm-tap-dashboard.tsx`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Addressed the shell aesthetics review's P0 items by documenting the current vendor-and-sync component-sharing model, the runtime CSS-variable contract, dark-mode expectations, manifest field semantics, and starter scaffolding path in `docs/tap-ui-contract.md`.
- Added `pnpm scaffold:tap`, which creates a tap starter with vendored shell shadcn primitives, `theme.css`, `cn()` helper, Module Federation `module.ts`, standalone entrypoint, and an ESLint rule that rejects JSX inline `style` attributes in tap page code.
- Shell chrome now consumes `accentColor`: the remote header module icon uses the manifest accent, top nav links receive accent active/hover styling, the static AAWM TAP sidebar group carries the same accent, and the team switcher can render accented team icons.
- The remote header now uses `module.navItems` labels before falling back to route-derived labels, making that manifest field visible in shell chrome.
- Verification: `node --check scripts/scaffold-tap.mjs` passed.
- Verification: `pnpm scaffold:tap /tmp/dashboard-shell-tap-starter-smoke-019e2695b --module-id smoke-dashboard --name Smoke --base-path /smoke` created a starter with `src/components/ui`, `src/styles/theme.css`, `src/module.ts`, and `@tailwindcss/vite` included in the generated package.
- Verification: `pnpm lint` passed.
- Verification: `pnpm build` passed.
- Verification: `git diff --check` passed.
- Runtime stack verification: `docker compose -f docker-compose.yml up --build -d --no-deps dashboard-shell` rebuilt and restarted the static shell container.
- Runtime HTTP verification: `curl -sS -o /dev/null -w '3005 %{http_code}\n' http://127.0.0.1:3005/aawm-tap/overview` and the same check on `3006` both returned `200`.
- Runtime browser verification: headless Chrome rendered `http://127.0.0.1:3005/aawm-tap/overview` and `http://127.0.0.1:3006/aawm-tap/overview`; both DOMs contained `Overview`, `--module-accent: hsl(220 70% 50%)`, `--nav-accent: hsl(220 70% 50%)`, and `--top-nav-accent: hsl(220 70% 50%)`, without `Usage Report Unavailable`, `Dashboard module failed to load`, `Unable to load module`, or `Error loading dashboard module`.
- Runtime browser verification: headless Chrome rendered `http://127.0.0.1:3005/` with `General Dashboard`, `Provider Quota`, `Token Trend`, and `Repository Trend`, without the same failure markers.

Follow-up:
- D1-004 still owns replacing the remaining static sidebar/command-menu demo data with a true module-registry adapter; this pass only threaded the existing AAWM TAP accent through the static sidebar data.

### 2026-05-14 - D1-021 - Make trend chart hover panels viewport-bounded

Status: Dead end / reopened by D1-022

Reopened reason:
- User feedback after verification showed the viewport-bounded fixed panel still occupied too much of the screen and felt worse than the original issue. D1-022 replaces this pattern with inline chart detail sections.

Changed paths:
- `src/features/dashboard/components/usage-report-dashboard.tsx`
- `.analysis/verify-trend-tooltips.mjs`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Replaced the Token Trend and Repository Trend Recharts tooltip wrappers with dashboard-controlled fixed hover panels using the last active bar payload.
- The trend hover surface now spans from `top-[4.75rem]` to `bottom-3`, uses `overflow-y-auto`, and expands to `sm:w-[min(58rem,calc(100vw-2rem))]` on wider screens while staying inset on mobile.
- Added pointer-aware delayed close behavior so moving from a bar into the panel does not switch bars or clear the active breakdown before the user can inspect or scroll it.
- Kept the Token Trend panel focused on provider/model token and USD cost breakdowns, while the Repository Trend panel shows repository/day token and USD cost breakdowns.
- Verification: `pnpm lint` passed.
- Verification: `pnpm build` passed.
- Runtime stack verification: `docker compose -f docker-compose.yml up --build -d --no-deps dashboard-shell` rebuilt and restarted the static shell container.
- Runtime HTTP verification: `curl -sS -o /dev/null -w '3005 %{http_code}\n' http://127.0.0.1:3005/` returned `3005 200`; the same check on `3006` returned `3006 200`.
- Runtime browser verification: `node .analysis/verify-trend-tooltips.mjs http://127.0.0.1:3005/ http://127.0.0.1:9222 1440 760` passed with both trend panels `fixed`, `viewportBounded`, `overflowAuto`, `pointerTargetable`, `widthExpanded`, `scrollableWhenNeeded`, and `stableAfterPointerMove`.
- Runtime browser verification: `node .analysis/verify-trend-tooltips.mjs http://127.0.0.1:3005/ http://127.0.0.1:9222 390 720` passed with the same checks for the narrow viewport.

Follow-up:
- Obsolete after D1-022; do not revive the fixed panel pattern without fresh user approval.

### 2026-05-14 - D1-022 - Replace trend hover panels with inline chart detail sections

Status: Completed

Changed paths:
- `src/features/dashboard/components/usage-report-dashboard.tsx`
- `.analysis/verify-dashboard-general-ui.mjs`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Removed the controlled fixed trend hover panel path for Token Trend and Repository Trend.
- Added inline detail sections underneath both charts; the sections update from the hovered bar and default to the latest rendered bucket when no bar has been hovered yet.
- Kept Token Trend detail focused on provider/model token share and USD cost, and Repository Trend detail focused on repository/day token share and USD cost.
- Sorted Provider Quota cards as OpenAI, Anthropic, then Google.
- Made Provider Quota model lists render as vertical rows and title-cased `Spark Weekly`.
- Added `.analysis/verify-dashboard-general-ui.mjs` to CDP-smoke the inline detail layout, absence of fixed trend panels, provider ordering, and OpenAI model-row layout.
- Verification: `node --check .analysis/verify-dashboard-general-ui.mjs` passed.
- Verification: `pnpm lint` passed.
- Verification: `pnpm build` passed.
- Runtime stack verification: `docker compose -f docker-compose.yml up --build -d --no-deps dashboard-shell` rebuilt and restarted the static shell container.
- Runtime HTTP verification: `curl -sS -o /dev/null -w '3005 %{http_code}\n' http://127.0.0.1:3005/` returned `3005 200`; the same check on `3006` returned `3006 200`.
- Runtime report verification: `curl -sS -o /dev/null -w '3005 report %{http_code}\n' http://127.0.0.1:3005/api/shell/reports/usage` returned `3005 report 200`; the same check on `3006` returned `3006 report 200`.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3005/ http://127.0.0.1:9222 1440 760` passed with both trend details inline, not viewport-sized, overflow-bounded, no fixed trend panels, Provider Quota ordered `openai`, `anthropic`, `google`, and OpenAI model rows vertical.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3005/ http://127.0.0.1:9222 390 720` passed with the same checks at narrow viewport.

### 2026-05-14 - D1-023 - Make Token Trend model breakouts single-column

Status: Completed

Changed paths:
- `src/features/dashboard/components/usage-report-dashboard.tsx`
- `.analysis/verify-dashboard-general-ui.mjs`
- `.analysis/completed.md`

Evidence:
- Changed the Token Trend inline detail so provider groups render full-width and each model row renders on its own line.
- Added a browser-smoke assertion that Token Trend model rows have unique vertical positions instead of sharing the same visual line.
- Verification: `node --check .analysis/verify-dashboard-general-ui.mjs` passed.
- Verification: `pnpm lint` passed.
- Verification: `pnpm build` passed.
- Runtime stack verification: `docker compose -f docker-compose.yml up --build -d --no-deps dashboard-shell` rebuilt and restarted the static shell container.
- Runtime HTTP verification: `curl -sS -o /dev/null -w '3005 %{http_code}\n' http://127.0.0.1:3005/` returned `3005 200`; the same check on `3006` returned `3006 200`.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3005/ http://127.0.0.1:9222 1440 760` passed with `Token Trend: modelRowsVertical`.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3005/ http://127.0.0.1:9222 390 720` passed with `Token Trend: modelRowsVertical`.

### 2026-05-14 - D1-024 - Resolve UI a11y state and tooling audit

Status: Completed

Changed paths:
- `Dockerfile`
- `Dockerfile.report-service`
- `docker-compose.yml`
- `docker-compose.dev.yml`
- `eslint.config.js`
- `nginx.conf`
- `package.json`
- `pnpm-lock.yaml`
- `server/package.json`
- `server/pnpm-lock.yaml`
- `server/report-service.mjs`
- `src/components/layout/data/sidebar-data.ts`
- `src/components/layout/nav-user.tsx`
- `src/components/layout/sidebar-quota-remaining.tsx`
- `src/components/layout/team-switcher.tsx`
- `src/components/layout/types.ts`
- `src/components/profile-dropdown.tsx`
- `src/components/ui/calendar.tsx`
- `src/components/ui/form.tsx`
- `src/components/ui/sidebar.tsx`
- `src/components/ui/sonner.tsx`
- `src/features/dashboard/components/usage-report-dashboard.tsx`
- `src/features/dashboard/lib/usage-report-display.ts`
- `src/lib/accent-color.ts`
- `src/routes/_authenticated/aawm-tap/$page.tsx`
- `src/shell/aawm-tap-dashboard.tsx`
- `vite.config.ts`
- `.analysis/verify-dashboard-general-ui.mjs`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Added accessible names/descriptions to the Token Trend and Repository Trend Recharts chart SVGs and extended `.analysis/verify-dashboard-general-ui.mjs` to assert chart `role="img"`, `aria-label`, `<title>`, and `<desc>` in browser smoke tests.
- Removed the upstream shadcn template identity from `ProfileDropdown`, made avatars optional, and kept the rendered shell free of `satnaing`, `satnaingdev`, `/avatars/shadcn.jpg`, and `@shadcn`.
- Changed TeamSwitcher to derive the active team from `useLocation().pathname`, route team entries through `Link`, and removed fake command shortcuts / no-op Add Team UI.
- Changed report date inputs to draft state with blur/Enter/Apply commits, and replaced hardcoded report defaults with a rolling prior-month-to-tomorrow range in both client and server.
- Added sidebar quota progressbar semantics and changed the collapsed quota trigger to a real button.
- Removed the TAP remote hardcoded `isAdmin: false` / `userId: 'dashboard-shell'` props and added AAWM TAP route param/search validation.
- Replaced `color-mix(in oklab, ...)` accent backgrounds with generated `rgb(... / alpha)` or `hsl(... / alpha)` fallback-safe values.
- Deduplicated Google quota class helpers into `src/features/dashboard/lib/usage-report-display.ts`.
- Added TAP proxy upstream fetch timeout, stripped incoming `x-admin-capability`, added SIGINT shutdown handling, and configured nginx proxy timeouts.
- Added Docker healthchecks and `depends_on.condition: service_healthy` for static and dev shell/report/remote services.
- Renamed the package to `dashboard-shell`, set `private: true`, moved `pg`, `@tailwindcss/vite`, and `tailwindcss` out of root production dependencies, and added `server/package.json` plus `server/pnpm-lock.yaml` so the report-service image installs only `pg` at runtime.
- Removed `src/components/ui` from ESLint ignores and fixed the newly exposed lint errors in vendored UI components without restoring the ignore.
- Verification: `node --check server/report-service.mjs` passed.
- Verification: `node --check scripts/scaffold-tap.mjs` passed.
- Verification: `node --check .analysis/verify-dashboard-general-ui.mjs` passed.
- Verification: `docker compose -f docker-compose.yml config` passed.
- Verification: `docker compose -f docker-compose.dev.yml config` passed.
- Verification: `pnpm lint` passed with four existing React Fast Refresh warnings in shadcn UI exports and no errors.
- Verification: `pnpm build` passed.
- Verification: `git diff --check` passed.
- Verification: `docker build -t dashboard-shell-reports:local -f Dockerfile.report-service .` passed and installed `Packages: +14` with runtime dependency `pg 8.20.0`.
- Runtime stack verification: `docker compose -f docker-compose.yml up --build -d dashboard-shell dashboard-shell-reports aawm-tap-dashboard` rebuilt all static services and waited for healthy report/remote dependencies before starting the shell.
- Runtime stack verification: `docker compose -f docker-compose.dev.yml up -d --force-recreate dashboard-shell-dev dashboard-shell-reports-dev aawm-tap-dashboard-dev` recreated the live dev services.
- Runtime container verification: `docker ps --filter name=dashboard-shell --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'` showed static shell, static report, static AAWM TAP remote, dev shell, dev report, and dev AAWM TAP remote all healthy.
- Runtime HTTP verification: root, usage report, quota report, and TAP admin proxy endpoints returned `200` on both `http://127.0.0.1:3005` and `http://127.0.0.1:3006`.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3005/ http://127.0.0.1:9222 1440 760` passed with inline trend details, provider order OpenAI/Anthropic/Google, chart a11y labels, sidebar progressbar semantics, and no template identity.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3005/ http://127.0.0.1:9222 390 720` passed with inline trend details, chart a11y labels, provider order, and no fixed trend panels.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3006/ http://127.0.0.1:9222 1440 760` passed with the same checks against the live dev shell.

Follow-up:
- D1-004 still owns replacing the remaining static demo routes/nav groups with a true registry-backed shell data adapter.

### 2026-05-14 - D1-025 - Add client token usage pie chart

Status: Completed

Changed paths:
- `server/report-service.mjs`
- `src/features/dashboard/api/usage-report.ts`
- `src/features/dashboard/components/usage-report-dashboard.tsx`
- `src/features/dashboard/lib/usage-report-display.ts`
- `.analysis/verify-dashboard-general-ui.mjs`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Added a bounded `clients` slice to `GET /api/shell/reports/usage`, aggregated by `client_name` and `client_version`, with trace count, token total, and USD cost.
- Added a `Client Usage` pie chart under Provider Quota. The pie groups token count by client, caps visible clients, and folds the tail into `Other`.
- Added an inline detail panel below the pie that updates on slice hover or focus and lists client-version token share, token total, cost, and traces.
- Added client color helpers using the same non-red/yellow/green palette rules as the rest of the dashboard.
- Extended `.analysis/verify-dashboard-general-ui.mjs` to assert the Client Usage chart renders, has chart title/description accessibility labels, and updates inline client-version detail without fixed hover panels.
- Verification: `node --check server/report-service.mjs` passed.
- Verification: `pnpm lint` passed with the existing four shadcn Fast Refresh warnings and no errors.
- Verification: `pnpm build` passed.
- Verification: `pnpm precommit:run` passed.
- Verification: `git diff --check` passed.
- Runtime stack verification: `docker compose -f docker-compose.yml up --build -d dashboard-shell dashboard-shell-reports` rebuilt and restarted the static shell/report stack.
- Runtime stack verification: `docker compose -f docker-compose.dev.yml restart dashboard-shell-reports-dev dashboard-shell-dev` restarted the live dev services.
- Runtime API verification: `curl -sS --max-time 30 -o /tmp/dashboard-usage-3005.json -w '3005 usage %{http_code}\n' http://127.0.0.1:3005/api/shell/reports/usage` returned `3005 usage 200`; parsed JSON showed `clients: 250`, `quotas: 11`, `trend: 962`, and top client row `codex-tui` version `0.125.0`.
- Runtime API verification: the same usage report check on `http://127.0.0.1:3006` returned `3006 usage 200` with the same `clients`, `quotas`, and `trend` counts.
- Runtime health verification: `curl -sS -o /dev/null -w '3005 health %{http_code}\n' http://127.0.0.1:3005/api/shell/health` and the same check on `3006` both returned `200`.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3005/ http://127.0.0.1:9222 1440 760` passed and observed Client Usage detail switching from `codex-tui` to `claude-cli` after hovering a pie slice.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3005/ http://127.0.0.1:9222 390 720` passed with Client Usage detail rendered inline at mobile width.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3006/ http://127.0.0.1:9222 1440 760` passed against the live dev shell.

Follow-up:
- The TAP proxy `/api/aawm-tap/docs` check timed out with `504` during this pass, which appears unrelated to the client chart because `/api/shell/*` health/report routes and both shell UIs are healthy.

### 2026-05-14 - D1-026 - Configure sibling-style pre-commit hooks

Status: Completed

Changed paths:
- `.pre-commit-config.yaml`
- `.github/workflows/stale.yml`
- `.github/ISSUE_TEMPLATE/config.yml`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.prettierignore`
- `knip.config.ts`
- `netlify.toml`
- `package.json`
- `public/images/favicon.svg`
- `public/images/favicon_light.svg`
- `.analysis/completed.md`

Local checkout changes:
- Installed the generated Git hook at `.git/hooks/pre-commit`.

Evidence:
- Matched the sibling `../aawm-tap-dashboard/.pre-commit-config.yaml` shape with standard hygiene hooks, `gitleaks`, `actionlint`, TypeScript checking, ESLint, and Prettier.
- Omitted the sibling Vitest-related hook because `dashboard-shell` currently has no Vitest dependency or test script.
- Added `precommit:install` and `precommit:run` package scripts matching the sibling repo convention.
- Excluded `tsconfig.app.json` and `tsconfig.node.json` from strict `check-json` because they intentionally use TypeScript JSONC comments.
- Updated `.github/workflows/stale.yml` from `actions/stale@v5` to `actions/stale@v9` after `actionlint` rejected the old action runtime.
- The first full run applied `end-of-file-fixer` to existing files that were missing final newlines.
- Verification: `pre-commit install` completed with `pre-commit installed at .git/hooks/pre-commit`.
- Verification: `env PRE_COMMIT_HOME=/tmp/pre-commit-cache pre-commit run --all-files` passed.
- Verification: `pnpm precommit:run` passed.
- Verification: `git diff --check` passed.

### 2026-05-14 - D1-027 - Stabilize General trend and client hover layout

Status: Completed

Changed paths:
- `src/features/dashboard/components/usage-report-dashboard.tsx`
- `.analysis/verify-dashboard-general-ui.mjs`
- `.analysis/completed.md`

Evidence:
- Added active total-token labels over the hovered Token Trend and Repository Trend bars.
- Changed Token Trend and Repository Trend cards to flex their inline detail areas instead of leaving unused white space when the grid row is stretched by Provider Quota.
- Changed Token Trend provider detail groups and Repository Trend item groups to use responsive columns on wider layouts while keeping each model row on its own line within a provider group.
- Changed Client Usage version detail to a fixed-height scroll area so switching hovered clients no longer changes the page height or moves the pointer off the hovered target.
- Extended `.analysis/verify-dashboard-general-ui.mjs` to assert active bar total labels, responsive trend detail columns, per-provider model-row vertical layout, and stable Client Usage hover height.
- Verification: `node --check .analysis/verify-dashboard-general-ui.mjs` passed.
- Verification: `pnpm lint` passed with the existing four shadcn Fast Refresh warnings and no errors.
- Verification: `pnpm build` passed.
- Verification: `pnpm precommit:run` passed.
- Verification: `git diff --check` passed.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3006/ http://127.0.0.1:9222 1440 760` passed against the live dev shell.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3006/ http://127.0.0.1:9222 390 720` passed against the live dev shell.
- Runtime stack verification: `docker compose -f docker-compose.yml up --build -d dashboard-shell` rebuilt and restarted the static shell stack.
- Runtime HTTP verification: `curl -sS -o /dev/null -w '3005 root %{http_code}\n' http://127.0.0.1:3005/` returned `3005 root 200`; `/api/shell/health` returned `3005 health 200`.
- Runtime container verification: `docker ps --filter name=dashboard-shell --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'` showed the static shell, static report service, static AAWM TAP remote, live dev shell, live dev report service, and live dev AAWM TAP remote all healthy.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3005/ http://127.0.0.1:9222 1440 760` passed against the rebuilt static shell.

### 2026-05-14 - D1-028 - Apply OpenAI Spark weekly cap to Spark 5-Hour display

Status: Completed

Changed paths:
- `src/features/dashboard/components/usage-report-dashboard.tsx`
- `.analysis/verify-dashboard-general-ui.mjs`
- `.analysis/completed.md`

Evidence:
- Added an effective OpenAI Spark 5-Hour percent helper so when Spark Weekly is `0%`, Spark 5-Hour also displays `0%` regardless of the raw 5-hour interval value.
- Kept the existing Spark 5-Hour reset behavior that shows the Spark Weekly reset when Spark Weekly is exhausted and the 5-hour reset is earlier.
- Added quota value data attributes and a browser-smoke assertion that `Spark 5-Hour` follows `Spark Weekly` when the weekly value is `0%`.
- Verification: `node --check .analysis/verify-dashboard-general-ui.mjs` passed.
- Verification: `pnpm lint` passed with the existing four shadcn Fast Refresh warnings and no errors.
- Verification: `pnpm build` passed.
- Verification: `pnpm precommit:run` passed.
- Verification: `git diff --check` passed.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3006/ http://127.0.0.1:9222 1440 760` passed against the live dev shell and observed OpenAI `Spark 5-Hour` `0%` with `Spark Weekly` `0%`.
- Runtime stack verification: `docker compose -f docker-compose.yml up --build -d dashboard-shell` rebuilt and restarted the static shell stack.
- Runtime HTTP verification: `curl -sS -o /dev/null -w '3005 root %{http_code}\n' http://127.0.0.1:3005/` returned `3005 root 200`; `/api/shell/health` returned `3005 health 200`.
- Runtime container verification: `docker ps --filter name=dashboard-shell --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'` showed the static shell, static report service, static AAWM TAP remote, live dev shell, live dev report service, and live dev AAWM TAP remote all healthy.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3005/ http://127.0.0.1:9222 1440 760` passed against the rebuilt static shell and observed the same OpenAI Spark display behavior.

### 2026-05-14 - D1-029 - Replace repository trend chart with provider health metrics

Status: Completed

Changed paths:
- `server/report-service.mjs`
- `src/features/dashboard/api/usage-report.ts`
- `src/features/dashboard/components/usage-report-dashboard.tsx`
- `.analysis/verify-dashboard-general-ui.mjs`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Added `providerLatencyHealth` as a companion dataset on `/api/shell/reports/usage`, backed by `public.provider_latency_health_5m` from the same `DATABASE_URL` pool as the usage trend data.
- Verified the health source is a materialized view in `aawm_tristore` via `pg_class` (`relkind: m`) and that the 14-day window currently fits under the API cap.
- Removed the separate Repository Trend query/card from the General dashboard.
- Added repository token/cost breakdown rows under the Token Trend provider/model detail, using the existing trend payload grouped by provider/model/repository.
- Added a Health Metrics card in the old repository-trend slot with latest health bucket, request/error/rate-limit totals, a provider-colored daily upstream p95 latency chart, and provider/model summaries.
- Capped the Token Trend inline detail height on small viewports so the new repository breakout scrolls internally instead of stretching past the screen.
- Extended `.analysis/verify-dashboard-general-ui.mjs` to assert Token Trend repository breakout, Health Metrics rendering/chart a11y, and removal of the Repository Trend panel.
- Verification: `node --check server/report-service.mjs` passed.
- Verification: `node --check .analysis/verify-dashboard-general-ui.mjs` passed.
- Verification: `pnpm lint` passed with the existing four shadcn Fast Refresh warnings and no errors.
- Verification: `pnpm build` passed.
- Runtime stack update: restarted `dashboard-shell-reports-dev`, rebuilt/restarted the static shell/report stack with Docker Compose, and confirmed all dashboard-shell static/dev containers were healthy.
- Runtime API verification: `GET /api/shell/reports/usage?limit=1` returned `200` on both `3005` and `3006`, with `providerLatencyHealth: 8618`, providers `anthropic`, `gemini`, `nvidia_nim`, `openai`, and `openrouter`, and latest health bucket `2026-05-15T00:45:00.000Z`.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3006/ http://127.0.0.1:9222 1440 760` passed against the live dev shell.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3006/ http://127.0.0.1:9222 390 720` passed against the live dev shell.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3005/ http://127.0.0.1:9222 1440 760` passed against the rebuilt static shell.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3005/ http://127.0.0.1:9222 390 720` passed against the rebuilt static shell.

Follow-up:
- If the health materialized view grows beyond the current API cap, move the p95 trend aggregation server-side instead of increasing the raw row payload indefinitely.

### 2026-05-14 - D1-030 - Add quota-window health overlays and reflow repository details

Status: Completed

Changed paths:
- `server/report-service.mjs`
- `src/features/dashboard/api/usage-report.ts`
- `src/features/dashboard/components/usage-report-dashboard.tsx`
- `.analysis/verify-dashboard-general-ui.mjs`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Reflowed the Token Trend repository breakdown so each repository row separates the repository name from usage detail (`% / tokens / $`) instead of forcing both onto one cramped line.
- Added `providerErrorObservations` to `GET /api/shell/reports/usage`, sourced from capped 14-day `public.provider_error_observations` rows in the same `DATABASE_URL` database as trend and health data.
- Added a thin quota-window health timeline under each Provider Quota usage bar. The timeline maps `provider_latency_health_5m` latency samples into the relevant quota window and overlays larger vertical markers from raw provider error observations.
- Matched quota-window filtering to the existing quota semantics: OpenAI general buckets exclude Spark, OpenAI Spark buckets include Spark only, Anthropic Sonnet uses Sonnet models only, and Google windows map to Flash, Flash Lite, and Pro model classes.
- Added accessible labels to the health timelines and tooltip detail showing latency bucket count, provider error count, latest p95 latency, worst band, and recent error classes/models.
- Extended `.analysis/verify-dashboard-general-ui.mjs` to assert separate repository name/usage fields and Provider Quota health overlay rendering for OpenAI and Google.
- Verification: `node --check server/report-service.mjs` passed.
- Verification: `node --check .analysis/verify-dashboard-general-ui.mjs` passed.
- Verification: `pnpm lint` passed with the existing four shadcn Fast Refresh warnings and no errors.
- Verification: `pnpm build` passed.
- Verification: `pnpm precommit:run` passed.
- Verification: `git diff --check` passed.
- Runtime stack update: restarted `dashboard-shell-reports-dev` and rebuilt/restarted the static shell/report stack with Docker Compose.
- Runtime API verification: `GET /api/shell/reports/usage?limit=1` returned `200` on both `3005` and `3006`, with `trend: 989`, `providerLatencyHealth: 8656`, and `providerErrorObservations: 71`.
- Runtime container verification: `docker ps --filter name=dashboard-shell --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'` showed the static shell, static report service, static AAWM TAP remote, live dev shell, live dev report service, and live dev AAWM TAP remote all healthy.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3006/ http://127.0.0.1:9222 1440 760` passed against the live dev shell and observed quota health overlays including Anthropic error markers.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3006/ http://127.0.0.1:9222 390 720` passed against the live dev shell.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3005/ http://127.0.0.1:9222 1440 760` passed against the rebuilt static shell.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3005/ http://127.0.0.1:9222 390 720` passed against the rebuilt static shell.
- Cleanup verification: stopped the temporary headless Chrome process; `curl -sS http://127.0.0.1:9222/json/version` failed with connection refused as expected.

### 2026-05-14 - D1-031 - Add ultra-wide General dashboard layout and Claude client grouping

Status: Completed

Changed paths:
- `server/report-service.mjs`
- `src/features/dashboard/api/usage-report.ts`
- `src/features/dashboard/components/usage-report-dashboard.tsx`
- `src/features/dashboard/index.tsx`
- `src/styles/index.css`
- `.analysis/verify-dashboard-general-ui.mjs`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Changed the root General dashboard content to use the fluid `Main` layout so wide monitors can use available horizontal space.
- Added explicit responsive placement for the report layout: standard desktop keeps the existing stretched dashboard layout, `min-width: 1800px` uses three report columns, and `min-width: 2200px` uses four columns for Token Trend, Provider Quota, Client Usage, and Health Metrics.
- Kept Client Usage embedded under Provider Quota on standard widths and rendered it as a standalone card only on ultra-wide widths.
- Added `first_seen_at` to the server-side client usage query and API type, then changed client aggregation so `claude-code` and `claude-cli` roll up into one `Claude` slice.
- Sorted Client Usage version detail by descending first appearance date, with token count as the tie-breaker, and displayed the first-seen timestamp in the detail rows.
- Extended `.analysis/verify-dashboard-general-ui.mjs` to assert the ultra-wide Client Usage column, the `Claude` client collapse, first-seen sort order, and compact smoke output by default.
- Verification: `node --check server/report-service.mjs` passed.
- Verification: `node --check .analysis/verify-dashboard-general-ui.mjs` passed.
- Verification: `pnpm lint` passed with the existing four shadcn Fast Refresh warnings and no errors.
- Verification: `pnpm build` passed.
- Verification: `pnpm precommit:run` passed.
- Verification: `git diff --check` passed.
- Runtime stack update: `docker compose -f docker-compose.yml up --build -d --no-deps dashboard-shell dashboard-shell-reports` rebuilt and restarted the static shell/report stack without rebuilding the sibling remote.
- Runtime API verification: `GET /api/shell/reports/usage?limit=1` returned `200` on both `http://127.0.0.1:3005` and `http://127.0.0.1:3006`, with `clients: 250`, `first_seen_at: 2026-04-25T08:54:15.827Z`, and `trend: 1005`.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3006/ http://127.0.0.1:9222 1440 760` passed against the live dev shell.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3006/ http://127.0.0.1:9222 390 720` passed against the live dev shell.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3006/ http://127.0.0.1:9222 2300 900` passed against the live dev shell and asserted `ultraWideClientColumn`.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3005/ http://127.0.0.1:9222 1440 760` passed against the rebuilt static shell.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3005/ http://127.0.0.1:9222 390 720` passed against the rebuilt static shell.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3005/ http://127.0.0.1:9222 2300 900` passed against the rebuilt static shell and asserted `ultraWideClientColumn`.
- Runtime container verification: `docker ps --filter name=dashboard-shell --format '{{.Names}} {{.Status}} {{.Ports}}'` showed static shell, static report service, static AAWM TAP remote, live dev shell, live dev report service, and live dev AAWM TAP remote all healthy.
- Cleanup verification: stopped the temporary headless Chrome process; `curl -sS http://127.0.0.1:9222/json/version` failed with connection refused as expected.

Known unrelated blocker:
- The broad all-service static compose rebuild is still blocked by TypeScript errors in sibling `../aawm-tap-dashboard` (`useJobs.test.ts` and `PipelineDashboard.tsx` call sites expecting one argument). The shell/report-only rebuild above completed successfully.

### 2026-05-14 - D1-032 - Refine client grouping and quota health timelines

Status: Completed

Changed paths:
- `src/features/dashboard/components/usage-report-dashboard.tsx`
- `.analysis/verify-dashboard-general-ui.mjs`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Collapsed `codex-exec` and `codex-tui` into one Client Usage slice named `Codex`.
- Kept `claude-code` and `claude-cli` collapsed into `Claude`, and normalized Gemini client labels to `Gemini`.
- Renamed the provider quota card and quota overlays from Google-facing labels to Gemini-facing labels while keeping the underlying provider matching against `google`/`gemini` data.
- Removed the repeated `Provider quota state` subtitle from every provider quota card.
- Replaced the horizontal quota health strip with a vertical timeline. The top of the bar is current time, the bottom is the start of the known quota window, and each segment is a 5-minute increment colored from latency/probe/error health.
- Changed quota health windows to use the known duration ending at current time instead of volatile quota interval start/end rows, so recent Anthropic errors do not disappear when the active quota interval row refreshes.
- Added raw provider error markers into the vertical timeline and promoted affected 5-minute segments to the highest severity.
- Reduced cramped text in the 3-column layout by switching Token Trend details, repository details, Client Usage options, and Provider Quota values to auto-fit grids with minimum column widths.
- Extended `.analysis/verify-dashboard-general-ui.mjs` to assert `Codex` collapse, Gemini label normalization, no repeated provider subtitle, vertical quota health overlays, and marker counts in compact smoke output.
- Verification: `node --check server/report-service.mjs` passed.
- Verification: `node --check .analysis/verify-dashboard-general-ui.mjs` passed.
- Verification: `pnpm lint` passed with the existing four shadcn Fast Refresh warnings and no errors.
- Verification: `pnpm build` passed.
- Verification: `pnpm precommit:run` passed.
- Verification: `git diff --check` passed.
- Runtime API verification: `GET /api/shell/reports/usage?limit=1` on `3006` showed 22 Anthropic provider error observations in the last 5 hours, including `capacity_exhausted`, `auth_failed`, and `adapter_error` rows.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3006/ http://127.0.0.1:9222 2000 900` passed and showed vertical Anthropic quota markers (`Anthropic 5-Hour` marker count 11, `Anthropic Weekly` marker count 7).
- Runtime browser verification: the same smoke passed on `3006` at `390 720` and `2300 900`.
- Runtime stack update: `docker compose -f docker-compose.yml up --build -d --no-deps dashboard-shell dashboard-shell-reports` rebuilt and restarted the static shell/report stack.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3005/ http://127.0.0.1:9222 2000 900` passed and showed vertical Anthropic quota markers (`Anthropic 5-Hour` marker count 10, `Anthropic Weekly` marker count 7).
- Runtime browser verification: the same smoke passed on `3005` at `390 720` and `2300 900`.
- Runtime container verification: `docker ps --filter name=dashboard-shell --format '{{.Names}} {{.Status}} {{.Ports}}'` showed static shell, static report service, static AAWM TAP remote, live dev shell, live dev report service, and live dev AAWM TAP remote all healthy.
- Cleanup verification: stopped the temporary headless Chrome process; `curl -sS http://127.0.0.1:9222/json/version` failed with connection refused as expected.

### 2026-05-15 - D1-033 - Move Health Metrics into a General dashboard tab

Status: Completed

Changed paths:
- `src/features/dashboard/components/usage-report-dashboard.tsx`
- `src/styles/index.css`
- `.analysis/verify-dashboard-general-ui.mjs`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Split the General dashboard report body into `Usage` and `Health` tabs.
- Kept Token Trend, Provider Quota, and Client Usage on the `Usage` tab, with the ultra-wide layout reduced to the three remaining usage columns.
- Moved Health Metrics into its own full-width `Health` tab so the growing health panel no longer competes for main usage-grid space.
- Added a Health tab alert dot that uses `animate-pulse` and `bg-destructive` when recent health errors exist in the last 24 hours.
- Made the Health tab accessible by setting an `aria-label` that includes the recent-error count when the alert is present.
- Counted recent errors first from raw `provider_error_observations`, with aggregate `provider_latency_health_5m` event counts as the fallback.
- Extended `.analysis/verify-dashboard-general-ui.mjs` to switch tabs, verify the Health Metrics panel and chart labeling on the Health tab, and assert the blinking recent-error notification.
- Verification: `node --check server/report-service.mjs` passed.
- Verification: `node --check .analysis/verify-dashboard-general-ui.mjs` passed.
- Verification: `pnpm lint` passed with the existing four shadcn Fast Refresh warnings and no errors.
- Verification: `pnpm build` passed.
- Verification: `pnpm precommit:run` passed.
- Verification: `git diff --check` passed.
- Runtime stack update: `docker compose -f docker-compose.yml up --build -d --no-deps dashboard-shell dashboard-shell-reports` rebuilt and restarted the static shell/report stack.
- Runtime container verification: `docker ps --filter name=dashboard-shell --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"` showed the static shell, static report service, static AAWM TAP remote, live dev shell, live dev report service, and live dev AAWM TAP remote all healthy.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3006/ http://127.0.0.1:9222 390 720` passed against the live dev shell and observed `Health, 74 recent errors in the last 24 hours` with a blinking alert class.
- Runtime browser verification: the same smoke passed on `3006` at `2000 900` and `2300 900`.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3005/ http://127.0.0.1:9222 390 720` passed against the rebuilt static shell and observed `Health, 74 recent errors in the last 24 hours` with a blinking alert class.
- Runtime browser verification: the same smoke passed on `3005` at `2000 900` and `2300 900`.
- Cleanup verification: stopped the temporary headless Chrome process; `curl -sS http://127.0.0.1:9222/json/version` failed with connection refused as expected.

### 2026-05-15 - D1-034 - Let Client Usage use ultra-wide spare columns

Status: Completed

Changed paths:
- `src/features/dashboard/components/usage-report-dashboard.tsx`
- `src/styles/index.css`
- `.analysis/verify-dashboard-general-ui.mjs`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Changed the ultra-wide report grid so Token Trend keeps a usable minimum width, Provider Quota stays in column 2, and Client Usage spans from column 3 through any remaining auto-fit tracks.
- Changed standalone Client Usage to use a two-column internal layout on ultra-wide screens, with the pie/options row above a full-width version detail panel.
- Changed Client Usage version detail rows to an auto-fit grid so dense version lists use multiple columns instead of staying in one narrow column.
- Extended `.analysis/verify-dashboard-general-ui.mjs` to assert that ultra-wide Client Usage uses extra grid tracks and that version detail resolves to multiple columns.
- Corrected the Token Trend repository-breakdown smoke assertion to check the full detail text instead of a truncated text sample.
- Verification: `node --check .analysis/verify-dashboard-general-ui.mjs` passed.
- Verification: `pnpm lint` passed with the existing four shadcn Fast Refresh warnings and no errors.
- Verification: `pnpm build` passed.
- Verification: `pnpm precommit:run` passed.
- Verification: `git diff --check` passed.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3006/ http://127.0.0.1:9222 2300 900` passed against the live dev shell and asserted `versionDetailUsesWideColumns` plus `ultraWideClientUsesExtraTracks`.
- Runtime browser verification: the same smoke passed on `3006` at `390 720` and `2000 900`.
- Runtime stack update: `docker compose -f docker-compose.yml up --build -d --no-deps dashboard-shell dashboard-shell-reports` rebuilt and restarted the static shell/report stack.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3005/ http://127.0.0.1:9222 2300 900` passed against the rebuilt static shell and asserted `versionDetailUsesWideColumns` plus `ultraWideClientUsesExtraTracks`.
- Runtime browser verification: the same smoke passed on `3005` at `390 720` and `2000 900`.
- Runtime container verification: `docker ps --filter name=dashboard-shell --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"` showed the static shell, static report service, static AAWM TAP remote, live dev shell, live dev report service, and live dev AAWM TAP remote all healthy.
- Cleanup verification: stopped the temporary headless Chrome process; `curl -sS http://127.0.0.1:9222/json/version` failed with connection refused as expected.

Note:
- The health dataset includes control fields (`control_ping_avg_ms`, `control_packet_loss_pct`, `control_probe_success_pct`, and `provider_ping_minus_control_ms`), but the current shell UI does not yet use them as a baseline for general network latency. Current severity/display uses upstream/total/status/provider-ping latency, provider ping packet loss, probe success, and error counts.

### 2026-05-15 - D1-035 - Incorporate control latency into health attribution

Status: Completed

Changed paths:
- `src/features/dashboard/components/usage-report-dashboard.tsx`
- `.analysis/verify-dashboard-general-ui.mjs`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Added a health attribution layer that classifies buckets as `Network`, `Provider path`, `Provider API`, `Workload`, `Normal`, or `Unknown`.
- Used `control_ping_avg_ms`, `control_packet_loss_pct`, and `control_probe_success_pct` to identify general network degradation before blaming a provider.
- Used `provider_ping_minus_control_ms` and provider packet loss to identify provider-path degradation when the control probe is normal.
- Kept API/upstream events separate from network/path signals: provider errors, 5xx, timeouts, status probe failures, rate limits, capacity events, adapter errors, and high upstream p95 are still classified independently.
- Added Health tab summary values for `Control ping` and `Provider delta`.
- Added per-provider Health card fields for control ping, provider delta, control loss, control probe success, and provider path loss.
- Added per-provider attribution badges and attribution count summaries.
- Added quota health timeline attribution into the accessible label and tooltip detail, including likely cause, control ping, provider delta, and bucket counts by attribution layer.
- Extended `.analysis/verify-dashboard-general-ui.mjs` to assert Health tab control-baseline rendering and Provider Quota health overlay attribution labels.
- Verification: `node --check .analysis/verify-dashboard-general-ui.mjs` passed.
- Verification: `pnpm lint` passed with the existing four shadcn Fast Refresh warnings and no errors.
- Verification: `pnpm build` passed.
- Verification: `pnpm precommit:run` passed.
- Verification: `git diff --check` passed.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3006/ http://127.0.0.1:9222 390 720` passed against the live dev shell and asserted `hasControlBaseline` plus `healthOverlayAttribution`.
- Runtime browser verification: the same smoke passed on `3006` at `2000 900` and `2300 900`.
- Runtime stack update: `docker compose -f docker-compose.yml up --build -d --no-deps dashboard-shell dashboard-shell-reports` rebuilt and restarted the static shell/report stack.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3005/ http://127.0.0.1:9222 390 720` passed against the rebuilt static shell and asserted `hasControlBaseline` plus `healthOverlayAttribution`.
- Runtime browser verification: the same smoke passed on `3005` at `2000 900` and `2300 900`.
- Runtime container verification: `docker ps --filter name=dashboard-shell --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"` showed the static shell, static report service, static AAWM TAP remote, live dev shell, live dev report service, and live dev AAWM TAP remote all healthy.
- Cleanup verification: stopped the temporary headless Chrome process; `curl -sS http://127.0.0.1:9222/json/version` failed with connection refused as expected.

### 2026-05-15 - D1-036 - Move Client Usage into the third dashboard column

Status: Completed

Changed paths:
- `src/features/dashboard/components/usage-report-dashboard.tsx`
- `src/styles/index.css`
- `.analysis/verify-dashboard-general-ui.mjs`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Changed the Client Usage embedded panel to hide at the same `min-width: 1800px` breakpoint where the Usage tab becomes a 3-column layout.
- Changed the standalone Client Usage card to display at `min-width: 1800px`, so it occupies the third column instead of waiting for the `2200px` ultrawide layout.
- Kept the `2200px` behavior where Client Usage spans from the third column through any extra auto-fit columns.
- Extended `.analysis/verify-dashboard-general-ui.mjs` with a `wideClientColumn` assertion so browser smokes fail if Client Usage is not to the right of Provider Quota once the 3-column layout is active.
- Verification: `node --check .analysis/verify-dashboard-general-ui.mjs` passed.
- Verification: `pnpm lint` passed with the existing four shadcn Fast Refresh warnings and no errors.
- Verification: `pnpm build` passed.
- Verification: `pnpm precommit:run` passed.
- Verification: `git diff --check` passed.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3006/ http://127.0.0.1:9222 1800 900` passed and asserted `wideClientColumn`.
- Runtime browser verification: the same smoke passed on `3006` at `390 720`, `2000 900`, and `2300 900`.
- Runtime stack update: `docker compose -f docker-compose.yml up --build -d --no-deps dashboard-shell dashboard-shell-reports` rebuilt and restarted the static shell/report stack.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3005/ http://127.0.0.1:9222 1800 900` passed and asserted `wideClientColumn`.
- Runtime browser verification: the same smoke passed on `3005` at `390 720` and `2300 900`.
- Runtime container verification: `docker ps --filter name=dashboard-shell --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"` showed the static shell, static report service, static AAWM TAP remote, live dev shell, live dev report service, and live dev AAWM TAP remote all healthy.
- Cleanup verification: stopped the temporary headless Chrome process; `curl -sS http://127.0.0.1:9222/json/version` failed with connection refused as expected.

### 2026-05-15 - D1-037 - Remove dev white-screen federation DTS errors

Status: Completed

Changed paths:
- `vite.config.ts`
- `../aawm-tap-dashboard/vite.config.ts`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Reproduced that HTTP health was not enough: `3006` returned HTML, but browser console capture showed Module Federation dynamic type-hints errors.
- The failing browser path tried to open `ws://127.0.0.1:16322/?WEB_SOCKET_CONNECT_MAGIC_ID=...` from `@module-federation/dts-plugin/dynamic-remote-type-hints-plugin`.
- Added `dts: false` to the shell federation config.
- Added `dts: false` to the live AAWM TAP remote federation config so `remoteEntry.js` no longer imports `@module-federation/dts-plugin/dynamic-remote-type-hints-plugin`.
- Restarted `dashboard-shell-dev` and `dashboard-shell-aawm-tap-dashboard-dev`.
- Verification: `pnpm lint` passed with the existing four shadcn Fast Refresh warnings and no errors.
- Verification: `pnpm build` passed.
- Runtime HTTP verification: `curl -I http://127.0.0.1:3006/` returned `200 OK`.
- Runtime HTTP verification: `curl -I http://127.0.0.1:5173/remoteEntry.js` returned `200 OK`.
- Runtime content verification: downloaded `remoteEntry.js` and `rg "dynamic-remote-type-hints|dts-plugin|16322" /tmp/remoteEntry.js` returned no matches.
- Runtime browser verification: clean headless Chrome loaded `http://127.0.0.1:3006/`, produced a populated `#root`, and reported no console/runtime/network errors.
- Runtime browser verification: clean headless Chrome loaded `http://127.0.0.1:3006/aawm-tap/overview`, rendered the remote overview without module-load error text, and reported no console/runtime errors; only aborted fetch/script events from navigation cleanup were observed.
- Runtime container verification: `docker ps --filter name=dashboard-shell --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"` showed the static shell, static report service, static AAWM TAP remote, live dev shell, live dev report service, and live dev AAWM TAP remote all healthy.
- Cleanup verification: stopped the temporary headless Chrome process; `curl -sS http://127.0.0.1:9222/json/version` failed with connection refused as expected.

### 2026-05-15 - D1-038 - Recover from stale built shell chunks

Status: Completed

Changed paths:
- `src/lib/stale-asset-reload.ts`
- `src/main.tsx`
- `src/features/errors/general-error.tsx`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Investigated the reported `500` page after the white-screen repair.
- Verified `/api/shell/health`, `/api/shell/reports/usage?limit=1`, and `/api/shell/reports/quotas` returned `200`.
- Headless browser capture showed the dev and static General dashboard roots rendering live report data with report API calls returning `200` and no HTTP `500` responses.
- Static nginx logs showed the Windows browser requesting a stale rebuilt chunk, `/assets/_authenticated-C1g-FpT1.js`, which returned `404`; that stale dynamic import can route through the generic shell `500` error page.
- Added a guarded stale-asset reload helper for Vite preload errors, dynamic import failures, chunk-load failures, and stale Vite optimized dependency errors.
- Wired the helper into the app bootstrap through `vite:preloadError`, `window.error`, and `unhandledrejection`.
- Wired the helper into `GeneralError` so router-captured stale chunk errors reload once and show a specific "Dashboard shell updated" message if the guard prevents a loop.
- Verification: `pnpm lint` passed with the existing four shadcn Fast Refresh warnings and no errors.
- Verification: `pnpm build` passed.
- Runtime stack update: `docker compose -f docker-compose.yml up --build -d --no-deps dashboard-shell` rebuilt and restarted the static shell.
- Runtime stack update: `docker compose -f docker-compose.dev.yml restart dashboard-shell-dev` restarted the live dev shell.
- Runtime HTTP verification: `curl -I http://127.0.0.1:3006/`, `curl -I http://127.0.0.1:3005/`, and `curl 'http://127.0.0.1:3006/api/shell/reports/usage?limit=1'` returned `200`.
- Runtime browser verification: `node /tmp/dashboard-shell-cdp-check.mjs http://127.0.0.1:3006/ http://127.0.0.1:3005/` rendered both roots with fresh report data, no HTTP `500`, and `has500Text: false`.
- Runtime container verification: `docker ps --filter name=dashboard-shell --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"` showed static shell, static report service, static AAWM TAP remote, live dev shell, live dev report service, and live dev AAWM TAP remote all healthy.

Note:
- A browser tab that is already running an older pre-fix bundle may still need one manual refresh, because the new recovery hook cannot execute inside JavaScript that was already loaded before this patch.

### 2026-05-15 - D1-039 - Stop static shell index 304 stale-cache loop

Status: Completed

Changed paths:
- `nginx.conf`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Investigated the report that dev `3006` loaded but static `3005` did not.
- Static nginx logs showed the Windows browser receiving `304` for `/`, then continuing to request old removed chunk `/assets/_authenticated-C1g-FpT1.js`, which returned `404`.
- Added explicit no-cache handling for `index.html` and SPA fallback responses: `etag off`, `if_modified_since off`, expired response, `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0`, and `Pragma: no-cache`.
- Kept hashed assets immutable.
- Runtime stack update: `docker compose -f docker-compose.yml up --build -d --no-deps dashboard-shell` rebuilt and restarted the static shell.
- Runtime HTTP verification: `curl -I http://127.0.0.1:3005/` returned `200` with no-store/no-cache headers.
- Runtime conditional-cache verification: `curl -I -H 'If-None-Match: "6a079db3-13a8"' -H 'If-Modified-Since: Fri, 15 May 2026 22:26:59 GMT' http://127.0.0.1:3005/` returned `200`, not `304`.
- Runtime browser verification: `node /tmp/dashboard-shell-cdp-check.mjs http://127.0.0.1:3005/` rendered the General dashboard with live report data, `has500Text: false`, and report API responses returning `200`.

### 2026-05-15 - D1-040 - Add xAI and split Client tab from Provider Status

Status: Completed

Changed paths:
- `server/report-service.mjs`
- `src/features/dashboard/api/usage-report.ts`
- `src/features/dashboard/components/usage-report-dashboard.tsx`
- `src/features/dashboard/lib/usage-report-display.ts`
- `src/styles/index.css`
- `.analysis/verify-dashboard-general-ui.mjs`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Added `providerStatusUsage` to `/api/shell/reports/usage`, backed by a rolling 24-hour provider/model aggregate from `public.session_history`, so unmetered providers do not depend on the selected chart grain.
- Moved Client Usage from the Usage layout into a dedicated General dashboard `Client` tab, while preserving client grouping and version-detail behavior.
- Renamed Provider Quota to Provider Status and reflowed it into status subcolumns: OpenAI spans both columns with 5-Hour/Spark 5-Hour on the left and Weekly/Spark Weekly on the right; Anthropic and Gemini occupy the two subcolumns below; xAI, OpenRouter, and Local render as 24-hour unmetered status cards with infinity remaining, next-midnight reset labels, token usage bars, and vertical health timelines.
- Changed the Usage layout so Token Trend spans two columns on desktop and three columns on ultrawide, with Provider Status in the right-most column.
- Updated stable provider color normalization for `xai`, `openrouter`, and local provider variants so trend, status, and health visuals stay consistent.
- Verification: `pnpm lint` passed with the existing four shadcn Fast Refresh warnings and no errors.
- Verification: `pnpm build` passed.
- Verification: `pnpm precommit:run` passed.
- Verification: `git diff --check` passed.
- Runtime stack update: `docker compose -f docker-compose.yml up --build -d dashboard-shell-reports dashboard-shell` rebuilt and restarted the static shell/report stack and its dependent static AAWM TAP remote.
- Runtime stack update: `docker compose -f docker-compose.dev.yml restart dashboard-shell-reports-dev dashboard-shell-dev` restarted the live dev report and shell containers.
- Runtime container verification: `docker ps --filter name=dashboard-shell --format '{{.Names}} {{.Status}} {{.Ports}}'` showed the static shell, static report service, static AAWM TAP remote, live dev shell, live dev report service, and live dev AAWM TAP remote all healthy.
- Runtime API verification: `3005` and `3006` `/api/shell/reports/usage` both returned `providerStatusUsage` with `xai/grok-build` at `35063` tokens and local/OpenRouter 24-hour model rows.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3005/ http://127.0.0.1:9222 1440 760` passed and asserted Client moved to its own tab, Provider Status rightmost, Token Trend spanning two tracks, and xAI/OpenRouter/Local 24-hour overlays.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3005/ http://127.0.0.1:9222 2400 900` passed and asserted Token Trend spanning three ultrawide tracks.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3006/ http://127.0.0.1:9222 1440 760` passed against the live dev shell.
- Cleanup verification: stopped the temporary headless Chrome process used for CDP smoke checks; `curl -sS http://127.0.0.1:9222/json/version` returned connection refused.

### 2026-05-15 - D1-041 - Compact General dashboard header and model callouts

Status: Completed

Changed paths:
- `src/features/dashboard/index.tsx`
- `src/features/dashboard/components/usage-report-dashboard.tsx`
- `src/features/dashboard/lib/usage-report-display.ts`
- `.analysis/completed.md`

Evidence:
- Moved the General dashboard title/description into `UsageReportDashboard` so the latest-record freshness badge renders inline with the description instead of as a full-width alert.
- Replaced the four large Traces/Tokens/USD/Git cards with a compact metric strip and tightened the date filter row.
- Added special model callout colors for embedding and reranker models through the shared `modelColorFor()` helper.
- Added provider-prefix stripping for displayed model labels so `openai/...`, `anthropic/...`, `google/...`, `gemini/...`, `xai/...`, `openrouter/...`, and local provider prefixes are hidden in model callouts while raw keys stay unchanged for aggregation.
- Verification: `pnpm lint` passed with the existing four shadcn Fast Refresh warnings and no errors.
- Verification: `pnpm build` passed.
- Verification: `pnpm precommit:run` passed.
- Runtime stack update: `docker compose -f docker-compose.dev.yml restart dashboard-shell-dev` restarted the live dev shell.
- Runtime stack update: `docker compose -f docker-compose.yml up --build -d --no-deps dashboard-shell` rebuilt and restarted the static shell.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3005/ http://127.0.0.1:9222 1440 760` passed against the static shell.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3006/ http://127.0.0.1:9222 1440 760` passed against the live dev shell.

### 2026-05-15 - D1-042 - Reflow Provider Status for xAI monthly quota

Status: Completed

Changed paths:
- `server/report-service.mjs`
- `src/features/dashboard/api/usage-report.ts`
- `src/features/dashboard/components/usage-report-dashboard.tsx`
- `src/features/dashboard/lib/usage-report-display.ts`
- `src/styles/index.css`
- `.analysis/verify-dashboard-general-ui.mjs`
- `.analysis/completed.md`

Evidence:
- Updated the usage query to bucket dates in `America/New_York` and to resolve request quotas with `ri.provider = replace(sh.provider, 'gemini', 'google')`.
- Normalized slash-prefixed xAI provider values into the single `xai` bucket and added xAI monthly quota support from request quota rows.
- Moved Provider Status above Token Trend and rendered OpenAI, Anthropic, Gemini, xAI, NVIDIA, and Local in the requested two-row status layout.
- Reworked Provider Status desktop geometry so OpenAI uses a compressed three-column span, Anthropic and Gemini use equal three-column rows, xAI sits above NVIDIA, and Local sits to the right of xAI.
- Made quota buckets stretch to equal row depth and made vertical health timelines fill the full height of the displayed bucket.
- Verification: `node --check server/report-service.mjs` passed.
- Verification: `pnpm lint` passed with the existing four shadcn Fast Refresh warnings and no errors.
- Verification: `pnpm build` passed.
- Verification: `pnpm precommit:run` passed.
- Runtime stack update: `docker compose -f docker-compose.yml up --build -d --no-deps dashboard-shell` rebuilt and restarted the static shell.
- Runtime HTTP verification: `curl -I http://127.0.0.1:3005/` and `curl -I http://127.0.0.1:3006/` returned `200`.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3005/ http://127.0.0.1:9222 1440 760` passed against the static shell and asserted OpenAI width compression, equal Provider Status row depth, Local-right-of-xAI placement, and bucket-filling vertical health timelines.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3006/ http://127.0.0.1:9222 1440 760` passed against the live dev shell with the same Provider Status assertions.
- Cleanup verification: stopped the temporary headless Chrome process used for CDP smoke checks; `curl -sS http://127.0.0.1:9222/json/version` returned connection refused.

### 2026-05-15 - D1-043 - Repair Provider Status quota usage details

Status: Completed

Changed paths:
- `server/report-service.mjs`
- `src/features/dashboard/components/usage-report-dashboard.tsx`
- `.analysis/completed.md`

Evidence:
- Verified the live DB had active OpenAI short/weekly quota rows but no active OpenAI `weekly_special` or `short_special` interval rows, while recent OpenAI Spark session history did contain weekly Spark token usage.
- Updated the quota query to normalize `gemini` session-history providers into the `google` quota bucket so Gemini request quota rows can collect matching token usage.
- Added OpenAI Spark usage fallback rows derived from the normal OpenAI short/weekly reset windows when special quota interval rows are absent; this keeps Spark percentage as `N/A` when no special quota percentage exists but still shows Spark token usage.
- Reflowed OpenAI quota values into a direct 2x2 grid so the second-row Spark bucket text aligns more consistently with Gemini's bucket row.
- Increased inline quota bucket model previews from 3 models to 6 before showing a `+N` overflow marker.
- Runtime API verification on `3005`: OpenAI Spark Weekly returned `327929855` usage tokens for `gpt-5.3-codex-spark`; Spark 5-Hour returned `0` tokens because no Spark calls existed in the current five-hour window.
- Follow-up correction: OpenAI synthetic Spark fallback rows now report `0` remaining instead of `N/A` when special quota interval rows are absent, so both Spark Weekly and Spark 5-Hour display `0%`.
- Runtime API verification on `3005` and `3006`: Spark Weekly returned `spark_weekly_pct: 0` with `327929855` usage tokens, and Spark 5-Hour returned `spark_5h_pct: 0` with `0` usage tokens.
- Runtime API verification on `3005`: Gemini request quota rows returned nonzero token usage for active `gemini-3-flash-preview`, `gemini-3.1-flash-lite-preview`, and `gemini-3.1-pro-preview` rows.
- Verification: `node --check server/report-service.mjs` passed.
- Verification: `pnpm lint` passed with the existing four shadcn Fast Refresh warnings and no errors.
- Verification: `pnpm build` passed.
- Verification: `pnpm precommit:run` passed.
- Runtime stack update: `docker compose -f docker-compose.dev.yml restart dashboard-shell-reports-dev` restarted the live dev report service.
- Runtime stack update: `docker compose -f docker-compose.yml up --build -d dashboard-shell-reports dashboard-shell` rebuilt and restarted the static report service and shell.
- Runtime HTTP verification: `curl -I http://127.0.0.1:3005/` and `curl -I http://127.0.0.1:3006/` returned `200`.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3005/ http://127.0.0.1:9222 1440 760` passed against the static shell.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3006/ http://127.0.0.1:9222 1440 760` passed against the live dev shell.
- Cleanup verification: stopped the temporary headless Chrome process used for CDP smoke checks; `curl -sS http://127.0.0.1:9222/json/version` returned connection refused.

### 2026-05-16 - D1-044 - Align Provider Status bucket rows from screenshot

Status: Completed

Changed paths:
- `src/features/dashboard/components/usage-report-dashboard.tsx`
- `.analysis/verify-dashboard-general-ui.mjs`
- `.analysis/completed.md`

Evidence:
- Reviewed `.analysis/dashboard alignment.png` and matched the Provider Status problem to OpenAI's second internal row starting without the same header offset as the Gemini card beneath Anthropic.
- Reworked OpenAI Provider Status into two explicit internal rows: the first row has the visible OpenAI header with 5-Hour and Weekly buckets, while the second row reserves an invisible desktop header before Spark 5-Hour and Spark Weekly so the Spark bucket text aligns with Gemini's bucket text.
- Added stable Provider Status header sizing and stable quota bucket part rows for label, percent, reset, usage label, usage bar, and model preview rows so buckets in the same row no longer shift when usage labels wrap.
- Added smoke-test selectors and assertions for OpenAI top-row alignment with Anthropic and Spark-row alignment with Gemini.
- Verification: `node --check server/report-service.mjs` passed.
- Verification: `node --check .analysis/verify-dashboard-general-ui.mjs` passed.
- Verification: `pnpm lint` passed with the existing four shadcn Fast Refresh warnings and no errors.
- Verification: `pnpm build` passed.
- Verification: `pnpm precommit:run` passed.
- Runtime stack update: `docker compose -f docker-compose.yml up --build -d dashboard-shell-reports dashboard-shell` rebuilt and restarted the static shell/report stack.
- Runtime stack update: `docker compose -f docker-compose.dev.yml up -d dashboard-shell-reports-dev dashboard-shell-dev` confirmed the live dev shell/report stack was running against the bind-mounted source.
- Runtime HTTP verification: `curl -I http://127.0.0.1:3005/` and `curl -I http://127.0.0.1:3006/` returned `200`.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3005/ http://127.0.0.1:9222 1440 760` passed against the static shell and asserted the new Provider Status alignment checks.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3006/ http://127.0.0.1:9222 1440 760` passed against the live dev shell and asserted the same alignment checks.
- Cleanup verification: stopped the temporary headless Chrome process used for CDP smoke checks; `curl -sS http://127.0.0.1:9222/json/version` returned connection refused.

### 2026-05-16 - D1-045 - Split report tabs into Status and Token

Status: Completed

Changed paths:
- `src/features/dashboard/components/usage-report-dashboard.tsx`
- `.analysis/verify-dashboard-general-ui.mjs`
- `.analysis/completed.md`

Evidence:
- Changed the General dashboard report tabs from `Usage`, `Client`, `Health` to `Status`, `Token`, `Client`, `Health`.
- Made `Status` the default first tab and kept Provider Status there.
- Added the second `Token` tab and moved Token Trend into it.
- Updated browser smoke coverage to verify the ordered tab labels, removal of `Usage`, Provider Status visibility on `Status`, and Token Trend visibility/chart a11y on `Token`.
- Verification: `node --check .analysis/verify-dashboard-general-ui.mjs` passed.
- Verification: `pnpm lint` passed with the existing four shadcn Fast Refresh warnings and no errors.
- Verification: `pnpm build` passed.
- Verification: `pnpm precommit:run` passed.
- Runtime stack update: `docker compose -f docker-compose.yml up --build -d dashboard-shell` rebuilt and restarted the static shell.
- Runtime stack update: `docker compose -f docker-compose.dev.yml up -d dashboard-shell-dev` confirmed the live dev shell was running against the bind-mounted source.
- Runtime HTTP verification: `curl -I http://127.0.0.1:3005/` and `curl -I http://127.0.0.1:3006/` returned `200`.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3005/ http://127.0.0.1:9222 1440 760` passed against the static shell.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3006/ http://127.0.0.1:9222 1440 760` passed against the live dev shell.
- Cleanup verification: stopped the temporary headless Chrome process used for CDP smoke checks; `curl -sS http://127.0.0.1:9222/json/version` returned connection refused.

### 2026-05-17 - D1-046 - Repair Codex special quota intervals

Status: Completed

Changed paths:
- `.analysis/fix-rate-limit-intervals-codex-special-2026-05-17.sql`
- `.analysis/completed.md`

Evidence:
- Verified the live `aawm_tristore` `public.rate_limit_intervals` materialized view had remapping cases for `codex_bengalfox:primary` and `codex_bengalfox:secondary`, but its source `WHERE` clause filtered those quota keys out before interval construction.
- Recreated `public.rate_limit_intervals` in `postgresql://aawm@localhost:5434/aawm_tristore` with the same definition plus `codex_bengalfox:primary` and `codex_bengalfox:secondary` in the accepted `quota_key` list.
- Recreated dependent materialized view `public.provider_latency_health_5m` and restored the existing indexes for both materialized views.
- Verification: `psql -v ON_ERROR_STOP=1 -f .analysis/fix-rate-limit-intervals-codex-special-2026-05-17.sql postgresql://aawm:aawm_dev@localhost:5434/aawm_tristore` completed with `COMMIT`.
- Verification: `SELECT quota_key, quota_type, COUNT(*) FROM public.rate_limit_intervals WHERE provider = 'openai' GROUP BY quota_key, quota_type ORDER BY quota_key, quota_type;` returned `codex_bengalfox:primary|short_special|555`, `codex_bengalfox:secondary|weekly_special|193`, `codex:primary|short|1292`, and `codex:secondary|weekly|285`.
- Verification: `SELECT pg_get_viewdef('public.rate_limit_intervals'::regclass, true) LIKE '%codex_bengalfox:primary%', pg_get_viewdef('public.rate_limit_intervals'::regclass, true) LIKE '%codex_bengalfox:secondary%';` returned `t|t`.
- Runtime API verification: `curl -sS http://127.0.0.1:3005/api/shell/health` returned `{"ok":true,"databaseConfigured":true}`.
- Runtime API verification: `curl -sS http://127.0.0.1:3005/api/shell/reports/quotas` returned the OpenAI quota row with `special_remaining_pct: 99`, `short_special_remaining_pct: 95`, and nonzero Spark usage breakdown from `gpt-5.3-codex-spark`.

Follow-up:
- No source service rebuild was required because the fix was in the live database materialized view definition.

### 2026-05-17 - D1-047 - Restore live dev shell container

Status: Dead end / reopened

Changed paths:
- `vite.config.ts`
- `.analysis/completed.md`

Evidence:
- Verified `dashboard-shell-dev` was in a restart loop while `dashboard-shell-reports-dev` and `dashboard-shell-aawm-tap-dashboard-dev` were healthy.
- Root cause: Vite's file watcher traversed ignored `.analysis` artifacts and hit the self-referential symlink `.analysis/screenshots/screenshots -> ../screenshots`, causing `ELOOP: too many symbolic links encountered`.
- Added Vite dev-server watch ignores for local scratch/tooling/build folders: `.analysis`, `.claude`, `.codex`, `.gemini`, `@mf-types`, and `dist`.
- Reopened on 2026-05-17 because the string-glob watcher ignores did not actually prevent Vite from entering `.analysis`; later logs still showed `ELOOP` crashes and a user-visible white screen on `3006`.
- Verification: `pnpm lint` passed with the existing four shadcn Fast Refresh warnings and no errors.
- Verification: `pnpm build` passed.
- Runtime update: `docker compose -f docker-compose.dev.yml up -d dashboard-shell-dev` restarted the dev shell.
- Runtime verification: `docker ps --filter name=dashboard-shell-dev --format '{{.Names}} {{.Status}} {{.Ports}}'` returned `dashboard-shell-dev Up ... (healthy) 0.0.0.0:3006->3006/tcp`.
- Runtime HTTP verification: `curl -sS -I http://127.0.0.1:3006/` returned `200 OK`.
- Runtime API verification: `curl -sS http://127.0.0.1:3006/api/shell/health` returned `{"ok":true,"databaseConfigured":true}`.
- Runtime remote verification: `curl -sS -I http://127.0.0.1:5173/remoteEntry.js` returned `200 OK`.

Follow-up:
- Superseded by D1-048.

### 2026-05-17 - D1-048 - Harden live dev watcher and lint scratch ignores

Status: Completed

Changed paths:
- `vite.config.ts`
- `eslint.config.js`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Replaced Vite's dev watcher string globs with a repo-local ignore predicate that rejects any watched path containing `.analysis`, `.claude`, `.codex`, `.gemini`, `@mf-types`, or `dist` inside the repo.
- Added the same scratch/tooling/build roots to ESLint flat-config ignores so `pnpm lint` does not traverse `.claude/worktrees`.
- Verification: `pnpm build` passed.
- Verification: `pnpm lint` passed with the existing four shadcn Fast Refresh warnings and no errors.
- Runtime update: `docker compose -f docker-compose.dev.yml restart dashboard-shell-dev` restarted the live dev shell.
- Runtime verification: `docker compose -f docker-compose.dev.yml ps -a` reported `dashboard-shell-dev Up ... (healthy) 0.0.0.0:3006->3006/tcp`, with the reports and TAP remote dev services also healthy.
- Runtime HTTP verification: `curl -sS -I http://127.0.0.1:3006/` returned `200 OK`; `curl -sS http://127.0.0.1:3006/api/shell/health` returned `{"ok":true,"databaseConfigured":true}`.
- Runtime remote verification: `curl -sS -o /tmp/dashboard-shell-dev-remoteEntry.js -w '%{http_code} %{content_type} %{time_total}\n' http://127.0.0.1:5173/remoteEntry.js` returned `200 text/javascript`.
- Runtime log verification: `docker compose -f docker-compose.dev.yml logs --since 5m dashboard-shell-dev` showed only the Vite restart/ready sequence after the fix and no `ELOOP` recurrence.
- Browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3006/ http://127.0.0.1:9222 1440 760` passed in headless Chrome against the live dev shell.

Follow-up:
- The ignored local symlink `.analysis/screenshots/screenshots -> ../screenshots` remains present, but the dev server and lint no longer depend on removing it.

### 2026-05-17 - D1-049 - Restore usable dev dashboard loading

Status: Completed

Changed paths:
- `server/report-service.mjs`
- `src/features/dashboard/components/usage-report-dashboard.tsx`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Verified the shell was no longer a blank React mount in a fresh browser, but the General dashboard stayed in skeleton/loading state because `/api/shell/reports/usage` returned a 14.7 MB payload and took about 13.1s for the default 2026-04-01 to 2026-05-18 range.
- Confirmed `providerLatencyHealth` was the dominant payload member at about 14.1 MB / 12,218 rows because the usage endpoint returned up to 20,000 health rows over 14 days on every initial load.
- Changed the report-service health defaults to a 24-hour window and 1,500-row cap, configurable through `SHELL_REPORT_HEALTH_WINDOW_HOURS` and `SHELL_REPORT_HEALTH_MAX_ROWS`.
- Added a bounded in-process report cache with in-flight dedupe, configurable through `SHELL_REPORT_CACHE_TTL_MS`, so the dashboard usage request and sidebar quota request do not run duplicate expensive quota work during the same page load.
- Changed the dashboard and API default report range to the last 7 calendar days through tomorrow instead of the prior-month-to-tomorrow range.
- Updated Health Metrics copy from "last 14 days" to "last 24 hours".
- Runtime API verification after restart: default usage request for `2026-05-11` to `2026-05-18` returned `200` in about `6.10s` cold with a `1,753,189` byte payload and `849` health rows.
- Runtime API verification after cache warmup: the same usage request returned `200` in about `0.029s`; `/api/shell/reports/quotas` returned `200` in about `0.003s`.
- Runtime browser verification on `3006`: fresh CDP render showed `rootChildren: 6`, date inputs `2026-05-11` and `2026-05-18`, `hasProviderQuota: 6`, no unavailable cards, and populated Provider Status text.
- Verification: `node --check server/report-service.mjs` passed.
- Verification: `pnpm lint` passed with the existing four shadcn Fast Refresh warnings and no errors.
- Verification: `pnpm build` passed.

Follow-up:
- The first cold report request still spends several seconds in database quota/report work; deeper SQL/query-plan optimization remains separate from restoring the usable dev page.

### 2026-05-17 - D1-050 - Decouple dev shell bootstrap from remote availability

Status: Completed

Changed paths:
- `vite.config.ts`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Verified the user-visible HTML source was the normal Vite SPA shell, but a fresh browser trace was required to prove whether the JS bootstrap populated `#root`.
- Fresh CDP browser verification before the final patch rendered `#root.childElementCount: 6` and populated General Dashboard text, but still showed the root route fetching `http://localhost:5173/remoteEntry.js` during host initialization.
- Changed the Module Federation host to `shareStrategy: 'loaded-first'` so the shell does not preload the AAWM TAP remote during the General dashboard bootstrap.
- Runtime update: `docker compose -f docker-compose.dev.yml restart dashboard-shell-dev` restarted the live dev shell on port `3006`.
- Runtime browser verification on `3006`: fresh CDP renders for `http://127.0.0.1:3006/` and `http://localhost:3006/` returned `rootChildren: 6`, `hasGeneralDashboard: true`, `hasProviderStatus: true`, no runtime exceptions, no failed requests, and no `localhost:5173/remoteEntry.js` fetch on the root route.
- Remote-unavailable verification: stopped `aawm-tap-dashboard-dev`, loaded `http://127.0.0.1:3006/`, and still got `rootChildren: 6`, `hasGeneralDashboard: true`, `hasProviderStatus: true`, no failed requests, and no remote-entry fetch from port `5173`.
- Runtime recovery: restarted `aawm-tap-dashboard-dev` with `docker compose -f docker-compose.dev.yml up -d aawm-tap-dashboard-dev`; `docker compose -f docker-compose.dev.yml ps aawm-tap-dashboard-dev` reported it healthy on `0.0.0.0:5173->5173/tcp`.
- On-demand remote verification: fresh CDP render of `http://127.0.0.1:3006/aawm-tap/overview` returned `rootChildren: 6`, `hasAawmTapHeader: true`, `hasOverview: true`, `hasFailedRemoteMessage: false`, and displayed API health `ok` plus document/chunk/domain counts.
- Verification: `pnpm lint` passed with the existing four shadcn Fast Refresh warnings and no errors.
- Verification: `pnpm build` passed.

Follow-up:
- If a user opens an AAWM TAP route directly while `localhost:5173` is unreachable from their browser, that remote route can still fail; the fix here keeps the shell and General dashboard usable instead of leaving the whole app white.

### 2026-05-17 - D1-051 - Prevent stale dev bootstrap caching

Status: Completed

Changed paths:
- `vite.config.ts`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Restarted `dashboard-shell-dev` after D1-050 because `vite.config.ts` changes require the dev-server process to reload; `docker compose -f docker-compose.dev.yml ps dashboard-shell-dev` reported the service healthy on `0.0.0.0:3006->3006/tcp`.
- Verified the served federation HTML-entry proxy body had the expected root bootstrap, including `const __mfRemotePreloads = [];`, and no `localhost:5173/remoteEntry.js` preload.
- Found that Vite's generic `server.headers` applied `Cache-Control: no-store` to normal Vite modules but not to the Module Federation HTML-entry proxy response because the federation middleware writes that response directly.
- Added an early dev-server middleware before the federation plugin so every dev response, including `/@id/__x00__virtual:mf-html-entry-proxy`, receives `Cache-Control: no-store`.
- Runtime header verification: `curl -D /tmp/dashboard-entry-headers-middleware.txt -o /tmp/dashboard-entry-middleware.js 'http://127.0.0.1:3006/@id/__x00__virtual:mf-html-entry-proxy?...'` returned `Cache-Control: no-store`.
- Runtime header verification: `curl -D /tmp/dashboard-index-headers-middleware.txt -o /tmp/dashboard-index-middleware.html http://127.0.0.1:3006/` returned `Cache-Control: no-store`.
- Runtime browser verification: fresh Chrome CDP render of `http://127.0.0.1:3006/` returned `rootChildren: 6`, `hasGeneralDashboard: true`, `hasProviderStatus: true`, `hasWhiteScreen: false`, no failed requests, and no runtime exceptions.
- Verification: `pnpm lint` passed with the existing four shadcn Fast Refresh warnings and no errors.
- Verification: `pnpm build` passed.

Follow-up:
- The page source still shows the normal Vite SPA shell with an empty `#root`; use runtime DOM and network checks rather than View Source to confirm rendering.

### 2026-05-18 - D1-052 - Stabilize federation host entry bootstrap

Status: Completed

Changed paths:
- `.dockerignore`
- `index.html`
- `vite.config.ts`
- `.gitignore`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Added `hostInitInjectLocation: 'entry'` to the Module Federation host config so host initialization is injected at the entry.
- Added a localhost-only bootstrap diagnostics script that captures `error` and `unhandledrejection` events and renders a diagnostic panel only if React leaves `#root` empty after startup.
- Ignored generated Playwright `test-results/` output in Git and Docker contexts so `.last-run.json` does not become part of source checkpoints or image build contexts.
- Verification: `pnpm format:check` passed.
- Verification: `pnpm lint` passed with the existing four shadcn Fast Refresh warnings and no errors.
- Verification: `pnpm build` passed.
- Verification: `pnpm precommit:run` passed.
- Runtime update: `docker compose -f docker-compose.dev.yml restart dashboard-shell-dev` restarted the live dev shell.
- Runtime update: `docker compose -f docker-compose.yml up --build -d dashboard-shell` rebuilt and restarted the static shell, with the report service recreated through its dependency chain.
- Runtime HTTP verification: `curl -I http://127.0.0.1:3005/` and `curl -I http://127.0.0.1:3006/` returned `200`.
- Runtime API verification: `curl http://127.0.0.1:3005/api/shell/health` and `curl http://127.0.0.1:3006/api/shell/health` returned `{"ok":true,"databaseConfigured":true}`.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3005/ http://127.0.0.1:9222 1440 760` passed against the rebuilt static shell.
- Runtime browser verification: `node .analysis/verify-dashboard-general-ui.mjs http://127.0.0.1:3006/ http://127.0.0.1:9222 1440 760` passed against the live dev shell.
- Runtime AAWM TAP route verification on `3005` and `3006`: `/aawm-tap/overview` rendered with `hasAawmTapHeader: true`, `hasOverview: true`, no failed remote message, empty `bootstrapErrors`, no failed requests, and no runtime exceptions.
- Cleanup verification: stopped the temporary headless Chrome process used for CDP smoke checks; `curl -sS http://127.0.0.1:9222/json/version` returned connection refused.

Follow-up:
- D1-004 remains the next open source task for replacing remaining demo shell chrome with registry-backed module data.

### 2026-05-19 - D1-053 - Make static report service source editable

Status: Completed

Changed paths:
- `docker-compose.yml`
- `README.md`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Added a static compose bind mount from `./server` to `/app/server:ro` for `dashboard-shell-reports`, so local report-service source edits no longer require rebuilding `dashboard-shell-reports:local`.
- Kept `Dockerfile.report-service` self-contained; the compose mount overrides the baked `/app/server` copy only for the local stack.
- Updated README guidance to distinguish report-service source edits, which now need a service restart, from `server/package.json` dependency changes, which still need an image rebuild.
- Verification: `docker compose -f docker-compose.yml config` rendered the `dashboard-shell-reports` bind mount at `/app/server` with `read_only: true`.
- Runtime update: `docker compose -f docker-compose.yml up -d --force-recreate --no-deps dashboard-shell-reports` recreated only the static report service.
- Runtime mount verification: `docker inspect dashboard-shell-dashboard-shell-reports-1 --format '{{json .Mounts}}'` returned a bind mount with source `/home/zepfu/projects/dashboard-shell/server`, destination `/app/server`, and `RW:false`.
- Runtime health verification: `docker compose -f docker-compose.yml ps dashboard-shell-reports` reported the recreated static report container healthy.
- Runtime API verification: `curl -sS --max-time 2 http://127.0.0.1:3005/api/shell/health` and `curl -sS --max-time 2 http://127.0.0.1:3006/api/shell/health` both returned `{"ok":true,"databaseConfigured":true}`.
- Host stale-service verification: `curl -sS --max-time 2 http://127.0.0.1:3010/api/shell/health` returned connection refused, confirming there is no host-side report service shadowing the containers.
- Formatting verification: `pnpm exec prettier --check README.md docker-compose.yml` passed.

Follow-up:
- Restart `dashboard-shell-reports` after `server/report-service.mjs` source edits.
- Rebuild `dashboard-shell-reports:local` after `server/package.json` or `server/pnpm-lock.yaml` dependency changes.

### 2026-05-19 - D1-054 - Refresh report API quota history runtime

Status: Completed

Changed paths:
- `server/report-service.mjs`
- `.analysis/completed.md`

Evidence:
- Confirmed both `3005` and `3006` were serving the old in-memory report module after the source file had changed; before restart, `/api/shell/reports/usage?limit=1` returned only `clients`, `metadata`, `providerErrorObservations`, `providerLatencyHealth`, `providerStatusUsage`, `quotas`, `rows`, `summary`, and `trend`, and client rows lacked `last_seen_at`.
- Confirmed `3006` routes through `SHELL_REPORT_API_TARGET=http://dashboard-shell-reports-dev:3010`, while static `3005` routes through nginx to `dashboard-shell-reports:3010`.
- Confirmed both report services currently run plain `node server/report-service.mjs`, so bind-mounted source updates require a service restart.
- Restarting both services picked up the source change and exposed `column wb.quota_model does not exist` in the new `quotaHistory` query.
- Fixed the `per_model_usage` CTE to use `wb.model`, the actual `window_bounds` column, when matching `session_history` rows.
- Verification: `node --check server/report-service.mjs` passed.
- Verification: `pnpm exec prettier --check server/report-service.mjs` passed.
- Runtime update: `docker compose -f docker-compose.yml restart dashboard-shell-reports` restarted the static report service.
- Runtime update: `docker compose -f docker-compose.dev.yml restart dashboard-shell-reports-dev` restarted the dev report service.
- Runtime health verification: `docker ps --filter name=dashboard-shell-reports --format '{{.Names}} {{.Status}} {{.Ports}}'` showed both report containers healthy.
- Runtime API verification: `curl -sS http://127.0.0.1:3005/api/shell/health` and `curl -sS http://127.0.0.1:3006/api/shell/health` both returned `{"ok":true,"databaseConfigured":true}`.
- Runtime response-shape verification: `curl -sS http://127.0.0.1:3005/api/shell/reports/usage?limit=1 -o /tmp/dashboard-shell-usage-3005-fixed.json` and the same request on `3006` both produced objects containing `quotaHistory`, client rows containing `last_seen_at`, `quotaHistoryLength: 43`, and no `error`.

Follow-up:
- Consider adding a report-service dev watcher if source edits should reload automatically; the current compose services intentionally require restart.

### 2026-05-20 - D1-056 - Stabilize cold report request enough to load

Status: Completed

Changed paths:
- `.env.example`
- `docker-compose.dev.yml`
- `docker-compose.yml`
- `server/report-service.mjs`
- `.analysis/todo.md`
- `.analysis/completed.md`
- `.analysis/report-query-performance-options.md`

Evidence:
- Confirmed the exact current dashboard request uses a 30-day window, `group_by=provider,model,repository`, `limit=50000`, and `sort=period_end`.
- Before the fix, the exact dev request returned `500` after about `10.0s` with `{"error":"timeout exceeded when trying to connect"}`, and the static request hit nginx `504` after about `60.0s`.
- Raised the default report DB pool size from `5` to `12` because `handleUsageReport()` launches the main rows, summary, trend, clients, health, errors, provider status, quota history, tool activity, and quota report queries concurrently.
- Recreated `dashboard-shell-reports` and `dashboard-shell-reports-dev`; narrow Docker inspect confirmed `SHELL_REPORT_DB_POOL_MAX=12` in both containers.
- With pool size `12`, the exact 30-day UI request returned `200` on both `3005` and `3006`, but still took about `56s` cold and returned about `20 MB`.
- Read-only database plan check showed the old New York date predicate used `session_history_created_at_idx` as a filter and took about `311 ms` for a 30-day count, while the equivalent New York-midnight timestamp range used an `Index Cond` and took about `75 ms`.
- Rewrote report-service `session_history` date filters to use the sargable timestamp range while preserving New York calendar-day semantics.
- Recreated both report services after the source edit.
- Runtime health verification: `curl -sS http://127.0.0.1:3005/api/shell/health` and `curl -sS http://127.0.0.1:3006/api/shell/health` both returned `{"ok":true,"databaseConfigured":true}`.
- Runtime API verification: a single exact dev UI request returned `200` in about `26.2s` with a `20.0 MB` payload.
- Runtime warm-cache verification: the same exact request returned `200` in about `0.36s` on `3006` and about `0.34s` on `3005`.
- Response-shape sample from the exact request included `rows: 986`, `trend: 986`, `clients: 290`, `providerLatencyHealth: 15638`, `providerErrorObservations: 464`, `providerStatusUsage: 65`, `quotas: 12`, `quotaHistory: 73`, and `toolActivity: 2048`.

Follow-up:
- D1-057 should add Redis shared full-response caching with stale-while-revalidate and prewarming for last 7 days, last 30 days, YTD, and trailing 2 years.
- Large cold windows can still pressure Postgres shared memory if multiple containers refresh them simultaneously; Redis single-flight locking should address that.

### 2026-05-20 - D1-055 - Evaluate General dashboard report latency options

Status: Completed

Changed paths:
- `.analysis/report-query-performance-options.md`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Captured the current cold/warm report latency baseline, including the exact 30-day dashboard query shape, payload size, and 30-day/YTD/two-year sizing constraints.
- Documented Redis full-response caching, stale-while-revalidate, prewarming, query/index fixes, fragment caching, and longer-term response/data-shape options.
- Preserved the stated direction: YTD is a normal workflow, roughly two years is the max target, and the preferred short-term path should not depend on response-shape changes or pre-aggregation.
- Folded the D1-056 live DB evidence into the options writeup: pool limits, sargable date predicates, warm-cache timings, and Postgres shared-memory risk under concurrent cold refreshes.

Verification:
- `.analysis/report-query-performance-options.md` now includes the chosen Redis cache direction and D1-057 implementation evidence.

### 2026-05-20 - D1-057 - Add Redis shared report response cache

Status: Completed

Changed paths:
- `docker-compose.yml`
- `docker-compose.dev.yml`
- `server/package.json`
- `server/pnpm-lock.yaml`
- `server/report-service.mjs`
- `.analysis/todo.md`
- `.analysis/completed.md`
- `.analysis/report-query-performance-options.md`

Evidence:
- Added a shared `dashboard-shell-redis` service using `redis:7-alpine`, no persistence, `allkeys-lru`, and configurable max memory.
- Added `redis` to the report-service package and wired both static and dev report services to `SHELL_REPORT_REDIS_URL=redis://dashboard-shell-redis:6379`.
- Replaced the process-only response cache with Redis-backed full-response caching that preserves the existing JSON contract while adding metadata fields such as `cacheStatus`, `cacheBackend`, `cacheGeneratedAt`, and `cacheRefreshing`.
- Cache keys are based on canonicalized search params plus cache version and scope; stored payloads are gzip-compressed.
- Added Redis single-flight locks for cold refreshes and stale-while-revalidate for expired-but-present responses.
- Added startup/periodic prewarming for last 7 days, the exact 30-day dashboard window, YTD, and trailing 2 years.
- Added a global prewarm lock so static and dev report services do not warm large windows concurrently.
- Added safer cold-fill DB defaults: `SHELL_REPORT_DB_DISABLE_PARALLELISM=true` and `SHELL_REPORT_SQL_FANOUT_CONCURRENCY=2`, after prewarm exposed Postgres dynamic shared-memory failures on large cold report windows.

Verification:
- `pnpm --dir server add redis@^5.10.0` updated `server/package.json` and `server/pnpm-lock.yaml` to `redis@5.12.1`.
- `node --check server/report-service.mjs` passed.
- `pnpm exec prettier --check server/report-service.mjs docker-compose.yml docker-compose.dev.yml server/package.json` passed.
- `docker compose -f docker-compose.yml config` passed.
- `docker compose -f docker-compose.dev.yml config` passed.
- Rebuilt and restarted the static report stack with `docker compose -f docker-compose.yml up -d --build dashboard-shell-redis dashboard-shell-reports`.
- Restarted the dev report stack with `docker compose -f docker-compose.dev.yml up -d --force-recreate dashboard-shell-reports-dev`.
- Health checks through both shell ports returned `{"ok":true,"databaseConfigured":true,"redisConfigured":true,"redisReady":true}`.
- Prewarm logs showed all four usage windows completed: last 7 days, last 30 days (`from=2026-04-20&to=2026-05-21`), YTD (`from=2026-01-01&to=2026-05-21`), and trailing 2 years (`from=2024-05-20&to=2026-05-21`).
- Final exact dashboard request on `3006` returned `200` in `0.396370s`, `20,317,845` bytes, with `metadata.cacheStatus=hit`, `cacheBackend=redis`, and `cacheGeneratedAt=2026-05-20T13:00:35.716Z`.
- The same final exact dashboard request on `3005` returned `200` in `0.368249s`, `20,317,845` bytes, with the same Redis cache generation timestamp.
- Small uncached one-day request first returned `metadata.cacheStatus=miss` in about `5.17s`, then a warm canonicalized-parameter repeat returned `metadata.cacheStatus=hit` in about `0.068s`.
- Stale-while-revalidate verification: after forcing the small test key past `freshUntil` but inside `staleUntil`, the request returned `200` in `0.115810s` with `metadata.cacheStatus=stale`, `cacheBackend=redis`, and `cacheRefreshing=true`.

Follow-up:
- Provider latency health now reaches about 79% of `MAX_HEALTH_ROWS=20000` for large windows; if model/provider diversity grows, the health slice may need its own pagination, cap, or cache fragment.

### 2026-05-20 - D1-058 - Generalize remote dashboard integration contract

Status: Completed

Changed paths:
- `docs/remote-dashboard-integration-contract.md`
- `docs/tap-ui-contract.md`
- `README.md`
- `package.json`
- `scripts/scaffold-tap.mjs`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Renamed the TAP-specific contract doc into a generic remote dashboard integration contract for any repo that needs to render through `dashboard-shell`.
- Expanded the contract to cover the integration boundary, required `./module` manifest shape, Vite Module Federation config with DTS/type-hints disabled, route props, API proxy rules, styling/token expectations, shell registration payload, host-side files to update, and verification checklist.
- Added `pnpm scaffold:dashboard` as the generic scaffold command while preserving `pnpm scaffold:tap` as a compatibility alias.
- Updated README and scaffold output/help/generated copy to use remote-dashboard language, and made the scaffold generate `dts: false` in remote federation config.
- Updated the active context note in `.analysis/todo.md` to point at `docs/remote-dashboard-integration-contract.md`.

Verification:
- `pnpm exec prettier --check README.md docs/remote-dashboard-integration-contract.md package.json scripts/scaffold-tap.mjs .analysis/todo.md` passed.
- `node --check scripts/scaffold-tap.mjs` passed.
- `pnpm scaffold:dashboard --help` printed the generic scaffold usage.
- `rg -n "docs/tap-ui-contract.md|Tap UI Contract|Tap remotes|Created tap starter|pnpm scaffold:tap ../example-dashboard|tap owns page-level" README.md docs scripts package.json .analysis/todo.md` returned no matches.

Follow-up:
- Historical `.analysis/completed.md` entries still reference the original TAP contract and scaffold command as past evidence; those were intentionally left unchanged.

### 2026-05-21 - D1-004 follow-up - Add sibling dashboard entries to Phosphor sidebar

Status: Completed

Changed paths:
- `src/components/layout/authenticated-layout.tsx`
- `src/components/layout/data/sidebar-data.ts`
- `src/components/layout/data/sidebar-data.test.ts`
- `src/features/dashboard/index.tsx`
- `src/features/dashboard/components/phosphor-layout.tsx`
- `src/features/dashboard/components/phosphor-sidebar.test.tsx`
- `src/features/dashboard/components/phosphor-sidebar.tsx`
- `src/shell/remote-dashboard-metadata.ts`
- `src/shell/remote-dashboard-registry.ts`

Evidence:
- Kept the route-scoped Phosphor sidebar as the dashboard route sidebar and kept the standard `AppSidebar` suppressed on `/`.
- Changed the Phosphor sidebar `Dashboards` group to expose one direct top-level entry point per sibling dashboard: `AAWM TAP`, `Aegis`, and `Sluice`.
- Kept the shared shell sidebar data aligned to the same top-level remote dashboard entry points for non-dashboard routes.
- Split data-only remote dashboard metadata from federation module importers so sidebar data/tests can consume dashboard labels and hrefs without importing remote modules.

Verification:
- `pnpm exec vitest run src/features/dashboard/components/phosphor-sidebar.test.tsx src/components/layout/data/sidebar-data.test.ts src/features/dashboard/components/phosphor-layout.test.tsx` passed: 3 files, 6 tests.
- `pnpm exec vitest run` passed: 32 files, 400 tests.
- `pnpm lint` passed with the existing 23-warning baseline and 0 errors.
- `pnpm build` passed.
- `git diff --check` passed.
- Headless Chrome against `http://127.0.0.1:3006/` found sidebar links:
  - `/aawm-tap/overview` text `AAWM TAP`
  - `/aegis` text `Aegis`
  - `/sluice/overview` text `Sluice`
- The same DOM snapshot confirmed the Phosphor sidebar markers are present and the standard `AppSidebar` marker is absent on `/`.

### 2026-05-21 - D1-004 follow-up - Keep Phosphor sidebar on remote dashboard routes

Status: Completed

Changed paths:
- `src/components/layout/authenticated-layout.tsx`
- `src/features/dashboard/components/phosphor-layout.tsx`
- `src/features/dashboard/components/phosphor-layout.module.css`
- `src/features/dashboard/components/phosphor-layout.test.tsx`
- `src/shell/remote-dashboard.tsx`
- `.analysis/completed.md`

Evidence:
- Extended the authenticated layout's Phosphor-sidebar route detection from only `/` to every configured remote dashboard base path.
- Wrapped remote dashboard module rendering, loading states, not-found states, and module-load errors in `PhosphorLayout` with `PhosphorSidebar`.
- Made the Phosphor alerts column optional so remote dashboard pages keep the Phosphor sidebar/header/content layout without an empty right rail.

Verification:
- `pnpm exec vitest run src/features/dashboard/components/phosphor-layout.test.tsx src/features/dashboard/components/phosphor-sidebar.test.tsx src/components/layout/data/sidebar-data.test.ts` passed: 3 files, 7 tests.
- `pnpm exec vitest run src/features/dashboard/index.test.tsx` passed: 1 file, 2 tests.
- `pnpm exec vitest run` passed on rerun: 32 files, 401 tests.
- `pnpm lint` passed with the existing 23-warning baseline and 0 errors.
- `pnpm build` passed.
- `git diff --check` passed.
- Headless Chrome against `http://127.0.0.1:3006/aawm-tap/overview`, `/aegis`, and `/sluice/overview` confirmed:
  - Phosphor sidebar markers are present.
  - The standard `AppSidebar` marker is absent.
  - The Phosphor sidebar contains `AAWM TAP`, `Aegis`, and `Sluice` module links on all three routes.

### 2026-05-21 - D1-018 - Expand TOOL hover detail columns and align model gutter colors

Status: Completed

Changed paths:
- `src/features/dashboard/components/master-ledger-table.tsx`
- `src/features/dashboard/components/master-ledger-table.test.tsx`
- `src/features/dashboard/components/primitives/hover-tooltip.tsx`
- `src/features/dashboard/components/primitives/hover-tooltip.test.tsx`
- `.analysis/tool-tooltip-layout-probe.mjs`
- `.analysis/dashboard-fetch-debug.mjs`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Increased TOOL hover retained detail to three 14-row columns per side for both non-shell Tools and Shell command rows before a `+N more` truncation marker is shown.
- Changed the TOOL hover render from one fixed Tools column plus one fixed Shell column to two side groups whose internal column counts are derived from the retained row counts.
- Added a `HoverTooltip` panel-style override so the portalled quota-bar tooltip can grow wider for dense TOOL detail while still respecting `calc(100vw - 16px)`.
- Changed Model Ledger first-cell gutters to use the row provider's `providerBrandHex()` color and removed the severity `.gutter-*` class from those cells.
- Static browser hover proof on `http://127.0.0.1:3005/` opened a TOOL tooltip with `panelWidth: 712`, outer grid `minmax(0px, 2fr) minmax(0px, 3fr)`, Tools grid `repeat(2, minmax(0px, 1fr))`, Shell grid `repeat(3, minmax(0px, 1fr))`, and no page errors or failed requests.
- The same static hover proof showed the model gutter color matched the Provider column color: `rgb(217, 119, 87)` for the sampled Anthropic row, with no `gutter-*` class on the first cell.

Verification:
- `pnpm test src/features/dashboard/components/master-ledger-table.test.tsx src/features/dashboard/components/primitives/hover-tooltip.test.tsx` passed: 2 files, 36 tests.
- `pnpm exec prettier --write src/features/dashboard/components/master-ledger-table.tsx src/features/dashboard/components/master-ledger-table.test.tsx src/features/dashboard/components/primitives/hover-tooltip.tsx src/features/dashboard/components/primitives/hover-tooltip.test.tsx` completed.
- `pnpm lint` passed with the existing 23-warning baseline and 0 errors.
- `pnpm build` passed.
- `git diff --check` passed.
- `docker compose -f docker-compose.yml up -d --build --no-deps dashboard-shell` rebuilt and restarted the static shell container.
- `docker ps --filter name=dashboard-shell-dashboard-shell-1` showed the rebuilt static shell container healthy on `0.0.0.0:3005->80/tcp`.
- `curl -sS http://127.0.0.1:3005/api/shell/health` and `curl -sS http://127.0.0.1:3006/api/shell/health` both returned `{"ok":true,"databaseConfigured":true,"redisConfigured":true,"redisReady":true}`.
- `node .analysis/dashboard-500-probe.mjs http://127.0.0.1:3005/ http://127.0.0.1:3006/` passed after current-window cache warmup: both shells had `providerCards: 8`, `pageErrors: []`, `failedRequests: []`, and `/api/shell/reports/usage?...` returned `200`.
- `env DASHBOARD_URL=http://127.0.0.1:3005 node .analysis/tool-tooltip-layout-probe.mjs` passed with `tooltipFound: true`, `gutterMatchesProviderColor: true`, no console errors, no page errors, and no failed requests.

### 2026-05-21 - D1-018 follow-up - Collapse TOOL hover shell rows to executable families

Status: Completed

Changed paths:
- `src/features/dashboard/components/master-ledger-table.tsx`
- `src/features/dashboard/components/master-ledger-table.test.tsx`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Changed `normalizeShellCommandLabel()` so the TOOL hover shell rollup keeps only the normalized executable label after path, quote, `env`, and assignment-prefix cleanup.
- Removed subcommand-level grouping for commands such as `git commit`, `docker compose`, `docker exec`, `gh run`, `gh pr`, `npm run`, and `npm test`, so the compact hover renders one `git`, `docker`, `gh`, or `npm` row.
- Added unit coverage proving mixed multi-part labels collapse into executable-level rows with summed call counts and no spaces in the rendered shell labels.
- Confirmed from current source that the quota-bar spectral animation is not actual velocity-driven: `buildQuotaSegments()` marks the current consumed-quota boundary segment as `highVelocity`, `QuotaIntervalBar` renders that segment with the `high-velocity` class, and CSS animates only non-prior bars when `prefers-reduced-motion` allows it.

Verification:
- `pnpm test src/features/dashboard/components/master-ledger-table.test.tsx src/features/dashboard/components/primitives/hover-tooltip.test.tsx` passed: 2 files, 37 tests.
- `pnpm lint` passed with the existing 23-warning baseline and 0 errors.
- `pnpm build` passed.
- `git diff --check` passed.
- `docker compose -f docker-compose.yml up -d --build --no-deps dashboard-shell` rebuilt and restarted the static shell container.
- `docker ps --filter name=dashboard-shell-dashboard-shell-1` showed the rebuilt static shell container healthy on `0.0.0.0:3005->80/tcp`.
- `DASHBOARD_URL=http://127.0.0.1:3005 node .analysis/tool-tooltip-layout-probe.mjs` opened the TOOL tooltip on the rebuilt static shell with `tooltipFound: true`, no console errors, no page errors, no failed requests, and shell rows including executable labels such as `git`, `docker`, and `npm`.
- `/usr/bin/python3 -c ... /tmp/tool-tooltip-layout-probe.json` found no forbidden multi-part shell labels among `git show`, `git log`, `git commit`, `docker exec`, `docker compose`, `gh run`, `gh pr`, `npm run`, or `npm test`, and confirmed required executable labels were present.

### 2026-05-21 - D1-018 follow-up - Match TOOL hover Shell height to MCP-heavy Tools columns

Status: Completed

Changed paths:
- `src/features/dashboard/components/master-ledger-table.tsx`
- `src/features/dashboard/components/master-ledger-table.test.tsx`
- `.analysis/tool-tooltip-layout-probe.mjs`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Reworked TOOL hover layout construction so non-MCP Tools remain compact columns while busy MCP server rollups are promoted into their own left-side columns.
- Allowed promoted MCP columns to show up to 28 visual rows of subtools before a per-MCP `+N more` marker.
- Changed Shell column chunking to use the left-side visual row budget, so Shell fills comparable vertical space instead of stopping at the old fixed 14-row half-height shape.
- Kept executable-level shell grouping from the previous follow-up, so command families such as `git`, `docker`, `gh`, and `npm` remain collapsed.
- Extended `.analysis/tool-tooltip-layout-probe.mjs` to capture grid-template and height metrics for the opened TOOL tooltip.

Verification:
- `pnpm test src/features/dashboard/components/master-ledger-table.test.tsx` passed: 1 file, 32 tests.
- `pnpm test src/features/dashboard/components/master-ledger-table.test.tsx src/features/dashboard/components/primitives/hover-tooltip.test.tsx` passed: 2 files, 38 tests.
- `pnpm exec prettier --write src/features/dashboard/components/master-ledger-table.tsx src/features/dashboard/components/master-ledger-table.test.tsx .analysis/tool-tooltip-layout-probe.mjs` completed.
- `pnpm lint` passed with the existing 23-warning baseline and 0 errors.
- `pnpm build` passed.
- `git diff --check` passed.
- `docker compose -f docker-compose.yml up -d --build --no-deps dashboard-shell` rebuilt and restarted the static shell container.
- `docker ps --filter name=dashboard-shell-dashboard-shell-1` showed the rebuilt static shell container healthy on `0.0.0.0:3005->80/tcp`.
- `DASHBOARD_URL=http://127.0.0.1:3005 node .analysis/tool-tooltip-layout-probe.mjs` opened the TOOL tooltip on the rebuilt static shell with `tooltipFound: true`, no console errors, no page errors, and no failed requests.
- The static TOOL hover probe measured outer grid `minmax(0px, 6fr) minmax(0px, 3fr)`, Tools grid `repeat(6, minmax(0px, 1fr))`, Shell grid `repeat(3, minmax(0px, 1fr))`, panel `1272x403`, Tools grid height `255`, Shell grid height `355`, and only Shell `+53 more` in the sampled MCP-heavy Anthropic row.
- `/usr/bin/python3 -c ... /tmp/tool-tooltip-layout-probe.json` found no forbidden multi-part shell labels among `git show`, `git log`, `git commit`, `docker exec`, `docker compose`, `gh run`, `gh pr`, `npm run`, or `npm test`.

### 2026-05-22 - D1-018 follow-up - Animate multi-reset quota velocity bars

Status: Completed

Changed paths:
- `server/report-service.mjs`
- `src/features/dashboard/api/usage-report.ts`
- `src/features/dashboard/components/phosphor-dashboard.tsx`
- `src/features/dashboard/components/phosphor-dashboard.test.tsx`
- `src/features/dashboard/components/provider-card.tsx`
- `src/features/dashboard/components/provider-card.test.tsx`
- `src/styles/index.css`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Extended quota history rows with `velocity_segments`, `velocity_scores`, and `velocity_sample_count` derived from `rate_limit_observations` inside each prior reset window.
- Wired prior reset bars through the same 100-segment `buildQuotaSegments()` path as current bars, preserving velocity tier classes on `.quota-row-bar.is-prior` intervals.
- Removed the CSS current-only guard so high-velocity shimmer/glow applies to prior reset bars while remaining clipped to each segment and isolated per bar.
- Tightened report-cache miss handling so foreground dashboard requests do not wait behind long Redis/prewarm locks and local/foreground SQL results can satisfy or repopulate cache.

Verification:
- `node --check server/report-service.mjs` passed.
- `./node_modules/.bin/vitest run src/features/dashboard/components/phosphor-dashboard.test.tsx src/features/dashboard/components/provider-card.test.tsx src/features/dashboard/components/primitives/quota-interval-bar.test.tsx` passed: 3 files, 95 tests.
- `npm run build` passed.
- `npm run lint` passed with the existing 23-warning baseline and 0 errors.
- `docker compose -f docker-compose.yml restart dashboard-shell-reports` and `docker compose -f docker-compose.dev.yml restart dashboard-shell-reports-dev` restarted report services after backend edits.
- `docker compose -f docker-compose.yml up -d --build --no-deps dashboard-shell` rebuilt the static shell image, and `docker compose -f docker-compose.yml up -d --no-deps --force-recreate dashboard-shell` put the rebuilt shell on port 3005.
- Static and dev API smoke for `/api/shell/reports/usage?from=2026-04-22&to=2026-05-23&grain=day&group_by=provider%2Cmodel%2Crepository&limit=50000&sort=period_end` returned 35 quota-history rows with 27 rows carrying velocity scores on both 3005 and 3006; tier counts were `slow=185`, `steady=337`, `fast=195`, `hot=217`, `peak=443`.
- Headless Chrome DOM probe against `http://127.0.0.1:3005/` and `http://127.0.0.1:3006/` saw `loadingText: false`, 2,300 quota intervals, 12 prior reset bars, 1,200 prior intervals, and prior velocity classes including `velocity-hot=103`, `velocity-peak=228`, `velocity-slow=41`, `velocity-steady=183`; both usage and quota report requests returned 200 with no failed requests or page exceptions.

### 2026-05-22 - D1-018 follow-up - Move fleet health into aggregate and restore local health rows

Status: Completed

Changed paths:
- `server/report-service.mjs`
- `src/features/dashboard/components/phosphor-dashboard.tsx`
- `src/features/dashboard/components/phosphor-dashboard.test.tsx`
- `src/features/dashboard/components/primitives/health-strip.tsx`
- `src/features/dashboard/components/primitives/health-strip.test.tsx`
- `src/features/dashboard/components/provider-card.tsx`
- `src/features/dashboard/index.tsx`
- `src/features/dashboard/lib/usage-report-display.ts`
- `src/features/dashboard/lib/usage-report-display.test.ts`
- `src/styles/index.css`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Removed the header Fleet Health Pulse strip and the old attribution legend under it.
- Replaced the Aggregate Totals health strip input with a bucket overlay of all non-`proxy_internal` provider health rows, including local rows when present.
- Added local-provider health rows in `server/report-service.mjs` from `public.session_history` local route latency, canonicalized local/NVIDIA aliases, and scoped provider-health SQL to the 24-hour status-bar window ending at now for live ranges.
- Changed health-strip tooltips so provider and aggregate vertical bars auto-select the newest error/degraded bucket and show relative bucket time plus error/degraded breakdown rows.
- Made degraded probe/control health signals drive orange/red strip state even when passive request latency exists, so those buckets no longer hide behind a green latency-only path.
- Changed missing-provider padding to the raw no-data path so absent health rows render blue rather than blank/neutral.
- Applied the distinct quota burn color variables to both the burn legend and actual quota/multi-reset bar velocity classes.

Verification:
- `node --check server/report-service.mjs` passed.
- `git diff --check` passed.
- `./node_modules/.bin/vitest run src/styles/quota-burn-colors.test.ts src/features/dashboard/components/primitives/quota-interval-bar.test.tsx src/features/dashboard/components/primitives/health-strip.test.tsx src/features/dashboard/components/provider-card.test.tsx src/features/dashboard/components/aggregate-card.test.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx src/features/dashboard/lib/usage-report-display.test.ts src/features/dashboard/index.test.tsx` passed: 8 files, 248 tests.
- `npm run lint` passed with the existing 24-warning baseline and 0 errors.
- `npm run build` passed.
- `docker compose -f docker-compose.yml restart dashboard-shell-reports` restarted the bind-mounted report service; `curl -sS -i http://127.0.0.1:3005/api/shell/health` returned `200` with `{"ok":true,"databaseConfigured":true,"redisConfigured":true,"redisReady":true}`.
- Cache-busted `curl` to `/api/shell/reports/usage?from=2026-05-16&to=2026-05-23&grain=day&group_by=provider,model,repository&cache_bust=live-health-1` returned `HTTP_STATUS:200`, `TIME_TOTAL:21.823554`, and 2,411 provider-health rows.
- Parsed live payload showed provider counts `anthropic:572, gemini:287, local:90, nvidia_nim:287, openai:292, openrouter:599, xai:284`; local sample rows had `total_p95_ms` populated from `session_history`, and aggregate source providers were `anthropic,gemini,local,nvidia_nim,openai,openrouter,xai`.
- `docker compose -f docker-compose.yml up -d --build --no-deps dashboard-shell` rebuilt and restarted the static shell; `docker ps --filter name=dashboard-shell-dashboard-shell-1` showed it healthy on `0.0.0.0:3005->80/tcp`.
- Playwright against `http://127.0.0.1:3005/` at 2275x1280 found 8 visible provider cards, no `FLEET HEALTH PULSE` text, no `attribution` legend text, a populated Local health strip, and a populated aggregate health strip.
- Playwright hover on the aggregate health strip opened an opaque `rgba(11, 16, 24, 0.96)` health tooltip with relative time text `−0h 26m → −0h 21m · 2 events` and rows `Provider errors1` and `5xx errors1`.
- Playwright hover on the Local health strip opened an opaque health tooltip with relative time text `−1h 12m → −1h 7m · 0 events`.
- Playwright network log showed `/api/shell/reports/usage` and `/api/shell/reports/quotas` requests returning `200 OK`, and `browser_console_messages` reported 0 errors.

### 2026-05-22 - D1-018 follow-up - Add health event logs and tighten Model Ledger TOOL hover packing

Status: Completed

Changed paths:
- `server/report-service.mjs`
- `src/features/dashboard/api/usage-report.ts`
- `src/features/dashboard/components/phosphor-dashboard.tsx`
- `src/features/dashboard/components/phosphor-dashboard.test.tsx`
- `src/features/dashboard/components/primitives/health-strip.tsx`
- `src/features/dashboard/components/primitives/health-strip.test.tsx`
- `src/features/dashboard/components/master-ledger-table.tsx`
- `src/features/dashboard/components/master-ledger-table.test.tsx`
- `src/features/dashboard/lib/usage-report-display.ts`
- `src/features/dashboard/lib/usage-report-display.test.ts`
- `src/styles/index.css`
- `.analysis/completed.md`

Evidence:
- Added `error_message` to provider error observation report rows, sourced from normalized/error/message fields in `provider_error_observations.metadata`.
- Provider and aggregate health strips now attach timestamped observation/probe events to each 5-minute bucket and prefer recent event-log rows in the hover tooltip over generic breakdown-only summaries.
- Health tooltips are wider and use a health-specific grid so rows such as `2:57 PM: gpt-5.5 503 provider 5xx / upstream...` do not collapse into each other.
- TOOL hover left-side columns now pack MCP groups by visual row budget; small MCP groups can share a column and larger groups still expand vertically up to the existing 28-row budget.
- TOOL hover renders left-side tool columns in reverse source order so the highest-priority/densest tool column is directly beside the Shell breakout, with extra columns expanding leftward.
- Model Ledger model names now use display-only normalization, e.g. `gpt-5.5` -> `GPT 5.5`, while preserving `:stealth` and `:free` context as visible `stealth`/`free` suffix text.

Verification:
- `node --check server/report-service.mjs` passed.
- `git diff --check` passed.
- `./node_modules/.bin/prettier --check server/report-service.mjs src/features/dashboard/api/usage-report.ts src/features/dashboard/lib/usage-report-display.ts src/features/dashboard/lib/usage-report-display.test.ts src/features/dashboard/components/master-ledger-table.tsx src/features/dashboard/components/master-ledger-table.test.tsx src/features/dashboard/components/phosphor-dashboard.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx src/features/dashboard/components/primitives/health-strip.tsx src/features/dashboard/components/primitives/health-strip.test.tsx src/styles/index.css` passed.
- `./node_modules/.bin/vitest run src/features/dashboard/lib/usage-report-display.test.ts src/features/dashboard/components/master-ledger-table.test.tsx src/features/dashboard/components/primitives/health-strip.test.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx` passed: 4 files, 236 tests.
- `./node_modules/.bin/vitest run src/features/dashboard/components/primitives/health-strip.test.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx src/features/dashboard/components/master-ledger-table.test.tsx src/features/dashboard/components/provider-card.test.tsx src/features/dashboard/components/aggregate-card.test.tsx src/features/dashboard/lib/usage-report-display.test.ts src/features/dashboard/index.test.tsx` passed: 7 files, 270 tests.
- `npm run lint` passed with the existing 24-warning baseline and 0 errors.
- `npm run build` passed.
- `docker compose -f docker-compose.yml restart dashboard-shell-reports` restarted the bind-mounted report service.
- `docker compose -f docker-compose.yml up -d --build --no-deps dashboard-shell` rebuilt and restarted the static shell on port 3005.
- `curl -sS -o /tmp/dashboard-shell-health.txt -w 'HTTP_STATUS:%{http_code} TIME_TOTAL:%{time_total}\n' http://127.0.0.1:3005/api/shell/health` returned `HTTP_STATUS:200`.
- Cache-busted 1-day usage report `/api/shell/reports/usage?from=2026-05-22&to=2026-05-23&grain=day&group_by=provider,model,repository&cache_bust=event-log-verify-2` returned `HTTP_STATUS:200`, `TIME_TOTAL:34.838216`, 12 `providerErrorObservations`, and all 12 carried `error_message`.
- Playwright against `http://127.0.0.1:3005/` set the report to `from=2026-05-22`, `to=2026-05-23`; network requests for usage and quota reports returned `200 OK`.
- Playwright hover on the OpenAI health strip opened event-log rows with concrete messages such as `503 provider 5xx / upstream connect error or disconnect/reset before headers...`.
- Playwright inspection of the Model Ledger showed normalized display names such as `Claude Opus 4 7`, `Gemini 3.1 Pro Preview`, and `Openrouter/Qwen/Qwen3 Embedding 8b`.
- Playwright hover on the first Model Ledger TOOL cell opened `Claude Opus 4 7 — tool breakdown`, with Tools immediately next to `Shell (114 calls)`.

### 2026-05-23 - D1-070 - Keep aggregate provider health visible at 1920px

Status: Completed

Changed paths:
- `src/styles/index.css`
- `src/features/dashboard/components/phosphor-dashboard.tsx`
- `src/features/dashboard/components/aggregate-card.tsx`
- `.analysis/completed.md`

Evidence:
- Removed the CSS rule that forced `.provider-card.aggregate` to `display: none` below `2100px`.
- Kept the aggregate dashed-border styling intact.
- Updated stale comments that described the aggregate card as hidden below `2100px`.
- At `1920x1080`, the aggregate card now wraps into the second provider-health grid row instead of disappearing.

Verification:
- `pnpm exec prettier --check src/styles/index.css src/features/dashboard/components/phosphor-dashboard.tsx src/features/dashboard/components/aggregate-card.tsx` passed.
- `pnpm exec vitest run src/features/dashboard/components/aggregate-card.test.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx` passed: 2 files, 79 tests.
- `pnpm exec tsc -b --pretty false` passed.
- `git diff --check` passed.
- Playwright at `1920x1080` on `http://127.0.0.1:3006/?verify=aggregate-1920` found `.provider-card.aggregate` with `display: flex`, non-zero dimensions, visible in viewport, and 0 console errors.

### 2026-05-23 - D1-069 - Add Model and Repository Ledger tabs

Status: Completed

Changed paths:
- `src/features/dashboard/components/master-ledger-table.tsx`
- `src/features/dashboard/components/master-ledger-table.test.tsx`
- `src/features/dashboard/components/phosphor-dashboard.tsx`
- `.analysis/completed.md`

Evidence:
- Renamed the dashboard section heading from `Model Ledger · Provider → Family → Model → Repository` to `LEDGER`.
- Added a tablist inside the ledger with `Model` and `Repository` tabs.
- `Model` tab keeps the existing drilldown: `Provider -> Family -> Model -> Repository`.
- `Repository` tab pivots the same display-only data to: `Repository -> Provider -> Family -> Model`.
- The repository-first view is built from the existing model rows and repository child rows; source provider/model data is not rewritten.

Verification:
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec vitest run src/features/dashboard/components/master-ledger-table.test.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx` passed: 2 files, 116 tests.
- `git diff --check` passed.
- Playwright loaded `http://127.0.0.1:3006/?verify=ledger-tabs`; the ledger heading was `LEDGER`, tabs were `Model` and `Repository`, `#repos` was absent, switching to `Repository` selected that tab, displayed repository rows, and produced 0 console errors.

### 2026-05-23 - D1-068 - Fold repository detail into Model Ledger hierarchy

Status: Completed

Changed paths:
- `src/features/dashboard/components/master-ledger-table.tsx`
- `src/features/dashboard/components/master-ledger-table.test.tsx`
- `src/features/dashboard/components/phosphor-dashboard.tsx`
- `src/features/dashboard/components/phosphor-dashboard.test.tsx`
- `src/features/dashboard/components/anchor-bar.tsx`
- `src/features/dashboard/components/anchor-bar.test.tsx`
- `.analysis/completed.md`

Evidence:
- Removed the standalone Repository Breakdown section from the General dashboard render path.
- Removed the `Repos` anchor/keyboard shortcut because repository detail now lives under Model Ledger.
- Model Ledger now drills down as `Provider -> Family -> Model -> Repository`.
- Exact model rows expand into repository rows built from existing `report.rows`; raw model/provider values are not rewritten.
- Repository rows canonicalize trailing ` (memory)` suffixes before aggregation.
- Anthropic exact-model labels are display-only product labels without the `Claude` prefix, for example `Opus 4.7` and `Opus 4.6`.
- OpenRouter now derives secondary family groups from routed model naming, including `Qwen`, `OpenAI`, `InclusionAI`, and similar provider namespaces.

Verification:
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec prettier --check src/features/dashboard/components/master-ledger-table.tsx src/features/dashboard/components/master-ledger-table.test.tsx src/features/dashboard/components/phosphor-dashboard.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx src/features/dashboard/components/anchor-bar.tsx src/features/dashboard/components/anchor-bar.test.tsx` passed.
- `pnpm exec vitest run src/features/dashboard/components/master-ledger-table.test.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx src/features/dashboard/components/anchor-bar.test.tsx` passed: 3 files, 120 tests.
- `git diff --check` passed.
- Playwright loaded `http://127.0.0.1:3006/?verify=model-ledger-repos` with 0 console errors after expanding OpenRouter.
- Playwright confirmed `#repos` is absent, Model Ledger heading is `Model Ledger · Provider → Family → Model → Repository`, OpenRouter family rows include `Qwen`, and Anthropic Opus rows render as `Opus 4.7` / `Opus 4.6` with repository children such as `dashboard-shell` and `aawm-tap`.

### 2026-05-23 - D1-067 - Restore fresh dashboard session data after report cache lock contention

Status: Completed

Changed paths:
- `server/report-service.mjs`
- `docker-compose.dev.yml`
- `docker-compose.yml`
- `.analysis/completed.md`

Evidence:
- Confirmed `public.session_history` had new rows while the dashboard was not showing them: `MAX(created_at)` reached `2026-05-23 06:14:28.020701+00` and later `2026-05-23 06:24:01.822115+00`.
- Found the dev Vite proxy was still targeting the report container's old Docker IP after report-service restart, causing `/api/shell/reports/*` proxy failures until `dashboard-shell-dev` was restarted.
- Found the static report-service container was still running old cache-prewarm behavior against the shared Redis namespace, repeatedly prewarming heavy usage windows and competing with the dev dashboard.
- Found stale Redis `v9` report locks with 12-26 minutes of TTL left after service restarts, so fresh requests waited and then fell back into duplicate SQL work.
- Changed cold cache miss handling so concurrent foreground requests share the same in-process refresh promise instead of starting duplicate SQL fanout.
- Added `application_name: dashboard-shell-report-service` to the Postgres pool so report-service queries are identifiable in `pg_stat_activity`.
- Bumped the report cache namespace to `v10` and wired `SHELL_REPORT_CACHE_VERSION` through both compose files so deploy-time cache busting is explicit.
- Recreated both dev and static report services with cache prewarm disabled, then restarted the dev shell proxy.

Verification:
- `node --check server/report-service.mjs` passed.
- `docker compose -f docker-compose.dev.yml up -d dashboard-shell-reports-dev dashboard-shell-dev` recreated the dev report service on the `v10` namespace.
- `docker compose -f docker-compose.yml up -d dashboard-shell-reports` recreated the static report service on the `v10` namespace.
- `curl -sS -i 'http://127.0.0.1:3006/api/shell/reports/usage/token-trend-summary?from=2026-05-23&to=2026-05-24&grain=day&groupBy=provider&limit=500'` returned `200 OK`, `cacheStatus: miss`, `cacheGeneratedAt: 2026-05-23T06:23:35.403Z`, and Codex rows through `2026-05-23T06:23:30.653Z`.
- `curl -sS -i 'http://127.0.0.1:3006/api/shell/reports/usage?from=2026-05-23&to=2026-05-24&grain=day&group_by=provider%2Cmodel%2Crepository&limit=50000&sort=period_end'` returned `200 OK`, `cacheStatus: miss`, `cacheGeneratedAt: 2026-05-23T06:23:45.854Z`, `latestRecordAt: 2026-05-23T06:22:22.382Z`, and summary `latest_record_at: 2026-05-23T06:23:30.653Z`.
- Playwright navigation to `http://127.0.0.1:3006/` loaded `Dashboard Shell - General Dashboard` with 0 console errors; report network requests for main usage and quotas returned `200 OK`, and the replacement token-trend-summary request returned `200 OK`.

### 2026-05-24 - D1-074 - Surface source-data recency and recent provider request counts

Status: Completed

Changed paths:
- `src/features/dashboard/index.tsx`
- `src/features/dashboard/index.test.tsx`
- `src/features/dashboard/components/provider-card.tsx`
- `src/features/dashboard/components/provider-card.test.tsx`
- `src/features/dashboard/components/aggregate-card.test.tsx`
- `src/features/dashboard/components/phosphor-dashboard.tsx`
- `src/styles/index.css`
- `.analysis/completed.md`

Evidence:
- Added a compact `Session`, `Quota`, and `Health` recency breakout beside the top freshness indicator.
- `Session` recency uses the report metadata/latest session history timestamp.
- `Quota` recency is derived from the latest quota interval start timestamp in the quota payload, avoiding future reset/interval-end timestamps.
- `Health` recency is derived from the newest provider health bucket timestamp.
- Replaced the provider card `no-reasoning requests` row with `requests 90m`, derived from provider health `requests` in buckets from the last 90 minutes.
- Aggregate provider card uses the same last-90-minute health request calculation across all health rows.

Verification:
- `pnpm exec vitest run src/features/dashboard/index.test.tsx src/features/dashboard/components/provider-card.test.tsx src/features/dashboard/components/aggregate-card.test.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx` passed: 4 files, 109 tests.
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec eslint src/features/dashboard/index.tsx src/features/dashboard/index.test.tsx src/features/dashboard/components/provider-card.tsx src/features/dashboard/components/provider-card.test.tsx src/features/dashboard/components/aggregate-card.test.tsx src/features/dashboard/components/phosphor-dashboard.tsx` passed with the existing `react-refresh/only-export-components` warning baseline in `phosphor-dashboard.tsx`.
- `git diff --check` passed.
- Playwright against `http://127.0.0.1:3006/` showed the header recency chips (`Session`, `Quota`, `Health`) and provider cards with `requests 90m` values such as `0`, `391`, and `0`.

### 2026-05-24 - D1-073 - Add freshness force-refresh button

Status: Completed

Changed paths:
- `src/features/dashboard/api/usage-report.ts`
- `src/features/dashboard/index.tsx`
- `src/features/dashboard/index.test.tsx`
- `src/styles/index.css`
- `.analysis/completed.md`

Evidence:
- Added a `Refresh` button immediately beside the top freshness indicator.
- Clicking the button updates a `cache_bust` nonce on the main usage report request, producing a new report-service cache key and forcing the request through the SQL/cache refill path instead of reusing the existing Redis key.
- The button disables and shows the existing spinning refresh icon while the report query is fetching.
- Added regression coverage that clicking the button produces a usage report request with `cache_bust`.

Verification:
- `pnpm exec vitest run src/features/dashboard/index.test.tsx` passed: 1 file, 3 tests.
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec eslint src/features/dashboard/api/usage-report.ts src/features/dashboard/index.tsx src/features/dashboard/index.test.tsx` passed.
- `git diff --check` passed.
- Playwright against `http://127.0.0.1:3006/` confirmed the button appears beside the freshness label and clicking it issued `GET /api/shell/reports/usage?...&cache_bust=... => 200 OK`; the freshness label updated from `13:38:24 UTC` to `13:40:10 UTC`.

### 2026-05-23 - D1-072 - Pin dashboard hover tooltips with Control

Status: Completed

Changed paths:
- `src/features/dashboard/components/primitives/hover-tooltip.tsx`
- `src/features/dashboard/components/primitives/hover-tooltip.test.tsx`
- `.analysis/completed.md`

Evidence:
- Shared `HoverTooltip` now supports pinning the currently open tooltip by pressing the Control key while it is visible.
- A pinned tooltip stays open after the pointer leaves the original hover target.
- Escape closes and unpins the tooltip; clicking outside the trigger/panel also closes pinned tooltips.
- The tooltip DOM exposes `data-pinned` for regression coverage and browser inspection.

Verification:
- `pnpm exec vitest run src/features/dashboard/components/primitives/hover-tooltip.test.tsx` passed: 1 file, 8 tests.
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec eslint src/features/dashboard/components/primitives/hover-tooltip.tsx src/features/dashboard/components/primitives/hover-tooltip.test.tsx` passed.
- `git diff --check` passed.
- Playwright against `http://127.0.0.1:3006/` confirmed hovering the Dashboard alert dot, pressing Control, and moving to `main` leaves the tooltip `data-state="open"` and `data-pinned="true"`; pressing Escape changes it to `data-state="closed"` and `data-pinned="false"`.

### 2026-05-23 - D1-071 - Move dashboard alerts into sidebar status dot

Status: Completed

Changed paths:
- `src/features/dashboard/index.tsx`
- `src/features/dashboard/hooks/use-alerts-from-anomalies.ts`
- `src/features/dashboard/hooks/use-alerts-from-anomalies.test.ts`
- `src/features/dashboard/components/phosphor-sidebar.tsx`
- `src/features/dashboard/components/phosphor-sidebar.test.tsx`
- `src/styles/index.css`
- `.analysis/completed.md`

Evidence:
- Removed the full right-side Alerts rail from the dashboard layout path by no longer passing the `alerts` slot to `PhosphorLayout`.
- Added an issue-only dashboard alert summary for the sidebar dot; healthy provider rows and sync-status filler rows are not included in the issue list.
- Sidebar `Dashboard` row now shows a right-aligned status dot: green for OK, amber for warnings, red for errors; amber/red dots blink with different timings when reduced motion is not requested.
- Alert hover detail now includes recent provider errors from `provider_error_observations` in the last 90 minutes, failed provider probe/ping counts from `provider_latency_health`, anomaly warnings, high request volume, and descriptive quota lane warnings.
- Quota warnings are deduplicated per display lane and use provider/class language such as `Google Flash Lite 24h requests exhausted`, `OpenAI Codex Spark 7d exhausted`, or `OpenRouter Free 24h requests exhausted`.

Verification:
- `pnpm exec vitest run src/features/dashboard/hooks/use-alerts-from-anomalies.test.ts src/features/dashboard/components/phosphor-sidebar.test.tsx` passed: 2 files, 9 tests.
- `pnpm exec tsc -b --pretty false` passed.
- `git diff --check` passed.
- Playwright against `http://127.0.0.1:3006/` confirmed the layout grid has two columns (`200px 1684px`), the Dashboard sidebar row has an 8x8 red status dot, and hovering the dot renders the portalled black tooltip with recent provider errors and quota warnings; browser console check showed 0 warnings/errors.

### 2026-05-23 - D1-059 - Split Token Trend version detail into a compact active-version lane

Status: Completed

Changed paths:
- `src/features/dashboard/components/token-trend-chart.tsx`
- `src/features/dashboard/components/token-trend-chart.test.tsx`
- `src/features/dashboard/components/phosphor-dashboard.test.tsx`
- `src/features/dashboard/lib/trend-utils.ts`
- `src/features/dashboard/lib/trend-utils.test.ts`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Removed the client-version release/continuation SVG overlay from inside the hourly usage bars.
- Added daily token scale markers to the hourly Token Trend usage lane.
- Added a compact active-version lane underneath the hourly usage chart, limited to Claude, Codex, Gemini, and Grok families.
- Active-version lane segments keep provider-colored release/continuation marks and preserve per-segment detail in SVG/title metadata.
- Concurrent versions are packed into separate rows, while one-hour same-time release points can share a row so backfilled release bursts do not make the lane explode vertically.
- Hash-suffixed client build variants such as `2.1.118.ab0` and `2.1.118.8f1` collapse to the base displayed version `2.1.118` in the lane.
- Usage-chart hover behavior remains day-wide and the lazy day-detail fetch path is unchanged.

Verification:
- `pnpm exec tsc -b --pretty false` passed.
- `./node_modules/.bin/vitest run src/features/dashboard/lib/trend-utils.test.ts src/features/dashboard/components/token-trend-chart.test.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx` passed: 3 files, 99 tests.
- `pnpm exec prettier --check src/features/dashboard/lib/trend-utils.ts src/features/dashboard/components/token-trend-chart.tsx src/features/dashboard/lib/trend-utils.test.ts src/features/dashboard/components/token-trend-chart.test.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx .analysis/todo.md` passed.
- `git diff --check` passed.
- `pnpm run lint` passed with the existing 24-warning baseline and 0 errors.
- `pnpm run build` passed.
- Playwright against `http://127.0.0.1:3006/` reported 0 console errors after a fresh navigation.
- Playwright DOM probe on `#tokens` found 30 day envelopes, 720 hourly bars, 4 token scale markers, 1 active-version lane, family rows `Claude`, `Codex`, `Gemini`, and `Grok`, 93 active-version SVG lines, 93 release dots, and 0 old `.tt-version-overlay/.tt-version-line/.tt-version-line-halo` nodes.
- The same Playwright probe measured the Token Trend section at `1120x495.6`, usage chart at `1120x224`, and compact version lane at `1120x202` after live data normalization and point packing.

### 2026-05-23 - D1-061 - Consolidate client-version detail into Token Trend lane

Status: Completed

Changed paths:
- `server/report-service.mjs`
- `src/features/dashboard/components/anchor-bar.tsx`
- `src/features/dashboard/components/anchor-bar.test.tsx`
- `src/features/dashboard/components/phosphor-dashboard.tsx`
- `src/features/dashboard/components/phosphor-dashboard.test.tsx`
- `src/features/dashboard/components/token-trend-chart.tsx`
- `src/features/dashboard/components/token-trend-chart.test.tsx`
- `src/features/dashboard/lib/trend-utils.ts`
- `src/features/dashboard/lib/trend-utils.test.ts`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Kept XAI/Grok `client_version = '0.0.0'` eligible for Token Trend active-version intervals instead of filtering it out with generic unknown versions.
- Added a regression assertion that `normalizeTokenTrendClientVersionForLane('0.0.0')` stays `0.0.0`, and that a Grok lane segment can display `0.0.0` when present.
- Removed the standalone dashboard `Client Usage` section, its local donut/table row builders, and the dead dashboard imports that only powered that section.
- Removed the `Clients` anchor shortcut so the anchor bar no longer points at the removed `#clients` section.
- Kept the slicer `Client` filter path intact by continuing to derive client options from `report.clients`.
- Live cache-busted token trend summary on port `3006` returned backfilled Grok rows for `grok-build` versions `0.1.210` and `0.1.211`.

Verification:
- `node --check server/report-service.mjs` passed.
- `pnpm exec tsc -b --pretty false` passed.
- `./node_modules/.bin/vitest run src/features/dashboard/lib/trend-utils.test.ts src/features/dashboard/components/token-trend-chart.test.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx src/features/dashboard/components/anchor-bar.test.tsx src/features/dashboard/index.test.tsx` passed: 5 files, 107 tests.
- `pnpm exec prettier --check server/report-service.mjs src/features/dashboard/components/anchor-bar.tsx src/features/dashboard/components/anchor-bar.test.tsx src/features/dashboard/components/phosphor-dashboard.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx src/features/dashboard/components/token-trend-chart.tsx src/features/dashboard/components/token-trend-chart.test.tsx src/features/dashboard/lib/trend-utils.ts src/features/dashboard/lib/trend-utils.test.ts .analysis/todo.md` passed.
- `git diff --check` passed.
- `pnpm run lint` passed with the existing 24-warning baseline and 0 errors.
- `pnpm run build` passed.
- `docker compose -f docker-compose.dev.yml restart dashboard-shell-dev dashboard-shell-reports-dev` refreshed the stale Vite transform and report service; `docker ps` showed both dev containers healthy.
- Cache-busted `curl` to `http://127.0.0.1:3006/api/shell/reports/usage/token-trend-summary?from=2026-04-23&to=2026-05-24&cache_bust=client-panel-removal` returned `200` and two XAI/Grok interval rows: `0.1.210` and `0.1.211`.
- Playwright against `http://127.0.0.1:3006/?verify=client-panel-removal` reported 0 new browser console errors after restart.
- Playwright DOM probe showed `Client Usage` absent, `document.getElementById('clients') === null`, anchor links `[S]Status`, `[T]Tokens`, `[M]Models`, `[R]Repos`, and `[H]Health`, and Token Trend lane text including `grok-build 0.1.210` and `grok-build 0.1.211`.

### 2026-05-23 - D1-065 - Collapse Model Ledger hierarchy and repo memory rows

Status: Completed

Changed paths:
- `src/features/dashboard/components/master-ledger-table.tsx`
- `src/features/dashboard/components/master-ledger-table.test.tsx`
- `src/features/dashboard/components/phosphor-dashboard.tsx`
- `src/features/dashboard/components/phosphor-dashboard.test.tsx`
- `src/styles/index.css`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Model Ledger now derives display-only provider/family/model rows inside `MasterLedgerTable`, leaving the raw exact `ModelRow[]` available for comparison panels and other consumers.
- The default Model Ledger view renders one row per provider; provider rows can expand to configured families for Anthropic, OpenAI, and Google, and family rows expand to exact model rows.
- Providers without configured families, such as OpenRouter, expand directly to exact model rows.
- Aggregate provider/family rows sum token/request/cost/tool fields, recompute weighted error and cache percentages, sum sparklines, and suppress exact-model tool/error hover details.
- Removed Model Ledger non-sparkline `.microbar` rendering and stale CSS while keeping the Tokens Trend sparkline column.
- Repository Breakdown canonicalizes trailing ` (memory)` suffixes before row and sparkline aggregation, so base and memory rows merge.

Verification:
- `pnpm exec vitest run src/features/dashboard/components/master-ledger-table.test.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx --reporter=dot` passed: 2 files, 113 tests.
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm test -- --run --reporter=dot` passed: 35 files, 484 tests.
- `pnpm run lint` passed with the existing warning baseline and 0 errors.
- `pnpm run build` passed.
- `git diff --check` passed.
- `curl -sS -o /tmp/dashboard-shell-3006.html -w "%{http_code}\n" http://127.0.0.1:3006/` returned `200`; `docker ps --filter name=dashboard-shell` showed `dashboard-shell-dev` and `dashboard-shell-reports-dev` healthy.
- Playwright against `http://127.0.0.1:3006/` found the default Model Ledger at 8 provider rows with expand buttons for Anthropic, Google, Local, NVIDIA, OpenAI, OpenRouter, Unknown, and xAI; `#models .microbar` count was 0 and body sparkline SVG count was 16.
- Playwright expanding Anthropic showed Opus, Sonnet, Haiku, and Auto Review family rows; expanding Opus showed exact rows such as `Claude Opus 4 7` and `Claude Opus 4 6`; `#models .microbar` stayed 0 and body sparkline SVG count increased to 26.
- Playwright inspection of Repository Breakdown found no visible `(memory)` rows in live data after canonicalization, and the unit regression covers `dashboard-shell` plus `dashboard-shell (memory)` merging into one row with summed tokens/cost/requests/sparkline.

### 2026-05-24 - D1-075 - Pull LiteLLM Docker log messages into dashboard alerts

Status: Completed

Changed paths:
- `docker-compose.dev.yml`
- `docker-compose.yml`
- `server/report-service.mjs`
- `src/features/dashboard/api/usage-report.ts`
- `src/features/dashboard/hooks/use-alerts-from-anomalies.ts`
- `src/features/dashboard/hooks/use-alerts-from-anomalies.test.ts`
- `src/features/dashboard/index.tsx`
- `.analysis/completed.md`

Evidence:
- Report service now reads a bounded tail of Docker JSON logs for the configured containers, defaulting to `aawm-litellm` and `litellm-dev`.
- Compose mounts `/var/lib/docker/containers` read-only into the report service as `/host/docker/containers`; the service maps container names through Docker `config.v2.json` files instead of hardcoding container IDs.
- The usage report API now returns `dockerLogErrors` with observed time, container, stream, inferred provider, status code, level, and compact message.
- Sidebar dashboard alert aggregation now samples message text from both `providerErrorObservations.error_message` and `dockerLogErrors.message`.

Verification:
- `node --check server/report-service.mjs` passed.
- `pnpm exec vitest run src/features/dashboard/hooks/use-alerts-from-anomalies.test.ts src/features/dashboard/index.test.tsx` passed: 2 files, 9 tests.
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec eslint server/report-service.mjs src/features/dashboard/hooks/use-alerts-from-anomalies.ts src/features/dashboard/hooks/use-alerts-from-anomalies.test.ts src/features/dashboard/index.tsx src/features/dashboard/api/usage-report.ts` passed.
- `git diff --check` passed.
- `docker compose -f docker-compose.dev.yml up -d dashboard-shell-reports-dev` recreated the report service with the new read-only Docker log mount; `docker ps --filter name=dashboard-shell-reports-dev` showed the container healthy.
- `curl -sS http://127.0.0.1:3006/api/shell/health` returned `{"ok":true,"databaseConfigured":true,"redisConfigured":true,"redisReady":true}`.
- Cache-busted usage report verification returned `dockerLogErrors` count `32`; sample rows included `aawm-litellm` 404 Anthropic messages such as `model: claude-opus-4-7[1m]`.

### 2026-05-24 - D1-076 - Exclude transport clients from Token Trend version lane

Status: Completed

Changed paths:
- `src/features/dashboard/components/token-trend-chart.tsx`
- `src/features/dashboard/components/token-trend-chart.test.tsx`
- `src/features/dashboard/lib/trend-utils.ts`
- `src/features/dashboard/lib/trend-utils.test.ts`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Added a shared `isTokenTrendActiveVersionClient` predicate so the Token Trend active-version lane only accepts Claude, Codex, Gemini, and Grok/xAI TUI or CLI client identities.
- Removed the provider-only fallback that caused generic clients on Google/xAI, such as `python-httpx` or `curl`, to show as Gemini/Grok active versions.
- Tightened the Codex allowlist to `codex-tui` instead of any client/version text containing `codex`, excluding smoke harness names such as `codex dev smoke 2026*`.
- Kept Grok `0.0.0` eligible when the client identity itself is Grok/xAI, so intentionally backfilled Grok rows still display.
- Applied the same filter to day-hover release and active-version detail rows.

Verification:
- `pnpm exec vitest run src/features/dashboard/lib/trend-utils.test.ts src/features/dashboard/components/token-trend-chart.test.tsx` passed: 2 files, 30 tests.
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec eslint src/features/dashboard/lib/trend-utils.ts src/features/dashboard/lib/trend-utils.test.ts src/features/dashboard/components/token-trend-chart.tsx src/features/dashboard/components/token-trend-chart.test.tsx` passed.
- `git diff --check` passed before completion-log update.
- `curl -sS -o /tmp/dashboard-shell-tui-filter.html -w '%{http_code}\n' 'http://127.0.0.1:3006/?verify=tui-client-filter'` returned `200`.
- Playwright against `http://127.0.0.1:3006/?verify=tui-client-filter` found the active-version lane present with `42` line/label pairs and no `httpx`, `python-httpx`, `0.28.1`, or `curl` text in the lane; browser console had 0 errors.
- Playwright against `http://127.0.0.1:3006/?verify=codex-smoke-filter` found `codex-tui` still present and no `codex dev smoke`, `dev smoke`, or `2026.05.24` text in the active-version lane; browser console had 0 errors.

### 2026-05-25 - D1-077 - Add quota-tooltip request counts

Status: Completed

Changed paths:
- `server/report-service.mjs`
- `src/features/dashboard/api/usage-report.ts`
- `src/features/dashboard/components/phosphor-dashboard.tsx`
- `src/features/dashboard/components/phosphor-dashboard.test.tsx`
- `src/features/dashboard/components/provider-card.tsx`
- `src/features/dashboard/components/provider-card.test.tsx`
- `src/styles/index.css`
- `.analysis/completed.md`

Evidence:
- Quota usage breakdown rows now include `recent_traces_90m` alongside the quota-window `traces` count.
- Quota hover tooltips show total requests for the hovered quota window, total requests in the last 90 minutes across the same model set, and per-model request counts with per-model last-90-minute counts.
- Google class aggregation and Anthropic/OpenAI single-label quota tiers preserve summed request counts when models are collapsed for display.

Verification:
- `node --check server/report-service.mjs` passed.
- `pnpm exec vitest run src/features/dashboard/components/provider-card.test.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx` passed: 2 files, 101 tests.
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec eslint server/report-service.mjs src/features/dashboard/components/provider-card.tsx src/features/dashboard/components/phosphor-dashboard.tsx src/features/dashboard/api/usage-report.ts src/features/dashboard/components/provider-card.test.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx` passed with the existing `react-refresh/only-export-components` warning baseline and 0 errors.
- `git diff --check` passed.
- Restarted `dashboard-shell-reports-dev`, cleared the stale Redis quota cache key, and queried `http://127.0.0.1:3006/api/shell/reports/quotas`; a live Anthropic quota breakdown row returned `traces: 16302` and `recent_traces_90m: 258`.
- Playwright against `http://127.0.0.1:3006/` hovered quota slots and found tooltip text including `requests`, `requests 90m`, and per-model rows such as `319 req · 159 90m`.

### 2026-05-25 - D1-078 - Add Local probe chips and Trend metric scales

Status: Completed

Changed paths:
- `docker-compose.dev.yml`
- `docker-compose.yml`
- `server/report-service.mjs`
- `src/features/dashboard/api/usage-report.ts`
- `src/features/dashboard/components/phosphor-dashboard.tsx`
- `src/features/dashboard/components/provider-card.tsx`
- `src/features/dashboard/components/provider-card.test.tsx`
- `src/features/dashboard/components/token-trend-chart.tsx`
- `src/features/dashboard/components/token-trend-chart.test.tsx`
- `src/styles/index.css`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Report service now emits `localHealth` probe rows for local infra and local model endpoints, including LiteLLM, LiteLLM Dev, CLI Proxy, Langfuse Web, Langfuse Worker, Langfuse Redis, ClickHouse, MinIO, and GROBID.
- Redis health is checked with a direct RESP `PING`; Redis does not expose an HTTP health endpoint.
- The Local provider card renders compact green/yellow/red local-health chips with accessible labels.
- The Trend `Request` and `Tool` lower lanes now render compact scale markers labeled in requests and tool calls, matching the existing token scale-marker pattern.
- Cache-busted usage-report verification returned `22` `localHealth` rows; sample rows included `Langfuse Redis` as `green` with `+PONG` and `GROBID` as `green` with `HTTP 200: true`.
- Playwright against `http://127.0.0.1:3006/` found the Local provider card rendering `LOCAL HEALTH` chips including `Langfuse Redis: healthy`, `ClickHouse: healthy`, `MinIO: healthy`, and `GROBID: healthy`.
- Playwright on the Trend lower lane found Request scale labels such as `11.5K req` through `45.8K req` and Tool scale labels such as `7.4K tools` through `29.4K tools`.

Verification:
- `node --check server/report-service.mjs` passed.
- `pnpm exec vitest run src/features/dashboard/components/provider-card.test.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx src/features/dashboard/components/token-trend-chart.test.tsx` passed: 3 files, 129 tests.
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec eslint server/report-service.mjs src/features/dashboard/api/usage-report.ts src/features/dashboard/components/provider-card.tsx src/features/dashboard/components/provider-card.test.tsx src/features/dashboard/components/phosphor-dashboard.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx src/features/dashboard/components/token-trend-chart.tsx src/features/dashboard/components/token-trend-chart.test.tsx` passed with the existing `react-refresh/only-export-components` warning baseline and 0 errors.
- `git diff --check` passed.
- `pnpm run build` passed.

### 2026-05-25 - D1-079 - Move Trend lane tabs and trim Local probes

Status: Completed

Changed paths:
- `server/report-service.mjs`
- `src/features/dashboard/components/token-trend-chart.tsx`
- `src/features/dashboard/components/token-trend-chart.test.tsx`
- `src/styles/index.css`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- The Trend `TUI` / `Request` / `Tool` tab strip now renders in the chart footer below the selected lower graph, while the provider/version legend remains right-aligned in the same footer.
- Local health probes no longer include CLI Proxy, Indus v2, or SapBERT Source.
- Source verification found no remaining `CLI Proxy`, `Indus v2`, or `SapBERT Source` monitor labels in `server`, `src`, or `.analysis/todo.md`.
- Cache-busted usage-report verification returned `19` `localHealth` rows and `removedPresent none` for CLI Proxy, Indus v2, and SapBERT Source after recreating `dashboard-shell-reports-dev`.
- Playwright against `http://127.0.0.1:3006/?verify=trend-tabs-bottom-local-trim` found `tabsBelowLane: true`, `tabsInsideFooter: true`, and `legendInsideFooter: true`.
- Playwright found the Local provider card with `19` local-health chips and no `CLI Proxy`, `Indus v2`, or `SapBERT Source` labels.

Verification:
- `node --check server/report-service.mjs` passed.
- `pnpm exec vitest run src/features/dashboard/components/token-trend-chart.test.tsx src/features/dashboard/components/provider-card.test.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx` passed: 3 files, 129 tests.
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec eslint server/report-service.mjs src/features/dashboard/components/token-trend-chart.tsx src/features/dashboard/components/token-trend-chart.test.tsx src/features/dashboard/components/provider-card.tsx src/features/dashboard/components/phosphor-dashboard.tsx` passed with the existing `react-refresh/only-export-components` warning baseline and 0 errors.
- `git diff --check` passed.
- `pnpm run build` passed.

### 2026-05-25 - D1-080 - Consolidate reasoning token displays

Status: Completed

Changed paths:
- `src/features/dashboard/components/primitives/reasoning-token-value.tsx`
- `src/features/dashboard/components/provider-card.tsx`
- `src/features/dashboard/components/provider-card.test.tsx`
- `src/features/dashboard/components/master-ledger-table.tsx`
- `src/features/dashboard/components/master-ledger-table.test.tsx`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Added a shared `ReasoningTokenValue` renderer that displays reported+estimated as one compact number, appends `*` only when estimated tokens are present, and shows a hover tooltip with separate `reported` and `estimated` rows.
- Provider cards now show a single `reasoning` token row instead of separate `reasoning reported` and `reasoning estimated` rows.
- LEDGER Reasoning cells now show the combined total with `*` instead of the prior `reported (+estimated*)` formatting.
- Playwright against `http://127.0.0.1:3006/?verify=reasoning-token-combined` found provider and ledger reasoning values such as `1.2M*`, confirmed old `reasoning reported` / `reasoning estimated` labels were absent, and verified hovering starred provider and ledger values opened tooltip text containing `Reasoning tokens`, `reported`, and `estimated`.

Verification:
- `pnpm exec vitest run src/features/dashboard/components/provider-card.test.tsx src/features/dashboard/components/master-ledger-table.test.tsx` passed: 2 files, 70 tests.
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec eslint src/features/dashboard/components/primitives/reasoning-token-value.tsx src/features/dashboard/components/provider-card.tsx src/features/dashboard/components/provider-card.test.tsx src/features/dashboard/components/master-ledger-table.tsx src/features/dashboard/components/master-ledger-table.test.tsx` passed with existing Fast Refresh/TanStack warnings and 0 errors.
- `git diff --check` passed.
- `pnpm run build` passed.

### 2026-05-25 - D1-081 - Add provider quota subtabs and active xAI range inclusion

Status: Completed

Changed paths:
- `server/report-service.mjs`
- `src/features/dashboard/components/phosphor-dashboard.tsx`
- `src/features/dashboard/components/phosphor-dashboard.test.tsx`
- `src/features/dashboard/lib/report-service-query-builders.test.ts`
- `src/styles/index.css`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- The PROVIDERS `Quota` tab now renders compact quota-type subtabs inside each provider bucket, derived from the Health-tab lane definitions.
- Anthropic and OpenAI 5hr quota lanes are omitted only from the Quota-tab history view; Health-tab lane definitions are unchanged.
- Bars inside each selected quota type are sorted by `expected_reset_at` descending.
- `quotaRangeHistory` now includes quota intervals overlapping the selected range by requiring `ri.fromDate < selected_to` and `ri.expected_reset_at >= selected_from`, which allows active long-window quotas such as xAI monthly to appear.
- Cache-busted live API verification against `http://127.0.0.1:3006/api/shell/reports/usage` returned `339` quota-history rows, including one xAI monthly row with `expected_reset_at: 2026-06-01T00:00:00.000Z`, `usage_tokens: 3797994197`, and `21139` requests.
- Playwright against `http://127.0.0.1:3006/?verify=quota-tabs-v1` found seven quota buckets, xAI `All Models · 30d` with one row, OpenAI tabs `All Models · 7d` / `codex-spark · 7d`, Anthropic tabs `Sonnet · 7d` / `All Models · 7d`, and no browser console errors.

Verification:
- `node --check server/report-service.mjs` passed.
- `pnpm exec vitest run src/features/dashboard/components/phosphor-dashboard.test.tsx src/features/dashboard/lib/report-service-query-builders.test.ts` passed: 2 files, 78 tests.
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec eslint server/report-service.mjs src/features/dashboard/components/phosphor-dashboard.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx src/features/dashboard/lib/report-service-query-builders.test.ts` passed with the existing Fast Refresh warning baseline and 0 errors.
- `pnpm exec prettier --check server/report-service.mjs src/features/dashboard/components/phosphor-dashboard.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx src/features/dashboard/lib/report-service-query-builders.test.ts src/styles/index.css .analysis/todo.md` passed.
- `git diff --check` passed.
- `pnpm run build` passed.
- Recreated `dashboard-shell-reports-dev`; `docker ps --filter name=dashboard-shell-reports-dev --format '{{.Names}} {{.Status}} {{.Ports}}'` showed `dashboard-shell-reports-dev Up ... (healthy) 3010/tcp`.

### 2026-05-25 - D1-083 - Fix Trend lower scale direction and quota-tab family grouping

Status: Completed

Changed paths:
- `src/features/dashboard/components/token-trend-chart.tsx`
- `src/features/dashboard/components/token-trend-chart.test.tsx`
- `src/features/dashboard/components/phosphor-dashboard.tsx`
- `src/features/dashboard/components/phosphor-dashboard.test.tsx`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- Trend lower Request/Tool scale markers now use `top` positions instead of `bottom` positions, matching the lower chart bars that grow downward.
- The former Providers section heading now renders as `STATUS`; the section-level tablist aria label is `Status view`.
- Anthropic Quota-tab subtabs are ordered with `All Models · 7d` first and selected by default, followed by `Sonnet · 7d`; Anthropic/OpenAI 5hr rows remain hidden from the Quota tab.
- Google Quota-tab history rows are grouped display-only by Health-tab family and rounded reset slot, so Flash-Lite/Flash/Pro each show one bar per reset even when the API returns multiple Gemini model variants.
- Playwright against `http://127.0.0.1:3006/?verify=status-quota-trend-display` found the `STATUS` heading, Request scale markers with `top: 25%/50%/75%/100%` and no bottom style, Anthropic `All Models · 7d` selected first, and Google Flash-Lite rows labeled by family rather than raw `gemini-*` variants.

Verification:
- `pnpm exec vitest run src/features/dashboard/components/phosphor-dashboard.test.tsx src/features/dashboard/components/token-trend-chart.test.tsx` passed: 2 files, 101 tests.
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec eslint src/features/dashboard/components/phosphor-dashboard.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx src/features/dashboard/components/token-trend-chart.tsx src/features/dashboard/components/token-trend-chart.test.tsx` passed with the existing Fast Refresh warning baseline and 0 errors.
- `pnpm exec prettier --check src/features/dashboard/components/phosphor-dashboard.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx src/features/dashboard/components/token-trend-chart.tsx src/features/dashboard/components/token-trend-chart.test.tsx .analysis/todo.md` passed.
- `git diff --check` passed.
- `pnpm run build` passed.

### 2026-05-26 - D1-084 - Alternate day backgrounds in Trend charts

Status: Completed

Changed paths:
- `src/features/dashboard/components/token-trend-chart.tsx`
- `src/features/dashboard/components/token-trend-chart.test.tsx`
- `src/styles/index.css`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- The upper token trend chart now adds explicit even/odd day-band classes to each rendered day column and uses subtly different grey envelope backgrounds.
- The lower trend lane uses matching day-band treatment for the TUI stripe layer and for Request/Tool metric day columns.
- Component tests cover the alternating classes on the upper chart, the TUI lower lane stripe layer, and Request/Tool lower metric lanes.
- Playwright against `http://127.0.0.1:3006/?verify=trend-day-bands` found `31` upper day shells and `31` Request lower day shells alternating `is-even` / `is-odd`.

Verification:
- `pnpm exec vitest run src/features/dashboard/components/token-trend-chart.test.tsx` passed: 1 file, 27 tests.
- `pnpm exec prettier --check src/features/dashboard/components/token-trend-chart.tsx src/features/dashboard/components/token-trend-chart.test.tsx src/styles/index.css .analysis/todo.md` passed.
- `pnpm exec eslint src/features/dashboard/components/token-trend-chart.tsx src/features/dashboard/components/token-trend-chart.test.tsx` passed.
- `pnpm exec tsc -b --pretty false` passed.
- `git diff --check` passed.

### 2026-05-26 - D1-082 - Make dashboard force refresh non-blocking for heavy report surfaces

Status: Completed

Changed paths:
- `server/report-service.mjs`
- `src/features/dashboard/api/usage-report.ts`
- `src/features/dashboard/index.tsx`
- `src/features/dashboard/index.test.tsx`
- `src/features/dashboard/components/phosphor-dashboard.tsx`
- `src/features/dashboard/components/phosphor-dashboard.test.tsx`
- `src/features/dashboard/lib/report-service-query-builders.test.ts`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- The main `/api/shell/reports/usage` payload now returns current summary/trend/provider-status/provider-health rows while leaving historical heavy surfaces empty: `quotas: []`, `quotaHistory: []`, and `toolActivity: []`.
- Heavy historical surfaces now use dedicated endpoints: `/api/shell/reports/usage/quota-range-history`, `/api/shell/reports/usage/quota-history`, and `/api/shell/reports/usage/tool-activity`.
- Dashboard parent queries fetch `quota-history` only on the Status Health tab and `quota-range-history` only on the Status Quota tab; both heavy quota-history queries have `refetchInterval: false`.
- Force Refresh cache-busts the main usage query and token trend summary without cache-busting `quota-history` or firing `quota-range-history` while the Health tab is active.
- Cache-busted live main request against `http://127.0.0.1:3006/api/shell/reports/usage?...cache_bust=d1-082-20260526-final2` returned HTTP `200`, `1101` rows, `3833` provider-health rows, `0` quota-history rows, `0` quota-range-history rows, `0` tool-activity rows, and `0` quota rows.
- Live `pg_stat_activity` sampled while that main request was active showed `0` active queries matching `rate_limit_intervals`, `rate_limit_observations`, `quota_key_gaps`, or `session_history_tool_activity`.
- Cache-busted live quota-range request against `http://127.0.0.1:3006/api/shell/reports/usage/quota-range-history?...cache_bust=d1-082-quota-range-20260526-final2` returned HTTP `200`, `357` rows, and one active xAI monthly row resetting at `2026-06-01T00:00:00.000Z`.
- Final live `pg_stat_activity` check showed `0` non-idle `aawm_tristore` queries left behind.

Verification:
- `pnpm exec vitest run src/features/dashboard/index.test.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx src/features/dashboard/lib/report-service-query-builders.test.ts src/features/dashboard/api/usage-report.test.ts src/features/dashboard/components/token-trend-chart.test.tsx` passed: 5 files, 113 tests.
- `pnpm exec prettier --check src/features/dashboard/api/usage-report.ts src/features/dashboard/components/phosphor-dashboard.tsx src/features/dashboard/components/token-trend-chart.tsx src/features/dashboard/components/token-trend-chart.test.tsx src/styles/index.css .analysis/todo.md .analysis/completed.md` passed.
- `pnpm exec eslint src/features/dashboard/api/usage-report.ts src/features/dashboard/components/phosphor-dashboard.tsx src/features/dashboard/components/token-trend-chart.tsx src/features/dashboard/components/token-trend-chart.test.tsx src/features/dashboard/index.tsx src/features/dashboard/index.test.tsx` passed with the existing Fast Refresh warning baseline and 0 errors.
- `pnpm exec tsc -b --pretty false` passed.
- `node --check server/report-service.mjs` passed.
- `git diff --check` passed.
- `docker ps --filter name=dashboard-shell-reports-dev --format '{{.Names}} {{.Status}} {{.Ports}}'` showed `dashboard-shell-reports-dev Up ... (healthy) 3010/tcp`.

### 2026-05-27 - D1-085 - Reconcile shell handoff documents

Status: Completed

Changed paths:
- `docs/runtime-contracts.md`
- `docs/remote-dashboard-integration-contract.md`
- `docs/sibling-dashboard-setup.md`
- `README.md`
- `nginx.conf`
- `server/report-service.mjs`
- `src/features/dashboard/lib/report-service-query-builders.test.ts`
- `src/shell/remote-dashboard-contracts.test.ts`
- `.analysis/todo.md`
- `.analysis/completed.md`
- `.analysis/completed-handoff/2026-05-26-aawm-tap-dashboard-shell-contract-requests.md`
- `.analysis/completed-handoff/HANDOFF-phosphor-atlas-session-state.md`
- `.analysis/completed-handoff/handoff-from-dashboard-2026-05-21.md`
- `/home/zepfu/projects/aawm-tap-dashboard/.analysis/2026-05-27-dashboard-shell-runtime-contract-response.md`

Evidence:
- `.analysis/todo.md` remained empty (`No active items`) after reconciling the handoff set.
- The TAP dashboard shell-contract request was resolved by documenting the vendor-and-sync design-system path, shell CSS token/dark-mode contract, `accentColor` behavior, scaffold/lint expectations, QueryClient ownership/defaults, lazy-route smoke expectations, production source-map policy, and CSP/asset-loading boundaries.
- The required TAP follow-up handoff was written to `/home/zepfu/projects/aawm-tap-dashboard/.analysis/2026-05-27-dashboard-shell-runtime-contract-response.md`.
- The aawm-observe proxy handoff was verified against the generic `/api/aawm-observe` prefix proxy; route patterns for metrics, traces, profiles, manifest, findings, scores, suites, and suite symbols all resolve to the AAWM Observe proxy config in regression coverage.
- Static nginx now emits a same-origin CSP on SPA HTML responses so same-origin `/modules/<base>/remoteEntry.js` scripts and `/api/<dashboard>/*` XHR remain allowed.
- The legacy Phosphor Atlas session-state handoff was context-only and superseded by the current completed ledger and empty active queue, so it was archived with the processed handoffs.
- Processed handoff docs were moved to `.analysis/completed-handoff/`.

Verification:
- `pnpm exec vitest run src/shell/remote-dashboard-contracts.test.ts src/features/dashboard/lib/report-service-query-builders.test.ts` passed: 2 files, 7 tests.
- `pnpm exec prettier --check docs/runtime-contracts.md docs/remote-dashboard-integration-contract.md docs/sibling-dashboard-setup.md README.md nginx.conf src/shell/remote-dashboard-contracts.test.ts src/features/dashboard/lib/report-service-query-builders.test.ts .analysis/todo.md .analysis/completed.md` passed.
- `pnpm exec eslint src/shell/remote-dashboard-contracts.test.ts src/features/dashboard/lib/report-service-query-builders.test.ts` passed.
- `node --check server/report-service.mjs` passed.
- `pnpm exec tsc -b --pretty false` passed.
- `docker compose config --quiet` passed.
- `docker compose -f docker-compose.dev.yml config --quiet` passed.
- `git diff --check` passed.

### 2026-05-27 - D1-086 - Integrate session-history agent scores into ledger

Status: Completed

Changed paths:
- `server/report-service.mjs`
- `src/features/dashboard/api/usage-report.ts`
- `src/features/dashboard/lib/agent-quality.ts`
- `src/features/dashboard/components/phosphor-dashboard.tsx`
- `src/features/dashboard/components/master-ledger-table.tsx`
- `src/features/dashboard/lib/report-service-query-builders.test.ts`
- `src/features/dashboard/components/master-ledger-table.test.tsx`
- `.analysis/completed.md`
- `.analysis/completed-handoff/handoff-session-history-agent-scores.md`
- `/home/zepfu/projects/litellm/.analysis/investigate-codex-019e69b2-d3c4-7cd1-b154-af86609e2642.md`
- `/home/zepfu/projects/litellm/.analysis/investigate-codex-019e69b2-f98b-7923-bbd4-b7efbe8140f6.md`

Evidence:
- The `public.session_history` agent-score handoff was archived into `.analysis/completed-handoff/` after implementation.
- `buildUsageQuery` now emits grouped `agent_*` aggregates for quality, instruction, tool, contract, progress, and risk families with evaluated/possible coverage and failure/risk counts. Score averages use `FILTER (WHERE ... IS NOT NULL)` and do not coalesce null score fields to zero.
- `agent_score_reasons` is flattened into a capped `agent_score_reasons_top` JSONB reason-code list by family/reason/count, filtering to string reason codes so evidence-object payloads are not rendered as raw JSON.
- The dashboard API row type carries the new optional score fields, and `buildModelRows` folds them into model rows plus repository children so both Model and Repository ledger perspectives inherit the same rollups.
- Model Ledger now has a compact `Agent` column with Q/I/T/C/P/R indicators and hover detail for coverage, score/risk failures, boolean failure flags, read-only violation counts, and top reason codes.
- Live SQL verification against `aawm_tristore` returned `3` rows for `2026-05-27` to `2026-05-28` with the new agent fields and `agent_score_reasons_top`. The same verification also caught wrong-task `cache_*_v2` references from a failed subagent result; those references were removed because the live database does not have those columns.
- `dashboard-shell-reports-dev` was restarted after the backend query change, reported healthy, and the live `/api/shell/reports/usage` smoke request through port `3006` returned JSON rows containing the new `agent_*` fields.
- Two redispatched `aawm-codex-agent-auto` agents returned wrong-task completions, so investigation files were written under the litellm `.analysis` directory per the interim Subagent Failures directive.

Verification:
- `NODE_ENV=test node --input-type=module -e "import pg from 'pg'; import { buildUsageQuery } from './server/report-service.mjs'; const q = buildUsageQuery(new URLSearchParams({ from: '2026-05-27', to: '2026-05-28', grain: 'day', group_by: 'provider,model,repository', limit: '3' })); const pool = new pg.Pool({ connectionString: 'postgresql://aawm:aawm_dev@localhost:5434/aawm_tristore' }); const result = await pool.query(q.sql, q.values); console.log(JSON.stringify({ count: result.rowCount, sample: result.rows[0] ?? null }, null, 2)); await pool.end();"` passed against `aawm_tristore`.
- `pnpm exec vitest run src/features/dashboard/lib/report-service-query-builders.test.ts src/features/dashboard/components/master-ledger-table.test.tsx` passed: 2 files, 49 tests.
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec prettier --check server/report-service.mjs src/features/dashboard/api/usage-report.ts src/features/dashboard/lib/agent-quality.ts src/features/dashboard/components/phosphor-dashboard.tsx src/features/dashboard/components/master-ledger-table.tsx src/features/dashboard/lib/report-service-query-builders.test.ts src/features/dashboard/components/master-ledger-table.test.tsx` passed.
- `pnpm exec eslint server/report-service.mjs src/features/dashboard/api/usage-report.ts src/features/dashboard/lib/agent-quality.ts src/features/dashboard/components/phosphor-dashboard.tsx src/features/dashboard/components/master-ledger-table.tsx src/features/dashboard/lib/report-service-query-builders.test.ts src/features/dashboard/components/master-ledger-table.test.tsx` passed with the existing warning baseline and 0 errors.
- `node --check server/report-service.mjs` passed.
- `pnpm run build` passed.
- `docker compose -f docker-compose.dev.yml restart dashboard-shell-reports-dev` completed and `docker ps --filter name=dashboard-shell-reports-dev --format '{{.Names}} {{.Status}} {{.Ports}}'` showed `dashboard-shell-reports-dev Up ... (healthy) 3010/tcp`.
- `curl -sS 'http://127.0.0.1:3006/api/shell/reports/usage?from=2026-05-27&to=2026-05-28&grain=day&group_by=provider,model,repository&limit=3&sort=period_end&cache_bust=agent-score-smoke'` returned JSON with `agent_score_rows`, score coverage fields, and `agent_score_reasons_top` in `rows`.
- `git diff --check` passed.

### 2026-05-27 - D1-087 - Make Agent score ledger cell readable

Status: Completed

Changed paths:
- `src/features/dashboard/components/master-ledger-table.tsx`
- `src/features/dashboard/components/master-ledger-table.test.tsx`
- `.analysis/todo.md`
- `.analysis/completed.md`

Evidence:
- The Agent column now renders a readable status summary such as `Review 50% · <1% cov · 4 issues`, `Low cov 100% · <1% cov`, or `Unscored` instead of dense `Q/I/T/C/P/R` score fragments.
- Low-coverage perfect scores no longer render as `Healthy`; they render as `Low cov` when coverage is below the threshold and no issue flags are present.
- Agent hover detail now uses the heading `Agent health` and humanizes reason codes, for example `Tool Use Validity · Invalid Tool Call Error`.
- Playwright against `http://127.0.0.1:3006/?verify=agent-quality-readable-2` found the `Agent` column and readable live cells: `Review 50% · <1% cov · 4 issues`, `Review 25% · 93% cov · 9 issues`, `Low cov 100% · <1% cov`, and `Unscored`.

Verification:
- `pnpm exec vitest run src/features/dashboard/components/master-ledger-table.test.tsx` passed: 1 file, 43 tests.
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec eslint src/features/dashboard/components/master-ledger-table.tsx src/features/dashboard/components/master-ledger-table.test.tsx` passed with the existing warning baseline and 0 errors.
- `git diff --check` passed.

### 2026-05-27 - D1-088 - Rename ledger Agent column to Score indicator

Status: Completed

Changed paths:
- `src/features/dashboard/components/master-ledger-table.tsx`
- `src/features/dashboard/components/master-ledger-table.test.tsx`
- `.analysis/completed.md`

Evidence:
- The ledger score column is now labeled `Score` instead of `Agent`.
- Score cells render only a compact status indicator dot: red for review, yellow/orange for watch/low coverage, green for healthy, and blue for no score data.
- Visible score summary text such as `Review 50% ...`, `Low cov ...`, and `Unscored` was removed from the table cell body; accessible labels remain on the indicator.
- The scored hover still shows the agent-health breakdown by score family, failure flags, and top reason codes.
- The no-data hover shows `No score data` and explains that no evaluated session-history score fields were reported for that row.
- Playwright against `http://127.0.0.1:3006/?verify=score-dot` found the `Score` header, no `Agent` header, 9 score indicators, blank indicator text content, red/yellow/blue live states, no visible legacy score-summary text in the first rows, and working hover content for both a scored Anthropic row and a no-data Google row.

Verification:
- `pnpm exec vitest run src/features/dashboard/components/master-ledger-table.test.tsx` passed: 1 file, 44 tests.
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec eslint src/features/dashboard/components/master-ledger-table.tsx src/features/dashboard/components/master-ledger-table.test.tsx` passed with the existing Fast Refresh and TanStack Table warning baseline and 0 errors.
- `git diff --check` passed.
