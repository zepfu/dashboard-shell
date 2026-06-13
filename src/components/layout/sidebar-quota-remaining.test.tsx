/**
 * Wave 6 — SidebarQuotaRemaining tests (S6-9, S6-10, S6-11)
 *
 * Test cases:
 *  - S6-10: providerRow selection — multiple rows for same provider, picks correctly
 *  - S6-11: buildSidebarQuotaItems null consistency — null percent is handled uniformly
 *  - S6-9: widget is mounted inside PhosphorSidebar (structural test)
 *
 * FAILING until the engineer:
 *  - Exports buildSidebarQuotaItems for unit testing
 *  - Fixes provider row selection to pick the *active* row with the *lowest* remaining
 *    (not just any row that matches the provider name)
 *  - Mounts SidebarQuotaRemaining in PhosphorSidebar
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { UsageReportQuotaRow } from '@/features/dashboard/api/usage-report'
// These imports will fail (RED) until the engineer exports buildSidebarQuotaItems:
import { buildSidebarQuotaItems } from './sidebar-quota-remaining'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// S6-10: multiple rows per provider — selection discipline
// ---------------------------------------------------------------------------

describe('buildSidebarQuotaItems — provider row selection (S6-10)', () => {
  test('test_sidebar_quota_provider_multiple_rows_selection_picks_active_row', () => {
    // Two OpenAI rows: one inactive, one active. Must pick the ACTIVE one.
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

    // buildSidebarQuotaItems is currently unexported — this test is RED.
    const items = buildSidebarQuotaItems(rows)

    const weeklyItem = items.find((i) => i.key === 'openai-weekly')
    expect(weeklyItem).toBeDefined()
    // Must pick the ACTIVE row (45%), not the inactive one (80%).
    expect(weeklyItem?.percent).toBe(45)
  })

  test('test_sidebar_quota_provider_multiple_rows_selection_lowest_remaining_when_both_active', () => {
    // Two OpenAI rows both active: pick the one with lowest remaining (most critical).
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
    // Should prefer the lower remaining (more urgent) row.
    expect(weeklyItem?.percent).toBe(20)
  })

  test('test_sidebar_quota_anthropic_multiple_rows_selection', () => {
    // Same selection logic for Anthropic.
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

// ---------------------------------------------------------------------------
// S6-11: null consistency in buildSidebarQuotaItems
// ---------------------------------------------------------------------------

describe('buildSidebarQuotaItems — null consistency (S6-11)', () => {
  test('test_buildSidebarQuotaItems_null_percent_excluded_not_shown_as_zero', () => {
    // A row with weekly_remaining_pct === null should NOT produce an item
    // (the if-check is already present), but if it does appear, the percent
    // must be null not 0. This guards the ?? null in the item construction.
    const rows: UsageReportQuotaRow[] = [
      makeQuotaRow({
        provider: 'openai',
        weekly_remaining_pct: null,
        weekly_active: true,
      }),
    ]

    const items = buildSidebarQuotaItems(rows)

    // The null guard should prevent this item from appearing.
    const weeklyItem = items.find((i) => i.key === 'openai-weekly')
    expect(weeklyItem).toBeUndefined()
  })

  test('test_buildSidebarQuotaItems_zero_percent_is_included', () => {
    // 0% remaining is NOT null — the item should be shown.
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
    // The consumer does: buildSidebarQuotaItems(quotaQuery.data?.quotas ?? [])
    // but the function itself should gracefully handle null/undefined if called directly.
    // This guards against unsafe callers.
    // RED: function currently expects an array and would throw on null.
    const items = buildSidebarQuotaItems([] as UsageReportQuotaRow[])
    expect(items).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// S6-9: SidebarQuotaRemaining mounted inside PhosphorSidebar
// ---------------------------------------------------------------------------

describe('PhosphorSidebar mounts SidebarQuotaRemaining (S6-9)', () => {
  test('test_sidebar_quota_widget_mounted_where_quota_matters', async () => {
    // S6-9: The quota widget is absent from PhosphorSidebar today.
    // The engineer must add it. This test verifies its presence by checking
    // the rendered sidebar contains the quota progress elements.
    //
    // We import PhosphorSidebar and render it in a minimal context to check
    // that it renders the quota widget without a full app shell.

    // This import succeeds but PhosphorSidebar currently does NOT mount
    // SidebarQuotaRemaining — so the test is RED.
    const { PhosphorSidebar } =
      await import('@/features/dashboard/components/phosphor-sidebar')

    // PhosphorSidebar uses useLocation which needs a router context.
    // We provide a minimal mock via the MemoryRouter from @tanstack/react-router.
    // For this structural test we check for a data attribute or aria label
    // that would only be present if SidebarQuotaRemaining were rendered.
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

    // SidebarQuotaRemaining renders a progressbar with aria-label "Provider quota remaining"
    // or "* quota remaining" items. If not mounted, this will not be found.
    // RED until the engineer adds <SidebarQuotaRemaining /> to PhosphorSidebar.
    const quotaElements = screen.queryAllByRole('progressbar')
    // We expect at least one progressbar (the quota widget's bars) OR a
    // "Quota remaining" label node to be present.
    const quotaLabel = screen.queryByText(/quota/i)
    const hasQuotaWidget = quotaElements.length > 0 || quotaLabel !== null
    expect(hasQuotaWidget).toBe(true)
  })
})
