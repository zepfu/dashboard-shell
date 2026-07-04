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
import { vi } from 'vitest'
import { server } from '../../../test/setup'
import type {
  UsageReportQuotaEstimatorResponse,
  UsageReportProviderErrorObservationRow,
  UsageReportProviderLatencyHealthRow,
  UsageReportQuotaHistoryRow,
  UsageReportQuotaRow,
  UsageReportQuotaUsageBreakdown,
  UsageReportResponse,
  UsageReportSessionDiagnosticsResponse,
  ShellHealthResponse,
} from '../api/usage-report'
import PhosphorDashboard from './phosphor-dashboard'
import {
  formatTimeAgo,
  quotaTypeToPeriodType,
  tipModelsFromBreakdownGoogleAggregated,
  tipModelsFromBreakdownSingleLabel,
  padHealthCells,
  buildAggregateHealthCells,
  buildProviderLanes,
  classifyGeminiModel,
  fmtIntervalCompact,
  buildPriorBarFromHistory,
  buildTopModels,
  buildProviderQuotaHistoryTabs,
} from './phosphor-dashboard.testkit'

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
    http.get('/api/shell/health', () =>
      HttpResponse.json({
        ok: true,
        pgBouncerSidecars: {
          status: 'unknown',
          sidecars: [],
        },
      } satisfies ShellHealthResponse)
    )
  )
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
    http.get('/api/shell/reports/usage/token-trend-summary', () =>
      HttpResponse.json({
        metadata: {
          from: '2026-05-20',
          to: '2026-05-21',
        },
        tokenTrendHours: [],
        tokenTrendVersions: [],
        tokenTrendRequestHours: [],
        tokenTrendToolHours: [],
        tokenTrendModelFirstSeen: [],
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
  server.use(
    http.get('/api/shell/reports/usage/session-diagnostics', () =>
      HttpResponse.json({
        metadata: {
          from: '2026-04-19',
          to: '2026-05-19',
          limit: 100,
          generatedAt: '2026-05-19T00:00:00.000Z',
        },
        sessionDiagnostics: [],
      } satisfies UsageReportSessionDiagnosticsResponse)
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

  test('test_status_health_provider_cards_use_masonry_layout_with_trailing_aggregate', async () => {
    const originalInnerWidth = window.innerWidth
    let container: HTMLElement | undefined

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 2100,
    })

    try {
      await act(async () => {
        const result = render(
          <Wrapper>
            <PhosphorDashboard
              from='2026-05-20'
              to='2026-05-21'
              report={MOCK_REPORT}
              reportLoading={false}
              showComparison={false}
              quotas={[]}
              quotaHistory={[]}
            />
          </Wrapper>
        )
        container = result.container
      })

      const providerLayout = container?.querySelector(
        'section#status .provider-health-summary'
      ) as HTMLElement | null

      expect(providerLayout).not.toBeNull()
      expect(providerLayout).toHaveClass('provider-health-summary')
      expect(providerLayout?.className).not.toContain('provider-summary-grid')
      expect(providerLayout?.classList.contains('provider-summary')).toBe(false)

      const columns = Array.from(
        providerLayout?.querySelectorAll('.provider-health-summary-column') ??
          []
      )
      expect(columns).toHaveLength(8)
      expect(
        columns.some((column) =>
          Array.from(column.children).some((child) =>
            child.classList.contains('provider-card')
          )
        )
      ).toBe(true)
      expect(
        columns
          .flatMap((column) =>
            Array.from(column.querySelectorAll('.provider-name')).map((node) =>
              node.textContent?.trim()
            )
          )
          .filter(Boolean)
      ).toContain('Σ AGGREGATE TOTALS')
      expect(columns.at(0)?.textContent).not.toContain('Σ AGGREGATE TOTALS')
      expect(
        columns.some((column) => column.textContent?.includes('LOCAL'))
      ).toBe(true)
      expect(columns.at(-1)?.textContent).toContain('Σ AGGREGATE TOTALS')
      expect(
        columns.at(-1)?.querySelector('.provider-card.aggregate')
      ).not.toBeNull()
    } finally {
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: originalInnerWidth,
      })
    }
  })

  test('test_status_health_omits_google_and_antigravity_provider_cards', async () => {
    const makeGoogleQuotaRow = (): UsageReportQuotaRow => ({
      provider: 'google',
      model: 'gemini-2.5-flash-lite',
      weekly_remaining_pct: null,
      weekly_reset_at: null,
      weekly_interval_start: null,
      weekly_interval_end: null,
      weekly_active: false,
      weekly_usage_tokens: 0,
      weekly_usage_breakdown: [],
      short_remaining_pct: 55,
      short_reset_at: '2026-05-24T00:00:00.000Z',
      short_interval_start: '2026-05-23T00:00:00.000Z',
      short_interval_end: '2026-05-24T00:00:00.000Z',
      short_active: true,
      short_usage_tokens: 1000,
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
    })
    const makeAntigravityQuotaRow = (
      quotaKey: string,
      remainingPct: number
    ): UsageReportQuotaRow => ({
      ...makeGoogleQuotaRow(),
      provider: 'antigravity',
      model: quotaKey,
      short_active: false,
      short_remaining_pct: null,
      wtus_remaining_pct: remainingPct,
      wtus_reset_at: '2026-06-06T00:04:07Z',
      wtus_interval_start: '2026-06-05T19:04:12Z',
      wtus_interval_end: '9999-12-31T00:00:00Z',
      wtus_active: true,
    })
    let container: HTMLElement | undefined

    await act(async () => {
      const result = render(
        <Wrapper>
          <PhosphorDashboard
            from='2026-05-20'
            to='2026-05-21'
            report={MOCK_REPORT}
            reportLoading={false}
            showComparison={false}
            quotas={[
              makeGoogleQuotaRow(),
              makeAntigravityQuotaRow(
                'antigravity_code_assist:gemini_pool',
                88
              ),
              makeAntigravityQuotaRow(
                'antigravity_code_assist:vertex_pool',
                76
              ),
            ]}
            quotaHistory={[]}
          />
        </Wrapper>
      )
      container = result.container
    })

    const status = container?.querySelector('section#status') as HTMLElement
    const providerNames = Array.from(
      status.querySelectorAll('.provider-name')
    ).map((node) => node.textContent?.trim())

    expect(providerNames).not.toContain('GOOGLE')
    expect(providerNames).not.toContain('ANTIGRAVITY')
    expect(screen.queryByText(/Antigravity Gemini Pool/i)).toBeNull()
    expect(screen.queryByText(/flash-lite · 24h/i)).toBeNull()
  })

  test('test_quota_history_degraded_badge_stays_out_of_health_tab', async () => {
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
            quotaHistoryMetadata={{
              generatedAt: '2026-05-19T00:00:00.000Z',
              degraded: true,
              degradedReason: 'database_timeout',
              degradedMessage: 'Quota history exceeded the bounded timeout.',
              quotaHistoryStatementTimeoutMs: 15000,
            }}
          />
        </Wrapper>
      )
    })

    expect(screen.getByRole('tab', { name: 'Health' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.queryByText('Degraded')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Quota' }))

    expect(await screen.findByText('Degraded')).toHaveClass(
      'section-degraded-badge'
    )
  })

  test('test_token_trend_shows_degraded_badge_for_summary_timeout', async () => {
    server.use(
      http.get('/api/shell/reports/usage/token-trend-summary', () =>
        HttpResponse.json({
          metadata: {
            from: '2026-05-20',
            to: '2026-05-21',
            degraded: true,
            degradedReason: 'database_timeout',
            degradedMessage:
              'Token trend summary exceeded the bounded timeout.',
            tokenTrendSummaryStatementTimeoutMs: 15000,
          },
          tokenTrendHours: [],
          tokenTrendHealth: [],
          tokenTrendScores: [],
          tokenTrendVersions: [],
          tokenTrendModelFirstSeen: [],
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
          />
        </Wrapper>
      )
    })

    expect(await screen.findByText('Degraded')).toHaveClass(
      'section-degraded-badge'
    )
  })

  test('test_token_trend_does_not_show_degraded_badge_for_bounded_raw_lane_policy', async () => {
    server.use(
      http.get('/api/shell/reports/usage/token-trend-summary', () =>
        HttpResponse.json({
          metadata: {
            from: '2026-05-20',
            to: '2026-06-01',
            degraded: true,
            degradedReason: 'bounded_raw_lane_policy',
            degradedMessage:
              'Token trend summary bounded raw-lane policy skipped lanes "hours", "scores", "versions", "modelFirstSeen" for a 31-day range; max allowed is 7 days.',
            skippedSubqueries: [
              'hours',
              'scores',
              'versions',
              'modelFirstSeen',
            ],
            unavailableSubqueries: [
              'hours',
              'scores',
              'versions',
              'modelFirstSeen',
            ],
            tokenTrendSummaryRawLaneMaxDays: 7,
            tokenTrendSummaryRangeDays: 31,
          },
          tokenTrendHours: [],
          tokenTrendHealth: [],
          tokenTrendScores: [],
          tokenTrendVersions: [],
          tokenTrendModelFirstSeen: [],
        })
      )
    )

    await act(async () => {
      render(
        <Wrapper>
          <PhosphorDashboard
            from='2026-05-20'
            to='2026-06-01'
            report={MOCK_REPORT}
            reportLoading={false}
            showComparison={false}
            quotas={[]}
            quotaHistory={[]}
          />
        </Wrapper>
      )
    })

    const trendSection = (await screen.findByText('TREND')).closest('section')

    expect(screen.queryByText('Degraded')).toBeNull()
    expect(trendSection?.querySelector('.section-degraded-badge')).toBeNull()
  })

  test('test_token_trend_shows_degraded_badge_for_bounded_policy_timeout', async () => {
    server.use(
      http.get('/api/shell/reports/usage/token-trend-summary', () =>
        HttpResponse.json({
          metadata: {
            from: '2026-05-20',
            to: '2026-06-01',
            degraded: true,
            degradedReason: 'bounded_raw_lane_policy',
            degradedMessage:
              'Token trend summary skipped broad raw lanes and one query timed out.',
            timeout: true,
            timedOutSubqueries: ['health'],
            skippedSubqueries: [
              'hours',
              'scores',
              'versions',
              'modelFirstSeen',
            ],
            unavailableSubqueries: [
              'health',
              'hours',
              'scores',
              'versions',
              'modelFirstSeen',
            ],
            tokenTrendSummaryRawLaneMaxDays: 7,
            tokenTrendSummaryRangeDays: 31,
          },
          tokenTrendHours: [],
          tokenTrendHealth: [],
          tokenTrendScores: [],
          tokenTrendVersions: [],
          tokenTrendModelFirstSeen: [],
        })
      )
    )

    await act(async () => {
      render(
        <Wrapper>
          <PhosphorDashboard
            from='2026-05-20'
            to='2026-06-01'
            report={MOCK_REPORT}
            reportLoading={false}
            showComparison={false}
            quotas={[]}
            quotaHistory={[]}
          />
        </Wrapper>
      )
    })

    const degradedBadge = await screen.findByText('Degraded')
    expect(degradedBadge).toHaveClass('section-degraded-badge')
    expect(degradedBadge).toHaveAttribute(
      'title',
      expect.stringContaining('one query timed out')
    )
  })

  test('test_pgbouncer_tab_renders_pgbouncer_sidecar_health', async () => {
    server.use(
      http.get('/api/shell/health', () =>
        HttpResponse.json({
          ok: true,
          pgBouncerSidecars: {
            status: 'yellow',
            sidecars: [
              {
                key: 'aawm-pgbouncer',
                label: 'AAWM PgBouncer',
                containerName: 'aawm-pgbouncer',
                hostEndpoint: '127.0.0.1:6432',
                runtimeAliases: ['aawm_tristore', 'aawm_tap_dev'],
                upstreamPostgres: 'aawm-postgres18:5432',
                status: 'green',
                container: {
                  present: true,
                  status: 'healthy',
                  health: 'healthy',
                  running: true,
                  startedAt: '2026-06-06T12:00:00.000Z',
                  finishedAt: null,
                  logConfig: {
                    type: 'json-file',
                    maxSize: '10m',
                    maxFile: '3',
                  },
                  error: null,
                },
                admin: {
                  configured: true,
                  status: 'ok',
                  endpoint: {
                    database: 'pgbouncer',
                    host: 'aawm-pgbouncer',
                    port: '6432',
                  },
                  error: null,
                  poolSummary: {
                    clActive: 2,
                    clWaiting: 0,
                    svActive: 1,
                    svIdle: 3,
                    svUsed: 0,
                    svTested: 0,
                    svLogin: 0,
                    maxWaitSeconds: 0,
                    maxWaitMicroseconds: 0,
                  },
                  statsSummary: {
                    totalXactCount: 42,
                    totalQueryCount: 84,
                    totalReceived: 2048,
                    totalSent: 4096,
                    avgXactCount: 4,
                    avgQueryCount: 8,
                    avgWaitTime: 0,
                  },
                  serverSummary: {
                    total: 4,
                    active: 1,
                    idle: 3,
                    used: 0,
                    tested: 0,
                    login: 0,
                    byState: [
                      { state: 'active', count: 1 },
                      { state: 'idle', count: 3 },
                    ],
                  },
                  pools: [
                    {
                      database: 'aawm_tristore',
                      user: 'aawm',
                      clActive: 2,
                      clWaiting: 0,
                      svActive: 1,
                      svIdle: 3,
                      svUsed: 0,
                      svTested: 0,
                      svLogin: 0,
                      maxWaitSeconds: 0,
                      maxWaitMicroseconds: 0,
                      poolMode: 'transaction',
                    },
                  ],
                  stats: [],
                },
              },
              {
                key: 'aegis-pgbouncer',
                label: 'Aegis PgBouncer',
                containerName: 'aegis-pgbouncer',
                hostEndpoint: '127.0.0.1:6433',
                runtimeAliases: ['aegis'],
                upstreamPostgres: 'aegis-db:5432',
                status: 'red',
                container: {
                  present: false,
                  status: 'missing',
                  health: null,
                  running: false,
                  logConfig: null,
                  error: null,
                },
                admin: {
                  configured: false,
                  status: 'unconfigured',
                  endpoint: null,
                  error: 'PgBouncer admin database URL is not configured.',
                  poolSummary: {
                    clActive: 0,
                    clWaiting: 0,
                    svActive: 0,
                    svIdle: 0,
                    svUsed: 0,
                    svTested: 0,
                    svLogin: 0,
                    maxWaitSeconds: 0,
                    maxWaitMicroseconds: 0,
                  },
                  statsSummary: {
                    totalXactCount: 0,
                    totalQueryCount: 0,
                    totalReceived: 0,
                    totalSent: 0,
                    avgXactCount: 0,
                    avgQueryCount: 0,
                    avgWaitTime: 0,
                  },
                  serverSummary: {
                    total: 0,
                    active: 0,
                    idle: 0,
                    used: 0,
                    tested: 0,
                    login: 0,
                    byState: [],
                  },
                  pools: [],
                  stats: [],
                },
              },
            ],
          },
        } satisfies ShellHealthResponse)
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
          />
        </Wrapper>
      )
    })

    expect(
      screen.queryByRole('region', { name: /pgbouncer health/i })
    ).toBeNull()
    const pgBouncerTab = screen.getByRole('tab', { name: /PgBouncer/ })
    await waitFor(() => {
      expect(
        pgBouncerTab.querySelector('.section-tab-indicator.is-red.is-flashing')
      ).not.toBeNull()
    })
    fireEvent.click(pgBouncerTab)

    const aawmCard = (await screen.findByText('AAWM PgBouncer')).closest(
      'article'
    )
    expect(aawmCard).not.toBeNull()
    const aawm = within(aawmCard as HTMLElement)
    expect(aawm.getAllByText('ok')).toHaveLength(2)
    expect(aawm.getByText(/clients/i)).toBeInTheDocument()
    expect(aawm.getByText(/max wait/i)).toBeInTheDocument()
    expect(aawm.getByText('aawm_tristore')).toBeInTheDocument()
    expect(aawm.getByText(/json-file 10m x3/i)).toBeInTheDocument()

    const aegisCard = screen.getByText('Aegis PgBouncer').closest('article')
    expect(aegisCard).not.toBeNull()
    const aegis = within(aegisCard as HTMLElement)
    expect(aegis.getByText('down')).toBeInTheDocument()
    expect(aegis.getByText('missing')).toBeInTheDocument()
    expect(aegis.getByText('unconfigured')).toBeInTheDocument()
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
          expected_reset_at: '2026-05-22T00:10:00.000Z',
          interval_start: '2026-05-15T00:00:00.000Z',
          interval_end: '2026-05-22T00:10:00.000Z',
          min_remaining_pct: 48,
          usage_tokens: 1500,
          usage_breakdown: [
            {
              model: 'gpt-5.5',
              tokens: 1500,
              cost: 1.5,
              traces: 6,
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
          provider: 'google',
          model: 'gemini-2.5-flash-lite',
          quota_type: 'short',
          expected_reset_at: '2026-05-25T00:00:00.000Z',
          interval_start: '2026-05-24T00:00:00.000Z',
          interval_end: '2026-05-25T00:00:00.000Z',
          min_remaining_pct: 0,
          usage_tokens: 0,
          usage_breakdown: [],
        }),
        quotaHistoryRow({
          provider: 'xai',
          model: 'xai_grok_build_weekly_credits:credits',
          quota_type: 'weekly',
          quota_key: 'xai_grok_build_weekly_credits:credits',
          quota_unit: 'credits',
          source: 'grok_billing',
          client: 'grok-build',
          expected_reset_at: '2026-06-15T00:00:00.000Z',
          interval_start: '2026-06-08T00:00:00.000Z',
          interval_end: '2026-06-15T00:00:00.000Z',
          min_remaining_pct: 98,
          usage_tokens: 120,
          usage_breakdown: [],
        }),
        quotaHistoryRow({
          provider: 'xai',
          model: 'xai_grok_build_monthly_requests:requests',
          quota_type: 'monthly',
          quota_key: 'xai_grok_build_monthly_requests:requests',
          quota_unit: 'requests',
          source: 'grok_billing',
          client: 'grok-build',
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
    expect(weeklyRows).toHaveLength(2)
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

    expect(
      screen.queryByRole('tablist', { name: /google quota bars/i })
    ).toBeNull()
    expect(
      screen.queryByRole('tablist', { name: /antigravity quota bars/i })
    ).toBeNull()

    const xaiBucket = screen
      .getByRole('tablist', { name: /xai quota bars/i })
      .closest('article')
    expect(xaiBucket).not.toBeNull()
    const xai = within(xaiBucket as HTMLElement)
    expect(
      xai.getByRole('tab', { name: /grok build · weekly credits/i })
    ).toBeInTheDocument()
    expect(
      xai.getByRole('tab', { name: /grok build · monthly requests/i })
    ).toBeInTheDocument()
    expect(xai.getByText(/120 tok · 0 req · credits/i)).toBeInTheDocument()
    expect(
      xai.getByText(
        /xai_grok_build_weekly_credits:credits · grok_billing · grok-build/i
      )
    ).toBeInTheDocument()

    fireEvent.click(
      xai.getByRole('tab', { name: /grok build · monthly requests/i })
    )
    expect(xai.getByText(/321 tok · 4 req · requests/i)).toBeInTheDocument()
    expect(
      xai.getByText(
        /xai_grok_build_monthly_requests:requests · grok_billing · grok-build/i
      )
    ).toBeInTheDocument()
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

    expect(screen.queryByText('google')).toBeNull()
    expect(screen.queryByText('antigravity')).toBeNull()
    expect(
      screen.queryByRole('tablist', { name: /google quota bars/i })
    ).toBeNull()

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

  test('test_status_diagnostics_tab_fetches_session_diagnostics_and_renders_metadata_families', async () => {
    let seenFrom: string | null = null
    let seenTo: string | null = null
    let seenProvider: string | null = null
    let seenModel: string | null = null
    let seenRepository: string | null = null
    let seenClient: string | null = null
    let seenLimit: string | null = null

    server.use(
      http.get(
        '/api/shell/reports/usage/session-diagnostics',
        ({ request }) => {
          const url = new URL(request.url)
          seenFrom = url.searchParams.get('from')
          seenTo = url.searchParams.get('to')
          seenProvider = url.searchParams.get('provider')
          seenModel = url.searchParams.get('model')
          seenRepository = url.searchParams.get('repository')
          seenClient = url.searchParams.get('client')
          seenLimit = url.searchParams.get('limit')
          return HttpResponse.json({
            metadata: {
              from: '2026-05-20',
              to: '2026-05-21',
              limit: 100,
              generatedAt: '2026-05-21T00:00:00.000Z',
            },
            sessionDiagnostics: [
              {
                created_at: '2026-05-20T12:00:00.000Z',
                session_id: 'sess-1',
                trace_id: 'trace-1',
                litellm_call_id: 'call-1',
                provider: 'xai',
                model: 'grok-composer-2.5-fast',
                repository: 'dashboard-shell',
                client: 'grok-build',
                diagnostic_flags: [
                  'grok_oauth',
                  'alias_routing',
                  'output_contract',
                  'tool_definitions',
                  'xai_sanitizer',
                  'transcript_attribution',
                  'grok_side_channel',
                ],
                diagnostic_categories: [
                  'route_identity',
                  'route_timeline',
                  'agent_quality',
                  'tool_contract',
                  'request_shape',
                  'model_attribution',
                ],
                grok_oauth: {
                  credential_family: 'xai_grok_oidc',
                  grok_native_oauth_managed: true,
                  grok_native_entrypoint: 'openai_responses',
                },
                grok_side_channel: {
                  enabled: true,
                  endpoint_type: 'register',
                  endpoint_template: '/grok/v1/sessions/register',
                  content_type: 'application/json',
                  body_byte_length: 256,
                  body_sha256: 'deadbeefcafebabe',
                  digest_source: 'request_body',
                  json_container_type: 'object',
                  top_level_key_types: { model: 'string', tools: 'array' },
                  array_length: 3,
                },
                output_contract: {
                  usage_output_contract_required_final_phrase_present: false,
                  usage_output_contract_failure_class:
                    'missing_required_final_phrase',
                  usage_output_contract_setup_only_detected: true,
                },
                xai_sanitizer: {
                  xai_responses_request_sanitized: true,
                  xai_responses_sanitized_removed_params: [
                    'instructions',
                    'tool_choice',
                  ],
                  xai_responses_sanitized_tool_count: 2,
                  xai_responses_sanitized_tool_types: ['function'],
                  xai_tool_choice_without_tools_removed: {
                    name: 'Bash',
                    type: 'function',
                  },
                  xai_tool_choice_without_tools_removed_reason: 'missing_tools',
                  request_tags: [
                    'xai-tool-choice-without-tools-removed',
                    'xai-tool-choice-without-tools:function',
                  ],
                  xai_responses_sanitized_tools: [
                    { name: 'Bash', type: 'function' },
                    { name: 'Read', type: 'function' },
                  ],
                  passthrough_route_family: 'grok_cli_chat_proxy',
                },
                tool_definitions: {
                  aawm_tool_definition_capture_version: 'v1',
                  aawm_tool_definition_count: 3,
                  aawm_tool_definition_captured_count: 2,
                  aawm_tool_definition_names: ['Bash', 'Read'],
                  aawm_tool_definition_types: ['function', 'function'],
                  snapshot_hash: 'abc123',
                  aawm_tool_definition_snapshot_truncated: true,
                  tool_definition_snapshot: [
                    { name: 'Bash', type: 'function' },
                    { name: 'Read', type: 'function' },
                  ],
                },
                alias_route_events: [
                  {
                    observed_at: '2026-05-20T12:00:00.000Z',
                    alias_model: 'aawm-code',
                    provider: 'anthropic',
                    model: 'claude-sonnet-4-6',
                    event_type: 'candidate_selected',
                    attempt_number: 2,
                    cooldown_state: 'active',
                    redispatch_required: true,
                    last_resort: false,
                  },
                ],
                grok_side_channel_request_body_raw:
                  'RAW_SECRET_BODY_SHOULD_NOT_RENDER',
                transcript_attribution: {
                  session_history_transcript_attribution_status:
                    'unrecoverable',
                  session_history_transcript_attribution_source:
                    'd1-229-claude-raw-transcript-attribution',
                  session_history_transcript_attribution: {
                    status: 'unrecoverable',
                    reason: 'no_explicit_transcript_model_event',
                    match_rule: 'transcript_model_event',
                    updated_at: '2026-05-20T12:05:00.000Z',
                  },
                },
                anthropic_context_window: {
                  mode: 'extended_1m',
                  requested_tokens: 1000000,
                  source: 'model_suffix_1m',
                  beta: 'context-1m-2025-08-07',
                  classification: {
                    label: 'extended_1m',
                    evidence: 'model_suffix',
                  },
                },
              },
            ],
          } satisfies UsageReportSessionDiagnosticsResponse)
        }
      )
    )

    await act(async () => {
      render(
        <Wrapper>
          <PhosphorDashboard
            from='2026-05-20'
            to='2026-05-21'
            filters={{
              providers: ['xai'],
              repositories: ['dashboard-shell'],
              clients: ['grok-build'],
              environments: [],
              models: ['grok-composer-2.5-fast'],
            }}
            report={MOCK_REPORT}
            reportLoading={false}
            showComparison={false}
            quotas={[]}
          />
        </Wrapper>
      )
    })

    expect(screen.queryByText('Session diagnostics')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Diagnostics' }))

    await waitFor(() => {
      expect(
        screen.getByText('Loading session diagnostics...')
      ).toBeInTheDocument()
    })
    expect(seenFrom).toBe('2026-05-20')
    expect(seenTo).toBe('2026-05-21')
    expect(seenProvider).toBe('xai')
    expect(seenModel).toBe('grok-composer-2.5-fast')
    expect(seenRepository).toBe('dashboard-shell')
    expect(seenClient).toBe('grok-build')
    expect(seenLimit).toBe('100')
    const diagnosticsCard = (
      await screen.findByText('grok-composer-2.5-fast')
    ).closest('article') as HTMLElement

    expect(
      within(diagnosticsCard).getByText('xai_grok_oidc')
    ).toBeInTheDocument()
    expect(
      within(diagnosticsCard).getByText('missing_required_final_phrase')
    ).toBeInTheDocument()
    expect(
      within(diagnosticsCard).getByText('missing_tools')
    ).toBeInTheDocument()
    expect(within(diagnosticsCard).getByText('abc123')).toBeInTheDocument()
    expect(
      within(diagnosticsCard).getByText('1 audit events')
    ).toBeInTheDocument()
    expect(
      within(diagnosticsCard).getByText('unrecoverable')
    ).toBeInTheDocument()

    expect(
      within(diagnosticsCard).getByText('Requested context window')
    ).toBeInTheDocument()
    expect(within(diagnosticsCard).getByText('1M extended')).toBeInTheDocument()
    expect(
      within(diagnosticsCard).getByText('model_suffix_1m')
    ).toBeInTheDocument()
    expect(
      within(diagnosticsCard).getByText('context-1m-2025-08-07')
    ).toBeInTheDocument()
    expect(within(diagnosticsCard).getByText('1000000')).toBeInTheDocument()

    expect(
      within(diagnosticsCard).getByText('aawm_tool_definition_captured_count')
    ).toBeInTheDocument()
    expect(
      within(diagnosticsCard).getByText('aawm_tool_definition_count')
    ).toBeInTheDocument()
    expect(
      within(diagnosticsCard).getByText(
        'aawm_tool_definition_snapshot_truncated'
      )
    ).toBeInTheDocument()
    expect(
      within(diagnosticsCard).getByText('aawm_tool_definition_names')
    ).toBeInTheDocument()
    expect(
      within(diagnosticsCard).getByText('aawm_tool_definition_types')
    ).toBeInTheDocument()
    expect(within(diagnosticsCard).getByText('Bash, Read')).toBeInTheDocument()
    expect(
      within(diagnosticsCard).getByText('function, function')
    ).toBeInTheDocument()

    expect(
      within(diagnosticsCard).getByText('responses_sanitized_removed_params')
    ).toBeInTheDocument()
    expect(
      within(diagnosticsCard).getByText('tool_choice_without_tools_removed')
    ).toBeInTheDocument()
    expect(
      within(diagnosticsCard).getByText(
        'tool_choice_without_tools_removed_reason'
      )
    ).toBeInTheDocument()
    expect(
      within(diagnosticsCard).getByText('request_tags')
    ).toBeInTheDocument()
    expect(
      within(diagnosticsCard).getByText('instructions, tool_choice')
    ).toBeInTheDocument()
    expect(
      within(diagnosticsCard).getByText('{"name":"Bash","type":"function"}')
    ).toBeInTheDocument()
    expect(
      within(diagnosticsCard).getByText(
        'xai-tool-choice-without-tools-removed, xai-tool-choice-without-tools:function'
      )
    ).toBeInTheDocument()

    const sanitizedToolsDetail = within(diagnosticsCard)
      .getByText('sanitized tools')
      .closest('details') as HTMLElement
    fireEvent.click(within(sanitizedToolsDetail).getByText('sanitized tools'))
    expect(
      within(sanitizedToolsDetail).getByText(/"name": "Bash"/)
    ).toBeInTheDocument()
    expect(
      within(sanitizedToolsDetail).getByText(/"name": "Read"/)
    ).toBeInTheDocument()

    const removedToolChoiceDetail = within(diagnosticsCard)
      .getByText('removed tool choice')
      .closest('details') as HTMLElement
    fireEvent.click(
      within(removedToolChoiceDetail).getByText('removed tool choice')
    )
    expect(
      within(removedToolChoiceDetail).getByText(/"type": "function"/)
    ).toBeInTheDocument()

    const toolDefinitionSnapshotDetail = within(diagnosticsCard)
      .getByText('tool definition snapshot')
      .closest('details') as HTMLElement
    fireEvent.click(
      within(toolDefinitionSnapshotDetail).getByText('tool definition snapshot')
    )
    expect(
      within(toolDefinitionSnapshotDetail).getByText(/"name": "Bash"/)
    ).toBeInTheDocument()
    expect(
      within(toolDefinitionSnapshotDetail).getByText(/"name": "Read"/)
    ).toBeInTheDocument()

    const aliasTimelineRow = within(diagnosticsCard)
      .getByText('candidate_selected')
      .closest('.status-diagnostics-timeline-row') as HTMLElement
    expect(
      within(aliasTimelineRow).getByText('2026-05-20T12:00:00.000Z')
    ).toBeInTheDocument()
    expect(
      within(aliasTimelineRow).getByText(
        'aawm-code -> anthropic -> claude-sonnet-4-6'
      )
    ).toBeInTheDocument()
    expect(within(aliasTimelineRow).getByText(/attempt/i)).toBeInTheDocument()
    expect(within(aliasTimelineRow).getByText(/cooldown/i)).toBeInTheDocument()
    expect(
      within(aliasTimelineRow).getByText(/redispatch/i)
    ).toBeInTheDocument()
    expect(
      within(aliasTimelineRow).getByText(/last resort/i)
    ).toBeInTheDocument()

    fireEvent.click(within(diagnosticsCard).getByText('alias route events'))
    expect(
      within(diagnosticsCard).getByText(
        /"observed_at": "2026-05-20T12:00:00.000Z"/
      )
    ).toBeInTheDocument()
    expect(
      within(diagnosticsCard).getByText(/"attempt_number": 2/)
    ).toBeInTheDocument()
    expect(
      within(diagnosticsCard).getByText(/"cooldown_state": "active"/)
    ).toBeInTheDocument()
    expect(
      within(diagnosticsCard).getByText(/"redispatch_required": true/)
    ).toBeInTheDocument()
    expect(
      within(diagnosticsCard).getByText(/"last_resort": false/)
    ).toBeInTheDocument()

    expect(
      within(diagnosticsCard).getByText('unknown model (unrecoverable)')
    ).toBeInTheDocument()
    expect(
      within(diagnosticsCard).getByText('no_explicit_transcript_model_event')
    ).toBeInTheDocument()
    expect(
      within(diagnosticsCard).getByText('transcript_model_event')
    ).toBeInTheDocument()
    expect(
      within(diagnosticsCard).getByText('2026-05-20T12:05:00.000Z')
    ).toBeInTheDocument()

    const grokSideChannelBlock = within(diagnosticsCard)
      .getByText('Grok side-channel')
      .closest('.status-estimator-block') as HTMLElement
    expect(grokSideChannelBlock).toBeInTheDocument()
    expect(
      within(grokSideChannelBlock).getByText('register')
    ).toBeInTheDocument()
    expect(
      within(grokSideChannelBlock).getByText('/grok/v1/sessions/register')
    ).toBeInTheDocument()
    expect(
      within(grokSideChannelBlock).getByText('application/json')
    ).toBeInTheDocument()
    expect(within(grokSideChannelBlock).getByText('256')).toBeInTheDocument()
    expect(
      within(grokSideChannelBlock).getByText('request_body')
    ).toBeInTheDocument()
    expect(
      within(grokSideChannelBlock).getByText('deadbeefcafebabe')
    ).toBeInTheDocument()
    expect(within(grokSideChannelBlock).getByText('object')).toBeInTheDocument()
    expect(within(grokSideChannelBlock).getByText('3')).toBeInTheDocument()
    fireEvent.click(
      within(grokSideChannelBlock).getByText('top-level key types')
    )
    expect(
      within(grokSideChannelBlock).getByText(/"model": "string"/)
    ).toBeInTheDocument()
    expect(
      within(grokSideChannelBlock).getByText(/"tools": "array"/)
    ).toBeInTheDocument()
    expect(
      within(diagnosticsCard).queryByText('RAW_SECRET_BODY_SHOULD_NOT_RENDER')
    ).toBeNull()
    expect(document.body.textContent).not.toContain(
      'RAW_SECRET_BODY_SHOULD_NOT_RENDER'
    )

    fireEvent.click(
      within(diagnosticsCard).getByText('transcript attribution detail')
    )
    expect(
      within(diagnosticsCard).getByText(/"status": "unrecoverable"/)
    ).toBeInTheDocument()
    expect(
      within(diagnosticsCard).getByText(
        /"reason": "no_explicit_transcript_model_event"/
      )
    ).toBeInTheDocument()
    expect(
      within(diagnosticsCard).getByText(
        /"match_rule": "transcript_model_event"/
      )
    ).toBeInTheDocument()
    expect(
      within(diagnosticsCard).getByText(
        /"updated_at": "2026-05-20T12:05:00.000Z"/
      )
    ).toBeInTheDocument()
  })

  // S1-T4 flake fix: replace the 40ms real-delay race with a deferred-promise
  // handler resolved explicitly so the loading state is stable before releasing.
  test('test_status_weights_tab_loading_and_empty_states', async () => {
    // Deferred promise: we control when the estimator response is released.
    let releaseEstimator!: () => void
    const estimatorGate = new Promise<void>((resolve) => {
      releaseEstimator = resolve
    })

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
        await estimatorGate
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

    // Click the Weights tab — the estimator query fires but the gate is still held.
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Weights' }))
    })
    // Loading state must be visible while the gate is held (no real-time race).
    expect(
      screen.getByText('Loading Phase 0-2 estimator detail…')
    ).toBeInTheDocument()

    // Release the gate so the response resolves.
    await act(async () => {
      releaseEstimator()
    })

    await waitFor(() => {
      expect(
        screen.getByText('No Phase 0-2 estimator lanes for the selected range.')
      ).toBeInTheDocument()
    })
  })

  // S1-T8 strengthened: assert tab behavior (selected state + keyboard-navigable)
  // not just class presence.
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

    // STATUS section: Health tab must be selected by default; switching to Quota
    // changes the aria-selected state — class presence alone doesn't verify this.
    const healthTab = screen.getByRole('tab', { name: 'Health' })
    expect(healthTab).toHaveAttribute('aria-selected', 'true')
    const quotaTab = screen.getByRole('tab', { name: 'Quota' })
    expect(quotaTab).toHaveAttribute('aria-selected', 'false')
    const pgBouncerTab = screen.getByRole('tab', { name: 'PgBouncer' })
    expect(pgBouncerTab).toHaveAttribute('aria-selected', 'false')
    const providerCreditsTab = screen.getByRole('tab', {
      name: 'Provider Credits',
    })
    expect(providerCreditsTab).toHaveAttribute('aria-selected', 'false')
    const providerAuthTab = screen.getByRole('tab', { name: 'Provider Auth' })
    expect(providerAuthTab).toHaveAttribute('aria-selected', 'false')
    const aliasRoutingTab = screen.getByRole('tab', { name: 'Alias Routing' })
    expect(aliasRoutingTab).toHaveAttribute('aria-selected', 'false')
    const weightsTab = screen.getByRole('tab', { name: 'Weights' })
    expect(weightsTab).toHaveAttribute('aria-selected', 'false')

    // Switching to Quota flips aria-selected — behavioral, not structural.
    fireEvent.click(quotaTab)
    expect(quotaTab).toHaveAttribute('aria-selected', 'true')
    expect(healthTab).toHaveAttribute('aria-selected', 'false')

    fireEvent.click(pgBouncerTab)
    expect(pgBouncerTab).toHaveAttribute('aria-selected', 'true')
    expect(quotaTab).toHaveAttribute('aria-selected', 'false')

    fireEvent.click(providerCreditsTab)
    expect(providerCreditsTab).toHaveAttribute('aria-selected', 'true')
    expect(pgBouncerTab).toHaveAttribute('aria-selected', 'false')

    fireEvent.click(providerAuthTab)
    expect(providerAuthTab).toHaveAttribute('aria-selected', 'true')
    expect(providerCreditsTab).toHaveAttribute('aria-selected', 'false')

    fireEvent.click(aliasRoutingTab)
    expect(aliasRoutingTab).toHaveAttribute('aria-selected', 'true')
    expect(providerAuthTab).toHaveAttribute('aria-selected', 'false')

    // LEDGER section: Model tab selected by default.
    const modelTab = screen.getByRole('tab', { name: 'Model' })
    expect(modelTab).toHaveAttribute('aria-selected', 'true')
    const repositoryTab = screen.getByRole('tab', { name: 'Repository' })
    expect(repositoryTab).toHaveAttribute('aria-selected', 'false')

    fireEvent.click(repositoryTab)
    expect(repositoryTab).toHaveAttribute('aria-selected', 'true')
    expect(modelTab).toHaveAttribute('aria-selected', 'false')
  })

  // S1-T8 strengthened: assert the Updating label text is non-empty AND the
  // refresh button is disabled while fetching — not just "some element has text".
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

    // At least one "Updating" label must appear in the UI (ledger refresh control).
    const updatingLabels = screen.getAllByText('Updating')
    expect(updatingLabels.length).toBeGreaterThanOrEqual(1)
    // The ledger refresh button must be disabled while reportFetching=true so
    // the user cannot trigger a second fetch mid-flight.
    expect(
      screen.getByRole('button', { name: /refresh model ledger data/i })
    ).toBeDisabled()
  })

  // S1-T8 strengthened: legend behavioral assertions — verify the element is
  // keyboard-accessible (role=region) and has a visible, non-empty label, then
  // confirm the key semantic items appear as legible text (not just CSS swatches).
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

    // The legend must be discoverable by its accessible label so screen-reader
    // users can navigate to it — pure class selectors don't verify this.
    const legend = screen.getByRole('region', {
      name: 'Provider health and quota color legend',
    })
    expect(legend).toBeInTheDocument()

    // Key terms must be present as visible text, not only as CSS class names.
    expect(within(legend).getByText(/health/i)).toBeInTheDocument()
    expect(within(legend).getByText(/quota used/i)).toBeInTheDocument()
    expect(within(legend).getByText(/burn/i)).toBeInTheDocument()

    // Swatch elements must exist (structural check retained as secondary guard).
    expect(
      container.querySelectorAll('.status-legend-swatch.health-miss')
    ).toHaveLength(1)
    expect(
      container.querySelectorAll('.status-legend-swatch.velocity-peak')
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

    // The internal useQuery is gated by parent-managed report loading/fetching.
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
    const cells = padHealthCells(
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
    const cells = padHealthCells(
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
    const cells = padHealthCells(
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
    const cells = padHealthCells(
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
    const cells = padHealthCells([makeHealthRow()], 'xai')

    expect(cells[287].category).toBeUndefined()
    expect(cells[287].rawP95Ms).toBeNull()
    expect(cells[287].rawErrorCount).toBe(0)
  })

  test('test_provider_without_health_rows_renders_no_data_blue_path', () => {
    const cells = padHealthCells([], 'local')

    expect(cells).toHaveLength(288)
    expect(cells[0].category).toBeUndefined()
    expect(cells[0].rawP95Ms).toBeNull()
    expect(cells[0].rawErrorCount).toBe(0)
    expect(cells[287].rawP95Ms).toBeNull()
  })

  test('test_aggregate_health_cells_overlay_provider_errors_by_bucket', () => {
    const cells = buildAggregateHealthCells([
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
    const cells = buildAggregateHealthCells([
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
    const cells = padHealthCells(
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
    const cells = buildAggregateHealthCells([
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
    const cells = padHealthCells(
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
    const cells = buildAggregateHealthCells(
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
  test('test_parent_managed_loading_without_report_does_not_duplicate_usage_query', async () => {
    let usageCallCount = 0
    server.use(
      http.get('/api/shell/reports/usage', () => {
        usageCallCount += 1
        return HttpResponse.json(MOCK_REPORT)
      })
    )

    await act(async () => {
      render(
        <Wrapper>
          <PhosphorDashboard
            from='2026-04-19'
            to='2026-05-19'
            reportLoading={true}
            reportFetching={true}
            onRefreshReport={async () => undefined}
            showComparison={false}
          />
        </Wrapper>
      )
    })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    expect(usageCallCount).toBe(0)
  })

  test('test_status_diagnostics_tab_reachable_while_report_loading', async () => {
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
            reportLoading={true}
            reportFetching={true}
            onRefreshReport={async () => undefined}
            showComparison={false}
            quotas={[]}
          />
        </Wrapper>
      )
    })

    expect(screen.getByRole('heading', { name: 'STATUS' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Diagnostics' }))

    await waitFor(
      () => {
        expect(
          screen.getByText('Loading session diagnostics...')
        ).toBeInTheDocument()
      },
      { timeout: 3000 }
    )
  })

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

  test('test_format_time_ago_future_over_1min_returns_time_label', () => {
    // > 1 minute in the future → use absolute distance so UI shows a sensible
    // label rather than "now" for rounding artefacts (e.g. 30m-ago rounded up).
    // We use 2h+30s future so sub-second timing jitter doesn't affect floor().
    const d = new Date(PINNED_NOW + 2 * 60 * 60_000 + 30_000) // ~2h 30s in the future
    expect(formatTimeAgo(d)).toBe('2h ago')
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
    const lanes = buildProviderLanes('anthropic', quotaRows, [])
    // Lanes that have a current bar or prior bars: all 3 have current bars.
    expect(lanes.length).toBe(3)
    const keys = lanes.map((l) => l.laneKey)
    expect(keys).toContain('anthropic/short')
    expect(keys).toContain('anthropic/special')
    expect(keys).toContain('anthropic/weekly')
  })

  test('test_anthropic_lane_order_short_special_weekly', () => {
    const quotaRows = [makeAnthropicQuotaRow()]
    const lanes = buildProviderLanes('anthropic', quotaRows, [])
    expect(lanes[0].laneKey).toBe('anthropic/short')
    expect(lanes[1].laneKey).toBe('anthropic/special')
    expect(lanes[2].laneKey).toBe('anthropic/weekly')
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

  test('test_google_lanes_include_antigravity_wtus_detail', () => {
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
      'google',
      [
        makeAntigravityRow('antigravity_code_assist:gemini_pool', 88),
        makeAntigravityRow('antigravity_code_assist:vertex_pool', 76),
      ],
      historyRows
    )

    expect(lanes.map((lane) => lane.laneKey)).toEqual([
      'google/antigravity-gemini-pool',
      'google/antigravity-vertex-pool',
    ])
    expect(lanes.map((lane) => lane.laneLabel)).toEqual([
      'Antigravity Gemini Pool · WTUs',
      'Antigravity Vertex Pool · WTUs',
    ])
    expect(lanes[0].currentBar?.consumedPct).toBe(12)
    expect(lanes[1].currentBar?.consumedPct).toBe(24)
    expect(lanes[0].priorBars).toHaveLength(1)
    expect(lanes[1].priorBars).toHaveLength(1)
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

  test('test_xai_generic_monthly_row_does_not_render_grok_build_lane', () => {
    const xaiRow: UsageReportQuotaRow = {
      ...makeAnthropicQuotaRow(),
      provider: 'xai',
      model: 'oa_xai/grok-4.3',
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
    const lanes = buildProviderLanes('xai', [xaiRow], [])
    expect(lanes).toEqual([])
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

    const lanes = buildProviderLanes('openrouter', [openrouterRow], historyRows)

    expect(lanes).toHaveLength(1)
    expect(lanes[0].laneKey).toBe('openrouter/requests')
    expect(lanes[0].laneLabel).toBe('Free Requests · 24h')
    expect(lanes[0].currentBar?.consumedPct).toBeCloseTo(0.6, 1)
    expect(lanes[0].priorBars).toHaveLength(1)
    expect(lanes[0].priorBars[0].consumedPct).toBe(18)
  })

  test('test_unknown_provider_returns_empty_lanes', () => {
    const lanes = buildProviderLanes('nvidia_nim', [], [])
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
    const lanes = buildProviderLanes('openai', [openaiRow], historyRows)
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
    const lanes = buildProviderLanes('openai', [openaiRow], historyRows)
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
    const lanes = buildProviderLanes('openai', [openaiRow], historyRows)
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
    const lanes = buildProviderLanes('openai', [openaiRow], historyRows)
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
    const result = fmtIntervalCompact(
      '2026-05-19T10:00:00Z',
      '2026-05-20T10:00:00Z'
    )
    expect(result).toBe('5/19 06:00 → 5/20 06:00')
  })

  test('test_fmt_interval_compact_snaps_to_nearest_30min', () => {
    // 2026-05-20T09:44:00Z: nearest 30-min boundary is 09:30 (44m → round down)
    // 2026-05-20T14:52:00Z: nearest 30-min boundary is 15:00 (52m → round up)
    const result = fmtIntervalCompact(
      '2026-05-20T09:44:00Z',
      '2026-05-20T14:52:00Z'
    )
    expect(result).toBe('5/20 05:30 → 5/20 11:00')
  })

  test('test_fmt_interval_compact_returns_dash_on_null_start', () => {
    const result = fmtIntervalCompact(null, '2026-05-20T10:00:00Z')
    expect(result).toBe('—')
  })

  test('test_fmt_interval_compact_returns_dash_on_null_end', () => {
    const result = fmtIntervalCompact('2026-05-19T10:00:00Z', null)
    expect(result).toBe('—')
  })

  test('test_fmt_interval_compact_pads_hours_and_minutes', () => {
    // 2026-05-03T01:00:00Z — single-digit month and day, leading-zero hour
    const result = fmtIntervalCompact(
      '2026-05-03T01:00:00Z',
      '2026-05-03T06:00:00Z'
    )
    expect(result).toBe('5/2 21:00 → 5/3 02:00')
  })

  test('test_fmt_interval_compact_crosses_month_boundary', () => {
    const result = fmtIntervalCompact(
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
// S1-3: buildPriorBarFromHistory — null min_remaining_pct must NOT produce
//        a 100%-consumed bar. The `?? 0` fallback is the bug under test.
// Engineer must fix: `remainingPct = h.min_remaining_pct ?? 0` → guard null
// and return a sentinel (consumedPct: null / remainingPct: null).
// ---------------------------------------------------------------------------

describe('S1-3 — buildPriorBarFromHistory null min_remaining_pct', () => {
  test('test_buildPriorBarFromHistory_null_remaining_is_not_full_consumption', () => {
    // Arrange: a history row with min_remaining_pct === null
    // (e.g. an interrupted interval where no consumption was recorded)
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

    // The bug: `remainingPct = h.min_remaining_pct ?? 0` treats null as 0,
    // producing consumedPct = 100. A null remaining_pct must NOT render as
    // 100% consumed — the bar should signal "no data" (consumedPct === 0
    // OR remainingPct === 100, i.e. the complement of a 0-remaining null).
    // When this assertion fails, the engineer must fix the ?? 0 fallback.
    expect(bar.consumedPct).not.toBe(100)
    // Guard: remainingPct should not be 0 when input was null
    expect(bar.remainingPct).not.toBe(0)
  })
})

// ---------------------------------------------------------------------------
// S1-4: buildProviderLanes — two distinct null-expected_reset_at rows with
//        distinct interval_start must both survive (not collapse to one entry
//        via the shared '' dedup key).
// Engineer must fix: dedup key for null reset rows to use interval_start
//        instead of '' so distinct null-reset rows are not collapsed.
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
    // Two history rows for the same anthropic/weekly lane, both with
    // expected_reset_at === null but distinct interval_start values.
    // Current bug: both share dedup key '' → second row is collapsed.
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

    // Both distinct null-reset rows must survive — the bug collapses them to 1.
    // When this fails, fix the dedup key to use interval_start for null resets.
    expect(weeklyLane!.priorBars).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// S1-5: buildAggregateHealthCells — error-event tooltip joins to its health
//        cell even when bucket_start uses a +00:00 offset instead of Z.
// The join uses bucketKeyFromIso which normalizes via new Date(), so both
// formats should map to the same key. This is a regression-guard test.
// ---------------------------------------------------------------------------

describe('S1-5 — health event join normalizes +00:00 offset bucket_start', () => {
  test('test_health_event_join_normalizes_both_sides', () => {
    // Arrange: a health row with bucket_start in +00:00 form (not Z).
    // HEALTH_BUCKET_MS = 5 * 60 * 1000 (5-minute buckets).
    // bucketKeyFromIso normalises both via new Date() → getTime() so
    // '2026-05-20T10:00:00+00:00' and '2026-05-20T10:00:00.000Z' must map
    // to the same bucket key.
    const bucketIsoPlus = '2026-05-20T10:00:00+00:00'
    // Observation at 10:02 — within the same 5-min bucket (10:00–10:05 UTC)
    const observedAtZ = '2026-05-20T10:02:00.000Z'

    const healthRow: UsageReportProviderLatencyHealthRow = {
      bucket_start: bucketIsoPlus, // ← +00:00 form under test
      environment: 'production',
      provider: 'openai',
      model: 'gpt-5.5',
      model_group: 'gpt',
      requests: 10,
      passive_latency_sample_status: 'ok',
      upstream_p50_ms: 200,
      upstream_p95_ms: 500,
      upstream_p99_ms: 800,
      total_p95_ms: 500,
      proxy_processing_p95_ms: null,
      missing_upstream_latency: 0,
      provider_error_events: 1,
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
    }

    const observation: UsageReportProviderErrorObservationRow = {
      observed_at: observedAtZ,
      environment: 'production',
      provider: 'openai',
      model: 'gpt-5.5',
      model_group: 'gpt',
      route_family: 'standard',
      status_code: 429,
      error_type: 'rate_limit',
      error_code: 'rate_limit_exceeded',
      error_class: 'rate_limit',
      error_message: 'Rate limit exceeded',
      retry_after_seconds: null,
      expected_reset_at: null,
    }

    // Build aggregate health cells with the +00:00 health row and a matching observation
    const cells = buildAggregateHealthCells([healthRow], [observation])

    // The cell containing our health row should have an events array with the
    // observation joined to it. If bucket_start normalisation is broken, the
    // join fails and events is empty/undefined.
    const cellWithEvents = cells.find(
      (c) => c.events !== undefined && c.events.length > 0
    )

    // Assert: the observation must appear as an event on the matching cell.
    // Failure means bucketKeyFromIso does not normalize +00:00 ↔ Z correctly.
    expect(cellWithEvents).toBeDefined()
    expect(cellWithEvents!.events![0].errorType).toContain('rate limit')
  })
})

// ---------------------------------------------------------------------------
// S1-7: buildProviderLanes — Google best row should prefer the row with the
//        most-recent interval_start, NOT the shortest model name.
// Current code sorts by model name length (shorter = preferred), which can
// surface stale data when a longer-named successor has newer data.
// Engineer must fix: secondary sort key = interval_start DESC.
// ---------------------------------------------------------------------------

describe('S1-7 — Google best row prefers recent interval_start not shortest name', () => {
  function makeGoogleQuotaRow(
    model: string,
    intervalStart: string,
    overrides: Partial<UsageReportQuotaRow> = {}
  ): UsageReportQuotaRow {
    return {
      provider: 'google',
      model,
      weekly_remaining_pct: null,
      weekly_reset_at: null,
      weekly_interval_start: null,
      weekly_interval_end: null,
      weekly_active: false,
      weekly_usage_tokens: 0,
      weekly_usage_breakdown: [],
      short_remaining_pct: 70,
      short_reset_at: '2026-05-21T00:00:00Z',
      short_interval_start: intervalStart,
      short_interval_end: '2026-05-21T00:00:00Z',
      short_active: true,
      short_usage_tokens: 500,
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

  test('test_google_best_row_prefers_recent_interval_not_shortest_name', () => {
    // Two active gemini-flash rows:
    //   - gemini-flash (shorter name, OLDER interval_start)     → current code picks this
    //   - gemini-flash-001 (longer name, NEWER interval_start)  → should win instead
    const olderShortName = makeGoogleQuotaRow(
      'gemini-flash',
      '2026-05-19T00:00:00Z', // older
      { short_remaining_pct: 50 }
    )
    const newerLongName = makeGoogleQuotaRow(
      'gemini-flash-001',
      '2026-05-20T00:00:00Z', // newer ← should win
      { short_remaining_pct: 30 }
    )

    const lanes = buildProviderLanes(
      'google',
      [olderShortName, newerLongName],
      [] // no history rows needed
    )

    const flashLane = lanes.find((l) => l.laneKey === 'google/flash')
    expect(flashLane).toBeDefined()
    expect(flashLane!.currentBar).not.toBeNull()

    // The newer interval_start row has remainingPct=30; the shorter-named row
    // has remainingPct=50. If the current (buggy) code runs, it picks the
    // shorter-named row → remainingPct=50. The fix makes it pick the newer one.
    // This assertion FAILS on the current implementation.
    expect(flashLane!.currentBar!.remainingPct).toBe(30)
  })
})

// ---------------------------------------------------------------------------
// S1-10: buildModelRows — alias provider ('gemini') in providerStatusUsage
//         joins to real token_in/out from usageRows (not 60/40 fallback).
// buildModelRows is NOT yet exported; a _buildModelRowsForTest export must
// be added by the engineer. Until then this is a component-level render test.
// ENGINEER ACTION: export buildModelRows as _buildModelRowsForTest.
// ---------------------------------------------------------------------------

describe('S1-10 — buildModelRows alias provider joins via canonical key', () => {
  test('test_buildModelRows_alias_provider_joins_via_canonical_key', async () => {
    // Scenario: providerStatusUsage has provider='gemini' (alias),
    // usageRows has provider='google' (canonical). buildModelRows must
    // normalize both via canonicalProvider and join them, giving real
    // token_in/out. If the join fails, the 60/40 split is used instead.
    //
    // Chosen values to distinguish real vs fallback:
    //   token_total = 1000 → fallback: token_in=600, token_out=400
    //   real:                          token_in=700, token_out=300
    const report: UsageReportResponse = {
      ...MOCK_REPORT,
      providerStatusUsage: [
        {
          provider: 'gemini', // alias form — must map to 'google'
          model: 'Gemini-Flash', // mixed-case — must lower to 'gemini-flash'
          traces: 5,
          token_total: 1000,
          usd_cost: 0.1,
          period_start: '2026-05-18',
          period_end: '2026-05-19',
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
        },
      ],
      rows: [
        {
          // usageRows use canonical 'google' + lowercase model
          bucket: '2026-05-18T00:00:00Z',
          provider: 'google',
          model: 'gemini-flash',
          token_in: 700, // real value — NOT 600 (the 60% fallback)
          token_out: 300, // real value — NOT 400 (the 40% fallback)
          token_total: 1000,
          token_cache_input: 0,
          token_cache_creation: 0,
          token_reasoning_reported: 0,
          token_reasoning_estimated: 0,
          usd_cost: 0.1,
          traces: 5,
          weekly_reset_first: null,
          weekly_reset_last: null,
          min_weekly_pct: null,
          max_weekly_pct: null,
          short_reset_first: null,
          short_reset_last: null,
          min_short_pct: null,
          max_short_pct: null,
          weekly_reset_special_first: null,
          weekly_reset_special_last: null,
          min_weekly_pct_special: null,
          max_weekly_pct_special: null,
          short_reset_special_first: null,
          short_reset_special_last: null,
          min_short_pct_special: null,
          max_short_pct_special: null,
          tool_calls: null,
          git_commit: null,
          git_push: null,
          litellm_processing_total_ms: null,
          litellm_processing_average_ms: null,
          llm_upstream_elapsed_total_ms: null,
          llm_upstream_elapsed_average_ms: null,
          cache_miss_usd_cost: null,
          cache_attempted_summary: null,
          cache_miss_summary: null,
          cache_miss_reasons: null,
          token_cache_miss: null,
          reasoning_tokens_sources: null,
        },
      ],
    }

    await act(async () => {
      render(
        <Wrapper>
          <PhosphorDashboard
            from='2026-05-18'
            to='2026-05-19'
            report={report}
            reportLoading={false}
            showComparison={false}
            quotas={[]}
            quotaHistory={[]}
          />
        </Wrapper>
      )
    })

    // Navigate to the LEDGER tab so the MasterLedgerTable is visible.
    // The ledger is rendered in the 'LEDGER' section which is visible by default.
    // Locate the rendered Toks In / Toks Out cells for the gemini-flash row.
    // real token_in=700 → numFmt(700) = '700'
    // fallback: Math.round(1000 * 0.6) = 600 → numFmt(600) = '600'
    // The presence of '700' (not '600') guards the 60/40 fallback bug.
    const tokensIn700 = screen.queryAllByText('700')
    const tokensFallback600 = screen.queryAllByText('600')

    // If the alias join works, real token_in=700 appears and fallback 600 does not.
    // If the join fails, we see 600 but not 700.
    // This assertion FAILS on implementations without the alias join fix.
    expect(tokensIn700.length).toBeGreaterThan(0)
    expect(tokensFallback600).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// S1-11: buildTopModels — local-route model with upstream_p95_ms===null but
//         total_p95_ms set must surface total_p95_ms (not '—').
// buildTopModels is NOT yet exported; a _buildTopModelsForTest export must
// be added by the engineer. Until then this is a component-level render test.
// ENGINEER ACTION: export buildTopModels as _buildTopModelsForTest.
// Also: fix buildTopModels to fall back to total_p95_ms when upstream_p95_ms
// is null, mirroring buildProviderMetrics (lines ~2072-2078).
// ---------------------------------------------------------------------------

describe('S1-11 — buildTopModels falls back to total_p95_ms', () => {
  test('test_buildTopModels_falls_back_to_total_p95_ms', () => {
    const statusRows = [
      {
        provider: 'local',
        model: 'local-llama-3.3',
        traces: 20,
        token_total: 5000,
        usd_cost: 0.0,
      },
    ]
    const healthRows: UsageReportProviderLatencyHealthRow[] = [
      {
        bucket_start: '2026-05-18T23:00:00.000Z',
        environment: 'production',
        provider: 'local',
        model: 'local-llama-3.3',
        model_group: 'local',
        requests: 20,
        passive_latency_sample_status: 'ok',
        upstream_p50_ms: null,
        upstream_p95_ms: null,
        upstream_p99_ms: null,
        total_p95_ms: 150,
        proxy_processing_p95_ms: null,
        missing_upstream_latency: 20,
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
      },
    ]

    const top = buildTopModels(statusRows, 'local', healthRows)

    expect(top).toHaveLength(1)
    expect(top[0]?.model).toBe('local-llama-3.3')
    expect(top[0]?.p95_ms).toBe(150)
    expect(top[0]?.p95_ms).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// S1-T1: Prior window query uses computed prior range — when showComparison
//         is true, the prior-window fetch URL must contain from/to equal to
//         the expected prior window (not current window dates).
//
//   current window: from=2026-04-19 to=2026-05-19 (30 days)
//   expected prior: from=2026-03-20 to=2026-04-19 (shifted back 30 days)
//
// Replaces THEATER TCG-3 control which only checked count>=1.
// ---------------------------------------------------------------------------

describe('S1-T1 — prior window query uses computed prior range', () => {
  test('test_prior_window_query_uses_computed_prior_range', async () => {
    let currentCallCount = 0
    let priorCallCount = 0
    const capturedPriorParams: URLSearchParams[] = []

    // Register distinct handlers so we can separate current vs prior calls.
    // Current window: from=2026-04-19 & to=2026-05-19
    // Prior window:   from=2026-03-20 & to=2026-04-19
    server.use(
      http.get('/api/shell/reports/usage', ({ request }) => {
        const url = new URL(request.url)
        const from = url.searchParams.get('from')
        const to = url.searchParams.get('to')
        if (from === '2026-04-19' && to === '2026-05-19') {
          currentCallCount++
          return HttpResponse.json(MOCK_REPORT)
        }
        // Any other from/to is the prior-window call
        priorCallCount++
        capturedPriorParams.push(url.searchParams)
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
            // report NOT supplied → internal current-window query fires
            showComparison={true}
          />
        </Wrapper>
      )
    })

    // Wait for both the current fetch and the prior fetch to fire.
    // The prior query is enabled after the current report resolves.
    await waitFor(
      () => {
        expect(currentCallCount + priorCallCount).toBeGreaterThanOrEqual(2)
      },
      { timeout: 3000 }
    )

    // Assert the prior-window call used the correct computed range.
    // priorTo   = resolvedFrom            = '2026-04-19'
    // priorFrom = resolvedFrom - 30 days  = '2026-03-20'
    expect(priorCallCount).toBeGreaterThanOrEqual(1)
    const priorParams = capturedPriorParams[0]
    expect(priorParams).toBeDefined()
    expect(priorParams!.get('from')).toBe('2026-03-20')
    expect(priorParams!.get('to')).toBe('2026-04-19')
  })
})

// ---------------------------------------------------------------------------
// S1-T6: Populated report render — ledger rows display real token_in/out,
//         guarding against the 60/40 fallback regression for normal providers.
//         Uses anthropic/claude-sonnet-4-5 with clearly distinguishable values.
// ---------------------------------------------------------------------------

describe('S1-T6 — populated report render shows real ledger tokens', () => {
  test('test_populated_report_render_shows_real_ledger_tokens', async () => {
    // Choose token values that differ from the 60/40 split:
    //   token_total=1000 → fallback: token_in=600, token_out=400
    //   real:                         token_in=750, token_out=250
    const report: UsageReportResponse = {
      ...MOCK_REPORT,
      providerStatusUsage: [
        {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          traces: 10,
          token_total: 1000,
          usd_cost: 0.05,
          period_start: '2026-05-18',
          period_end: '2026-05-19',
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
        },
      ],
      rows: [
        {
          bucket: '2026-05-18T00:00:00Z',
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          token_in: 750, // real — NOT 600 (60% of 1000)
          token_out: 250, // real — NOT 400 (40% of 1000)
          token_total: 1000,
          token_cache_input: 0,
          token_cache_creation: 0,
          token_reasoning_reported: 0,
          token_reasoning_estimated: 0,
          usd_cost: 0.05,
          traces: 10,
          weekly_reset_first: null,
          weekly_reset_last: null,
          min_weekly_pct: null,
          max_weekly_pct: null,
          short_reset_first: null,
          short_reset_last: null,
          min_short_pct: null,
          max_short_pct: null,
          weekly_reset_special_first: null,
          weekly_reset_special_last: null,
          min_weekly_pct_special: null,
          max_weekly_pct_special: null,
          short_reset_special_first: null,
          short_reset_special_last: null,
          min_short_pct_special: null,
          max_short_pct_special: null,
          tool_calls: null,
          git_commit: null,
          git_push: null,
          litellm_processing_total_ms: null,
          litellm_processing_average_ms: null,
          llm_upstream_elapsed_total_ms: null,
          llm_upstream_elapsed_average_ms: null,
          cache_miss_usd_cost: null,
          cache_attempted_summary: null,
          cache_miss_summary: null,
          cache_miss_reasons: null,
          token_cache_miss: null,
          reasoning_tokens_sources: null,
        },
      ],
    }

    await act(async () => {
      render(
        <Wrapper>
          <PhosphorDashboard
            from='2026-05-18'
            to='2026-05-19'
            report={report}
            reportLoading={false}
            showComparison={false}
            quotas={[]}
            quotaHistory={[]}
          />
        </Wrapper>
      )
    })

    // Real token_in=750 renders as '750'; fallback would render '600'
    const tokensIn750 = screen.queryAllByText('750')
    const tokensFallback600 = screen.queryAllByText('600')

    // Real token_out=250 renders as '250'; fallback would render '400'
    const tokensOut250 = screen.queryAllByText('250')
    const tokensFallback400 = screen.queryAllByText('400')

    // These assertions fail if the 60/40 fallback is active.
    expect(tokensIn750.length).toBeGreaterThan(0)
    expect(tokensFallback600).toHaveLength(0)
    expect(tokensOut250.length).toBeGreaterThan(0)
    expect(tokensFallback400).toHaveLength(0)
  })
})

describe('PhosphorDashboard — D1-428 STATUS tab split', () => {
  test('test_health_tab_does_not_render_provider_auth_or_alias_routing_panels', async () => {
    const future = new Date(Date.now() + 300_000).toISOString()
    const report: UsageReportResponse = {
      ...MOCK_REPORT,
      providerAliasRouting: {
        data_source: 'recent_observed_session_history',
        freshness_label: 'Recent observed routing',
        generated_at: '2026-05-19T00:00:00.000Z',
        lookback_hours: 24,
        families: [{ family: 'codex', observed: true }],
        entries: [
          {
            family: 'codex',
            alias_label: 'aawm-code',
            provider: 'openai',
            model: 'gpt-5',
            route_family: 'codex_primary',
            state_kind: 'affinity',
            state_source: 'durable_cache',
            observed_at: '2026-05-19T00:00:00.000Z',
            expires_at: future,
            remaining_seconds: 300,
            is_active: true,
            skipped_candidates: [],
          },
        ],
      },
      providerAuthHealth: {
        data_source: 'provider_auth_current',
        freshness_label: 'Current provider credential refresh state',
        generated_at: '2026-05-19T00:00:00.000Z',
        entries: [
          {
            observed_at: '2026-05-19T00:00:00.000Z',
            environment: 'production',
            provider: 'xai',
            auth_family: 'grok_oidc',
            status: 'refreshed',
            attempted: true,
            refreshed: true,
            skipped: false,
            auth_health_state: 'refreshed',
            source_task: 'grok_oidc_refresh',
          },
        ],
      },
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
            quotaHistory={[]}
          />
        </Wrapper>
      )
    })

    expect(screen.getByRole('tab', { name: 'Health' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(
      screen.queryByRole('region', { name: /provider auth health/i })
    ).toBeNull()
    expect(
      screen.queryByRole('region', { name: /aawm alias routing health/i })
    ).toBeNull()
  })
})

describe('PhosphorDashboard — D1-323 alias routing health panel', () => {
  test('test_alias_routing_tab_renders_affinity_and_cooldown_without_secret_sentinel', async () => {
    const future = new Date(Date.now() + 300_000).toISOString()
    const report: UsageReportResponse = {
      ...MOCK_REPORT,
      providerAliasRouting: {
        data_source: 'recent_observed_session_history',
        freshness_label:
          'Recent observed routing from session history (not live Redis/DualCache)',
        generated_at: '2026-05-19T00:00:00.000Z',
        lookback_hours: 24,
        families: [
          { family: 'codex', observed: true },
          { family: 'anthropic', observed: true },
        ],
        entries: [
          {
            family: 'codex',
            alias_label: 'aawm-code',
            provider: 'openai',
            model: 'gpt-5',
            route_family: 'codex_primary',
            state_kind: 'affinity',
            state_source: 'durable_cache',
            observed_at: '2026-05-19T00:00:00.000Z',
            expires_at: future,
            remaining_seconds: 300,
            is_active: true,
            skipped_candidates: [],
          },
          {
            family: 'anthropic',
            alias_label: 'aawm-code-anthropic',
            provider: 'anthropic',
            model: 'claude-opus-4',
            route_family: 'anthropic_primary',
            state_kind: 'cooldown',
            state_source: 'memory',
            observed_at: '2026-05-19T00:05:00.000Z',
            cooldown_until: future,
            remaining_seconds: 240,
            is_active: true,
            selection_reason: 'rate_limited',
            skipped_candidates: [
              {
                provider: 'openrouter',
                model: 'claude',
                reason: 'cooldown',
              },
            ],
          },
        ],
      },
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
            quotaHistory={[]}
          />
        </Wrapper>
      )
    })

    fireEvent.click(screen.getByRole('tab', { name: 'Alias Routing' }))

    expect(
      screen.getByRole('region', { name: /aawm alias routing health/i })
    ).toBeInTheDocument()
    expect(screen.getByText(/not live Redis\/DualCache/i)).toBeInTheDocument()
    expect(screen.getByText(/durable cache/i)).toBeInTheDocument()
    expect(screen.getByText(/process memory/i)).toBeInTheDocument()
    expect(screen.getByText(/Affinity:/i)).toBeInTheDocument()
    expect(screen.getByText(/Cooldown:/i)).toBeInTheDocument()
    expect(
      screen.queryByText(/sk-secret-sentinel-should-not-render/i)
    ).toBeNull()
  })
})

describe('PhosphorDashboard — D1-338 provider auth health panel', () => {
  test('test_provider_auth_tab_renders_grok_oidc_refreshed_failed_and_not_observed_without_secret_sentinel', async () => {
    const future = new Date(Date.now() + 600_000).toISOString()
    const past = new Date(Date.now() - 60_000).toISOString()
    const report: UsageReportResponse = {
      ...MOCK_REPORT,
      providerAuthHealth: {
        data_source: 'provider_auth_current',
        freshness_label:
          'Current provider credential refresh state from provider_auth_current',
        generated_at: '2026-05-19T00:00:00.000Z',
        entries: [
          {
            observed_at: '2026-05-19T00:00:00.000Z',
            environment: 'production',
            provider: 'xai',
            auth_family: 'grok_oidc',
            status: 'refreshed',
            attempted: true,
            refreshed: true,
            skipped: false,
            expires_at: future,
            last_success_at: '2026-05-19T00:00:00.000Z',
            remaining_seconds: 600,
            auth_health_state: 'refreshed',
            source_task: 'grok_oidc_refresh',
            auth_file_hash_short: 'grokoidc1',
          },
          {
            observed_at: '2026-05-19T00:10:00.000Z',
            environment: 'production',
            provider: 'xai',
            auth_family: 'grok_oidc',
            credential_scope: 'secondary',
            status: 'failed',
            attempted: true,
            refreshed: false,
            skipped: false,
            expires_at: past,
            remaining_seconds: -60,
            auth_health_state: 'failed',
            source_task: 'grok_oidc_refresh',
            error_class: 'refresh_error',
            error_message: 'sanitized failure only',
          },
        ],
      },
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
            quotaHistory={[]}
          />
        </Wrapper>
      )
    })

    fireEvent.click(screen.getByRole('tab', { name: 'Provider Auth' }))

    const panel = screen.getByRole('region', { name: /provider auth health/i })
    expect(panel).toBeInTheDocument()
    expect(panel.textContent).toMatch(/grok_oidc/i)
    expect(within(panel).getByText(/refreshed/i)).toBeInTheDocument()
    expect(within(panel).getByText(/failed/i)).toBeInTheDocument()
    expect(within(panel).getByText(/refresh_error/i)).toBeInTheDocument()
    expect(
      screen.queryByText(/sk-secret-sentinel-should-not-render/i)
    ).toBeNull()
    expect(screen.queryByText(/refresh_token/i)).toBeNull()
  })

  test('test_provider_auth_tab_empty_renders_not_observed', async () => {
    const report: UsageReportResponse = {
      ...MOCK_REPORT,
      providerAuthHealth: {
        data_source: 'provider_auth_current',
        freshness_label: 'Current provider credential refresh state',
        generated_at: '2026-05-19T00:00:00.000Z',
        entries: [],
      },
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
            quotaHistory={[]}
          />
        </Wrapper>
      )
    })

    fireEvent.click(screen.getByRole('tab', { name: 'Provider Auth' }))

    const panel = screen.getByRole('region', { name: /provider auth health/i })
    expect(within(panel).getByText('not observed')).toBeInTheDocument()
  })
})

describe('PhosphorDashboard — D1-417 / D1-422 provider credit lifecycle panel', () => {
  test('test_provider_credits_tab_renders_codex_summary_rows_and_status_distinction_without_secrets', async () => {
    const report: UsageReportResponse = {
      ...MOCK_REPORT,
      providerCreditLifecycle: {
        data_source: 'provider_credit_current',
        freshness_label:
          'Current provider credit lifecycle from provider_credit_current',
        generated_at: '2026-05-19T00:00:00.000Z',
        summaries: [
          {
            environment: 'production',
            provider: 'openai',
            credit_family: 'codex_rate_limit_reset',
            label: 'openai codex_rate_limit_reset credits',
            available_count: 2,
            used_count: 1,
            expired_count: 1,
            total_count: 4,
          },
        ],
        entries: [
          {
            observed_at: '2026-05-19T00:00:00.000Z',
            environment: 'production',
            provider: 'openai',
            account_hash_short: '8e928548',
            credit_family: 'codex_rate_limit_reset',
            credit_identity: 'codex-available-1',
            status: 'available',
            available_count: 1,
            granted_at: '2026-05-18T00:00:00.000Z',
            expires_at: '2026-05-20T00:00:00.000Z',
            operator_annotation: 'safe note',
            source_url: 'https://x.com/status/1',
          },
          {
            observed_at: '2026-05-19T00:05:00.000Z',
            environment: 'production',
            provider: 'openai',
            account_hash_short: '8e928548',
            credit_family: 'codex_rate_limit_reset',
            credit_identity: 'codex-used-1',
            status: 'used',
            available_count: 0,
            redeemed_at: '2026-05-18T12:00:00.000Z',
          },
          {
            observed_at: '2026-05-19T00:10:00.000Z',
            environment: 'production',
            provider: 'openai',
            account_hash_short: '8e928548',
            credit_family: 'codex_rate_limit_reset',
            credit_identity: 'codex-expired-1',
            status: 'expired',
            available_count: 0,
            expires_at: '2026-05-17T00:00:00.000Z',
          },
        ],
      },
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
            quotaHistory={[]}
          />
        </Wrapper>
      )
    })

    expect(
      screen.queryByRole('region', { name: /provider credit lifecycle/i })
    ).toBeNull()
    const providerCreditsTab = screen.getByRole('tab', {
      name: /Provider Credits/,
    })
    expect(
      providerCreditsTab.querySelector('.section-tab-indicator.is-green')
    ).not.toBeNull()
    expect(
      providerCreditsTab.querySelector('.section-tab-indicator.is-flashing')
    ).toBeNull()
    fireEvent.click(providerCreditsTab)

    const panel = screen.getByRole('region', {
      name: /provider credit lifecycle/i,
    })
    expect(panel).toBeInTheDocument()
    expect(
      within(panel).getByText(/OpenAI Codex reset credits: 2 available/i)
    ).toBeInTheDocument()
    expect(
      within(panel).getByRole('table', {
        name: /provider credit lifecycle entries/i,
      })
    ).toBeInTheDocument()
    expect(
      within(panel).getByRole('columnheader', { name: /credit/i })
    ).toBeInTheDocument()
    expect(
      within(panel).getByRole('rowheader', { name: 'codex-available-1' })
    ).toBeInTheDocument()
    expect(
      within(panel).getByRole('link', {
        name: /source for openai codex_rate_limit_reset codex-available-1/i,
      })
    ).toBeInTheDocument()
    expect(within(panel).getByText('codex-available-1')).toBeInTheDocument()
    expect(within(panel).getByText('codex-used-1')).toBeInTheDocument()
    expect(within(panel).getByText('codex-expired-1')).toBeInTheDocument()
    expect(within(panel).getByText('used')).toBeInTheDocument()
    expect(within(panel).getByText('expired')).toBeInTheDocument()
    expect(screen.queryByText(/8e928548deadbeef/i)).toBeNull()
    expect(screen.queryByText(/raw_provider_fields/i)).toBeNull()
    expect(
      screen.queryByText(/sk-secret-sentinel-should-not-render/i)
    ).toBeNull()
  })

  test('test_provider_credits_tab_multiple_summaries_aggregate_headline', async () => {
    const report: UsageReportResponse = {
      ...MOCK_REPORT,
      providerCreditLifecycle: {
        data_source: 'provider_credit_current',
        freshness_label: 'Current provider credit lifecycle',
        generated_at: '2026-05-19T00:00:00.000Z',
        summaries: [
          {
            environment: 'production',
            provider: 'openai',
            credit_family: 'codex_rate_limit_reset',
            label: 'openai codex_rate_limit_reset credits',
            available_count: 2,
            used_count: 0,
            expired_count: 0,
            total_count: 2,
          },
          {
            environment: 'staging',
            provider: 'openai',
            credit_family: 'codex_rate_limit_reset',
            label: 'openai codex_rate_limit_reset credits',
            available_count: 1,
            used_count: 0,
            expired_count: 0,
            total_count: 1,
          },
        ],
        entries: [],
      },
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
            quotaHistory={[]}
          />
        </Wrapper>
      )
    })

    fireEvent.click(screen.getByRole('tab', { name: /Provider Credits/ }))

    const panel = screen.getByRole('region', {
      name: /provider credit lifecycle/i,
    })
    expect(
      within(panel).getByText(/OpenAI Codex reset credits: 3 available/i)
    ).toBeInTheDocument()
    expect(
      within(panel).getByText(/production: 2 available/i)
    ).toBeInTheDocument()
    expect(within(panel).getByText(/staging: 1 available/i)).toBeInTheDocument()
    expect(within(panel).getByText('not observed')).toBeInTheDocument()
  })

  test('test_provider_credits_tab_empty_renders_not_observed', async () => {
    const report: UsageReportResponse = {
      ...MOCK_REPORT,
      providerCreditLifecycle: {
        data_source: 'provider_credit_current',
        freshness_label: 'Current provider credit lifecycle',
        generated_at: '2026-05-19T00:00:00.000Z',
        summaries: [],
        entries: [],
      },
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
            quotaHistory={[]}
          />
        </Wrapper>
      )
    })

    const providerCreditsTab = screen.getByRole('tab', {
      name: 'Provider Credits',
    })
    expect(
      providerCreditsTab.querySelector('.section-tab-indicator')
    ).toBeNull()
    fireEvent.click(providerCreditsTab)

    const panel = screen.getByRole('region', {
      name: /provider credit lifecycle/i,
    })
    expect(within(panel).getByText('not observed')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// D1-436: Token trend hover/detail cleanup on visibility + scope changes
// ---------------------------------------------------------------------------

describe('PhosphorDashboard — D1-436: token trend hover/detail cleanup', () => {
  let visibilityState: DocumentVisibilityState = 'visible'

  beforeEach(() => {
    visibilityState = 'visible'
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    })
  })

  test('test_token_trend_day_detail_clears_on_document_hidden', async () => {
    let dayDetailCallCount = 0

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
              provider: 'openai',
              traces: 1,
              token_total: 100,
              usd_cost: 0,
            },
          ],
          tokenTrendVersions: [],
        })
      ),
      http.get('/api/shell/reports/usage/token-trend-day', () => {
        dayDetailCallCount += 1
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

    const dayHoverShell = container.querySelector(
      '.tt-day-hover-shell[data-day="2026-05-20"]'
    ) as HTMLElement
    fireEvent.pointerEnter(dayHoverShell)

    await waitFor(() => {
      expect(dayDetailCallCount).toBe(1)
    })

    await act(async () => {
      visibilityState = 'hidden'
      document.dispatchEvent(new Event('visibilitychange'))
      await new Promise((resolve) => setTimeout(resolve, 200))
    })

    // Hover/detail state is cleared while hidden; no extra day-detail fetch should
    // fire until the user hovers again (cached responses may avoid a second HTTP call).
    expect(dayDetailCallCount).toBe(1)

    fireEvent.pointerEnter(dayHoverShell)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 175))
    })
    expect(dayDetailCallCount).toBeGreaterThanOrEqual(1)
    expect(dayDetailCallCount).toBeLessThanOrEqual(2)
  })

  test('test_token_trend_day_detail_does_not_refetch_on_scope_change_without_hover', async () => {
    let dayDetailCallCount = 0

    server.use(
      http.get('/api/shell/reports/usage/token-trend-summary', () =>
        HttpResponse.json({
          metadata: {
            from: '2026-05-20',
            to: '2026-05-22',
          },
          tokenTrendHours: [
            {
              day: '2026-05-20',
              hour: 8,
              provider: 'openai',
              traces: 1,
              token_total: 100,
              usd_cost: 0,
            },
          ],
          tokenTrendVersions: [],
        })
      ),
      http.get('/api/shell/reports/usage/token-trend-day', () => {
        dayDetailCallCount += 1
        return HttpResponse.json({
          metadata: {
            date: '2026-05-20',
            from: '2026-05-20',
            to: '2026-05-22',
          },
          date: '2026-05-20',
          rows: [],
        })
      })
    )

    let container!: HTMLElement
    let rerender!: (ui: React.ReactElement) => void
    await act(async () => {
      const renderResult = render(
        <Wrapper>
          <PhosphorDashboard
            from='2026-05-20'
            to='2026-05-22'
            report={MOCK_REPORT}
            reportLoading={false}
            showComparison={false}
            quotas={[]}
          />
        </Wrapper>
      )
      container = renderResult.container
      rerender = renderResult.rerender
    })

    await waitFor(() => {
      expect(
        container.querySelector('.tt-day-hover-shell[data-day="2026-05-20"]')
      ).not.toBeNull()
    })

    const dayHoverShell = container.querySelector(
      '.tt-day-hover-shell[data-day="2026-05-20"]'
    ) as HTMLElement
    fireEvent.pointerEnter(dayHoverShell)

    await waitFor(() => {
      expect(dayDetailCallCount).toBe(1)
    })

    await act(async () => {
      rerender(
        <Wrapper>
          <PhosphorDashboard
            from='2026-05-21'
            to='2026-05-22'
            report={MOCK_REPORT}
            reportLoading={false}
            showComparison={false}
            quotas={[]}
            filters={{
              providers: ['openai'],
              repositories: [],
              clients: [],
              environments: [],
              models: [],
            }}
          />
        </Wrapper>
      )
    })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200))
    })

    expect(dayDetailCallCount).toBe(1)
  })
})
