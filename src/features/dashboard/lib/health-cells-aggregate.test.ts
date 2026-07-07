/**
 * Unit tests for buildAggregateHealthCells bucket normalization (S1-5).
 *
 * Moved from phosphor-dashboard.test.tsx (fork-review E1).
 */
import { describe, test, expect } from 'vitest'
import type {
  UsageReportProviderErrorObservationRow,
  UsageReportProviderLatencyHealthRow,
} from '../api/usage-report'
import { buildAggregateHealthCells } from './health-cells'

// ---------------------------------------------------------------------------
// S1-5: buildAggregateHealthCells — error-event tooltip joins to its health
//        cell even when bucket_start uses a +00:00 offset instead of Z.
// Regression guard: bucketKeyFromIso normalizes +00:00 ↔ Z via new Date().
// ---------------------------------------------------------------------------

describe('S1-5 — health event join normalizes +00:00 offset bucket_start', () => {
  test('test_health_event_join_normalizes_both_sides', () => {
    const bucketIsoPlus = '2026-05-20T10:00:00+00:00'
    const observedAtZ = '2026-05-20T10:02:00.000Z'

    const healthRow: UsageReportProviderLatencyHealthRow = {
      bucket_start: bucketIsoPlus,
      environment: 'production',
      provider: 'openai',
      model: 'gpt-5.5',
      model_group: 'gpt',
      requests: 10,
      passive_latency_sample_status: 'ok',
      upstream_p50_ms: 200,
      upstream_p95_ms: 500,
      upstream_p99_ms: 800,
      total_p95_ms: 500,
      proxy_processing_p95_ms: null,
      missing_upstream_latency: 0,
      provider_error_events: 1,
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
    }

    const observation: UsageReportProviderErrorObservationRow = {
      observed_at: observedAtZ,
      environment: 'production',
      provider: 'openai',
      model: 'gpt-5.5',
      model_group: 'gpt',
      route_family: 'standard',
      status_code: 429,
      error_type: 'rate_limit',
      error_code: 'rate_limit_exceeded',
      error_class: 'rate_limit',
      error_message: 'Rate limit exceeded',
      retry_after_seconds: null,
      expected_reset_at: null,
    }

    const cells = buildAggregateHealthCells([healthRow], [observation])

    const cellWithEvents = cells.find(
      (c) => c.events !== undefined && c.events.length > 0
    )

    expect(cellWithEvents).toBeDefined()
    expect(cellWithEvents!.events![0].errorType).toContain('rate limit')
  })
})
