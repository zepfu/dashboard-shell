/**
 * D1-450 Wave 1 — quota-bars/lanes behavioral contract (C5, C7, E3).
 */
import { describe, expect, test } from 'vitest'
import type {
  UsageReportQuotaBillingDetail,
  UsageReportQuotaHistoryRow,
  UsageReportQuotaRow,
} from '../../api/usage-report'
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
} from './lane-defs'
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
    short_remaining_pct: 50,
    short_reset_at: '2026-06-13T12:00:00.000Z',
    short_interval_start: '2026-06-13T07:00:00.000Z',
    short_interval_end: '2026-06-13T12:00:00.000Z',
    short_active: true,
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
    monthly_remaining_pct: null,
    monthly_reset_at: null,
    monthly_interval_start: null,
    monthly_interval_end: null,
    monthly_active: false,
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

describe('D1-489 — Alibaba Token Plan lane separation', () => {
  function alibabaQuotaRow(
    overrides: Partial<UsageReportQuotaRow> = {}
  ): UsageReportQuotaRow {
    return {
      provider: 'alibaba_token_plan',
      model: null,
      account_ref: 'a1b2c3d4',
      billing_details: {
        short: {
          quota_key: ALIBABA_TOKEN_PLAN_5H_CREDITS_KEY,
          source: 'alibaba_token_plan_usage',
          client: 'qwen-cloud-console',
          quota_unit: 'credits',
          quota_limit: null,
          quota_used: null,
          quota_remaining: null,
          billing_observed_at: '2026-07-21T22:39:00.000Z',
        },
        weekly: {
          quota_key: ALIBABA_TOKEN_PLAN_7D_CREDITS_KEY,
          source: 'alibaba_token_plan_usage',
          client: 'qwen-cloud-console',
          quota_unit: 'credits',
          quota_limit: null,
          quota_used: null,
          quota_remaining: null,
          billing_observed_at: '2026-07-21T22:39:00.000Z',
        },
      },
      weekly_remaining_pct: 99.87,
      weekly_reset_at: '2026-07-26T16:26:00.000Z',
      weekly_interval_start: '2026-07-19T16:26:00.000Z',
      weekly_interval_end: '2026-07-26T16:26:00.000Z',
      weekly_active: true,
      short_remaining_pct: 99.96,
      short_reset_at: '2026-07-22T02:22:00.000Z',
      short_interval_start: '2026-07-21T21:22:00.000Z',
      short_interval_end: '2026-07-22T02:22:00.000Z',
      short_active: true,
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
      monthly_remaining_pct: null,
      monthly_reset_at: null,
      monthly_interval_start: null,
      monthly_interval_end: null,
      monthly_active: false,
      ...overrides,
    }
  }

  test('test_two_distinct_lanes_with_correct_labels', () => {
    const lanes = buildProviderLanes(
      'alibaba_token_plan',
      [alibabaQuotaRow()],
      []
    )
    expect(lanes).toHaveLength(2)
    expect(lanes[0].laneKey).toBe('alibaba_token_plan/5h-credits')
    expect(lanes[0].laneLabel).toBe('5-hour Credits')
    expect(lanes[1].laneKey).toBe('alibaba_token_plan/7d-credits')
    expect(lanes[1].laneLabel).toBe('7-day Credits')
  })

  test('test_5h_and_7d_bars_have_distinct_percentages', () => {
    const lanes = buildProviderLanes(
      'alibaba_token_plan',
      [alibabaQuotaRow()],
      []
    )
    const bar5h = lanes[0].currentBar
    const bar7d = lanes[1].currentBar
    expect(bar5h).not.toBeNull()
    expect(bar7d).not.toBeNull()
    expect(bar5h!.remainingPct).toBe(99.96)
    expect(bar7d!.remainingPct).toBe(99.87)
    expect(bar5h!.showSubPercentPrecision).toBe(true)
    expect(bar7d!.showSubPercentPrecision).toBe(true)
  })

  test('test_null_absolutes_flagged_as_unavailable', () => {
    const lanes = buildProviderLanes(
      'alibaba_token_plan',
      [alibabaQuotaRow()],
      []
    )
    expect(lanes[0].currentBar!.tipAbsolutesUnavailable).toBe(true)
    expect(lanes[1].currentBar!.tipAbsolutesUnavailable).toBe(true)
  })

  test('test_billing_observed_at_populates_tipObservedAt', () => {
    const lanes = buildProviderLanes(
      'alibaba_token_plan',
      [alibabaQuotaRow()],
      []
    )
    expect(lanes[0].currentBar!.tipObservedAt).toBe('2026-07-21T22:39:00.000Z')
    expect(lanes[1].currentBar!.tipObservedAt).toBe('2026-07-21T22:39:00.000Z')
  })

  test('test_tip_identity_includes_quota_key_and_source_not_hash', () => {
    const lanes = buildProviderLanes(
      'alibaba_token_plan',
      [alibabaQuotaRow()],
      []
    )
    const identity5h = lanes[0].currentBar!.tipIdentity ?? []
    expect(identity5h).toContain(ALIBABA_TOKEN_PLAN_5H_CREDITS_KEY)
    expect(identity5h).toContain('alibaba_token_plan_usage')
    expect(identity5h).toContain('account …c3d4')
    // No 64-char hex hash should appear
    for (const bit of identity5h) {
      expect(bit).not.toMatch(/^[a-f0-9]{64}$/)
    }
  })

  test('test_prior_bars_filtered_by_quota_key', () => {
    const history5h: UsageReportQuotaHistoryRow = {
      provider: 'alibaba_token_plan',
      model: null,
      quota_type: 'short',
      quota_key: ALIBABA_TOKEN_PLAN_5H_CREDITS_KEY,
      source: 'alibaba_token_plan_usage',
      account_ref: 'a1b2c3d4',
      expected_reset_at: '2026-07-21T21:00:00.000Z',
      interval_start: '2026-07-21T16:00:00.000Z',
      interval_end: '2026-07-21T21:00:00.000Z',
      min_remaining_pct: 80,
      max_remaining_pct: 100,
      usage_tokens: 0,
      usage_breakdown: [],
    }
    const history7d: UsageReportQuotaHistoryRow = {
      provider: 'alibaba_token_plan',
      model: null,
      quota_type: 'weekly',
      quota_key: ALIBABA_TOKEN_PLAN_7D_CREDITS_KEY,
      source: 'alibaba_token_plan_usage',
      account_ref: 'a1b2c3d4',
      expected_reset_at: '2026-07-19T16:26:00.000Z',
      interval_start: '2026-07-12T16:26:00.000Z',
      interval_end: '2026-07-19T16:26:00.000Z',
      min_remaining_pct: 70,
      max_remaining_pct: 100,
      usage_tokens: 0,
      usage_breakdown: [],
    }
    const lanes = buildProviderLanes(
      'alibaba_token_plan',
      [alibabaQuotaRow()],
      [history5h, history7d]
    )
    // 5h lane gets only 5h history, 7d lane gets only 7d history
    expect(lanes[0].priorBars.length).toBe(1)
    expect(lanes[1].priorBars.length).toBe(1)
    expect(lanes[0].priorBars[0].remainingPct).toBe(80)
    expect(lanes[1].priorBars[0].remainingPct).toBe(70)
  })

  test('test_no_lane_when_quota_key_mismatch', () => {
    const row = alibabaQuotaRow({
      billing_details: {
        short: { quota_key: 'wrong_key:credits' },
        weekly: { quota_key: 'wrong_key2:credits' },
      },
    })
    const lanes = buildProviderLanes('alibaba_token_plan', [row], [])
    expect(lanes).toHaveLength(0)
  })

  test('test_multiple_accounts_produce_collision_free_distinct_lanes', () => {
    const accountA = alibabaQuotaRow({
      account_ref: 'a1b2c3d4',
      short_remaining_pct: 99.96,
      weekly_remaining_pct: 99.87,
    })
    const accountB = alibabaQuotaRow({
      account_ref: 'e5f6a7b8',
      short_remaining_pct: 88.5,
      weekly_remaining_pct: 77.25,
    })

    const lanes = buildProviderLanes(
      'alibaba_token_plan',
      [accountA, accountB],
      []
    )
    expect(lanes).toHaveLength(4)
    expect(new Set(lanes.map((lane) => lane.laneKey)).size).toBe(4)
    expect(lanes.map((lane) => lane.laneKey)).toEqual([
      'alibaba_token_plan/5h-credits/a1b2c3d4',
      'alibaba_token_plan/5h-credits/e5f6a7b8',
      'alibaba_token_plan/7d-credits/a1b2c3d4',
      'alibaba_token_plan/7d-credits/e5f6a7b8',
    ])
    expect(lanes.map((lane) => lane.laneLabel)).toEqual([
      '5-hour Credits · …c3d4',
      '5-hour Credits · …a7b8',
      '7-day Credits · …c3d4',
      '7-day Credits · …a7b8',
    ])
    expect(lanes.map((lane) => lane.currentBar!.remainingPct)).toEqual([
      99.96, 88.5, 99.87, 77.25,
    ])
    expect(lanes[0].currentBar!.tipIdentity).toContain('account …c3d4')
    expect(lanes[1].currentBar!.tipIdentity).toContain('account …a7b8')
  })

  test('test_multiple_accounts_render_account_specific_zero_usage_history', () => {
    const sharedHistory = {
      provider: 'alibaba_token_plan',
      model: null,
      quota_type: 'short',
      quota_key: ALIBABA_TOKEN_PLAN_5H_CREDITS_KEY,
      quota_period: '5h',
      source: 'alibaba_token_plan_usage',
      quota_unit: 'credits',
      expected_reset_at: '2026-07-21T21:00:00.000Z',
      interval_start: '2026-07-21T16:00:00.000Z',
      interval_end: '2026-07-21T21:00:00.000Z',
      max_remaining_pct: 100,
      usage_tokens: 0,
      usage_breakdown: [],
    } satisfies Partial<UsageReportQuotaHistoryRow>
    const lanes = buildProviderLanes(
      'alibaba_token_plan',
      [
        alibabaQuotaRow({ account_ref: 'a1b2c3d4' }),
        alibabaQuotaRow({ account_ref: 'e5f6a7b8' }),
      ],
      [
        historyRow({
          ...sharedHistory,
          account_ref: 'a1b2c3d4',
          min_remaining_pct: 99.5,
        }),
        historyRow({
          ...sharedHistory,
          account_ref: 'e5f6a7b8',
          min_remaining_pct: 80,
        }),
      ]
    )

    expect(lanes).toHaveLength(4)
    const accountA = lanes.find(
      (lane) => lane.laneKey === 'alibaba_token_plan/5h-credits/a1b2c3d4'
    )
    const accountB = lanes.find(
      (lane) => lane.laneKey === 'alibaba_token_plan/5h-credits/e5f6a7b8'
    )
    expect(accountA?.priorBars).toHaveLength(1)
    expect(accountB?.priorBars).toHaveLength(1)
    expect(accountA?.priorBars[0].remainingPct).toBe(99.5)
    expect(accountB?.priorBars[0].remainingPct).toBe(80)
    expect(accountA?.priorBars[0].showSubPercentPrecision).toBe(true)
    expect(accountA?.priorBars[0].tipIdentity).toEqual(
      expect.arrayContaining([
        'alibaba_token_plan',
        ALIBABA_TOKEN_PLAN_5H_CREDITS_KEY,
        '5h',
        'alibaba_token_plan_usage',
        'credits',
        'account …c3d4',
      ])
    )
    expect(accountB?.priorBars[0].tipIdentity).toContain('account …a7b8')
    expect(
      lanes
        .filter((lane) => lane.laneKey.includes('/7d-credits/'))
        .every((lane) => lane.priorBars.length === 0)
    ).toBe(true)
  })

  test('test_full_raw_account_hash_current_row_is_treated_as_unidentified', () => {
    const fullHash = 'a'.repeat(64)
    const lanes = buildProviderLanes(
      'alibaba_token_plan',
      [alibabaQuotaRow({ account_ref: fullHash })],
      []
    )
    const identity = lanes[0].currentBar!.tipIdentity ?? []
    expect(identity.some((bit) => bit.startsWith('account '))).toBe(false)
    expect(identity.join(' ')).not.toContain(fullHash)
    expect(JSON.stringify(lanes)).not.toContain(fullHash)
  })

  test('test_full_raw_account_hash_history_is_retained_as_unidentified', () => {
    const fullHash = 'a'.repeat(64)
    const lanes = buildProviderLanes(
      'alibaba_token_plan',
      [alibabaQuotaRow({ account_ref: 'a1b2c3d4' })],
      [
        historyRow({
          provider: 'alibaba_token_plan',
          model: null,
          quota_type: 'short',
          quota_key: ALIBABA_TOKEN_PLAN_5H_CREDITS_KEY,
          quota_period: '5h',
          source: 'alibaba_token_plan_usage',
          account_ref: fullHash,
          expected_reset_at: '2026-07-21T21:00:00.000Z',
          min_remaining_pct: 75,
          max_remaining_pct: 100,
          usage_tokens: 0,
          usage_breakdown: [],
        }),
      ]
    )

    const unidentifiedLane = lanes.find(
      (lane) => lane.laneKey === 'alibaba_token_plan/5h-credits/unidentified-2'
    )
    expect(unidentifiedLane?.currentBar).toBeNull()
    expect(unidentifiedLane?.priorBars).toHaveLength(1)
    expect(JSON.stringify(lanes)).not.toContain(fullHash)
  })

  test('test_alibaba_two_missing_current_rows_are_not_collapsed', () => {
    const lanes = buildProviderLanes(
      'alibaba_token_plan',
      [
        alibabaQuotaRow({
          account_ref: null,
          short_remaining_pct: 91,
          weekly_remaining_pct: 81,
        }),
        alibabaQuotaRow({
          account_ref: null,
          short_remaining_pct: 72,
          weekly_remaining_pct: 62,
        }),
      ],
      []
    )

    const shortLanes = lanes.filter((lane) =>
      lane.laneKey.startsWith('alibaba_token_plan/5h-credits/')
    )
    expect(shortLanes.map((lane) => lane.laneKey)).toEqual([
      'alibaba_token_plan/5h-credits/unidentified-1',
      'alibaba_token_plan/5h-credits/unidentified-2',
    ])
    expect(shortLanes.map((lane) => lane.currentBar?.remainingPct)).toEqual([
      91, 72,
    ])
  })
})

describe('D1-492 — Kimi Code lane separation', () => {
  function kimiQuotaRow(
    overrides: Partial<UsageReportQuotaRow> = {}
  ): UsageReportQuotaRow {
    return {
      provider: 'kimi_code',
      model: null,
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
          billing_observed_at: '2026-07-24T12:00:00.000Z',
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
          billing_observed_at: '2026-07-24T12:00:00.000Z',
        },
      },
      weekly_remaining_pct: 99.87,
      weekly_reset_at: '2026-07-29T16:26:00.000Z',
      weekly_interval_start: '2026-07-22T16:26:00.000Z',
      weekly_interval_end: '2026-07-29T16:26:00.000Z',
      weekly_active: true,
      short_remaining_pct: 99.96,
      short_reset_at: '2026-07-24T17:22:00.000Z',
      short_interval_start: '2026-07-24T12:22:00.000Z',
      short_interval_end: '2026-07-24T17:22:00.000Z',
      short_active: true,
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
      monthly_remaining_pct: null,
      monthly_reset_at: null,
      monthly_interval_start: null,
      monthly_interval_end: null,
      monthly_active: false,
      ...overrides,
    }
  }

  test('test_two_distinct_lanes_with_quota_units_labels', () => {
    const lanes = buildProviderLanes('kimi_code', [kimiQuotaRow()], [])
    expect(lanes).toHaveLength(2)
    expect(lanes[0].laneKey).toBe('kimi_code/5h-quota-units')
    expect(lanes[0].laneLabel).toBe('5-hour Quota Units')
    expect(lanes[1].laneKey).toBe('kimi_code/7d-quota-units')
    expect(lanes[1].laneLabel).toBe('7-day Quota Units')
  })

  test('test_5h_and_7d_bars_have_distinct_percentages_and_sub_percent_precision', () => {
    const lanes = buildProviderLanes('kimi_code', [kimiQuotaRow()], [])
    const bar5h = lanes[0].currentBar
    const bar7d = lanes[1].currentBar
    expect(bar5h).not.toBeNull()
    expect(bar7d).not.toBeNull()
    expect(bar5h!.remainingPct).toBe(99.96)
    expect(bar7d!.remainingPct).toBe(99.87)
    expect(bar5h!.showSubPercentPrecision).toBe(true)
    expect(bar7d!.showSubPercentPrecision).toBe(true)
  })

  test('test_absolute_values_available_not_flagged_unavailable', () => {
    // Kimi Code reports real quota_limit/used/remaining; the
    // percentage-only `absolutes unavailable` flag must stay unset.
    const lanes = buildProviderLanes('kimi_code', [kimiQuotaRow()], [])
    expect(lanes[0].currentBar!.tipAbsolutesUnavailable).toBeUndefined()
    expect(lanes[1].currentBar!.tipAbsolutesUnavailable).toBeUndefined()
    expect(lanes[0].currentBar).toMatchObject({
      tipQuotaLimit: 100,
      tipQuotaUsed: 0.04,
      tipQuotaRemaining: 99.96,
      tipQuotaUnit: 'quota_units',
    })
    expect(lanes[1].currentBar).toMatchObject({
      tipQuotaLimit: 100,
      tipQuotaUsed: 0.13,
      tipQuotaRemaining: 99.87,
      tipQuotaUnit: 'quota_units',
    })
  })

  test('test_null_absolutes_flagged_as_unavailable', () => {
    const lanes = buildProviderLanes(
      'kimi_code',
      [
        kimiQuotaRow({
          billing_details: {
            short: {
              quota_key: KIMI_CODE_5H_QUOTA_UNITS_KEY,
              quota_period: '5h',
              source: 'kimi_code_usage',
              client: 'kimi-code',
              quota_unit: 'quota_units',
              quota_limit: null,
              quota_used: null,
              quota_remaining: null,
            },
            weekly: {
              quota_key: KIMI_CODE_7D_QUOTA_UNITS_KEY,
              quota_period: '7d',
              source: 'kimi_code_usage',
              client: 'kimi-code',
              quota_unit: 'quota_units',
              quota_limit: null,
              quota_used: null,
              quota_remaining: null,
            },
          },
        }),
      ],
      []
    )
    expect(lanes[0].currentBar!.tipAbsolutesUnavailable).toBe(true)
    expect(lanes[1].currentBar!.tipAbsolutesUnavailable).toBe(true)
    expect(lanes[0].currentBar!.tipQuotaUnit).toBe('quota_units')
    expect(lanes[1].currentBar!.tipQuotaUnit).toBe('quota_units')
  })

  test('test_tip_identity_includes_quota_key_source_unit_not_hash', () => {
    const lanes = buildProviderLanes('kimi_code', [kimiQuotaRow()], [])
    const identity5h = lanes[0].currentBar!.tipIdentity ?? []
    expect(identity5h).toContain(KIMI_CODE_5H_QUOTA_UNITS_KEY)
    expect(identity5h).toContain('kimi_code_usage')
    expect(identity5h).toContain('quota_units')
    expect(identity5h).toContain('account …bf29')
    for (const bit of identity5h) {
      expect(bit).not.toMatch(/^[a-f0-9]{64}$/)
    }
  })

  test('test_prior_bars_filtered_by_quota_key_and_period', () => {
    const history5h: UsageReportQuotaHistoryRow = {
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
      expected_reset_at: '2026-07-24T12:00:00.000Z',
      interval_start: '2026-07-24T07:00:00.000Z',
      interval_end: '2026-07-24T12:00:00.000Z',
      min_remaining_pct: 80,
      max_remaining_pct: 100,
      usage_tokens: 0,
      usage_breakdown: [],
    }
    const history7d: UsageReportQuotaHistoryRow = {
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
      expected_reset_at: '2026-07-22T16:26:00.000Z',
      interval_start: '2026-07-15T16:26:00.000Z',
      interval_end: '2026-07-22T16:26:00.000Z',
      min_remaining_pct: 70,
      max_remaining_pct: 100,
      usage_tokens: 0,
      usage_breakdown: [],
    }
    const lanes = buildProviderLanes(
      'kimi_code',
      [kimiQuotaRow()],
      [history5h, history7d]
    )
    expect(lanes[0].priorBars.length).toBe(1)
    expect(lanes[1].priorBars.length).toBe(1)
    expect(lanes[0].priorBars[0].remainingPct).toBe(80)
    expect(lanes[1].priorBars[0].remainingPct).toBe(70)
    expect(lanes[0].priorBars[0].showSubPercentPrecision).toBe(true)
    expect(lanes[0].priorBars[0]).toMatchObject({
      tipQuotaLimit: 100,
      tipQuotaUsed: 20,
      tipQuotaRemaining: 80,
      tipQuotaUnit: 'quota_units',
    })
  })

  test('test_wrong_period_history_excluded_from_lane', () => {
    const lanes = buildProviderLanes(
      'kimi_code',
      [kimiQuotaRow()],
      [
        historyRow({
          provider: 'kimi_code',
          model: null,
          quota_type: 'short',
          quota_key: KIMI_CODE_5H_QUOTA_UNITS_KEY,
          quota_period: '7d',
          source: 'kimi_code_usage',
          client: 'kimi-code',
          quota_unit: 'quota_units',
          expected_reset_at: '2026-07-24T12:00:00.000Z',
          min_remaining_pct: 55,
          max_remaining_pct: 100,
          usage_tokens: 0,
          usage_breakdown: [],
        }),
      ]
    )
    expect(lanes[0].priorBars).toHaveLength(0)
  })

  test('test_no_lane_when_quota_key_mismatch', () => {
    const row = kimiQuotaRow({
      billing_details: {
        short: { quota_key: 'wrong_key:quota_units' },
        weekly: { quota_key: 'wrong_key2:quota_units' },
      },
    })
    const lanes = buildProviderLanes('kimi_code', [row], [])
    expect(lanes).toHaveLength(0)
  })

  test.each([
    { source: 'alibaba_token_plan_usage' },
    { quota_unit: 'credits' },
    { quota_period: '7d' },
    { client: 'qwen-cloud-console' },
    { client: null },
  ])('test_rejects_5h_contract_mismatch', (override) => {
    const row = kimiQuotaRow({
      billing_details: {
        short: {
          ...kimiQuotaRow().billing_details!.short!,
          ...override,
        },
      },
      weekly_active: false,
      weekly_remaining_pct: null,
    })
    const lanes = buildProviderLanes('kimi_code', [row], [])
    expect(lanes).toHaveLength(0)
  })

  test('test_mixed_legacy_and_current_refs_canonicalize_without_duplicate_lanes', () => {
    const lanes = buildProviderLanes(
      'kimi_code',
      [
        kimiQuotaRow({
          account_ref: '119f6a46',
          short_remaining_pct: 70,
          weekly_remaining_pct: 60,
        }),
        kimiQuotaRow({
          account_ref: '119f6a46bf29',
          short_remaining_pct: 99.96,
          weekly_remaining_pct: 99.87,
        }),
      ],
      []
    )

    expect(lanes).toHaveLength(2)
    expect(lanes.map((lane) => lane.laneKey)).toEqual([
      'kimi_code/5h-quota-units',
      'kimi_code/7d-quota-units',
    ])
    expect(lanes.map((lane) => lane.currentBar?.remainingPct)).toEqual([
      99.96, 99.87,
    ])
    expect(lanes[0].currentBar?.tipIdentity).toContain('account …bf29')
  })

  test('test_ambiguous_legacy_prefix_gets_collision_safe_unidentified_lane', () => {
    const lanes = buildProviderLanes(
      'kimi_code',
      [
        kimiQuotaRow({ account_ref: '119f6a46' }),
        kimiQuotaRow({ account_ref: '119f6a46bf29' }),
        kimiQuotaRow({ account_ref: '119f6a46abcd' }),
      ],
      []
    )

    expect(
      lanes
        .filter((lane) => lane.laneKey.includes('/5h-quota-units/'))
        .map((lane) => lane.laneKey)
    ).toEqual([
      'kimi_code/5h-quota-units/unidentified-1',
      'kimi_code/5h-quota-units/119f6a46bf29',
      'kimi_code/5h-quota-units/119f6a46abcd',
    ])
  })

  test('test_cross_window_legacy_prefix_is_not_promoted_to_different_accounts', () => {
    const billingDetails = kimiQuotaRow().billing_details!
    const lanes = buildProviderLanes(
      'kimi_code',
      [
        kimiQuotaRow({
          account_ref: '119f6a46',
          billing_details: { short: billingDetails.short },
          short_remaining_pct: 91,
          weekly_remaining_pct: null,
          weekly_active: false,
        }),
        kimiQuotaRow({
          account_ref: '119f6a46bf29',
          billing_details: { short: billingDetails.short },
          short_remaining_pct: 81,
          weekly_remaining_pct: null,
          weekly_active: false,
        }),
        kimiQuotaRow({
          account_ref: '119f6a46',
          billing_details: { weekly: billingDetails.weekly },
          short_remaining_pct: null,
          short_active: false,
          weekly_remaining_pct: 71,
        }),
        kimiQuotaRow({
          account_ref: '119f6a46abcd',
          billing_details: { weekly: billingDetails.weekly },
          short_remaining_pct: null,
          short_active: false,
          weekly_remaining_pct: 61,
        }),
      ],
      []
    )

    expect(lanes.map((lane) => lane.laneKey)).toEqual([
      'kimi_code/5h-quota-units/unidentified-1',
      'kimi_code/5h-quota-units/119f6a46bf29',
      'kimi_code/7d-quota-units/unidentified-3',
      'kimi_code/7d-quota-units/119f6a46abcd',
    ])
    expect(lanes.map((lane) => lane.currentBar?.remainingPct)).toEqual([
      91, 81, 71, 61,
    ])
  })

  test('test_legacy_history_ref_joins_unambiguous_current_12_ref', () => {
    const lanes = buildProviderLanes(
      'kimi_code',
      [kimiQuotaRow({ account_ref: '119f6a46bf29' })],
      [
        historyRow({
          provider: 'kimi_code',
          model: null,
          quota_type: 'short',
          quota_key: KIMI_CODE_5H_QUOTA_UNITS_KEY,
          quota_period: '5h',
          source: 'kimi_code_usage',
          client: 'kimi-code',
          quota_unit: 'quota_units',
          account_ref: '119f6a46',
          expected_reset_at: '2026-07-24T12:00:00.000Z',
          min_remaining_pct: 75,
          max_remaining_pct: 100,
          usage_tokens: 0,
          usage_breakdown: [],
        }),
      ]
    )

    expect(lanes[0].laneKey).toBe('kimi_code/5h-quota-units')
    expect(lanes[0].priorBars).toHaveLength(1)
    expect(lanes[0].priorBars[0].tipIdentity).toContain('account …bf29')
  })

  test('test_two_missing_current_rows_remain_collision_free_and_preserve_values', () => {
    const lanes = buildProviderLanes(
      'kimi_code',
      [
        kimiQuotaRow({
          account_ref: null,
          short_remaining_pct: 91,
          weekly_remaining_pct: 81,
        }),
        kimiQuotaRow({
          account_ref: null,
          short_remaining_pct: 72,
          weekly_remaining_pct: 62,
        }),
      ],
      []
    )

    const shortLanes = lanes.filter((lane) =>
      lane.laneKey.startsWith('kimi_code/5h-quota-units/')
    )
    expect(shortLanes.map((lane) => lane.laneKey)).toEqual([
      'kimi_code/5h-quota-units/unidentified-1',
      'kimi_code/5h-quota-units/unidentified-2',
    ])
    expect(shortLanes.map((lane) => lane.currentBar?.remainingPct)).toEqual([
      91, 72,
    ])
  })

  test('test_multiple_accounts_produce_collision_free_distinct_lanes', () => {
    const accountA = kimiQuotaRow({
      account_ref: '119f6a46bf29',
      short_remaining_pct: 99.96,
      weekly_remaining_pct: 99.87,
    })
    const accountB = kimiQuotaRow({
      account_ref: '22aa33bb44cc',
      short_remaining_pct: 88.5,
      weekly_remaining_pct: 77.25,
    })

    const lanes = buildProviderLanes('kimi_code', [accountA, accountB], [])
    expect(lanes).toHaveLength(4)
    expect(new Set(lanes.map((lane) => lane.laneKey)).size).toBe(4)
    expect(lanes.map((lane) => lane.laneKey)).toEqual([
      'kimi_code/5h-quota-units/119f6a46bf29',
      'kimi_code/5h-quota-units/22aa33bb44cc',
      'kimi_code/7d-quota-units/119f6a46bf29',
      'kimi_code/7d-quota-units/22aa33bb44cc',
    ])
    expect(lanes.map((lane) => lane.laneLabel)).toEqual([
      '5-hour Quota Units · …bf29',
      '5-hour Quota Units · …44cc',
      '7-day Quota Units · …bf29',
      '7-day Quota Units · …44cc',
    ])
    expect(lanes.map((lane) => lane.currentBar!.remainingPct)).toEqual([
      99.96, 88.5, 99.87, 77.25,
    ])
  })

  test('test_full_raw_account_hash_history_is_retained_as_unidentified_without_leakage', () => {
    const fullHash = 'b'.repeat(64)
    const lanes = buildProviderLanes(
      'kimi_code',
      [kimiQuotaRow({ account_ref: '119f6a46bf29' })],
      [
        historyRow({
          provider: 'kimi_code',
          model: null,
          quota_type: 'short',
          quota_key: KIMI_CODE_5H_QUOTA_UNITS_KEY,
          quota_period: '5h',
          source: 'kimi_code_usage',
          client: 'kimi-code',
          quota_unit: 'quota_units',
          account_ref: fullHash,
          expected_reset_at: '2026-07-24T12:00:00.000Z',
          min_remaining_pct: 75,
          max_remaining_pct: 100,
          usage_tokens: 0,
          usage_breakdown: [],
        }),
      ]
    )

    const unidentifiedLane = lanes.find(
      (lane) => lane.laneKey === 'kimi_code/5h-quota-units/unidentified-2'
    )
    expect(unidentifiedLane?.currentBar).toBeNull()
    expect(unidentifiedLane?.priorBars).toHaveLength(1)
    expect(unidentifiedLane?.priorBars[0].tipIdentity).not.toEqual(
      expect.arrayContaining([expect.stringContaining(fullHash)])
    )
    expect(JSON.stringify(lanes)).not.toContain(fullHash)
  })
})

describe('D1-496 — current provider quota contracts', () => {
  function cursorQuotaRow(
    detailOverrides: Partial<UsageReportQuotaBillingDetail> = {},
    rowOverrides: Partial<UsageReportQuotaRow> = {}
  ): UsageReportQuotaRow {
    return minimalQuotaRow({
      provider: 'cursor_agent',
      model: 'cursor-agent',
      account_ref: '0123456789ab',
      monthly_remaining_pct: 70,
      monthly_reset_at: '2026-08-30T12:00:00.000Z',
      monthly_interval_start: '2026-07-30T12:00:00.000Z',
      monthly_interval_end: '2026-08-30T12:00:00.000Z',
      monthly_active: true,
      billing_details: {
        monthly: {
          quota_key: CURSOR_AGENT_MONTHLY_CENTS_KEY,
          quota_period: 'monthly',
          source: 'cursor_agent_usage',
          client: 'cursor-agent',
          quota_unit: 'cents',
          quota_limit: 100000,
          quota_used: 30000,
          quota_remaining: 70000,
          billing_observed_at: '2026-08-30T11:59:00.000Z',
          ...detailOverrides,
        },
      },
      ...rowOverrides,
    })
  }

  function zaiQuotaRow(
    quotaKey: string,
    quotaPeriod: '5h' | '7d',
    quotaUnit: 'credits' | 'percent' | 'count',
    detailOverrides: Partial<UsageReportQuotaBillingDetail> = {},
    rowOverrides: Partial<UsageReportQuotaRow> = {}
  ): UsageReportQuotaRow {
    const interval = quotaPeriod === '5h' ? 'short' : 'weekly'
    const remainingPct =
      quotaUnit === 'credits' ? 80 : quotaUnit === 'percent' ? 55 : 70
    const detail = {
      quota_key: quotaKey,
      quota_period: quotaPeriod,
      source: 'zai_coding_plan_quota_poll',
      client: 'zai-coding-plan',
      quota_unit: quotaUnit,
      quota_limit: quotaUnit === 'percent' ? null : 100,
      quota_used: quotaUnit === 'percent' ? null : 20,
      quota_remaining: quotaUnit === 'percent' ? null : 80,
      billing_observed_at: '2026-08-30T11:59:00.000Z',
      ...detailOverrides,
    }

    return minimalQuotaRow({
      provider: 'zai_coding_plan',
      model: 'zai-coding-plan',
      account_ref: '0123456789ab',
      ...(interval === 'short'
        ? {
            short_remaining_pct: remainingPct,
            short_reset_at: '2026-08-30T14:00:00.000Z',
            short_interval_start: '2026-08-30T09:00:00.000Z',
            short_interval_end: '2026-08-30T14:00:00.000Z',
            short_active: true,
            billing_details: { short: detail },
          }
        : {
            weekly_remaining_pct: remainingPct,
            weekly_reset_at: '2026-09-01T12:00:00.000Z',
            weekly_interval_start: '2026-08-25T12:00:00.000Z',
            weekly_interval_end: '2026-09-01T12:00:00.000Z',
            weekly_active: true,
            billing_details: { weekly: detail },
          }),
      ...rowOverrides,
    })
  }

  test('test_cursor_monthly_cents_lane_preserves_contract_and_absolutes', () => {
    const lanes = buildProviderLanes('cursor_agent', [cursorQuotaRow()], [])

    expect(lanes).toHaveLength(1)
    expect(lanes[0].laneKey).toBe('cursor_agent/monthly-cents')
    expect(lanes[0].laneLabel).toBe('Monthly Cents')
    expect(lanes[0].currentBar).toMatchObject({
      remainingPct: 70,
      tipQuotaLimit: 100000,
      tipQuotaUsed: 30000,
      tipQuotaRemaining: 70000,
      tipQuotaUnit: 'cents',
    })
    expect(lanes[0].currentBar!.tipIdentity).toEqual(
      expect.arrayContaining([
        CURSOR_AGENT_MONTHLY_CENTS_KEY,
        'cursor_agent_usage',
        'cursor-agent',
        'cents',
        'account …89ab',
      ])
    )
  })

  test.each([
    ['source', { source: 'wrong-source' }, {}],
    ['client', { client: 'wrong-client' }, {}],
    ['quota key', { quota_key: 'cursor_agent_monthly:tokens' }, {}],
    ['period', { quota_period: '5h' }, {}],
    ['unit', { quota_unit: 'dollars' }, {}],
    ['model', {}, { model: 'cursor' }],
  ] as const)(
    'test_cursor_monthly_cents_rejects_%s_contract_mismatch',
    (_field, detailOverrides, rowOverrides) => {
      expect(
        buildProviderLanes(
          'cursor_agent',
          [cursorQuotaRow(detailOverrides, rowOverrides)],
          []
        )
      ).toHaveLength(0)
    }
  )

  test('test_cursor_monthly_cents_accounts_remain_distinct', () => {
    const lanes = buildProviderLanes(
      'cursor_agent',
      [
        cursorQuotaRow({}, { account_ref: '0123456789ab' }),
        cursorQuotaRow(
          { quota_remaining: 40000 },
          { account_ref: 'fedcba987654', monthly_remaining_pct: 40 }
        ),
      ],
      []
    )

    expect(lanes.map((lane) => lane.laneKey)).toEqual([
      'cursor_agent/monthly-cents/0123456789ab',
      'cursor_agent/monthly-cents/fedcba987654',
    ])
    expect(lanes.map((lane) => lane.laneLabel)).toEqual([
      'Monthly Cents · …89ab',
      'Monthly Cents · …7654',
    ])
  })

  test('test_zai_renders_each_observed_unit_variant_with_absolute_values_only_when_supplied', () => {
    const lanes = buildProviderLanes(
      'zai_coding_plan',
      [
        zaiQuotaRow(ZAI_CODING_PLAN_5H_CREDITS_KEY, '5h', 'credits'),
        zaiQuotaRow(ZAI_CODING_PLAN_5H_PERCENT_KEY, '5h', 'percent'),
        zaiQuotaRow(ZAI_CODING_PLAN_5H_COUNT_KEY, '5h', 'count'),
        zaiQuotaRow(ZAI_CODING_PLAN_7D_CREDITS_KEY, '7d', 'credits'),
        zaiQuotaRow(ZAI_CODING_PLAN_7D_PERCENT_KEY, '7d', 'percent'),
        zaiQuotaRow(ZAI_CODING_PLAN_7D_COUNT_KEY, '7d', 'count'),
      ],
      []
    )

    expect(lanes.map((lane) => lane.laneKey)).toEqual([
      'zai_coding_plan/5h-credits',
      'zai_coding_plan/5h-percent',
      'zai_coding_plan/5h-count',
      'zai_coding_plan/7d-credits',
      'zai_coding_plan/7d-percent',
      'zai_coding_plan/7d-count',
    ])
    expect(lanes.map((lane) => lane.currentBar!.tipQuotaUnit)).toEqual([
      'credits',
      'percent',
      'count',
      'credits',
      'percent',
      'count',
    ])
    expect(lanes[0].currentBar).toMatchObject({
      tipQuotaLimit: 100,
      tipQuotaUsed: 20,
      tipQuotaRemaining: 80,
    })
    expect(lanes[1].currentBar).toMatchObject({
      tipQuotaLimit: null,
      tipQuotaUsed: null,
      tipQuotaRemaining: null,
      tipAbsolutesUnavailable: true,
    })
  })

  test('test_zai_missing_unit_variants_stay_absent_instead_of_zero', () => {
    const lanes = buildProviderLanes(
      'zai_coding_plan',
      [
        zaiQuotaRow(ZAI_CODING_PLAN_5H_CREDITS_KEY, '5h', 'credits'),
        zaiQuotaRow(ZAI_CODING_PLAN_7D_COUNT_KEY, '7d', 'count'),
      ],
      []
    )

    expect(lanes.map((lane) => lane.laneKey)).toEqual([
      'zai_coding_plan/5h-credits',
      'zai_coding_plan/7d-count',
    ])
    expect(lanes.find((lane) => lane.laneKey.includes('5h-percent'))).toBe(
      undefined
    )
    expect(lanes.find((lane) => lane.laneKey.includes('7d-percent'))).toBe(
      undefined
    )
  })

  test.each([
    ['source', { source: 'wrong-source' }, {}],
    ['client', { client: 'wrong-client' }, {}],
    ['quota key', { quota_key: ZAI_CODING_PLAN_5H_PERCENT_KEY }, {}],
    ['period', { quota_period: '7d' }, {}],
    ['unit', { quota_unit: 'wrong-unit' }, {}],
    ['model', {}, { model: 'zai' }],
  ] as const)(
    'test_zai_5h_credits_rejects_%s_contract_mismatch',
    (_field, detailOverrides, rowOverrides) => {
      expect(
        buildProviderLanes(
          'zai_coding_plan',
          [
            zaiQuotaRow(
              ZAI_CODING_PLAN_5H_CREDITS_KEY,
              '5h',
              'credits',
              detailOverrides,
              rowOverrides
            ),
          ],
          []
        )
      ).toHaveLength(0)
    }
  )
})
