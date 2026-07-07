/**
 * Dashboard smoke coverage for adversarial-review hardening.
 *
 * This suite validates the production shape of the dashboard mount path and a set
 * of concrete boundary behaviors that have had repeated regressions in review.
 *
 * See: docs/implemented/2026-06-plan-adversarial-review-20260612.md
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, render, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'
import { SidebarProvider } from '../../components/ui/sidebar'
import { DirectionProvider } from '../../context/direction-provider'
import { LayoutProvider } from '../../context/layout-provider'
import { SearchProvider } from '../../context/search-provider'
import { buildDashboardAlertSummary } from '../../features/dashboard/hooks/use-alerts-from-anomalies'
import { Dashboard } from '../../features/dashboard/index'
import { agentQualityFromFlatRow } from '../../features/dashboard/lib/agent-quality'
import { formatRecencyValue } from '../../features/dashboard/lib/freshness'
import { addDaysToDateString } from '../../features/dashboard/lib/usage-report-display'
import { server } from '../setup'

describe('buildDashboardAlertSummary smoke', () => {
  const anomaliesBaseline = {
    earlyReset: new Map<string, { prior: string; current: string }>(),
    cacheStale: false,
  }
  const now = new Date('2026-06-13T12:00:00.000Z')

  test('returns ok when no alert inputs are present', () => {
    const summary = buildDashboardAlertSummary({
      anomalies: anomaliesBaseline,
      now,
    })
    expect(summary.severity).toBe('ok')
    expect(summary.issues).toHaveLength(0)
  })

  test('returns warning when cache staleness and early reset are detected', () => {
    const summary = buildDashboardAlertSummary({
      anomalies: {
        cacheStale: true,
        earlyReset: new Map([
          [
            'anthropic',
            { prior: '2026-06-13T11:00:00Z', current: '2026-06-13T11:55:00Z' },
          ],
        ]),
      },
      now,
    })

    expect(summary.severity).toBe('warning')
    expect(summary.issues).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        head: expect.stringContaining('Report cache may be stale'),
      })
    )
    expect(summary.issues).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        head: expect.stringContaining('Early reset from Anthropic'),
      })
    )
  })
})

describe('formatRecencyValue smoke', () => {
  test('formats a valid ISO timestamp with UTC and relative distance', () => {
    const value = formatRecencyValue(
      '2026-06-13T10:00:00.000Z',
      new Date('2026-06-13T10:05:00.000Z')
    )
    expect(value).toBe('10:00:00 UTC / 5 minutes ago')
  })

  test('returns sentinel for absent or invalid values', () => {
    expect(formatRecencyValue(null, new Date('2026-06-13T12:00:00.000Z'))).toBe(
      '--'
    )
    expect(
      formatRecencyValue('not-an-iso', new Date('2026-06-13T12:00:00.000Z'))
    ).toBe('--')
  })
})

describe('addDaysToDateString smoke', () => {
  test('adds days across normal and month boundaries', () => {
    expect(addDaysToDateString('2026-06-13', 7)).toBe('2026-06-20')
    expect(addDaysToDateString('2026-12-28', 5)).toBe('2027-01-02')
    expect(addDaysToDateString('2026-06-13', -3)).toBe('2026-06-10')
  })

  test('preserves malformed input instead of throwing', () => {
    expect(addDaysToDateString('not-a-date', 3)).toBe('not-a-date')
  })
})

describe('agentQualityFromFlatRow smoke', () => {
  test('computes scoredEvaluated from failures as an honest denominator', () => {
    const summary = agentQualityFromFlatRow({
      traces: 8,
      agent_score_rows: 8,
      agent_quality_score: 0.8,
      agent_quality_evaluated: 5,
      agent_quality_possible: 10,
      agent_quality_failures: 3,
    })
    expect(summary).toBeDefined()
    expect(summary?.quality.score).toBe(0.8)
    expect(summary?.quality.evaluated).toBe(5)
    expect(summary?.quality.scoredEvaluated).toBe(2)
  })

  test('defaults missing fields to safe zeroed values', () => {
    const summary = agentQualityFromFlatRow({ traces: 1 })
    expect(summary).toBeDefined()
    expect(summary?.totalRows).toBe(1)
    expect(summary?.quality.evaluated).toBe(0)
    expect(summary?.quality.scoredEvaluated).toBe(0)
  })
})

test('test_dashboard_mounts_with_populated_report', async () => {
  server.use(
    http.get('/api/shell/reports/usage', () =>
      HttpResponse.json({
        summary: {
          token_in: 1_500_000,
          token_out: 750_000,
          cost_usd: 12.5,
          requests: 300,
          errors: 2,
          p95_ms: 420,
        },
        rows: [
          {
            model: 'claude-sonnet-4',
            provider: 'anthropic',
            tokens_in: 1_500_000,
            tokens_out: 750_000,
            requests: 300,
            p50_ms: 200,
            p95_ms: 420,
            error_pct: 0.007,
            cost_usd: 12.5,
            quota_pct: 0,
          },
        ],
        trend: [],
        version_intervals: [],
        model_first_seen: [],
      })
    ),
    http.get('/api/shell/health', () =>
      HttpResponse.json({
        ok: true,
        pgBouncerSidecars: { status: 'unknown', sidecars: [] },
      })
    ),
    http.get('/api/shell/reports/quotas', () =>
      HttpResponse.json({ rows: [] })
    ),
    http.get('/api/shell/reports/quota', () => HttpResponse.json({ rows: [] })),
    http.get('/api/shell/reports/usage/quota-history', () =>
      HttpResponse.json({ rows: [] })
    ),
    http.get('/api/shell/reports/quota-range-history', () =>
      HttpResponse.json({ rows: [] })
    ),
    http.get('/api/shell/reports/quota-history', () =>
      HttpResponse.json({ rows: [] })
    )
  )

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })

  const rootRoute = createRootRoute({ component: Dashboard })
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  let container!: HTMLElement
  await act(async () => {
    const result = render(
      <QueryClientProvider client={queryClient}>
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
    container = result.container
  })

  await waitFor(() => {
    expect(container.textContent).toContain('Tokens In')
    expect(container.textContent).toContain('Tokens Out')
    expect(container.querySelectorAll('.kpi-tile').length).toBeGreaterThan(0)
  })
})
