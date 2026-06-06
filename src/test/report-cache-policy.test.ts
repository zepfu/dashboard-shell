import { describe, expect, test } from 'vitest'
import {
  buildReportCacheEntry,
  buildReportCacheIdentity,
  canonicalizeSearchParams,
  resolveReportCacheTtlMs,
} from '../../server/report-service.mjs'

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS

describe('report cache policy', () => {
  test('keeps usage summary reports fresh for ten minutes by default', () => {
    expect(resolveReportCacheTtlMs('usage')).toBe(10 * MINUTE_MS)
    expect(resolveReportCacheTtlMs('usage-token-trend-summary-v3')).toBe(
      10 * MINUTE_MS
    )
    expect(resolveReportCacheTtlMs('usage-tool-activity')).toBe(10 * MINUTE_MS)
    expect(resolveReportCacheTtlMs('usage-token-trend-day')).toBe(
      10 * MINUTE_MS
    )
  })

  test('leaves quota-style report scopes on the shorter default cadence', () => {
    expect(resolveReportCacheTtlMs('quotas')).toBe(MINUTE_MS)
    expect(resolveReportCacheTtlMs('usage-quota-history')).toBe(MINUTE_MS)
    expect(resolveReportCacheTtlMs('usage-quota-range-history')).toBe(MINUTE_MS)
  })

  test('writes fresh-until timestamps from the scope-specific cache policy', () => {
    const before = Date.now()
    const usageEntry = buildReportCacheEntry({ ok: true }, { scope: 'usage' })
    const quotaEntry = buildReportCacheEntry({ ok: true }, { scope: 'quotas' })
    const after = Date.now()

    expect(usageEntry.freshUntil).toBeGreaterThanOrEqual(
      before + 10 * MINUTE_MS
    )
    expect(usageEntry.freshUntil).toBeLessThanOrEqual(after + 10 * MINUTE_MS)
    expect(quotaEntry.freshUntil).toBeGreaterThanOrEqual(before + MINUTE_MS)
    expect(quotaEntry.freshUntil).toBeLessThanOrEqual(after + MINUTE_MS)
  })

  test('keeps cache-bust in canonical cache identity', () => {
    const first = new URLSearchParams()
    first.set('to', '2026-06-06')
    first.set('from', '2026-06-01')
    first.set('cache_bust', 'manual-1')

    const reordered = new URLSearchParams()
    reordered.set('cache_bust', 'manual-1')
    reordered.set('from', '2026-06-01')
    reordered.set('to', '2026-06-06')

    const cacheBustChanged = new URLSearchParams(reordered)
    cacheBustChanged.set('cache_bust', 'manual-2')

    expect(canonicalizeSearchParams(first)).toBe(
      'cache_bust=manual-1&from=2026-06-01&to=2026-06-06'
    )
    expect(buildReportCacheIdentity('usage', first).hash).toBe(
      buildReportCacheIdentity('usage', reordered).hash
    )
    expect(buildReportCacheIdentity('usage', first).hash).not.toBe(
      buildReportCacheIdentity('usage', cacheBustChanged).hash
    )
  })
})
