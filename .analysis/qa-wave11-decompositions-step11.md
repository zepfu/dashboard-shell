# QA Report — Wave 11 Decompositions / abstractions (LAST) — Step 11

**Date:** 2026-06-15
**Reviewer:** qa
**Plan:** .analysis/plan-adversarial-review-20260612.md, Wave 11
**Test files:** wave-11-decomposition-contracts.test.ts, wave-11-provider-identity.test.ts, wave-11-lazy-hover-tooltip.test.tsx, wave-11-phosphor-table.test.tsx, wave-11-stacked-bar.test.tsx (+ migrated safety-net suites)
**Tester commit:** `9d9fca7` — Wave 11 decomposition contract tests (merge `e34d87f`)
**Engineer A commit:** `10f760f` — flat-path deletion + provider-identity (merge `fea8653`)
**Engineer B commit:** `a608274` — ledger aggregation extraction + unified quota tooltip (merge `b087560`)
**Engineer C commit:** lazy hover-tooltip + PhosphorTable + StackedBar + ReportCacheMetadata + formatter drift (merge `ecc265c`)
**Develop tip:** `ecc265c`

**Test infra:** full vitest suite OOMs; ran targeted files `--maxWorkers=1 --testTimeout=15000`. Repo root is read-only (EROFS on `node_modules/.vite-temp` and `.tmp`), so mirrored src/server/configs to `/tmp/dsqaw11` with package symlinks + writable `.vite-temp`/`.tmp`. `tsc -b --force` run in the mirror is authoritative.

---

## Checklist

| # | Check | Verdict | Evidence |
|---|-------|---------|----------|
| 1 | Flat-path deletion (S1-1/2/9 via S1-18) | PASS | No `function/const/export buildQuotaRows\|buildHistoryBarsForProvider` anywhere in src (grep → 0). No calls/imports in phosphor-dashboard.tsx. Remaining matches are comments + contract-test string literals only. Flat-path fixtures (suffix-collision / dedup-order, `buildQuotaRows(`/`buildHistoryBarsForProvider(` calls) absent from phosphor-dashboard.test.tsx (grep rc=1). 17 `test_flat_path_*`/decomposition-contract tests green. |
| 2 | provider-identity single-owner (S1-8) | PASS | `lib/provider-identity.ts` exists; `CANONICAL_PROVIDERS` = 8 frozen entries incl `nvidia_nim` (lines 21–30) + `PROVIDER_ALIASES`/`canonicalProvider`/`providerAliases`. Both consumers import it: use-alerts-from-anomalies.ts:29, phosphor-dashboard.testkit.ts:22 (inline copies replaced by import comments at :74/:2378). wave-11-provider-identity.test.ts → 26 tests green (≥ 22). |
| 3 | Lazy hover-tooltip (#91, S3-21/26) | PASS | `content: HoverTooltipContent = () => ReactNode` (hover-tooltip.tsx:58/63); `panel = isOpen ? (… content() …) : null` (:405/:416) → not in DOM until open. ALL consumers pass render-prop `content={() => …}`: token-trend-chart, master-ledger-table, phosphor-sidebar, health-strip, quota-interval-bar (provider-card via QuotaIntervalBar import :53), reasoning-token-value. wave-11-lazy-hover-tooltip 7 tests green (before-hover NOT-in-DOM + after-pointerEnter IS-in-DOM, :258–266). Migrated hover-tooltip.test.tsx 16 tests green, uses pointerEnter — coverage preserved, not weakened. |
| 4 | PhosphorTable<T> + keyboard headers (S5-16/S5-14) | PASS | primitives/phosphor-table.tsx exists; sortable headers focusable (`tabIndex={sortable ? 0}` :108), `aria-sort` :109, `onKeyDown` :115 handling Enter/Space (:82). wave-11-phosphor-table 14 tests green. Full adoption into MasterLedgerTable DEFERRED (grep: no PhosphorTable import in master-ledger-table.tsx) — noted. |
| 5 | StackedBar + ReportCacheMetadata + formatter drift | PASS | stacked-bar.tsx exists; token-trend-chart.tsx imports + uses it (`<StackedBar` :2597). wave-11-stacked-bar 14 tests green. `REPORT_CACHE_METADATA_FIELDS` + `isReportCacheMetadata` in api/usage-report.ts:94/108; tested in decomposition-contracts (green). comparison-panel.test.tsx has no local `formatUsd` (grep rc=1); comparison-panel + use-alerts 42 tests green. |
| 6 | Behavior preserved + clean | PASS | `npx tsc -b --force` → **exit 0, 0 errors** (mirror). Safety-net suites green: phosphor-dashboard.test.tsx 89/89, master-ledger-table.test.tsx 62/62, provider-card.test.tsx 35/35, hover-tooltip.test.tsx 16/16, token-trend-chart.test.tsx 41/41. eslint-disable added to **non-test source across W11 = 0** (engineers net **removed 2**); the lone `+eslint-disable` in the wave diff is in the tester's wave-11-provider-identity.test.ts:83 (an `any`-cast suppression for a negative-typing test, commit 9d9fca7) — tester-authored, not engineer source. |

**Test totals (green):** W11 contracts 17 + 26 + 7 + 14 + 14 = 78; safety-net 89 + 62 + 35 + 16 + 41 + 42 = 285. All passing; 0 failures observed.

## Deferred decomposition scope (UNCONTRACTED cosmetic splits — operator to decide follow-up)

These are behavior-irrelevant structural splits, NOT failures (per dispatch directive):
1. Remaining phosphor module extractions (health-cells / ledger-rows / status-section / use-dashboard-queries, etc.) — not split out; behavior lives in phosphor-dashboard.tsx + testkit.
2. Full ledger 5-file split (S2-13) — aggregation extracted; remaining file split deferred.
3. Full provider-card 5-file split (S2-22) — deferred.
4. PhosphorTable<T> full adoption into MasterLedgerTable (S5-16) — primitive exists + keyboard-operable, but MasterLedgerTable still uses its own table; not yet repointed.
5. Hourly-bar StackedBar parity (S3-12) — outer token-trend bars use StackedBar; hourly inner bars not migrated.
6. `<QuotaBarRow>` wrapper (S2-21) — Engineer B reverted it to preserve the prior-bar `—` contract; unified `buildQuotaTooltip`/quota rendering achieved via QuotaIntervalBar without the wrapper.

## Verdict: PASS

All 6 contract/behavior checks pass: every NEW W11 contract suite is green (78 tests), the W1–W10 safety-net behavior is unchanged (285 tests green across the 6 key suites), `tsc -b --force` is clean (0 errors), the flat path is deleted with provider-identity as single-owner, the lazy-tooltip #91 fix is implemented across all consumers with migrated tests that still prove show-on-hover, and zero eslint-disable were added to engineer source. The listed cosmetic decomposition splits are uncontracted and deferred for operator decision.
