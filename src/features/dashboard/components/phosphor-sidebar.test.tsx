import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, render, screen, within } from '@testing-library/react'
import { PhosphorSidebar } from './phosphor-sidebar'

async function renderSidebar(initialPath = '/') {
  const rootRoute = createRootRoute({ component: PhosphorSidebar })
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
    within(dashboards).getByRole('link', { name: 'AAWM TAP' })
  ).toHaveAttribute('href', '/aawm-tap/overview')
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
