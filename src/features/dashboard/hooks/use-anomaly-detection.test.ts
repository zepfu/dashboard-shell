/**
 * Wave 4 — useAnomalyDetection hook red-phase tests.
 *
 * Hook path: src/features/dashboard/hooks/use-anomaly-detection.ts
 * Expected export: useAnomalyDetection (named)
 * Signature: useAnomalyDetection(healthRows, metadata) => { earlyReset: Map<string, {prior: string, current: string}>, cacheStale: boolean }
 *
 * All tests expected to FAIL (red) — source file does not exist yet.
 */
import { renderHook } from '@testing-library/react'
// ─────────────────────────────────────────────────────────────────────────────
// Wave 5 / S4-T2: multi-lane no-false-positive
// ─────────────────────────────────────────────────────────────────────────────

import { describe } from 'vitest'
import { useAnomalyDetection } from './use-anomaly-detection'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface HealthRow {
  provider: string
  model: string
  bucket_start: string
  next_expected_reset_at: string
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('test_detects_early_reset_non_monotonic', () => {
  // Row 1: bucket 08:00, reset 12:00 (later)
  // Row 2: bucket 09:00, reset 10:00 (earlier than row 1's reset — early reset!)
  const healthRows: HealthRow[] = [
    {
      provider: 'anthropic',
      model: 'claude',
      bucket_start: '2024-01-15T08:00:00Z',
      next_expected_reset_at: '2024-01-15T12:00:00Z',
    },
    {
      provider: 'anthropic',
      model: 'claude',
      bucket_start: '2024-01-15T09:00:00Z',
      next_expected_reset_at: '2024-01-15T10:00:00Z',
    },
  ]

  const { result } = renderHook(() =>
    useAnomalyDetection(healthRows, { latestRecordStale: false })
  )

  expect(result.current.earlyReset.has('anthropic')).toBe(true)

  const entry = result.current.earlyReset.get('anthropic')
  expect(entry).toBeDefined()
  expect(entry!.prior).toContain('12:00')
  expect(entry!.current).toContain('10:00')
})

test('test_no_early_reset_when_monotonic', () => {
  // Three rows with non-decreasing next_expected_reset_at
  const healthRows: HealthRow[] = [
    {
      provider: 'openai',
      model: 'gpt-4',
      bucket_start: '2024-01-15T08:00:00Z',
      next_expected_reset_at: '2024-01-15T12:00:00Z',
    },
    {
      provider: 'openai',
      model: 'gpt-4',
      bucket_start: '2024-01-15T09:00:00Z',
      next_expected_reset_at: '2024-01-15T12:00:00Z',
    },
    {
      provider: 'openai',
      model: 'gpt-4',
      bucket_start: '2024-01-15T10:00:00Z',
      next_expected_reset_at: '2024-01-15T13:00:00Z',
    },
  ]

  const { result } = renderHook(() =>
    useAnomalyDetection(healthRows, { latestRecordStale: false })
  )

  expect(result.current.earlyReset.size).toBe(0)
})

test('test_detects_cache_stale', () => {
  const { result } = renderHook(() =>
    useAnomalyDetection([], { latestRecordStale: true })
  )

  expect(result.current.cacheStale).toBe(true)
})

test('test_no_cache_stale_when_false', () => {
  const { result } = renderHook(() =>
    useAnomalyDetection([], { latestRecordStale: false })
  )

  expect(result.current.cacheStale).toBe(false)
})

test('test_gemini_rows_surface_under_google_key', () => {
  // Regression: Wave 18-A — DB stores Google rows as 'gemini'.
  // ProviderCard queries earlyReset.has('google'), which was always false
  // before canonicalProvider was applied to the Map key.
  const healthRows: HealthRow[] = [
    {
      provider: 'gemini', // raw DB value
      model: 'gemini-1.5-flash',
      bucket_start: '2024-01-15T08:00:00Z',
      next_expected_reset_at: '2024-01-15T12:00:00Z',
    },
    {
      provider: 'gemini', // raw DB value
      model: 'gemini-1.5-flash',
      bucket_start: '2024-01-15T09:00:00Z',
      next_expected_reset_at: '2024-01-15T10:00:00Z', // earlier → early reset
    },
  ]

  const { result } = renderHook(() =>
    useAnomalyDetection(healthRows, { latestRecordStale: false })
  )

  // Must surface under canonical 'google', NOT raw 'gemini'
  expect(result.current.earlyReset.has('google')).toBe(true)
  expect(result.current.earlyReset.has('gemini')).toBe(false)

  const entry = result.current.earlyReset.get('google')
  expect(entry).toBeDefined()
  expect(entry!.prior).toContain('12:00')
  expect(entry!.current).toContain('10:00')
})

test('test_sorts_rows_by_bucket_start_before_scanning', () => {
  // Rows OUT OF ORDER: row1 bucket 10:00, row2 bucket 08:00
  // If sorted correctly: 08:00 reset stays same or increases (08:00→10:00 is fine)
  // Without sorting: hook might see 10:00→11:00 as monotonic, or 08:00→09:00 out of order
  // These rows are monotonic WHEN SORTED — no false positive early reset
  const healthRows: HealthRow[] = [
    {
      provider: 'google',
      model: 'gemini',
      bucket_start: '2024-01-15T10:00:00Z',
      next_expected_reset_at: '2024-01-15T14:00:00Z',
    },
    {
      provider: 'google',
      model: 'gemini',
      bucket_start: '2024-01-15T08:00:00Z',
      next_expected_reset_at: '2024-01-15T12:00:00Z',
    },
  ]

  const { result } = renderHook(() =>
    useAnomalyDetection(healthRows, { latestRecordStale: false })
  )

  // After sorting by bucket_start: 08:00→reset12:00, 10:00→reset14:00
  // That is monotonic → no early reset
  expect(result.current.earlyReset.size).toBe(0)
})

/**
 * S4-T2 / Bug #45: When a provider has two quota lanes (e.g. 5h and 7d) with
 * different reset schedules, `useAnomalyDetection` currently groups ALL rows by
 * provider name. This means a 5h-lane row with reset at 12:00 followed by a
 * 7d-lane row with reset at next Tuesday will look like a non-monotonic
 * (decreasing) sequence — a false positive.
 *
 * The fix is to group by `(provider, quota lane)` so that 5h rows only compare
 * with other 5h rows.
 *
 * This is RED until the engineer implements lane-aware grouping (S4-T2/#45).
 */
describe('test_useAnomalyDetection_multi_lane_no_false_positive (S4-T2/#45)', () => {
  test('5h and 7d lanes individually monotonic produce no early-reset flag', () => {
    // Provider: anthropic
    // Lane 1 (5h): two consecutive buckets with monotonically increasing resets
    // Lane 2 (7d): two consecutive buckets with monotonically increasing resets
    //
    // Without lane grouping: mixing 5h reset (e.g. +5h) with 7d reset (e.g. +7d)
    // in temporal order causes a false positive when a 7d row comes before a 5h row.
    const healthRows = [
      // 5h-lane buckets: resets at +5h, +10h (monotonic ↑)
      {
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        bucket_start: '2026-06-13T00:00:00Z',
        next_expected_reset_at: '2026-06-13T05:00:00Z', // 5h lane reset
        quota_lane: 'short',
      },
      {
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        bucket_start: '2026-06-13T01:00:00Z',
        next_expected_reset_at: '2026-06-13T10:00:00Z', // 5h lane reset +1h
        quota_lane: 'short',
      },
      // 7d-lane buckets: resets at +7d, +14d (monotonic ↑, but numerically
      // lower than the 5h resets when sorted together by bucket_start)
      {
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        bucket_start: '2026-06-13T00:30:00Z',
        next_expected_reset_at: '2026-06-20T00:00:00Z', // 7d lane reset
        quota_lane: 'weekly',
      },
      {
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        bucket_start: '2026-06-13T01:30:00Z',
        next_expected_reset_at: '2026-06-27T00:00:00Z', // 7d lane reset +7d
        quota_lane: 'weekly',
      },
    ]

    const { result } = renderHook(() =>
      useAnomalyDetection(healthRows, { latestRecordStale: false })
    )

    // Both lanes are individually monotonic — no early reset should be flagged.
    // This will FAIL with the current implementation (no lane-aware grouping)
    // because mixing 5h rows (resets ~5h) with 7d rows (resets ~7d) in bucket_start
    // order can produce apparent decreases.
    expect(result.current.earlyReset.size).toBe(0)
  })

  test('genuine early reset in one lane still fires while monotonic lane is quiet', () => {
    const healthRows = [
      // 5h lane: genuine early reset (second reset < first reset)
      {
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        bucket_start: '2026-06-13T00:00:00Z',
        next_expected_reset_at: '2026-06-13T10:00:00Z', // expected 10:00
        quota_lane: 'short',
      },
      {
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        bucket_start: '2026-06-13T01:00:00Z',
        next_expected_reset_at: '2026-06-13T06:00:00Z', // early reset to 06:00!
        quota_lane: 'short',
      },
      // 7d lane: monotonic, should NOT suppress the 5h flag
      {
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        bucket_start: '2026-06-13T00:30:00Z',
        next_expected_reset_at: '2026-06-20T00:00:00Z',
        quota_lane: 'weekly',
      },
      {
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        bucket_start: '2026-06-13T01:30:00Z',
        next_expected_reset_at: '2026-06-27T00:00:00Z',
        quota_lane: 'weekly',
      },
    ]

    const { result } = renderHook(() =>
      useAnomalyDetection(healthRows, { latestRecordStale: false })
    )

    // The 5h lane has a genuine early reset → should be flagged
    expect(result.current.earlyReset.size).toBeGreaterThan(0)
  })
})
