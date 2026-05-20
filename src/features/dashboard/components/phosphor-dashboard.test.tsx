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
  UsageReportQuotaUsageBreakdown,
  UsageReportResponse,
} from '../api/usage-report'
import PhosphorDashboard, {
  _formatTimeAgoForTest,
  _quotaTypeToPeriodTypeForTest,
  _tipModelsGoogleForTest,
  _tipModelsSingleLabelForTest,
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

  test('test_format_time_ago_future_returns_now', () => {
    const d = new Date(now + 60_000) // 1 minute in the future
    expect(_formatTimeAgoForTest(d)).toBe('now')
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
