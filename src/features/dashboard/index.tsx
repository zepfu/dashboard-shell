/**
 * Dashboard route entry point — Phosphor Atlas shell.
 *
 * Wave 9: v9.7 reference parity updates:
 * - Page-header: Playfair Display italic page title, freshness indicator,
 *   attribution legend.
 * - DateControls promoted to live state (operator decision 4).
 * - Controls bar styled per reference (control-input).
 * - Sidebar alerts via useDashboardAlertSummary (buildDashboardAlertSummary).
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
  type Dispatch,
  type SetStateAction,
  type ReactElement,
} from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ConfigDrawer } from '@/components/config-drawer'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import {
  fetchUsageReport,
  fetchUsageReportQuotaHistory,
  fetchUsageReportQuotaRangeHistory,
  fetchUsageReportTokenTrendSummary,
  LIVE_DASHBOARD_HEAVY_REFETCH_INTERVAL_MS,
  LIVE_DASHBOARD_HEAVY_REPORT_GC_TIME_MS,
  usageReportQuotasQueryOptions,
  type UsageReportGrain,
  type UsageReportQuotaHistoryResponse,
  type UsageReportQuotaRangeHistoryResponse,
} from './api/usage-report'
import AnchorBar from './components/anchor-bar'
import { computeDeltaPct } from './components/comparison-panel.index'
import { DashboardRecencyClock } from './components/dashboard-recency-clock'
import { DateControls } from './components/date-controls'
import { KpiStrip } from './components/kpi-strip'
import type { LedgerView } from './components/master-ledger-aggregation'
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
import { useAnomalyDetection } from './hooks/use-anomaly-detection'
import { computePriorReportWindow } from './lib/dashboard-date-range'
import {
  usageFilterKeyParts,
  usageFilterParams,
} from './lib/usage-filter-params'
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

interface DashboardDateRange {
  from: string
  to: string
}

function isRollingDefaultOwnedRange(
  range: DashboardDateRange,
  nextDefault: DashboardDateRange
): boolean {
  const previousDefault = {
    from: addDaysToDateString(nextDefault.from, -1),
    to: addDaysToDateString(nextDefault.to, -1),
  }
  return (
    (range.from === nextDefault.from && range.to === nextDefault.to) ||
    (range.from === previousDefault.from && range.to === previousDefault.to)
  )
}

const EMPTY_QUOTA_HISTORY: UsageReportQuotaHistoryResponse['quotaHistory'] = []
const EMPTY_QUOTA_RANGE_HISTORY: UsageReportQuotaRangeHistoryResponse['quotaRangeHistory'] =
  []

type CacheBustStateSetter = Dispatch<SetStateAction<string | undefined>>

async function runWithOneShotCacheBust<T>(
  stateSetter: CacheBustStateSetter,
  cacheBust: string,
  runner: () => Promise<T>
): Promise<T> {
  stateSetter(cacheBust)
  try {
    return await runner()
  } finally {
    stateSetter((current) => (current === cacheBust ? undefined : current))
  }
}

function buildUsageReportQueryKey(
  from: string,
  to: string,
  grain: UsageReportGrain,
  slicerFilters: SlicerFilters,
  cacheBust?: string
): readonly unknown[] {
  const key: unknown[] = [
    'usage-report-phosphor',
    from,
    to,
    grain,
    ...usageFilterKeyParts(slicerFilters),
  ]
  if (cacheBust !== undefined) {
    key.push(cacheBust)
  }
  return key
}

function buildUsageReportQueryFn({
  from,
  to,
  grain,
  slicerFilters,
  cacheBust,
}: {
  from: string
  to: string
  grain: UsageReportGrain
  slicerFilters: SlicerFilters
  cacheBust?: string
}) {
  return ({ signal }: { signal: AbortSignal }) =>
    fetchUsageReport(
      {
        from,
        to,
        grain,
        groupBy: ['provider', 'model', 'repository'],
        ...usageFilterParams(slicerFilters),
        cacheBust,
      },
      signal
    )
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
  cost_usd: number | null
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
    | {
        token_in: number
        token_out: number
        usd_cost: number | null
        traces: number
      }
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

  const [dateRange, setDateRange] = useState<DashboardDateRange>(() =>
    defaultDateRange()
  )
  const [userAdjustedDateRange, setUserAdjustedDateRange] = useState(false)
  const { from, to } = dateRange
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
  const [quotaRangeHistoryCacheBust, setQuotaRangeHistoryCacheBust] = useState<
    string | undefined
  >(undefined)
  const [quotaHistoryCacheBust, setQuotaHistoryCacheBust] = useState<
    string | undefined
  >(undefined)
  useEffect(() => {
    const syncRangeToEasternDay = (): void => {
      if (userAdjustedDateRange) return
      const nextDefaultRange = defaultDateRange()
      setDateRange((prev) => {
        if (!isRollingDefaultOwnedRange(prev, nextDefaultRange)) {
          return prev
        }
        const previousDefaultRange = {
          from: addDaysToDateString(nextDefaultRange.from, -1),
          to: addDaysToDateString(nextDefaultRange.to, -1),
        }
        const wasDefaultRange =
          prev.from === nextDefaultRange.from && prev.to === nextDefaultRange.to
        if (wasDefaultRange) {
          return prev
        }
        if (
          prev.from === previousDefaultRange.from &&
          prev.to === previousDefaultRange.to
        ) {
          return { from: nextDefaultRange.from, to: nextDefaultRange.to }
        }
        return prev
      })
    }
    syncRangeToEasternDay()
    const id = setInterval(syncRangeToEasternDay, 60_000)
    return () => {
      clearInterval(id)
    }
  }, [userAdjustedDateRange])

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
    setUserAdjustedDateRange(true)
    setDateRange({ from: nextFrom, to: nextTo })
  }

  const usageReportQueryKey = buildUsageReportQueryKey(
    from,
    to,
    grain,
    slicerFilters,
    reportCacheBust
  )
  const usageReportBaseQueryKey = useMemo(
    () =>
      buildUsageReportQueryKey(
        from,
        to,
        grain,
        slicerFilters
      ) as readonly unknown[],
    [from, to, grain, slicerFilters]
  )
  const tokenTrendScopeKey = useMemo(
    () =>
      JSON.stringify({
        from,
        to,
        providers: slicerFilters.providers,
        repositories: slicerFilters.repositories,
        clients: slicerFilters.clients,
        environments: slicerFilters.environments,
        models: slicerFilters.models,
      }),
    [
      from,
      to,
      slicerFilters.clients,
      slicerFilters.environments,
      slicerFilters.models,
      slicerFilters.providers,
      slicerFilters.repositories,
    ]
  )
  const tokenTrendSummaryBaseQueryKey = useMemo(
    () =>
      [
        'usage-report-token-trend-summary',
        tokenTrendScopeKey,
        undefined,
      ] as const,
    [tokenTrendScopeKey]
  )

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
    queryKey: usageReportQueryKey,
    queryFn: buildUsageReportQueryFn({
      from,
      to,
      grain,
      slicerFilters,
      cacheBust: reportCacheBust,
    }),
    // Keep React Query freshness aligned with the report-service default TTL.
    // The dashboard polls every minute, so new session rows should be eligible
    // for display on the next scheduled refresh.
    staleTime: LIVE_DASHBOARD_HEAVY_REFETCH_INTERVAL_MS,
    refetchInterval: LIVE_DASHBOARD_HEAVY_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    gcTime: LIVE_DASHBOARD_HEAVY_REPORT_GC_TIME_MS,
  })

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

  // P04-F03: lightweight prior-summary query fires at ALL viewports so the four
  // summary KPI deltas (cost/requests/token_in/token_out) render below 4K.
  // p95/errors stay gated on showComparison via PhosphorDashboard's full prior
  // report + onPriorHealthReady (health rows not present in UsageReportSummary).
  const { priorFrom, priorTo } = useMemo(
    () => computePriorReportWindow(from, to),
    [from, to]
  )
  const { data: priorSummaryReport } = useQuery({
    queryKey: [
      'usage-report-prior-summary',
      priorFrom,
      priorTo,
      grain,
      ...usageFilterKeyParts(slicerFilters),
    ],
    queryFn: ({ signal }) =>
      fetchUsageReport(
        {
          from: priorFrom,
          to: priorTo,
          grain,
          groupBy: ['provider', 'model', 'repository'],
          ...usageFilterParams(slicerFilters),
        },
        signal
      ),
    enabled: !summaryLoading && summaryReport !== undefined,
    staleTime: LIVE_DASHBOARD_HEAVY_REFETCH_INTERVAL_MS,
    refetchInterval: false,
    refetchIntervalInBackground: false,
    gcTime: LIVE_DASHBOARD_HEAVY_REPORT_GC_TIME_MS,
  })
  const priorSummary = priorSummaryReport?.summary

  // Wave 37 SF-4: receive prior-window fleet P95 and fleet errors from
  // PhosphorDashboard so p95/errors KPI tiles can show a delta arrow at ≥3840px.
  // `p95_ms` and `errors` are derived from health rows (not present in
  // UsageReportSummary), so they remain gated on showComparison.
  const [priorHealth, setPriorHealth] = useState<
    { priorP95: number; priorErrors: number } | undefined
  >(undefined)
  const handlePriorHealthReady = useCallback(
    (data: { priorP95: number; priorErrors: number } | undefined): void => {
      setPriorHealth(data)
    },
    []
  )

  // Compute signed-fractional deltas for each KPI key (format: 0.124 = +12.4%).
  // Uses computeDeltaPct (returns signed %, e.g. 12.4) divided by 100 so the
  // KpiStrip's renderDelta (which multiplies by 100) displays the correct value.
  // Summary deltas (cost/requests/token_in/token_out) come from the lightweight
  // prior-summary query above (all viewports). p95/errors only when
  // showComparison enables PhosphorDashboard's full prior report.
  const kpiDeltas = useMemo((): Partial<
    Record<keyof KpiSummaryShape, number>
  > => {
    if (kpiSummary === undefined || priorSummary === undefined) {
      return {}
    }
    const raw = {
      cost_usd:
        kpiSummary.cost_usd !== null && priorSummary.usd_cost !== null
          ? computeDeltaPct(kpiSummary.cost_usd, priorSummary.usd_cost)
          : null,
      requests: computeDeltaPct(kpiSummary.requests, priorSummary.traces),
      token_in: computeDeltaPct(kpiSummary.token_in, priorSummary.token_in),
      token_out: computeDeltaPct(kpiSummary.token_out, priorSummary.token_out),
      // p95_ms and errors: derived from prior health rows (not in UsageReportSummary).
      // Available only when showComparison is true (full priorReport at ≥3840px).
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

  const healthRowsForAnomaly = useMemo(
    () =>
      (summaryReport?.providerLatencyHealth ?? []).filter(
        (r): r is typeof r & { bucket_start: string } => r.bucket_start !== null
      ),
    [summaryReport?.providerLatencyHealth]
  )

  const anomalies = useAnomalyDetection(
    healthRowsForAnomaly,
    summaryReport?.metadata
  )

  // Wave 37 SF-1 / D1-451 C2: stable shared key for sidebar + dashboard poll dedupe.
  // Manual quota refresh uses fetchQuery on this key (fetch-only cache_bust), not key forks.
  const quotaQueryBase = usageReportQuotasQueryOptions({ from, to })
  const { data: quotasData, isFetching: quotasFetching } = useQuery({
    ...quotaQueryBase,
    refetchIntervalInBackground: false,
  })

  const quotaRangeHistoryBaseQueryKey = useMemo(
    () => ['usage-report-quota-range-history', from, to, undefined] as const,
    [from, to]
  )
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
      staleTime: LIVE_DASHBOARD_HEAVY_REFETCH_INTERVAL_MS,
      refetchInterval: false,
      refetchIntervalInBackground: false,
    })

  const quotaHistoryBaseQueryKey = useMemo(
    () => ['usage-report-quota-history', undefined] as const,
    []
  )
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
      staleTime: LIVE_DASHBOARD_HEAVY_REFETCH_INTERVAL_MS,
      refetchInterval: false,
      refetchIntervalInBackground: false,
    }
  )

  const quotaRows = useMemo(
    () => quotasData?.quotas ?? [],
    [quotasData?.quotas]
  )

  const handleForceFreshnessRefresh = useCallback(async (): Promise<void> => {
    const cacheBust = Date.now().toString()
    const summaryQueryKey = buildUsageReportQueryKey(
      from,
      to,
      grain,
      slicerFilters,
      cacheBust
    )
    const tokenTrendSummaryQueryKey = [
      'usage-report-token-trend-summary',
      tokenTrendScopeKey,
      cacheBust,
    ] as const
    await runWithOneShotCacheBust(setReportCacheBust, cacheBust, async () => {
      try {
        const refreshedSummary = await queryClient.fetchQuery({
          queryKey: summaryQueryKey,
          queryFn: buildUsageReportQueryFn({
            from,
            to,
            grain,
            slicerFilters,
            cacheBust,
          }),
          staleTime: LIVE_DASHBOARD_HEAVY_REFETCH_INTERVAL_MS,
        })
        queryClient.setQueryData(usageReportBaseQueryKey, refreshedSummary)
        // P6: scope serialized in tokenTrendScopeKey
        // eslint-disable-next-line @tanstack/query/exhaustive-deps -- fetchQuery options
        const refreshedTokenTrendSummary = await queryClient.fetchQuery({
          queryKey: tokenTrendSummaryQueryKey,
          queryFn: ({ signal }) =>
            fetchUsageReportTokenTrendSummary(
              {
                from,
                to,
                provider: slicerFilters.providers,
                repository: slicerFilters.repositories,
                client: slicerFilters.clients,
                environment: slicerFilters.environments,
                model: slicerFilters.models,
                cacheBust,
              },
              signal
            ),
          staleTime: LIVE_DASHBOARD_HEAVY_REFETCH_INTERVAL_MS,
        })
        queryClient.setQueryData(
          tokenTrendSummaryBaseQueryKey,
          refreshedTokenTrendSummary
        )
      } finally {
        queryClient.removeQueries({ queryKey: summaryQueryKey, exact: true })
        queryClient.removeQueries({
          queryKey: tokenTrendSummaryQueryKey,
          exact: true,
        })
      }
    })
  }, [
    from,
    grain,
    queryClient,
    slicerFilters,
    to,
    tokenTrendScopeKey,
    tokenTrendSummaryBaseQueryKey,
    usageReportBaseQueryKey,
  ])

  const handleQuotaRangeHistoryRefresh =
    useCallback(async (): Promise<void> => {
      const cacheBust = Date.now().toString()
      const queryKey = [
        'usage-report-quota-range-history',
        from,
        to,
        cacheBust,
      ] as const
      await runWithOneShotCacheBust(
        setQuotaRangeHistoryCacheBust,
        cacheBust,
        async () => {
          try {
            const refreshed = await queryClient.fetchQuery({
              queryKey,
              queryFn: ({ signal }) =>
                fetchUsageReportQuotaRangeHistory(
                  {
                    from,
                    to,
                    cacheBust,
                  },
                  signal
                ),
              staleTime: LIVE_DASHBOARD_HEAVY_REFETCH_INTERVAL_MS,
            })
            queryClient.setQueryData(quotaRangeHistoryBaseQueryKey, refreshed)
          } finally {
            queryClient.removeQueries({ queryKey, exact: true })
          }
        }
      )
    }, [from, queryClient, quotaRangeHistoryBaseQueryKey, to])

  const handleQuotaHistoryRefresh = useCallback(async (): Promise<void> => {
    const cacheBust = Date.now().toString()
    const queryKey = ['usage-report-quota-history', cacheBust] as const
    await runWithOneShotCacheBust(
      setQuotaHistoryCacheBust,
      cacheBust,
      async () => {
        try {
          const refreshed = await queryClient.fetchQuery({
            queryKey,
            queryFn: ({ signal }) =>
              fetchUsageReportQuotaHistory(
                {
                  cacheBust,
                },
                signal
              ),
            staleTime: LIVE_DASHBOARD_HEAVY_REFETCH_INTERVAL_MS,
          })
          queryClient.setQueryData(quotaHistoryBaseQueryKey, refreshed)
        } finally {
          queryClient.removeQueries({ queryKey, exact: true })
        }
      }
    )
  }, [queryClient, quotaHistoryBaseQueryKey])

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
    await queryClient.fetchQuery({
      ...usageReportQuotasQueryOptions({ from, to, cacheBust: bust }),
      queryKey: quotaQueryBase.queryKey,
      staleTime: 0,
    })
  }, [from, queryClient, quotaQueryBase.queryKey, to])

  return (
    <PhosphorLayout
      sidebar={
        <PhosphorSidebar
          alertInput={{
            anomalies,
            summary: summaryReport?.summary,
            quotas: quotaRows,
            providerErrorObservations: summaryReport?.providerErrorObservations,
            dockerLogErrors: summaryReport?.dockerLogErrors,
            providerLatencyHealth: summaryReport?.providerLatencyHealth,
          }}
        />
      }
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
          {/* P04-F03: summary deltas from index prior-summary query (all viewports);
              p95/errors from onPriorHealthReady when showComparison. */}
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
              <DashboardRecencyClock
                report={summaryReport}
                reportLatencyHealth={summaryReport?.providerLatencyHealth}
                quotaRows={quotaRows}
                dataUpdatedAt={dataUpdatedAt}
                summaryFetching={summaryFetching}
                onRefreshReport={handleForceFreshnessRefresh}
              />
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
          {/* P04-F03: summary KPI deltas come from index prior-summary query. */}
          {/* Wave 36 Fix 1: report + reportLoading hoisted from index.tsx query (dedup). */}
          {/* D1-226: keep PhosphorDashboard mounted during cold load so STATUS tabs
              and Diagnostics remain reachable while section bodies skeletonize. */}
          {/* Wave 36 Fix 4 / P04-F03: showComparison gates full priorReport
              (ComparisonPanel + p95/errors health) to ≥3840px viewports. */}
          <PhosphorDashboard
            from={from}
            to={to}
            grain={grain}
            searchTerm={searchTerm}
            filters={slicerFilters}
            onOptionsReady={handleSlicerOptionsReady}
            onPriorHealthReady={handlePriorHealthReady}
            report={summaryReport}
            reportLoading={summaryLoading}
            showComparison={showComparison}
            reportRefreshKey={reportCacheBust}
            quotas={quotasData?.quotas}
            reportFetching={summaryFetching}
            quotasFetching={quotasFetching}
            quotaHistory={quotaHistoryData?.quotaHistory ?? EMPTY_QUOTA_HISTORY}
            quotaHistoryMetadata={quotaHistoryData?.metadata}
            quotaHistoryFetching={quotaHistoryFetching}
            quotaRangeHistory={
              quotaRangeHistoryData?.quotaRangeHistory ??
              EMPTY_QUOTA_RANGE_HISTORY
            }
            quotaRangeHistoryMetadata={quotaRangeHistoryData?.metadata}
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
        </div>
      }
    />
  )
}

// Future waves: expose from/to/grain as props on Dashboard for multi-view routing.
