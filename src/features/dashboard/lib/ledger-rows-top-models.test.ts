/**
 * Unit tests for buildTopModels latency fallback (S1-11).
 *
 * Moved from phosphor-dashboard.test.tsx (fork-review E1).
 */
import { describe, test, expect } from 'vitest'
import type { UsageReportProviderLatencyHealthRow } from '../api/usage-report'
import { buildTopModels } from './ledger-rows'

describe('S1-11 — buildTopModels falls back to total_p95_ms', () => {
  test('test_buildTopModels_falls_back_to_total_p95_ms', () => {
    const statusRows = [
      {
        provider: 'local',
        model: 'local-llama-3.3',
        traces: 20,
        token_total: 5000,
        usd_cost: 0.0,
      },
    ]
    const healthRows: UsageReportProviderLatencyHealthRow[] = [
      {
        bucket_start: '2026-05-18T23:00:00.000Z',
        environment: 'production',
        provider: 'local',
        model: 'local-llama-3.3',
        model_group: 'local',
        requests: 20,
        passive_latency_sample_status: 'ok',
        upstream_p50_ms: null,
        upstream_p95_ms: null,
        upstream_p99_ms: null,
        total_p95_ms: 150,
        proxy_processing_p95_ms: null,
        missing_upstream_latency: 20,
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
      },
    ]

    const top = buildTopModels(statusRows, 'local', healthRows)

    expect(top).toHaveLength(1)
    expect(top[0]?.model).toBe('local-llama-3.3')
    expect(top[0]?.p95_ms).toBe(150)
    expect(top[0]?.p95_ms).not.toBeNull()
  })
})
