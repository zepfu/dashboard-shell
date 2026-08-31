/**
 * Unit tests for buildProviderQuotaHistoryTabs (moved from phosphor-dashboard.test.tsx, E1).
 */
import { describe, test, expect } from 'vitest'
import type { UsageReportQuotaHistoryRow } from '../api/usage-report'
import {
  ALIBABA_TOKEN_PLAN_5H_CREDITS_KEY,
  ALIBABA_TOKEN_PLAN_7D_CREDITS_KEY,
  CURSOR_AGENT_MONTHLY_CENTS_KEY,
  KIMI_CODE_5H_QUOTA_UNITS_KEY,
  KIMI_CODE_7D_QUOTA_UNITS_KEY,
  ZAI_CODING_PLAN_5H_COUNT_KEY,
  ZAI_CODING_PLAN_5H_CREDITS_KEY,
  ZAI_CODING_PLAN_5H_PERCENT_KEY,
  ZAI_CODING_PLAN_7D_COUNT_KEY,
  ZAI_CODING_PLAN_7D_CREDITS_KEY,
  ZAI_CODING_PLAN_7D_PERCENT_KEY,
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
  test('test_openai_history_keeps_short_special_but_hides_regular_short', () => {
    const tabs = buildProviderQuotaHistoryTabs('openai', [
      makeHistoryRow({
        provider: 'openai',
        quota_type: 'short',
        expected_reset_at: '2026-07-24T17:22:00Z',
        interval_start: '2026-07-24T12:22:00Z',
        interval_end: '2026-07-24T17:22:00Z',
      }),
      makeHistoryRow({
        provider: 'openai',
        quota_type: 'short_special',
        expected_reset_at: '2026-07-24T17:22:00Z',
        interval_start: '2026-07-24T12:22:00Z',
        interval_end: '2026-07-24T17:22:00Z',
      }),
    ])

    expect(tabs.some((tab) => tab.tabKey === 'openai/short')).toBe(false)
    expect(
      tabs.find((tab) => tab.tabKey === 'openai/short_special')?.rows
    ).toHaveLength(1)
  })

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

  test('test_openai_spark_history_keeps_legacy_bengalfox_keys', () => {
    const tabs = buildProviderQuotaHistoryTabs('openai', [
      makeHistoryRow({
        provider: 'openai',
        quota_type: 'short_special',
        quota_key: 'codex_bengalfox:primary',
        expected_reset_at: '2026-07-24T17:22:00Z',
        interval_start: '2026-07-24T12:22:00Z',
        interval_end: '2026-07-24T17:22:00Z',
      }),
      makeHistoryRow({
        provider: 'openai',
        quota_type: 'special',
        quota_key: 'codex_bengalfox:secondary',
        expected_reset_at: '2026-07-24T17:22:00Z',
        interval_start: '2026-07-17T17:22:00Z',
        interval_end: '2026-07-24T17:22:00Z',
      }),
    ])

    expect(tabs.map((tab) => tab.tabKey)).toEqual([
      'openai/short_special',
      'openai/weekly',
      'openai/special',
    ])
    expect(
      tabs.find((tab) => tab.tabKey === 'openai/short_special')?.rows[0]
        ?.quota_key
    ).toBe('codex_bengalfox:primary')
    expect(
      tabs.find((tab) => tab.tabKey === 'openai/special')?.rows[0]?.quota_key
    ).toBe('codex_bengalfox:secondary')
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

  test.each([
    { source: 'alibaba_token_plan_usage' },
    { quota_unit: 'credits' },
    { quota_period: '7d' },
    { client: 'qwen-cloud-console' },
    { client: null },
    { quota_key: ALIBABA_TOKEN_PLAN_5H_CREDITS_KEY },
  ])('test_history_rejects_kimi_contract_mismatch', (override) => {
    const tabs = buildProviderQuotaHistoryTabs('kimi_code', [
      makeHistoryRow({
        provider: 'kimi_code',
        quota_type: 'short',
        quota_key: KIMI_CODE_5H_QUOTA_UNITS_KEY,
        quota_period: '5h',
        source: 'kimi_code_usage',
        client: 'kimi-code',
        quota_unit: 'quota_units',
        min_remaining_pct: 90,
        max_remaining_pct: 100,
        usage_tokens: 0,
        usage_breakdown: [],
        ...override,
      }),
    ])

    expect(
      tabs.find((tab) => tab.tabKey === 'kimi_code/5h-quota-units')?.rows
    ).toHaveLength(0)
  })

  test('test_mixed_legacy_and_current_history_refs_aggregate_under_12_hex_identity', () => {
    const shared = {
      provider: 'kimi_code',
      model: null,
      quota_type: 'short',
      quota_key: KIMI_CODE_5H_QUOTA_UNITS_KEY,
      quota_period: '5h',
      source: 'kimi_code_usage',
      client: 'kimi-code',
      quota_unit: 'quota_units',
      expected_reset_at: '2026-07-24T17:22:00Z',
      interval_start: '2026-07-24T12:22:00Z',
      interval_end: '2026-07-24T17:22:00Z',
      max_remaining_pct: 100,
      usage_tokens: 0,
      usage_breakdown: [],
    } satisfies Partial<UsageReportQuotaHistoryRow>
    const tabs = buildProviderQuotaHistoryTabs('kimi_code', [
      makeHistoryRow({
        ...shared,
        account_ref: '119f6a46',
        min_remaining_pct: 90,
      }),
      makeHistoryRow({
        ...shared,
        account_ref: '119f6a46bf29',
        min_remaining_pct: 80,
      }),
    ])

    const rows = tabs.find(
      (tab) => tab.tabKey === 'kimi_code/5h-quota-units'
    )?.rows
    expect(rows).toHaveLength(1)
    expect(rows?.[0].account_ref).toBe('119f6a46bf29')
    expect(rows?.[0].min_remaining_pct).toBe(80)
  })

  test('test_cross_window_legacy_prefix_is_not_promoted_or_collapsed', () => {
    const common = {
      provider: 'kimi_code',
      model: null,
      source: 'kimi_code_usage',
      client: 'kimi-code',
      quota_unit: 'quota_units',
      max_remaining_pct: 100,
      usage_tokens: 0,
      usage_breakdown: [],
    } satisfies Partial<UsageReportQuotaHistoryRow>
    const tabs = buildProviderQuotaHistoryTabs('kimi_code', [
      makeHistoryRow({
        ...common,
        account_ref: '119f6a46',
        quota_type: 'short',
        quota_key: KIMI_CODE_5H_QUOTA_UNITS_KEY,
        quota_period: '5h',
        expected_reset_at: '2026-07-24T17:22:00Z',
        interval_start: '2026-07-24T12:22:00Z',
        interval_end: '2026-07-24T17:22:00Z',
        min_remaining_pct: 90,
      }),
      makeHistoryRow({
        ...common,
        account_ref: '119f6a46bf29',
        quota_type: 'short',
        quota_key: KIMI_CODE_5H_QUOTA_UNITS_KEY,
        quota_period: '5h',
        expected_reset_at: '2026-07-24T17:22:00Z',
        interval_start: '2026-07-24T12:22:00Z',
        interval_end: '2026-07-24T17:22:00Z',
        min_remaining_pct: 80,
      }),
      makeHistoryRow({
        ...common,
        account_ref: '119f6a46',
        quota_type: 'weekly',
        quota_key: KIMI_CODE_7D_QUOTA_UNITS_KEY,
        quota_period: '7d',
        expected_reset_at: '2026-07-29T16:26:00Z',
        interval_start: '2026-07-22T16:26:00Z',
        interval_end: '2026-07-29T16:26:00Z',
        min_remaining_pct: 70,
      }),
      makeHistoryRow({
        ...common,
        account_ref: '119f6a46abcd',
        quota_type: 'weekly',
        quota_key: KIMI_CODE_7D_QUOTA_UNITS_KEY,
        quota_period: '7d',
        expected_reset_at: '2026-07-29T16:26:00Z',
        interval_start: '2026-07-22T16:26:00Z',
        interval_end: '2026-07-29T16:26:00Z',
        min_remaining_pct: 60,
      }),
    ])

    const rows5h = tabs.find(
      (tab) => tab.tabKey === 'kimi_code/5h-quota-units'
    )?.rows
    const rows7d = tabs.find(
      (tab) => tab.tabKey === 'kimi_code/7d-quota-units'
    )?.rows

    expect(rows5h).toHaveLength(2)
    expect(rows7d).toHaveLength(2)
    expect(rows5h?.map((row) => row.account_ref).sort()).toEqual([
      '119f6a46bf29',
      null,
    ])
    expect(rows7d?.map((row) => row.account_ref).sort()).toEqual([
      '119f6a46abcd',
      null,
    ])
    expect(rows5h?.map((row) => row.min_remaining_pct).sort()).toEqual([80, 90])
    expect(rows7d?.map((row) => row.min_remaining_pct).sort()).toEqual([60, 70])
  })

  test('test_two_missing_history_refs_at_same_reset_do_not_merge', () => {
    const shared = {
      provider: 'kimi_code',
      model: null,
      quota_type: 'short',
      quota_key: KIMI_CODE_5H_QUOTA_UNITS_KEY,
      quota_period: '5h',
      source: 'kimi_code_usage',
      client: 'kimi-code',
      quota_unit: 'quota_units',
      expected_reset_at: '2026-07-24T17:22:00Z',
      interval_start: '2026-07-24T12:22:00Z',
      interval_end: '2026-07-24T17:22:00Z',
      max_remaining_pct: 100,
      usage_tokens: 0,
      usage_breakdown: [],
    } satisfies Partial<UsageReportQuotaHistoryRow>
    const tabs = buildProviderQuotaHistoryTabs('kimi_code', [
      makeHistoryRow({
        ...shared,
        account_ref: null,
        min_remaining_pct: 90,
      }),
      makeHistoryRow({
        ...shared,
        account_ref: null,
        min_remaining_pct: 80,
      }),
    ])

    const rows = tabs.find(
      (tab) => tab.tabKey === 'kimi_code/5h-quota-units'
    )?.rows
    expect(rows).toHaveLength(2)
    expect(rows?.map((row) => row.min_remaining_pct).sort()).toEqual([80, 90])
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

  test('test_two_missing_alibaba_history_refs_same_reset_remain_distinct', () => {
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
        account_ref: null,
        min_remaining_pct: 90,
      }),
      makeHistoryRow({
        ...shared,
        account_ref: null,
        min_remaining_pct: 80,
      }),
    ])

    const rows = tabs.find(
      (tab) => tab.tabKey === 'alibaba_token_plan/5h-credits'
    )?.rows
    expect(rows).toHaveLength(2)
    expect(rows?.map((row) => row.min_remaining_pct).sort()).toEqual([80, 90])
  })

  test('test_full_raw_account_hash_history_is_retained_as_null_without_leakage', () => {
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
    expect(rows).toHaveLength(1)
    expect(rows?.[0].account_ref).toBeNull()
    expect(JSON.stringify(tabs)).not.toContain(fullHash)
  })
})

describe('D1-492 — Kimi Code quota history tabs', () => {
  test('test_5h_and_7d_history_kept_in_separate_tabs', () => {
    const tabs = buildProviderQuotaHistoryTabs('kimi_code', [
      makeHistoryRow({
        provider: 'kimi_code',
        model: null,
        quota_type: 'short',
        quota_key: KIMI_CODE_5H_QUOTA_UNITS_KEY,
        quota_period: '5h',
        source: 'kimi_code_usage',
        account_ref: '119f6a46bf29',
        client: 'kimi-code',
        quota_unit: 'quota_units',
        quota_limit: 100,
        quota_used: 20,
        quota_remaining: 80,
        expected_reset_at: '2026-07-24T17:22:00Z',
        interval_start: '2026-07-24T12:22:00Z',
        interval_end: '2026-07-24T17:22:00Z',
        usage_tokens: 5,
      }),
      makeHistoryRow({
        provider: 'kimi_code',
        model: null,
        quota_type: 'weekly',
        quota_key: KIMI_CODE_7D_QUOTA_UNITS_KEY,
        quota_period: '7d',
        source: 'kimi_code_usage',
        account_ref: '119f6a46bf29',
        client: 'kimi-code',
        quota_unit: 'quota_units',
        quota_limit: 100,
        quota_used: 30,
        quota_remaining: 70,
        expected_reset_at: '2026-07-29T16:26:00Z',
        interval_start: '2026-07-22T16:26:00Z',
        interval_end: '2026-07-29T16:26:00Z',
        usage_tokens: 9,
      }),
    ])

    expect(tabs.map((tab) => tab.tabKey)).toEqual([
      'kimi_code/5h-quota-units',
      'kimi_code/7d-quota-units',
    ])
    expect(tabs[0].label).toBe('5-hour Quota Units')
    expect(tabs[1].label).toBe('7-day Quota Units')
    expect(tabs[0].rows).toHaveLength(1)
    expect(tabs[1].rows).toHaveLength(1)
    expect(tabs[0].rows[0].quota_key).toBe(KIMI_CODE_5H_QUOTA_UNITS_KEY)
    expect(tabs[1].rows[0].quota_key).toBe(KIMI_CODE_7D_QUOTA_UNITS_KEY)
    expect(tabs[0].rows[0].account_ref).toBe('119f6a46bf29')
    expect(tabs[1].rows[0].account_ref).toBe('119f6a46bf29')
    expect(tabs[0].rows[0]).toMatchObject({
      quota_limit: 100,
      quota_used: 20,
      quota_remaining: 80,
      quota_unit: 'quota_units',
    })
  })

  test('test_history_rows_do_not_cross_contaminate_keys', () => {
    const tabs = buildProviderQuotaHistoryTabs('kimi_code', [
      makeHistoryRow({
        provider: 'kimi_code',
        quota_type: 'short',
        quota_key: KIMI_CODE_5H_QUOTA_UNITS_KEY,
        quota_period: '5h',
        source: 'kimi_code_usage',
        client: 'kimi-code',
        quota_unit: 'quota_units',
        usage_tokens: 5,
      }),
    ])
    const tab7d = tabs.find((t) => t.tabKey === 'kimi_code/7d-quota-units')
    expect(tab7d?.rows).toHaveLength(0)
  })

  test('test_zero_usage_pct_rows_still_surface_for_quota_units_lanes', () => {
    const tabs = buildProviderQuotaHistoryTabs('kimi_code', [
      makeHistoryRow({
        provider: 'kimi_code',
        model: null,
        quota_type: 'short',
        quota_key: KIMI_CODE_5H_QUOTA_UNITS_KEY,
        quota_period: '5h',
        source: 'kimi_code_usage',
        client: 'kimi-code',
        quota_unit: 'quota_units',
        min_remaining_pct: 99.96,
        max_remaining_pct: 100,
        usage_tokens: 0,
        usage_breakdown: [],
      }),
    ])
    const rows = tabs.find(
      (tab) => tab.tabKey === 'kimi_code/5h-quota-units'
    )?.rows
    expect(rows).toHaveLength(1)
    expect(rows?.[0].min_remaining_pct).toBe(99.96)
  })

  test('test_full_raw_account_hash_history_is_retained_as_null_without_leakage', () => {
    const fullHash = 'c'.repeat(64)
    const tabs = buildProviderQuotaHistoryTabs('kimi_code', [
      makeHistoryRow({
        provider: 'kimi_code',
        quota_type: 'short',
        quota_key: KIMI_CODE_5H_QUOTA_UNITS_KEY,
        quota_period: '5h',
        source: 'kimi_code_usage',
        account_ref: fullHash,
        client: 'kimi-code',
        quota_unit: 'quota_units',
        min_remaining_pct: 90,
        max_remaining_pct: 100,
        usage_tokens: 0,
        usage_breakdown: [],
      }),
    ])

    const rows = tabs.find(
      (tab) => tab.tabKey === 'kimi_code/5h-quota-units'
    )?.rows
    expect(rows).toHaveLength(1)
    expect(rows?.[0].account_ref).toBeNull()
    expect(JSON.stringify(tabs)).not.toContain(fullHash)
  })

  test('test_distinct_rejected_account_refs_do_not_collapse_history_rows', () => {
    const firstHash = 'c'.repeat(64)
    const secondHash = 'd'.repeat(64)
    const tabs = buildProviderQuotaHistoryTabs('kimi_code', [
      makeHistoryRow({
        provider: 'kimi_code',
        quota_type: 'short',
        quota_key: KIMI_CODE_5H_QUOTA_UNITS_KEY,
        quota_period: '5h',
        source: 'kimi_code_usage',
        account_ref: firstHash,
        client: 'kimi-code',
        quota_unit: 'quota_units',
        min_remaining_pct: 90,
        max_remaining_pct: 100,
        usage_tokens: 0,
        usage_breakdown: [],
      }),
      makeHistoryRow({
        provider: 'kimi_code',
        quota_type: 'short',
        quota_key: KIMI_CODE_5H_QUOTA_UNITS_KEY,
        quota_period: '5h',
        source: 'kimi_code_usage',
        account_ref: secondHash,
        client: 'kimi-code',
        quota_unit: 'quota_units',
        min_remaining_pct: 80,
        max_remaining_pct: 100,
        usage_tokens: 0,
        usage_breakdown: [],
      }),
    ])

    const rows = tabs.find(
      (tab) => tab.tabKey === 'kimi_code/5h-quota-units'
    )?.rows
    expect(rows).toHaveLength(2)
    expect(rows?.every((row) => row.account_ref === null)).toBe(true)
    expect(rows?.map((row) => row.min_remaining_pct).sort()).toEqual([80, 90])
    expect(JSON.stringify(tabs)).not.toContain(firstHash)
    expect(JSON.stringify(tabs)).not.toContain(secondHash)
  })
})

describe('D1-496 — current provider quota history tabs', () => {
  function zaiHistoryRow(
    quotaKey: string,
    quotaPeriod: '5h' | '7d',
    quotaUnit: 'credits' | 'percent' | 'count',
    overrides: Partial<UsageReportQuotaHistoryRow> = {}
  ): UsageReportQuotaHistoryRow {
    const quotaType = quotaPeriod === '5h' ? 'short' : 'weekly'
    return makeHistoryRow({
      provider: 'zai_coding_plan',
      model: 'zai-coding-plan',
      quota_type: quotaType,
      quota_key: quotaKey,
      quota_period: quotaPeriod,
      source: 'zai_coding_plan_quota_poll',
      client: 'zai-coding-plan',
      quota_unit: quotaUnit,
      quota_limit: quotaUnit === 'percent' ? null : 100,
      quota_used: quotaUnit === 'percent' ? null : 20,
      quota_remaining: quotaUnit === 'percent' ? null : 80,
      min_remaining_pct: quotaUnit === 'percent' ? 55 : 80,
      max_remaining_pct: 100,
      usage_tokens: 0,
      ...overrides,
    })
  }

  test('test_cursor_monthly_cents_history_preserves_contract_and_absolutes', () => {
    const tabs = buildProviderQuotaHistoryTabs('cursor_agent', [
      makeHistoryRow({
        provider: 'cursor_agent',
        model: 'cursor-agent',
        quota_type: 'monthly',
        quota_key: CURSOR_AGENT_MONTHLY_CENTS_KEY,
        quota_period: 'monthly',
        source: 'cursor_agent_usage',
        client: 'cursor-agent',
        quota_unit: 'cents',
        quota_limit: 100000,
        quota_used: 30000,
        quota_remaining: 70000,
        account_ref: '0123456789ab',
        min_remaining_pct: 70,
        max_remaining_pct: 100,
        usage_tokens: 0,
      }),
    ])

    expect(tabs.map((tab) => tab.tabKey)).toEqual([
      'cursor_agent/monthly-cents',
    ])
    expect(tabs[0].label).toBe('Monthly Cents')
    expect(tabs[0].rows).toHaveLength(1)
    expect(tabs[0].rows[0]).toMatchObject({
      quota_key: CURSOR_AGENT_MONTHLY_CENTS_KEY,
      quota_period: 'monthly',
      source: 'cursor_agent_usage',
      client: 'cursor-agent',
      quota_unit: 'cents',
      quota_limit: 100000,
      quota_used: 30000,
      quota_remaining: 70000,
      account_ref: '0123456789ab',
    })
  })

  test.each([
    ['source', { source: 'wrong-source' }],
    ['client', { client: 'wrong-client' }],
    ['quota key', { quota_key: 'cursor_agent_monthly:tokens' }],
    ['period', { quota_period: '5h' }],
    ['unit', { quota_unit: 'dollars' }],
    ['model', { model: 'cursor' }],
  ] as const)(
    'test_cursor_monthly_cents_history_rejects_%s_contract_mismatch',
    (_field, override) => {
      const tabs = buildProviderQuotaHistoryTabs('cursor_agent', [
        makeHistoryRow({
          provider: 'cursor_agent',
          model: 'cursor-agent',
          quota_type: 'monthly',
          quota_key: CURSOR_AGENT_MONTHLY_CENTS_KEY,
          quota_period: 'monthly',
          source: 'cursor_agent_usage',
          client: 'cursor-agent',
          quota_unit: 'cents',
          quota_limit: 100000,
          quota_used: 30000,
          quota_remaining: 70000,
          min_remaining_pct: 70,
          max_remaining_pct: 100,
          usage_tokens: 0,
          ...override,
        }),
      ])

      expect(tabs[0].rows).toHaveLength(0)
    }
  )

  test('test_zai_history_tabs_render_each_observed_unit_variant', () => {
    const tabs = buildProviderQuotaHistoryTabs('zai_coding_plan', [
      zaiHistoryRow(ZAI_CODING_PLAN_5H_CREDITS_KEY, '5h', 'credits'),
      zaiHistoryRow(ZAI_CODING_PLAN_5H_PERCENT_KEY, '5h', 'percent'),
      zaiHistoryRow(ZAI_CODING_PLAN_5H_COUNT_KEY, '5h', 'count'),
      zaiHistoryRow(ZAI_CODING_PLAN_7D_CREDITS_KEY, '7d', 'credits'),
      zaiHistoryRow(ZAI_CODING_PLAN_7D_PERCENT_KEY, '7d', 'percent'),
      zaiHistoryRow(ZAI_CODING_PLAN_7D_COUNT_KEY, '7d', 'count'),
    ])

    expect(tabs.map((tab) => tab.tabKey)).toEqual([
      'zai_coding_plan/5h-credits',
      'zai_coding_plan/5h-percent',
      'zai_coding_plan/5h-count',
      'zai_coding_plan/7d-credits',
      'zai_coding_plan/7d-percent',
      'zai_coding_plan/7d-count',
    ])
    expect(tabs.every((tab) => tab.rows.length === 1)).toBe(true)
    expect(tabs.map((tab) => tab.rows[0].quota_unit)).toEqual([
      'credits',
      'percent',
      'count',
      'credits',
      'percent',
      'count',
    ])
    expect(tabs[1].rows[0]).toMatchObject({
      quota_limit: null,
      quota_used: null,
      quota_remaining: null,
    })
  })

  test('test_zai_missing_history_variants_have_no_rows_and_no_zero_absolute_values', () => {
    const tabs = buildProviderQuotaHistoryTabs('zai_coding_plan', [
      zaiHistoryRow(ZAI_CODING_PLAN_5H_CREDITS_KEY, '5h', 'credits'),
      zaiHistoryRow(ZAI_CODING_PLAN_7D_COUNT_KEY, '7d', 'count'),
    ])

    expect(
      tabs.find((tab) => tab.tabKey === 'zai_coding_plan/5h-percent')?.rows
    ).toHaveLength(0)
    expect(
      tabs.find((tab) => tab.tabKey === 'zai_coding_plan/7d-percent')?.rows
    ).toHaveLength(0)
    expect(
      tabs.find((tab) => tab.tabKey === 'zai_coding_plan/5h-credits')?.rows[0]
        ?.quota_limit
    ).toBe(100)
  })

  test.each([
    ['source', { source: 'wrong-source' }],
    ['client', { client: 'wrong-client' }],
    ['quota key', { quota_key: ZAI_CODING_PLAN_5H_PERCENT_KEY }],
    ['period', { quota_period: '7d' }],
    ['unit', { quota_unit: 'count' }],
    ['model', { model: 'zai' }],
  ] as const)(
    'test_zai_5h_credits_history_rejects_%s_contract_mismatch',
    (_field, override) => {
      const tabs = buildProviderQuotaHistoryTabs('zai_coding_plan', [
        zaiHistoryRow(
          ZAI_CODING_PLAN_5H_CREDITS_KEY,
          '5h',
          'credits',
          override
        ),
      ])

      expect(
        tabs.find((tab) => tab.tabKey === 'zai_coding_plan/5h-credits')?.rows
      ).toHaveLength(0)
    }
  )
})
