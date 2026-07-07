/**
 * D1-451 Wave 4 — health-cells.ts (C5, P2, G1, A2, I5, E2).
 */
import { describe, expect, test } from 'vitest'
import type { UsageReportProviderLatencyHealthRow } from '../api/usage-report'
import { TOTAL_CELLS, BUCKET_MS } from '../components/primitives/health-strip'
import {
  HEALTH_BUCKET_MS,
  HEALTH_CELL_COUNT,
  padHealthCells,
} from './health-cells'

function makeHealthRow(
  overrides: Partial<UsageReportProviderLatencyHealthRow> = {}
): UsageReportProviderLatencyHealthRow {
  return {
    bucket_start: '2026-05-20T10:00:00.000Z',
    environment: 'production',
    provider: 'openai',
    model: 'gpt-5',
    model_group: 'gpt',
    requests: 1,
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
    status_probe_count: 1,
    status_probe_success_pct: 100,
    status_probe_p95_ms: null,
    provider_ping_avg_ms: null,
    provider_ping_packet_loss_pct: null,
    control_ping_avg_ms: null,
    control_packet_loss_pct: null,
    control_probe_success_pct: 100,
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

describe('D1-451 health-cells — C5 alias symmetry', () => {
  test('test_padHealthCells_xai_slash_provider_includes_health_row', () => {
    const bucket = '2026-05-20T10:00:00.000Z'
    const healthRow = makeHealthRow({
      bucket_start: bucket,
      provider: 'xai/grok-2',
      upstream_p95_ms: 400,
      status_probe_count: 0,
      status_probe_success_pct: null,
      control_probe_success_pct: null,
    })
    const cells = padHealthCells([healthRow], 'xai', [])
    const withP95 = cells.find((c) => c.rawP95Ms === 400)
    expect(withP95).toBeDefined()
  })
})

describe('D1-451 health-cells — G1 control-path orange', () => {
  test('test_padHealthCells_control_degradation_marks_orange_with_breakdown', () => {
    const bucket = '2026-05-20T10:00:00.000Z'
    const row = makeHealthRow({
      bucket_start: bucket,
      control_probe_success_pct: 50,
      status_probe_success_pct: 100,
      status_probe_count: 1,
    })
    const cells = padHealthCells([row], 'openai', [])
    const degraded = cells.find(
      (c) =>
        c.category === 'orange' &&
        (c.rawDegradedBreakdown?.control_probe_degraded ?? 0) > 0
    )
    expect(degraded).toBeDefined()
  })
})

describe('D1-451 health-cells — A2 single classification (threshold dedup)', () => {
  test('test_padHealthCells_category_matches_degraded_counters_for_control_loss', () => {
    const bucket = '2026-05-20T10:00:00.000Z'
    const row = makeHealthRow({
      bucket_start: bucket,
      control_packet_loss_pct: 5,
      status_probe_count: 1,
      status_probe_success_pct: 100,
      control_probe_success_pct: 100,
    })
    const cells = padHealthCells([row], 'openai', [])
    const cell = cells.find((c) => c.category === 'orange')
    expect(cell).toBeDefined()
    expect(cell!.rawDegradedBreakdown?.control_packet_loss).toBeGreaterThan(0)
  })
})

describe('D1-451 health-cells — I5 strip constant alignment', () => {
  test('test_health_cell_count_matches_health_strip_total_cells', () => {
    expect(HEALTH_CELL_COUNT).toBe(TOTAL_CELLS)
  })

  test('test_health_bucket_ms_matches_health_strip_bucket_ms', () => {
    expect(HEALTH_BUCKET_MS).toBe(BUCKET_MS)
  })
})

describe('D1-451 health-cells — P2 pad comment / behavior', () => {
  test('test_padHealthCells_source_comment_does_not_claim_strip_noops_at_288', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const source = fs.readFileSync(
      path.resolve('src/features/dashboard/lib/health-cells.ts'),
      'utf8'
    )
    expect(source).not.toMatch(/no-ops when length is already 288/i)
  })
})

describe('D1-451 health-cells — E2 bucketKeyFromIso no-op removed', () => {
  test('test_bucketKeyFromIso_no_identity_replace_dot000Z', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const source = fs.readFileSync(
      path.resolve('src/features/dashboard/lib/health-cells.ts'),
      'utf8'
    )
    expect(source).not.toContain(".replace('.000Z', '.000Z')")
  })
})
