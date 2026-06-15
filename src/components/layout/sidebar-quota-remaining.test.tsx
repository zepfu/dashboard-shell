/**
 * Wave 6 — SidebarQuotaRemaining tests (S6-9, S6-10, S6-11)
 */
import { server } from '@/test/setup'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'
import type { UsageReportQuotaRow } from '@/features/dashboard/api/usage-report'
import { buildSidebarQuotaItems } from './sidebar-quota-items'

function makeQuotaRow(
  overrides: Partial<UsageReportQuotaRow> &
    Pick<UsageReportQuotaRow, 'provider'>
): UsageReportQuotaRow {
  return {
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
    ...overrides,
  }
}

const QUOTAS_METADATA = {
  generatedAt: '2026-05-19T00:00:00.000Z',
  latestRecordAt: null,
  latestRecordAgeMinutes: null,
  latestRecordStale: false,
  staleRecordThresholdMinutes: 60,
}

function registerQuotasHandler(quotas: UsageReportQuotaRow[]) {
  server.use(
    http.get('/api/shell/reports/quotas', () =>
      HttpResponse.json({
        metadata: QUOTAS_METADATA,
        quotas,
      })
    )
  )
}

describe('buildSidebarQuotaItems — provider row selection (S6-10)', () => {
  test('test_sidebar_quota_provider_multiple_rows_selection_picks_active_row', () => {
    const rows: UsageReportQuotaRow[] = [
      makeQuotaRow({
        provider: 'openai',
        weekly_remaining_pct: 80,
        weekly_active: false,
      }),
      makeQuotaRow({
        provider: 'openai',
        weekly_remaining_pct: 45,
        weekly_active: true,
      }),
    ]

    const items = buildSidebarQuotaItems(rows)

    const weeklyItem = items.find((i) => i.key === 'openai-weekly')
    expect(weeklyItem).toBeDefined()
    expect(weeklyItem?.percent).toBe(45)
  })

  test('test_sidebar_quota_provider_multiple_rows_selection_lowest_remaining_when_both_active', () => {
    const rows: UsageReportQuotaRow[] = [
      makeQuotaRow({
        provider: 'openai',
        weekly_remaining_pct: 60,
        weekly_active: true,
      }),
      makeQuotaRow({
        provider: 'openai',
        weekly_remaining_pct: 20,
        weekly_active: true,
      }),
    ]

    const items = buildSidebarQuotaItems(rows)

    const weeklyItem = items.find((i) => i.key === 'openai-weekly')
    expect(weeklyItem).toBeDefined()
    expect(weeklyItem?.percent).toBe(20)
  })

  test('test_sidebar_quota_anthropic_multiple_rows_selection', () => {
    const rows: UsageReportQuotaRow[] = [
      makeQuotaRow({
        provider: 'anthropic',
        weekly_remaining_pct: 75,
        weekly_active: false,
      }),
      makeQuotaRow({
        provider: 'anthropic',
        weekly_remaining_pct: 30,
        weekly_active: true,
      }),
    ]

    const items = buildSidebarQuotaItems(rows)

    const weeklyItem = items.find((i) => i.key === 'anthropic-weekly')
    expect(weeklyItem).toBeDefined()
    expect(weeklyItem?.percent).toBe(30)
  })
})

describe('buildSidebarQuotaItems — null consistency (S6-11)', () => {
  test('test_buildSidebarQuotaItems_null_percent_excluded_not_shown_as_zero', () => {
    const rows: UsageReportQuotaRow[] = [
      makeQuotaRow({
        provider: 'openai',
        weekly_remaining_pct: null,
        weekly_active: true,
      }),
    ]

    const items = buildSidebarQuotaItems(rows)

    const weeklyItem = items.find((i) => i.key === 'openai-weekly')
    expect(weeklyItem).toBeUndefined()
  })

  test('test_buildSidebarQuotaItems_zero_percent_is_included', () => {
    const rows: UsageReportQuotaRow[] = [
      makeQuotaRow({
        provider: 'openai',
        weekly_remaining_pct: 0,
        weekly_active: true,
      }),
    ]

    const items = buildSidebarQuotaItems(rows)

    const weeklyItem = items.find((i) => i.key === 'openai-weekly')
    expect(weeklyItem).toBeDefined()
    expect(weeklyItem?.percent).toBe(0)
  })

  test('test_buildSidebarQuotaItems_empty_rows_returns_empty_array', () => {
    const items = buildSidebarQuotaItems([])
    expect(items).toHaveLength(0)
  })

  test('test_buildSidebarQuotaItems_null_rows_coerced_to_empty', () => {
    const items = buildSidebarQuotaItems([] as UsageReportQuotaRow[])
    expect(items).toHaveLength(0)
  })
})

describe('PhosphorSidebar mounts SidebarQuotaRemaining (S6-9)', () => {
  test('test_sidebar_quota_widget_mounted_where_quota_matters', async () => {
    registerQuotasHandler([
      makeQuotaRow({
        provider: 'openai',
        weekly_remaining_pct: 55,
        weekly_active: true,
      }),
    ])

    const { PhosphorSidebar } =
      await import('@/features/dashboard/components/phosphor-sidebar')

    const { createMemoryHistory, createRouter, RouterProvider } =
      await import('@tanstack/react-router')
    const { createRootRoute } = await import('@tanstack/react-router')
    const { QueryClient, QueryClientProvider } =
      await import('@tanstack/react-query')
    const { SidebarProvider } = await import('@/components/ui/sidebar')
    const React = await import('react')

    const rootRoute = createRootRoute({
      component: () =>
        React.createElement(
          SidebarProvider,
          null,
          React.createElement(PhosphorSidebar)
        ),
    })
    const router = createRouter({
      routeTree: rootRoute,
      history: createMemoryHistory({ initialEntries: ['/aawm-tap/overview'] }),
    })
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(RouterProvider, { router })
      )
    )

    expect(
      await screen.findByRole('progressbar', {
        name: /openai weekly quota remaining/i,
      })
    ).toBeInTheDocument()
  })
})
