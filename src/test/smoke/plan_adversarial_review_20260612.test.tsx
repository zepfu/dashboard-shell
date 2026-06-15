/**
 * Smoke tests for plan-adversarial-review-20260612.md (Wave 5 + Wave 10).
 *
 * These tests validate that Wave 5/10 features work end-to-end after
 * implementation. They become permanent regression guards.
 *
 * See: .analysis/plan-adversarial-review-20260612.md § Smoke Test Procedure
 *
 * Wave 5 specific smoke assertions:
 *   - Data-layer boundary functions import without error.
 *   - Alert hook produces deterministic output with synthetic data.
 *   - Net-new exports (signedDelta, usageReportQuotasKey) exist.
 *
 * Wave 10 / S6-T8 additions:
 *   - test_dashboard_mounts_with_populated_report: real render with MSW + QueryClient.
 *   - test_no_axios_import_after_w9: axios-free guard (pre-existing, strengthened).
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
import {
  buildDashboardAlertSummary,
  useAlertsFromAnomalies,
} from '../../features/dashboard/hooks/use-alerts-from-anomalies'
import { useAnomalyDetection } from '../../features/dashboard/hooks/use-anomaly-detection'
import { Dashboard } from '../../features/dashboard/index'
import { agentQualityFromFlatRow } from '../../features/dashboard/lib/agent-quality'
import { fmtCompact, numFmt } from '../../features/dashboard/lib/format-utils'
import {
  formatDashboardFreshness,
  formatRecencyValue,
  maxIsoTimestamp,
} from '../../features/dashboard/lib/freshness'
import {
  addDaysToDateString,
  colorWithAlpha,
  computeFleetErrors,
  computeFleetP95,
  formatDashboardDate,
} from '../../features/dashboard/lib/usage-report-display'
import { server } from '../setup'

// ─────────────────────────────────────────────────────────────────────────────
// Import checks: all Wave 5 symbols must be importable
// ─────────────────────────────────────────────────────────────────────────────

test('test_usage_report_display_imports', () => {
  expect(typeof addDaysToDateString).toBe('function')
  expect(typeof colorWithAlpha).toBe('function')
  expect(typeof formatDashboardDate).toBe('function')
  expect(typeof computeFleetErrors).toBe('function')
  expect(typeof computeFleetP95).toBe('function')
})

test('test_format_utils_imports', () => {
  expect(typeof fmtCompact).toBe('function')
  expect(typeof numFmt).toBe('function')
})

test('test_freshness_imports', () => {
  expect(typeof formatRecencyValue).toBe('function')
  expect(typeof maxIsoTimestamp).toBe('function')
  expect(typeof formatDashboardFreshness).toBe('function')
})

test('test_agent_quality_imports', () => {
  expect(typeof agentQualityFromFlatRow).toBe('function')
})

test('test_use_anomaly_detection_imports', () => {
  expect(typeof useAnomalyDetection).toBe('function')
})

test('test_use_alerts_from_anomalies_imports', () => {
  expect(typeof buildDashboardAlertSummary).toBe('function')
  expect(typeof useAlertsFromAnomalies).toBe('function')
})

// ─────────────────────────────────────────────────────────────────────────────
// Net-new export checks: RED until engineer creates them
// ─────────────────────────────────────────────────────────────────────────────

/**
 * signedDelta must be exported from usage-report-display.ts (S4-T6).
 * RED until the engineer creates the export.
 */
test('test_signedDelta_exports_from_usage_report_display', async () => {
  const mod = await import('../../features/dashboard/lib/usage-report-display')
  const fn = (mod as unknown as Record<string, unknown>)['signedDelta']
  expect(typeof fn).toBe('function')
})

/**
 * usageReportQuotasKey must be exported from index.tsx (S4-T5/S4-20).
 * RED until the engineer creates the export.
 */
test('test_usageReportQuotasKey_exports_from_index', async () => {
  const mod = await import('../../features/dashboard/api/usage-report')
  const fn = (mod as unknown as Record<string, unknown>)['usageReportQuotasKey']
  expect(typeof fn).toBe('function')
})

// ─────────────────────────────────────────────────────────────────────────────
// Logic checks with synthetic data
// ─────────────────────────────────────────────────────────────────────────────

describe('buildDashboardAlertSummary smoke (synthetic data)', () => {
  const emptyAnomalies = {
    earlyReset: new Map<string, { prior: string; current: string }>(),
    cacheStale: false,
  }

  test('empty anomalies with no data produces ok severity', () => {
    const result = buildDashboardAlertSummary({
      anomalies: emptyAnomalies,
      now: new Date('2026-06-13T12:00:00Z'),
    })
    expect(result.severity).toBe('ok')
    expect(Array.isArray(result.issues)).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  test('cache stale flag produces warning severity', () => {
    const result = buildDashboardAlertSummary({
      anomalies: { earlyReset: new Map(), cacheStale: true },
      now: new Date('2026-06-13T12:00:00Z'),
    })
    expect(result.severity).toBe('warning')
    expect(result.issues.some((i) => i.severity === 'warning')).toBe(true)
  })
})

describe('formatRecencyValue smoke (synthetic data)', () => {
  test('valid ISO returns formatted string with UTC suffix', () => {
    const result = formatRecencyValue(
      '2026-06-13T10:00:00.000Z',
      new Date('2026-06-13T10:05:00.000Z')
    )
    expect(result).toContain('UTC')
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}/)
  })

  test('null returns double-dash sentinel', () => {
    expect(formatRecencyValue(null, new Date())).toBe('--')
  })
})

describe('addDaysToDateString smoke (boundary guard)', () => {
  test('valid date advances correctly', () => {
    expect(addDaysToDateString('2026-06-13', 7)).toBe('2026-06-20')
    expect(addDaysToDateString('2026-12-28', 5)).toBe('2027-01-02')
  })
})

describe('agentQualityFromFlatRow smoke (synthetic data)', () => {
  test('returns defined summary for valid flat row', () => {
    const summary = agentQualityFromFlatRow({
      traces: 5,
      agent_score_rows: 5,
      agent_quality_score: 1.0,
      agent_quality_evaluated: 5,
      agent_quality_possible: 5,
      agent_quality_failures: 0,
    })
    expect(summary).toBeDefined()
    expect(summary?.quality.evaluated).toBe(5)
    expect(summary?.quality.score).toBe(1.0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Plan-level smoke assertions (Smoke Test Procedure)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * S6-T8: test_dashboard_mounts_with_populated_report
 *
 * Real mounting test for the top-level Dashboard component.
 * Uses MSW + TanStack Router + QueryClient to exercise the full render path.
 *
 * The Dashboard component uses TanStack Router hooks (via PhosphorSidebar →
 * useLocation), so it must be wrapped in a RouterProvider.
 *
 * Guards:
 *   - Dashboard component exports correctly and renders without crashing
 *   - With populated usage report data, at least one KPI tile renders
 *   - The KPI label "Tokens In" appears in the rendered output
 */
test('test_dashboard_mounts_with_populated_report', async () => {
  // Arrange: MSW usage report with non-empty summary (guards the 60/40 fallback)
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
    http.get('/api/shell/reports/quota', () => HttpResponse.json({ rows: [] })),
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

  // Dashboard requires the full provider stack (matching production + index.test.tsx):
  //   QueryClientProvider → DirectionProvider → SearchProvider → LayoutProvider
  //   → SidebarProvider (ConfigDrawer→useSidebar) → RouterProvider
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

  // The component must mount without throwing
  expect(container).toBeTruthy()

  // Wait for the KpiStrip to render (at least one KPI tile must be present)
  await waitFor(
    () => {
      const tiles = container.querySelectorAll('.kpi-tile')
      expect(tiles.length).toBeGreaterThan(0)
    },
    { timeout: 5000 }
  )

  // The Dashboard must include the KPI labels visible in the rendered output
  const text = container.textContent ?? ''
  expect(text).toMatch(/Tokens\s*In/i)
})

test('test_no_axios_import_after_w9', async () => {
  const { readFile } = await import('node:fs/promises')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const mainPath = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../main.tsx'
  )
  const mainSource = await readFile(mainPath, 'utf8')
  expect(mainSource).not.toMatch(/\bfrom ['"]axios['"]/)
  expect(mainSource).not.toMatch(/\bAxiosError\b/)
})

/**
 * test_lazy_tooltip_not_in_dom_until_hover: activate after W11.
 */
test.todo(
  'test_lazy_tooltip_not_in_dom_until_hover — activate after W11 tooltip refactor'
)
