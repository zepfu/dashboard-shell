import { renderHook } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type {
  UsageReportDockerLogErrorRow,
  UsageReportProviderErrorObservationRow,
  UsageReportProviderLatencyHealthRow,
  UsageReportQuotaRow,
} from '../api/usage-report'
import { CANONICAL_PROVIDERS } from '../lib/provider-identity'
import {
  buildDashboardAlertSummary,
  useDashboardAlertSummary,
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

function makeLatencyHealthRow(
  overrides: Partial<UsageReportProviderLatencyHealthRow> & {
    bucket_start: string
    provider: string
    model: string
  }
): UsageReportProviderLatencyHealthRow {
  return {
    environment: 'prod',
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
    status_probe_count: 0,
    status_probe_success_pct: null,
    status_probe_p95_ms: null,
    provider_ping_avg_ms: null,
    provider_ping_packet_loss_pct: null,
    control_ping_avg_ms: null,
    control_packet_loss_pct: null,
    control_probe_success_pct: null,
    provider_ping_minus_control_ms: null,
    probed_endpoints: null,
    status_error_classes: null,
    min_remaining_pct: null,
    max_remaining_pct: null,
    next_expected_reset_at: null,
    quota_keys: null,
    request_period_start: null,
    request_period_end: null,
    icmp_failures: 0,
    dns_failures: 0,
    tcp_failures: 0,
    tls_failures: 0,
    ...overrides,
  }
}

describe('D1-450 live dashboard alert summary exports (W2)', () => {
  test('buildDashboardAlertSummary and useDashboardAlertSummary remain wired for production', () => {
    expect(typeof buildDashboardAlertSummary).toBe('function')
    expect(typeof useDashboardAlertSummary).toBe('function')
    expect(CANONICAL_PROVIDERS.length).toBeGreaterThan(0)
  })

  test('useDashboardAlertSummary memoizes when now is unchanged across rerenders', () => {
    const fixedNow = new Date('2026-06-13T12:00:00.000Z')
    const { result, rerender } = renderHook(
      ({ now }: { now: Date }) =>
        useDashboardAlertSummary(
          emptyAnomalies,
          undefined,
          undefined,
          [],
          [],
          [],
          now
        ),
      { initialProps: { now: fixedNow } }
    )
    const first = result.current
    rerender({ now: fixedNow })
    expect(result.current).toBe(first)
  })
})

/** P03-F03 / Wave 2: invalid success_pct must not emit a zero-failure ping error. */
test('test_no_zero_failed_ping_alert_on_bad_success_pct', () => {
  const now = new Date('2026-06-13T12:00:00Z')
  const summary = buildDashboardAlertSummary({
    anomalies: emptyAnomalies,
    providerLatencyHealth: [
      makeLatencyHealthRow({
        bucket_start: '2026-06-13T11:45:00Z',
        provider: 'anthropic',
        model: 'claude',
        status_probe_count: 10,
        status_probe_success_pct: 150,
      }),
    ],
    now,
  })
  const pingIssues = summary.issues.filter((i) =>
    i.head.includes('failed ping')
  )
  expect(pingIssues).toHaveLength(0)
})

/** P03-F04 / Wave 2: wtus-only active lane at 100% used raises a quota alert. */
test('test_wtus_lane_raises_quota_alert', () => {
  const row = makeQuotaRow({
    provider: 'anthropic',
    model: 'claude-sonnet-4',
    short_active: false,
    weekly_active: false,
    special_active: false,
    short_special_active: false,
    monthly_active: false,
    wtus_active: true,
    wtus_remaining_pct: 0,
  })

  const summary = buildDashboardAlertSummary({
    anomalies: emptyAnomalies,
    quotas: [row],
    now: new Date('2026-05-23T12:00:00.000Z'),
  })

  expect(summary.severity).toBe('warning')
  expect(
    summary.issues.some(
      (issue) =>
        issue.severity === 'warning' &&
        issue.head.toLowerCase().includes('anthropic') &&
        (issue.head.includes('exhausted') || issue.head.includes('100%'))
    )
  ).toBe(true)
})

test('test_probe_failure_sums_dns_tcp_when_status_probes_ran (S4-T10)', () => {
  const now = new Date('2026-06-13T12:00:00Z')
  const summary = buildDashboardAlertSummary({
    anomalies: emptyAnomalies,
    providerLatencyHealth: [
      makeLatencyHealthRow({
        bucket_start: '2026-06-13T11:30:00Z',
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        status_probe_count: 5,
        status_probe_success_pct: 60,
        dns_failures: 3,
        tcp_failures: 1,
      }),
    ],
    now,
  })
  const pingIssue = summary.issues.find((i) => i.head.includes('failed ping'))
  expect(pingIssue).toBeDefined()
  expect(Number(pingIssue?.head.match(/^(\d+)/)?.[1] ?? 0)).toBeGreaterThan(2)
})

test('test_same_day_reset_includes_time_in_sub (S4-T11)', () => {
  const summary = buildDashboardAlertSummary({
    anomalies: {
      earlyReset: new Map([
        [
          'anthropic',
          {
            prior: '2026-06-13T10:00:00Z',
            current: '2026-06-13T05:00:00Z',
          },
        ],
      ]),
      cacheStale: false,
    },
    now: new Date('2026-06-13T12:00:00Z'),
  })
  const resetIssue = summary.issues.find((i) =>
    i.head.toLowerCase().includes('early reset')
  )
  expect(resetIssue?.sub ?? '').toMatch(/T\d{2}:\d{2}|:\d{2}Z|\d{2}:\d{2}/)
})

test('test_90min_cutoff_recomputes_on_clock_tick (S4-T12)', () => {
  const obs: UsageReportProviderErrorObservationRow[] = [
    {
      observed_at: '2026-06-13T10:00:00Z',
      environment: 'prod',
      provider: 'anthropic',
      model: 'claude',
      model_group: 'sonnet',
      route_family: 'llm',
      status_code: 429,
      error_type: 'rate_limit',
      error_code: 'rate_limit',
      error_class: 'rate_limit',
      error_message: 'rate limited',
      retry_after_seconds: null,
      expected_reset_at: null,
    },
  ]
  const within = buildDashboardAlertSummary({
    anomalies: emptyAnomalies,
    providerErrorObservations: obs,
    now: new Date('2026-06-13T11:29:59Z'),
  })
  const outside = buildDashboardAlertSummary({
    anomalies: emptyAnomalies,
    providerErrorObservations: obs,
    now: new Date('2026-06-13T11:31:00Z'),
  })
  expect(within.severity).toBe('error')
  expect(outside.issues.filter((i) => i.severity === 'error')).toHaveLength(0)
})
