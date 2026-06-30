import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/setup'
import type { DashboardAlertSummary } from '../hooks/use-alerts-from-anomalies'
import { PhosphorSidebar } from './phosphor-sidebar'

beforeEach(() => {
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
})

async function renderSidebar(
  initialPath = '/',
  dashboardAlerts?: DashboardAlertSummary
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const rootRoute = createRootRoute({
    component: () => <PhosphorSidebar dashboardAlerts={dashboardAlerts} />,
  })
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  })

  await act(async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )
  })
}

test('renders one module entry point per remote dashboard', async () => {
  await renderSidebar()

  const dashboards = screen
    .getByText('Dashboards')
    .closest('.sidebar-section') as HTMLElement

  expect(
    within(dashboards).getByRole('link', { name: 'AAWM' })
  ).toHaveAttribute('href', '/aawm')
  expect(
    within(dashboards).getByRole('link', { name: 'AAWM TAP' })
  ).toHaveAttribute('href', '/aawm-tap/overview')
  expect(
    within(dashboards).getByRole('link', { name: 'AAWM Observe' })
  ).toHaveAttribute('href', '/aawm-observe/overview')
  expect(
    within(dashboards).getByRole('link', { name: 'Aegis' })
  ).toHaveAttribute('href', '/aegis')
  expect(
    within(dashboards).getByRole('link', { name: 'Sluice' })
  ).toHaveAttribute('href', '/sluice/overview')

  expect(
    within(dashboards).queryByRole('link', { name: 'Processes' })
  ).not.toBeInTheDocument()
  expect(
    within(dashboards).queryByRole('link', { name: 'Watchlist' })
  ).not.toBeInTheDocument()
})

test('marks a remote dashboard active by base path', async () => {
  await renderSidebar('/aegis/summary')

  expect(screen.getByRole('link', { name: 'Aegis' })).toHaveClass('active')
})

test('does not confuse AAWM and AAWM TAP active prefixes', async () => {
  await renderSidebar('/aawm-tap/overview')

  expect(screen.getByRole('link', { name: 'AAWM TAP' })).toHaveClass('active')
  expect(screen.getByRole('link', { name: 'AAWM' })).not.toHaveClass('active')
})

test('renders dashboard alert status dot with hover details', async () => {
  await renderSidebar('/', {
    severity: 'error',
    issues: [
      {
        severity: 'error',
        head: '10 529 errors from Anthropic',
        sub: 'Observed in the last 90 minutes',
      },
    ],
  })

  const dashboardLink = screen.getByRole('link', { name: /Dashboard/ })
  expect(dashboardLink).toHaveClass('sidebar-item-dashboard')

  const status = screen.getByRole('status', {
    name: 'Dashboard alert status: error',
  })
  expect(status).toHaveClass('sidebar-alert-dot', 'error')
  fireEvent.pointerEnter(status.parentElement ?? status)
  expect(screen.getByText('10 529 errors from Anthropic')).toBeInTheDocument()
})

// ---------------------------------------------------------------------------
// Wave 8 (S5-36) — a11y: keyboard user can read issues
// ---------------------------------------------------------------------------

/**
 * S5-36 — A keyboard user must be able to discover and read dashboard alert issues.
 *
 * The current implementation shows issues only via a HoverTooltip (pointer-hover).
 * A keyboard user cannot hover — they need either:
 *  (a) A disclosure (details/summary or button+region) that expands on focus/Enter, OR
 *  (b) The issue count embedded in the accessible label of the status dot so
 *      AT announces it without requiring expansion.
 *
 * After fix, one of the following must be true:
 *  - The alert dot's accessible name includes the issue count
 *    (e.g. "Dashboard alert status: error — 1 issue"), OR
 *  - There is a focusable disclosure control inside/adjacent to the sidebar
 *    alert section that reveals issue details when activated.
 *
 * EXPECTED FAIL: current implementation embeds the count nowhere in the
 * accessible name and the tooltip is pointer-only, leaving keyboard users with
 * just "Dashboard alert status: error" and no way to read the issue details.
 */
test('sidebar_keyboard_user_can_read_alert_issue_count', async () => {
  const issueCount = 3
  await renderSidebar('/', {
    severity: 'warn',
    issues: Array.from({ length: issueCount }, (_, i) => ({
      severity: 'warn' as const,
      head: `Issue ${String(i + 1)}`,
      sub: `Detail for issue ${String(i + 1)}`,
    })),
  })

  // Option A: the accessible name of the status element includes the issue count
  const statusEl = screen.getByRole('status')
  const accessibleName =
    statusEl.getAttribute('aria-label') ??
    statusEl.getAttribute('aria-labelledby') ??
    ''

  const nameIncludesCount =
    accessibleName.includes(String(issueCount)) ||
    accessibleName.toLowerCase().includes('issue')

  // Option B: a disclosure button or details/summary exists near the sidebar
  const disclosureBtn = screen.queryByRole('button', {
    name: /issue|alert detail|expand/i,
  })
  const detailsEl = document.querySelector('details')

  // At least one accessibility mechanism must be present:
  // - Label includes count, OR
  // - A disclosure control is present
  // EXPECTED FAIL: neither condition is satisfied in current implementation
  expect(
    nameIncludesCount || disclosureBtn !== null || detailsEl !== null
  ).toBe(true)
})
