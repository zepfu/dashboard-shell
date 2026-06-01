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
import {
  render,
  act,
  fireEvent,
  waitFor,
  screen,
  within,
} from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/setup'
import type {
  UsageReportQuotaEstimatorResponse,
  UsageReportProviderErrorObservationRow,
  UsageReportProviderLatencyHealthRow,
  UsageReportQuotaHistoryRow,
  UsageReportQuotaRow,
  UsageReportQuotaUsageBreakdown,
  UsageReportResponse,
  UsageReportTrendRow,
} from '../api/usage-report'
import PhosphorDashboard, {
  _buildRepoRowsForTest,
  _formatTimeAgoForTest,
  _quotaTypeToPeriodTypeForTest,
  _tipModelsGoogleForTest,
  _tipModelsSingleLabelForTest,
  _padHealthCellsForTest,
  _buildAggregateHealthCellsForTest,
  _buildProviderLanesForTest,
  _classifyGeminiModelForTest,
  _fmtIntervalCompactForTest,
  _buildPriorBarFromHistoryForTest,
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

beforeEach(() => {
  server.use(
    http.get('/api/shell/reports/usage/tool-activity', () =>
      HttpResponse.json({
        metadata: {
          from: '2026-04-19',
          to: '2026-05-19',
          generatedAt: '2026-05-19T00:00:00.000Z',
        },
        toolActivity: [],
      })
    )
  )
  server.use(
    http.get('/api/shell/reports/usage/quota-history', () =>
      HttpResponse.json({
        metadata: {
          generatedAt: '2026-05-19T00:00:00.000Z',
        },
        quotaHistory: [],
      })
    )
  )
  server.use(
    http.get('/api/shell/reports/usage/quota-estimator', () =>
      HttpResponse.json({
        metadata: {
          from: '2026-04-19',
          to: '2026-05-19',
          generatedAt: '2026-05-19T00:00:00.000Z',
          phase: '0-2',
          lagCandidatesMinutes: [0, 1, 5, 10, 30, 60],
          estimatorVersion: 'quota-weight-phase0-2-v1',
        },
        phase0Audit: {
          source_database: 'aawm_tristore',
          usage_event_shape: {},
          quota_pct_interval_shape: {},
          provider_lane_policy: {},
          known_missing_fields: [],
        },
        estimates: [],
      } satisfies UsageReportQuotaEstimatorResponse)
    )
  )
})

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
  tokenTrendHours: [],
  tokenTrendVersions: [],
  clients: [],
  providerLatencyHealth: [],
  providerErrorObservations: [],
  providerStatusUsage: [],
  quotas: [],
  quotaHistory: [],
  toolActivity: [],
  rows: [],
}

test('test_buildRepoRows_merges_trailing_memory_suffix_rows', () => {
  const rows = [
    {
      repository: 'dashboard-shell',
      token_total: 1000,
      usd_cost: 0.1,
      traces: 10,
      model: 'gpt-5.5',
    },
    {
      repository: 'dashboard-shell (memory)',
      token_total: 500,
      usd_cost: 0.05,
      traces: 5,
      model: 'gpt-5.5',
    },
    {
      repository: 'aawm-tap',
      token_total: 250,
      usd_cost: 0.02,
      traces: 2,
      model: 'claude-sonnet-4-5',
    },
  ]
  const trendRows: UsageReportTrendRow[] = [
    {
      bucket: '2026-05-20T00:00:00.000Z',
      provider: 'openai',
      model: 'gpt-5.5',
      repository: 'dashboard-shell',
      traces: 10,
      token_total: 100,
      usd_cost: 0.01,
    },
    {
      bucket: '2026-05-20T00:00:00.000Z',
      provider: 'openai',
      model: 'gpt-5.5',
      repository: 'dashboard-shell (memory)',
      traces: 5,
      token_total: 50,
      usd_cost: 0.005,
    },
    {
      bucket: '2026-05-20T01:00:00.000Z',
      provider: 'openai',
      model: 'gpt-5.5',
      repository: 'dashboard-shell (memory)',
      traces: 4,
      token_total: 75,
      usd_cost: 0.0075,
    },
  ]

  const repoRows = _buildRepoRowsForTest(rows, trendRows)
  const shellRows = repoRows.filter((row) =>
    row.repository.startsWith('dashboard-shell')
  )

  expect(shellRows).toHaveLength(1)
  expect(shellRows[0]).toMatchObject({
    repository: 'dashboard-shell',
    tokens: 1500,
    traces: 15,
    top_model: 'gpt-5.5',
    spark: [150, 75],
  })
  expect(shellRows[0].cost_usd).toBeCloseTo(0.15)
})

// ---------------------------------------------------------------------------
// TCG-1: Hoisted-query bypass — internal useQuery must NOT fire
// ---------------------------------------------------------------------------

describe('PhosphorDashboard — TCG-1: hoisted-query bypass', () => {
  test('test_section_refresh_controls_render_and_call_refresh_handlers', async () => {
    const onRefreshReport = vi.fn()
    const onRefreshQuotas = vi.fn()
    const onRefreshQuotaHistory = vi.fn()
    const onRefreshQuotaRangeHistory = vi.fn()

    server.use(
      http.get('/api/shell/reports/usage/token-trend-summary', () =>
        HttpResponse.json({
          metadata: {
            from: '2026-05-20',
            to: '2026-05-21',
          },
          tokenTrendHours: [],
          tokenTrendVersions: [],
        })
      )
    )

    await act(async () => {
      render(
        <Wrapper>
          <PhosphorDashboard
            from='2026-05-20'
            to='2026-05-21'
            report={MOCK_REPORT}
            reportLoading={false}
            showComparison={false}
            quotas={[]}
            quotaHistory={[]}
            onRefreshReport={onRefreshReport}
            onRefreshQuotas={onRefreshQuotas}
            onRefreshQuotaHistory={onRefreshQuotaHistory}
            onRefreshQuotaRangeHistory={onRefreshQuotaRangeHistory}
          />
        </Wrapper>
      )
    })

    expect(
      screen.getByRole('button', {
        name: /refresh provider data/i,
      })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /refresh model ledger data/i })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: /refresh repository breakdown data/i,
      })
    ).toBeNull()
    expect(
      screen.getByRole('button', { name: /refresh token trend data/i })
    ).toBeInTheDocument()

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /refresh model ledger data/i })
      ).toBeEnabled()
    })
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /refresh model ledger data/i })
      )
    })
    expect(onRefreshReport).toHaveBeenCalledTimes(1)

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', {
          name: /refresh provider data/i,
        })
      )
    })
    expect(onRefreshReport).toHaveBeenCalledTimes(2)
    expect(onRefreshQuotas).toHaveBeenCalledTimes(1)
    expect(onRefreshQuotaHistory).toHaveBeenCalledTimes(1)
    expect(onRefreshQuotaRangeHistory).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Quota' }))
    })
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', {
          name: /refresh provider data/i,
        })
      )
    })
    expect(onRefreshReport).toHaveBeenCalledTimes(2)
    expect(onRefreshQuotas).toHaveBeenCalledTimes(2)
    expect(onRefreshQuotaHistory).toHaveBeenCalledTimes(1)
    expect(onRefreshQuotaRangeHistory).toHaveBeenCalledTimes(1)
  })

  test('test_providers_section_has_health_and_quota_tabs', async () => {
    const quotaHistoryRow = (
      overrides: Partial<UsageReportQuotaHistoryRow>
    ): UsageReportQuotaHistoryRow => ({
      provider: 'openai',
      model: null,
      quota_type: 'weekly',
      expected_reset_at: '2026-05-21T00:00:00.000Z',
      interval_start: '2026-05-14T00:00:00.000Z',
      interval_end: '2026-05-21T00:00:00.000Z',
      min_remaining_pct: 60,
      max_remaining_pct: 100,
      velocity_segments: [],
      velocity_scores: [],
      velocity_sample_count: 0,
      usage_tokens: 1000,
      usage_breakdown: [
        {
          model: 'gpt-5.5',
          tokens: 1000,
          cost: 1,
          traces: 5,
          recent_traces_90m: 0,
        },
      ],
      ...overrides,
    })
    const report: UsageReportResponse = {
      ...MOCK_REPORT,
      quotaRangeHistory: [
        quotaHistoryRow({}),
        quotaHistoryRow({
          expected_reset_at: '2026-05-22T00:00:00.000Z',
          interval_start: '2026-05-15T00:00:00.000Z',
          interval_end: '2026-05-22T00:00:00.000Z',
          min_remaining_pct: 45,
          usage_tokens: 2000,
          usage_breakdown: [
            {
              model: 'gpt-5.5',
              tokens: 2000,
              cost: 2,
              traces: 8,
              recent_traces_90m: 0,
            },
          ],
        }),
        quotaHistoryRow({
          quota_type: 'special',
          expected_reset_at: '2026-05-23T00:00:00.000Z',
          interval_start: '2026-05-16T00:00:00.000Z',
          interval_end: '2026-05-23T00:00:00.000Z',
          min_remaining_pct: 80,
          usage_tokens: 500,
          usage_breakdown: [
            {
              model: 'codex-spark',
              tokens: 500,
              cost: 0.5,
              traces: 2,
              recent_traces_90m: 0,
            },
          ],
        }),
        quotaHistoryRow({
          quota_type: 'short',
          expected_reset_at: '2026-05-23T05:00:00.000Z',
          interval_start: '2026-05-23T00:00:00.000Z',
          interval_end: '2026-05-23T05:00:00.000Z',
          usage_tokens: 700,
        }),
        quotaHistoryRow({
          provider: 'anthropic',
          quota_type: 'weekly',
          expected_reset_at: '2026-05-22T00:00:00.000Z',
          interval_start: '2026-05-15T00:00:00.000Z',
          interval_end: '2026-05-22T00:00:00.000Z',
          usage_tokens: 1200,
        }),
        quotaHistoryRow({
          provider: 'anthropic',
          quota_type: 'short',
          expected_reset_at: '2026-05-22T05:00:00.000Z',
          interval_start: '2026-05-22T00:00:00.000Z',
          interval_end: '2026-05-22T05:00:00.000Z',
          usage_tokens: 800,
        }),
        quotaHistoryRow({
          provider: 'google',
          model: 'gemini-2.5-flash-lite',
          quota_type: 'short',
          expected_reset_at: '2026-05-24T00:00:00.000Z',
          interval_start: '2026-05-23T00:00:00.000Z',
          interval_end: '2026-05-24T00:00:00.000Z',
          min_remaining_pct: 55,
          usage_tokens: 300,
          usage_breakdown: [
            {
              model: 'gemini-2.5-flash-lite',
              tokens: 300,
              cost: 0.3,
              traces: 3,
              recent_traces_90m: 0,
            },
          ],
        }),
        quotaHistoryRow({
          provider: 'google',
          model: 'gemini-3.1-flash-lite-preview',
          quota_type: 'short',
          expected_reset_at: '2026-05-24T00:00:00.000Z',
          interval_start: '2026-05-23T00:00:00.000Z',
          interval_end: '2026-05-24T00:00:00.000Z',
          min_remaining_pct: 50,
          usage_tokens: 700,
          usage_breakdown: [
            {
              model: 'gemini-3.1-flash-lite-preview',
              tokens: 700,
              cost: 0.7,
              traces: 7,
              recent_traces_90m: 0,
            },
          ],
        }),
        quotaHistoryRow({
          provider: 'xai',
          quota_type: 'monthly',
          expected_reset_at: '2026-06-15T00:00:00.000Z',
          interval_start: '2026-05-16T00:00:00.000Z',
          interval_end: '2026-06-15T00:00:00.000Z',
          min_remaining_pct: 70,
          usage_tokens: 321,
          usage_breakdown: [
            {
              model: 'grok-4',
              tokens: 321,
              cost: 0.3,
              traces: 4,
              recent_traces_90m: 0,
            },
          ],
        }),
      ],
    }

    await act(async () => {
      render(
        <Wrapper>
          <PhosphorDashboard
            from='2026-05-20'
            to='2026-05-21'
            report={report}
            reportLoading={false}
            showComparison={false}
            quotas={[]}
          />
        </Wrapper>
      )
    })

    expect(screen.getByRole('heading', { name: 'STATUS' })).toBeInTheDocument()
    expect(screen.queryByText('Provider Health Summary')).toBeNull()
    expect(screen.getByRole('tab', { name: 'Health' })).toHaveAttribute(
      'aria-selected',
      'true'
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Quota' }))

    const openaiBucket = screen
      .getByRole('tablist', { name: /openai quota bars/i })
      .closest('article')
    expect(openaiBucket).not.toBeNull()
    const openai = within(openaiBucket as HTMLElement)
    expect(
      openai.getByRole('tab', { name: /all models · 7d/i })
    ).toHaveAttribute('aria-selected', 'true')
    expect(
      openai.getByRole('tab', { name: /codex-spark · 7d/i })
    ).toBeInTheDocument()
    expect(openai.queryByRole('tab', { name: /5hr/i })).toBeNull()

    const weeklyRows = Array.from(
      (openaiBucket as HTMLElement).querySelectorAll(
        '.provider-quota-history-row'
      )
    ).map((row) => row.textContent ?? '')
    expect(weeklyRows[0]).toContain('2K tok · 8 req')
    expect(weeklyRows[1]).toContain('1K tok · 5 req')

    fireEvent.click(openai.getByRole('tab', { name: /codex-spark · 7d/i }))
    expect(openai.getByText(/500 tok · 2 req/i)).toBeInTheDocument()

    const anthropicBucket = screen
      .getByRole('tablist', { name: /anthropic quota bars/i })
      .closest('article')
    expect(anthropicBucket).not.toBeNull()
    const anthropic = within(anthropicBucket as HTMLElement)
    const anthropicTabs = anthropic.getAllByRole('tab')
    expect(anthropicTabs[0]).toHaveTextContent(/all models · 7d/i)
    expect(anthropicTabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(anthropic.queryByRole('tab', { name: /5hr/i })).toBeNull()
    expect(anthropic.queryByText(/800 tok/i)).toBeNull()

    const googleBucket = screen
      .getByRole('tablist', { name: /google quota bars/i })
      .closest('article')
    expect(googleBucket).not.toBeNull()
    const google = within(googleBucket as HTMLElement)
    expect(
      google.getByRole('tab', { name: /flash-lite · 24h/i })
    ).toHaveAttribute('aria-selected', 'true')
    expect(
      (googleBucket as HTMLElement).querySelector(
        '.provider-quota-history-label'
      )
    ).toHaveTextContent('Flash-Lite')
    expect(google.getByText(/1K tok · 10 req/i)).toBeInTheDocument()
    expect(
      (googleBucket as HTMLElement).querySelectorAll(
        '.provider-quota-history-row'
      )
    ).toHaveLength(1)
    expect(google.queryByText(/gemini-2\.5-flash-lite/i)).toBeNull()
    expect(google.queryByText(/gemini-3\.1-flash-lite-preview/i)).toBeNull()

    const xaiBucket = screen
      .getByRole('tablist', { name: /xai quota bars/i })
      .closest('article')
    expect(xaiBucket).not.toBeNull()
    const xai = within(xaiBucket as HTMLElement)
    expect(xai.getByRole('tab', { name: /all models · 30d/i })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(xai.getByText(/321 tok · 4 req/i)).toBeInTheDocument()
  })

  test('test_status_quota_tab_shows_provider_range_empty_state', async () => {
    server.use(
      http.get('/api/shell/reports/usage/token-trend-summary', () =>
        HttpResponse.json({
          metadata: {
            from: '2026-05-20',
            to: '2026-05-21',
          },
          tokenTrendHours: [],
          tokenTrendVersions: [],
        })
      )
    )

    await act(async () => {
      render(
        <Wrapper>
          <PhosphorDashboard
            from='2026-05-20'
            to='2026-05-21'
            report={MOCK_REPORT}
            reportLoading={false}
            showComparison={false}
            quotas={[]}
            quotaRangeHistory={[]}
          />
        </Wrapper>
      )
    })

    fireEvent.click(screen.getByRole('tab', { name: 'Quota' }))

    const openaiBucket = screen.getByText('openai').closest('article')
    expect(openaiBucket).not.toBeNull()
    expect(
      within(openaiBucket as HTMLElement).getByText(
        'no quota history for openai in 2026-05-20 to 2026-05-21'
      )
    ).toBeInTheDocument()
    expect(
      within(openaiBucket as HTMLElement).getByRole('tab', {
        name: /all models · 7d/i,
      })
    ).toHaveTextContent('0')
  })

  test('test_status_weights_tab_fetches_quota_estimator_and_renders_lane_detail', async () => {
    let seenFrom: string | null = null
    let seenTo: string | null = null
    server.use(
      http.get('/api/shell/reports/usage/token-trend-summary', () =>
        HttpResponse.json({
          metadata: {
            from: '2026-05-20',
            to: '2026-05-21',
          },
          tokenTrendHours: [],
          tokenTrendVersions: [],
        })
      ),
      http.get('/api/shell/reports/usage/quota-estimator', ({ request }) => {
        const url = new URL(request.url)
        seenFrom = url.searchParams.get('from')
        seenTo = url.searchParams.get('to')
        return HttpResponse.json({
          metadata: {
            from: '2026-05-20',
            to: '2026-05-21',
            generatedAt: '2026-05-21T00:00:00.000Z',
            phase: '0-2',
            lagCandidatesMinutes: [0, 1, 5, 10, 30, 60],
            estimatorVersion: 'quota-weight-phase0-2-v1',
          },
          phase0Audit: {
            source_database: 'aawm_tristore',
            usage_event_shape: {},
            quota_pct_interval_shape: {},
            provider_lane_policy: {},
            known_missing_fields: ['cache_write_5m_tokens'],
          },
          estimates: [
            {
              provider: 'anthropic',
              quota_key: 'anthropic_unified_7d_sonnet:7d_sonnet',
              quota_type: 'special',
              quota_lane: 'anthropic_weekly_sonnet',
              selected_lag_minutes: 5,
              lag_sensitivity: [
                {
                  lag_minutes: 0,
                  trainable_interval_count: 8,
                  rmse_pct: 3.1,
                  status: 'evaluated',
                },
              ],
              interval_count: 12,
              trainable_interval_count: 8,
              excluded_interval_count: 4,
              excluded_reasons: { missing_usage: 2 },
              residuals: {
                static_baseline: {
                  rmse_pct: 4.8,
                  mae_pct: 2.4,
                  max_abs_error_pct: 11.2,
                },
                rolling_exponential: {
                  rmse_pct: 3.1,
                  mae_pct: 1.9,
                  max_abs_error_pct: 7.6,
                },
              },
              identifiability: {
                status: 'directional_only',
                trainable_interval_count: 8,
                effective_sample_size: 7,
                active_feature_count: 3,
                model_family_mix_count: 2,
                max_feature_correlation: 0.78,
                risks: ['limited_mix'],
              },
              backtest: {
                status: 'evaluated',
                holdout_interval_count: 2,
                static_rmse_pct: 6.2,
                rolling_rmse_pct: 4.4,
                rolling_improved: true,
              },
              cache_read_ratios: [
                {
                  model_family: 'sonnet',
                  cache_read_vs_uncached_workload_ratio: 0.31,
                  expected_lower_than_uncached: true,
                  status: 'consistent',
                },
              ],
              coefficients: [
                {
                  estimate_kind: 'rolling_exponential',
                  feature: 'sonnet:workload',
                  model_family: 'sonnet',
                  token_category: 'workload_excluding_cache_read',
                  coefficient_pct_per_mtok: 3.12,
                  relative_weight_vs_sonnet: 1,
                  confidence_low_pct_per_mtok: 2.1,
                  confidence_high_pct_per_mtok: 4.4,
                  half_life_hours: 24,
                  effective_sample_size: 7,
                  estimate_status: 'directional_only',
                },
                {
                  estimate_kind: 'rolling_exponential',
                  feature: 'sonnet:cache_read',
                  model_family: 'sonnet',
                  token_category: 'cache_read',
                  coefficient_pct_per_mtok: 0.72,
                  relative_weight_vs_sonnet: 0.23,
                  confidence_low_pct_per_mtok: 0.33,
                  confidence_high_pct_per_mtok: 1.1,
                  half_life_hours: 24,
                  effective_sample_size: 7,
                  estimate_status: 'directional_only',
                },
              ],
              diagnostics: [
                {
                  code: 'limited_identifiability',
                  severity: 'warning',
                  detail: 'limited family mix in selected range',
                },
              ],
            },
            {
              provider: 'openai',
              quota_key: 'codex_bengalfox:secondary',
              quota_type: 'special',
              quota_lane: 'openai_codex_spark_weekly',
              selected_lag_minutes: 0,
              lag_sensitivity: [
                {
                  lag_minutes: 0,
                  trainable_interval_count: 1,
                  rmse_pct: null,
                  status: 'not_identifiable',
                },
              ],
              interval_count: 2,
              trainable_interval_count: 1,
              excluded_interval_count: 1,
              excluded_reasons: { weak_signal: 1 },
              residuals: {
                static_baseline: {
                  rmse_pct: null,
                  mae_pct: null,
                  max_abs_error_pct: null,
                },
                rolling_exponential: {
                  rmse_pct: null,
                  mae_pct: null,
                  max_abs_error_pct: null,
                },
              },
              identifiability: {
                status: 'not_identifiable',
                trainable_interval_count: 1,
                effective_sample_size: 1,
                active_feature_count: 1,
                model_family_mix_count: 1,
                max_feature_correlation: 1,
                risks: ['insufficient_variation'],
              },
              backtest: {
                status: 'not_enough_holdout_data',
                static_rmse_pct: null,
                rolling_rmse_pct: null,
                rolling_improved: false,
              },
              cache_read_ratios: [],
              coefficients: [],
              diagnostics: [
                {
                  code: 'limited_identifiability',
                  severity: 'warning',
                  detail: 'not enough lane variation',
                },
              ],
            },
          ],
        } satisfies UsageReportQuotaEstimatorResponse)
      })
    )

    await act(async () => {
      render(
        <Wrapper>
          <PhosphorDashboard
            from='2026-05-20'
            to='2026-05-21'
            report={MOCK_REPORT}
            reportLoading={false}
            showComparison={false}
            quotas={[]}
          />
        </Wrapper>
      )
    })

    fireEvent.click(screen.getByRole('tab', { name: 'Weights' }))

    await waitFor(() => {
      expect(screen.getByText('Phase 0-2 estimator detail')).toBeInTheDocument()
    })
    expect(seenFrom).toBe('2026-05-20')
    expect(seenTo).toBe('2026-05-21')
    expect(screen.getByText(/sonnet-only · 7d/i)).toBeInTheDocument()
    expect(screen.getByText(/codex-spark · 7d/i)).toBeInTheDocument()
    expect(screen.getAllByText('directional_only').length).toBeGreaterThan(0)
    expect(screen.getAllByText('not_identifiable').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/cache-read ratios/i).length).toBeGreaterThan(0)
    expect(
      screen.getByText(/workload \(uncached \+ output/i)
    ).toBeInTheDocument()
    expect(
      screen.getAllByText(/limited_identifiability/i).length
    ).toBeGreaterThan(0)
  })

  test('test_status_weights_tab_loading_and_empty_states', async () => {
    server.use(
      http.get('/api/shell/reports/usage/token-trend-summary', () =>
        HttpResponse.json({
          metadata: {
            from: '2026-05-20',
            to: '2026-05-21',
          },
          tokenTrendHours: [],
          tokenTrendVersions: [],
        })
      ),
      http.get('/api/shell/reports/usage/quota-estimator', async () => {
        await new Promise((resolve) => setTimeout(resolve, 40))
        return HttpResponse.json({
          metadata: {
            from: '2026-05-20',
            to: '2026-05-21',
            generatedAt: '2026-05-21T00:00:00.000Z',
            phase: '0-2',
            lagCandidatesMinutes: [0, 1, 5, 10, 30, 60],
            estimatorVersion: 'quota-weight-phase0-2-v1',
          },
          phase0Audit: {
            source_database: 'aawm_tristore',
            usage_event_shape: {},
            quota_pct_interval_shape: {},
            provider_lane_policy: {},
            known_missing_fields: [],
          },
          estimates: [],
        } satisfies UsageReportQuotaEstimatorResponse)
      })
    )

    await act(async () => {
      render(
        <Wrapper>
          <PhosphorDashboard
            from='2026-05-20'
            to='2026-05-21'
            report={MOCK_REPORT}
            reportLoading={false}
            showComparison={false}
            quotas={[]}
          />
        </Wrapper>
      )
    })

    fireEvent.click(screen.getByRole('tab', { name: 'Weights' }))
    expect(
      screen.getByText('Loading Phase 0-2 estimator detail…')
    ).toBeInTheDocument()

    await waitFor(() => {
      expect(
        screen.getByText('No Phase 0-2 estimator lanes for the selected range.')
      ).toBeInTheDocument()
    })
  })

  test('test_section_tabs_render_inline_with_provider_and_ledger_headings', async () => {
    await act(async () => {
      render(
        <Wrapper>
          <PhosphorDashboard
            from='2026-05-20'
            to='2026-05-21'
            report={MOCK_REPORT}
            reportLoading={false}
            showComparison={false}
            quotas={[]}
          />
        </Wrapper>
      )
    })

    const providersHeading = screen.getByRole('heading', { name: 'STATUS' })
    const providersTitleMain = providersHeading.parentElement as HTMLElement
    expect(providersTitleMain).toHaveClass('section-title-main')
    expect(
      within(providersTitleMain).getByRole('tab', { name: 'Health' })
    ).toBeInTheDocument()
    expect(
      within(providersTitleMain).getByRole('tab', { name: 'Quota' })
    ).toBeInTheDocument()
    expect(
      within(providersTitleMain).getByRole('tab', { name: 'Weights' })
    ).toBeInTheDocument()

    const ledgerHeading = screen.getByRole('heading', { name: 'LEDGER' })
    const ledgerTitleMain = ledgerHeading.parentElement as HTMLElement
    expect(ledgerTitleMain).toHaveClass('section-title-main')
    expect(
      within(ledgerTitleMain).getByRole('tab', { name: 'Model' })
    ).toBeInTheDocument()
    expect(
      within(ledgerTitleMain).getByRole('tab', { name: 'Repository' })
    ).toBeInTheDocument()
  })

  test('test_section_refresh_control_shows_updating_state', async () => {
    await act(async () => {
      render(
        <Wrapper>
          <PhosphorDashboard
            from='2026-05-20'
            to='2026-05-21'
            report={MOCK_REPORT}
            reportLoading={false}
            reportFetching
            showComparison={false}
            quotas={[]}
            onRefreshReport={vi.fn()}
            onRefreshQuotas={vi.fn()}
          />
        </Wrapper>
      )
    })

    expect(screen.getAllByText('Updating').length).toBeGreaterThan(0)
  })

  test('test_phosphor_dashboard_provider_status_color_legend_renders', async () => {
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

    let container!: HTMLElement
    await act(async () => {
      const renderResult = render(
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
      container = renderResult.container
    })

    const legend = container.querySelector('.status-color-legend')
    expect(legend).not.toBeNull()
    expect(legend?.getAttribute('aria-label')).toBe(
      'Provider health and quota color legend'
    )
    expect(legend?.textContent).toContain('Health')
    expect(legend?.textContent).toContain('Quota used')
    expect(legend?.textContent).toContain('Burn')
    expect(
      legend?.querySelectorAll('.status-legend-swatch.health-miss')
    ).toHaveLength(1)
    expect(
      legend?.querySelectorAll('.status-legend-swatch.velocity-peak')
    ).toHaveLength(1)
  })

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

  test('test_token_trend_hover_fetches_day_detail_once_per_day', async () => {
    let dayDetailCallCount = 0
    let dayDetailUrl: URL | null = null

    server.use(
      http.get('/api/shell/reports/usage/token-trend-summary', () =>
        HttpResponse.json({
          metadata: {
            from: '2026-05-20',
            to: '2026-05-21',
          },
          tokenTrendHours: [
            {
              day: '2026-05-20',
              hour: 8,
              provider: 'anthropic',
              traces: 1,
              token_total: 100,
              usd_cost: 0,
            },
            {
              day: '2026-05-20',
              hour: 9,
              provider: 'openai',
              traces: 1,
              token_total: 50,
              usd_cost: 0,
            },
          ],
          tokenTrendVersions: [
            {
              provider: 'openai',
              client_name: 'codex-tui',
              client_version: '0.120.0',
              first_seen_at: '2026-05-20T12:00:00.000Z',
              last_seen_at: '2026-05-20T13:10:00.000Z',
              first_seen_day: '2026-05-20',
              first_seen_hour: 8,
              last_seen_day: '2026-05-20',
              last_seen_hour: 9,
              traces: 2,
              token_total: 150,
              usd_cost: 0,
            },
            {
              provider: 'xai',
              client_name: 'xai-cli',
              client_version: '0.0.0',
              first_seen_at: '2026-05-20T12:00:00.000Z',
              last_seen_at: '2026-05-20T13:10:00.000Z',
              first_seen_day: '2026-05-20',
              first_seen_hour: 8,
              last_seen_day: '2026-05-20',
              last_seen_hour: 9,
              traces: 1,
              token_total: 90,
              usd_cost: 0,
            },
          ],
        })
      ),
      http.get('/api/shell/reports/usage/token-trend-day', ({ request }) => {
        dayDetailCallCount += 1
        dayDetailUrl = new URL(request.url)
        return HttpResponse.json({
          metadata: {
            date: '2026-05-20',
            from: '2026-05-20',
            to: '2026-05-21',
          },
          date: '2026-05-20',
          rows: [],
        })
      })
    )

    let container!: HTMLElement
    await act(async () => {
      const renderResult = render(
        <Wrapper>
          <PhosphorDashboard
            from='2026-05-20'
            to='2026-05-21'
            report={MOCK_REPORT}
            reportLoading={false}
            showComparison={false}
            quotas={[]}
          />
        </Wrapper>
      )
      container = renderResult.container
    })

    await waitFor(() => {
      expect(
        container.querySelector('.tt-day-hover-shell[data-day="2026-05-20"]')
      ).not.toBeNull()
    })
    const activeVersionLane = container.querySelector(
      '.tt-active-version-lane'
    ) as HTMLElement
    expect(activeVersionLane).not.toBeNull()
    expect(activeVersionLane.textContent).toContain('Grok')
    expect(activeVersionLane.textContent).toContain('xai-cli')

    const dayHoverShell = container.querySelector(
      '.tt-day-hover-shell[data-day="2026-05-20"]'
    ) as HTMLElement
    fireEvent.pointerEnter(dayHoverShell)

    await waitFor(() => {
      expect(dayDetailCallCount).toBe(1)
    })
    expect(dayDetailUrl?.searchParams.get('date')).toBe('2026-05-20')

    fireEvent.pointerEnter(dayHoverShell)

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 175))
    })
    expect(dayDetailCallCount).toBe(1)
  })

  test('test_token_trend_renders_before_model_ledger_section', async () => {
    server.use(
      http.get('/api/shell/reports/usage/token-trend-summary', () =>
        HttpResponse.json({
          metadata: {
            from: '2026-05-20',
            to: '2026-05-21',
          },
          tokenTrendHours: [],
          tokenTrendVersions: [],
        })
      )
    )

    let container!: HTMLElement
    await act(async () => {
      const renderResult = render(
        <Wrapper>
          <PhosphorDashboard
            from='2026-05-20'
            to='2026-05-21'
            report={MOCK_REPORT}
            reportLoading={false}
            showComparison={false}
            quotas={[]}
          />
        </Wrapper>
      )
      container = renderResult.container
    })

    const models = container.querySelector('#models') as HTMLElement
    const tokens = container.querySelector('#tokens') as HTMLElement

    expect(models).not.toBeNull()
    expect(container.querySelector('#repos')).toBeNull()
    expect(tokens).not.toBeNull()
    expect(
      tokens.compareDocumentPosition(models) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Provider health cell classification
// ---------------------------------------------------------------------------

describe('Provider health cell classification', () => {
  function makeHealthRow(
    overrides: Partial<UsageReportProviderLatencyHealthRow> = {}
  ): UsageReportProviderLatencyHealthRow {
    return {
      bucket_start: '2026-05-21T20:45:00.000Z',
      environment: 'dev',
      provider: 'xai',
      model: 'unknown',
      model_group: 'unknown',
      requests: 0,
      passive_latency_sample_status: 'no_traffic',
      upstream_p50_ms: null,
      upstream_p95_ms: null,
      upstream_p99_ms: null,
      total_p95_ms: null,
      proxy_processing_p95_ms: null,
      missing_upstream_latency: 0,
      provider_error_events: 0,
      rate_limit_events: 0,
      capacity_events: 0,
      provider_5xx_events: 0,
      provider_timeout_events: 0,
      network_error_events: 0,
      auth_failed_events: 0,
      adapter_error_events: 0,
      status_probe_count: 0,
      status_probe_success_pct: null,
      status_probe_p95_ms: null,
      provider_ping_avg_ms: null,
      provider_ping_packet_loss_pct: null,
      control_ping_avg_ms: null,
      control_packet_loss_pct: null,
      control_probe_success_pct: null,
      provider_ping_minus_control_ms: null,
      dns_failures: 0,
      tcp_failures: 0,
      tls_failures: 0,
      icmp_failures: 0,
      probed_endpoints: null,
      status_error_classes: null,
      min_remaining_pct: null,
      max_remaining_pct: null,
      next_expected_reset_at: null,
      quota_keys: null,
      request_period_start: null,
      request_period_end: null,
      ...overrides,
    }
  }

  function makeErrorObservation(
    overrides: Partial<UsageReportProviderErrorObservationRow> = {}
  ): UsageReportProviderErrorObservationRow {
    return {
      observed_at: '2026-05-21T20:47:12.000Z',
      environment: 'dev',
      provider: 'xai',
      model: 'grok-4',
      model_group: 'unknown',
      route_family: 'chat',
      status_code: 429,
      error_type: 'HTTPException',
      error_code: 'rate_limit',
      error_class: 'provider_error',
      error_message: 'provider rate limit exceeded',
      retry_after_seconds: null,
      expected_reset_at: null,
      ...overrides,
    }
  }

  test('test_probe_backed_no_traffic_bucket_is_green_not_blue', () => {
    const cells = _padHealthCellsForTest(
      [
        makeHealthRow({
          status_probe_count: 8,
          status_probe_success_pct: 100,
          status_probe_p95_ms: 110,
          provider_ping_avg_ms: 32,
          provider_ping_packet_loss_pct: 0,
          control_ping_avg_ms: 30,
          control_packet_loss_pct: 0,
          control_probe_success_pct: 100,
          provider_ping_minus_control_ms: 2,
        }),
      ],
      'xai'
    )

    expect(cells).toHaveLength(288)
    expect(cells[287].category).toBe('green')
    expect(cells[287].rawP95Ms).toBeNull()
  })

  test('test_xai_alias_row_feeds_xai_provider_health', () => {
    const cells = _padHealthCellsForTest(
      [
        makeHealthRow({
          provider: 'x.ai',
          requests: 3,
          passive_latency_sample_status: 'normal',
          upstream_p95_ms: 145,
        }),
      ],
      'xai'
    )

    expect(cells[287].rawP95Ms).toBe(145)
  })

  test('test_total_latency_fallback_prevents_false_missing_upstream_miss', () => {
    const cells = _padHealthCellsForTest(
      [
        makeHealthRow({
          provider: 'openrouter',
          model: 'openrouter/qwen/qwen3-embedding-8b',
          requests: 18,
          passive_latency_sample_status: 'normal',
          upstream_p95_ms: null,
          total_p95_ms: 6130.985,
          missing_upstream_latency: 18,
          status_probe_count: 4,
          status_probe_success_pct: 100,
          status_probe_p95_ms: 110,
        }),
      ],
      'openrouter'
    )

    expect(cells[287].category).toBeUndefined()
    expect(cells[287].rawP95Ms).toBe(6130.985)
  })

  test('test_missing_upstream_latency_bucket_is_miss', () => {
    const cells = _padHealthCellsForTest(
      [
        makeHealthRow({
          requests: 12,
          passive_latency_sample_status: 'missing',
          missing_upstream_latency: 12,
          status_probe_count: 8,
          status_probe_success_pct: 100,
          status_probe_p95_ms: 110,
        }),
      ],
      'xai'
    )

    expect(cells[287].category).toBe('miss')
  })

  test('test_true_no_probe_no_traffic_bucket_stays_raw_blue_path', () => {
    const cells = _padHealthCellsForTest([makeHealthRow()], 'xai')

    expect(cells[287].category).toBeUndefined()
    expect(cells[287].rawP95Ms).toBeNull()
    expect(cells[287].rawErrorCount).toBe(0)
  })

  test('test_provider_without_health_rows_renders_no_data_blue_path', () => {
    const cells = _padHealthCellsForTest([], 'local')

    expect(cells).toHaveLength(288)
    expect(cells[0].category).toBeUndefined()
    expect(cells[0].rawP95Ms).toBeNull()
    expect(cells[0].rawErrorCount).toBe(0)
    expect(cells[287].rawP95Ms).toBeNull()
  })

  test('test_aggregate_health_cells_overlay_provider_errors_by_bucket', () => {
    const cells = _buildAggregateHealthCellsForTest([
      makeHealthRow({
        provider: 'openai',
        requests: 10,
        upstream_p95_ms: 120,
      }),
      makeHealthRow({
        provider: 'anthropic',
        provider_timeout_events: 2,
      }),
    ])

    expect(cells).toHaveLength(288)
    expect(cells[287].rawP95Ms).toBe(120)
    expect(cells[287].rawErrorCount).toBe(2)
    expect(cells[287].eventCount).toBe(2)
    expect(cells[287].rawErrorBreakdown?.provider_timeout_events).toBe(2)
  })

  test('test_aggregate_health_cells_include_probe_degradation_counts', () => {
    const cells = _buildAggregateHealthCellsForTest([
      makeHealthRow({
        provider: 'openai',
        status_probe_count: 4,
        status_probe_success_pct: 75,
      }),
    ])

    expect(cells[287].category).toBe('orange')
    expect(cells[287].degradedCount).toBe(1)
    expect(cells[287].rawDegradedBreakdown?.provider_probe_degraded).toBe(1)
  })

  test('test_probe_degradation_overrides_passive_latency_green_path', () => {
    const cells = _padHealthCellsForTest(
      [
        makeHealthRow({
          requests: 12,
          upstream_p95_ms: 180,
          status_probe_count: 4,
          status_probe_success_pct: 75,
        }),
      ],
      'xai'
    )

    expect(cells[287].rawP95Ms).toBe(180)
    expect(cells[287].category).toBe('orange')
    expect(cells[287].degradedCount).toBe(1)
  })

  test('test_aggregate_health_cells_exclude_proxy_internal_rows', () => {
    const cells = _buildAggregateHealthCellsForTest([
      makeHealthRow({
        provider: 'proxy_internal',
        provider_error_events: 7,
      }),
      makeHealthRow({
        provider: 'openai',
        requests: 10,
        upstream_p95_ms: 120,
      }),
    ])

    expect(cells[287].rawP95Ms).toBe(120)
    expect(cells[287].rawErrorCount).toBe(0)
    expect(cells[287].eventCount).toBeUndefined()
  })

  test('test_provider_health_cells_include_timestamped_error_log_events', () => {
    const cells = _padHealthCellsForTest(
      [
        makeHealthRow({
          bucket_start: '2026-05-21T20:45:00.000Z',
          provider: 'xai',
          provider_error_events: 1,
        }),
      ],
      'xai',
      [
        makeErrorObservation({
          observed_at: '2026-05-21T20:47:12.000Z',
          provider: 'xai',
          model: 'grok-4',
          status_code: 429,
          error_class: 'provider_error',
          error_message: 'provider rate limit exceeded',
        }),
      ]
    )

    expect(cells[287].events).toEqual([
      expect.objectContaining({
        time: '4:47 PM:',
        model: 'grok-4',
        errorType: expect.stringContaining(
          '429 provider error / provider rate limit exceeded'
        ),
      }),
    ])
  })

  test('test_aggregate_health_cells_include_provider_in_error_log_model_label', () => {
    const cells = _buildAggregateHealthCellsForTest(
      [
        makeHealthRow({
          bucket_start: '2026-05-21T20:45:00.000Z',
          provider: 'openai',
          provider_5xx_events: 1,
        }),
      ],
      [
        makeErrorObservation({
          observed_at: '2026-05-21T20:47:12.000Z',
          provider: 'openai',
          model: 'gpt-5.5',
          status_code: 503,
          error_class: 'provider_5xx',
          error_message: 'connection reset',
        }),
      ]
    )

    expect(cells[287].events?.[0]).toEqual(
      expect.objectContaining({
        model: 'openai/gpt-5.5',
        errorType: expect.stringContaining(
          '503 provider 5xx / connection reset'
        ),
      })
    )
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
    expect(_tipModelsSingleLabelForTest([], 'sonnet')).toBeUndefined()
  })

  test('test_single_label_returns_one_entry_with_display_label', () => {
    const result = _tipModelsSingleLabelForTest(
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
    const lanes = _buildProviderLanesForTest('anthropic', quotaRows, [])
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

  test('test_openrouter_has_daily_request_lane_with_prior_bars', () => {
    const openrouterRow: UsageReportQuotaRow = {
      ...makeAnthropicQuotaRow(),
      provider: 'openrouter',
      model: null,
      short_remaining_pct: 99.4,
      short_reset_at: '2026-05-24T00:00:00Z',
      short_interval_start: '2026-05-23T00:00:00Z',
      short_interval_end: '9999-12-31T00:00:00Z',
      short_active: true,
      short_usage_tokens: 159440,
      weekly_remaining_pct: null,
      weekly_active: false,
      special_remaining_pct: null,
      special_active: false,
      monthly_remaining_pct: null,
      monthly_active: false,
    }
    const historyRows: UsageReportQuotaHistoryRow[] = [
      makeHistoryRow({
        provider: 'openrouter',
        model: null,
        quota_type: 'short',
        expected_reset_at: '2026-05-23T00:00:00Z',
        interval_start: '2026-05-22T00:00:00Z',
        interval_end: '2026-05-23T00:00:00Z',
        min_remaining_pct: 82,
      }),
    ]

    const lanes = _buildProviderLanesForTest(
      'openrouter',
      [openrouterRow],
      historyRows
    )

    expect(lanes).toHaveLength(1)
    expect(lanes[0].laneKey).toBe('openrouter/requests')
    expect(lanes[0].laneLabel).toBe('Free Requests · 24h')
    expect(lanes[0].currentBar?.consumedPct).toBeCloseTo(0.6, 1)
    expect(lanes[0].priorBars).toHaveLength(1)
    expect(lanes[0].priorBars[0].consumedPct).toBe(18)
  })

  test('test_unknown_provider_returns_empty_lanes', () => {
    const lanes = _buildProviderLanesForTest('nvidia_nim', [], [])
    expect(lanes).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Wave 47 — buildProviderLanes prior-bar dedup with future reset slots
//
// Regression coverage for the scenario where:
//   1. The history API returns rows for the CURRENT window (expected_reset_at
//      matches the live quota row's resetAt) — these must be deduplicated away.
//   2. The history API returns rows for PRIOR slots that sit in the near-future
//      relative to today (e.g. a weekly cycle that reset on May 24 while today
//      is May 20 — the server window was expanded to 2× interval_hours so these
//      rows now appear in the history response).
//   3. Multiple poll-jitter duplicates for the same prior slot collapse to one
//      bar via the 30-min rounding + seen-Set dedup.
//
// Expected: 1 current bar + 2 prior bars (one per unique prior slot).
// Observed before server fix (bcbe5c7): 1 current bar + 1 prior bar (the 5/24
//   slot was excluded because the server upper bound was 0.5× instead of 2×;
//   after bcbe5c7 the server sends all rows correctly, so these tests guard
//   the client-side ±30-min dedup path remains correct for future slots).
// ---------------------------------------------------------------------------

describe('Wave 47 — buildProviderLanes future-slot prior bar dedup', () => {
  /**
   * Builds a minimal OpenAI quota row with weekly, special, short, and
   * short_special all active — matching the live production data shape.
   */
  function makeOpenAIQuotaRow(
    overrides: Partial<UsageReportQuotaRow> = {}
  ): UsageReportQuotaRow {
    return {
      provider: 'openai',
      model: null,
      // Weekly: current reset 2026-05-26T18:33 → rounds to 18:30
      weekly_remaining_pct: 84,
      weekly_reset_at: '2026-05-26T18:33:13.000Z',
      weekly_interval_start: '2026-05-20T17:23:48.000Z',
      weekly_interval_end: '9999-12-31T00:00:00.000Z',
      weekly_active: true,
      weekly_usage_tokens: 1281094598,
      weekly_usage_breakdown: [],
      // Short: current reset 2026-05-20T19:22 → rounds to 19:30
      short_remaining_pct: 93,
      short_reset_at: '2026-05-20T19:22:26.000Z',
      short_interval_start: '2026-05-20T17:40:30.000Z',
      short_interval_end: '9999-12-31T00:00:00.000Z',
      short_active: true,
      short_usage_tokens: 145618271,
      short_usage_breakdown: [],
      // Special (codex-spark · 7d): current reset 2026-05-26T19:44 → rounds to 19:30
      special_remaining_pct: 40,
      special_reset_at: '2026-05-26T19:44:29.000Z',
      special_interval_start: '2026-05-20T17:23:48.000Z',
      special_interval_end: '9999-12-31T00:00:00.000Z',
      special_active: true,
      special_usage_tokens: 500000000,
      special_usage_breakdown: [],
      // short_special (codex-spark · 5hr): current reset 2026-05-20T23:10 → rounds to 23:00
      short_special_remaining_pct: 91,
      short_special_reset_at: '2026-05-20T23:10:48.000Z',
      short_special_interval_start: '2026-05-20T18:10:49.000Z',
      short_special_interval_end: '9999-12-31T00:00:00.000Z',
      short_special_active: true,
      short_special_usage_tokens: 23026788,
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

  /** Creates a minimal weekly history row for openai. */
  function makeWeeklyHistoryRow(
    expected_reset_at: string,
    min_remaining_pct: number
  ): UsageReportQuotaHistoryRow {
    return {
      provider: 'openai',
      model: null,
      quota_type: 'weekly',
      expected_reset_at,
      interval_start: null,
      interval_end: expected_reset_at,
      min_remaining_pct,
      max_remaining_pct: 99,
      usage_tokens: 1000000,
      usage_breakdown: [],
    }
  }

  /** Creates a minimal special history row for openai. */
  function makeSpecialHistoryRow(
    expected_reset_at: string,
    min_remaining_pct: number
  ): UsageReportQuotaHistoryRow {
    return {
      provider: 'openai',
      model: null,
      quota_type: 'special',
      expected_reset_at,
      interval_start: null,
      interval_end: expected_reset_at,
      min_remaining_pct,
      max_remaining_pct: 99,
      usage_tokens: 500000,
      usage_breakdown: [],
    }
  }

  test('test_openai_weekly_lane_shows_2_prior_bars_when_server_includes_current_slot', () => {
    // Mirrors the live data shape after bcbe5c7 server fix:
    // 7 history rows — 1 matching the current window's resetAt (5/26 18:33)
    // and 3 poll-jitter duplicates for each of two prior slots (5/24, 5/19).
    // The current window row must be deduplicated; the two prior slots must
    // each yield exactly 1 prior bar → 2 prior bars total.
    const openaiRow = makeOpenAIQuotaRow()
    const historyRows: UsageReportQuotaHistoryRow[] = [
      // Current window row — must be filtered by ±30min dedup (resetAt=18:33 → slot 18:30)
      makeWeeklyHistoryRow('2026-05-26T18:33:13.000Z', 84),
      // Prior slot 5/24 14:00 — 3 poll-jitter duplicates all round to 14:00
      makeWeeklyHistoryRow('2026-05-24T13:47:48.000Z', 80),
      makeWeeklyHistoryRow('2026-05-24T13:47:47.000Z', 80),
      makeWeeklyHistoryRow('2026-05-24T13:47:46.000Z', 76),
      // Prior slot 5/19 00:00 — 3 poll-jitter duplicates all round to 00:00
      makeWeeklyHistoryRow('2026-05-19T00:04:56.000Z', 39),
      makeWeeklyHistoryRow('2026-05-19T00:04:54.000Z', 4),
      makeWeeklyHistoryRow('2026-05-19T00:04:53.000Z', 2),
    ]
    const lanes = _buildProviderLanesForTest('openai', [openaiRow], historyRows)
    const weeklyLane = lanes.find((l) => l.laneKey === 'openai/weekly')
    expect(weeklyLane).toBeDefined()
    // Current bar: pct = 100 − 84 = 16% consumed
    expect(weeklyLane!.currentBar).not.toBeNull()
    expect(weeklyLane!.currentBar!.consumedPct).toBeCloseTo(16, 0)
    // Exactly 2 prior bars: 5/24 slot + 5/19 slot (jitter rows deduped)
    expect(weeklyLane!.priorBars).toHaveLength(2)
    // Newest prior bar first: 5/24 slot, min_remaining_pct=80 → consumed=20
    expect(weeklyLane!.priorBars[0]!.consumedPct).toBeCloseTo(20, 0)
    // Oldest prior bar second: 5/19 slot, min_remaining_pct=39 → consumed=61
    expect(weeklyLane!.priorBars[1]!.consumedPct).toBeCloseTo(61, 0)
  })

  test('test_openai_special_lane_shows_2_prior_bars_when_server_includes_current_slot', () => {
    // Same regression pattern for the codex-spark · 7d (special) lane.
    // 4 history rows: 1 current (5/26 19:44), 2 duplicates for 5/24, 1 for 5/18.
    const openaiRow = makeOpenAIQuotaRow()
    const historyRows: UsageReportQuotaHistoryRow[] = [
      // Current window (5/26 19:44 → slot 19:30) — must be filtered
      makeSpecialHistoryRow('2026-05-26T19:44:29.000Z', 40),
      // Prior slot 5/24 14:00 — 2 poll-jitter duplicates
      makeSpecialHistoryRow('2026-05-24T13:47:57.000Z', 80),
      makeSpecialHistoryRow('2026-05-24T13:47:56.000Z', 75),
      // Prior slot 5/18 15:00 — single row
      makeSpecialHistoryRow('2026-05-18T15:08:42.000Z', 0),
    ]
    const lanes = _buildProviderLanesForTest('openai', [openaiRow], historyRows)
    const specialLane = lanes.find((l) => l.laneKey === 'openai/special')
    expect(specialLane).toBeDefined()
    expect(specialLane!.currentBar).not.toBeNull()
    // pct = 100 − 40 = 60% consumed
    expect(specialLane!.currentBar!.consumedPct).toBeCloseTo(60, 0)
    // 2 prior bars: 5/24 slot + 5/18 slot
    expect(specialLane!.priorBars).toHaveLength(2)
    // Newest prior first: 5/24 slot, min_remaining_pct=80 → consumed=20
    expect(specialLane!.priorBars[0]!.consumedPct).toBeCloseTo(20, 0)
    // Oldest prior second: 5/18 slot, min_remaining_pct=0 → consumed=100
    expect(specialLane!.priorBars[1]!.consumedPct).toBeCloseTo(100, 0)
  })

  test('test_weekly_current_slot_deduplicated_even_when_reset_at_is_in_future', () => {
    // Regression guard: when the current bar's resetAt is in the FUTURE
    // (e.g. weekly reset on May 26 while today is May 20), the ±30-min check
    // must still filter history rows that share the same rounded slot.
    const openaiRow = makeOpenAIQuotaRow()
    const historyRows: UsageReportQuotaHistoryRow[] = [
      // Exact match of current weekly resetAt — must be deduplicated
      makeWeeklyHistoryRow('2026-05-26T18:33:13.000Z', 84),
      // Only one prior slot — should become the single prior bar
      makeWeeklyHistoryRow('2026-05-19T00:04:56.000Z', 39),
    ]
    const lanes = _buildProviderLanesForTest('openai', [openaiRow], historyRows)
    const weeklyLane = lanes.find((l) => l.laneKey === 'openai/weekly')
    expect(weeklyLane!.priorBars).toHaveLength(1)
    // min_remaining_pct=39 → consumed=61
    expect(weeklyLane!.priorBars[0]!.consumedPct).toBeCloseTo(61, 0)
  })

  test('test_per_lane_dedup_does_not_cross_contaminate_between_quota_types', () => {
    // Guard the per-lane isolation of buildProviderLanes: the ±30-min dedup
    // for the weekly lane must compare only against the weekly current bar's
    // resetAt, NOT against other lanes' current bars (e.g. special or short).
    //
    // Scenario: weekly current reset at 18:33 (→ slot 18:30) and special
    // current reset at 19:44 (→ slot 19:30). A weekly history row at 14:00
    // on 5/24 is >30min from 18:30 and must NOT be dropped, even though
    // buildHistoryBarsForProvider's cross-provider path would check all resets.
    const openaiRow = makeOpenAIQuotaRow({
      weekly_reset_at: '2026-05-26T18:33:13.000Z',
      special_reset_at: '2026-05-26T19:44:29.000Z',
    })
    const historyRows: UsageReportQuotaHistoryRow[] = [
      // Current weekly window — filtered against weekly's 18:30 slot
      makeWeeklyHistoryRow('2026-05-26T18:33:13.000Z', 84),
      // Prior slot at 5/24 14:00 — must NOT be filtered (>30min from 18:30)
      makeWeeklyHistoryRow('2026-05-24T14:00:00.000Z', 60),
    ]
    const lanes = _buildProviderLanesForTest('openai', [openaiRow], historyRows)
    const weeklyLane = lanes.find((l) => l.laneKey === 'openai/weekly')
    // 1 prior bar — not cross-filtered by the special lane's reset at 19:30
    expect(weeklyLane!.priorBars).toHaveLength(1)
    // min_remaining_pct=60 → consumed=40
    expect(weeklyLane!.priorBars[0]!.consumedPct).toBeCloseTo(40, 0)
  })
})

// ---------------------------------------------------------------------------
// Wave 43 — fmtIntervalCompact helper tests
// ---------------------------------------------------------------------------

describe('Wave 43 — fmtIntervalCompact', () => {
  test('test_fmt_interval_compact_formats_snapped_range', () => {
    // 2026-05-19T10:00:00Z → 2026-05-20T10:00:00Z (already on 30-min boundary)
    const result = _fmtIntervalCompactForTest(
      '2026-05-19T10:00:00Z',
      '2026-05-20T10:00:00Z'
    )
    expect(result).toBe('5/19 06:00 → 5/20 06:00')
  })

  test('test_fmt_interval_compact_snaps_to_nearest_30min', () => {
    // 2026-05-20T09:44:00Z: nearest 30-min boundary is 09:30 (44m → round down)
    // 2026-05-20T14:52:00Z: nearest 30-min boundary is 15:00 (52m → round up)
    const result = _fmtIntervalCompactForTest(
      '2026-05-20T09:44:00Z',
      '2026-05-20T14:52:00Z'
    )
    expect(result).toBe('5/20 05:30 → 5/20 11:00')
  })

  test('test_fmt_interval_compact_returns_dash_on_null_start', () => {
    const result = _fmtIntervalCompactForTest(null, '2026-05-20T10:00:00Z')
    expect(result).toBe('—')
  })

  test('test_fmt_interval_compact_returns_dash_on_null_end', () => {
    const result = _fmtIntervalCompactForTest('2026-05-19T10:00:00Z', null)
    expect(result).toBe('—')
  })

  test('test_fmt_interval_compact_pads_hours_and_minutes', () => {
    // 2026-05-03T01:00:00Z — single-digit month and day, leading-zero hour
    const result = _fmtIntervalCompactForTest(
      '2026-05-03T01:00:00Z',
      '2026-05-03T06:00:00Z'
    )
    expect(result).toBe('5/2 21:00 → 5/3 02:00')
  })

  test('test_fmt_interval_compact_crosses_month_boundary', () => {
    const result = _fmtIntervalCompactForTest(
      '2026-04-30T22:00:00Z',
      '2026-05-01T04:00:00Z'
    )
    expect(result).toBe('4/30 18:00 → 5/1 00:00')
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
    const bar = _buildPriorBarFromHistoryForTest(h, 'anthropic')
    expect(bar.dateRangeLabel).toBe('5/19 06:00 → 5/20 06:00')
  })

  test('test_prior_bar_dateRangeLabel_uses_snapped_boundaries', () => {
    // interval_start with sub-30-min offset — snapped to nearest slot
    const h = makeHistoryRow({
      interval_start: '2026-05-19T09:46:00Z',
      expected_reset_at: '2026-05-20T09:53:00Z',
    })
    const bar = _buildPriorBarFromHistoryForTest(h, 'anthropic')
    // Both snap to :00 of the hour
    expect(bar.dateRangeLabel).toBe('5/19 06:00 → 5/20 06:00')
  })

  test('test_prior_bar_dateRangeLabel_undefined_when_interval_start_is_null', () => {
    const h = makeHistoryRow({
      interval_start: null,
      expected_reset_at: '2026-05-20T10:00:00Z',
    })
    const bar = _buildPriorBarFromHistoryForTest(h, 'anthropic')
    // fmtIntervalCompact returns '—' for null start; field is still set
    expect(bar.dateRangeLabel).toBe('—')
  })

  test('test_prior_bar_dateRangeLabel_undefined_when_expected_reset_at_is_null', () => {
    const h = makeHistoryRow({
      interval_start: '2026-05-19T10:00:00Z',
      expected_reset_at: null,
    })
    const bar = _buildPriorBarFromHistoryForTest(h, 'anthropic')
    expect(bar.dateRangeLabel).toBe('—')
  })

  test('test_prior_bar_timeAgoLabel_and_dateRangeLabel_both_set', () => {
    const h = makeHistoryRow({
      interval_start: '2026-05-19T10:00:00Z',
      expected_reset_at: '2026-05-20T10:00:00Z',
    })
    const bar = _buildPriorBarFromHistoryForTest(h, 'anthropic')
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
    const bar = _buildPriorBarFromHistoryForTest(h, 'anthropic')

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
