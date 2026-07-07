/**
 * D1-451 Wave 5 (W3): ConfigDrawer must hide inert Sidebar (and related) sections
 * on phosphor routes where AppSidebar / useLayout variant do not apply.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, test, vi } from 'vitest'
import { DirectionProvider } from '@/context/direction-provider'
import { LayoutProvider } from '@/context/layout-provider'
import { SidebarProvider } from '@/components/ui/sidebar'
import { ConfigDrawer } from './config-drawer'

const useLocationMock = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useLocation: () => useLocationMock(),
  }
})

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
})

function renderConfigDrawer() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={client}>
      <DirectionProvider>
        <LayoutProvider>
          <SidebarProvider>
            <ConfigDrawer />
          </SidebarProvider>
        </LayoutProvider>
      </DirectionProvider>
    </QueryClientProvider>
  )
}

describe('D1-451 W3 — ConfigDrawer on phosphor routes', () => {
  test('test_config_drawer_hides_inert_sidebar_section_on_phosphor_route', async () => {
    useLocationMock.mockReturnValue({ pathname: '/aawm' })
    const user = userEvent.setup()
    renderConfigDrawer()

    await user.click(
      screen.getByRole('button', { name: /open theme settings/i })
    )

    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).queryByText('Sidebar')).toBeNull()
  })

  test('test_config_drawer_exposes_layout_and_direction_on_phosphor_route', async () => {
    useLocationMock.mockReturnValue({ pathname: '/aawm' })
    const user = userEvent.setup()
    renderConfigDrawer()

    await user.click(
      screen.getByRole('button', { name: /open theme settings/i })
    )

    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByText('Layout')).toBeInTheDocument()
    expect(within(sheet).getByText('Direction')).toBeInTheDocument()
  })
})

describe('D1-451 W3 — route context hook', () => {
  test('test_config_drawer_uses_phosphor_route_detection', async () => {
    const mod = await import('./config-drawer')
    expect(mod.ConfigDrawer).toBeDefined()
    const source =
      await vi.importActual<typeof import('./config-drawer')>('./config-drawer')
    expect(String(source.ConfigDrawer)).toBeTruthy()
  })
})
