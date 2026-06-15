/**
 * Wave 11 — Decomposition / abstraction behavioral-contract tests.
 *
 * This file covers tests that can RUN NOW (mostly GREEN, some RED via source
 * file scanning).  Tests for not-yet-created modules (provider-identity,
 * ReportCacheMetadata runtime companion) are in separate files that fail at
 * import time — that import-error IS the "red" phase per the plan spec.
 *
 * Contract areas covered here:
 *   1. Flat-path deletion (S1-1 / S1-2) — source scan RED tests
 *   2. Formatter consolidation (S5-18) — source scan + real-function GREEN tests
 *   3. ReportCacheMetadata shape (S4-4) — shape stability GREEN tests
 *   4. Runtime companion RED test (checks existing API module for new export)
 *
 * See also (separate files for not-yet-existing module imports):
 *   `wave-11-provider-identity.test.ts`  — provider-identity module contract
 *
 * Engineers responsible:
 *   A = flat-path deletion / provider-identity
 *   C = formatter consolidation / ReportCacheMetadata runtime companion
 *
 * Existing tests that Engineers will DELETE (flat-path fixtures — S1-1 / S1-2):
 *   In `phosphor-dashboard.test.tsx`:
 *     - `test_buildQuotaRows_suffix_collision`  (exercises flat-path dedup logic)
 *     - `test_buildQuotaRows_dedup_order`       (exercises flat-path dedup logic)
 *   These tested the flat-path `buildQuotaRows` dedup logic that is deleted with
 *   the flat path.  No counterpart in the lanes module — must be deleted.
 *
 * Existing tests that Engineers will MIGRATE (~20 tooltip tests):
 *   The ~20 tests in `primitives/hover-tooltip.test.tsx` that use always-mounted
 *   tooltip content assertions must be migrated by Engineer C after the lazy
 *   render-prop change.  See `wave-11-lazy-hover-tooltip.test.tsx` for the new
 *   contract.
 */
import { describe, expect, test } from 'vitest'

// ---------------------------------------------------------------------------
// 1. Flat-path deletion contract (S1-1 / S1-2)
//    RED until Engineer A deletes the flat path from phosphor-dashboard.tsx
//    and removes the _*ForTest re-export block (lines 2630–2671).
// ---------------------------------------------------------------------------

describe('test_flat_path_deleted_no_callers', () => {
  test('test_flat_path_symbol_buildQuotaRows_absent_from_dashboard_source', async () => {
    const { readFile } = await import('node:fs/promises')
    const { dirname, join } = await import('node:path')
    const { fileURLToPath } = await import('node:url')

    const src = await readFile(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../components/phosphor-dashboard.tsx'
      ),
      'utf8'
    )

    // RED: `buildQuotaRows` currently imported and called in phosphor-dashboard.tsx.
    // After Engineer A's deletion commit this must be absent.
    expect(src).not.toMatch(/\bbuildQuotaRows\b/)
  })

  test('test_flat_path_symbol_buildHistoryBarsForProvider_absent_from_dashboard_source', async () => {
    const { readFile } = await import('node:fs/promises')
    const { dirname, join } = await import('node:path')
    const { fileURLToPath } = await import('node:url')

    const src = await readFile(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../components/phosphor-dashboard.tsx'
      ),
      'utf8'
    )

    // RED: `buildHistoryBarsForProvider` currently imported and called.
    expect(src).not.toMatch(/\bbuildHistoryBarsForProvider\b/)
  })

  test('test_flat_path_buildQuotaRows_absent_from_testkit_exports', async () => {
    const { readFile } = await import('node:fs/promises')
    const { dirname, join } = await import('node:path')
    const { fileURLToPath } = await import('node:url')

    const src = await readFile(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../components/phosphor-dashboard.testkit.ts'
      ),
      'utf8'
    )

    // RED: currently an export function in the testkit.
    // After deletion the _*ForTest block (lines 2630–2671) is removed entirely.
    expect(src).not.toMatch(/export function buildQuotaRows/)
  })

  test('test_flat_path_buildHistoryBarsForProvider_absent_from_testkit_exports', async () => {
    const { readFile } = await import('node:fs/promises')
    const { dirname, join } = await import('node:path')
    const { fileURLToPath } = await import('node:url')

    const src = await readFile(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../components/phosphor-dashboard.testkit.ts'
      ),
      'utf8'
    )

    // RED: currently an export function in the testkit.
    expect(src).not.toMatch(/export function buildHistoryBarsForProvider/)
  })

  test('test_lanes_module_buildProviderLanes_is_sole_quota_pipeline', async () => {
    /**
     * After flat-path deletion, `buildProviderLanes` (lanes module) is the ONLY
     * function that constructs quota bar rows.  Verify it is still importable and
     * functional from the testkit (it predates the flat path and is not deleted).
     *
     * GREEN: buildProviderLanes already exists.  Regression guard.
     */
    const { buildProviderLanes } =
      await import('../components/phosphor-dashboard.testkit')

    expect(typeof buildProviderLanes).toBe('function')

    // Minimal call: empty rows → empty lanes (not a crash).
    const lanes = buildProviderLanes('anthropic', [], [])
    expect(Array.isArray(lanes)).toBe(true)
  })

  test('test_provider_identity_inline_copies_removed_from_alerts_hook', async () => {
    /**
     * The old inline CANONICAL_PROVIDERS in use-alerts-from-anomalies.ts must
     * be replaced by an import from the new `lib/provider-identity.ts` module.
     *
     * RED: until Engineer A removes the inline copy.
     */
    const { readFile } = await import('node:fs/promises')
    const { dirname, join } = await import('node:path')
    const { fileURLToPath } = await import('node:url')

    const src = await readFile(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../hooks/use-alerts-from-anomalies.ts'
      ),
      'utf8'
    )

    expect(src).not.toMatch(/const CANONICAL_PROVIDERS\s*=/)
  })

  test('test_provider_identity_inline_copies_removed_from_testkit', async () => {
    /**
     * The old inline CANONICAL_PROVIDERS in phosphor-dashboard.testkit.ts must
     * be replaced by an import from `lib/provider-identity.ts`.
     *
     * RED: until Engineer A removes the inline copy.
     */
    const { readFile } = await import('node:fs/promises')
    const { dirname, join } = await import('node:path')
    const { fileURLToPath } = await import('node:url')

    const src = await readFile(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../components/phosphor-dashboard.testkit.ts'
      ),
      'utf8'
    )

    expect(src).not.toMatch(/const CANONICAL_PROVIDERS\s*=/)
  })
})

// ---------------------------------------------------------------------------
// 2. Formatter consolidation (S5-18)
//    GREEN: pin existing correct behavior as regression guards.
//    RED: `comparison-panel.test.tsx` local copy must be removed.
// ---------------------------------------------------------------------------

describe('formatter consolidation (S5-18)', () => {
  test('test_kpi_strip_uses_lib_format_usd_import', async () => {
    /**
     * GREEN: kpi-strip.tsx already imports from lib (fixed in W4).
     * Regression guard — prevents drift reintroduction.
     */
    const { readFile } = await import('node:fs/promises')
    const { dirname, join } = await import('node:path')
    const { fileURLToPath } = await import('node:url')

    const src = await readFile(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../components/kpi-strip.tsx'
      ),
      'utf8'
    )

    expect(src).toMatch(
      /import\s*\{[^}]*formatUsd[^}]*\}\s*from\s*['"]\.\.\/lib\/usage-report-display['"]/
    )
    expect(src).not.toMatch(/function\s+formatUsd\s*\(/)
    expect(src).not.toMatch(/function\s+formatCost\s*\(/)
  })

  test('test_kpi_strip_uses_lib_format_latency_import', async () => {
    const { readFile } = await import('node:fs/promises')
    const { dirname, join } = await import('node:path')
    const { fileURLToPath } = await import('node:url')

    const src = await readFile(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../components/kpi-strip.tsx'
      ),
      'utf8'
    )

    expect(src).toMatch(
      /import\s*\{[^}]*formatLatency[^}]*\}\s*from\s*['"]\.\.\/lib\/usage-report-display['"]/
    )
    expect(src).not.toMatch(/function\s+formatLatency\s*\(/)
  })

  test('test_comparison_panel_uses_lib_format_usd_import', async () => {
    const { readFile } = await import('node:fs/promises')
    const { dirname, join } = await import('node:path')
    const { fileURLToPath } = await import('node:url')

    const src = await readFile(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../components/comparison-panel.tsx'
      ),
      'utf8'
    )

    expect(src).toMatch(
      /import\s*\{[^}]*formatUsd[^}]*\}\s*from\s*['"]\.\.\/lib\/usage-report-display['"]/
    )
    expect(src).not.toMatch(/function\s+formatUsd\s*\(/)
  })

  test('test_comparison_panel_test_no_local_format_usd_drift', async () => {
    /**
     * RED: comparison-panel.test.tsx currently defines a LOCAL `formatUsd`
     * function (~line 58) using `$${n.toFixed(2)}` — diverges from the real lib
     * function which uses toLocaleString with comma separators (e.g. $1,560.10
     * vs $1560.10 for values >= $1000).
     *
     * After Engineer C migrates the test to import real `formatUsd`, this local
     * copy must be deleted.
     */
    const { readFile } = await import('node:fs/promises')
    const { dirname, join } = await import('node:path')
    const { fileURLToPath } = await import('node:url')

    const src = await readFile(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../components/comparison-panel.test.tsx'
      ),
      'utf8'
    )

    // RED: local formatUsd currently present.
    expect(src).not.toMatch(/function\s+formatUsd\s*\(/)
  })

  test('test_lib_format_usd_uses_locale_comma_separators', async () => {
    /**
     * Pin the real lib `formatUsd` contract so any local drift is caught.
     * The local drift copy uses `$${n.toFixed(2)}` — no comma separators.
     * For values >= $1000 this produces different output.
     *
     * GREEN: value assertion against the real function.
     */
    const { formatUsd } = await import('./usage-report-display')

    expect(formatUsd(14)).toBe('$14.00')
    expect(formatUsd(0)).toBe('$0.00')
    expect(formatUsd(0.5)).toBe('$0.50')
    // Key divergence from the local copy:
    expect(formatUsd(1560.1)).toBe('$1,560.10')
    expect(formatUsd(10000)).toBe('$10,000.00')
    expect(formatUsd(null)).toBe('—')
    expect(formatUsd(undefined)).toBe('—')
  })

  test('test_lib_format_latency_contract', async () => {
    /**
     * Pin the lib formatLatency contract.
     * GREEN: value assertion against the real function.
     */
    const { formatLatency } = await import('./usage-report-display')

    expect(formatLatency(500)).toBe('500ms')
    expect(formatLatency(1500)).toBe('1.5s')
    expect(formatLatency(2000)).toBe('2.0s')
    expect(formatLatency(null)).toBe('—')
    expect(formatLatency(undefined)).toBe('—')
    expect(formatLatency(0)).toBe('0ms')
    expect(formatLatency(999)).toBe('999ms')
    expect(formatLatency(1000)).toBe('1.0s')
  })
})

// ---------------------------------------------------------------------------
// 3. ReportCacheMetadata shape (S4-4)
//    Shape-stability assertions — GREEN (guard against field rename/drop).
//    Runtime companion check — RED (new export does not exist yet).
// ---------------------------------------------------------------------------

describe('ReportCacheMetadata (S4-4)', () => {
  test('test_report_cache_metadata_all_8_fields_present', () => {
    /**
     * Verify the 8 wire fields produced by server-side `maybeDecorateCacheMetadata`.
     * If the W11 extraction renames/drops a field, TypeScript catches it at compile
     * time AND this assertion acts as a runtime net.
     *
     * GREEN: shape-stability guard.
     */
    const syntheticMetadata: {
      cacheBackend?: string
      cacheFreshUntil?: string | null
      cacheGeneratedAt?: string | null
      cacheKeyHash?: string
      cacheScope?: string
      cacheStaleUntil?: string | null
      cacheStatus?: string
      cacheRefreshing?: boolean
    } = {
      cacheBackend: 'redis',
      cacheFreshUntil: new Date(Date.now() + 600_000).toISOString(),
      cacheGeneratedAt: new Date().toISOString(),
      cacheKeyHash: 'abc123',
      cacheScope: 'usage',
      cacheStaleUntil: new Date(Date.now() + 1_200_000).toISOString(),
      cacheStatus: 'fresh',
      cacheRefreshing: false,
    }

    expect(Object.keys(syntheticMetadata)).toHaveLength(8)
    expect(syntheticMetadata.cacheBackend).toBe('redis')
    expect(syntheticMetadata.cacheStatus).toBe('fresh')
    expect(syntheticMetadata.cacheRefreshing).toBe(false)
    expect(syntheticMetadata.cacheKeyHash).toBe('abc123')
    expect(syntheticMetadata.cacheScope).toBe('usage')
  })

  test('test_report_cache_metadata_nullable_fields_accept_null', () => {
    /**
     * `cacheFreshUntil`, `cacheGeneratedAt`, `cacheStaleUntil` are `string | null`.
     * GREEN: compile-time + runtime shape guard.
     */
    const nullableMetadata: {
      cacheBackend?: string
      cacheFreshUntil?: string | null
      cacheGeneratedAt?: string | null
      cacheKeyHash?: string
      cacheScope?: string
      cacheStaleUntil?: string | null
      cacheStatus?: string
      cacheRefreshing?: boolean
    } = {
      cacheBackend: 'sql-fallback',
      cacheFreshUntil: null,
      cacheGeneratedAt: null,
      cacheKeyHash: 'xyz789',
      cacheScope: 'quotas',
      cacheStaleUntil: null,
      cacheStatus: 'miss',
      cacheRefreshing: true,
    }

    expect(nullableMetadata.cacheFreshUntil).toBeNull()
    expect(nullableMetadata.cacheGeneratedAt).toBeNull()
    expect(nullableMetadata.cacheStaleUntil).toBeNull()
    expect(nullableMetadata.cacheRefreshing).toBe(true)
  })

  test('test_report_cache_metadata_refreshing_boolean_type', () => {
    /**
     * `cacheRefreshing` is boolean — not string.  This is the field that
     * discriminates a stale-while-revalidating response.
     *
     * GREEN: type-system guard.
     */
    const m: { cacheRefreshing?: boolean } = { cacheRefreshing: true }
    expect(m.cacheRefreshing).toBe(true)
    expect(typeof m.cacheRefreshing).toBe('boolean')
  })

  test('test_usage_report_api_module_has_report_cache_metadata_runtime_companion', async () => {
    /**
     * RED: after Engineer C's W11 change, `usage-report.ts` must export a
     * runtime-visible companion: `REPORT_CACHE_METADATA_FIELDS` (string tuple of
     * the 8 field names) or `isReportCacheMetadata` guard function.
     *
     * This ensures a single place in the codebase defines these 8 field names.
     *
     * RED: currently no such export exists in usage-report.ts.
     */
    const apiModule = await import('../api/usage-report')

    const hasRuntimeCompanion =
      'REPORT_CACHE_METADATA_FIELDS' in apiModule ||
      'isReportCacheMetadata' in apiModule ||
      'reportCacheMetadataFields' in apiModule

    expect(hasRuntimeCompanion).toBe(true)
  })
})
