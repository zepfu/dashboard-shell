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
