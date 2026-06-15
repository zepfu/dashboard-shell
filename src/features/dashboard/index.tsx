/**
 * Dashboard route entry point — Phosphor Atlas shell.
 *
 * Wave 9: v9.7 reference parity updates:
 * - Page-header: Playfair Display italic page title, freshness indicator,
 *   attribution legend.
 * - DateControls promoted to live state (operator decision 4).
 * - Controls bar styled per reference (control-input).
 * - Alerts wired via useAlertsFromAnomalies hook (operator decision 3).
 * - Body topographic overlay added in theme.css (operator decision 8).
 *
 * Wave 11 PR7-lite:
 * - Attribution legend rewritten per audit C22 (ATTRIBUTION label + 5 pill swatches).
 * - Freshness indicator now computes from dataUpdatedAt (audit C24).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { ConfigDrawer } from '@/components/config-drawer'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import {
  fetchShellHealth,
  fetchUsageReport,
  fetchUsageReportQuotaHistory,
  fetchUsageReportQuotaRangeHistory,
  usageReportQuotasKey,
  usageReportQuotasQueryOptions,
  type UsageReportGrain,
  type UsageReportProviderLatencyHealthRow,
  type UsageReportQuotaRow,
  type UsageReportSummary,
} from './api/usage-report'
import AnchorBar from './components/anchor-bar'
import { computeDeltaPct } from './components/comparison-panel'
import { DateControls } from './components/date-controls'
import { KpiStrip } from './components/kpi-strip'
import type { LedgerView } from './components/master-ledger-table'
import PhosphorDashboard, {
  type ProviderSectionView,
} from './components/phosphor-dashboard'
import { PhosphorLayout } from './components/phosphor-layout'
import { PhosphorSidebar } from './components/phosphor-sidebar'
import {
  SlicerBar,
  type SlicerFilters,
  type SlicerOptions,
  SLICER_EMPTY_FILTERS,
} from './components/slicer-bar'
import type { LowerLaneMode } from './components/token-trend-chart'
import { useDashboardAlertSummary } from './hooks/use-alerts-from-anomalies'
import { useAnomalyDetection } from './hooks/use-anomaly-detection'
import {
  formatDashboardFreshness,
  formatRecencyValue,
  maxIsoTimestamp,
  selectSessionFreshnessTimestamp,
} from './lib/freshness'
import {
  addDaysToDateString,
  computeFleetErrors,
  computeFleetP95,
  formatDashboardDate,
} from './lib/usage-report-display'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultDateRange(): { from: string; to: string } {
  const today = formatDashboardDate(new Date())
  return {
    from: addDaysToDateString(today, -30),
    // Server uses exclusive upper bound `< $2::date`; add 1 Eastern calendar
    // day so today's data is included.
    to: addDaysToDateString(today, 1),
  }
}

const LIVE_DASHBOARD_REFETCH_INTERVAL_MS = 60_000

interface RecencyBreakoutItem {
  label: string
  value: string
}

function latestQuotaObservationAt(rows: UsageReportQuotaRow[]): string | null {
  return maxIsoTimestamp(
    rows.flatMap((row) => [
      row.weekly_interval_start,
      row.short_interval_start,
      row.special_interval_start,
      row.short_special_interval_start,
      row.monthly_interval_start,
    ])
  )
}

function latestHealthBucketAt(
  rows: UsageReportProviderLatencyHealthRow[]
): string | null {
  return maxIsoTimestamp(rows.map((row) => row.bucket_start))
}

function scrollDashboardTargetIntoView(targetId: string): void {
  if (typeof document === 'undefined') return
  const el = document.getElementById(targetId)
  el?.scrollIntoView?.({ behavior: 'smooth' })
}

function focusDashboardShortcutTarget(selector: string): void {
  if (typeof document === 'undefined') return
  const el = document.querySelector<HTMLElement>(selector)
  el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  el?.focus()
}

// ---------------------------------------------------------------------------
// KpiStrip summary adapter
// ---------------------------------------------------------------------------

interface KpiSummaryShape {
  token_in: number
  token_out: number
  cost_usd: number
  requests: number
  errors: number
  p95_ms: number
}

/**
 * Adapts the API summary + health rows into the KpiStrip shape.
 *
 * 15-C.1: errors now derived from computeFleetErrors instead of hardcoded 0.
 */
function toKpiSummary(
  summary:
    | { token_in: number; token_out: number; usd_cost: number; traces: number }
    | undefined,
  fleetP95Ms: number,
  fleetErrors: number
): KpiSummaryShape | undefined {
  if (summary === undefined) return undefined
  return {
    token_in: summary.token_in,
    token_out: summary.token_out,
    cost_usd: summary.usd_cost,
    requests: summary.traces,
    errors: fleetErrors,
    p95_ms: fleetP95Ms,
  }
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/**
 * Dashboard is the root component for the /usage route.
 *
 * Wave 9: Wires full page-header, controls, sidebar restyle,
 * and alerts hook into PhosphorLayout.
 */
export function Dashboard(): ReactElement {
  const queryClient = useQueryClient()
  const [activeSection, setActiveSection] = useState('status')
  const [providerSectionView, setProviderSectionView] =
    useState<ProviderSectionView>('health')
  const [trendLowerLaneMode, setTrendLowerLaneMode] =
    useState<LowerLaneMode>('tui')
  const [ledgerView, setLedgerView] = useState<LedgerView>('model')

  const [from, setFrom] = useState(() => defaultDateRange().from)
  const [to, setTo] = useState(() => defaultDateRange().to)
  // Wave 16-V: grain hardcoded to 'day'; per-visual grain logic in PhosphorDashboard untouched
  const grain: UsageReportGrain = 'day'
  // 15-C.4: controlled search input state for client-side row filtering
  const [searchTerm, setSearchTerm] = useState<string>('')

  // 15-D.5: slicer filter state — empty arrays mean "all" (no server-side filter)
  const [slicerFilters, setSlicerFilters] =
    useState<SlicerFilters>(SLICER_EMPTY_FILTERS)
  const [reportCacheBust, setReportCacheBust] = useState<string | undefined>(
    undefined
  )
  const [quotaCacheBust, setQuotaCacheBust] = useState<string | undefined>(
    undefined
  )
  const [quotaRangeHistoryCacheBust, setQuotaRangeHistoryCacheBust] = useState<
    string | undefined
  >(undefined)
  const [quotaHistoryCacheBust, setQuotaHistoryCacheBust] = useState<
    string | undefined
  >(undefined)
  const [recencyNow, setRecencyNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => {
      setRecencyNow(new Date())
    }, 10_000)
    return () => {
      clearInterval(id)
    }
  }, [])

  useEffect(() => {
    const syncRangeToEasternDay = (): void => {
      const { from: nextFrom, to: nextTo } = defaultDateRange()
      setFrom((prev) => (prev === nextFrom ? prev : nextFrom))
      setTo((prev) => (prev === nextTo ? prev : nextTo))
    }
    syncRangeToEasternDay()
    const id = setInterval(syncRangeToEasternDay, 60_000)
    return () => {
      clearInterval(id)
    }
  }, [])

  // 15-D.3: slicer options derived from PhosphorDashboard's loaded data
  const [slicerOptions, setSlicerOptions] = useState<SlicerOptions>({
    providers: [],
    repositories: [],
    clients: [],
    environments: [],
    models: [],
  })

  const handleSlicerOptionsReady = useCallback(
    (options: SlicerOptions): void => {
      setSlicerOptions(options)
    },
    []
  )

  const handleRangeChange = (nextFrom: string, nextTo: string): void => {
    setFrom(nextFrom)
    setTo(nextTo)
  }

  // Wave 36 Fix 1: queryKey now matches PhosphorDashboard's key shape exactly
  // (includes filter arrays) so React Query deduplicates both subscribers into a
  // single cache entry and fires only ONE HTTP request per page load.
  const {
    data: summaryReport,
    isLoading: summaryLoading,
    isFetching: summaryFetching,
    refetch: refetchSummaryReport,
    dataUpdatedAt,
  } = useQuery({
    queryKey: [
      'usage-report-phosphor',
      from,
      to,
      grain,
      slicerFilters.providers,
      slicerFilters.repositories,
      slicerFilters.clients,
      slicerFilters.environments,
      slicerFilters.models,
      reportCacheBust,
    ],
    queryFn: () =>
      fetchUsageReport({
        from,
        to,
        grain,
        groupBy: ['provider', 'model', 'repository'],
        provider: slicerFilters.providers,
        repository: slicerFilters.repositories,
        client: slicerFilters.clients,
        environment: slicerFilters.environments,
        model: slicerFilters.models,
        cacheBust: reportCacheBust,
      }),
    // Keep React Query freshness aligned with the report-service default TTL.
    // The dashboard polls every minute, so new session rows should be eligible
    // for display on the next scheduled refresh.
    staleTime: LIVE_DASHBOARD_REFETCH_INTERVAL_MS,
    refetchInterval: LIVE_DASHBOARD_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
  })

  const { data: shellHealthData } = useQuery({
    queryKey: ['shell-health-pgbouncer'],
    queryFn: ({ signal }) => fetchShellHealth(signal),
    staleTime: 15_000,
    refetchInterval: LIVE_DASHBOARD_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
  })

  const sessionFreshnessAt = useMemo(
    () => selectSessionFreshnessTimestamp(shellHealthData, summaryReport),
    [shellHealthData, summaryReport]
  )

  // Wave 36 Fix 4: showComparison gates the priorReport query in PhosphorDashboard
  // so the prior-window API call is only made when the ComparisonPanel is visible
  // (viewport ≥3840px). Initialised synchronously to avoid a false-trigger flash.
  const [showComparison, setShowComparison] = useState(() =>
    typeof window === 'undefined'
      ? false
      : window.matchMedia('(min-width: 3840px)').matches
  )
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(min-width: 3840px)')
    const onChange = (e: MediaQueryListEvent): void => {
      setShowComparison(e.matches)
    }
    mq.addEventListener('change', onChange)
    return () => {
      mq.removeEventListener('change', onChange)
    }
  }, [])

  // 14-B.2: freshness format per mockup line 2384:
  //   "FETCHED HH:MM:SS UTC · Xs ago"
  // Re-evaluate every 10 s so relative time stays current.
  //
  // D1-219: prefer /api/shell/health source-table freshness for Session
  // recency so a slow or stale usage-report cache cannot make the dashboard
  // claim session_history is hours behind while the source table is current.
  // Fall back to usage metadata, then dataUpdatedAt when health is unavailable.
  const [freshnessStr, setFreshnessStr] = useState<string>('Loading…')
  useEffect(() => {
    const compute = (): void => {
      setFreshnessStr(
        formatDashboardFreshness(sessionFreshnessAt, dataUpdatedAt, new Date())
      )
    }
    compute()
    const id = setInterval(compute, 10_000)
    return () => {
      clearInterval(id)
    }
  }, [dataUpdatedAt, sessionFreshnessAt])

  // B3 fix: Compute fleet-wide P95 from all provider latency health rows
  // using a requests-weighted average (replaces the former Math.max that was
  // skewed by low-sample anthropic/claude-opus-4-7 buckets).
  const fleetP95Ms = useMemo(
    () => computeFleetP95(summaryReport?.providerLatencyHealth ?? []),
    [summaryReport?.providerLatencyHealth]
  )

  // 15-C.1 / Wave 31: Real error count from 14-day per-event observations.
  // B2 fix: pass from/to so the Errors KPI tile aligns with the user's
  // selected date range (instead of always counting the full 14-day window).
  const fleetErrors = useMemo(
    () =>
      computeFleetErrors(
        summaryReport?.providerErrorObservations ?? [],
        from,
        to
      ),
    [summaryReport?.providerErrorObservations, from, to]
  )

  const kpiSummary = useMemo(
    () => toKpiSummary(summaryReport?.summary, fleetP95Ms, fleetErrors),
    [summaryReport?.summary, fleetP95Ms, fleetErrors]
  )

  // Wave 35 (wave35-data-flow-audit ⚠-5): receive the prior-period summary from
  // PhosphorDashboard (which owns the priorReport query) so we can compute signed
  // % deltas for the KPI strip without duplicating the query in index.tsx.
  const [priorSummary, setPriorSummary] = useState<
    UsageReportSummary | undefined
  >(undefined)
  const handlePriorSummaryReady = useCallback(
    (summary: UsageReportSummary | undefined): void => {
      setPriorSummary(summary)
    },
    []
  )

  // Wave 37 SF-4: receive prior-window fleet P95 and fleet errors from
  // PhosphorDashboard so all 6 KPI tiles can show a delta arrow.
  // `p95_ms` and `errors` are derived from health rows (not present in
  // UsageReportSummary), so they are passed via a dedicated callback.
  const [priorHealth, setPriorHealth] = useState<
    { priorP95: number; priorErrors: number } | undefined
  >(undefined)
  const handlePriorHealthReady = useCallback(
    (data: { priorP95: number; priorErrors: number } | undefined): void => {
      setPriorHealth(data)
    },
    []
  )

  // W38-3: Viewport gating note — kpiDeltas only populates when priorSummary is
  // defined, which only happens at ≥3840px viewports. The `showComparison` flag
  // (derived from a matchMedia for min-width: 3840px) gates the priorReport query
  // inside PhosphorDashboard; at narrower viewports the query is disabled, so
  // onPriorSummaryReady never fires and priorSummary stays undefined. As a result
  // all 6 delta arrows always render "—" at 2K viewports. This is intentional —
  // the ComparisonPanel that consumes prior data is only mounted at ≥3840px, so
  // there is no need to pay for the prior-period API call at smaller viewports.
  //
  // Compute signed-fractional deltas for each KPI key (format: 0.124 = +12.4%).
  // Uses computeDeltaPct (returns signed %, e.g. 12.4) divided by 100 so the
  // KpiStrip's renderDelta (which multiplies by 100) displays the correct value.
  // Returns undefined for a key when prior data is unavailable or prior is zero.
  // Wave 37 SF-4: p95_ms and errors deltas now wired via priorHealth from
  // PhosphorDashboard's onPriorHealthReady callback.
  const kpiDeltas = useMemo((): Partial<
    Record<keyof KpiSummaryShape, number>
  > => {
    if (kpiSummary === undefined || priorSummary === undefined) {
      return {}
    }
    const raw = {
      cost_usd: computeDeltaPct(kpiSummary.cost_usd, priorSummary.usd_cost),
      requests: computeDeltaPct(kpiSummary.requests, priorSummary.traces),
      token_in: computeDeltaPct(kpiSummary.token_in, priorSummary.token_in),
      token_out: computeDeltaPct(kpiSummary.token_out, priorSummary.token_out),
      // p95_ms and errors: derived from prior health rows (not in UsageReportSummary).
      // Available only when showComparison is true (priorReport query fires at ≥3840px).
      p95_ms:
        priorHealth !== undefined && priorHealth.priorP95 !== 0
          ? computeDeltaPct(kpiSummary.p95_ms, priorHealth.priorP95)
          : null,
      errors:
        priorHealth !== undefined && priorHealth.priorErrors !== 0
          ? computeDeltaPct(kpiSummary.errors, priorHealth.priorErrors)
          : null,
    }
    const result: Partial<Record<keyof KpiSummaryShape, number>> = {}
    for (const [key, val] of Object.entries(raw)) {
      if (val !== null) {
        result[key as keyof KpiSummaryShape] = val / 100
      }
    }
    return result
  }, [kpiSummary, priorSummary, priorHealth])

  const anomalies = useAnomalyDetection(
    (summaryReport?.providerLatencyHealth ?? []).filter(
      (r): r is typeof r & { bucket_start: string } => r.bucket_start !== null
    ),
    summaryReport?.metadata
  )

  // Wave 37 SF-1 / W37-1: queryKey matches PhosphorDashboard's key prefix and
  // date shape so React Query can dedupe normal load subscribers. The optional
  // cache-bust element is only populated by manual quota refresh.
  const { data: quotasData, isFetching: quotasFetching } = useQuery({
    ...usageReportQuotasQueryOptions({
      from,
      to,
      cacheBust: quotaCacheBust,
    }),
  })

  const { data: quotaRangeHistoryData, isFetching: quotaRangeHistoryFetching } =
    useQuery({
      queryKey: [
        'usage-report-quota-range-history',
        from,
        to,
        quotaRangeHistoryCacheBust,
      ],
      queryFn: ({ signal }) =>
        fetchUsageReportQuotaRangeHistory(
          {
            from,
            to,
            cacheBust: quotaRangeHistoryCacheBust,
          },
          signal
        ),
      enabled: providerSectionView === 'quota',
      staleTime: LIVE_DASHBOARD_REFETCH_INTERVAL_MS,
      refetchInterval: false,
      refetchIntervalInBackground: true,
    })

  const { data: quotaHistoryData, isFetching: quotaHistoryFetching } = useQuery(
    {
      queryKey: ['usage-report-quota-history', quotaHistoryCacheBust],
      queryFn: ({ signal }) =>
        fetchUsageReportQuotaHistory(
          {
            cacheBust: quotaHistoryCacheBust,
          },
          signal
        ),
      enabled: providerSectionView === 'health',
      staleTime: LIVE_DASHBOARD_REFETCH_INTERVAL_MS,
      refetchInterval: false,
      refetchIntervalInBackground: true,
    }
  )

  const quotaRows = useMemo(
    () => quotasData?.quotas ?? summaryReport?.quotas ?? [],
    [quotasData?.quotas, summaryReport?.quotas]
  )

  const recencyBreakout = useMemo<RecencyBreakoutItem[]>(() => {
    const sessionAt = sessionFreshnessAt
    const quotaAt = latestQuotaObservationAt(quotaRows)
    const healthAt = latestHealthBucketAt(
      summaryReport?.providerLatencyHealth ?? []
    )
    return [
      {
        label: 'Session',
        value: formatRecencyValue(sessionAt, recencyNow),
      },
      {
        label: 'Quota',
        value: formatRecencyValue(quotaAt, recencyNow),
      },
      {
        label: 'Health',
        value: formatRecencyValue(healthAt, recencyNow),
      },
    ]
  }, [
    quotaRows,
    recencyNow,
    sessionFreshnessAt,
    summaryReport?.providerLatencyHealth,
  ])

  const handleForceFreshnessRefresh = useCallback((): void => {
    setReportCacheBust(Date.now().toString())
  }, [])

  const handleQuotaRangeHistoryRefresh =
    useCallback(async (): Promise<void> => {
      const cacheBust = Date.now().toString()
      setQuotaRangeHistoryCacheBust(cacheBust)
      await queryClient.fetchQuery({
        queryKey: ['usage-report-quota-range-history', from, to, cacheBust],
        queryFn: ({ signal }) =>
          fetchUsageReportQuotaRangeHistory(
            {
              from,
              to,
              cacheBust,
            },
            signal
          ),
        staleTime: LIVE_DASHBOARD_REFETCH_INTERVAL_MS,
      })
    }, [from, queryClient, to])

  const handleQuotaHistoryRefresh = useCallback(async (): Promise<void> => {
    const cacheBust = Date.now().toString()
    setQuotaHistoryCacheBust(cacheBust)
    await queryClient.fetchQuery({
      queryKey: ['usage-report-quota-history', cacheBust],
      queryFn: ({ signal }) =>
        fetchUsageReportQuotaHistory(
          {
            cacheBust,
          },
          signal
        ),
      staleTime: LIVE_DASHBOARD_REFETCH_INTERVAL_MS,
    })
  }, [queryClient])

  const handleShortcutActivate = useCallback((shortcut: string): void => {
    setActiveSection(shortcut)

    switch (shortcut) {
      case 'status':
        scrollDashboardTargetIntoView('status')
        break
      case 'status-health':
        setProviderSectionView('health')
        scrollDashboardTargetIntoView('status')
        break
      case 'status-quota':
        setProviderSectionView('quota')
        scrollDashboardTargetIntoView('status')
        break
      case 'trend':
        scrollDashboardTargetIntoView('tokens')
        break
      case 'trend-tui':
      case 'trend-version':
      case 'trend-versions':
        setTrendLowerLaneMode('tui')
        scrollDashboardTargetIntoView('tokens')
        break
      case 'trend-requests':
        setTrendLowerLaneMode('requests')
        scrollDashboardTargetIntoView('tokens')
        break
      case 'trend-tools':
        setTrendLowerLaneMode('tools')
        scrollDashboardTargetIntoView('tokens')
        break
      case 'ledger':
        scrollDashboardTargetIntoView('models')
        break
      case 'ledger-model':
        setLedgerView('model')
        scrollDashboardTargetIntoView('models')
        break
      case 'ledger-repository':
        setLedgerView('repository')
        scrollDashboardTargetIntoView('models')
        break
      case 'filter':
        focusDashboardShortcutTarget('[data-shortcut-target="first-filter"]')
        break
      case 'date':
        focusDashboardShortcutTarget('[data-shortcut-target="first-date"]')
        break
      default:
        break
    }
  }, [])

  const handleReportRefresh = useCallback(async (): Promise<void> => {
    await refetchSummaryReport()
  }, [refetchSummaryReport])

  const handleQuotaRefresh = useCallback(async (): Promise<void> => {
    const bust = Date.now().toString()
    setQuotaCacheBust(bust)
    await queryClient.refetchQueries({
      queryKey: usageReportQuotasKey(from, to, bust),
    })
  }, [from, queryClient, to])

  const dashboardAlerts = useDashboardAlertSummary(
    anomalies,
    summaryReport?.summary,
    quotaRows,
    summaryReport?.providerErrorObservations,
    summaryReport?.dockerLogErrors,
    summaryReport?.providerLatencyHealth,
    recencyNow
  )

  return (
    <PhosphorLayout
      sidebar={<PhosphorSidebar dashboardAlerts={dashboardAlerts} />}
      header={
        <div
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRight: 'none',
            padding: '10px 12px',
            display: 'flex',
            gap: '16px',
            alignItems: 'center',
          }}
        >
          {/* KPI strip — dominant header element */}
          {/* Wave 35 (⚠-5 R-B): deltas wired from priorReport.summary via
              onPriorSummaryReady callback. Signed-fractional format (0.124 = +12.4%).
              Wave 35 (S1): className='kpi-strip' added for probe/test selector parity. */}
          <KpiStrip
            summary={kpiSummary}
            loading={summaryLoading}
            deltas={kpiDeltas}
            className='kpi-strip'
          />

          {/* Header actions */}
          <div
            style={{
              display: 'flex',
              gap: '8px',
              alignItems: 'center',
              flexShrink: 0,
            }}
          >
            <Search />
            <ConfigDrawer />
            <ProfileDropdown />
          </div>
        </div>
      }
      main={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {/* Page header — Playfair title, freshness, fleet-pulse, attribution */}
          {/* 14-B.1: mockup §3 — NO background, NO border, NO padding; position: relative */}
          <div
            className='page-header'
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              position: 'relative',
            }}
          >
            {/* 14-B.3: search input restored to page-header-top per mockup line 2382 */}
            <div
              className='page-header-top'
              style={{
                display: 'flex',
                alignItems: 'center',
              }}
            >
              {/* 14-B.3: search input per mockup — 180px, card-2 bg, mono, 10px */}
              {/* 15-C.4: controlled input — value + onChange wire to searchTerm state */}
              <input
                type='text'
                className='search-input'
                placeholder='⌘K search...'
                aria-label='Search dashboard'
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value)
                }}
              />
            </div>

            {/* 14-B.2: freshness indicator inline in subtext per mockup line 2384 */}
            {/* 14-B.?: subtext copy matches mockup verbatim */}
            <div
              className='page-subtext'
              style={{
                fontSize: 'clamp(10px, 0.55vw, 16px)',
                color: 'var(--fg-muted)',
              }}
            >
              {'LiteLLM usage, quota, cost, and repository activity · '}
              <span
                className='freshness-indicator'
                style={{
                  fontSize: '9px',
                  color: 'var(--fg-muted)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <span className='pulse-dot' />
                {freshnessStr}
              </span>
              <button
                type='button'
                className='section-refresh-button freshness-refresh-button'
                aria-label='Force refresh dashboard data'
                title='Force refresh dashboard data'
                disabled={summaryFetching}
                onClick={handleForceFreshnessRefresh}
              >
                <RefreshCw
                  aria-hidden='true'
                  className={
                    summaryFetching
                      ? 'section-refresh-icon is-updating'
                      : 'section-refresh-icon'
                  }
                  size={12}
                  strokeWidth={1.8}
                />
                <span className='section-refresh-status'>
                  {summaryFetching ? 'Updating' : 'Refresh'}
                </span>
              </button>
              <span
                className='freshness-breakout'
                aria-label='Underlying data recency'
              >
                {recencyBreakout.map((item) => (
                  <span className='freshness-breakout-item' key={item.label}>
                    <span className='freshness-breakout-label'>
                      {item.label}
                    </span>
                    <span className='freshness-breakout-value'>
                      {item.value}
                    </span>
                  </span>
                ))}
              </span>
            </div>
          </div>

          {/* Anchor bar — flush to page-header via border-top: none */}
          {/* 14-B.1: negative marginTop hack removed — page-header has no card chrome */}
          <AnchorBar
            activeSection={activeSection}
            onSectionChange={setActiveSection}
            onActivate={handleShortcutActivate}
          />

          {/* Wave 16-V controls row: SlicerBar left, DateControls right (inline) */}
          {/* Period buttons + grain selector removed per operator decision.        */}
          <div
            id='dashboard-controls'
            className='controls'
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              padding: '6px 10px',
              display: 'flex',
              gap: '8px',
              alignItems: 'center',
              fontSize: '10px',
            }}
          >
            {/* 15-D.5: SlicerBar inline with DateControls (Wave 16-V reposition) */}
            <SlicerBar
              filters={slicerFilters}
              options={slicerOptions}
              onChange={setSlicerFilters}
            />
            {/* DateControls: From/To inputs + Apply — period buttons removed (Wave 16-V) */}
            <DateControls
              initialFrom={from}
              initialTo={to}
              onRangeChange={handleRangeChange}
            />
          </div>

          {/* Main dashboard content */}
          {/* 15-C.4: searchTerm passed for client-side row filtering */}
          {/* 15-D.5: filters + onOptionsReady wired for slicer */}
          {/* Wave 35: onPriorSummaryReady wired to receive prior-period summary for KPI deltas */}
          {/* Wave 36 Fix 1: report + reportLoading hoisted from index.tsx query (dedup). */}
          {/* Wave 36 Fix 3: skeleton rendered when loading and no data yet (see below). */}
          {/* Wave 36 Fix 4: showComparison gates priorReport query to ≥3840px viewports. */}
          {summaryLoading && summaryReport === undefined ? (
            <div
              className='dashboard-loading-skeleton'
              aria-busy='true'
              aria-label='Loading dashboard'
            >
              {/* Header bar placeholder */}
              <div
                className='skeleton-block'
                style={{ height: '32px', marginBottom: '16px', width: '40%' }}
              />
              {/* KPI tile row placeholder (6 tiles) */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(6, 1fr)',
                  gap: '8px',
                  marginBottom: '16px',
                }}
              >
                {Array.from({ length: 6 }).map((_, i) => (
                  // Index key is safe: static placeholder, no state or reorder
                  <div
                    key={i}
                    className='skeleton-block'
                    style={{ height: '64px' }}
                  />
                ))}
              </div>
              {/* Provider card grid placeholder (~8 cards) */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                  gap: '8px',
                }}
              >
                {Array.from({ length: 8 }).map((_, i) => (
                  // Index key is safe: static placeholder, no state or reorder
                  <div
                    key={i}
                    className='skeleton-block'
                    style={{ height: '160px' }}
                  />
                ))}
              </div>
            </div>
          ) : (
            <PhosphorDashboard
              from={from}
              to={to}
              grain={grain}
              searchTerm={searchTerm}
              filters={slicerFilters}
              onOptionsReady={handleSlicerOptionsReady}
              onPriorSummaryReady={handlePriorSummaryReady}
              onPriorHealthReady={handlePriorHealthReady}
              report={summaryReport}
              reportLoading={summaryLoading}
              showComparison={showComparison}
              reportRefreshKey={reportCacheBust}
              quotas={quotasData?.quotas}
              reportFetching={summaryFetching}
              quotasFetching={quotasFetching}
              quotaHistory={quotaHistoryData?.quotaHistory ?? []}
              quotaHistoryFetching={quotaHistoryFetching}
              quotaRangeHistory={quotaRangeHistoryData?.quotaRangeHistory ?? []}
              quotaRangeHistoryFetching={quotaRangeHistoryFetching}
              onRefreshReport={handleReportRefresh}
              onRefreshQuotas={handleQuotaRefresh}
              onRefreshQuotaHistory={handleQuotaHistoryRefresh}
              onRefreshQuotaRangeHistory={handleQuotaRangeHistoryRefresh}
              providerSectionView={providerSectionView}
              onProviderSectionViewChange={setProviderSectionView}
              trendLowerLaneMode={trendLowerLaneMode}
              onTrendLowerLaneModeChange={setTrendLowerLaneMode}
              ledgerView={ledgerView}
              onLedgerViewChange={setLedgerView}
            />
          )}
        </div>
      }
    />
  )
}

// Future waves: expose from/to/grain as props on Dashboard for multi-view routing.
