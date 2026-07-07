/**
 * D1-451 Wave 4 — provider-metrics (C3 headline p95, C4 packet_loss).
 */
import { describe, expect, test } from 'vitest'
import type { UsageReportProviderLatencyHealthRow } from '../api/usage-report'
import { padHealthCells } from './health-cells'
import { buildProviderMetrics } from './provider-metrics'

function healthRow(
  overrides: Partial<UsageReportProviderLatencyHealthRow>
): UsageReportProviderLatencyHealthRow {
  return {
    bucket_start: '2026-05-20T12:00:00.000Z',
    environment: 'production',
    provider: 'openai',
    model: 'gpt-a',
    model_group: 'gpt',
    requests: 10,
    passive_latency_sample_status: 'ok',
    upstream_p50_ms: 100,
    upstream_p95_ms: 200,
    upstream_p99_ms: 300,
    total_p95_ms: 200,
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
    next_expected_reset_at: null,
    quota_keys: null,
    request_period_start: null,
    request_period_end: null,
    ...overrides,
  }
}

describe('D1-451 C3 — headline p95 = newest-bucket max', () => {
  test('test_build_provider_metrics_p95_max_in_newest_bucket_not_first_tuple', () => {
    const newest = '2026-05-20T12:00:00.000Z'
    const older = '2026-05-20T11:55:00.000Z'
    const rows = [
      healthRow({
        bucket_start: newest,
        model: 'tuple-first',
        upstream_p95_ms: 100,
        total_p95_ms: 100,
      }),
      healthRow({
        bucket_start: newest,
        model: 'tuple-second',
        upstream_p95_ms: 900,
        total_p95_ms: 900,
      }),
      healthRow({
        bucket_start: older,
        model: 'old-high',
        upstream_p95_ms: 5000,
        total_p95_ms: 5000,
      }),
    ]

    const metrics = buildProviderMetrics('openai', rows, [])
    const cells = padHealthCells(rows, 'openai')

    expect(metrics.p95_ms).toBe(900)
    const newestCell = cells.at(-1)
    expect(newestCell?.rawP95Ms).toBe(900)
  })
})

describe('D1-451 C4 — packet_loss weighting or documented window', () => {
  test('test_packet_loss_recent_buckets_weighted_not_flat_mean', () => {
    const recent = '2026-05-20T12:00:00.000Z'
    const stale = '2026-05-19T00:00:00.000Z'
    const rows = [
      healthRow({
        bucket_start: recent,
        provider_ping_packet_loss_pct: 80,
        requests: 1,
      }),
      healthRow({
        bucket_start: stale,
        provider_ping_packet_loss_pct: 0,
        requests: 1,
      }),
      healthRow({
        bucket_start: stale,
        model: 'dup-stale',
        provider_ping_packet_loss_pct: 0,
        requests: 1,
      }),
    ]

    const metrics = buildProviderMetrics('openai', rows, [])
    const flatMean = (80 + 0 + 0) / 3
    expect(metrics.packet_loss_pct).not.toBeCloseTo(flatMean, 5)
    expect(metrics.packet_loss_pct).toBeGreaterThan(50)
  })
})
