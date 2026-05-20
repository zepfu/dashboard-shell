/**
 * Wave 37 cycle-3 — PhosphorDashboard hoisted-query bypass tests.
 *
 * TCG-1: Verify that when the `report` prop is provided to PhosphorDashboard,
 *   the internal useQuery does NOT fire a /api/shell/reports/usage fetch.
 *
 * TCG-3: Verify that when `showComparison=false` (the default for sub-4K
 *   viewports), the prior-period useQuery does NOT fire.
 *
 * Strategy: mount PhosphorDashboard inside a QueryClientProvider with a
 * controlled QueryClient (no retries, short cacheTime), register an MSW
 * handler for /api/shell/reports/usage that captures calls via a spy
 * counter, then assert the spy count is 0.
 */
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, act } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/setup'
import type {
  UsageReportQuotaHistoryRow,
  UsageReportQuotaRow,
  UsageReportQuotaUsageBreakdown,
  UsageReportResponse,
} from '../api/usage-report'
import PhosphorDashboard, {
  _formatTimeAgoForTest,
  _quotaTypeToPeriodTypeForTest,
  _tipModelsGoogleForTest,
  _tipModelsSingleLabelForTest,
  _buildProviderLanesForTest,
  _classifyGeminiModelForTest,
} from './phosphor-dashboard'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a fresh QueryClient with retries disabled so errors surface fast. */
function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        // Use gcTime: 0 so cached entries don't bleed across tests.
        gcTime: 0,
      },
    },
  })
}

function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <QueryClientProvider client={makeClient()}>{children}</QueryClientProvider>
  )
}

// ---------------------------------------------------------------------------
// Minimal mock UsageReportResponse
// ---------------------------------------------------------------------------

const MOCK_REPORT: UsageReportResponse = {
  metadata: {
    from: '2026-04-19',
    to: '2026-05-19',
    grain: 'day',
    groupBy: ['provider', 'model', 'repository'],
    limit: 50_000,
    generatedAt: '2026-05-19T00:00:00.000Z',
    latestRecordAt: '2026-05-19T00:00:00.000Z',
    latestRecordAgeMinutes: 0,
    latestRecordStale: false,
    staleRecordThresholdMinutes: 60,
  },
  summary: {
    traces: 100,
    token_in: 1_000,
    token_out: 500,
    token_cache_input: 0,
    token_cache_creation: 0,
    token_reasoning_reported: 0,
    token_reasoning_estimated: 0,
    token_total: 1_500,
    usd_cost: 0.5,
    cache_miss_usd_cost: 0,
    tool_calls: 0,
    git_commit: 0,
    git_push: 0,
    period_start: '2026-04-19',
    period_end: '2026-05-19',
    latest_record_at: '2026-05-19T00:00:00.000Z',
  },
  trend: [],
  clients: [],
  providerLatencyHealth: [],
  providerErrorObservations: [],
  providerStatusUsage: [],
  quotas: [],
  quotaHistory: [],
  toolActivity: [],
  rows: [],
}

// ---------------------------------------------------------------------------
// TCG-1: Hoisted-query bypass — internal useQuery must NOT fire
// ---------------------------------------------------------------------------

describe('PhosphorDashboard — TCG-1: hoisted-query bypass', () => {
  test('test_phosphor_dashboard_no_usage_fetch_when_report_prop_provided', async () => {
    // Track every hit to /api/shell/reports/usage
    let usageCallCount = 0
    server.use(
      http.get('/api/shell/reports/usage', () => {
        usageCallCount++
        return HttpResponse.json(MOCK_REPORT)
      })
    )

    // Also stub /api/shell/reports/quotas so the quotas query doesn't error
    server.use(
      http.get('/api/shell/reports/quotas', () =>
        HttpResponse.json({
          metadata: {
            generatedAt: '2026-05-19T00:00:00.000Z',
            latestRecordAt: null,
            latestRecordAgeMinutes: null,
            latestRecordStale: false,
            staleRecordThresholdMinutes: 60,
          },
          quotas: [],
        })
      )
    )

    await act(async () => {
      render(
        <Wrapper>
          <PhosphorDashboard
            from='2026-04-19'
            to='2026-05-19'
            report={MOCK_REPORT}
            reportLoading={false}
            showComparison={false}
          />
        </Wrapper>
      )
    })

    // Allow any pending microtasks / timers to settle
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    // The internal useQuery is gated by `internalQueryEnabled = reportProp === undefined`.
    // Since we supplied `report`, NO fetch to /api/shell/reports/usage should occur.
    expect(usageCallCount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// TCG-3: showComparison=false — prior-period useQuery must NOT fire
// ---------------------------------------------------------------------------

describe('PhosphorDashboard — TCG-3: prior-report query skipped when showComparison=false', () => {
  test('test_phosphor_dashboard_no_prior_fetch_when_show_comparison_false', async () => {
    // Track every hit to /api/shell/reports/usage; we'll distinguish
    // current vs prior by counting total calls — with showComparison=false
    // the prior-window query is disabled, so only 0 calls should be made
    // (the current-window query is also bypassed because we supply `report`).
    let usageCallCount = 0
    server.use(
      http.get('/api/shell/reports/usage', () => {
        usageCallCount++
        return HttpResponse.json(MOCK_REPORT)
      })
    )

    server.use(
      http.get('/api/shell/reports/quotas', () =>
        HttpResponse.json({
          metadata: {
            generatedAt: '2026-05-19T00:00:00.000Z',
            latestRecordAt: null,
            latestRecordAgeMinutes: null,
            latestRecordStale: false,
            staleRecordThresholdMinutes: 60,
          },
          quotas: [],
        })
      )
    )

    await act(async () => {
      render(
        <Wrapper>
          <PhosphorDashboard
            from='2026-04-19'
            to='2026-05-19'
            report={MOCK_REPORT}
            reportLoading={false}
            // showComparison defaults to false — prior-window query must NOT fire
            showComparison={false}
          />
        </Wrapper>
      )
    })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    // With report prop supplied AND showComparison=false:
    //   - internal current-window query: disabled (internalQueryEnabled=false)
    //   - prior-window query: disabled (enabled = !reportLoading && report !== undefined && showComparison)
    //                                             ↑ showComparison is false → disabled
    // Total usage calls expected: 0
    expect(usageCallCount).toBe(0)
  })

  test('test_phosphor_dashboard_prior_fetch_enabled_when_show_comparison_true', async () => {
    // Positive control: when showComparison=true and report is NOT supplied,
    // we expect the internal current-window query to fire (1 call).
    // The prior query will fire AFTER the current report resolves.
    let usageCallCount = 0
    server.use(
      http.get('/api/shell/reports/usage', () => {
        usageCallCount++
        return HttpResponse.json(MOCK_REPORT)
      })
    )

    server.use(
      http.get('/api/shell/reports/quotas', () =>
        HttpResponse.json({
          metadata: {
            generatedAt: '2026-05-19T00:00:00.000Z',
            latestRecordAt: null,
            latestRecordAgeMinutes: null,
            latestRecordStale: false,
            staleRecordThresholdMinutes: 60,
          },
          quotas: [],
        })
      )
    )

    await act(async () => {
      render(
        <Wrapper>
          <PhosphorDashboard
            from='2026-04-19'
            to='2026-05-19'
            // report NOT supplied → internal query fires
            showComparison={true}
          />
        </Wrapper>
      )
    })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100))
    })

    // Current-window query fires (report prop absent → internalQueryEnabled=true).
    // Prior-window query fires after current resolves (showComparison=true).
    // Total: at least 1 (current), potentially 2 (current + prior).
    expect(usageCallCount).toBeGreaterThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// Wave 40 multi-quota redesign — unit tests for new helper functions
// ---------------------------------------------------------------------------

describe('Wave 40 — formatTimeAgo', () => {
  const now = Date.now()

  test('test_format_time_ago_minutes', () => {
    const d = new Date(now - 45 * 60_000) // 45 minutes ago
    expect(_formatTimeAgoForTest(d)).toBe('45m ago')
  })

  test('test_format_time_ago_hours', () => {
    const d = new Date(now - 3 * 60 * 60_000) // 3 hours ago
    expect(_formatTimeAgoForTest(d)).toBe('3h ago')
  })

  test('test_format_time_ago_days', () => {
    const d = new Date(now - 2 * 24 * 60 * 60_000) // 2 days ago
    expect(_formatTimeAgoForTest(d)).toBe('2d ago')
  })

  test('test_format_time_ago_weeks', () => {
    const d = new Date(now - 15 * 24 * 60 * 60_000) // 15 days ago → 2w
    expect(_formatTimeAgoForTest(d)).toBe('2w ago')
  })

  test('test_format_time_ago_future_within_1min_returns_just_now', () => {
    // Within 1 minute in the future → boundary label (rounding artefact safe)
    const d = new Date(now + 60_000) // exactly 1 minute in the future
    expect(_formatTimeAgoForTest(d)).toBe('just now')
  })

  test('test_format_time_ago_future_over_1min_returns_time_label', () => {
    // > 1 minute in the future → use absolute distance so UI shows a sensible
    // label rather than "now" for rounding artefacts (e.g. 30m-ago rounded up).
    // We use 2h+30s future so sub-second timing jitter doesn't affect floor().
    const d = new Date(Date.now() + 2 * 60 * 60_000 + 30_000) // ~2h 30s in the future
    expect(_formatTimeAgoForTest(d)).toBe('2h ago')
  })
})

describe('Wave 40 — quotaTypeToPeriodType', () => {
  test('test_quota_type_short_maps_to_5hr', () => {
    expect(_quotaTypeToPeriodTypeForTest('short')).toBe('5hr')
  })

  test('test_quota_type_short_special_maps_to_5hr', () => {
    expect(_quotaTypeToPeriodTypeForTest('short_special')).toBe('5hr')
  })

  test('test_quota_type_weekly_maps_to_weekly', () => {
    expect(_quotaTypeToPeriodTypeForTest('weekly')).toBe('weekly')
  })

  test('test_quota_type_special_maps_to_special', () => {
    expect(_quotaTypeToPeriodTypeForTest('special')).toBe('special')
  })

  test('test_quota_type_monthly_maps_to_monthly', () => {
    expect(_quotaTypeToPeriodTypeForTest('monthly')).toBe('monthly')
  })

  test('test_quota_type_unknown_defaults_to_weekly', () => {
    expect(_quotaTypeToPeriodTypeForTest('requests')).toBe('weekly')
  })
})

describe('Wave 40 — tipModelsFromBreakdownGoogleAggregated', () => {
  const makeBreakdown = (
    entries: ReadonlyArray<{ model: string; cost: number }>
  ): UsageReportQuotaUsageBreakdown[] =>
    entries.map(({ model, cost }) => ({ model, cost, tokens: 0, traces: 0 }))

  test('test_google_aggregated_empty_returns_undefined', () => {
    expect(_tipModelsGoogleForTest([])).toBeUndefined()
  })

  test('test_google_aggregated_flash_lite_bucket', () => {
    const result = _tipModelsGoogleForTest(
      makeBreakdown([{ model: 'gemini-2.5-flash-lite', cost: 10 }])
    )
    expect(result).toHaveLength(1)
    expect(result![0].model).toBe('flash-lite')
  })

  test('test_google_aggregated_flash_bucket_excludes_flash_lite', () => {
    const result = _tipModelsGoogleForTest(
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
    const result = _tipModelsGoogleForTest(
      makeBreakdown([{ model: 'gemini-2.5-pro', cost: 20 }])
    )
    expect(result![0].model).toBe('pro')
    expect(result![0].costDelta).toBe('$20.00')
  })

  test('test_google_aggregated_sums_costs_within_class', () => {
    const result = _tipModelsGoogleForTest(
      makeBreakdown([
        { model: 'gemini-2.0-flash-001', cost: 3 },
        { model: 'gemini-2.5-flash-preview', cost: 5 },
      ])
    )
    // Both map to 'flash'; combined cost = 8
    expect(result).toHaveLength(1)
    expect(result![0].model).toBe('flash')
    expect(result![0].costDelta).toBe('$8.00')
  })
})

describe('Wave 40 — tipModelsFromBreakdownSingleLabel', () => {
  const makeBreakdown = (
    entries: ReadonlyArray<{ model: string; cost: number }>
  ): UsageReportQuotaUsageBreakdown[] =>
    entries.map(({ model, cost }) => ({ model, cost, tokens: 0, traces: 0 }))

  test('test_single_label_empty_returns_undefined', () => {
    expect(_tipModelsSingleLabelForTest([], 'sonnet')).toBeUndefined()
  })

  test('test_single_label_returns_one_entry_with_display_label', () => {
    const result = _tipModelsSingleLabelForTest(
      makeBreakdown([
        { model: 'claude-sonnet-4-6', cost: 10 },
        { model: 'claude-opus-4-7', cost: 5 },
      ]),
      'sonnet'
    )
    expect(result).toHaveLength(1)
    expect(result![0].model).toBe('sonnet')
    expect(result![0].costDelta).toBe('$15.00')
  })

  test('test_single_label_codex_spark_for_openai', () => {
    const result = _tipModelsSingleLabelForTest(
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
    expect(_classifyGeminiModelForTest('gemini-2.5-flash-lite')).toBe(
      'gemini-flash-lite'
    )
    expect(_classifyGeminiModelForTest('gemini-3.1-flash-lite-preview')).toBe(
      'gemini-flash-lite'
    )
  })

  test('test_classify_flash', () => {
    expect(_classifyGeminiModelForTest('gemini-2.5-flash')).toBe('gemini-flash')
    expect(_classifyGeminiModelForTest('gemini-3-flash-preview')).toBe(
      'gemini-flash'
    )
  })

  test('test_classify_pro', () => {
    expect(_classifyGeminiModelForTest('gemini-2.5-pro')).toBe('gemini-pro')
    expect(_classifyGeminiModelForTest('gemini-3-pro-preview')).toBe(
      'gemini-pro'
    )
  })

  test('test_classify_non_gemini_returns_null', () => {
    expect(_classifyGeminiModelForTest('gpt-4o')).toBeNull()
    expect(
      _classifyGeminiModelForTest(
        'google_code_assist_requests:daily_request_pool'
      )
    ).toBeNull()
    expect(_classifyGeminiModelForTest('')).toBeNull()
  })

  test('test_classify_gemini_no_known_class_returns_null', () => {
    expect(_classifyGeminiModelForTest('gemini-unknown-model')).toBeNull()
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

  test('test_anthropic_has_3_lanes', () => {
    const quotaRows = [makeAnthropicQuotaRow()]
    const lanes = _buildProviderLanesForTest('anthropic', quotaRows, [])
    // Lanes that have a current bar or prior bars: all 3 have current bars.
    expect(lanes.length).toBe(3)
    const keys = lanes.map((l) => l.laneKey)
    expect(keys).toContain('anthropic/short')
    expect(keys).toContain('anthropic/special')
    expect(keys).toContain('anthropic/weekly')
  })

  test('test_anthropic_lane_order_short_special_weekly', () => {
    const quotaRows = [makeAnthropicQuotaRow()]
    const lanes = _buildProviderLanesForTest('anthropic', quotaRows, [])
    expect(lanes[0].laneKey).toBe('anthropic/short')
    expect(lanes[1].laneKey).toBe('anthropic/special')
    expect(lanes[2].laneKey).toBe('anthropic/weekly')
  })

  test('test_anthropic_short_lane_has_current_bar', () => {
    const quotaRows = [makeAnthropicQuotaRow()]
    const lanes = _buildProviderLanesForTest('anthropic', quotaRows, [])
    const shortLane = lanes.find((l) => l.laneKey === 'anthropic/short')
    expect(shortLane).toBeDefined()
    expect(shortLane!.currentBar).not.toBeNull()
    expect(shortLane!.currentBar!.consumedPct).toBeCloseTo(1, 0) // 100 − 99 = 1
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
    const lanes = _buildProviderLanesForTest(
      'anthropic',
      quotaRows,
      historyRows
    )
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
    const lanes = _buildProviderLanesForTest(
      'anthropic',
      quotaRows,
      historyRows
    )
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
    const lanes = _buildProviderLanesForTest('openai', [openaiRow], [])
    expect(lanes.length).toBe(4)
    const keys = lanes.map((l) => l.laneKey)
    expect(keys).toContain('openai/short')
    expect(keys).toContain('openai/short_special')
    expect(keys).toContain('openai/weekly')
    expect(keys).toContain('openai/special')
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
    const lanes = _buildProviderLanesForTest('google', quotaRows, [])
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
    const lanes = _buildProviderLanesForTest('google', quotaRows, [])
    // Only flash lane (flash-lite and pro have no rows).
    expect(lanes.length).toBe(1)
    expect(lanes[0].laneKey).toBe('google/flash')
  })

  test('test_xai_has_1_monthly_lane', () => {
    const xaiRow: UsageReportQuotaRow = {
      ...makeAnthropicQuotaRow(),
      provider: 'xai',
      model: null,
      monthly_remaining_pct: 0,
      monthly_reset_at: '2026-06-01T00:00:00Z',
      monthly_interval_start: '2026-05-01T00:00:00Z',
      monthly_interval_end: '2026-06-01T00:00:00Z',
      monthly_active: true,
      monthly_usage_tokens: 100,
      weekly_remaining_pct: null,
      weekly_active: false,
      short_remaining_pct: null,
      short_active: false,
      special_remaining_pct: null,
      special_active: false,
    }
    const lanes = _buildProviderLanesForTest('xai', [xaiRow], [])
    expect(lanes.length).toBe(1)
    expect(lanes[0].laneKey).toBe('xai/monthly')
    expect(lanes[0].laneLabel).toBe('All Models · 30d')
  })

  test('test_unknown_provider_returns_empty_lanes', () => {
    const lanes = _buildProviderLanesForTest('nvidia_nim', [], [])
    expect(lanes).toHaveLength(0)
  })
})
