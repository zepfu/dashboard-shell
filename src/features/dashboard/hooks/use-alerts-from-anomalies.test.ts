import { renderHook } from '@testing-library/react'
import { expect, test } from 'vitest'
import type {
  UsageReportDockerLogErrorRow,
  UsageReportProviderErrorObservationRow,
  UsageReportProviderLatencyHealthRow,
  UsageReportQuotaRow,
} from '../api/usage-report'
import {
  buildDashboardAlertSummary,
  useAlertsFromAnomalies,
} from './use-alerts-from-anomalies'
import type { AnomalyFlags } from './use-anomaly-detection'

const emptyAnomalies: AnomalyFlags = {
  earlyReset: new Map(),
  cacheStale: false,
}

function makeQuotaRow(
  overrides: Partial<UsageReportQuotaRow> = {}
): UsageReportQuotaRow {
  return {
    provider: 'google',
    model: 'gemini-2.5-flash-lite',
    weekly_remaining_pct: null,
    weekly_reset_at: null,
    weekly_interval_start: null,
    weekly_interval_end: null,
    weekly_active: false,
    weekly_usage_tokens: 0,
    weekly_usage_breakdown: [],
    short_remaining_pct: 0,
    short_reset_at: null,
    short_interval_start: null,
    short_interval_end: null,
    short_active: true,
    short_usage_tokens: 0,
    short_usage_breakdown: [],
    special_remaining_pct: null,
    special_reset_at: null,
    special_interval_start: null,
    special_interval_end: null,
    special_active: false,
    special_usage_tokens: 0,
    special_usage_breakdown: [],
    short_special_remaining_pct: null,
    short_special_reset_at: null,
    short_special_interval_start: null,
    short_special_interval_end: null,
    short_special_active: false,
    short_special_usage_tokens: 0,
    short_special_usage_breakdown: [],
    monthly_remaining_pct: null,
    monthly_reset_at: null,
    monthly_interval_start: null,
    monthly_interval_end: null,
    monthly_active: false,
    monthly_usage_tokens: 0,
    monthly_usage_breakdown: [],
    ...overrides,
  }
}

test('buildDashboardAlertSummary omits healthy baseline rows', () => {
  const summary = buildDashboardAlertSummary({
    anomalies: emptyAnomalies,
    now: new Date('2026-05-23T12:00:00.000Z'),
  })

  expect(summary.severity).toBe('ok')
  expect(summary.issues).toEqual([])
})

test('buildDashboardAlertSummary aggregates recent provider errors as red issues', () => {
  const providerErrorObservations: UsageReportProviderErrorObservationRow[] = [
    {
      observed_at: '2026-05-23T11:40:00.000Z',
      environment: 'prod',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      model_group: 'sonnet',
      route_family: 'llm',
      status_code: 529,
      error_type: 'provider_error',
      error_code: 'overloaded',
      error_class: 'provider_error',
      error_message: null,
      retry_after_seconds: null,
      expected_reset_at: null,
    },
    {
      observed_at: '2026-05-23T11:35:00.000Z',
      environment: 'prod',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      model_group: 'sonnet',
      route_family: 'llm',
      status_code: 529,
      error_type: 'provider_error',
      error_code: 'overloaded',
      error_class: 'provider_error',
      error_message: null,
      retry_after_seconds: null,
      expected_reset_at: null,
    },
  ]

  const summary = buildDashboardAlertSummary({
    anomalies: emptyAnomalies,
    providerErrorObservations,
    now: new Date('2026-05-23T12:00:00.000Z'),
  })

  expect(summary.severity).toBe('error')
  expect(summary.issues).toContainEqual({
    severity: 'error',
    head: '2 529 errors from Anthropic',
    sub: 'Observed in the last 90 minutes',
  })
})

test('buildDashboardAlertSummary includes provider and Docker log error messages', () => {
  const providerErrorObservations: UsageReportProviderErrorObservationRow[] = [
    {
      observed_at: '2026-05-23T11:40:00.000Z',
      environment: 'prod',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      model_group: 'sonnet',
      route_family: 'llm',
      status_code: 529,
      error_type: 'provider_error',
      error_code: 'overloaded',
      error_class: 'provider_error',
      error_message: 'Anthropic overloaded_error: Overloaded',
      retry_after_seconds: null,
      expected_reset_at: null,
    },
  ]
  const dockerLogErrors: UsageReportDockerLogErrorRow[] = [
    {
      observed_at: '2026-05-23T11:42:00.000Z',
      container: 'litellm-dev',
      stream: 'stderr',
      provider: 'google',
      status_code: 429,
      level: 'error',
      message: 'Google quota exceeded for requests',
    },
  ]

  const summary = buildDashboardAlertSummary({
    anomalies: emptyAnomalies,
    providerErrorObservations,
    dockerLogErrors,
    now: new Date('2026-05-23T12:00:00.000Z'),
  })

  expect(summary.issues).toContainEqual({
    severity: 'error',
    head: '1 529 error from Anthropic',
    sub: 'Observed in the last 90 minutes · Anthropic overloaded_error: Overloaded',
  })
  expect(summary.issues).toContainEqual({
    severity: 'error',
    head: '1 429 error from Google',
    sub: 'Observed in the last 90 minutes · Google quota exceeded for requests',
  })
})

test('buildDashboardAlertSummary aggregates failed provider pings as red issues', () => {
  const providerLatencyHealth: UsageReportProviderLatencyHealthRow[] = [
    {
      bucket_start: '2026-05-23T11:45:00.000Z',
      environment: 'prod',
      provider: 'nvidia',
      model: 'nvidia/llama',
      model_group: 'llama',
      requests: 0,
      passive_latency_sample_status: 'none',
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
      status_probe_count: 5,
      status_probe_success_pct: 0,
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
      next_expected_reset_at: null,
      quota_keys: null,
      request_period_start: null,
      request_period_end: null,
    },
  ]

  const summary = buildDashboardAlertSummary({
    anomalies: emptyAnomalies,
    providerLatencyHealth,
    now: new Date('2026-05-23T12:00:00.000Z'),
  })

  expect(summary.severity).toBe('error')
  expect(summary.issues[0]?.head).toBe('5 failed ping results from NVIDIA')
})

test('buildDashboardAlertSummary uses descriptive quota lane labels', () => {
  const summary = buildDashboardAlertSummary({
    anomalies: emptyAnomalies,
    quotas: [makeQuotaRow()],
    now: new Date('2026-05-23T12:00:00.000Z'),
  })

  expect(summary.severity).toBe('warning')
  expect(summary.issues[0]?.head).toBe(
    'Google Flash Lite 24h requests exhausted'
  )
})

test('buildDashboardAlertSummary deduplicates quota warnings per display lane', () => {
  const summary = buildDashboardAlertSummary({
    anomalies: emptyAnomalies,
    quotas: [
      makeQuotaRow({
        model: 'gemini-2.5-flash',
        short_remaining_pct: 20,
      }),
      makeQuotaRow({
        model: 'gemini-2.0-flash',
        short_remaining_pct: 0,
      }),
    ],
    now: new Date('2026-05-23T12:00:00.000Z'),
  })

  expect(
    summary.issues.filter((issue) =>
      issue.head.startsWith('Google Flash 24h requests')
    )
  ).toHaveLength(1)
  expect(summary.issues[0]?.head).toBe('Google Flash 24h requests exhausted')
})

// ─────────────────────────────────────────────────────────────────────────────
// Wave 5 / S4-T1 / bugs #46, #48, #49, S4-T10, S4-T11, S4-T12
// ─────────────────────────────────────────────────────────────────────────────

// ── Bug #46: NVIDIA should NOT appear as "healthy" when it has an early reset ─

/**
 * Bug #46: When nvidia_nim has an early-reset anomaly, the always-on healthy
 * alerts loop still emits "NVIDIA: healthy" because it compares
 * `anomalouProviders` using `.toLowerCase()` and the key stored in
 * `earlyReset` may use different casing than 'nvidia' (e.g. 'NVIDIA').
 *
 * The engineer must normalise the earlyReset key lookup.
 *
 * RED until fixed.
 */
test('test_useAlertsFromAnomalies_nvidia_not_healthy_when_anomalous (#46)', () => {
  const anomalies: typeof emptyAnomalies = {
    earlyReset: new Map([
      [
        'nvidia_nim', // canonical key
        {
          prior: '2026-06-13T00:00:00Z',
          current: '2026-06-12T22:00:00Z',
        },
      ],
    ]),
    cacheStale: false,
  }

  const { result } = renderHook(() => useAlertsFromAnomalies(anomalies))

  const alerts = result.current
  // Must NOT contain "NVIDIA: healthy" when nvidia_nim has an anomaly
  const healthyNvidiaAlerts = alerts.filter((a) => a.head === 'NVIDIA: healthy')
  expect(healthyNvidiaAlerts).toHaveLength(0)

  // MUST contain the early-reset alert
  const earlyResetAlerts = alerts.filter((a) => a.type === 'early-reset')
  expect(earlyResetAlerts.length).toBeGreaterThan(0)
})

// ── Bug #48: duplicate "healthy" alerts when same provider key appears twice ─

/**
 * Bug #48: The always-on healthy loop iterates CANONICAL_PROVIDERS. If a
 * provider name appears in CANONICAL_PROVIDERS more than once (or if the
 * anomalouProviders Set misses a variant), duplicate healthy alerts appear.
 *
 * This test asserts each canonical provider name appears at most once as a
 * healthy alert.
 *
 * RED until dedup is enforced.
 */
test('test_dedup_healthy_alerts_no_duplicates (#48)', () => {
  const { result } = renderHook(() => useAlertsFromAnomalies(emptyAnomalies))

  const alerts = result.current
  const healthyAlerts = alerts.filter(
    (a) => typeof a.head === 'string' && a.head.endsWith(': healthy')
  )

  const providerNames = healthyAlerts.map((a) => a.head)
  const uniqueNames = new Set(providerNames)

  // Each healthy alert must be unique
  expect(providerNames).toHaveLength(uniqueNames.size)
})

// ── Bug #49: no always-on "Sync on schedule" filler when there are real alerts ─

/**
 * Bug #49: `useAlertsFromAnomalies` always appends a "Sync on schedule" info
 * alert, even when the alerts list already has substantive content (early-reset,
 * cache-stale, etc.). This constant filler makes every alert list read as
 * non-empty and can mask a missing-alert bug.
 *
 * The engineer must either: (a) drop the always-on filler, or (b) suppress it
 * when there are real alerts. This test asserts option (a): "Sync on schedule"
 * must NOT appear when the anomaly flag is empty AND no summary/quotas.
 *
 * RED until the filler is removed.
 */
test('test_no_always_on_filler_sync_on_schedule (#49)', () => {
  const { result } = renderHook(() => useAlertsFromAnomalies(emptyAnomalies))

  const alerts = result.current
  const fillerAlerts = alerts.filter((a) => a.head === 'Sync on schedule')

  // Must not produce a constant filler alert
  expect(fillerAlerts).toHaveLength(0)
})

// ── S4-T10: probe-failure sums DNS/TCP/TLS failures when status probes ran ─

/**
 * S4-T10: `buildDashboardAlertSummary` currently sums `icmp_failures +
 * dns_failures + tcp_failures + tls_failures` only when `status_probe_count ===
 * 0`. But when status probes DID run and some failed (count > 0, success_pct <
 * 100), the DNS/TCP failures in the same bucket should ALSO be counted.
 *
 * RED until the logic is corrected.
 */
test('test_probe_failure_sums_dns_tcp_when_status_probes_ran (S4-T10)', () => {
  const now = new Date('2026-06-13T12:00:00Z')
  const recentBucket = '2026-06-13T11:30:00Z' // within 90 min

  const providerLatencyHealth: UsageReportProviderLatencyHealthRow[] = [
    {
      provider: 'anthropic',
      model: null,
      bucket_start: recentBucket,
      // Status probes ran — 5 total, 3 succeeded → 2 failures from status
      status_probe_count: 5,
      status_probe_success_pct: 60, // 3/5 success → 2 failures
      status_probe_p95_ms: null,
      upstream_p95_ms: null,
      total_p95_ms: null,
      total_requests: null,
      error_pct: null,
      control_probe_success_pct: null,
      probed_endpoints: null,
      // DNS and TCP also failed in this bucket
      icmp_failures: 0,
      dns_failures: 3,
      tcp_failures: 1,
      tls_failures: 0,
    },
  ]

  const summary = buildDashboardAlertSummary({
    anomalies: emptyAnomalies,
    providerLatencyHealth,
    now,
  })

  // Should flag probe failures; the count includes DNS+TCP when status probes ran
  const pingIssue = summary.issues.find(
    (i) =>
      i.head.toLowerCase().includes('ping') ||
      i.head.toLowerCase().includes('probe') ||
      i.head.toLowerCase().includes('failed')
  )
  expect(pingIssue).toBeDefined()

  // The failure count must be > the status-probe failures alone (2)
  // because DNS (3) + TCP (1) contribute when status probes ran
  const countMatch = pingIssue?.head.match(/^(\d+)/)
  const count =
    countMatch !== null && countMatch !== undefined ? Number(countMatch[1]) : 0
  expect(count).toBeGreaterThan(2)
})

// ── S4-T11: same-day reset includes time in sub text ─

/**
 * S4-T11: When an early-reset anomaly spans two timestamps on the same
 * calendar date, the alert sub-text currently shows "2026-06-13 -> 2026-06-13"
 * which is uninformative. The engineer must include the time component when
 * the dates are the same day.
 *
 * RED until the time-inclusion logic is added.
 */
test('test_same_day_reset_includes_time_in_sub (S4-T11)', () => {
  const anomalies: typeof emptyAnomalies = {
    earlyReset: new Map([
      [
        'anthropic',
        {
          prior: '2026-06-13T10:00:00Z',
          current: '2026-06-13T05:00:00Z', // same date, earlier time
        },
      ],
    ]),
    cacheStale: false,
  }

  const summary = buildDashboardAlertSummary({
    anomalies,
    now: new Date('2026-06-13T12:00:00Z'),
  })

  const resetIssue = summary.issues.find(
    (i) =>
      i.head.toLowerCase().includes('reset') ||
      i.head.toLowerCase().includes('early')
  )
  expect(resetIssue).toBeDefined()

  // The sub text must NOT be just "2026-06-13 -> 2026-06-13" (same day with no time)
  // It must include time information to be useful
  const sub = resetIssue?.sub ?? ''
  // Should contain a time indicator (T, colon, or UTC offset)
  expect(sub).toMatch(/T\d{2}:\d{2}|:\d{2}Z|\d{2}:\d{2}/)
})

// ── S4-T12: 90-min cutoff recomputes on clock tick ─

/**
 * S4-T12: `buildDashboardAlertSummary` accepts a `now` parameter and computes
 * `cutoff = now - 90min`. Two calls with different `now` values must produce
 * different alert sets when observations straddle the boundary.
 *
 * This test confirms the cutoff is not cached/frozen but re-evaluated per
 * call. It's a pure-function test — GREEN for `buildDashboardAlertSummary`
 * today (it already takes `now`), but documents the contract and will go RED
 * if someone removes the `now` parameter.
 */
test('test_90min_cutoff_recomputes_on_clock_tick (S4-T12)', () => {
  const observationAt = '2026-06-13T10:00:00Z'
  const justWithin90 = new Date('2026-06-13T11:29:59Z') // 89 min 59s later
  const justOutside90 = new Date('2026-06-13T11:31:00Z') // 91 min later

  const obs: UsageReportProviderErrorObservationRow[] = [
    {
      provider: 'anthropic',
      model: null,
      observed_at: observationAt,
      status_code: 429,
      error_code: null,
      error_class: null,
      error_message: 'rate limited',
      request_count: 1,
    },
  ]

  const summaryWithin = buildDashboardAlertSummary({
    anomalies: emptyAnomalies,
    providerErrorObservations: obs,
    now: justWithin90,
  })

  const summaryOutside = buildDashboardAlertSummary({
    anomalies: emptyAnomalies,
    providerErrorObservations: obs,
    now: justOutside90,
  })

  // Within 90 min → error issue should appear
  expect(summaryWithin.severity).toBe('error')
  expect(summaryWithin.issues.some((i) => i.severity === 'error')).toBe(true)

  // Outside 90 min → observation is stale, no error issue
  expect(
    summaryOutside.issues.filter((i) => i.severity === 'error')
  ).toHaveLength(0)
})
