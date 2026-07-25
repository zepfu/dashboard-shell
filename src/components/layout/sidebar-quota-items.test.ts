/**
 * D1-451 Wave 5 — sidebar-quota-items (C1).
 *
 * C1: OpenAI Spark `special_remaining_pct` must come from the provider row that
 * actually carries special quota data, not from the weekly-selected row when those
 * diverge. Dead per-kind `compareProviderQuotaRows` special branch must not drive
 * weekly row selection.
 */
import { describe, expect, test } from 'vitest'
import type { UsageReportQuotaRow } from '@/features/dashboard/api/usage-report'
import {
  ALIBABA_TOKEN_PLAN_5H_CREDITS_KEY,
  ALIBABA_TOKEN_PLAN_7D_CREDITS_KEY,
} from '@/features/dashboard/lib/quota-bars/lane-defs'
import { buildSidebarQuotaItems } from './sidebar-quota-items'

function makeQuotaRow(
  overrides: Partial<UsageReportQuotaRow> &
    Pick<UsageReportQuotaRow, 'provider'>
): UsageReportQuotaRow {
  return {
    model: null,
    weekly_remaining_pct: null,
    weekly_reset_at: null,
    weekly_interval_start: null,
    weekly_interval_end: null,
    weekly_active: false,
    weekly_usage_tokens: 0,
    weekly_usage_breakdown: [],
    weekly_overage_included_remaining_pct: null,
    weekly_overage_included_reset_at: null,
    weekly_overage_included_interval_start: null,
    weekly_overage_included_interval_end: null,
    weekly_overage_included_active: false,
    weekly_overage_included_usage_tokens: 0,
    weekly_overage_included_usage_breakdown: [],
    short_remaining_pct: null,
    short_reset_at: null,
    short_interval_start: null,
    short_interval_end: null,
    short_active: false,
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
    ...overrides,
  }
}

describe('D1-451 C1 — special percent from correct OpenAI row', () => {
  test('test_openai_spark_uses_special_on_weekly_winner_not_weekly_selected_row', () => {
    // Weekly winner is row A (active, lowest weekly). Spark % lives only on row B.
    const rows: UsageReportQuotaRow[] = [
      makeQuotaRow({
        provider: 'openai',
        weekly_remaining_pct: 10,
        weekly_active: true,
        special_remaining_pct: null,
        special_active: false,
      }),
      makeQuotaRow({
        provider: 'openai',
        weekly_remaining_pct: 90,
        weekly_active: false,
        special_remaining_pct: 42,
        special_active: true,
      }),
    ]

    const items = buildSidebarQuotaItems(rows)
    const weekly = items.find((i) => i.key === 'openai-weekly')
    const spark = items.find((i) => i.key === 'openai-spark')

    expect(weekly?.percent).toBe(10)
    expect(spark).toBeDefined()
    // RED: providerRow picks one row for all fields; spark incorrectly mirrors weekly row (null → omitted or wrong).
    expect(spark?.percent).toBe(42)
  })

  test('test_provider_row_selection_uses_weekly_kind_only_not_special_comparator', () => {
    // Two rows: special-active row has better weekly % but is weekly-inactive.
    // Weekly item must still prefer weekly_active row (dead special comparator must not affect reduce).
    const rows: UsageReportQuotaRow[] = [
      makeQuotaRow({
        provider: 'anthropic',
        weekly_remaining_pct: 55,
        weekly_active: true,
        special_remaining_pct: 5,
        special_active: true,
      }),
      makeQuotaRow({
        provider: 'anthropic',
        weekly_remaining_pct: 99,
        weekly_active: false,
        special_remaining_pct: 99,
        special_active: true,
      }),
    ]

    const items = buildSidebarQuotaItems(rows)
    const weekly = items.find((i) => i.key === 'anthropic-weekly')
    expect(weekly?.percent).toBe(55)
  })
})

describe('D1-451 E2 — null rows coerced', () => {
  test('test_buildSidebarQuotaItems_null_rows_coerced_to_empty', () => {
    // Signature allows null; `rows ?? []` must not throw and must yield no items.
    const items = buildSidebarQuotaItems(
      null as unknown as UsageReportQuotaRow[]
    )
    expect(items).toEqual([])
  })
})

describe('D1-489 — Alibaba Token Plan sidebar separation', () => {
  function alibabaRow(
    overrides: Partial<UsageReportQuotaRow> = {}
  ): UsageReportQuotaRow {
    return makeQuotaRow({
      provider: 'alibaba_token_plan',
      billing_details: {
        short: {
          quota_key: ALIBABA_TOKEN_PLAN_5H_CREDITS_KEY,
          source: 'alibaba_token_plan_usage',
        },
        weekly: {
          quota_key: ALIBABA_TOKEN_PLAN_7D_CREDITS_KEY,
          source: 'alibaba_token_plan_usage',
        },
      },
      short_remaining_pct: 99.96,
      short_active: true,
      weekly_remaining_pct: 99.87,
      weekly_active: true,
      ...overrides,
    })
  }

  test('test_two_separate_sidebar_items_with_distinct_keys_and_labels', () => {
    const items = buildSidebarQuotaItems([alibabaRow()])
    const item5h = items.find((i) => i.key === 'alibaba-5h-credits')
    const item7d = items.find((i) => i.key === 'alibaba-7d-credits')
    expect(item5h).toBeDefined()
    expect(item7d).toBeDefined()
    expect(item5h!.label).toBe('Alibaba 5h Credits')
    expect(item7d!.label).toBe('Alibaba 7d Credits')
    expect(item5h!.percent).toBe(99.96)
    expect(item7d!.percent).toBe(99.87)
  })

  test('test_no_combined_or_collapsed_alibaba_item', () => {
    const items = buildSidebarQuotaItems([alibabaRow()])
    const alibabaItems = items.filter((i) => i.key.startsWith('alibaba'))
    expect(alibabaItems).toHaveLength(2)
    // No single combined value
    expect(items.find((i) => i.key === 'alibaba-combined')).toBeUndefined()
  })

  test('test_only_5h_present_when_weekly_null', () => {
    const items = buildSidebarQuotaItems([
      alibabaRow({ weekly_remaining_pct: null, weekly_active: false }),
    ])
    expect(items.find((i) => i.key === 'alibaba-5h-credits')).toBeDefined()
    expect(items.find((i) => i.key === 'alibaba-7d-credits')).toBeUndefined()
  })

  test('test_null_absolutes_do_not_render_as_zero', () => {
    // Percentages are the only signal; a null percent omits the item entirely
    const items = buildSidebarQuotaItems([
      alibabaRow({ short_remaining_pct: null, short_active: false }),
    ])
    const item5h = items.find((i) => i.key === 'alibaba-5h-credits')
    expect(item5h).toBeUndefined()
  })

  test('test_wrong_quota_key_not_matched', () => {
    const items = buildSidebarQuotaItems([
      alibabaRow({
        billing_details: {
          short: { quota_key: 'unrelated:credits' },
          weekly: { quota_key: 'unrelated2:credits' },
        },
      }),
    ])
    expect(items.filter((i) => i.key.startsWith('alibaba'))).toHaveLength(0)
  })

  test('test_multiple_accounts_have_unique_keys_and_suffix_labels', () => {
    const items = buildSidebarQuotaItems([
      alibabaRow({
        account_ref: 'a1b2c3d4',
        short_remaining_pct: 99.96,
        weekly_remaining_pct: 99.87,
      }),
      alibabaRow({
        account_ref: 'e5f6a7b8',
        short_remaining_pct: 88.5,
        weekly_remaining_pct: 77.25,
      }),
    ]).filter((item) => item.key.startsWith('alibaba'))

    expect(items).toHaveLength(4)
    expect(new Set(items.map((item) => item.key)).size).toBe(4)
    expect(items.map((item) => item.key)).toEqual([
      'alibaba-5h-credits-a1b2c3d4',
      'alibaba-7d-credits-a1b2c3d4',
      'alibaba-5h-credits-e5f6a7b8',
      'alibaba-7d-credits-e5f6a7b8',
    ])
    expect(items.map((item) => item.label)).toEqual([
      'Alibaba 5h Credits · …c3d4',
      'Alibaba 7d Credits · …c3d4',
      'Alibaba 5h Credits · …a7b8',
      'Alibaba 7d Credits · …a7b8',
    ])
    expect(items.map((item) => item.percent)).toEqual([
      99.96, 99.87, 88.5, 77.25,
    ])
  })

  test('test_single_account_keeps_compact_labels_but_account_key_identity', () => {
    const items = buildSidebarQuotaItems([
      alibabaRow({ account_ref: 'a1b2c3d4' }),
    ]).filter((item) => item.key.startsWith('alibaba'))

    expect(items.map((item) => item.key)).toEqual([
      'alibaba-5h-credits-a1b2c3d4',
      'alibaba-7d-credits-a1b2c3d4',
    ])
    expect(items.map((item) => item.label)).toEqual([
      'Alibaba 5h Credits',
      'Alibaba 7d Credits',
    ])
  })
})
