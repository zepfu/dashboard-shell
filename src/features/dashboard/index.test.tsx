/**
 * Wave 37 cycle-3 — Dashboard index loading skeleton tests (TCG-2).
 *
 * TCG-2: Verify that when `summaryLoading === true && summaryReport === undefined`,
 *   the dashboard renders `.dashboard-loading-skeleton` instead of the full
 *   layout. When data arrives the skeleton disappears.
 *
 * Strategy:
 *   - Polyfill jsdom gaps: window.matchMedia, window.ResizeObserver.
 *   - Register an MSW handler that hangs forever for the loading-state test;
 *     immediately resolves for the data-arrived test.
 *   - Wrap Dashboard in the full provider chain it needs in production:
 *       QueryClientProvider → SearchProvider → LayoutProvider
 *       → SidebarProvider → DirectionProvider → RouterProvider
 *   - Assert skeleton present when loading; absent when data has arrived.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { SidebarProvider } from '../../components/ui/sidebar'
import { DirectionProvider } from '../../context/direction-provider'
import { LayoutProvider } from '../../context/layout-provider'
import { SearchProvider } from '../../context/search-provider'
import { server } from '../../test/setup'
import type { UsageReportResponse } from './api/usage-report'

// ---------------------------------------------------------------------------
// jsdom polyfills
// ---------------------------------------------------------------------------

// jsdom does not implement window.matchMedia; Dashboard uses it in a useState
// initialiser (`window.matchMedia('(min-width: 3840px)').matches`).
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })

  // ResizeObserver is not in jsdom; used by some Radix/Recharts components.
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {
      /* noop */
    }
    unobserve() {
      /* noop */
    }
    disconnect() {
      /* noop */
    }
  }
})

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
  registerQuotaHistoryHandler()
})

// ---------------------------------------------------------------------------
// Minimal UsageReportResponse fixture
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
// Helpers
// ---------------------------------------------------------------------------

/** Creates a fresh no-retry QueryClient for each test. */
function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  })
}

function registerTokenTrendSummaryHandler(
  onRequest?: (url: string) => void
): void {
  server.use(
    http.get('/api/shell/reports/usage/token-trend-summary', ({ request }) => {
      onRequest?.(request.url)
      return HttpResponse.json({ tokenTrendHours: [], tokenTrendVersions: [] })
    })
  )
}

function registerQuotaRangeHistoryHandler(
  onRequest?: (url: string) => void
): void {
  server.use(
    http.get('/api/shell/reports/usage/quota-range-history', ({ request }) => {
      onRequest?.(request.url)
      return HttpResponse.json({
        metadata: {
          from: '2026-04-19',
          to: '2026-05-19',
          generatedAt: '2026-05-19T00:00:00.000Z',
        },
        quotaRangeHistory: [],
      })
    })
  )
}

function registerQuotaHistoryHandler(onRequest?: (url: string) => void): void {
  server.use(
    http.get('/api/shell/reports/usage/quota-history', ({ request }) => {
      onRequest?.(request.url)
      return HttpResponse.json({
        metadata: {
          generatedAt: '2026-05-19T00:00:00.000Z',
        },
        quotaHistory: [],
      })
    })
  )
}

/**
 * Renders the given Component wrapped in the full production provider chain
 * that the Dashboard route uses at runtime. The router renders Component as
 * the root route's component so it receives the RouterContext.
 *
 * Provider stack (innermost → outermost):
 *   RouterProvider (TanStack Router — Link, useLocation, useNavigate)
 *   └ root route component: Component
 * SidebarProvider (required by ConfigDrawer via useSidebar)
 * LayoutProvider  (required by ConfigDrawer via useLayout)
 * SearchProvider  (required by Search / CommandMenu via useSearch)
 * DirectionProvider (required by ConfigDrawer's DirConfig via useDirection)
 * QueryClientProvider
 */
function renderWithProviders(
  Component: React.ComponentType
): ReturnType<typeof render> {
  const client = makeClient()
  const rootRoute = createRootRoute({ component: Component })
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { queryClient: client },
  })

  return render(
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
}

// Lazy-import Dashboard to allow MSW handlers to be set up first.
async function importDashboard(): Promise<React.ComponentType> {
  return import('./index').then((m) => m.Dashboard)
}

// ---------------------------------------------------------------------------
// TCG-2: Loading skeleton
// ---------------------------------------------------------------------------

describe('Dashboard — TCG-2: loading skeleton render path', () => {
  test('test_dashboard_shows_skeleton_while_loading', async () => {
    registerTokenTrendSummaryHandler()
    // Register a handler that NEVER resolves so the query stays in loading state.
    let resolveUsageRequest: (() => void) | null = null
    server.use(
      http.get('/api/shell/reports/usage', () => {
        return new Promise<Response>((resolve) => {
          resolveUsageRequest = () => {
            resolve(HttpResponse.json(MOCK_REPORT) as unknown as Response)
          }
        })
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

    const Dashboard = await importDashboard()

    const { container } = renderWithProviders(Dashboard)

    // After initial router mount with a pending query, the skeleton should be
    // present. The skeleton element has class "dashboard-loading-skeleton" and
    // aria-busy="true".
    await waitFor(
      () => {
        expect(
          container.querySelector('.dashboard-loading-skeleton')
        ).not.toBeNull()
      },
      { timeout: 5000 }
    )
    const skeleton = container.querySelector('.dashboard-loading-skeleton')
    expect(skeleton).not.toBeNull()
    expect(skeleton?.getAttribute('aria-busy')).toBe('true')

    // The full PhosphorDashboard (class "phosphor-dashboard") should NOT be visible yet.
    const fullDashboard = container.querySelector('.phosphor-dashboard')
    expect(fullDashboard).toBeNull()

    // Clean up by resolving the pending request to avoid test interference.
    resolveUsageRequest?.()
  }, 15_000)

  test('test_dashboard_skeleton_disappears_after_data_arrives', async () => {
    registerTokenTrendSummaryHandler()
    // Immediately resolve the usage query with data.
    server.use(
      http.get('/api/shell/reports/usage', () => HttpResponse.json(MOCK_REPORT))
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

    const Dashboard = await importDashboard()

    const { container } = renderWithProviders(Dashboard)

    // Wait for the query to resolve and the full dashboard to render.
    await waitFor(
      () => {
        expect(container.querySelector('.phosphor-dashboard')).not.toBeNull()
      },
      { timeout: 3000 }
    )

    // Once data arrives, the skeleton should be gone (the ternary branch
    // resolves to PhosphorDashboard instead of the skeleton div).
    expect(container.querySelector('.dashboard-loading-skeleton')).toBeNull()
    const recency = screen.getByLabelText('Underlying data recency')
    expect(recency).toBeInTheDocument()
    expect(within(recency).getByText('Session')).toBeInTheDocument()
    expect(within(recency).getByText('Quota')).toBeInTheDocument()
    expect(within(recency).getByText('Health')).toBeInTheDocument()
  })

  test('test_force_refresh_button_adds_cache_bust_to_usage_request', async () => {
    const usageUrls: string[] = []
    const tokenTrendUrls: string[] = []
    const quotaHistoryUrls: string[] = []
    const quotaRangeUrls: string[] = []
    registerTokenTrendSummaryHandler((url) => {
      tokenTrendUrls.push(url)
    })
    registerQuotaHistoryHandler((url) => {
      quotaHistoryUrls.push(url)
    })
    registerQuotaRangeHistoryHandler((url) => {
      quotaRangeUrls.push(url)
    })
    server.use(
      http.get('/api/shell/reports/usage', ({ request }) => {
        usageUrls.push(request.url)
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

    const Dashboard = await importDashboard()
    renderWithProviders(Dashboard)

    await waitFor(
      () => {
        expect(
          screen.getByLabelText('Force refresh dashboard data')
        ).toBeEnabled()
      },
      { timeout: 3000 }
    )
    await waitFor(
      () => {
        expect(quotaHistoryUrls.length).toBeGreaterThan(0)
      },
      { timeout: 3000 }
    )
    const quotaHistoryRequestsBeforeRefresh = quotaHistoryUrls.length

    fireEvent.click(screen.getByLabelText('Force refresh dashboard data'))

    await waitFor(
      () => {
        expect(
          usageUrls.some((url) => new URL(url).searchParams.has('cache_bust'))
        ).toBe(true)
      },
      { timeout: 3000 }
    )
    await waitFor(
      () => {
        expect(
          tokenTrendUrls.some((url) =>
            new URL(url).searchParams.has('cache_bust')
          )
        ).toBe(true)
      },
      { timeout: 3000 }
    )
    expect(quotaRangeUrls).toHaveLength(0)
    expect(quotaHistoryUrls).toHaveLength(quotaHistoryRequestsBeforeRefresh)
    expect(
      quotaHistoryUrls.some((url) =>
        new URL(url).searchParams.has('cache_bust')
      )
    ).toBe(false)
  })

  test('test_dashboard_shortcut_keys_switch_tabs_and_focus_controls', async () => {
    const quotaHistoryUrls: string[] = []
    const quotaRangeUrls: string[] = []
    const quotaUrls: string[] = []
    registerQuotaHistoryHandler((url) => {
      quotaHistoryUrls.push(url)
    })
    registerQuotaRangeHistoryHandler((url) => {
      quotaRangeUrls.push(url)
    })
    server.use(
      http.get('/api/shell/reports/usage', () => HttpResponse.json(MOCK_REPORT))
    )
    server.use(
      http.get('/api/shell/reports/quotas', ({ request }) => {
        quotaUrls.push(request.url)
        return HttpResponse.json({
          metadata: {
            generatedAt: '2026-05-19T00:00:00.000Z',
            latestRecordAt: null,
            latestRecordAgeMinutes: null,
            latestRecordStale: false,
            staleRecordThresholdMinutes: 60,
          },
          quotas: [],
        })
      })
    )
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
              traces: 4,
              token_total: 100,
              usd_cost: 0,
              tool_calls: 7,
            },
          ],
          tokenTrendVersions: [],
        })
      )
    )

    const Dashboard = await importDashboard()
    const { container } = renderWithProviders(Dashboard)

    await waitFor(
      () => {
        expect(screen.getByRole('heading', { name: 'STATUS' })).toBeVisible()
      },
      { timeout: 3000 }
    )
    await waitFor(
      () => {
        expect(
          screen.getByRole('tablist', { name: 'Trend detail lane' })
        ).toBeInTheDocument()
      },
      { timeout: 3000 }
    )

    const shortcutNav = screen.getByRole('navigation', {
      name: 'Sections (keyboard shortcuts: bracketed letter)',
    })
    expect(
      within(shortcutNav)
        .getAllByRole('link')
        .map((link) => link.textContent)
    ).toEqual([
      '[S]tatus',
      '[H]ealth',
      '[Q]uota',
      '[T]rend',
      '[V]ersion',
      '[R]equest',
      'T[O]ol',
      '[L]edger',
      '[M]odel',
      'R[E]pository',
      '[F]ilter',
      '[D]ate',
    ])

    const statusTabs = screen.getByRole('tablist', { name: 'Status view' })
    fireEvent.keyDown(document, { key: 'q' })
    expect(
      within(statusTabs).getByRole('tab', { name: 'Quota' })
    ).toHaveAttribute('aria-selected', 'true')
    await waitFor(
      () => {
        expect(quotaRangeUrls).toHaveLength(1)
      },
      { timeout: 3000 }
    )
    expect(
      new URL(quotaRangeUrls[0] ?? '').searchParams.has('cache_bust')
    ).toBe(false)

    await waitFor(
      () => {
        expect(
          screen.getByRole('button', { name: /refresh provider data/i })
        ).toBeEnabled()
      },
      { timeout: 3000 }
    )
    fireEvent.click(
      screen.getByRole('button', { name: /refresh provider data/i })
    )
    await waitFor(
      () => {
        expect(
          quotaRangeUrls.some((url) =>
            new URL(url).searchParams.has('cache_bust')
          )
        ).toBe(true)
      },
      { timeout: 3000 }
    )
    await waitFor(
      () => {
        expect(
          quotaUrls.some((url) => new URL(url).searchParams.has('cache_bust'))
        ).toBe(true)
      },
      { timeout: 3000 }
    )

    fireEvent.keyDown(document, { key: 'h' })
    expect(
      within(statusTabs).getByRole('tab', { name: 'Health' })
    ).toHaveAttribute('aria-selected', 'true')
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', {
          name: /refresh provider data/i,
        })
      )
    })
    await waitFor(
      () => {
        expect(
          quotaHistoryUrls.some((url) =>
            new URL(url).searchParams.has('cache_bust')
          )
        ).toBe(true)
      },
      { timeout: 3000 }
    )

    const trendTabs = screen.getByRole('tablist', {
      name: 'Trend detail lane',
    })
    fireEvent.keyDown(document, { key: 'r' })
    expect(
      within(trendTabs).getByRole('tab', { name: 'Request' })
    ).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(document, { key: 'o' })
    expect(
      within(trendTabs).getByRole('tab', { name: 'Tool' })
    ).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(document, { key: 'v' })
    expect(
      within(trendTabs).getByRole('tab', { name: 'Version' })
    ).toHaveAttribute('aria-selected', 'true')

    const ledgerTabs = screen.getByRole('tablist', { name: 'Ledger view' })
    fireEvent.keyDown(document, { key: 'e' })
    expect(
      within(ledgerTabs).getByRole('tab', { name: 'Repository' })
    ).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(document, { key: 'm' })
    expect(
      within(ledgerTabs).getByRole('tab', { name: 'Model' })
    ).toHaveAttribute('aria-selected', 'true')

    const firstFilter = container.querySelector(
      '[data-shortcut-target="first-filter"]'
    )
    const firstDate = container.querySelector(
      '[data-shortcut-target="first-date"]'
    )
    expect(firstFilter).not.toBeNull()
    expect(firstDate).not.toBeNull()

    fireEvent.keyDown(document, { key: 'f' })
    expect(document.activeElement).toBe(firstFilter)

    fireEvent.keyDown(document, { key: 'd' })
    expect(document.activeElement).toBe(firstDate)
  })
})
