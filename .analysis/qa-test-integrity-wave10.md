# QA Report — Wave 10 (Test-integrity cleanup)

**Date:** 2026-06-15
**Reviewer:** qa
**Plan:** .analysis/plan-adversarial-review-20260612.md, Wave 10
**Tester commit:** `66b390d` — test: Wave 10 test-integrity — residual coverage + theater fixes + SQL parse-validation (S4/S6)
**Engineer commit:** `eb193a5` — fix: Wave 10 agent-quality double-count + pgsql-parser + server vitest project (S4-T4/S4-8)
**Develop tip:** `1c3041d`

> **Test-execution note:** the repo root `/` is mounted read-only (`ro,errors=remount-ro`); only `.analysis`/`.claude` are `rw`. vitest/tsc cannot write `node_modules/.vite-temp` / `node_modules/.tmp` in-tree. I ran all suites from a faithful writable mirror at `/tmp/qa-w10` (real copies of `src/`, `server/`, configs; copied `node_modules`). No source/test files were modified. Targeted runs used `--maxWorkers=1`; OOM full-suite avoided per dispatch.

---

## Checklist

| # | Check | Verdict | Evidence |
|---|-------|---------|----------|
| 1 | agent-quality #59 fix correct + non-vacuous | **PASS** | `agent-quality.ts:801-804` `handoffIssueCount` no longer adds `discoveryInventoryCoverage.issueCount`+`terminalCompletion.issueCount` (diff `eb193a5` removed those two lines). Those values still count once via `discoveryIssueCount` (`:805-808`). Test `test_agentQualityIssueSortValue_discovery_terminal_not_double_counted` pins `expect(sortValue).toBe(350)` (6×50+20+30; old double-count = 500). `agent-quality.test.ts` → **16 passed**. |
| 2 | SQL parse-validation REAL not shimmed-away | **PASS** | `server/pgsql-parser-shim.mjs:19-31` uses `createRequire`+`require.resolve('pgsql-parser')`+`import('file://'+realEntry)`, calls `realParse(sql)`, returns only `result.stmts`. Probe: `"SELECT 1"`→`isArray=true len=1`; `"SELCT zz FRM"`→ throws `syntax error at or near "SELCT"`; `"SELECT a, FROM t b c d"`→ throws `syntax error at or near "FROM"`. Server project → **42 passed**. `pgsql-parser ^17.9.15` in package.json:98. |
| 3 | server vitest project isolated; runs w/o live redis | **PASS** | `vitest.config.ts` frontend project (jsdom, `exclude:['server/**']`) + server project (node, `include:['server/**/*.test.{ts,mts}']`). `report-service.mjs:17-31` redis via try/catch `await import('redis')` → `createClient=null` if absent; `:628` `redisClient = REPORT_CACHE_REDIS_URL && createClient ? ...`. Server suite (42) ran with no redis. Frontend `report-service-query-builders.test.ts` is a 46-line stub (single doc test, no redis/report-service import). |
| 4 | Coverage tests non-vacuous | **PASS** | `trend-utils.test.ts` → **19 passed**: pad→`toHaveLength(24)` w/ empty prefix `totals:{}`, truncate→24 most-recent, NaN/negative summed `toBe(450)`, xai normalize `toBe(500)`. `parseReasonRows` 6 value tests (malformed→`toEqual([])`, non-array→`[]`, NaN coerced, valid parsed). Smoke `test_dashboard_mounts_with_populated_report` renders REAL `Dashboard` (features/dashboard/index) via QueryClient+Direction+Search+Layout+Sidebar+RouterProvider+MSW, `waitFor` `.kpi-tile`>0, asserts `/Tokens\s*In/i` (`:262-292`). Smoke → 16 passed + 1 todo. |
| 5 | Theater fixes | **PASS** | theme-provider.test.tsx: 33 lines removed (scaffolding trimmed). plugin-theme-override renders shipped `Tasks` page (`:31` `render(<Tasks/>)`) + asserts `--accent-chrome` via `getPropertyValue` + stylesheet `cssText` (`:47,73`); renders `Tasks` not `TasksPage` with documented rationale (TasksPage needs RouterProvider). comparison-panel `dashCount` localized to `tbody td` per-cell `toBe(10)` (`:301-305`). kpi-strip `loading_shows_skeletons` `toBe(6)` (`:93`). token-layer/quota-burn strengthened (getComputedStyle/getPropertyValue applied checks) + explicitly documented as tripwires. 6 files → **65 passed**. |
| 6 | Forced typecheck clean; 0 eslint-disable; redis live-behavior preserved | **PASS** | `npx tsc -b --force` (from mirror) → **exit 0, 0 errors** (resolves prior W9-c 6-error FAIL: `repo-breakdown-table` dangling import + axios refs gone). `git show 66b390d/eb193a5 \| grep '^+' \| grep eslint-disable` → **0/0**. redis: when `REPORT_CACHE_REDIS_URL` set AND package installed (real deploy), `createClient({...})` runs unchanged — behavior preserved. |

## Verdict: PASS

All 6 checklist items pass. The agent-quality #59 double-count is genuinely fixed and pinned at 350 (non-vacuous against the old 500); the pgsql-parser shim wraps the REAL parser and propagates syntax errors (broken SQL throws); the server vitest project is correctly isolated and runs without live redis while preserving live redis behavior when configured; coverage tests (trend-utils, parseReasonRows, smoke mount) make real value assertions and the smoke test mounts the real `Dashboard`; theater fixes are substantive; forced `tsc -b --force` is clean with zero eslint-disable added.

### Notes (non-blocking)
- Dispatch wording said the redis guard uses a "VITEST/NODE_ENV check"; the landed implementation instead degrades via package-presence (try/catch on `import('redis')`). Effect is equivalent and arguably more robust. Not a defect.
- Dispatch said plugin-theme-override renders `TasksPage`; the test renders the `Tasks` page component (documented: `TasksPage` would require RouterProvider/SidebarProvider/TasksProvider). It still mounts a shipped component and asserts `--accent-chrome`. Acceptable.
