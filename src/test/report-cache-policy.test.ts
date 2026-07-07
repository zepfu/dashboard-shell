/**
 * Report cache policy — canonical identity and TTL semantics from
 * `server/report-cache-identity.mjs` (S6-T7 / #39).
 */
import { describe, expect, test } from 'vitest'
import {
  buildReportCacheEntry,
  buildReportCacheIdentity,
  buildReportCachePrewarmLockKey,
  canonicalizeSearchParams,
  isUsageReportCacheScope,
  resolveReportCacheConfig,
  resolveReportCacheTtlMs,
} from '../../server/report-cache-identity.mjs'

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS

describe('report cache policy', () => {
  test('keeps usage-v2 summary reports fresh for ten minutes by default', () => {
    expect(resolveReportCacheTtlMs('usage-v2')).toBe(10 * MINUTE_MS)
    expect(resolveReportCacheTtlMs('usage-token-trend-summary-v6')).toBe(
      10 * MINUTE_MS
    )
    expect(resolveReportCacheTtlMs('usage-tool-activity')).toBe(10 * MINUTE_MS)
    expect(resolveReportCacheTtlMs('usage-token-trend-day')).toBe(
      10 * MINUTE_MS
    )
  })

  test('leaves quota-style report scopes on the shorter default cadence', () => {
    expect(resolveReportCacheTtlMs('quotas')).toBe(MINUTE_MS)
    expect(resolveReportCacheTtlMs('usage-quota-history-v2')).toBe(MINUTE_MS)
    expect(resolveReportCacheTtlMs('usage-quota-range-history')).toBe(MINUTE_MS)
  })

  test('classifies current and future-version-shaped usage scopes explicitly', () => {
    expect(isUsageReportCacheScope('usage-v2')).toBe(true)
    expect(isUsageReportCacheScope('usage-tool-activity')).toBe(true)
    expect(isUsageReportCacheScope('usage-token-trend-day')).toBe(true)
    expect(resolveReportCacheTtlMs('usage-v3')).toBe(10 * MINUTE_MS)
    expect(resolveReportCacheTtlMs('usage-token-trend-summary-v7')).toBe(
      10 * MINUTE_MS
    )
  })

  test('does not infer every usage-prefixed scope as a usage-TTL scope', () => {
    expect(isUsageReportCacheScope('usage-session-diagnostics-v1')).toBe(false)
    expect(resolveReportCacheTtlMs('usage-session-diagnostics-v1')).toBe(
      MINUTE_MS
    )
  })

  test('writes fresh-until timestamps from the scope-specific cache policy', () => {
    const before = Date.now()
    const usageEntry = buildReportCacheEntry(
      { ok: true },
      { scope: 'usage-v2' }
    )
    const quotaEntry = buildReportCacheEntry({ ok: true }, { scope: 'quotas' })
    const after = Date.now()

    expect(usageEntry.freshUntil).toBeGreaterThanOrEqual(
      before + 10 * MINUTE_MS
    )
    expect(usageEntry.freshUntil).toBeLessThanOrEqual(after + 10 * MINUTE_MS)
    expect(quotaEntry.freshUntil).toBeGreaterThanOrEqual(before + MINUTE_MS)
    expect(quotaEntry.freshUntil).toBeLessThanOrEqual(after + MINUTE_MS)
  })

  test('resolveReportCacheConfig parses env overrides for identity and entries', () => {
    const config = resolveReportCacheConfig({
      SHELL_REPORT_CACHE_TTL_MS: '120000',
      SHELL_REPORT_USAGE_CACHE_TTL_MS: '300000',
      SHELL_REPORT_CACHE_STALE_TTL_MS: '3600000',
      SHELL_REPORT_CACHE_PREFIX: 'test:reports',
      SHELL_REPORT_CACHE_VERSION: 'v99',
    })

    expect(config.defaultTtlMs).toBe(120_000)
    expect(config.usageTtlMs).toBe(300_000)
    expect(config.staleTtlMs).toBe(3_600_000)
    expect(config.prefix).toBe('test:reports')
    expect(config.version).toBe('v99')

    const params = new URLSearchParams({ from: '2026-06-01', to: '2026-06-06' })
    const identity = buildReportCacheIdentity('quotas', params, config)
    expect(identity.cacheKey).toMatch(/^test:reports:v99:quotas:[a-f0-9]{64}$/)
    expect(buildReportCachePrewarmLockKey(config)).toBe(
      'test:reports:v99:prewarm:lock'
    )

    const entry = buildReportCacheEntry(
      { ok: true },
      {
        scope: 'usage-v2',
        config,
      }
    )
    expect(entry.cacheVersion).toBe('v99')
    expect(resolveReportCacheTtlMs('usage-v2', { config })).toBe(300_000)
  })

  test('default cache key and prewarm lock shapes match production defaults', () => {
    const params = new URLSearchParams({ from: '2026-06-01', to: '2026-06-06' })
    const identity = buildReportCacheIdentity('usage-v2', params)
    expect(identity.cacheKey).toMatch(
      /^dashboard-shell:reports:v14:usage-v2:[a-f0-9]{64}$/
    )
    expect(identity.lockKey).toMatch(
      /^dashboard-shell:reports:v14:usage-v2:[a-f0-9]{64}:lock$/
    )
    expect(buildReportCachePrewarmLockKey()).toBe(
      'dashboard-shell:reports:v14:prewarm:lock'
    )
  })

  test('test_report_cache_identity_excludes_cache_bust', () => {
    const withoutBust = new URLSearchParams()
    withoutBust.set('to', '2026-06-06')
    withoutBust.set('from', '2026-06-01')

    const withBust1 = new URLSearchParams()
    withBust1.set('to', '2026-06-06')
    withBust1.set('from', '2026-06-01')
    withBust1.set('cache_bust', 'manual-1')

    const withBust2 = new URLSearchParams(withBust1)
    withBust2.set('cache_bust', 'manual-2')

    const canonicalized = canonicalizeSearchParams(withBust1)
    expect(canonicalized).not.toContain('cache_bust')
    expect(canonicalized).toBe('from=2026-06-01&to=2026-06-06')

    expect(buildReportCacheIdentity('usage-v2', withBust1).hash).toBe(
      buildReportCacheIdentity('usage-v2', withBust2).hash
    )

    expect(buildReportCacheIdentity('usage-v2', withoutBust).hash).toBe(
      buildReportCacheIdentity('usage-v2', withBust1).hash
    )

    const differentRange = new URLSearchParams()
    differentRange.set('from', '2026-06-07')
    differentRange.set('to', '2026-06-13')
    differentRange.set('cache_bust', 'manual-1')

    expect(buildReportCacheIdentity('usage-v2', withBust1).hash).not.toBe(
      buildReportCacheIdentity('usage-v2', differentRange).hash
    )
  })

  test('test_cache_bust_param_is_treated_as_bypass_hint_not_cache_key', () => {
    const params = new URLSearchParams()
    params.set('from', '2026-06-01')
    params.set('to', '2026-06-06')
    params.set('cache_bust', 'any-value')

    const identity = buildReportCacheIdentity('usage-v2', params)

    expect(identity.cacheKey).not.toContain('any-value')
    expect(identity.cacheKey).not.toContain('cache_bust')
  })
})
