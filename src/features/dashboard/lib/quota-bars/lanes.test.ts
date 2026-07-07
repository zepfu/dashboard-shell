/**
 * D1-450 Wave 1 — quota-bars/lanes behavioral contract (C5, C7, E3).
 */
import { describe, expect, test } from 'vitest'
import type {
  UsageReportQuotaHistoryRow,
  UsageReportQuotaRow,
} from '../../api/usage-report'
import { buildProviderLanes } from './lanes'

function minimalQuotaRow(
  overrides: Partial<UsageReportQuotaRow> = {}
): UsageReportQuotaRow {
  return {
    provider: 'anthropic',
    model: 'claude-sonnet-4',
    weekly_remaining_pct: null,
    weekly_reset_at: null,
    weekly_interval_start: null,
    weekly_interval_end: null,
    weekly_active: false,
    weekly_usage_tokens: 0,
    weekly_usage_breakdown: [],
    short_remaining_pct: 50,
    short_reset_at: '2026-06-13T12:00:00.000Z',
    short_interval_start: '2026-06-13T07:00:00.000Z',
    short_interval_end: '2026-06-13T12:00:00.000Z',
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

function historyRow(
  overrides: Partial<UsageReportQuotaHistoryRow>
): UsageReportQuotaHistoryRow {
  return {
    provider: 'anthropic',
    model: 'claude-sonnet-4',
    quota_type: 'short',
    expected_reset_at: '2026-06-12T12:00:00.000Z',
    interval_start: '2026-06-12T07:00:00.000Z',
    interval_end: '2026-06-12T12:00:00.000Z',
    min_remaining_pct: 10,
    max_remaining_pct: 100,
    usage_tokens: 0,
    usage_breakdown: [],
    ...overrides,
  }
}

describe('buildProviderLanes (D1-450 C5)', () => {
  test('malformed expected_reset_at does not throw when building prior bars', () => {
    expect(() =>
      buildProviderLanes(
        'anthropic',
        [minimalQuotaRow()],
        [
          historyRow({
            expected_reset_at: 'not-a-valid-iso-date',
            min_remaining_pct: 5,
          }),
        ]
      )
    ).not.toThrow()
  })
})

describe('buildProviderLanes (D1-450 C7)', () => {
  test('null-reset history rows with pct use stable dedup keys regardless of row order', () => {
    const rowA = historyRow({
      expected_reset_at: null,
      interval_start: '2026-06-10T07:00:00.000Z',
      min_remaining_pct: 20,
    })
    const rowB = historyRow({
      expected_reset_at: null,
      interval_start: '2026-06-11T07:00:00.000Z',
      min_remaining_pct: 15,
    })

    const lanesForward = buildProviderLanes(
      'anthropic',
      [minimalQuotaRow()],
      [rowA, rowB]
    )
    const lanesReverse = buildProviderLanes(
      'anthropic',
      [minimalQuotaRow()],
      [rowB, rowA]
    )

    const priorCountForward = lanesForward[0]?.priorBars.length ?? 0
    const priorCountReverse = lanesReverse[0]?.priorBars.length ?? 0

    expect(priorCountForward).toBe(2)
    expect(priorCountReverse).toBe(2)
  })
})
