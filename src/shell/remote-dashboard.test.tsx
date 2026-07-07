/**
 * Wave 2 — remote-dashboard.tsx render and recovery behaviour (D1-453).
 */
import type { ComponentType } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ProjectModule } from './types'

const mockImportModule = vi.fn<() => Promise<{ default: ProjectModule }>>()

vi.mock('./remote-dashboard-registry', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./remote-dashboard-registry')>()

  const config = {
    ...actual.remoteDashboardConfigByKey['aawm-tap'],
    importModule: () => mockImportModule(),
  }

  return {
    ...actual,
    remoteDashboardConfigByKey: {
      ...actual.remoteDashboardConfigByKey,
      'aawm-tap': config,
    },
    remoteDashboardConfigs: actual.remoteDashboardConfigs.map((entry) =>
      entry.key === 'aawm-tap'
        ? { ...entry, importModule: () => mockImportModule() }
        : entry
    ),
  }
})

vi.mock('@/features/dashboard/components/phosphor-layout', () => ({
  PhosphorLayout: ({
    main,
    header,
  }: {
    main: React.ReactNode
    header?: React.ReactNode
  }) => (
    <div data-testid='phosphor-layout'>
      {header}
      {main}
    </div>
  ),
}))

vi.mock('@/features/dashboard/components/phosphor-sidebar', () => ({
  PhosphorSidebar: () => <nav data-testid='phosphor-sidebar' />,
}))

vi.mock('@/components/layout/header', () => ({
  Header: ({ children }: { children?: React.ReactNode }) => (
    <header data-testid='remote-header'>{children}</header>
  ),
}))

vi.mock('@/components/layout/top-nav', () => ({
  TopNav: () => <nav data-testid='top-nav' />,
}))

vi.mock('@/components/search', () => ({
  Search: () => <div data-testid='search' />,
}))

vi.mock('@/components/config-drawer', () => ({
  ConfigDrawer: () => <div data-testid='config-drawer' />,
}))

vi.mock('@/components/profile-dropdown', () => ({
  ProfileDropdown: () => <div data-testid='profile-dropdown' />,
}))

describe('remote dashboard wired recovery (Wave 2)', () => {
  beforeEach(() => {
    mockImportModule.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('test_remote_import_reject_then_recover', async () => {
    const { LayoutDashboard } = await import('lucide-react')
    const { remoteDashboardConfigByKey } =
      await import('./remote-dashboard-registry')
    const validModule: ProjectModule = {
      id: 'aawm-tap-dashboard',
      name: 'AAWM TAP',
      description: 'Retrieval and process control',
      icon: LayoutDashboard,
      basePath: '/aawm-tap',
      routes: [
        {
          path: '/overview',
          component: function OverviewPage() {
            return <div data-testid='remote-overview'>Overview content</div>
          },
        },
      ],
      navItems: remoteDashboardConfigByKey['aawm-tap'].navItems,
    }

    let attempts = 0
    mockImportModule.mockImplementation(async () => {
      attempts += 1
      if (attempts === 1) {
        throw new Error('Failed to fetch remoteEntry.js')
      }
      return { default: validModule }
    })

    vi.resetModules()
    const { RemoteDashboardRoute } = await import('./remote-dashboard')

    render(<RemoteDashboardRoute moduleKey='aawm-tap' routePath='/overview' />)

    await waitFor(() => {
      expect(
        screen.getByText('Dashboard module failed to load')
      ).toBeInTheDocument()
    })

    const retryButton = screen.queryByRole('button', { name: /retry/i })
    expect(retryButton).toBeInTheDocument()

    await userEvent.click(retryButton!)

    await waitFor(() => {
      expect(screen.getByTestId('remote-overview')).toBeInTheDocument()
    })

    expect(attempts).toBeGreaterThanOrEqual(2)
  })

  test('test_boundary_resets_on_route_change', async () => {
    const { LayoutDashboard } = await import('lucide-react')
    const { remoteDashboardConfigByKey } =
      await import('./remote-dashboard-registry')
    const ThrowOnOverview: ComponentType<Record<string, unknown>> = () => {
      throw new Error('Render failed on overview')
    }
    const validModule: ProjectModule = {
      id: 'aawm-tap-dashboard',
      name: 'AAWM TAP',
      description: 'Retrieval and process control',
      icon: LayoutDashboard,
      basePath: '/aawm-tap',
      routes: [
        { path: '/overview', component: ThrowOnOverview },
        {
          path: '/processes',
          component: function ProcessesPage() {
            return <div data-testid='remote-processes'>Processes content</div>
          },
        },
      ],
      navItems: remoteDashboardConfigByKey['aawm-tap'].navItems,
    }

    mockImportModule.mockResolvedValue({ default: validModule })

    vi.resetModules()
    const { RemoteDashboardRoute } = await import('./remote-dashboard')

    const { rerender } = render(
      <RemoteDashboardRoute moduleKey='aawm-tap' routePath='/overview' />
    )

    await waitFor(() => {
      expect(
        screen.getByText('Dashboard module failed to load')
      ).toBeInTheDocument()
    })

    rerender(
      <RemoteDashboardRoute moduleKey='aawm-tap' routePath='/processes' />
    )

    await waitFor(() => {
      expect(screen.getByTestId('remote-processes')).toBeInTheDocument()
    })

    expect(
      screen.queryByText('Dashboard module failed to load')
    ).not.toBeInTheDocument()
  })

  test('test_contract_violation_copy_for_malformed_default_export', async () => {
    mockImportModule.mockResolvedValue({
      default: {
        id: 'bad',
        name: 'Bad',
        description: 'Missing routes',
        icon: () => null,
        basePath: '/aawm-tap',
      } as unknown as ProjectModule,
    })

    vi.resetModules()
    const { RemoteDashboardRoute } = await import('./remote-dashboard')

    render(<RemoteDashboardRoute moduleKey='aawm-tap' routePath='/overview' />)

    await waitFor(() => {
      expect(
        screen.getByText('Dashboard module contract violation')
      ).toBeInTheDocument()
    })

    expect(
      screen.getByText(
        /default export does not match the shell ProjectModule contract/i
      )
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Dashboard module failed to load')
    ).not.toBeInTheDocument()
  })
})

describe('retryable import cache (runtime utility)', () => {
  test('test_remote_load_failure_retryable_first_rejects_second_succeeds', async () => {
    const { createRetryableImporter } =
      await import('./remote-dashboard-runtime')

    const fakeModule = {
      default: {
        id: 'test',
        name: 'Test',
        description: '',
        icon: () => null,
        basePath: '/test',
        routes: [],
        navItems: [],
      },
    }
    let callCount = 0
    const importFn = vi.fn(async () => {
      callCount++
      if (callCount === 1) throw new Error('Network error')
      return fakeModule
    })

    const retryableImport = createRetryableImporter(importFn)

    await expect(retryableImport()).rejects.toThrow('Network error')

    const result = await retryableImport()
    expect(result).toBe(fakeModule)
    expect(callCount).toBe(2)
  })
})
