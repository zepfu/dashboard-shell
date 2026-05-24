import type {
  UsageReportProviderErrorObservationRow,
  UsageReportProviderLatencyHealthRow,
  UsageReportQuotaRow,
} from '../api/usage-report'
import { buildDashboardAlertSummary } from './use-alerts-from-anomalies'
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
