/**
 * D1-451 Wave 5 — SidebarQuotaRemaining (C2, P1, P2 info, E2).
 *
 * - C2/P1: collapsed and expanded empty/error UI aligned with phosphor sidebar treatment.
 * - P2 (info): query key must not fork on cacheBust — dedupe /quotas poll with index.
 * - E2: null quota payload must not present misleading zero-width bars as “data”.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { server } from '@/test/setup'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'
import { SidebarProvider } from '@/components/ui/sidebar'
import {
  usageReportQuotasKey,
  usageReportQuotasQueryOptions,
} from '@/features/dashboard/api/usage-report'
import { SidebarQuotaRemaining } from './sidebar-quota-remaining'

function renderQuotaSidebar(collapsed = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <SidebarProvider defaultOpen={!collapsed}>
        <SidebarQuotaRemaining />
      </SidebarProvider>
    </QueryClientProvider>
  )
}

describe('D1-451 Wave 5 — usageReportQuotasKey dedupe (P1/P2)', () => {
  test('test_passive_quotas_query_key_ignores_cacheBust_for_dedupe', () => {
    // RED until cacheBust is removed from queryKey (fetch-only bust).
    const passive = usageReportQuotasQueryOptions({ from: 'a', to: 'b' })
    const withBust = usageReportQuotasQueryOptions({
      from: 'a',
      to: 'b',
      cacheBust: '1730000000000',
    })

    expect(passive.queryKey).toEqual(withBust.queryKey)
    expect(usageReportQuotasKey('a', 'b', '1730000000000')).toEqual(
      usageReportQuotasKey('a', 'b')
    )
  })
})

describe('D1-451 Wave 5 — SidebarQuotaRemaining UI (C2/E2)', () => {
  test('test_sidebar_quota_null_data_shows_empty_state_not_progress_bars', async () => {
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

    renderQuotaSidebar(false)

    expect(await screen.findByText('Quota')).toBeInTheDocument()
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0)
  })

  test('test_sidebar_quota_collapsed_empty_state_matches_expanded_heading', async () => {
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

    renderQuotaSidebar(true)

    await screen.findByText('Quota')
    expect(screen.getByText('remaining')).toBeInTheDocument()
    // Collapsed empty state should not fall back to icon-only skeleton forever (C2).
    expect(screen.queryByLabelText('Provider quota remaining')).toBeNull()
  })

  test('test_sidebar_quota_error_state_surfaces_muted_notice', async () => {
    server.use(
      http.get('/api/shell/reports/quotas', () => HttpResponse.error())
    )

    renderQuotaSidebar(false)

    await screen.findByText('Quota')
    // RED: component has no dedicated error affordance today.
    expect(
      screen.getByRole('status', { name: /quota unavailable/i })
    ).toBeInTheDocument()
  })

  test('test_buildSidebarQuotaItems_null_via_component_empty_not_bars', async () => {
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
          quotas: null,
        })
      )
    )

    renderQuotaSidebar(false)
    expect(await screen.findByText('Quota')).toBeInTheDocument()
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0)
  })
})
