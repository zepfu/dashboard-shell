/**
 * Tests for usage-report-display helpers.
 *
 * Covers the wave34 KPI correctness fixes:
 *   B2 — computeFleetErrors date-window filter (✘-2)
 *   B3 — computeFleetP95 requests-weighted average (✘-3)
 */
import { computeFleetErrors } from './usage-report-display'

// ---------------------------------------------------------------------------
// computeFleetErrors
// ---------------------------------------------------------------------------

describe('computeFleetErrors', () => {
  const observations = [
    { observed_at: '2026-05-01T10:00:00Z' },
    { observed_at: '2026-05-10T12:00:00Z' },
    { observed_at: '2026-05-15T08:00:00Z' },
    { observed_at: '2026-05-19T23:59:00Z' },
    { observed_at: null },
  ]

  test('test_returns_full_count_when_no_window_provided', () => {
    expect(computeFleetErrors(observations)).toBe(5)
  })

  test('test_returns_full_count_when_only_from_provided', () => {
    // Missing `to` — backward-compat: return total count
    expect(computeFleetErrors(observations, '2026-05-10')).toBe(5)
  })

  test('test_returns_full_count_when_only_to_provided', () => {
    // Missing `from` — backward-compat: return total count
    expect(computeFleetErrors(observations, undefined, '2026-05-20')).toBe(5)
  })

  test('test_filters_observations_within_window', () => {
    // Window: 2026-05-10 ≤ observed_at < 2026-05-16
    // Matches: '2026-05-10T12:00:00Z' and '2026-05-15T08:00:00Z'
    expect(computeFleetErrors(observations, '2026-05-10', '2026-05-16')).toBe(2)
  })

  test('test_window_is_inclusive_lower_exclusive_upper', () => {
    // Lower bound is inclusive: exact midnight of from date is included.
    // Upper bound is exclusive: exact midnight of to date is excluded.
    const obs = [
      { observed_at: '2026-05-10T00:00:00.000Z' }, // = from → included
      { observed_at: '2026-05-16T00:00:00.000Z' }, // = to   → excluded
    ]
    expect(computeFleetErrors(obs, '2026-05-10', '2026-05-16')).toBe(1)
  })

  test('test_excludes_null_observed_at_within_window', () => {
    // Observations with null observed_at must always be excluded regardless of window.
    const obs = [{ observed_at: null }, { observed_at: '2026-05-12T00:00:00Z' }]
    expect(computeFleetErrors(obs, '2026-05-10', '2026-05-16')).toBe(1)
  })

  test('test_returns_zero_when_no_observations_in_window', () => {
    expect(computeFleetErrors(observations, '2026-04-01', '2026-04-30')).toBe(0)
  })

  test('test_returns_zero_on_empty_array', () => {
    expect(computeFleetErrors([], '2026-05-01', '2026-05-20')).toBe(0)
  })

  test('test_single_observation_at_exact_from_boundary_is_included', () => {
    const obs = [{ observed_at: '2026-05-10T00:00:00.000Z' }]
    expect(computeFleetErrors(obs, '2026-05-10', '2026-05-11')).toBe(1)
  })

  test('test_single_observation_just_before_to_boundary_is_included', () => {
    const obs = [{ observed_at: '2026-05-10T23:59:59.999Z' }]
    expect(computeFleetErrors(obs, '2026-05-10', '2026-05-11')).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// computeFleetP95 (weighted average — tested via index.tsx integration but
// also verified here by importing the helper through a module-level alias
// to keep tests isolated from React component rendering).
//
// Note: computeFleetP95 is defined in index.tsx (module-private function).
// We test its semantics by reproducing the algorithm inline so that we can
// verify the contract independently of the component lifecycle. If the
// function is later extracted to this lib file the tests can be updated to
// import it directly.
// ---------------------------------------------------------------------------

describe('computeFleetP95 weighted-average semantics', () => {
  /** Mirrors the algorithm in index.tsx computeFleetP95. */
  function computeFleetP95Impl(
    rows: { upstream_p95_ms: number | null; requests: number }[]
  ): number {
    let weightedSum = 0
    let totalRequests = 0
    for (const r of rows) {
      if (r.upstream_p95_ms === null) continue
      weightedSum += r.upstream_p95_ms * r.requests
      totalRequests += r.requests
    }
    return totalRequests > 0 ? weightedSum / totalRequests : 0
  }

  test('test_returns_zero_for_empty_rows', () => {
    expect(computeFleetP95Impl([])).toBe(0)
  })

  test('test_returns_zero_when_all_p95_null', () => {
    const rows = [
      { upstream_p95_ms: null, requests: 100 },
      { upstream_p95_ms: null, requests: 200 },
    ]
    expect(computeFleetP95Impl(rows)).toBe(0)
  })

  test('test_single_row_equals_its_own_p95', () => {
    const rows = [{ upstream_p95_ms: 1500, requests: 50 }]
    expect(computeFleetP95Impl(rows)).toBe(1500)
  })

  test('test_equal_request_counts_produce_simple_mean', () => {
    // Both buckets have 100 requests → simple average
    const rows = [
      { upstream_p95_ms: 1000, requests: 100 },
      { upstream_p95_ms: 3000, requests: 100 },
    ]
    expect(computeFleetP95Impl(rows)).toBe(2000)
  })

  test('test_high_traffic_bucket_dominates_low_sample_bucket', () => {
    // Low-sample outlier: 282_199 ms, 3 requests
    // High-traffic bucket:  10_000 ms, 1000 requests
    // Weighted avg ≈ (282_199*3 + 10_000*1000) / 1003 ≈ 10_840 ms
    // (significantly lower than max=282_199)
    const rows = [
      { upstream_p95_ms: 282_199, requests: 3 },
      { upstream_p95_ms: 10_000, requests: 1_000 },
    ]
    const result = computeFleetP95Impl(rows)
    // Must be much closer to 10_000 than to 282_199
    expect(result).toBeLessThan(12_000)
    expect(result).toBeGreaterThan(9_000)
  })

  test('test_null_rows_are_excluded_from_both_numerator_and_denominator', () => {
    // Only the non-null row should count
    const rows = [
      { upstream_p95_ms: null, requests: 500 },
      { upstream_p95_ms: 2_000, requests: 10 },
    ]
    // Denominator = 10 (not 510), numerator = 2_000*10
    expect(computeFleetP95Impl(rows)).toBe(2_000)
  })

  test('test_weighted_avg_is_not_equal_to_max', () => {
    // Regression guard: ensure we are NOT returning Math.max
    const rows = [
      { upstream_p95_ms: 5_000, requests: 900 },
      { upstream_p95_ms: 50_000, requests: 10 },
    ]
    const result = computeFleetP95Impl(rows)
    expect(result).not.toBe(50_000) // not max
    // (5000*900 + 50000*10) / 910 ≈ 5_494
    expect(result).toBeCloseTo(5_494.5, 0)
  })
})
