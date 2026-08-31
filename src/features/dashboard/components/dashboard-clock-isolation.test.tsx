import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, vi } from 'vitest'
import { SidebarProvider } from '../../../components/ui/sidebar'
import { DirectionProvider } from '../../../context/direction-provider'
import { LayoutProvider } from '../../../context/layout-provider'
import { SearchProvider } from '../../../context/search-provider'
import { server } from '../../../test/setup'
import type { UsageReportResponse } from '../api/usage-report'
import { DashboardRecencyClock } from './dashboard-recency-clock'
import * as PhosphorDashboardModule from './phosphor-dashboard'
import { PhosphorSidebar } from './phosphor-sidebar'

const FRESHNESS_TIMESTAMP = '2026-05-18T12:00:00.000Z'

const FRESH_REPORT: UsageReportResponse = {
  metadata: {
    from: '2026-05-18',
    to: '2026-05-19',
    grain: 'day',
    groupBy: ['provider', 'model', 'repository'],
    limit: 50_000,
    generatedAt: FRESHNESS_TIMESTAMP,
    latestRecordAt: FRESHNESS_TIMESTAMP,
    latestRecordAgeMinutes: 0,
    latestRecordStale: false,
    staleRecordThresholdMinutes: 60,
  },
  summary: {
    traces: 0,
    token_in: 0,
    token_out: 0,
    token_cache_input: 0,
    token_cache_creation: 0,
    token_reasoning_reported: 0,
    token_reasoning_estimated: 0,
    token_total: 0,
    usd_cost: 0,
    cache_miss_usd_cost: 0,
    tool_calls: 0,
    git_commit: 0,
    git_push: 0,
    period_start: '2026-05-18',
    period_end: '2026-05-19',
    latest_record_at: FRESHNESS_TIMESTAMP,
  },
} as UsageReportResponse

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function makeRouter(component: React.ComponentType) {
  const client = makeClient()
  const rootRoute = createRootRoute({ component })
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { queryClient: client },
  })
  return { client, router }
}

function installDashboardHandlers(): void {
  server.use(
    http.get('/api/shell/health', () =>
      HttpResponse.json({
        ok: true,
        sourceTables: {
          status: 'ok',
          checkedAt: FRESHNESS_TIMESTAMP,
          tables: [
            {
              tableName: 'session_history',
              status: 'ok',
              latestDataAt: FRESHNESS_TIMESTAMP,
              latestEventAt: FRESHNESS_TIMESTAMP,
            },
          ],
        },
      })
    ),
    http.get('/api/shell/reports/usage', () => HttpResponse.json(FRESH_REPORT)),
    http.get('/api/shell/reports/quotas', () =>
      HttpResponse.json({
        metadata: {
          generatedAt: FRESHNESS_TIMESTAMP,
          latestRecordAt: FRESHNESS_TIMESTAMP,
          latestRecordAgeMinutes: 0,
          latestRecordStale: false,
          staleRecordThresholdMinutes: 60,
        },
        quotas: [],
      })
    ),
    http.get('/api/shell/reports/usage/quota-history', () =>
      HttpResponse.json({
        metadata: { generatedAt: FRESHNESS_TIMESTAMP },
        quotaHistory: [],
      })
    ),
    http.get('/api/shell/reports/usage/quota-range-history', ({ request }) => {
      const url = new URL(request.url)
      return HttpResponse.json({
        metadata: {
          from: url.searchParams.get('from') ?? FRESH_REPORT.metadata.from,
          to: url.searchParams.get('to') ?? FRESH_REPORT.metadata.to,
          generatedAt: FRESHNESS_TIMESTAMP,
        },
        quotaRangeHistory: [],
      })
    }),
    http.get('/api/shell/reports/usage/token-trend-summary', ({ request }) => {
      const url = new URL(request.url)
      return HttpResponse.json({
        metadata: {
          from: url.searchParams.get('from') ?? FRESH_REPORT.metadata.from,
          to: url.searchParams.get('to') ?? FRESH_REPORT.metadata.to,
        },
        tokenTrendHours: [],
        tokenTrendVersions: [],
      })
    }),
    http.get('/api/shell/reports/usage/tool-activity', ({ request }) => {
      const url = new URL(request.url)
      return HttpResponse.json({
        metadata: {
          from: url.searchParams.get('from') ?? FRESH_REPORT.metadata.from,
          to: url.searchParams.get('to') ?? FRESH_REPORT.metadata.to,
          generatedAt: FRESHNESS_TIMESTAMP,
        },
        toolActivity: [],
      })
    })
  )
}

test('dashboard recency tick does not rerender PhosphorDashboard', async () => {
  installDashboardHandlers()
  const { Dashboard } = await import('../index')

  const intervalHandlers: Array<() => void> = []
  vi.spyOn(window, 'setInterval').mockImplementation(
    (callback: TimerHandler, timeout?: number) => {
      if (timeout === 10_000) intervalHandlers.push(callback as () => void)
      return 0 as unknown as number
    }
  )
  const { client, router } = makeRouter(Dashboard)
  const dashboardSpy = vi.spyOn(PhosphorDashboardModule, 'default')

  render(
    <QueryClientProvider client={client}>
      <DirectionProvider>
        <SearchProvider>
          <LayoutProvider>
            <SidebarProvider>
              <RouterProvider router={router} />
            </SidebarProvider>
          </LayoutProvider>
        </SearchProvider>
      </DirectionProvider>
    </QueryClientProvider>
  )

  await waitFor(() => {
    expect(screen.getByText(/FETCHED 12:00:00 UTC/)).toBeInTheDocument()
    expect(client.isFetching()).toBe(0)
  })
  expect(intervalHandlers).toHaveLength(2)

  const rendersBeforeClockTick = dashboardSpy.mock.calls.length
  expect(rendersBeforeClockTick).toBeGreaterThan(0)

  act(() => {
    intervalHandlers.forEach((handler) => handler())
  })

  expect(dashboardSpy).toHaveBeenCalledTimes(rendersBeforeClockTick)
})

test('sidebar alert clock does not rerender the parent sidebar', async () => {
  let sidebarRenderCount = 0
  const intervalHandlers: Array<() => void> = []
  vi.spyOn(window, 'setInterval').mockImplementation(
    (callback: TimerHandler, timeout?: number) => {
      if (timeout === 10_000) intervalHandlers.push(callback as () => void)
      return 0 as unknown as number
    }
  )
  server.use(
    http.get('/api/shell/reports/quotas', () =>
      HttpResponse.json({
        metadata: {
          generatedAt: FRESHNESS_TIMESTAMP,
          latestRecordAt: null,
          latestRecordAgeMinutes: null,
          latestRecordStale: false,
          staleRecordThresholdMinutes: 60,
        },
        quotas: [],
      })
    )
  )
  const { client, router } = makeRouter(() => {
    sidebarRenderCount += 1
    return (
      <PhosphorSidebar
        alertInput={{ anomalies: { earlyReset: new Map(), cacheStale: false } }}
      />
    )
  })

  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )

  await screen.findByRole('link', { name: 'Aegis' })
  expect(sidebarRenderCount).toBe(1)
  expect(intervalHandlers).toHaveLength(1)
  expect(
    screen.getAllByRole('status', { name: 'Dashboard alert status: ok' })
  ).toHaveLength(1)

  act(() => {
    intervalHandlers[0]?.()
  })

  expect(sidebarRenderCount).toBe(1)
  expect(screen.getByRole('link', { name: 'Aegis' })).toBeInTheDocument()
})

test('leaf recency clock advances visible freshness text', () => {
  installDashboardHandlers()
  vi.useFakeTimers()
  vi.setSystemTime(Date.parse(FRESHNESS_TIMESTAMP))

  const intervalHandlers: Array<() => void> = []
  vi.spyOn(window, 'setInterval').mockImplementation(
    (callback: TimerHandler, timeout?: number) => {
      if (timeout === 10_000) intervalHandlers.push(callback as () => void)
      return 0 as unknown as number
    }
  )

  render(
    <QueryClientProvider client={makeClient()}>
      <DashboardRecencyClock
        report={FRESH_REPORT}
        reportLatencyHealth={[]}
        quotaRows={[]}
        dataUpdatedAt={Date.parse(FRESHNESS_TIMESTAMP)}
        summaryFetching={false}
        onRefreshReport={() => undefined}
      />
    </QueryClientProvider>
  )

  expect(screen.getByText(/FETCHED 12:00:00 UTC/)).toBeInTheDocument()
  expect(intervalHandlers).toHaveLength(1)

  act(() => {
    vi.setSystemTime(Date.parse(FRESHNESS_TIMESTAMP) + 31_000)
    intervalHandlers[0]?.()
  })

  expect(screen.getByText(/FETCHED 12:00:00 UTC/)).toHaveTextContent(/minute/)
  expect(screen.getByText('Refresh')).toBeInTheDocument()
})
