/**
 * Unit tests for buildProviderQuotaHistoryTabs (moved from phosphor-dashboard.test.tsx, E1).
 */
import { describe, test, expect } from 'vitest'
import type { UsageReportQuotaHistoryRow } from '../api/usage-report'
import {
  ALIBABA_TOKEN_PLAN_5H_CREDITS_KEY,
  ALIBABA_TOKEN_PLAN_7D_CREDITS_KEY,
} from './quota-bars/lane-defs'
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

describe('D1-489 — Alibaba Token Plan quota history tabs', () => {
  test('test_5h_and_7d_history_kept_in_separate_tabs', () => {
    const tabs = buildProviderQuotaHistoryTabs('alibaba_token_plan', [
      makeHistoryRow({
        provider: 'alibaba_token_plan',
        model: null,
        quota_type: 'short',
        quota_key: ALIBABA_TOKEN_PLAN_5H_CREDITS_KEY,
        source: 'alibaba_token_plan_usage',
        expected_reset_at: '2026-07-22T02:22:00Z',
        interval_start: '2026-07-21T21:22:00Z',
        interval_end: '2026-07-22T02:22:00Z',
        usage_tokens: 5,
      }),
      makeHistoryRow({
        provider: 'alibaba_token_plan',
        model: null,
        quota_type: 'weekly',
        quota_key: ALIBABA_TOKEN_PLAN_7D_CREDITS_KEY,
        source: 'alibaba_token_plan_usage',
        expected_reset_at: '2026-07-26T16:26:00Z',
        interval_start: '2026-07-19T16:26:00Z',
        interval_end: '2026-07-26T16:26:00Z',
        usage_tokens: 9,
      }),
    ])

    expect(tabs.map((tab) => tab.tabKey)).toEqual([
      'alibaba_token_plan/5h-credits',
      'alibaba_token_plan/7d-credits',
    ])
    expect(tabs[0].label).toBe('5-hour Credits')
    expect(tabs[1].label).toBe('7-day Credits')
    expect(tabs[0].rows).toHaveLength(1)
    expect(tabs[1].rows).toHaveLength(1)
    expect(tabs[0].rows[0].quota_key).toBe(ALIBABA_TOKEN_PLAN_5H_CREDITS_KEY)
    expect(tabs[1].rows[0].quota_key).toBe(ALIBABA_TOKEN_PLAN_7D_CREDITS_KEY)
  })

  test('test_history_rows_do_not_cross_contaminate_keys', () => {
    const tabs = buildProviderQuotaHistoryTabs('alibaba_token_plan', [
      makeHistoryRow({
        provider: 'alibaba_token_plan',
        quota_type: 'short',
        quota_key: ALIBABA_TOKEN_PLAN_5H_CREDITS_KEY,
        usage_tokens: 5,
      }),
    ])
    const tab7d = tabs.find((t) => t.tabKey === 'alibaba_token_plan/7d-credits')
    expect(tab7d?.rows).toHaveLength(0)
  })

  test('test_two_zero_usage_accounts_same_key_and_reset_remain_distinct', () => {
    const shared = {
      provider: 'alibaba_token_plan',
      model: null,
      quota_type: 'short',
      quota_key: ALIBABA_TOKEN_PLAN_5H_CREDITS_KEY,
      quota_period: '5h',
      source: 'alibaba_token_plan_usage',
      quota_unit: 'credits',
      expected_reset_at: '2026-07-24T21:00:00Z',
      interval_start: '2026-07-24T16:00:00Z',
      interval_end: '2026-07-24T21:00:00Z',
      max_remaining_pct: 100,
      usage_tokens: 0,
      usage_breakdown: [],
    } satisfies Partial<UsageReportQuotaHistoryRow>
    const tabs = buildProviderQuotaHistoryTabs('alibaba_token_plan', [
      makeHistoryRow({
        ...shared,
        account_ref: 'a1b2c3d4',
        min_remaining_pct: 99.96,
      }),
      makeHistoryRow({
        ...shared,
        account_ref: 'e5f6a7b8',
        min_remaining_pct: 88.5,
      }),
    ])

    const rows = tabs.find(
      (tab) => tab.tabKey === 'alibaba_token_plan/5h-credits'
    )?.rows
    expect(rows).toHaveLength(2)
    expect(rows?.map((row) => row.account_ref).sort()).toEqual([
      'a1b2c3d4',
      'e5f6a7b8',
    ])
    expect(rows?.map((row) => row.min_remaining_pct).sort()).toEqual([
      88.5, 99.96,
    ])
    for (const row of rows ?? []) {
      expect(row.provider).toBe('alibaba_token_plan')
      expect(row.quota_key).toBe(ALIBABA_TOKEN_PLAN_5H_CREDITS_KEY)
      expect(row.quota_period).toBe('5h')
      expect(row.source).toBe('alibaba_token_plan_usage')
      expect(row.quota_unit).toBe('credits')
      expect(row.usage_tokens).toBe(0)
      expect(row.usage_breakdown).toEqual([])
    }
  })

  test('test_full_raw_account_hash_history_is_rejected', () => {
    const fullHash = 'a'.repeat(64)
    const tabs = buildProviderQuotaHistoryTabs('alibaba_token_plan', [
      makeHistoryRow({
        provider: 'alibaba_token_plan',
        quota_type: 'short',
        quota_key: ALIBABA_TOKEN_PLAN_5H_CREDITS_KEY,
        quota_period: '5h',
        source: 'alibaba_token_plan_usage',
        account_ref: fullHash,
        min_remaining_pct: 90,
        max_remaining_pct: 100,
        usage_tokens: 0,
        usage_breakdown: [],
      }),
    ])

    const rows = tabs.find(
      (tab) => tab.tabKey === 'alibaba_token_plan/5h-credits'
    )?.rows
    expect(rows).toEqual([])
    expect(JSON.stringify(tabs)).not.toContain(fullHash)
  })
})
