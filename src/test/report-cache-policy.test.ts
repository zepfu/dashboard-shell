/**
 * Wave 6 — Report cache policy tests (S6-T7 / #39)
 *
 * The `keeps cache-bust in canonical cache identity` test is INVERTED.
 *
 * Finding #39 / S6-T7: cache_bust must be EXCLUDED from the canonical cache
 * identity hash. It is a bypass hint to the cache layer (signals: "serve fresh
 * to this caller"), not a distinct dataset. Keeping it in the hash means every
 * cache_bust value produces an isolated cache entry that is never reused —
 * defeating the cache entirely.
 *
 * Infrastructure note: `server/report-service.mjs` imports `redis` and `pg`
 * which are not available in the vitest/jsdom environment and cannot be resolved
 * by Vite at transform time (they are absent from node_modules).
 *
 * The engineer must extract the pure cache-identity functions to a server-side
 * pure module at `server/report-cache-identity.mjs` that has no redis/pg imports.
 * The three originally-passing tests (TTL, freshUntil) are migrated there too.
 *
 * The test below imports from that net-new module — this is the RED contract.
 * Until the engineer creates `server/report-cache-identity.mjs` and exports the
 * pure functions, every test in this file fails at import time.
 */
import { describe, expect, test } from 'vitest'
// RED: this module does not exist yet. The engineer must create it by extracting
// the pure cache-identity logic from report-service.mjs into a dep-free module.
import {
  buildReportCacheEntry,
  buildReportCacheIdentity,
  canonicalizeSearchParams,
  resolveReportCacheTtlMs,
} from '../../server/report-cache-identity.mjs'

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

  // ---------------------------------------------------------------------------
  // S6-T7 / #39: INVERTED — cache_bust must NOT affect cache identity
  //
  // OLD (enshrined bug, deleted from this file):
  //   test('keeps cache-bust in canonical cache identity', () => {
  //     ...
  //     expect(canonicalizeSearchParams(first)).toBe(
  //       'cache_bust=manual-1&from=2026-06-01&to=2026-06-06'  // WRONG
  //     )
  //     expect(buildReportCacheIdentity('usage', first).hash).not.toBe(
  //       buildReportCacheIdentity('usage', cacheBustChanged).hash  // WRONG
  //     )
  //   })
  //
  // cache_bust is a bypass hint, not a data dimension. Two requests with
  // the same date range but different cache_bust values refer to the SAME
  // underlying dataset. They must share a cache identity hash.
  // ---------------------------------------------------------------------------

  test('test_report_cache_identity_excludes_cache_bust', () => {
    // Baseline: params without cache_bust
    const withoutBust = new URLSearchParams()
    withoutBust.set('to', '2026-06-06')
    withoutBust.set('from', '2026-06-01')

    // Same params with cache_bust=manual-1
    const withBust1 = new URLSearchParams()
    withBust1.set('to', '2026-06-06')
    withBust1.set('from', '2026-06-01')
    withBust1.set('cache_bust', 'manual-1')

    // Same params with cache_bust=manual-2 (different value)
    const withBust2 = new URLSearchParams(withBust1)
    withBust2.set('cache_bust', 'manual-2')

    // The canonical string must NOT include cache_bust.
    // RED (after module extracted): current canonicalizeSearchParams includes all keys.
    const canonicalized = canonicalizeSearchParams(withBust1)
    expect(canonicalized).not.toContain('cache_bust')
    expect(canonicalized).toBe('from=2026-06-01&to=2026-06-06')

    // Two requests that differ only by cache_bust share one cache identity.
    expect(buildReportCacheIdentity('usage', withBust1).hash).toBe(
      buildReportCacheIdentity('usage', withBust2).hash
    )

    // A request without cache_bust and one WITH cache_bust also share identity.
    expect(buildReportCacheIdentity('usage', withoutBust).hash).toBe(
      buildReportCacheIdentity('usage', withBust1).hash
    )

    // Requests with DIFFERENT date ranges must still differ.
    const differentRange = new URLSearchParams()
    differentRange.set('from', '2026-06-07')
    differentRange.set('to', '2026-06-13')
    differentRange.set('cache_bust', 'manual-1')

    expect(buildReportCacheIdentity('usage', withBust1).hash).not.toBe(
      buildReportCacheIdentity('usage', differentRange).hash
    )
  })

  test('test_cache_bust_param_is_treated_as_bypass_hint_not_cache_key', () => {
    // Semantic test: the cacheKey must not embed the cache_bust value.
    // The cache layer can check for cache_bust presence to bypass stale-serve,
    // but must use an identity WITHOUT cache_bust for storage/lookup keying.

    const params = new URLSearchParams()
    params.set('from', '2026-06-01')
    params.set('to', '2026-06-06')
    params.set('cache_bust', 'any-value')

    const identity = buildReportCacheIdentity('usage', params)

    // RED: currently the hash includes all params, so cacheKey embeds 'any-value'.
    expect(identity.cacheKey).not.toContain('any-value')
    expect(identity.cacheKey).not.toContain('cache_bust')
  })
})
