/**
 * D1-451 Wave 5 — sidebar-quota-items (C1).
 *
 * C1: OpenAI Spark `special_remaining_pct` must come from the provider row that
 * actually carries special quota data, not from the weekly-selected row when those
 * diverge. Dead per-kind `compareProviderQuotaRows` special branch must not drive
 * weekly row selection.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { UsageReportQuotaRow } from '@/features/dashboard/api/usage-report'
import { ANTHROPIC_PROVIDER_STATUS_ENV_VAR } from '@/features/dashboard/lib/provider-status-visibility'
import {
  ALIBABA_TOKEN_PLAN_5H_CREDITS_KEY,
  ALIBABA_TOKEN_PLAN_7D_CREDITS_KEY,
  KIMI_CODE_5H_QUOTA_UNITS_KEY,
  KIMI_CODE_7D_QUOTA_UNITS_KEY,
} from '@/features/dashboard/lib/quota-bars/lane-defs'
import { buildSidebarQuotaItems } from './sidebar-quota-items'

afterEach(() => {
  vi.unstubAllEnvs()
})

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
    weekly_overage_included_remaining_pct: null,
    weekly_overage_included_reset_at: null,
    weekly_overage_included_interval_start: null,
    weekly_overage_included_interval_end: null,
    weekly_overage_included_active: false,
    short_remaining_pct: null,
    short_reset_at: null,
    short_interval_start: null,
    short_interval_end: null,
    short_active: false,
    special_remaining_pct: null,
    special_reset_at: null,
    special_interval_start: null,
    special_interval_end: null,
    special_active: false,
    short_special_remaining_pct: null,
    short_special_reset_at: null,
    short_special_interval_start: null,
    short_special_interval_end: null,
    short_special_active: false,
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
    vi.stubEnv(ANTHROPIC_PROVIDER_STATUS_ENV_VAR, 'true')
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

describe('D1-498 — Anthropic sidebar visibility', () => {
  const anthropicRow = makeQuotaRow({
    provider: 'anthropic',
    weekly_remaining_pct: 88,
    weekly_active: true,
    weekly_overage_included_remaining_pct: 77,
    weekly_overage_included_active: true,
    special_remaining_pct: 66,
    special_active: true,
  })

  test('test_default_config_hides_all_anthropic_sidebar_items', () => {
    vi.stubEnv(ANTHROPIC_PROVIDER_STATUS_ENV_VAR, 'false')

    const items = buildSidebarQuotaItems([anthropicRow])

    expect(items.filter((item) => item.key.startsWith('anthropic-'))).toEqual(
      []
    )
  })

  test('test_true_config_restores_all_anthropic_sidebar_items', () => {
    vi.stubEnv(ANTHROPIC_PROVIDER_STATUS_ENV_VAR, 'true')

    const items = buildSidebarQuotaItems([anthropicRow])

    expect(items.map((item) => item.key)).toEqual([
      'anthropic-weekly',
      'anthropic-fable-overage',
      'anthropic-sonnet-retired',
    ])
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

  test('test_full_raw_account_hash_never_leaks_into_alibaba_sidebar_objects_or_keys', () => {
    const fullHash = 'a'.repeat(64)
    const items = buildSidebarQuotaItems([
      alibabaRow({ account_ref: fullHash }),
    ]).filter((item) => item.key.startsWith('alibaba'))

    expect(items.map((item) => item.key)).toEqual([
      'alibaba-5h-credits-unidentified-1',
      'alibaba-7d-credits-unidentified-1',
    ])
    expect(JSON.stringify(items)).not.toContain(fullHash)
  })

  test('test_two_missing_alibaba_rows_keep_every_sidebar_item_collision_free', () => {
    const items = buildSidebarQuotaItems([
      alibabaRow({
        account_ref: null,
        short_remaining_pct: 91,
        weekly_remaining_pct: 81,
      }),
      alibabaRow({
        account_ref: null,
        short_remaining_pct: 72,
        weekly_remaining_pct: 62,
      }),
    ]).filter((item) => item.key.startsWith('alibaba'))

    expect(items.map((item) => item.key)).toEqual([
      'alibaba-5h-credits-unidentified-1',
      'alibaba-7d-credits-unidentified-1',
      'alibaba-5h-credits-unidentified-2',
      'alibaba-7d-credits-unidentified-2',
    ])
    expect(items.map((item) => item.percent)).toEqual([91, 81, 72, 62])
  })
})

describe('D1-492 — Kimi Code sidebar separation', () => {
  function kimiRow(
    overrides: Partial<UsageReportQuotaRow> = {}
  ): UsageReportQuotaRow {
    return makeQuotaRow({
      provider: 'kimi_code',
      account_ref: '119f6a46bf29',
      billing_details: {
        short: {
          quota_key: KIMI_CODE_5H_QUOTA_UNITS_KEY,
          quota_period: '5h',
          source: 'kimi_code_usage',
          client: 'kimi-code',
          quota_unit: 'quota_units',
          quota_limit: 100,
          quota_used: 0.04,
          quota_remaining: 99.96,
        },
        weekly: {
          quota_key: KIMI_CODE_7D_QUOTA_UNITS_KEY,
          quota_period: '7d',
          source: 'kimi_code_usage',
          client: 'kimi-code',
          quota_unit: 'quota_units',
          quota_limit: 100,
          quota_used: 0.13,
          quota_remaining: 99.87,
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
    const items = buildSidebarQuotaItems([kimiRow()])
    const item5h = items.find(
      (i) => i.key === 'kimi-5h-quota-units-119f6a46bf29'
    )
    const item7d = items.find(
      (i) => i.key === 'kimi-7d-quota-units-119f6a46bf29'
    )
    expect(item5h).toBeDefined()
    expect(item7d).toBeDefined()
    expect(item5h!.label).toBe('Kimi Code 5h Quota Units')
    expect(item7d!.label).toBe('Kimi Code 7d Quota Units')
    expect(item5h!.percent).toBe(99.96)
    expect(item7d!.percent).toBe(99.87)
  })

  test('test_kimi_items_distinct_from_alibaba_items', () => {
    const items = buildSidebarQuotaItems([
      kimiRow(),
      makeQuotaRow({
        provider: 'alibaba_token_plan',
        billing_details: {
          short: { quota_key: ALIBABA_TOKEN_PLAN_5H_CREDITS_KEY },
          weekly: { quota_key: ALIBABA_TOKEN_PLAN_7D_CREDITS_KEY },
        },
        short_remaining_pct: 50,
        short_active: true,
        weekly_remaining_pct: 40,
        weekly_active: true,
      }),
    ])
    expect(items.filter((i) => i.key.startsWith('kimi'))).toHaveLength(2)
    expect(items.filter((i) => i.key.startsWith('alibaba'))).toHaveLength(2)
    expect(items.find((i) => i.key === 'kimi-combined')).toBeUndefined()
  })

  test('test_only_5h_present_when_weekly_null', () => {
    const items = buildSidebarQuotaItems([
      kimiRow({ weekly_remaining_pct: null, weekly_active: false }),
    ])
    expect(
      items.find((i) => i.key === 'kimi-5h-quota-units-119f6a46bf29')
    ).toBeDefined()
    expect(
      items.find((i) => i.key === 'kimi-7d-quota-units-119f6a46bf29')
    ).toBeUndefined()
  })

  test('test_null_percent_omits_item', () => {
    const items = buildSidebarQuotaItems([
      kimiRow({ short_remaining_pct: null, short_active: false }),
    ])
    expect(
      items.find((i) => i.key === 'kimi-5h-quota-units-119f6a46bf29')
    ).toBeUndefined()
  })

  test('test_wrong_quota_key_not_matched', () => {
    const items = buildSidebarQuotaItems([
      kimiRow({
        billing_details: {
          short: { quota_key: 'unrelated:quota_units' },
          weekly: { quota_key: 'unrelated2:quota_units' },
        },
      }),
    ])
    expect(items.filter((i) => i.key.startsWith('kimi'))).toHaveLength(0)
  })

  test.each([
    { source: 'alibaba_token_plan_usage' },
    { quota_unit: 'credits' },
    { quota_period: '7d' },
    { client: 'qwen-cloud-console' },
    { client: null },
  ])('test_sidebar_rejects_kimi_contract_mismatch', (override) => {
    const base = kimiRow().billing_details!
    const items = buildSidebarQuotaItems([
      kimiRow({
        billing_details: {
          short: { ...base.short!, ...override },
          weekly: {
            ...base.weekly!,
            source: 'wrong-source',
          },
        },
      }),
    ])
    expect(items.filter((item) => item.key.startsWith('kimi'))).toHaveLength(0)
  })

  test('test_mixed_legacy_and_current_refs_collapse_to_current_sidebar_identity', () => {
    const items = buildSidebarQuotaItems([
      kimiRow({
        account_ref: '119f6a46',
        short_remaining_pct: 70,
        weekly_remaining_pct: 60,
      }),
      kimiRow({
        account_ref: '119f6a46bf29',
        short_remaining_pct: 99.96,
        weekly_remaining_pct: 99.87,
      }),
    ]).filter((item) => item.key.startsWith('kimi'))

    expect(items.map((item) => item.key)).toEqual([
      'kimi-5h-quota-units-119f6a46bf29',
      'kimi-7d-quota-units-119f6a46bf29',
    ])
    expect(items.map((item) => item.percent)).toEqual([99.96, 99.87])
  })

  test('test_two_missing_kimi_rows_keep_every_sidebar_item_collision_free', () => {
    const items = buildSidebarQuotaItems([
      kimiRow({
        account_ref: null,
        short_remaining_pct: 91,
        weekly_remaining_pct: 81,
      }),
      kimiRow({
        account_ref: null,
        short_remaining_pct: 72,
        weekly_remaining_pct: 62,
      }),
    ]).filter((item) => item.key.startsWith('kimi'))

    expect(items.map((item) => item.key)).toEqual([
      'kimi-5h-quota-units-unidentified-1',
      'kimi-7d-quota-units-unidentified-1',
      'kimi-5h-quota-units-unidentified-2',
      'kimi-7d-quota-units-unidentified-2',
    ])
    expect(items.map((item) => item.percent)).toEqual([91, 81, 72, 62])
  })

  test('test_multiple_accounts_have_unique_keys_and_suffix_labels', () => {
    const items = buildSidebarQuotaItems([
      kimiRow({
        account_ref: '119f6a46bf29',
        short_remaining_pct: 99.96,
        weekly_remaining_pct: 99.87,
      }),
      kimiRow({
        account_ref: '22aa33bb44cc',
        short_remaining_pct: 88.5,
        weekly_remaining_pct: 77.25,
      }),
    ]).filter((item) => item.key.startsWith('kimi'))

    expect(items).toHaveLength(4)
    expect(new Set(items.map((item) => item.key)).size).toBe(4)
    expect(items.map((item) => item.key)).toEqual([
      'kimi-5h-quota-units-119f6a46bf29',
      'kimi-7d-quota-units-119f6a46bf29',
      'kimi-5h-quota-units-22aa33bb44cc',
      'kimi-7d-quota-units-22aa33bb44cc',
    ])
    expect(items.map((item) => item.label)).toEqual([
      'Kimi Code 5h Quota Units · …bf29',
      'Kimi Code 7d Quota Units · …bf29',
      'Kimi Code 5h Quota Units · …44cc',
      'Kimi Code 7d Quota Units · …44cc',
    ])
    expect(items.map((item) => item.percent)).toEqual([
      99.96, 99.87, 88.5, 77.25,
    ])
  })

  test('test_single_account_keeps_compact_labels_but_account_key_identity', () => {
    const items = buildSidebarQuotaItems([
      kimiRow({ account_ref: '119f6a46bf29' }),
    ]).filter((item) => item.key.startsWith('kimi'))

    expect(items.map((item) => item.key)).toEqual([
      'kimi-5h-quota-units-119f6a46bf29',
      'kimi-7d-quota-units-119f6a46bf29',
    ])
    expect(items.map((item) => item.label)).toEqual([
      'Kimi Code 5h Quota Units',
      'Kimi Code 7d Quota Units',
    ])
  })

  test('test_full_raw_account_hash_never_leaks_into_sidebar_objects_or_keys', () => {
    const fullHash = 'd'.repeat(64)
    const items = buildSidebarQuotaItems([
      kimiRow({ account_ref: fullHash }),
    ]).filter((item) => item.key.startsWith('kimi'))

    expect(items.map((item) => item.key)).toEqual([
      'kimi-5h-quota-units-unidentified-1',
      'kimi-7d-quota-units-unidentified-1',
    ])
    expect(items.map((item) => item.label)).toEqual([
      'Kimi Code 5h Quota Units',
      'Kimi Code 7d Quota Units',
    ])
    expect(JSON.stringify(items)).not.toContain(fullHash)
  })
})
