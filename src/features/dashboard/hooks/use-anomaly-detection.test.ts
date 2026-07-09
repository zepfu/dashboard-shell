/**
 * useAnomalyDetection — regression contract for quota reset anomaly detection.
 *
 * Fixtures use real `UsageReportProviderLatencyHealthRow` shapes (no invented
 * `quota_lane`); grouping must derive from `quota_keys` and/or provider+model.
 */
import { act, renderHook } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { UsageReportProviderLatencyHealthRow } from '../api/usage-report'
import { useAnomalyDetection } from './use-anomaly-detection'

function makeHealthRow(
  overrides: Partial<UsageReportProviderLatencyHealthRow> & {
    provider: string
    model: string
    bucket_start: string
  }
): UsageReportProviderLatencyHealthRow {
  return {
    bucket_start: overrides.bucket_start,
    environment: 'prod',
    provider: overrides.provider,
    model: overrides.model,
    model_group: overrides.model_group ?? overrides.model,
    requests: 1,
    passive_latency_sample_status: 'ok',
    upstream_p50_ms: null,
    upstream_p95_ms: null,
    upstream_p99_ms: null,
    total_p95_ms: null,
    proxy_processing_p95_ms: null,
    missing_upstream_latency: 0,
    provider_error_events: 0,
    rate_limit_events: 0,
    capacity_events: 0,
    provider_5xx_events: 0,
    provider_timeout_events: 0,
    network_error_events: 0,
    auth_failed_events: 0,
    adapter_error_events: 0,
    status_probe_count: 0,
    status_probe_success_pct: null,
    status_probe_p95_ms: null,
    provider_ping_avg_ms: null,
    provider_ping_packet_loss_pct: null,
    control_ping_avg_ms: null,
    control_packet_loss_pct: null,
    control_probe_success_pct: null,
    provider_ping_minus_control_ms: null,
    dns_failures: 0,
    tcp_failures: 0,
    tls_failures: 0,
    icmp_failures: 0,
    probed_endpoints: null,
    status_error_classes: null,
    min_remaining_pct: null,
    max_remaining_pct: null,
    next_expected_reset_at:
      overrides.next_expected_reset_at ?? '2026-06-13T12:00:00Z',
    quota_keys: overrides.quota_keys ?? null,
    request_period_start: null,
    request_period_end: null,
    ...overrides,
  }
}

test('test_detects_early_reset_non_monotonic', () => {
  const healthRows = [
    makeHealthRow({
      provider: 'anthropic',
      model: 'claude',
      bucket_start: '2024-01-15T08:00:00Z',
      next_expected_reset_at: '2024-01-15T12:00:00Z',
      quota_keys: 'short',
    }),
    makeHealthRow({
      provider: 'anthropic',
      model: 'claude',
      bucket_start: '2024-01-15T09:00:00Z',
      next_expected_reset_at: '2024-01-15T10:00:00Z',
      quota_keys: 'short',
    }),
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
  const healthRows = [
    makeHealthRow({
      provider: 'openai',
      model: 'gpt-4',
      bucket_start: '2024-01-15T08:00:00Z',
      next_expected_reset_at: '2024-01-15T12:00:00Z',
    }),
    makeHealthRow({
      provider: 'openai',
      model: 'gpt-4',
      bucket_start: '2024-01-15T09:00:00Z',
      next_expected_reset_at: '2024-01-15T12:00:00Z',
    }),
    makeHealthRow({
      provider: 'openai',
      model: 'gpt-4',
      bucket_start: '2024-01-15T10:00:00Z',
      next_expected_reset_at: '2024-01-15T13:00:00Z',
    }),
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
  const healthRows = [
    makeHealthRow({
      provider: 'gemini',
      model: 'gemini-1.5-flash',
      bucket_start: '2024-01-15T08:00:00Z',
      next_expected_reset_at: '2024-01-15T12:00:00Z',
    }),
    makeHealthRow({
      provider: 'gemini',
      model: 'gemini-1.5-flash',
      bucket_start: '2024-01-15T09:00:00Z',
      next_expected_reset_at: '2024-01-15T10:00:00Z',
    }),
  ]

  const { result } = renderHook(() =>
    useAnomalyDetection(healthRows, { latestRecordStale: false })
  )

  expect(result.current.earlyReset.has('google')).toBe(true)
  expect(result.current.earlyReset.has('gemini')).toBe(false)
})

test('test_sorts_rows_by_bucket_start_before_scanning', () => {
  const healthRows = [
    makeHealthRow({
      provider: 'google',
      model: 'gemini',
      bucket_start: '2024-01-15T10:00:00Z',
      next_expected_reset_at: '2024-01-15T14:00:00Z',
    }),
    makeHealthRow({
      provider: 'google',
      model: 'gemini',
      bucket_start: '2024-01-15T08:00:00Z',
      next_expected_reset_at: '2024-01-15T12:00:00Z',
    }),
  ]

  const { result } = renderHook(() =>
    useAnomalyDetection(healthRows, { latestRecordStale: false })
  )

  expect(result.current.earlyReset.size).toBe(0)
})

/**
 * S4-T2 / C1: Real API rows use `quota_keys`, not `quota_lane`. Multi-lane /
 * multi-model sequences that are individually monotonic must not false-positive.
 */
describe('test_useAnomalyDetection_multi_lane_no_false_positive (S4-T2/#45)', () => {
  test('5h and 7d lanes individually monotonic produce no early-reset flag', () => {
    const healthRows = [
      makeHealthRow({
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        bucket_start: '2026-06-13T00:00:00Z',
        next_expected_reset_at: '2026-06-13T05:00:00Z',
        quota_keys: 'short',
      }),
      makeHealthRow({
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        bucket_start: '2026-06-13T01:00:00Z',
        next_expected_reset_at: '2026-06-13T10:00:00Z',
        quota_keys: 'short',
      }),
      makeHealthRow({
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        bucket_start: '2026-06-13T00:30:00Z',
        next_expected_reset_at: '2026-06-20T00:00:00Z',
        quota_keys: 'weekly',
      }),
      makeHealthRow({
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        bucket_start: '2026-06-13T01:30:00Z',
        next_expected_reset_at: '2026-06-27T00:00:00Z',
        quota_keys: 'weekly',
      }),
    ]

    const { result } = renderHook(() =>
      useAnomalyDetection(healthRows, { latestRecordStale: false })
    )

    expect(result.current.earlyReset.size).toBe(0)
  })

  test('genuine early reset in one lane still fires while monotonic lane is quiet', () => {
    const healthRows = [
      makeHealthRow({
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        bucket_start: '2026-06-13T00:00:00Z',
        next_expected_reset_at: '2026-06-13T10:00:00Z',
        quota_keys: 'short',
      }),
      makeHealthRow({
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        bucket_start: '2026-06-13T01:00:00Z',
        next_expected_reset_at: '2026-06-13T06:00:00Z',
        quota_keys: 'short',
      }),
      makeHealthRow({
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        bucket_start: '2026-06-13T00:30:00Z',
        next_expected_reset_at: '2026-06-20T00:00:00Z',
        quota_keys: 'weekly',
      }),
      makeHealthRow({
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        bucket_start: '2026-06-13T01:30:00Z',
        next_expected_reset_at: '2026-06-27T00:00:00Z',
        quota_keys: 'weekly',
      }),
    ]

    const { result } = renderHook(() =>
      useAnomalyDetection(healthRows, { latestRecordStale: false })
    )

    expect(result.current.earlyReset.size).toBeGreaterThan(0)
  })
})

/**
 * C1: Production health rows (typed API) — Google flash vs pro must not be
 * compared in one group when each model's reset schedule is monotonic.
 */
test('test_real_health_rows_google_multi_model_no_false_early_reset (C1)', () => {
  const healthRows: UsageReportProviderLatencyHealthRow[] = [
    makeHealthRow({
      provider: 'google',
      model: 'gemini-2.5-flash',
      bucket_start: '2026-06-13T08:00:00Z',
      next_expected_reset_at: '2026-06-14T08:00:00Z',
      quota_keys: 'short',
    }),
    makeHealthRow({
      provider: 'google',
      model: 'gemini-2.5-pro',
      bucket_start: '2026-06-13T09:00:00Z',
      next_expected_reset_at: '2026-06-20T00:00:00Z',
      quota_keys: 'weekly',
    }),
    makeHealthRow({
      provider: 'google',
      model: 'gemini-2.5-flash',
      bucket_start: '2026-06-13T10:00:00Z',
      next_expected_reset_at: '2026-06-14T10:00:00Z',
      quota_keys: 'short',
    }),
  ]

  const { result } = renderHook(() =>
    useAnomalyDetection(healthRows, { latestRecordStale: false })
  )

  expect(result.current.earlyReset.size).toBe(0)
})

/**
 * C2: When two lanes of the same provider both early-reset, the surfaced
 * `{prior, current}` must be deterministic (first detected group), not
 * last-writer-wins across Map insertion order.
 */
test('test_early_reset_deterministic_first_lane_wins (C2)', () => {
  const shortLaneRows = [
    makeHealthRow({
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      bucket_start: '2026-06-13T00:00:00Z',
      next_expected_reset_at: '2026-06-13T12:00:00Z',
      quota_keys: 'short',
    }),
    makeHealthRow({
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      bucket_start: '2026-06-13T01:00:00Z',
      next_expected_reset_at: '2026-06-13T08:00:00Z',
      quota_keys: 'short',
    }),
  ]
  const weeklyLaneRows = [
    makeHealthRow({
      provider: 'anthropic',
      model: 'claude-opus',
      bucket_start: '2026-06-13T00:30:00Z',
      next_expected_reset_at: '2026-06-20T12:00:00Z',
      quota_keys: 'weekly',
    }),
    makeHealthRow({
      provider: 'anthropic',
      model: 'claude-opus',
      bucket_start: '2026-06-13T01:30:00Z',
      next_expected_reset_at: '2026-06-19T12:00:00Z',
      quota_keys: 'weekly',
    }),
  ]

  const forward = [...shortLaneRows, ...weeklyLaneRows]
  const reversed = [...weeklyLaneRows, ...shortLaneRows]

  const { result: forwardResult } = renderHook(() =>
    useAnomalyDetection(forward, { latestRecordStale: false })
  )
  const { result: reversedResult } = renderHook(() =>
    useAnomalyDetection(reversed, { latestRecordStale: false })
  )

  const forwardEntry = forwardResult.current.earlyReset.get('anthropic')
  const reversedEntry = reversedResult.current.earlyReset.get('anthropic')
  expect(forwardEntry).toBeDefined()
  expect(reversedEntry).toBeDefined()
  expect(forwardEntry!.prior).toBe(reversedEntry!.prior)
  expect(forwardEntry!.current).toBe(reversedEntry!.current)
  expect(forwardEntry!.prior).toContain('12:00')
  expect(forwardEntry!.current).toContain('08:00')
})

test('test_useAnomalyDetection_memo_stable_identity', () => {
  const stableRows = [
    makeHealthRow({
      provider: 'anthropic',
      model: 'claude-3',
      bucket_start: '2026-01-01T08:00:00Z',
      next_expected_reset_at: '2026-01-01T12:00:00Z',
    }),
    makeHealthRow({
      provider: 'anthropic',
      model: 'claude-3',
      bucket_start: '2026-01-01T09:00:00Z',
      next_expected_reset_at: '2026-01-01T13:00:00Z',
    }),
  ]
  const stableMeta = { latestRecordStale: false }

  const { result, rerender } = renderHook(
    ({ rows, meta }: { rows: typeof stableRows; meta: typeof stableMeta }) =>
      useAnomalyDetection(rows, meta),
    { initialProps: { rows: stableRows, meta: stableMeta } }
  )

  const firstOutput = result.current

  rerender({ rows: stableRows, meta: stableMeta })
  expect(result.current).toBe(firstOutput)

  expect(result.current.earlyReset.size).toBe(0)
  expect(result.current.cacheStale).toBe(false)

  const newRowsRef = [
    makeHealthRow({
      provider: 'anthropic',
      model: 'claude-3',
      bucket_start: '2026-01-01T08:00:00Z',
      next_expected_reset_at: '2026-01-01T12:00:00Z',
    }),
    makeHealthRow({
      provider: 'anthropic',
      model: 'claude-3',
      bucket_start: '2026-01-01T09:00:00Z',
      next_expected_reset_at: '2026-01-01T13:00:00Z',
    }),
  ]

  act(() => {
    rerender({ rows: newRowsRef, meta: stableMeta })
  })

  const secondOutput = result.current
  expect(secondOutput).not.toBe(firstOutput)
  expect(secondOutput.earlyReset.size).toBe(0)
  expect(secondOutput.cacheStale).toBe(false)
})

/**
 * P03-F02 / Wave 2: health grouping must include environment so prod-only
 * early-reset sequences do not leak false alerts into staging.
 */
test('test_health_group_key_includes_environment', () => {
  const shared = {
    provider: 'anthropic',
    model: 'claude-sonnet-4',
    quota_keys: 'short',
  } as const

  const prodRows = [
    makeHealthRow({
      ...shared,
      environment: 'prod',
      bucket_start: '2026-06-13T00:00:00Z',
      next_expected_reset_at: '2026-06-13T10:00:00Z',
    }),
    makeHealthRow({
      ...shared,
      environment: 'prod',
      bucket_start: '2026-06-13T01:00:00Z',
      next_expected_reset_at: '2026-06-13T06:00:00Z',
    }),
  ]

  const stagingRows = [
    makeHealthRow({
      ...shared,
      environment: 'staging',
      bucket_start: '2026-06-13T00:00:00Z',
      next_expected_reset_at: '2026-06-13T10:00:00Z',
    }),
    makeHealthRow({
      ...shared,
      environment: 'staging',
      bucket_start: '2026-06-13T01:00:00Z',
      next_expected_reset_at: '2026-06-13T08:00:00Z',
    }),
  ]

  const { result: prodOnly } = renderHook(() =>
    useAnomalyDetection(prodRows, { latestRecordStale: false })
  )
  const { result: stagingOnly } = renderHook(() =>
    useAnomalyDetection(stagingRows, { latestRecordStale: false })
  )
  const { result: combined } = renderHook(() =>
    useAnomalyDetection([...prodRows, ...stagingRows], {
      latestRecordStale: false,
    })
  )

  expect(prodOnly.current.earlyReset.has('anthropic')).toBe(true)
  expect(stagingOnly.current.earlyReset.size).toBe(0)
  expect(combined.current.earlyReset.has('anthropic')).toBe(true)
  expect(combined.current.earlyReset.size).toBe(1)
})
