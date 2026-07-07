# Phosphor Atlas — Closeout Notes (Waves 30 – 47)

**Status:** PROMOTED (2026-05-20)
**Develop HEAD at closeout:** `1156dc1`
**Distance from main:** 272 commits ahead
**Test state:** 387 passing (Vitest), lint + typecheck clean
**Plan-file companion:** see `plan-phosphor-atlas-implementation.md` for Waves 0–29; this file covers operator-driven iteration after the original plan's nominal close.

The original implementation plan completed nominally through Wave 29. Waves 30–47 below are operator-directed follow-ups — bug fixes, design adjustments, and spec clarifications driven by live dashboard review. They were not pre-planned; each was dispatched in response to a specific operator observation.

---

## Wave Summary Table (30 – 47)

| Wave          | Theme                                                                                                                                              | Headline commit(s)             |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 30            | Sparkline data wiring + health-strip dedup                                                                                                         | `b8a69e4`, `40284db` ancestors |
| 31            | KPI labels, ledger reorder, microbar tooltip, errors 429/529, trend bar heights, quota sentinel                                                    | numerous                       |
| 32            | Last-seen, multi-reset full parity, error observations, hoist tooltip variant, dead code purge                                                     | `b9b913e` and ancestors        |
| 33            | Tool activity query + dashboard hover (SHELL/TOOLS 2-column)                                                                                       | landed in W32 batch            |
| 34            | First convergence cycle — researcher/engineer trio                                                                                                 | `34-A/B/C/D`                   |
| 35–36         | Cycle 2 — render perf, cycle-2 sweep, tooltip styles, server fixes                                                                                 | several commits                |
| 37–39         | Cycles 3-5 — code/CSS, data-flow, visual audits per cycle                                                                                          | converged W39                  |
| 40            | Reopened audit — 5hr quota lookback (`ab9628c`), TOOL column ungate (`b8425e3`), multi-reset redesign attempt 1 (`08e7033`) — rejected by operator |
| 41            | Operator clarified lane spec → full per-lane redesign                                                                                              | `59cee03`                      |
| 41 follow-ups | className concat (`3b43e55`), dedup proximity (`34ffd7a`), Google flash-lite tipModels aggregation (`a0395c9`)                                     |
| 42            | Stacked full-width prior bar rows (operator complaint: bars on same line)                                                                          | `4d7a7b7` / `017b2cf`          |
| 43            | Date-range sub-label on prior bars                                                                                                                 | `15546b2` / `3e08d8f`          |
| 44            | Per-row interval-hours lookback (Google 24h → 36h, etc.)                                                                                           | `e73ed32` / `d63d3e9`          |
| 44b           | Layer B sheen moved from bar to high-velocity segment                                                                                              | `5966e80` / `bb2ed3b`          |
| 45            | OpenAI weekly noise-gap median collapse fix                                                                                                        | `3d6a97a` / `f4b2ade`          |
| 45b           | Tooltip headers show absolute date + time                                                                                                          | `1d8e871` / `2d9259e`          |
| 46            | Upper-bound `2 × interval_hours` so mid-cycle prior slots survive                                                                                  | `bcbe5c7`                      |
| 47            | Regression-test net for 5/24 prior bar dedup scenarios                                                                                             | `dba03d8` / `1156dc1`          |

Wave numbering after W29 is not strictly sequential in commit history because dispatches often overlapped or were re-dispatched after stall/kill events. The headline commits above are the merge points on `develop`.

---

## Operator-Driven Direction Notes

These shaped the W40+ trajectory and are worth preserving for whoever picks up next:

- **Per-lane multi-reset structure**: each provider has N lanes (Anthropic 3 / OpenAI 4 / Google 3 / xAI 1). Each lane shows current + N prior bars from history within `interval × 1.5` lookback. Bars stack vertically full-width — never crammed side-by-side.
- **Lane labels**: `All Models · 5hr`, `Sonnet · 7d`, `All Models · 7d`, `codex-spark · 5hr`, `codex-spark · 7d`, `Flash · 24h`, `Flash-Lite · 24h`, `Pro · 24h`, `All Models · 30d`.
- **Google class aggregation**: flash-lite check MUST precede flash (substring containment). `google_code_assist_requests:daily_request_pool` excluded.
- **Display name rolls**: Anthropic weekly + weekly_special tooltips collapse to `sonnet`; OpenAI weekly + weekly_special collapse to `codex-spark`.
- **Lookback formula**: per-row median reset cadence from historical `expected_reset_at` gaps via `LAG()` + `PERCENTILE_CONT(0.5)`, gated on `gap_count ≥ 2 AND gap_hours ≥ 1` (filters sub-minute jitter), with COALESCE fallback per quota_type (5h / 168h / 720h). Lookback `× 1.5` back, upper bound `× 2.0` forward (so mid-cycle prior slots survive).
- **Dedup**: ±30 min numeric proximity between rounded history slots and the lane's current bar resetAt; absorbs `roundToNearest30Min` artifacts.
- **Time-ago**: prior bars use `formatTimeAgo(roundToNearest30Min(expected_reset_at))`. For `diffMs < -60s`, use absolute value so rounding artifacts produce sensible labels.
- **Tooltip headers**: `M/D HH:MM → M/D HH:MM` (snap both endpoints, substitute sentinel year > 9000 with `now`).
- **Spectral animation**: both layers (`::after` shimmer + `::before` sheen) live on `.quota-interval.high-velocity` segments only. `:not(.is-prior)` guards prevent prior bars from animating. `isolation:isolate + overflow:hidden` prevents cross-card bleed.
- **xAI**: zero prior bars is a legitimate state when only one reset's worth of data exists.

---

## Hindsight — what went sideways

- **Premature "convergence"**: Waves 34–39 ran 5 audit cycles and declared the plan complete. Operator then surfaced multi-reset bar design issues that the researchers had been blind to because they validated against the existing design rather than against the operator's spec. The convergence loop wasn't wrong, but its scope was narrower than "everything operator might care about".
- **Two-analyst static-analysis punt**: When asked to do live Playwright DOM probes, two consecutive analysts fell back to static code analysis and falsely claimed playwright tools weren't available. Wasted two cycles. Eventually a researcher used CDP directly, then a later researcher used the actual MCP tools. Lesson: when a probe is needed, dispatch a researcher with explicit `mcp__plugin_playwright_playwright__*` tool names listed and an explicit "do NOT punt to static analysis" clause.
- **Cancelled in-flight work**: I cancelled two agents (validation researcher #215 and principal #216) mid-investigation when the operator surfaced new direction. Operator pulled me up on that — both agents had been doing legit triage work. Salvaged their findings via `.analysis/_wave40_decode.mjs` outputs + DOM JSON dumps; lesson: read transcripts before cancelling, and bias toward keeping running agents going.
- **Engineer false-positive verifications**: Several engineers reported "Playwright verified, 3 bars rendered" when the operator immediately observed 2 bars. Reproduction timing matters — the engineer's probe ran AFTER container restart and cache refresh; the operator's view did not yet reflect that. The cache hypothesis is unconfirmed (see Known Follow-Ups below).
- **Lookback formula iteration**: started with hardcoded per-quota_type windows → switched to derived `interval_hours × 1.5` lookback → discovered noise gaps corrupted median → added gap filter + fallback → discovered upper bound too tight → bumped to `× 2.0`. Each step was right but the formulation needed all four refinements together. Better up-front spec would have caught this.

---

## Known Follow-Ups (not in this plan's scope; flagged for next operator session)

1. **Report-service caching audit** — operator pushed back on my claim that the 5-min redis TTL was the cause of the 2→3 bar discrepancy. Hypothesis unverified. Worth a researcher pass to validate: what's cached, TTLs per key, invalidation on code reload, container restart behavior. Either confirm cache as cause or surface a different root cause for the lag between code landing and operator-visible effect. ⚠️ Not actioned during this session.
2. **N1 design call** (operator deferred) — Wave 41 design uses lane-header model identity (e.g. `Sonnet · 7d`); per-bar labels read only `[pct% \| Xd ago]`. Operator never explicitly accepted or rejected this. If they want per-bar labels (`sonnet · 5d ago`, `codex-spark · 1d ago`), that's a small follow-up.
3. **N4 animation visibility** — operator-judgment item. The two-layer spectral animation (shimmer on segment + sheen on segment) is in place. If operator wants more intensity / more glow points, the CSS is the right place to iterate.
4. **A3 Google tooltip data** — Google Flash-Lite current bar tooltip now aggregates per-class breakdown across same-class rows (W41 A3 fix `a0395c9`). Confirmed via unit tests; live Playwright verification was punted by the engineer.
5. **TODO / `console.log` audits** — none flagged this session, but worth running before next major plan.

---

## Suggested Agent / Dispatch Improvements

(Operator nudges captured for future plans)

- Add a `playwright_required` flag to dispatch prompts; if set, the agent must invoke `mcp__plugin_playwright_playwright__browser_navigate` at least once or fail loudly.
- Engineers landing UI changes should be required to attach 2 screenshots (before + after) per dispatch, not just a description.
- For server changes that affect cached responses, the dispatch should explicitly call out: "restart containers AND invalidate redis cache before declaring verification done."
- The 600s watchdog stalls on opus-tier agents (#215, #216, #226, #227, #232 prior, #226 prior) — when a deep agent stalls mid-investigation, salvage their analysis before redispatching.

---

## Closeout Actions

1. Append this file to the original plan via reference (operator can `cat` both for full history).
2. Run gate check (`vitest run src/features/dashboard`).
3. Promote `develop` → `main` via `promote()` MCP tool.
4. Move plan + closeout to `docs/implemented/`.
5. Leave the keepalive cron running (operator hasn't explicitly authorized stop).
