/**
 * Unit tests for quota-bars field helpers and lane builders.
 *
 * Moved from phosphor-dashboard.test.tsx (fork-review E1). Implementations live in
 * `../lib/quota-bars/fields.ts` and `../lib/quota-bars/lanes.ts`.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import type {
  UsageReportQuotaHistoryRow,
  UsageReportQuotaRow,
  UsageReportQuotaUsageBreakdown,
} from '../../api/usage-report'
import {
  formatTimeAgo,
  quotaTypeToPeriodType,
  tipModelsFromBreakdownGoogleAggregated,
  tipModelsFromBreakdownSingleLabel,
  classifyGeminiModel,
} from './fields'
import { buildPriorBarFromHistory, buildProviderLanes } from './lanes'

// ---------------------------------------------------------------------------
// Wave 40 multi-quota redesign — unit tests for new helper functions
// ---------------------------------------------------------------------------

// S1-T3 flake fix: use fake timers so Date.now() inside formatTimeAgo
// is pinned to a known epoch and cannot race with real wall-clock progression.
describe('Wave 40 — formatTimeAgo', () => {
  // Pinned epoch: 2026-05-21T12:00:00.000Z (arbitrary, far from DST boundaries)
  const PINNED_NOW = new Date('2026-05-21T12:00:00.000Z').getTime()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(PINNED_NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('test_format_time_ago_minutes', () => {
    const d = new Date(PINNED_NOW - 45 * 60_000) // 45 minutes ago
    expect(formatTimeAgo(d)).toBe('45m ago')
  })

  test('test_format_time_ago_hours', () => {
    const d = new Date(PINNED_NOW - 3 * 60 * 60_000) // 3 hours ago
    expect(formatTimeAgo(d)).toBe('3h ago')
  })

  test('test_format_time_ago_days', () => {
    const d = new Date(PINNED_NOW - 2 * 24 * 60 * 60_000) // 2 days ago
    expect(formatTimeAgo(d)).toBe('2d ago')
  })

  test('test_format_time_ago_weeks', () => {
    const d = new Date(PINNED_NOW - 15 * 24 * 60 * 60_000) // 15 days ago → 2w
    expect(formatTimeAgo(d)).toBe('2w ago')
  })

  test('test_format_time_ago_future_within_1min_returns_just_now', () => {
    // Within 1 minute in the future → boundary label (rounding artefact safe)
    const d = new Date(PINNED_NOW + 60_000) // exactly 1 minute in the future
    expect(formatTimeAgo(d)).toBe('just now')
  })

  test('test_format_time_ago_future_over_1min_returns_in_label', () => {
    // E9: genuinely future timestamps use "in …" copy, not misleading "… ago".
    const d = new Date(PINNED_NOW + 2 * 60 * 60_000 + 30_000)
    expect(formatTimeAgo(d)).toBe('in 2h')
  })
})

describe('Wave 40 — quotaTypeToPeriodType', () => {
  test('test_quota_type_short_maps_to_5hr', () => {
    expect(quotaTypeToPeriodType('short')).toBe('5hr')
  })

  test('test_quota_type_short_special_maps_to_5hr', () => {
    expect(quotaTypeToPeriodType('short_special')).toBe('5hr')
  })

  test('test_quota_type_weekly_maps_to_weekly', () => {
    expect(quotaTypeToPeriodType('weekly')).toBe('weekly')
  })

  test('test_quota_type_special_maps_to_special', () => {
    expect(quotaTypeToPeriodType('special')).toBe('special')
  })

  test('test_quota_type_monthly_maps_to_monthly', () => {
    expect(quotaTypeToPeriodType('monthly')).toBe('monthly')
  })

  test('test_quota_type_weekly_overage_included_maps_to_weekly_overage_included', () => {
    expect(quotaTypeToPeriodType('weekly_overage_included')).toBe(
      'weekly_overage_included'
    )
  })
  test('test_quota_type_unknown_defaults_to_weekly', () => {
    expect(quotaTypeToPeriodType('requests')).toBe('weekly')
  })
})

describe('Wave 40 — tipModelsFromBreakdownGoogleAggregated', () => {
  const makeBreakdown = (
    entries: ReadonlyArray<{
      model: string
      cost: number
      traces?: number
      recent_traces_90m?: number
    }>
  ): UsageReportQuotaUsageBreakdown[] =>
    entries.map(({ model, cost, traces = 0, recent_traces_90m = 0 }) => ({
      model,
      cost,
      tokens: 0,
      traces,
      recent_traces_90m,
    }))

  test('test_google_aggregated_empty_returns_undefined', () => {
    expect(tipModelsFromBreakdownGoogleAggregated([])).toBeUndefined()
  })

  test('test_google_aggregated_flash_lite_bucket', () => {
    const result = tipModelsFromBreakdownGoogleAggregated(
      makeBreakdown([{ model: 'gemini-2.5-flash-lite', cost: 10 }])
    )
    expect(result).toHaveLength(1)
    expect(result![0].model).toBe('flash-lite')
  })

  test('test_google_aggregated_flash_bucket_excludes_flash_lite', () => {
    const result = tipModelsFromBreakdownGoogleAggregated(
      makeBreakdown([
        { model: 'gemini-2.5-flash-lite', cost: 5 },
        { model: 'gemini-2.0-flash', cost: 8 },
      ])
    )
    // Should have flash-lite: 5 and flash: 8
    expect(result).toHaveLength(2)
    const flashLite = result!.find((r) => r.model === 'flash-lite')
    const flash = result!.find((r) => r.model === 'flash')
    expect(flashLite?.costDelta).toBe('$5.00')
    expect(flash?.costDelta).toBe('$8.00')
  })

  test('test_google_aggregated_pro_bucket', () => {
    const result = tipModelsFromBreakdownGoogleAggregated(
      makeBreakdown([{ model: 'gemini-2.5-pro', cost: 20 }])
    )
    expect(result![0].model).toBe('pro')
    expect(result![0].costDelta).toBe('$20.00')
  })

  test('test_google_aggregated_sums_costs_within_class', () => {
    const result = tipModelsFromBreakdownGoogleAggregated(
      makeBreakdown([
        {
          model: 'gemini-2.0-flash-001',
          cost: 3,
          traces: 2,
          recent_traces_90m: 1,
        },
        {
          model: 'gemini-2.5-flash-preview',
          cost: 5,
          traces: 4,
          recent_traces_90m: 3,
        },
      ])
    )
    // Both map to 'flash'; combined cost = 8
    expect(result).toHaveLength(1)
    expect(result![0].model).toBe('flash')
    expect(result![0].costDelta).toBe('$8.00')
    expect(result![0].requests).toBe(6)
    expect(result![0].recentRequests90m).toBe(4)
  })
})

describe('Wave 40 — tipModelsFromBreakdownSingleLabel', () => {
  const makeBreakdown = (
    entries: ReadonlyArray<{
      model: string
      cost: number
      traces?: number
      recent_traces_90m?: number
    }>
  ): UsageReportQuotaUsageBreakdown[] =>
    entries.map(({ model, cost, traces = 0, recent_traces_90m = 0 }) => ({
      model,
      cost,
      tokens: 0,
      traces,
      recent_traces_90m,
    }))

  test('test_single_label_empty_returns_undefined', () => {
    expect(tipModelsFromBreakdownSingleLabel([], 'sonnet')).toBeUndefined()
  })

  test('test_single_label_returns_one_entry_with_display_label', () => {
    const result = tipModelsFromBreakdownSingleLabel(
      makeBreakdown([
        {
          model: 'claude-sonnet-4-6',
          cost: 10,
          traces: 7,
          recent_traces_90m: 3,
        },
        {
          model: 'claude-opus-4-7',
          cost: 5,
          traces: 2,
          recent_traces_90m: 1,
        },
      ]),
      'sonnet'
    )
    expect(result).toHaveLength(1)
    expect(result![0].model).toBe('sonnet')
    expect(result![0].costDelta).toBe('$15.00')
    expect(result![0].requests).toBe(9)
    expect(result![0].recentRequests90m).toBe(4)
  })

  test('test_single_label_codex_spark_for_openai', () => {
    const result = tipModelsFromBreakdownSingleLabel(
      makeBreakdown([{ model: 'gpt-4o', cost: 7.5 }]),
      'codex-spark'
    )
    expect(result![0].model).toBe('codex-spark')
    expect(result![0].costDelta).toBe('$7.50')
  })
})

// ---------------------------------------------------------------------------
// Wave 41 — classifyGeminiModel
// ---------------------------------------------------------------------------

describe('Wave 41 — classifyGeminiModel', () => {
  test('test_classify_flash_lite_before_flash', () => {
    // flash-lite must be returned for models containing 'flash-lite', not 'flash'.
    expect(classifyGeminiModel('gemini-2.5-flash-lite')).toBe(
      'gemini-flash-lite'
    )
    expect(classifyGeminiModel('gemini-3.1-flash-lite-preview')).toBe(
      'gemini-flash-lite'
    )
  })

  test('test_classify_flash', () => {
    expect(classifyGeminiModel('gemini-2.5-flash')).toBe('gemini-flash')
    expect(classifyGeminiModel('gemini-3-flash-preview')).toBe('gemini-flash')
  })

  test('test_classify_pro', () => {
    expect(classifyGeminiModel('gemini-2.5-pro')).toBe('gemini-pro')
    expect(classifyGeminiModel('gemini-3-pro-preview')).toBe('gemini-pro')
  })

  test('test_classify_non_gemini_returns_null', () => {
    expect(classifyGeminiModel('gpt-4o')).toBeNull()
    expect(
      classifyGeminiModel('google_code_assist_requests:daily_request_pool')
    ).toBeNull()
    expect(classifyGeminiModel('')).toBeNull()
  })

  test('test_classify_gemini_no_known_class_returns_null', () => {
    expect(classifyGeminiModel('gemini-unknown-model')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Wave 41 — buildProviderLanes
// ---------------------------------------------------------------------------

describe('Wave 41 — buildProviderLanes', () => {
  /**
   * Minimal QuotaRow factory for Anthropic with all relevant quota types active.
   */
  function makeAnthropicQuotaRow(
    overrides: Partial<UsageReportQuotaRow> = {}
  ): UsageReportQuotaRow {
    return {
      provider: 'anthropic',
      model: null,
      weekly_remaining_pct: 57,
      weekly_reset_at: '2026-05-21T15:00:00Z',
      weekly_interval_start: '2026-05-14T15:00:00Z',
      weekly_interval_end: '2026-05-21T15:00:00Z',
      weekly_active: true,
      weekly_usage_tokens: 1000,
      weekly_usage_breakdown: [],
      short_remaining_pct: 99,
      short_reset_at: '2026-05-20T21:00:00Z',
      short_interval_start: '2026-05-20T16:00:00Z',
      short_interval_end: '2026-05-20T21:00:00Z',
      short_active: true,
      short_usage_tokens: 10,
      short_usage_breakdown: [],
      special_remaining_pct: 65,
      special_reset_at: '2026-05-21T15:00:00Z',
      special_interval_start: '2026-05-14T15:00:00Z',
      special_interval_end: '2026-05-21T15:00:00Z',
      special_active: true,
      special_usage_tokens: 500,
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
      weekly_overage_included_remaining_pct: null,
      weekly_overage_included_reset_at: null,
      weekly_overage_included_interval_start: null,
      weekly_overage_included_interval_end: null,
      weekly_overage_included_active: false,
      weekly_overage_included_usage_tokens: 0,
      weekly_overage_included_usage_breakdown: [],
      ...overrides,
    }
  }

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

  test('test_anthropic_has_3_lanes_without_weekly_overage_source_rows', () => {
    const quotaRows = [makeAnthropicQuotaRow()]
    const lanes = buildProviderLanes('anthropic', quotaRows, [])
    expect(lanes.length).toBe(3)
    const keys = lanes.map((l) => l.laneKey)
    expect(keys).toContain('anthropic/short')
    expect(keys).toContain('anthropic/weekly')
    expect(keys).not.toContain('anthropic/weekly_overage_included')
    expect(keys).toContain('anthropic/special')
  })

  test('test_anthropic_lane_order_short_weekly_special_without_overage', () => {
    const quotaRows = [makeAnthropicQuotaRow()]
    const lanes = buildProviderLanes('anthropic', quotaRows, [])
    expect(lanes[0].laneKey).toBe('anthropic/short')
    expect(lanes[1].laneKey).toBe('anthropic/weekly')
    expect(lanes[2].laneKey).toBe('anthropic/special')
  })

  test('test_anthropic_has_4_lanes_when_weekly_overage_active', () => {
    const quotaRows = [
      makeAnthropicQuotaRow({
        weekly_overage_included_remaining_pct: 90,
        weekly_overage_included_reset_at: '2026-07-09T15:00:00Z',
        weekly_overage_included_interval_start: '2026-07-02T15:00:00Z',
        weekly_overage_included_interval_end: '2026-07-09T15:00:00Z',
        weekly_overage_included_active: true,
      }),
    ]
    const lanes = buildProviderLanes('anthropic', quotaRows, [])
    expect(lanes.map((lane) => lane.laneKey)).toEqual([
      'anthropic/short',
      'anthropic/weekly',
      'anthropic/weekly_overage_included',
      'anthropic/special',
    ])
  })

  test('test_anthropic_weekly_overage_lane_does_not_fallback_to_weekly_or_sonnet', () => {
    const quotaRows = [
      makeAnthropicQuotaRow({
        weekly_overage_included_remaining_pct: 90,
        weekly_overage_included_reset_at: '2026-07-09T15:00:00Z',
        weekly_overage_included_interval_start: '2026-07-02T15:00:00Z',
        weekly_overage_included_interval_end: '2026-07-09T15:00:00Z',
        weekly_overage_included_active: true,
        weekly_overage_included_usage_tokens: 120,
        weekly_overage_included_usage_breakdown: [],
      }),
    ]
    const lanes = buildProviderLanes('anthropic', quotaRows, [])
    const overageLane = lanes.find(
      (lane) => lane.laneKey === 'anthropic/weekly_overage_included'
    )
    expect(overageLane).toBeDefined()
    expect(overageLane!.currentBar).not.toBeNull()
    expect(overageLane!.currentBar!.remainingPct).toBe(90)
    expect(overageLane!.laneLabel).toMatch(/Fable/i)
  })

  test('test_anthropic_history_rows_keep_weekly_overage_separate_from_weekly_and_special', () => {
    const quotaRows = [makeAnthropicQuotaRow()]
    const historyRows = [
      makeHistoryRow({
        quota_type: 'weekly',
        expected_reset_at: '2026-05-14T15:00:00Z',
        min_remaining_pct: 40,
      }),
      makeHistoryRow({
        quota_type: 'weekly_overage_included',
        expected_reset_at: '2026-05-21T15:00:00Z',
        min_remaining_pct: 55,
      }),
      makeHistoryRow({
        quota_type: 'special',
        expected_reset_at: '2026-05-28T15:00:00Z',
        min_remaining_pct: 70,
      }),
    ]
    const lanes = buildProviderLanes('anthropic', quotaRows, historyRows)
    const weeklyLane = lanes.find((lane) => lane.laneKey === 'anthropic/weekly')
    const overageLane = lanes.find(
      (lane) => lane.laneKey === 'anthropic/weekly_overage_included'
    )
    const specialLane = lanes.find(
      (lane) => lane.laneKey === 'anthropic/special'
    )
    expect(weeklyLane?.priorBars).toHaveLength(1)
    expect(overageLane?.priorBars).toHaveLength(1)
    expect(specialLane?.priorBars).toHaveLength(1)
    expect(overageLane?.priorBars[0].remainingPct).toBe(55)
  })

  test('test_anthropic_short_lane_has_current_bar', () => {
    const quotaRows = [makeAnthropicQuotaRow()]
    const lanes = buildProviderLanes('anthropic', quotaRows, [])
    const shortLane = lanes.find((l) => l.laneKey === 'anthropic/short')
    expect(shortLane).toBeDefined()
    expect(shortLane!.currentBar).not.toBeNull()
    expect(shortLane!.currentBar!.consumedPct).toBeCloseTo(1, 0) // 100 − 99 = 1
  })

  test('test_current_quota_segments_use_backend_velocity_scores', () => {
    const velocitySegments = Array.from({ length: 100 }, (_, i) => i === 2)
    const velocityScores = Array.from({ length: 100 }, (_, i) => {
      if (i === 0) return 0.4
      if (i === 1) return 1.2
      if (i === 2) return 7
      if (i === 3) return 35
      return 0
    })
    const quotaRows = [
      makeAnthropicQuotaRow({
        short_remaining_pct: 96.5,
        short_velocity_segments: velocitySegments,
        short_velocity_scores: velocityScores,
      }),
    ]
    const lanes = buildProviderLanes('anthropic', quotaRows, [])
    const shortLane = lanes.find((l) => l.laneKey === 'anthropic/short')
    const segments = shortLane!.currentBar!.segments

    expect(segments).toHaveLength(100)
    expect(segments[0].highVelocity).toBe(false)
    expect(segments[0].velocityClass).toBe('velocity-slow')
    expect(segments[1].highVelocity).toBe(false)
    expect(segments[1].velocityClass).toBe('velocity-steady')
    expect(segments[2].highVelocity).toBe(true)
    expect(segments[2].velocityClass).toBe('velocity-fast')
    expect(segments[3].highVelocity).toBe(true)
    expect(segments[3].velocityClass).toBe('velocity-hot')
    expect(segments[4].highVelocity).toBe(false)
    expect(segments[4].velocityClass).toBeUndefined()
  })

  test('test_anthropic_prior_bars_from_history', () => {
    const quotaRows = [makeAnthropicQuotaRow()]
    const historyRows: UsageReportQuotaHistoryRow[] = [
      makeHistoryRow({
        expected_reset_at: '2026-05-20T11:00:00Z',
        min_remaining_pct: 40,
      }),
      makeHistoryRow({
        expected_reset_at: '2026-05-20T06:00:00Z',
        min_remaining_pct: 60,
      }),
    ]
    const lanes = buildProviderLanes('anthropic', quotaRows, historyRows)
    const shortLane = lanes.find((l) => l.laneKey === 'anthropic/short')
    expect(shortLane!.priorBars).toHaveLength(2)
  })

  test('test_anthropic_prior_bars_deduped_against_current', () => {
    // A history row whose expected_reset_at rounds to the same slot as the
    // current bar's resetAt must be excluded from priorBars.
    const quotaRows = [makeAnthropicQuotaRow()]
    const historyRows: UsageReportQuotaHistoryRow[] = [
      makeHistoryRow({
        // Same rounded slot as the current bar's short_reset_at (05-20T21:00)
        expected_reset_at: '2026-05-20T21:00:00Z',
        min_remaining_pct: 10,
      }),
    ]
    const lanes = buildProviderLanes('anthropic', quotaRows, historyRows)
    const shortLane = lanes.find((l) => l.laneKey === 'anthropic/short')
    // Should be 0 prior bars since the only history row matches current.
    expect(shortLane!.priorBars).toHaveLength(0)
  })

  test('test_openai_has_4_lanes', () => {
    const openaiRow: UsageReportQuotaRow = {
      ...makeAnthropicQuotaRow(),
      provider: 'openai',
      short_special_remaining_pct: 75,
      short_special_reset_at: '2026-05-20T14:33:00Z',
      short_special_interval_start: '2026-05-20T09:33:00Z',
      short_special_interval_end: '2026-05-20T14:33:00Z',
      short_special_active: true,
      short_special_usage_tokens: 50,
    }
    const lanes = buildProviderLanes('openai', [openaiRow], [])
    expect(lanes.length).toBe(4)
    const keys = lanes.map((l) => l.laneKey)
    expect(keys).toContain('openai/short')
    expect(keys).toContain('openai/short_special')
    expect(keys).toContain('openai/weekly')
    expect(keys).toContain('openai/special')
  })

  test('test_openai_codex_spark_5hr_lane_keeps_current_bar_only', () => {
    const openaiRow: UsageReportQuotaRow = {
      ...makeAnthropicQuotaRow(),
      provider: 'openai',
      short_special_remaining_pct: 75,
      short_special_reset_at: '2026-05-20T14:33:00Z',
      short_special_interval_start: '2026-05-20T09:33:00Z',
      short_special_interval_end: '2026-05-20T14:33:00Z',
      short_special_active: true,
      short_special_usage_tokens: 50,
    }
    const historyRows: UsageReportQuotaHistoryRow[] = [
      makeHistoryRow({
        provider: 'openai',
        quota_type: 'short_special',
        expected_reset_at: '2026-05-20T09:30:00Z',
        interval_start: '2026-05-20T04:30:00Z',
        interval_end: '2026-05-20T09:30:00Z',
        min_remaining_pct: 20,
      }),
      makeHistoryRow({
        provider: 'openai',
        quota_type: 'short_special',
        expected_reset_at: '2026-05-20T04:30:00Z',
        interval_start: '2026-05-19T23:30:00Z',
        interval_end: '2026-05-20T04:30:00Z',
        min_remaining_pct: 10,
      }),
    ]

    const lanes = buildProviderLanes('openai', [openaiRow], historyRows)
    const spark5hLane = lanes.find((l) => l.laneKey === 'openai/short_special')

    expect(spark5hLane).toBeDefined()
    expect(spark5hLane!.currentBar).not.toBeNull()
    expect(spark5hLane!.priorBars).toHaveLength(0)
  })

  test('test_google_has_3_lanes_for_known_classes', () => {
    const makeGoogleRow = (
      model: string,
      shortPct: number
    ): UsageReportQuotaRow => ({
      ...makeAnthropicQuotaRow(),
      provider: 'google',
      model,
      short_remaining_pct: shortPct,
      short_active: true,
      weekly_remaining_pct: null,
      weekly_active: false,
      special_remaining_pct: null,
      special_active: false,
    })
    const quotaRows = [
      makeGoogleRow('gemini-2.5-flash', 98),
      makeGoogleRow('gemini-2.5-flash-lite', 58),
      makeGoogleRow('gemini-2.5-pro', 99),
    ]
    const lanes = buildProviderLanes('google', quotaRows, [])
    expect(lanes.length).toBe(3)
    const keys = lanes.map((l) => l.laneKey)
    expect(keys).toContain('google/flash-lite')
    expect(keys).toContain('google/flash')
    expect(keys).toContain('google/pro')
  })

  test('test_google_excludes_code_assist_model', () => {
    const makeGoogleRow = (
      model: string,
      shortPct: number
    ): UsageReportQuotaRow => ({
      ...makeAnthropicQuotaRow(),
      provider: 'google',
      model,
      short_remaining_pct: shortPct,
      short_active: true,
      weekly_remaining_pct: null,
      weekly_active: false,
      special_remaining_pct: null,
      special_active: false,
    })
    const quotaRows = [
      makeGoogleRow('gemini-2.5-flash', 98),
      // This model should be excluded (not flash/flash-lite/pro).
      makeGoogleRow('google_code_assist_requests:daily_request_pool', 0),
    ]
    const lanes = buildProviderLanes('google', quotaRows, [])
    // Only flash lane (flash-lite and pro have no rows).
    expect(lanes.length).toBe(1)
    expect(lanes[0].laneKey).toBe('google/flash')
  })

  test('test_antigravity_wtus_lanes_use_quota_key_identity', () => {
    const makeAntigravityRow = (
      quotaKey: string,
      remainingPct: number
    ): UsageReportQuotaRow => ({
      ...makeAnthropicQuotaRow(),
      provider: 'antigravity',
      model: quotaKey,
      weekly_active: false,
      weekly_remaining_pct: null,
      short_active: false,
      short_remaining_pct: null,
      special_active: false,
      special_remaining_pct: null,
      short_special_active: false,
      short_special_remaining_pct: null,
      monthly_active: false,
      monthly_remaining_pct: null,
      wtus_remaining_pct: remainingPct,
      wtus_reset_at: '2026-06-06T00:04:07Z',
      wtus_interval_start: '2026-06-05T19:04:12Z',
      wtus_interval_end: '9999-12-31T00:00:00Z',
      wtus_active: true,
      wtus_usage_tokens: 0,
      wtus_usage_breakdown: [],
    })
    const historyRows: UsageReportQuotaHistoryRow[] = [
      makeHistoryRow({
        provider: 'antigravity',
        model: 'antigravity_code_assist:gemini_pool',
        quota_type: 'wtus',
        expected_reset_at: '2026-06-05T14:51:55Z',
        interval_start: '2026-06-05T10:52:21Z',
        interval_end: '2026-06-05T14:51:55Z',
        min_remaining_pct: 100,
      }),
      makeHistoryRow({
        provider: 'antigravity',
        model: 'antigravity_code_assist:vertex_pool',
        quota_type: 'wtus',
        expected_reset_at: '2026-06-05T15:52:18Z',
        interval_start: '2026-06-05T10:52:21Z',
        interval_end: '2026-06-05T15:52:18Z',
        min_remaining_pct: 100,
      }),
    ]

    const lanes = buildProviderLanes(
      'antigravity',
      [
        makeAntigravityRow('antigravity_code_assist:gemini_pool', 88),
        makeAntigravityRow('antigravity_code_assist:vertex_pool', 76),
      ],
      historyRows
    )

    expect(lanes).toHaveLength(2)
    expect(lanes.map((lane) => lane.laneKey)).toEqual([
      'antigravity/gemini-pool',
      'antigravity/vertex-pool',
    ])
    expect(lanes.map((lane) => lane.laneLabel)).toEqual([
      'Gemini Pool · WTUs',
      'Vertex Pool · WTUs',
    ])
    expect(lanes[0].currentBar?.consumedPct).toBe(12)
    expect(lanes[1].currentBar?.consumedPct).toBe(24)
    expect(lanes[0].priorBars).toHaveLength(1)
    expect(lanes[1].priorBars).toHaveLength(1)
  })

  test('test_xai_grok_build_lanes_use_distinct_weekly_credits_and_monthly_requests', () => {
    const makeXaiRow = (
      quotaKey: string,
      quotaType: 'weekly' | 'monthly',
      remainingPct: number
    ): UsageReportQuotaRow => ({
      ...makeAnthropicQuotaRow(),
      provider: 'xai',
      model: quotaKey,
      weekly_remaining_pct: quotaType === 'weekly' ? remainingPct : null,
      weekly_active: quotaType === 'weekly',
      weekly_usage_tokens: 0,
      weekly_usage_breakdown: [],
      monthly_remaining_pct: quotaType === 'monthly' ? remainingPct : null,
      monthly_active: quotaType === 'monthly',
      monthly_usage_tokens: 0,
      monthly_usage_breakdown: [],
      short_active: false,
      special_active: false,
      short_special_active: false,
    })

    const lanes = buildProviderLanes(
      'xai',
      [
        makeXaiRow('xai_grok_build_weekly_credits:credits', 'weekly', 99),
        makeXaiRow('xai_grok_build_monthly_requests:requests', 'monthly', 98),
      ],
      []
    )

    expect(lanes).toHaveLength(2)
    expect(lanes.map((lane) => lane.laneKey)).toEqual([
      'xai/grok-build-weekly-credits',
      'xai/grok-build-monthly-requests',
    ])
    expect(lanes[0].currentBar?.remainingPct).toBe(99)
    expect(lanes[1].currentBar?.remainingPct).toBe(98)
  })
})

// ---------------------------------------------------------------------------
// Wave 43 — buildPriorBarFromHistory populates dateRangeLabel
// ---------------------------------------------------------------------------

describe('Wave 43 — buildPriorBarFromHistory dateRangeLabel', () => {
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

  test('test_prior_bar_dateRangeLabel_populated_from_interval_start_and_expected_reset_at', () => {
    const h = makeHistoryRow({
      interval_start: '2026-05-19T10:00:00Z',
      expected_reset_at: '2026-05-20T10:00:00Z',
    })
    const bar = buildPriorBarFromHistory(h, 'anthropic')
    expect(bar.dateRangeLabel).toBe('5/19 06:00 → 5/20 06:00')
  })

  test('test_prior_bar_dateRangeLabel_uses_snapped_boundaries', () => {
    // interval_start with sub-30-min offset — snapped to nearest slot
    const h = makeHistoryRow({
      interval_start: '2026-05-19T09:46:00Z',
      expected_reset_at: '2026-05-20T09:53:00Z',
    })
    const bar = buildPriorBarFromHistory(h, 'anthropic')
    // Both snap to :00 of the hour
    expect(bar.dateRangeLabel).toBe('5/19 06:00 → 5/20 06:00')
  })

  // S1-T5: renamed *_undefined_when_* → *_dash_when_* to assert '—' explicitly.
  test('test_prior_bar_dateRangeLabel_dash_when_interval_start_is_null', () => {
    const h = makeHistoryRow({
      interval_start: null,
      expected_reset_at: '2026-05-20T10:00:00Z',
    })
    const bar = buildPriorBarFromHistory(h, 'anthropic')
    // fmtIntervalCompact returns '—' for null start; field is still set
    expect(bar.dateRangeLabel).toBe('—')
  })

  test('test_prior_bar_dateRangeLabel_dash_when_expected_reset_at_is_null', () => {
    const h = makeHistoryRow({
      interval_start: '2026-05-19T10:00:00Z',
      expected_reset_at: null,
    })
    const bar = buildPriorBarFromHistory(h, 'anthropic')
    expect(bar.dateRangeLabel).toBe('—')
  })

  test('test_prior_bar_timeAgoLabel_and_dateRangeLabel_both_set', () => {
    const h = makeHistoryRow({
      interval_start: '2026-05-19T10:00:00Z',
      expected_reset_at: '2026-05-20T10:00:00Z',
    })
    const bar = buildPriorBarFromHistory(h, 'anthropic')
    expect(bar.timeAgoLabel).toBeDefined()
    expect(bar.dateRangeLabel).toBeDefined()
    expect(bar.dateRangeLabel).toContain('→')
  })

  test('test_prior_bar_uses_history_velocity_scores', () => {
    const velocitySegments = Array.from({ length: 100 }, (_, i) => i === 2)
    const velocityScores = Array.from({ length: 100 }, (_, i) => {
      if (i === 0) return 0.5
      if (i === 1) return 1.2
      if (i === 2) return 8
      if (i === 3) return 35
      return 0
    })
    const h = makeHistoryRow({
      min_remaining_pct: 96,
      velocity_segments: velocitySegments,
      velocity_scores: velocityScores,
    })
    const bar = buildPriorBarFromHistory(h, 'anthropic')

    expect(bar.segments).toHaveLength(100)
    expect(bar.segments[0].highVelocity).toBe(false)
    expect(bar.segments[0].velocityClass).toBe('velocity-slow')
    expect(bar.segments[1].highVelocity).toBe(false)
    expect(bar.segments[1].velocityClass).toBe('velocity-steady')
    expect(bar.segments[2].highVelocity).toBe(true)
    expect(bar.segments[2].velocityClass).toBe('velocity-fast')
    expect(bar.segments[3].highVelocity).toBe(true)
    expect(bar.segments[3].velocityClass).toBe('velocity-hot')
    expect(bar.segments[4].velocityClass).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// S1-3: buildPriorBarFromHistory — null min_remaining_pct must NOT render as
//        100% consumed (regression guard for the fixed ?? 0 fallback).
// ---------------------------------------------------------------------------

describe('S1-3 — buildPriorBarFromHistory null min_remaining_pct', () => {
  test('test_buildPriorBarFromHistory_null_remaining_is_not_full_consumption', () => {
    const h: UsageReportQuotaHistoryRow = {
      provider: 'anthropic',
      model: null,
      quota_type: 'short',
      expected_reset_at: '2026-05-20T11:00:00Z',
      interval_start: '2026-05-20T06:00:00Z',
      interval_end: '2026-05-20T11:00:00Z',
      min_remaining_pct: null, // ← the null case under test
      max_remaining_pct: null,
      usage_tokens: 0,
      usage_breakdown: [],
    }

    const bar = buildPriorBarFromHistory(h, 'anthropic')

    expect(bar.consumedPct).not.toBe(100)
    // Guard: remainingPct should not be 0 when input was null
    expect(bar.remainingPct).not.toBe(0)
  })
})

// ---------------------------------------------------------------------------
// S1-4: buildProviderLanes — distinct null-reset history rows dedupe by
//        interval_start (regression guard).
// ---------------------------------------------------------------------------

describe('S1-4 — buildProviderLanes distinct null-reset rows not collapsed', () => {
  function makeAnthropicQuotaRow(
    overrides: Partial<UsageReportQuotaRow> = {}
  ): UsageReportQuotaRow {
    return {
      provider: 'anthropic',
      model: null,
      weekly_remaining_pct: null,
      weekly_reset_at: null,
      weekly_interval_start: null,
      weekly_interval_end: null,
      weekly_active: false,
      weekly_usage_tokens: 0,
      weekly_usage_breakdown: [],
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
      monthly_remaining_pct: null,
      monthly_reset_at: null,
      monthly_interval_start: null,
      monthly_interval_end: null,
      monthly_active: false,
      monthly_usage_tokens: 0,
      monthly_usage_breakdown: [],
      wtus_remaining_pct: null,
      wtus_reset_at: null,
      wtus_interval_start: null,
      wtus_interval_end: null,
      wtus_active: false,
      wtus_usage_tokens: 0,
      wtus_usage_breakdown: [],
      ...overrides,
    }
  }

  test('test_buildProviderLanes_distinct_null_reset_rows_not_collapsed', () => {
    const historyRows: UsageReportQuotaHistoryRow[] = [
      {
        provider: 'anthropic',
        model: null,
        quota_type: 'weekly',
        expected_reset_at: null, // ← null reset
        interval_start: '2026-05-01T00:00:00Z', // distinct A
        interval_end: '2026-05-08T00:00:00Z',
        min_remaining_pct: 80,
        max_remaining_pct: 100,
        usage_tokens: 500,
        usage_breakdown: [],
      },
      {
        provider: 'anthropic',
        model: null,
        quota_type: 'weekly',
        expected_reset_at: null, // ← also null reset
        interval_start: '2026-04-24T00:00:00Z', // distinct B
        interval_end: '2026-05-01T00:00:00Z',
        min_remaining_pct: 60,
        max_remaining_pct: 100,
        usage_tokens: 800,
        usage_breakdown: [],
      },
    ]

    // Current bar must be present so lanes aren't filtered out
    const currentQuotaRow = makeAnthropicQuotaRow({
      weekly_active: true,
      weekly_remaining_pct: 50,
      weekly_reset_at: '2026-05-15T00:00:00Z',
      weekly_interval_start: '2026-05-08T00:00:00Z',
      weekly_interval_end: '2026-05-15T00:00:00Z',
      weekly_usage_tokens: 1000,
    })

    const lanes = buildProviderLanes(
      'anthropic',
      [currentQuotaRow],
      historyRows
    )

    // Find the weekly lane
    const weeklyLane = lanes.find((l) => l.laneKey?.includes('weekly'))
    expect(weeklyLane).toBeDefined()

    expect(weeklyLane!.priorBars).toHaveLength(2)
  })
})
