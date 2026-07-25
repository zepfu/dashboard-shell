/**
 * D1-450 Wave 1 — quota-bars/lanes behavioral contract (C5, C7, E3).
 */
import { describe, expect, test } from 'vitest'
import type {
  UsageReportQuotaHistoryRow,
  UsageReportQuotaRow,
} from '../../api/usage-report'
import {
  ALIBABA_TOKEN_PLAN_5H_CREDITS_KEY,
  ALIBABA_TOKEN_PLAN_7D_CREDITS_KEY,
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
      weekly_usage_tokens: 0,
      weekly_usage_breakdown: [],
      short_remaining_pct: 99.96,
      short_reset_at: '2026-07-22T02:22:00.000Z',
      short_interval_start: '2026-07-21T21:22:00.000Z',
      short_interval_end: '2026-07-22T02:22:00.000Z',
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

  test('test_account_identity_only_exposes_short_suffix', () => {
    const fullHash = 'a'.repeat(64)
    const lanes = buildProviderLanes(
      'alibaba_token_plan',
      [alibabaQuotaRow({ account_ref: fullHash })],
      []
    )
    const identity = lanes[0].currentBar!.tipIdentity ?? []
    expect(identity).toContain('account …aaaa')
    expect(identity.join(' ')).not.toContain(fullHash)
  })

  test('test_full_raw_account_hash_history_is_not_attached', () => {
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

    expect(lanes[0].priorBars).toHaveLength(0)
    expect(JSON.stringify(lanes)).not.toContain(fullHash)
  })
})
