import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, render, screen, within } from '@testing-library/react'
import type { DashboardAlertSummary } from '../hooks/use-alerts-from-anomalies'
import { PhosphorSidebar } from './phosphor-sidebar'

async function renderSidebar(
  initialPath = '/',
  dashboardAlerts?: DashboardAlertSummary
) {
  const rootRoute = createRootRoute({
    component: () => <PhosphorSidebar dashboardAlerts={dashboardAlerts} />,
  })
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  })

  await act(async () => {
    render(<RouterProvider router={router} />)
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
  expect(screen.getByText('10 529 errors from Anthropic')).toBeInTheDocument()
})
