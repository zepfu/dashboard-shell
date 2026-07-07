/**
 * Unit tests for buildProviderQuotaHistoryTabs (moved from phosphor-dashboard.test.tsx, E1).
 */
import { describe, test, expect } from 'vitest'
import type { UsageReportQuotaHistoryRow } from '../api/usage-report'
import { buildProviderQuotaHistoryTabs } from './quota-history-display'

function makeHistoryRow(
  overrides: Partial<UsageReportQuotaHistoryRow> = {}
): UsageReportQuotaHistoryRow {
  return {
    provider: 'anthropic',
    model: null,
    quota_type: 'short',
    expected_reset_at: '2026-05-20T11:00:00Z',
    interval_start: '2026-05-20T06:00:00Z',
    interval_end: '2026-05-20T11:00:00Z',
    min_remaining_pct: 50,
    max_remaining_pct: 100,
    usage_tokens: 200,
    usage_breakdown: [],
    ...overrides,
  }
}

describe('buildProviderQuotaHistoryTabs — xai grok build split', () => {
  test('test_xai_grok_build_history_tabs_keep_weekly_credits_and_monthly_requests_split', () => {
    const tabs = buildProviderQuotaHistoryTabs('xai', [
      makeHistoryRow({
        provider: 'xai',
        model: 'xai_grok_build_weekly_credits:credits',
        quota_type: 'weekly',
        quota_key: 'xai_grok_build_weekly_credits:credits',
        source: 'grok_billing',
        client: 'grok-build',
        quota_unit: 'credits',
        expected_reset_at: '2026-07-01T00:00:00Z',
        interval_start: '2026-06-24T00:00:00Z',
        interval_end: '2026-07-01T00:00:00Z',
        usage_tokens: 10,
      }),
      makeHistoryRow({
        provider: 'xai',
        model: 'xai_grok_build_monthly_requests:requests',
        quota_type: 'monthly',
        quota_key: 'xai_grok_build_monthly_requests:requests',
        source: 'grok_billing',
        client: 'grok-build',
        quota_unit: 'requests',
        expected_reset_at: '2026-07-01T00:00:00Z',
        interval_start: '2026-06-01T00:00:00Z',
        interval_end: '2026-07-01T00:00:00Z',
        usage_tokens: 20,
      }),
    ])

    expect(tabs.map((tab) => tab.tabKey)).toEqual([
      'xai/grok-build-weekly-credits',
      'xai/grok-build-monthly-requests',
    ])
    expect(tabs[0].label).toBe('Grok Build · Weekly credits')
    expect(tabs[0].rows).toHaveLength(1)
    expect(tabs[0].rows[0].quota_key).toBe(
      'xai_grok_build_weekly_credits:credits'
    )
    expect(tabs[0].rows[0].source).toBe('grok_billing')
    expect(tabs[0].rows[0].client).toBe('grok-build')
    expect(tabs[0].rows[0].quota_unit).toBe('credits')
    expect(tabs[1].label).toBe('Grok Build · Monthly requests')
    expect(tabs[1].rows).toHaveLength(1)
    expect(tabs[1].rows[0].quota_key).toBe(
      'xai_grok_build_monthly_requests:requests'
    )
    expect(tabs[1].rows[0].quota_unit).toBe('requests')
  })

  test('test_google_quota_history_tabs_include_antigravity_wtus_detail', () => {
    const tabs = buildProviderQuotaHistoryTabs('google', [
      makeHistoryRow({
        provider: 'antigravity',
        model: 'antigravity_code_assist:gemini_pool',
        quota_type: 'wtus',
        expected_reset_at: '2026-06-05T14:51:55Z',
        interval_start: '2026-06-05T10:52:21Z',
        interval_end: '2026-06-05T14:51:55Z',
        min_remaining_pct: 88,
      }),
      makeHistoryRow({
        provider: 'antigravity',
        model: 'antigravity_code_assist:vertex_pool',
        quota_type: 'wtus',
        expected_reset_at: '2026-06-05T15:52:18Z',
        interval_start: '2026-06-05T10:52:21Z',
        interval_end: '2026-06-05T15:52:18Z',
        min_remaining_pct: 76,
      }),
    ])

    expect(tabs.map((tab) => tab.tabKey)).toContain(
      'google/antigravity-gemini-pool'
    )
    expect(tabs.map((tab) => tab.tabKey)).toContain(
      'google/antigravity-vertex-pool'
    )
    expect(
      tabs.find((tab) => tab.tabKey === 'google/antigravity-gemini-pool')?.rows
    ).toHaveLength(1)
    expect(
      tabs.find((tab) => tab.tabKey === 'google/antigravity-vertex-pool')?.rows
    ).toHaveLength(1)
  })
})
