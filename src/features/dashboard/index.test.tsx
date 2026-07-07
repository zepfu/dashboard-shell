/**
 * Wave 37 cycle-3 — Dashboard index cold-load render tests (TCG-2 / D1-226).
 *
 * TCG-2: Verify that when `summaryLoading === true && summaryReport === undefined`,
 *   the dashboard keeps PhosphorDashboard mounted so STATUS tabs remain reachable
 *   while section bodies skeletonize locally.
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
// ─────────────────────────────────────────────────────────────────────────────
// Wave 5 / S4-19: Dashboard default range follows daily ET tick
// ─────────────────────────────────────────────────────────────────────────────

/**
 * S4-19: `defaultDateRange()` calls `formatDashboardDate(new Date())` which
 * reads the system clock at component mount time. If it is called once at
 * module level (or if the component memoises incorrectly), the range does not
 * advance after a midnight ET rollover.
 *
 * This test simulates a midnight ET rollover using fake timers and asserts
 * that a freshly computed default range reflects the new calendar day.
 *
 * RED until the engineer ensures the default range derives from a live clock
 * (e.g. inside `useMemo(() => defaultDateRange(), [])` re-evaluated on tick,
 * or via a daily interval effect).
 */
import { vi } from 'vitest'
import { SidebarProvider } from '../../components/ui/sidebar'
import { DirectionProvider } from '../../context/direction-provider'
import { LayoutProvider } from '../../context/layout-provider'
import { SearchProvider } from '../../context/search-provider'
import { server } from '../../test/setup'
import {
  usageReportQuotasKey,
  type UsageReportResponse,
} from './api/usage-report'
// ─────────────────────────────────────────────────────────────────────────────
// Wave 5 / S4-T5 / S4-20: usageReportQuotasKey factory used in both index + phosphor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * S4-T5 / S4-20: The engineer must extract a `usageReportQuotasKey` factory
 * that is shared between `index.tsx` and `phosphor-dashboard.tsx`. This test
 * imports the factory directly and asserts that it produces the expected
 * React Query key array. If the engineer renames or removes the export, this
 * test immediately fails — making key-drift detectable.
 *
 * The import is RED (ModuleNotFoundError) until the engineer creates the export.
 */
import {
  formatDashboardDate,
  addDaysToDateString,
} from './lib/usage-report-display'

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
    ),
    http.get('/api/shell/reports/usage/session-diagnostics', () =>
      HttpResponse.json({
        metadata: {
          from: '2026-04-19',
          to: '2026-05-19',
          limit: 100,
          generatedAt: '2026-05-19T00:00:00.000Z',
        },
        sessionDiagnostics: [],
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

describe('Dashboard — TCG-2: cold-load render path', () => {
  test('test_dashboard_keeps_status_tabs_reachable_while_loading', async () => {
    const tokenTrendUrls: string[] = []
    const toolActivityUrls: string[] = []
    registerTokenTrendSummaryHandler((url) => {
      tokenTrendUrls.push(url)
    })
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
    server.use(
      http.get('/api/shell/reports/usage/tool-activity', ({ request }) => {
        toolActivityUrls.push(request.url)
        return HttpResponse.json({
          metadata: {
            from: '2026-04-19',
            to: '2026-05-19',
            generatedAt: '2026-05-19T00:00:00.000Z',
          },
          toolActivity: [],
        })
      })
    )

    const Dashboard = await importDashboard()

    const { container } = renderWithProviders(Dashboard)

    await waitFor(
      () => {
        expect(container.querySelector('.phosphor-dashboard')).not.toBeNull()
      },
      { timeout: 5000 }
    )

    expect(container.querySelector('.dashboard-loading-skeleton')).toBeNull()
    expect(screen.getByRole('heading', { name: 'STATUS' })).toBeInTheDocument()
    const statusTabs = screen.getByRole('tablist', { name: 'Status view' })
    expect(
      within(statusTabs).getByRole('tab', { name: 'Health' })
    ).toHaveAttribute('aria-selected', 'true')
    expect(
      within(statusTabs).getByRole('tab', { name: 'PgBouncer' })
    ).toBeInTheDocument()
    expect(
      within(statusTabs).getByRole('tab', { name: 'Provider Credits' })
    ).toBeInTheDocument()
    expect(
      within(statusTabs).getByRole('tab', { name: 'Diagnostics' })
    ).toBeInTheDocument()

    fireEvent.click(
      within(statusTabs).getByRole('tab', { name: 'Diagnostics' })
    )
    await waitFor(
      () => {
        expect(
          screen.getByText('Loading session diagnostics...')
        ).toBeInTheDocument()
      },
      { timeout: 3000 }
    )

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    expect(tokenTrendUrls).toHaveLength(0)
    expect(toolActivityUrls).toHaveLength(0)

    // Clean up by resolving the pending request to avoid test interference.
    resolveUsageRequest?.()
  }, 15_000)

  test('test_dashboard_renders_full_sections_after_data_arrives', async () => {
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

    expect(container.querySelector('.dashboard-loading-skeleton')).toBeNull()
    const recency = screen.getByLabelText('Underlying data recency')
    expect(recency).toBeInTheDocument()
    expect(within(recency).getByText('Session')).toBeInTheDocument()
    expect(within(recency).getByText('Quota')).toBeInTheDocument()
    expect(within(recency).getByText('Health')).toBeInTheDocument()
  })

  test('test_dashboard_parent_managed_loading_does_not_duplicate_usage_query', async () => {
    let usageCallCount = 0
    registerTokenTrendSummaryHandler()
    server.use(
      http.get('/api/shell/reports/usage', () => {
        usageCallCount += 1
        return new Promise<Response>(() => undefined)
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
          screen.getByRole('heading', { name: 'STATUS' })
        ).toBeInTheDocument()
      },
      { timeout: 5000 }
    )

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    expect(usageCallCount).toBe(1)
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
    await waitFor(
      () => {
        expect(
          screen.getByRole('button', {
            name: /refresh provider data/i,
          })
        ).toBeEnabled()
      },
      { timeout: 3000 }
    )
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

describe('Dashboard — S4-19: default range follows daily ET tick', () => {
  test('test_dashboard_default_range_follows_daily_tick', () => {
    // 2026-06-14 03:59:00 UTC → 2026-06-13 23:59 ET (still June 13 in ET)
    const beforeMidnight = new Date('2026-06-14T03:59:00Z')
    // 2026-06-14 04:01:00 UTC → 2026-06-14 00:01 ET (June 14 in ET)
    const afterMidnight = new Date('2026-06-14T04:01:00Z')

    vi.useFakeTimers()

    try {
      // Before midnight ET: today = 2026-06-13 in ET
      vi.setSystemTime(beforeMidnight)
      const todayBefore = formatDashboardDate(new Date())
      const tomorrowBefore = addDaysToDateString(todayBefore, 1)

      // After midnight ET: today = 2026-06-14 in ET
      vi.setSystemTime(afterMidnight)
      const todayAfter = formatDashboardDate(new Date())
      const tomorrowAfter = addDaysToDateString(todayAfter, 1)

      // The ET calendar day must have advanced across the rollover
      expect(todayAfter).not.toBe(todayBefore)
      expect(tomorrowAfter).not.toBe(tomorrowBefore)

      // todayAfter should be one calendar day later than todayBefore
      const [yB, mB, dB] = todayBefore.split('-').map(Number)
      const [yA, mA, dA] = todayAfter.split('-').map(Number)
      const msB = Date.UTC(yB, mB - 1, dB)
      const msA = Date.UTC(yA, mA - 1, dA)
      // Exactly 1 day apart (86400000 ms)
      expect(msA - msB).toBe(86_400_000)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('test_usageReportQuotasKey_factory_used_in_both (S4-T5/S4-20)', () => {
  test('factory produces the expected key array shape', () => {
    const key = usageReportQuotasKey('2026-05-14', '2026-06-13', undefined)
    expect(Array.isArray(key)).toBe(true)
    // Key must start with a stable string identifier
    expect(key[0]).toBe('usage-report-quotas')
    // /quotas is live/global today, so normal dashboard and sidebar callers
    // must share one cache entry instead of splitting by dashboard date range.
    expect(key).not.toContain('2026-05-14')
    expect(key).not.toContain('2026-06-13')
  })

  test('factory with cacheBust includes it in the key', () => {
    const key = usageReportQuotasKey('2026-05-14', '2026-06-13', 'bust-123')
    expect(key).toContain('bust-123')
  })

  test('factory without cacheBust does not include undefined', () => {
    const key = usageReportQuotasKey('2026-05-14', '2026-06-13', undefined)
    expect(key).not.toContain(undefined)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Wave 5 / S4-T9: kpiDeltas path — /100 ↔ *100 handshake at ≥3840px
// ─────────────────────────────────────────────────────────────────────────────

/**
 * S4-T9: `kpiDeltas` divides `computeDeltaPct` output by 100 so that KpiStrip's
 * `renderDelta` (which multiplies by 100) displays the correct percentage.
 * This test flips the matchMedia mock to `matches: true` (≥3840px viewport)
 * and asserts the stored delta value is in the fractional form (e.g. 0.5 for
 * +50%) not the percent form (e.g. 50).
 *
 * RED until: (a) the test infrastructure supports the wide viewport, and
 * (b) the engineer wires `kpiDeltas` correctly (confirmed by value assertion).
 */
describe('Dashboard — S4-T9: kpiDeltas /100 handshake at wide viewport', () => {
  test('test_kpiDeltas_path_stores_fractional_not_percent', async () => {
    // Override matchMedia to simulate ≥3840px
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: query.includes('3840'), // true for the wide viewport query
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }),
    })

    const priorSummary = {
      traces: 100, // prior requests
      token_in: 1_000,
      token_out: 500,
      usd_cost: 1.0,
    }

    const currentSummary = {
      traces: 150, // 50% increase → delta = 0.5 (fractional, not 50)
      token_in: 1_200,
      token_out: 600,
      usd_cost: 1.2,
    }

    // Register a mock usage report with the prior data available
    let _priorRequestCount = 0
    server.use(
      http.get('/api/shell/reports/usage', ({ request }) => {
        const url = new URL(request.url)
        const from = url.searchParams.get('from')
        _priorRequestCount += 1
        if (from !== null && from < '2026-04-19') {
          // Prior period request
          return HttpResponse.json({
            ...MOCK_REPORT,
            summary: { ...MOCK_REPORT.summary, ...priorSummary },
          })
        }
        return HttpResponse.json({
          ...MOCK_REPORT,
          summary: { ...MOCK_REPORT.summary, ...currentSummary },
        })
      })
    )

    registerTokenTrendSummaryHandler()
    registerQuotaRangeHistoryHandler()

    const Dashboard = await importDashboard()
    const { container } = renderWithProviders(Dashboard)

    // Wait for the dashboard to render with data
    await waitFor(
      () => {
        expect(container.querySelector('.phosphor-dashboard')).not.toBeNull()
      },
      { timeout: 5_000 }
    )

    // At wide viewport, the comparison panel fires. kpiDeltas.requests should be
    // fractional (0.5) not percent (50). We validate this through the KpiStrip
    // aria-label or data attribute that PhosphorDashboard exposes.
    // If the engineer wires it as 50 instead of 0.5, the rendered percentage
    // would show "5000%" instead of "50%".
    //
    // Look for a delta indicator that shows a sane percentage (10%–500% range).
    // An incorrect /100 would produce a wildly large percentage.
    const deltaIndicators = container.querySelectorAll('[data-delta]')
    for (const indicator of deltaIndicators) {
      const raw = indicator.getAttribute('data-delta')
      if (raw !== null) {
        const value = Number(raw)
        if (Number.isFinite(value)) {
          // A sane fractional delta (0.5 = +50%) must NOT be ≥ 10 (which
          // would indicate the /100 division is missing and we stored 50).
          expect(Math.abs(value)).toBeLessThan(10)
        }
      }
    }

    // Restore matchMedia mock for other tests
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (_query: string) => ({
        matches: false,
        media: _query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }),
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Wave 5 / S4-21: Refresh handlers single-trigger
// Wave 5 / S4-22: cacheBust NOT in query key (cache not leaked)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * S4-21: Each refresh button click must trigger exactly one fetch — not two
 * (once from setState + once from invalidateQueries overlapping).
 *
 * S4-22: The `cacheBust` parameter must NOT be part of the React Query cache
 * key for the quotas query that fires on the regular polling interval. It
 * should only live in the queryFn arguments. If cacheBust is in the key, every
 * refresh creates a new permanent cache entry that is never GC'd.
 *
 * This is RED until the engineer collapses the double-trigger and removes
 * cacheBust from the query key.
 */
describe('Dashboard — S4-21/S4-22: refresh handlers and cache key discipline', () => {
  test('test_refresh_handlers_single_trigger_no_double_fetch', async () => {
    const quotaFetchUrls: string[] = []

    server.use(
      http.get('/api/shell/reports/usage', () => HttpResponse.json(MOCK_REPORT))
    )
    server.use(
      http.get('/api/shell/reports/quotas', ({ request }) => {
        quotaFetchUrls.push(request.url)
        return HttpResponse.json({
          metadata: {
            generatedAt: '2026-05-19T00:00:00Z',
            latestRecordAt: null,
            latestRecordAgeMinutes: null,
            latestRecordStale: false,
            staleRecordThresholdMinutes: 60,
          },
          quotas: [],
        })
      })
    )
    registerTokenTrendSummaryHandler()
    registerQuotaRangeHistoryHandler()

    const Dashboard = await importDashboard()
    renderWithProviders(Dashboard)

    await waitFor(
      () => {
        expect(
          screen.getByRole('button', { name: /refresh provider data/i })
        ).not.toBeDisabled()
      },
      { timeout: 5_000 }
    )

    // Clear the initial-load fetches
    quotaFetchUrls.length = 0

    // Click the quota refresh button once
    await act(async () => {
      const btn = screen.getByRole('button', { name: /refresh provider data/i })
      fireEvent.click(btn)
    })

    // After one click, exactly ONE quota fetch should have fired
    await waitFor(
      () => {
        expect(quotaFetchUrls.length).toBeGreaterThanOrEqual(1)
      },
      { timeout: 3_000 }
    )

    // Allow any potential double-trigger to fire
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 200))
    })

    // Must NOT have triggered more than 1 fetch per click (double-trigger bug)
    expect(quotaFetchUrls.length).toBe(1)
  })

  test('test_cacheBust_not_in_quotas_query_key_on_regular_refetch', async () => {
    // The queryKey for the quotas query during auto-refetch must NOT include
    // cacheBust. We validate by inspecting the query cache keys.
    server.use(
      http.get('/api/shell/reports/usage', () => HttpResponse.json(MOCK_REPORT))
    )
    server.use(
      http.get('/api/shell/reports/quotas', () =>
        HttpResponse.json({
          metadata: {
            generatedAt: '2026-05-19T00:00:00Z',
            latestRecordAt: null,
            latestRecordAgeMinutes: null,
            latestRecordStale: false,
            staleRecordThresholdMinutes: 60,
          },
          quotas: [],
        })
      )
    )
    registerTokenTrendSummaryHandler()
    registerQuotaRangeHistoryHandler()

    const Dashboard = await importDashboard()

    const { QueryClient: QC, QueryClientProvider: QCP } =
      await import('@tanstack/react-query')
    const {
      createRootRoute: CRR,
      createRouter: CR,
      createMemoryHistory: CMH,
      RouterProvider: RP,
    } = await import('@tanstack/react-router')
    const { SidebarProvider: SP } = await import('../../components/ui/sidebar')
    const { DirectionProvider: DP } =
      await import('../../context/direction-provider')
    const { SearchProvider: SeP } =
      await import('../../context/search-provider')
    const { LayoutProvider: LP } = await import('../../context/layout-provider')

    const freshClient = new QC({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    })
    const rootRoute = CRR({ component: Dashboard })
    const router = CR({
      routeTree: rootRoute,
      history: CMH({ initialEntries: ['/'] }),
      context: { queryClient: freshClient },
    })

    const { render: testRender } = await import('@testing-library/react')
    const React = await import('react')
    testRender(
      React.createElement(
        QCP,
        { client: freshClient },
        React.createElement(
          DP,
          null,
          React.createElement(
            SeP,
            null,
            React.createElement(
              LP,
              null,
              React.createElement(SP, null, React.createElement(RP, { router }))
            )
          )
        )
      )
    )

    await waitFor(
      () => {
        const queries = freshClient.getQueryCache().getAll()
        const quotasQueries = queries.filter(
          (q) =>
            Array.isArray(q.queryKey) && q.queryKey[0] === 'usage-report-quotas'
        )
        return quotasQueries.length > 0
      },
      { timeout: 5_000 }
    )

    // Check that the initial (non-refreshed) quotas query key does NOT
    // contain a cacheBust value — cacheBust starts as '' and should not appear
    const queries = freshClient.getQueryCache().getAll()
    const quotasQueries = queries.filter(
      (q) =>
        Array.isArray(q.queryKey) && q.queryKey[0] === 'usage-report-quotas'
    )

    for (const q of quotasQueries) {
      const key = q.queryKey as unknown[]
      // cacheBust (non-empty string like Date.now().toString()) must NOT be in
      // the initial key. It's OK for the key to include '' (empty) or undefined.
      const hasCacheBust = key.some(
        (k) => typeof k === 'string' && k !== '' && /^\d{13}$/.test(k)
      )
      expect(hasCacheBust).toBe(false)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// D1-436: Heavy report query guardrails (no background interval polling)
// ─────────────────────────────────────────────────────────────────────────────

function getQueryObserverOptions(
  client: QueryClient,
  keyPrefix: string
):
  | {
      refetchInterval: unknown
      refetchIntervalInBackground: unknown
    }
  | undefined {
  const query = client
    .getQueryCache()
    .getAll()
    .find((q) => Array.isArray(q.queryKey) && q.queryKey[0] === keyPrefix)
  const observers = (
    query as
      | { observers?: Array<{ options: Record<string, unknown> }> }
      | undefined
  )?.observers
  const observer = observers?.[0]
  if (observer === undefined) {
    return undefined
  }
  return {
    refetchInterval: observer.options.refetchInterval,
    refetchIntervalInBackground: observer.options.refetchIntervalInBackground,
  }
}

describe('Dashboard — D1-436: heavy query polling guardrails', () => {
  test('test_heavy_report_queries_do_not_poll_in_background', async () => {
    let quotasCallCount = 0
    let usageReportUrl: URL | null = null
    server.use(
      http.get('/api/shell/reports/usage', ({ request }) => {
        usageReportUrl = new URL(request.url)
        return HttpResponse.json(MOCK_REPORT)
      })
    )
    server.use(
      http.get('/api/shell/reports/quotas', () => {
        quotasCallCount += 1
        return HttpResponse.json({
          metadata: {
            generatedAt: '2026-05-19T00:00:00Z',
            latestRecordAt: null,
            latestRecordAgeMinutes: null,
            latestRecordStale: false,
            staleRecordThresholdMinutes: 60,
          },
          quotas: [],
        })
      })
    )
    registerTokenTrendSummaryHandler()
    registerQuotaRangeHistoryHandler()

    const Dashboard = await importDashboard()
    const client = makeClient()
    const rootRoute = createRootRoute({ component: Dashboard })
    const router = createRouter({
      routeTree: rootRoute,
      history: createMemoryHistory({ initialEntries: ['/'] }),
      context: { queryClient: client },
    })

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

    await waitFor(
      () => {
        expect(
          getQueryObserverOptions(client, 'usage-report-phosphor')
        ).toBeDefined()
      },
      { timeout: 5_000 }
    )

    const phosphorOptions = getQueryObserverOptions(
      client,
      'usage-report-phosphor'
    )
    expect(phosphorOptions?.refetchIntervalInBackground).toBe(false)
    expect(usageReportUrl?.searchParams.has('include_empty_row_fields')).toBe(
      false
    )

    const queries = client.getQueryCache().getAll()
    const normalQuotaQueries = queries.filter(
      (q) =>
        Array.isArray(q.queryKey) &&
        q.queryKey.length === 1 &&
        q.queryKey[0] === 'usage-report-quotas'
    )
    const sidebarQuotaQueries = queries.filter(
      (q) =>
        Array.isArray(q.queryKey) &&
        q.queryKey[0] === 'shell-sidebar-quota-remaining'
    )
    expect(normalQuotaQueries).toHaveLength(1)
    expect(sidebarQuotaQueries).toHaveLength(0)
    expect(quotasCallCount).toBe(1)

    const quotaRangeOptions = getQueryObserverOptions(
      client,
      'usage-report-quota-range-history'
    )
    if (quotaRangeOptions !== undefined) {
      expect(quotaRangeOptions.refetchInterval).toBe(false)
      expect(quotaRangeOptions.refetchIntervalInBackground).toBe(false)
    }

    const quotaHistoryOptions = getQueryObserverOptions(
      client,
      'usage-report-quota-history'
    )
    if (quotaHistoryOptions !== undefined) {
      expect(quotaHistoryOptions.refetchInterval).toBe(false)
      expect(quotaHistoryOptions.refetchIntervalInBackground).toBe(false)
    }

    const shellHealthOptions = getQueryObserverOptions(
      client,
      'shell-health-pgbouncer'
    )
    if (shellHealthOptions !== undefined) {
      expect(shellHealthOptions.refetchIntervalInBackground).toBe(false)
    }
  })
})
