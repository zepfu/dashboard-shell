/**
 * PhosphorDashboard — Wave 9 reference-parity integration component.
 *
 * Composes the full set of Phosphor Atlas components into primary report
 * sections that match the AnchorBar shortcuts:
 *   status → tokens → models
 *
 * Wave 9 changes:
 * - Section label inversion fix: id="models" now contains ProviderCards;
 *   id="health" now contains MasterLedgerTable (matches v9.7 reference).
 * - Dense composition: gap reduced from 2rem to 4–8px; padding from 1rem to 4px.
 * - Section headings: amber color, border-bottom, clamp font-size.
 * - Provider grid: CSS grid repeat(4,1fr) → repeat(8,1fr) at wider breakpoints.
 * - Comparison panel at ≥3840px.
 * - iv-* quota interval class names replacing severity-*.
 *
 * Wave 11 PR1 (11-b, 11-c):
 * - Provider cards move from id="models" → id="status" (title: "Provider Health Summary").
 * - MasterLedgerTable moves from id="health" → id="models" (title: "Model Ledger").
 * - Standalone id="health" section removed; anchor `h` resolves in PR7.
 * - Section order: status → tokens → models.
 * - Section titles: Models→Model Ledger, Repos→Repository Breakdown.
 *
 * Data is fetched via fetchUsageReport + fetchUsageReportQuotas; anomaly
 * flags come from useAnomalyDetection.
 */
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  fetchShellHealth,
  fetchUsageReport,
  fetchUsageReportQuotaEstimator,
  fetchUsageReportQuotaHistory,
  fetchUsageReportSessionDiagnostics,
  LIVE_DASHBOARD_HEAVY_REFETCH_INTERVAL_MS,
  LIVE_DASHBOARD_HEAVY_REPORT_GC_TIME_MS,
  LIVE_DASHBOARD_QUOTAS_REFETCH_INTERVAL_MS,
  usageReportQuotasQueryOptions,
  fetchUsageReportToolActivity,
  fetchUsageReportTokenTrendDay,
  fetchUsageReportTokenTrendSummary,
  type ShellPgBouncerHealth,
  type UsageReportProviderCreditLifecycle,
  type UsageReportProviderErrorObservationRow,
  type UsageReportQuotaHistoryRow,
  type UsageReportQuotaHistoryResponse,
  type UsageReportQuotaRangeHistoryResponse,
  type UsageReportQuotaRow,
  type UsageReportResponse,
  type UsageReportSummary,
  type UsageReportTokenTrendScoreRow,
  type UsageReportGrain,
} from '../api/usage-report'
import { useAnomalyDetection } from '../hooks/use-anomaly-detection'
import {
  buildTokenTrendDayEnvelopes,
  normalizeTrendData,
} from '../lib/trend-utils'
import {
  canonicalProvider,
  computeFleetErrors,
  computeFleetP95,
  providerBrandHex,
  providerAliases,
} from '../lib/usage-report-display'
import { useControllableState } from '../lib/use-controllable-state'
import { AggregateCard } from './aggregate-card'
import {
  buildCurrentStats,
  ComparisonPanel,
  type ProviderCurrentStats,
} from './comparison-panel'
import type { LedgerView } from './master-ledger-aggregation'
import { MasterLedgerTable } from './master-ledger-table'
import {
  buildAggregateHealthCells,
  buildAggregateMetrics,
  buildModelRows,
  buildProviderMetrics,
  buildProviderLanes,
  buildTopModels,
  deriveProviders,
  padHealthCells,
  localFallbackRange,
} from './phosphor-dashboard.helpers'
import styles from './phosphor-dashboard.module.css'
import { ProviderCard, type ProviderCardConfig } from './provider-card'
import { type SlicerFilters, type SlicerOptions } from './slicer-bar'
import { AawmAliasRoutingPanel } from './status-section/aawm-alias-routing-panel'
import { PgBouncerHealthPanel } from './status-section/pgbouncer-health-panel'
import { ProviderAuthHealthPanel } from './status-section/provider-auth-health-panel'
import { ProviderCreditLifecyclePanel } from './status-section/provider-credit-lifecycle-panel'
import { ProviderQuotaHistoryBucket } from './status-section/provider-quota-history-bucket'
import { ProviderStatusLegend } from './status-section/provider-status-legend'
import { QuotaEstimatorWeightsPanel } from './status-section/quota-estimator-weights-panel'
import {
  SectionTitle,
  SectionRefreshButton,
  SectionTabs,
  SectionSkeleton,
} from './status-section/section-chrome'
import { SessionDiagnosticsPanel } from './status-section/session-diagnostics-panel'
import {
  TokenTrendChart,
  type LowerLaneMode,
  type ProviderSeries,
} from './token-trend-chart'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Masonry column breakpoints — keep in sync with `phosphor-dashboard.module.css`. */
const PROVIDER_HEALTH_MASONRY_BREAKPOINTS = {
  cols8: 2100,
  cols4: 1600,
} as const

function resolveProviderHealthColumnCount(viewportWidth: number): number {
  if (viewportWidth >= PROVIDER_HEALTH_MASONRY_BREAKPOINTS.cols8) return 8
  if (viewportWidth >= PROVIDER_HEALTH_MASONRY_BREAKPOINTS.cols4) return 4
  return 2
}

function getProviderHealthColumnCount(): number {
  if (typeof window === 'undefined') return 4
  return resolveProviderHealthColumnCount(window.innerWidth)
}

const STATUS_HEALTH_CARD_OMIT_PROVIDERS = new Set(['google', 'antigravity'])

/**
 * Ordered provider series for TokenTrendChart.
 * Colors match the Phosphor design palette reference hex values.
 *
 * Wave 25-PhosphorDash (F#9, F#10): added 'chatgpt' and 'unknown' entries to
 * capture tokens the live API emits under those provider names. Without these
 * entries the corresponding bar segments were silently dropped, causing bars to
 * appear 20–30% shorter than the mockup ("white space" operator report).
 *   chatgpt: #10a37f — OpenAI brand green (ChatGPT is an OpenAI product).
 *   unknown: #64748b — neutral slate matching the existing local series color.
 */
const PROVIDER_SERIES: ProviderSeries[] = [
  {
    key: 'anthropic',
    label: 'Anthropic',
    color: '#cc7855',
    cssClass: 'tt-anthropic',
  },
  {
    key: 'openai',
    label: 'OpenAI',
    color: '#10a37f',
    cssClass: 'tt-openai',
  },
  {
    key: 'chatgpt',
    label: 'ChatGPT',
    color: '#10a37f',
    cssClass: 'tt-chatgpt',
  },
  {
    key: 'google',
    label: 'Google',
    color: '#4285f4',
    cssClass: 'tt-google',
  },
  {
    key: 'antigravity',
    label: 'Antigravity',
    color: '#0f766e',
    cssClass: 'tt-antigravity',
  },
  {
    key: 'xai',
    label: 'xAI',
    // W28-TrendVisual Track A: was '#f5f5f5' (near-white, visually problematic).
    // Changed to '#475569' to match the xAI provider brand color.
    color: '#475569',
    cssClass: 'tt-xai',
  },
  {
    key: 'nvidia_nim',
    label: 'NVIDIA',
    color: '#76b900',
    cssClass: 'tt-nvidia',
  },
  {
    key: 'openrouter',
    label: 'OpenRouter',
    color: '#7e57c2',
    cssClass: 'tt-openrouter',
  },
  {
    key: 'local',
    label: 'Local',
    color: '#94a3b8',
    cssClass: 'tt-local',
  },
  {
    key: 'unknown',
    label: 'Unknown',
    color: '#64748b',
    cssClass: 'tt-unknown',
  },
]

function shouldShowTokenTrendDegradedBadge(
  metadata?: {
    degraded?: boolean
    degradedReason?: string
    timeout?: boolean
    timedOutSubqueries?: string[]
  } | null
): boolean {
  if (metadata?.degraded !== true) return false
  if (metadata.degradedReason !== 'bounded_raw_lane_policy') return true
  return (
    metadata.timeout === true || Boolean(metadata.timedOutSubqueries?.length)
  )
}

function hasPgBouncerIssue(health?: ShellPgBouncerHealth): boolean {
  if (health === undefined) return false
  if (health.error !== undefined && health.error.length > 0) return true
  if (health.status !== 'green') return true
  if (health.sidecars.length === 0) return false
  return health.sidecars.some((sidecar) => sidecar.status !== 'green')
}

function hasProviderCreditsAvailable(
  creditLifecycle?: UsageReportProviderCreditLifecycle
): boolean {
  if (
    (creditLifecycle?.summaries ?? []).some(
      (summary) => summary.available_count > 0
    )
  ) {
    return true
  }
  return (creditLifecycle?.entries ?? []).some(
    (entry) => entry.available_count > 0 || entry.status === 'available'
  )
}

type ProviderHealthCardRow = {
  provider: string
  config: ProviderCardConfig
  metrics: ReturnType<typeof buildProviderMetrics>
  cells: ReturnType<typeof padHealthCells>
  lanes: ReturnType<typeof buildProviderLanes> | undefined
  topModels: ReturnType<typeof buildTopModels>
  localHealthItems: UsageReportResponse['localHealth']
}

const ProviderHealthMasonry = memo(function ProviderHealthMasonry({
  columns,
  columnCount,
  aggregateConfig,
  aggregateMetrics,
  aggregateHealthCells,
  fleetActivity,
  anomalies,
  masonryClassName,
  columnClassName,
}: {
  columns: ProviderHealthCardRow[][]
  columnCount: number
  aggregateConfig: ProviderCardConfig
  aggregateMetrics: ReturnType<typeof buildAggregateMetrics>
  aggregateHealthCells: ReturnType<typeof buildAggregateHealthCells>
  fleetActivity: {
    toolCalls: number
    gitCommits: number
    gitPushes: number
    invalidToolCalls: number
  }
  anomalies: ReturnType<typeof useAnomalyDetection>
  masonryClassName: string
  columnClassName: string
}): ReactElement {
  return (
    <div className={`provider-health-summary ${masonryClassName}`}>
      {columns.map((cards, columnIndex) => (
        <div
          key={`provider-health-column-${columnIndex.toString()}`}
          className={`provider-health-summary-column ${columnClassName}`}
        >
          {cards.map((card) => (
            <ProviderCard
              key={`provider-health-card-${card.provider}`}
              config={card.config}
              data={card.metrics}
              healthCells={card.cells}
              lanes={card.lanes}
              anomalies={anomalies}
              topModels={card.topModels}
              localHealthItems={card.localHealthItems}
            />
          ))}
          {columnIndex === columnCount - 1 ? (
            <AggregateCard
              config={aggregateConfig}
              data={aggregateMetrics}
              healthCells={aggregateHealthCells}
              fleetActivity={fleetActivity}
              anomalies={anomalies}
            />
          ) : null}
        </div>
      ))}
    </div>
  )
})

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProviderSectionView =
  | 'health'
  | 'pgbouncer'
  | 'provider-credits'
  | 'quota'
  | 'provider-auth'
  | 'alias-routing'
  | 'weights'
  | 'diagnostics'

export interface PhosphorDashboardProps {
  /** ISO date string for the range start (YYYY-MM-DD). */
  from?: string
  /** ISO date string for the range end (YYYY-MM-DD). */
  to?: string
  /** Aggregation grain: 'day' | 'week' | 'month'. */
  grain?: UsageReportGrain
  /**
   * 15-C.4: Optional search term for client-side row filtering.
   * Applied as a case-insensitive substring match against model, repo,
   * and client name fields in the rendered tables.
   */
  searchTerm?: string
  /**
   * 15-D.4: Multi-dimension server-side filters sent to fetchUsageReport.
   * Updating filters changes the queryKey, triggering a refetch.
   * Empty arrays per dimension mean "all values" (no filter).
   */
  filters?: SlicerFilters
  /**
   * 15-D.3: Callback invoked after data loads so the parent can obtain the
   * current universe of option values for each slicer dimension.
   * Called with options derived from the fetched report.
   */
  onOptionsReady?: (options: SlicerOptions) => void
  /**
   * Wave 35: Callback invoked whenever the prior-period summary changes.
   * Used by index.tsx to compute KPI strip signed-% deltas without duplicating
   * the prior-window query. Called with `undefined` while the query is loading
   * or when the prior report is unavailable.
   */
  onPriorSummaryReady?: (summary: UsageReportSummary | undefined) => void
  /**
   * Wave 37 SF-4: Callback invoked whenever the prior-period derived health
   * metrics (fleet P95 and fleet errors) change. Enables index.tsx to compute
   * KPI strip deltas for the `p95_ms` and `errors` tiles, which are derived
   * from health rows (not present in UsageReportSummary). Called with
   * `undefined` while the prior-window query is loading or unavailable.
   */
  onPriorHealthReady?: (
    data: { priorP95: number; priorErrors: number } | undefined
  ) => void
  /**
   * Wave 36 Fix 1: The pre-fetched /usage report data from the parent
   * (index.tsx). Hoisting the query eliminates the duplicate HTTP request that
   * arose when both index.tsx and PhosphorDashboard fired separate useQuery
   * calls with slightly different queryKeys (filter arrays appended here but
   * not in index.tsx), causing React Query to treat them as distinct entries.
   * When provided, the internal useQuery is bypassed.
   */
  report?: UsageReportResponse
  /**
   * Wave 36 Fix 1: Loading state for the hoisted report query. When true (and
   * `report` is undefined), section skeletons are shown.
   */
  reportLoading?: boolean
  /** True whenever the main usage report query is fetching/refetching. */
  reportFetching?: boolean
  /** Cache-bust key from the shell Force Refresh action. */
  reportRefreshKey?: string
  /**
   * Quota cache-bust key from the parent (index `quotaCacheBust`). When set,
   * aligns the child standalone quotas query with the parent dedup key (C7).
   */
  quotasRefreshKey?: string
  /**
   * Wave 36 Fix 4: Whether the ComparisonPanel is visible (viewport ≥3840px).
   * Controls the `enabled` flag on the priorReport useQuery so that the prior-
   * period API call is only made when the panel is actually rendered.
   * Defaults to false (safe: prior-report query skipped on sub-4K viewports).
   */
  showComparison?: boolean
  /**
   * Wave 37 SF-1: Pre-fetched quota rows from the parent (index.tsx).
   * Hoisting /quotas onto the shared live `usage-report-quotas` query key
   * eliminates duplicate HTTP requests between the shell sidebar, index.tsx,
   * and standalone PhosphorDashboard fallback usage.
   * When provided, the internal quotas useQuery is bypassed.
   */
  quotas?: UsageReportQuotaRow[]
  /** True whenever the quota query is fetching/refetching. */
  quotasFetching?: boolean
  /** Recent quota history rows for Provider Status health-tab quota lanes. */
  quotaHistory?: UsageReportQuotaHistoryRow[]
  /** Metadata for the recent quota history response. */
  quotaHistoryMetadata?: UsageReportQuotaHistoryResponse['metadata']
  /** True whenever the recent quota history query is fetching/refetching. */
  quotaHistoryFetching?: boolean
  /** Range-aware quota history rows for the Status / Quota tab. */
  quotaRangeHistory?: UsageReportQuotaHistoryRow[]
  /** Metadata for the range-aware quota history response. */
  quotaRangeHistoryMetadata?: UsageReportQuotaRangeHistoryResponse['metadata']
  /** True whenever the range-aware quota history query is fetching/refetching. */
  quotaRangeHistoryFetching?: boolean
  /** Force-refresh the main usage report query. */
  onRefreshReport?: () => Promise<unknown> | unknown
  /** Force-refresh the quota query. */
  onRefreshQuotas?: () => Promise<unknown> | unknown
  /** Force-refresh the recent quota history query. */
  onRefreshQuotaHistory?: () => Promise<unknown> | unknown
  /** Force-refresh the range-aware quota history query. */
  onRefreshQuotaRangeHistory?: () => Promise<unknown> | unknown
  /** Controlled Status section tab. */
  providerSectionView?: ProviderSectionView
  /** Called when the Status section tab changes. */
  onProviderSectionViewChange?: (view: ProviderSectionView) => void
  /** Controlled Ledger tab. */
  ledgerView?: LedgerView
  /** Called when the Ledger tab changes. */
  onLedgerViewChange?: (view: LedgerView) => void
  /** Controlled Trend lower detail lane. */
  trendLowerLaneMode?: LowerLaneMode
  /** Called when the Trend lower detail lane changes. */
  onTrendLowerLaneModeChange?: (mode: LowerLaneMode) => void
}

// ---------------------------------------------------------------------------
// PhosphorDashboard
// ---------------------------------------------------------------------------

/**
 * PhosphorDashboard renders the full Phosphor Atlas dashboard, composing all
 * Wave 4-6 components into anchored sections that map to AnchorBar shortcuts.
 *
 * Wave 9: Section label inversion corrected — models section contains
 * ProviderCards, health section contains MasterLedgerTable, matching the
 * v9.7 reference (data-tab="models" renders ledger + providers in reference).
 *
 * Wave 11 PR1: Section restructure — provider cards under #status, Model Ledger
 * under #models, standalone #health removed.
 */
export default function PhosphorDashboard({
  from,
  to,
  grain,
  searchTerm = '',
  filters,
  onOptionsReady,
  onPriorSummaryReady,
  onPriorHealthReady,
  report: reportProp,
  reportLoading: reportLoadingProp = false,
  reportFetching: reportFetchingProp = false,
  reportRefreshKey,
  quotasRefreshKey,
  showComparison = false,
  quotas: quotasProp,
  quotasFetching: quotasFetchingProp = false,
  quotaHistory: quotaHistoryProp,
  quotaHistoryMetadata: quotaHistoryMetadataProp,
  quotaHistoryFetching: quotaHistoryFetchingProp = false,
  quotaRangeHistory: quotaRangeHistoryProp,
  quotaRangeHistoryMetadata,
  quotaRangeHistoryFetching = false,
  onRefreshReport,
  onRefreshQuotas,
  onRefreshQuotaHistory,
  onRefreshQuotaRangeHistory,
  providerSectionView: providerSectionViewProp,
  onProviderSectionViewChange,
  ledgerView: ledgerViewProp,
  onLedgerViewChange,
  trendLowerLaneMode,
  onTrendLowerLaneModeChange,
}: PhosphorDashboardProps): ReactElement {
  const defaults = useMemo(() => localFallbackRange(), [])
  const resolvedFrom = from ?? defaults.from
  const resolvedTo = to ?? defaults.to
  const resolvedGrain: UsageReportGrain = grain ?? 'day'
  const quotasCacheBust = quotasRefreshKey
  const [providerSectionView, setProviderSectionView] =
    useControllableState<ProviderSectionView>(
      providerSectionViewProp,
      'health',
      onProviderSectionViewChange
    )
  const [ledgerView, setLedgerView] = useControllableState<LedgerView>(
    ledgerViewProp,
    'model',
    onLedgerViewChange
  )

  // Wave 36 Fix 1: the /usage query is hoisted to index.tsx so a single HTTP
  // request is shared across the whole dashboard. This internal query is ONLY
  // used when PhosphorDashboard is rendered in isolation (e.g. Storybook, tests)
  // without a parent supplying `report` + `reportLoading` props.
  const parentManagesReport =
    reportLoadingProp || reportFetchingProp || onRefreshReport !== undefined
  const internalQueryEnabled = reportProp === undefined && !parentManagesReport
  const {
    data: internalReport,
    isLoading: internalLoading,
    isFetching: internalFetching,
    refetch: refetchInternalReport,
  } = useQuery({
    // 15-D.4: Include filter arrays directly in queryKey so React Query creates
    // a distinct cache entry for every unique slicer selection. Arrays are
    // JSON-serialised by React Query's key hashing.
    queryKey: [
      'usage-report-phosphor',
      resolvedFrom,
      resolvedTo,
      resolvedGrain,
      filters?.providers,
      filters?.repositories,
      filters?.clients,
      filters?.environments,
      filters?.models,
    ],
    queryFn: ({ signal }) =>
      fetchUsageReport(
        {
          from: resolvedFrom,
          to: resolvedTo,
          grain: resolvedGrain,
          groupBy: ['provider', 'model', 'repository'],
          // 15-D.4: pass multi-value filter arrays; empty array = no filter
          provider: filters?.providers,
          repository: filters?.repositories,
          client: filters?.clients,
          environment: filters?.environments,
          model: filters?.models,
        },
        signal
      ),
    // Skip when the parent has already provided the report data.
    enabled: internalQueryEnabled,
    staleTime: LIVE_DASHBOARD_HEAVY_REFETCH_INTERVAL_MS,
    refetchInterval: LIVE_DASHBOARD_HEAVY_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    gcTime: LIVE_DASHBOARD_HEAVY_REPORT_GC_TIME_MS,
  })

  // Resolve the effective report + loading state: prefer parent-supplied values
  // (Fix 1 dedup); fall back to the internal query for standalone usage.
  const report = reportProp ?? internalReport
  const reportLoading = internalQueryEnabled
    ? internalLoading
    : reportLoadingProp
  const reportFetching = internalQueryEnabled
    ? internalFetching
    : reportFetchingProp
  const secondaryReportQueriesEnabled = report !== undefined && !reportLoading

  // 15-C.5 / Wave 37 SF-1 / D1-436: /quotas is a live global snapshot today, so
  // Dashboard, sidebar, and standalone fallback callers share one query key.
  //
  // Wave 37 SF-1: this query is ONLY used when PhosphorDashboard is rendered
  // in isolation (e.g. Storybook, tests) without a parent supplying `quotas`.
  // The optional cache-bust element is only populated by explicit refresh.
  const internalQuotasEnabled = quotasProp === undefined
  const {
    data: quotasData,
    isFetching: internalQuotasFetching,
    refetch: refetchInternalQuotas,
  } = useQuery({
    ...usageReportQuotasQueryOptions({
      from: resolvedFrom,
      to: resolvedTo,
      cacheBust: quotasCacheBust,
    }),
    // Skip when the parent has already provided quota rows.
    enabled: internalQuotasEnabled,
    refetchIntervalInBackground: false,
  })
  const quotasFetching = internalQuotasEnabled
    ? internalQuotasFetching
    : quotasFetchingProp

  const internalQuotaHistoryEnabled = quotaHistoryProp === undefined
  const {
    data: internalQuotaHistoryData,
    isFetching: internalQuotaHistoryFetching,
    refetch: refetchInternalQuotaHistory,
  } = useQuery({
    queryKey: ['usage-report-quota-history'],
    queryFn: ({ signal }) => fetchUsageReportQuotaHistory({}, signal),
    enabled: internalQuotaHistoryEnabled && providerSectionView === 'health',
    staleTime: LIVE_DASHBOARD_HEAVY_REFETCH_INTERVAL_MS,
    refetchInterval: false,
    refetchIntervalInBackground: false,
  })
  const quotaHistoryFetching = internalQuotaHistoryEnabled
    ? internalQuotaHistoryFetching
    : quotaHistoryFetchingProp

  const {
    data: shellHealthData,
    isFetching: shellHealthFetching,
    refetch: refetchShellHealth,
  } = useQuery({
    queryKey: ['shell-health-pgbouncer'],
    queryFn: ({ signal }) => fetchShellHealth(signal),
    enabled:
      providerSectionView === 'health' || providerSectionView === 'pgbouncer',
    staleTime: 15_000,
    refetchInterval: LIVE_DASHBOARD_QUOTAS_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  })

  const {
    data: quotaEstimatorData,
    isFetching: quotaEstimatorFetching,
    isLoading: quotaEstimatorLoading,
    refetch: refetchQuotaEstimator,
  } = useQuery({
    queryKey: [
      'usage-report-quota-estimator',
      resolvedFrom,
      resolvedTo,
      reportRefreshKey,
    ],
    queryFn: ({ signal }) =>
      fetchUsageReportQuotaEstimator(
        {
          from: resolvedFrom,
          to: resolvedTo,
          cacheBust: reportRefreshKey,
        },
        signal
      ),
    enabled: providerSectionView === 'weights',
    staleTime: LIVE_DASHBOARD_HEAVY_REFETCH_INTERVAL_MS,
    refetchInterval: false,
    refetchIntervalInBackground: false,
  })

  const {
    data: sessionDiagnosticsData,
    isFetching: sessionDiagnosticsFetching,
    isLoading: sessionDiagnosticsLoading,
    refetch: refetchSessionDiagnostics,
  } = useQuery({
    queryKey: [
      'usage-report-session-diagnostics',
      resolvedFrom,
      resolvedTo,
      filters?.providers,
      filters?.repositories,
      filters?.clients,
      filters?.environments,
      filters?.models,
      reportRefreshKey,
    ],
    queryFn: ({ signal }) =>
      fetchUsageReportSessionDiagnostics(
        {
          from: resolvedFrom,
          to: resolvedTo,
          provider: filters?.providers,
          repository: filters?.repositories,
          client: filters?.clients,
          environment: filters?.environments,
          model: filters?.models,
          limit: 100,
          cacheBust: reportRefreshKey,
        },
        signal
      ),
    enabled: providerSectionView === 'diagnostics',
    staleTime: LIVE_DASHBOARD_HEAVY_REFETCH_INTERVAL_MS,
    refetchInterval: false,
    refetchIntervalInBackground: false,
  })

  const anomalyLatencyRows = useMemo(
    () =>
      (report?.providerLatencyHealth ?? []).filter(
        (r): r is typeof r & { bucket_start: string } => r.bucket_start !== null
      ),
    [report?.providerLatencyHealth]
  )
  const anomalies = useAnomalyDetection(anomalyLatencyRows, report?.metadata)

  const trendData = useMemo(
    () => normalizeTrendData(report?.trend ?? []),
    [report?.trend]
  )

  const tokenTrendScopeKey = useMemo(
    () =>
      JSON.stringify({
        from: resolvedFrom,
        to: resolvedTo,
        providers: filters?.providers ?? [],
        repositories: filters?.repositories ?? [],
        clients: filters?.clients ?? [],
        environments: filters?.environments ?? [],
        models: filters?.models ?? [],
      }),
    [
      resolvedFrom,
      resolvedTo,
      filters?.providers,
      filters?.repositories,
      filters?.clients,
      filters?.environments,
      filters?.models,
    ]
  )

  const {
    data: tokenTrendSummaryData,
    isFetching: tokenTrendSummaryFetching,
    refetch: refetchTokenTrendSummary,
    // P6: scope serialized in tokenTrendScopeKey (from/to/filters).
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
  } = useQuery({
    queryKey: [
      'usage-report-token-trend-summary',
      tokenTrendScopeKey,
      reportRefreshKey,
    ],
    queryFn: ({ signal }) =>
      fetchUsageReportTokenTrendSummary(
        {
          from: resolvedFrom,
          to: resolvedTo,
          provider: filters?.providers,
          repository: filters?.repositories,
          client: filters?.clients,
          environment: filters?.environments,
          model: filters?.models,
          cacheBust: reportRefreshKey,
        },
        signal
      ),
    staleTime: LIVE_DASHBOARD_HEAVY_REFETCH_INTERVAL_MS,
    enabled: secondaryReportQueriesEnabled,
    refetchInterval: LIVE_DASHBOARD_HEAVY_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    gcTime: LIVE_DASHBOARD_HEAVY_REPORT_GC_TIME_MS,
  })

  const tokenTrendVersions = useMemo(
    () =>
      tokenTrendSummaryData?.tokenTrendVersions ??
      report?.tokenTrendVersions ??
      [],
    [tokenTrendSummaryData?.tokenTrendVersions, report?.tokenTrendVersions]
  )
  const tokenTrendModelFirstSeen = useMemo(
    () =>
      tokenTrendSummaryData?.tokenTrendModelFirstSeen ??
      report?.tokenTrendModelFirstSeen ??
      [],
    [
      tokenTrendSummaryData?.tokenTrendModelFirstSeen,
      report?.tokenTrendModelFirstSeen,
    ]
  )
  const tokenTrendHealthRows = useMemo(() => {
    if (tokenTrendSummaryData?.metadata.tokenTrendHealthOmitted === true) {
      return report?.tokenTrendHealth ?? report?.providerLatencyHealth ?? []
    }
    return (
      tokenTrendSummaryData?.tokenTrendHealth ??
      report?.tokenTrendHealth ??
      report?.providerLatencyHealth ??
      []
    )
  }, [
    tokenTrendSummaryData?.metadata.tokenTrendHealthOmitted,
    tokenTrendSummaryData?.tokenTrendHealth,
    report?.tokenTrendHealth,
    report?.providerLatencyHealth,
  ])
  const summaryTokenTrendScores = tokenTrendSummaryData?.tokenTrendScores
  const reportTokenTrendScores = report?.tokenTrendScores
  const reportRows = report?.rows
  const tokenTrendScoreRows = useMemo<UsageReportTokenTrendScoreRow[]>(() => {
    if (summaryTokenTrendScores !== undefined) {
      return summaryTokenTrendScores
    }
    if (reportTokenTrendScores !== undefined) return reportTokenTrendScores
    return (reportRows ?? []).map((row) => ({
      ...row,
      provider: row.provider ?? 'unknown',
      model: row.model ?? 'unknown',
    }))
  }, [summaryTokenTrendScores, reportTokenTrendScores, reportRows])

  const tokenTrendDayEnvelopeBundle = useMemo(() => {
    const hours =
      tokenTrendSummaryData?.tokenTrendHours ?? report?.tokenTrendHours ?? []
    const build = buildTokenTrendDayEnvelopes
    return {
      tokens: build(hours),
      requests: build(hours, 'requests'),
      tools: build(hours, 'tools'),
    }
  }, [tokenTrendSummaryData?.tokenTrendHours, report?.tokenTrendHours])
  const tokenTrendDayEnvelopes = tokenTrendDayEnvelopeBundle.tokens
  const tokenTrendRequestDayEnvelopes = tokenTrendDayEnvelopeBundle.requests
  const tokenTrendToolDayEnvelopes = tokenTrendDayEnvelopeBundle.tools

  const [tokenTrendHoverTarget, setTokenTrendHoverTarget] = useState<{
    day: string
    hour: number
    scopeKey: string
  } | null>(null)
  const [tokenTrendDetailRequest, setTokenTrendDetailRequest] = useState<{
    day: string
    scopeKey: string
  } | null>(null)

  const handleTokenTrendHourHover = useCallback(
    (target: { day: string; hour: number } | null): void => {
      if (target === null) {
        setTokenTrendHoverTarget(null)
        setTokenTrendDetailRequest(null)
        return
      }
      setTokenTrendHoverTarget((current) =>
        current?.day === target.day &&
        current.hour === target.hour &&
        current.scopeKey === tokenTrendScopeKey
          ? current
          : { ...target, scopeKey: tokenTrendScopeKey }
      )
    },
    [tokenTrendScopeKey]
  )

  useEffect(() => {
    if (tokenTrendHoverTarget === null) return
    const timeout = window.setTimeout(() => {
      setTokenTrendDetailRequest((current) => {
        const next = {
          day: tokenTrendHoverTarget.day,
          scopeKey: tokenTrendHoverTarget.scopeKey,
        }
        if (current?.day === next.day && current.scopeKey === next.scopeKey) {
          return current
        }
        return next
      })
    }, 125)
    return () => {
      window.clearTimeout(timeout)
    }
  }, [tokenTrendHoverTarget])

  useEffect(() => {
    const clearTokenTrendHoverDetail = (): void => {
      setTokenTrendHoverTarget(null)
      setTokenTrendDetailRequest(null)
    }

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') {
        clearTokenTrendHoverDetail()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      clearTokenTrendHoverDetail()
    }
  }, [])

  const {
    data: tokenTrendDayDetailData,
    isFetching: tokenTrendDayDetailFetching,
    refetch: refetchTokenTrendDayDetail,
    // eslint-disable-next-line @tanstack/query/exhaustive-deps -- P6: scope serialized in tokenTrendScopeKey
  } = useQuery({
    queryKey: [
      'usage-report-token-trend-day',
      tokenTrendScopeKey,
      tokenTrendDetailRequest,
    ],
    queryFn: ({ signal }) => {
      if (tokenTrendDetailRequest === null) {
        throw new Error('Token trend day detail requested without a day.')
      }
      return fetchUsageReportTokenTrendDay(
        {
          from: resolvedFrom,
          to: resolvedTo,
          date: tokenTrendDetailRequest.day,
          provider: filters?.providers,
          repository: filters?.repositories,
          client: filters?.clients,
          environment: filters?.environments,
          model: filters?.models,
        },
        signal
      )
    },
    enabled:
      tokenTrendDetailRequest !== null &&
      tokenTrendDetailRequest.scopeKey === tokenTrendScopeKey,
    staleTime: LIVE_DASHBOARD_HEAVY_REFETCH_INTERVAL_MS,
    refetchInterval: false,
    refetchIntervalInBackground: false,
    gcTime: LIVE_DASHBOARD_HEAVY_REPORT_GC_TIME_MS,
  })
  const tokenTrendDetailMatchesScope =
    tokenTrendDetailRequest !== null &&
    tokenTrendDetailRequest.scopeKey === tokenTrendScopeKey
  const activeTokenTrendDayDetailData = tokenTrendDetailMatchesScope
    ? tokenTrendDayDetailData
    : undefined
  const activeTokenTrendDayDetailFetching = tokenTrendDetailMatchesScope
    ? tokenTrendDayDetailFetching
    : false

  const providerErrorObservations = useMemo(
    (): UsageReportProviderErrorObservationRow[] =>
      report?.providerErrorObservations ?? [],
    [report?.providerErrorObservations]
  )
  const summary = report?.summary
  const healthRows = useMemo(
    () => report?.providerLatencyHealth ?? [],
    [report?.providerLatencyHealth]
  )
  const providerStatusUsage = useMemo(
    () => report?.providerStatusUsage ?? [],
    [report?.providerStatusUsage]
  )

  const {
    data: toolActivityData,
    isFetching: toolActivityFetching,
    refetch: refetchToolActivity,
  } = useQuery({
    queryKey: [
      'usage-report-tool-activity',
      resolvedFrom,
      resolvedTo,
      filters?.providers,
      filters?.repositories,
      filters?.clients,
      filters?.environments,
      filters?.models,
    ],
    queryFn: ({ signal }) =>
      fetchUsageReportToolActivity(
        {
          from: resolvedFrom,
          to: resolvedTo,
          provider: filters?.providers,
          repository: filters?.repositories,
          client: filters?.clients,
          environment: filters?.environments,
          model: filters?.models,
        },
        signal
      ),
    staleTime: LIVE_DASHBOARD_HEAVY_REFETCH_INTERVAL_MS,
    enabled: secondaryReportQueriesEnabled,
    refetchInterval: LIVE_DASHBOARD_HEAVY_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    gcTime: LIVE_DASHBOARD_HEAVY_REPORT_GC_TIME_MS,
  })

  const providers = useMemo(() => deriveProviders(), [])
  const providerHealthCardProviders = useMemo(
    () =>
      providers.filter(
        (provider) => !STATUS_HEALTH_CARD_OMIT_PROVIDERS.has(provider)
      ),
    [providers]
  )

  const [providerHealthColumnCount, setProviderHealthColumnCount] = useState(
    () => getProviderHealthColumnCount()
  )

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const updateProviderHealthColumnCount = (): void => {
      setProviderHealthColumnCount(
        resolveProviderHealthColumnCount(window.innerWidth)
      )
    }

    updateProviderHealthColumnCount()
    window.addEventListener('resize', updateProviderHealthColumnCount)
    return () =>
      window.removeEventListener('resize', updateProviderHealthColumnCount)
  }, [])

  // Wave 37 SF-1: prefer parent-supplied quotas (dedup fix); fall back to the
  // internal quotasData query result (standalone usage) then report?.quotas.
  const quotaRows = useMemo(
    () => quotasProp ?? quotasData?.quotas ?? report?.quotas ?? [],
    [quotasProp, quotasData?.quotas, report?.quotas]
  )

  const quotaHistoryRows = useMemo(
    () =>
      quotaHistoryProp ??
      internalQuotaHistoryData?.quotaHistory ??
      report?.quotaHistory ??
      [],
    [
      quotaHistoryProp,
      internalQuotaHistoryData?.quotaHistory,
      report?.quotaHistory,
    ]
  )

  const providerLanesByProvider = useMemo(() => {
    const map = new Map<string, ReturnType<typeof buildProviderLanes>>()
    for (const provider of providerHealthCardProviders) {
      map.set(
        provider,
        buildProviderLanes(provider, quotaRows, quotaHistoryRows)
      )
    }
    return map
  }, [providerHealthCardProviders, quotaRows, quotaHistoryRows])

  const providerHealthCardRows = useMemo(
    () =>
      providerHealthCardProviders.map((provider) => {
        const config: ProviderCardConfig = {
          provider,
          // Wave 12 Fix 1: use reference brand hex for card header name color
          color: providerBrandHex(provider),
        }
        const aliases = providerAliases(provider)
        const metrics = buildProviderMetrics(
          provider,
          healthRows,
          report?.rows ?? [],
          undefined,
          aliases
        )
        const cells = padHealthCells(
          healthRows,
          provider,
          providerErrorObservations,
          aliases
        )
        const lanes = providerLanesByProvider.get(provider) ?? []
        const topModels = buildTopModels(
          providerStatusUsage,
          provider,
          healthRows,
          aliases
        )
        return {
          provider,
          config,
          metrics,
          cells,
          lanes: lanes.length > 0 ? lanes : undefined,
          topModels,
          localHealthItems:
            provider === 'local' ? (report?.localHealth ?? []) : [],
        }
      }),
    [
      providerHealthCardProviders,
      providerLanesByProvider,
      healthRows,
      providerErrorObservations,
      providerStatusUsage,
      report?.localHealth,
      report?.rows,
    ]
  )

  const providerHealthCardColumns = useMemo(() => {
    const columns = Array.from(
      { length: providerHealthColumnCount },
      () => [] as typeof providerHealthCardRows
    )
    providerHealthCardRows.forEach((row, index) => {
      const columnIndex = index % providerHealthColumnCount
      if (columnIndex >= 0 && columnIndex < columns.length) {
        columns[columnIndex].push(row)
      }
    })
    return columns
  }, [providerHealthCardRows, providerHealthColumnCount])

  const quotaRangeHistoryByProvider = useMemo(() => {
    const map = new Map<string, UsageReportQuotaHistoryRow[]>()
    for (const row of quotaRangeHistoryProp ??
      report?.quotaRangeHistory ??
      []) {
      const canonical = canonicalProvider(row.provider)
      const provider = canonical === 'antigravity' ? 'google' : canonical
      const rows = map.get(provider) ?? []
      rows.push(row)
      map.set(provider, rows)
    }
    for (const rows of map.values()) {
      rows.sort((a, b) =>
        String(b.expected_reset_at ?? '').localeCompare(
          String(a.expected_reset_at ?? '')
        )
      )
    }
    return map
  }, [quotaRangeHistoryProp, report?.quotaRangeHistory])

  const modelRows = useMemo(
    () =>
      buildModelRows(
        providerStatusUsage,
        healthRows,
        report?.rows ?? [], // 15-B.3: real token_in/token_out
        quotaRows, // 15-B.5: quota_pct from quota rows
        report?.trend ?? [], // Wave 30 Track 4: real 24h sparkline data
        toolActivityData?.toolActivity ?? report?.toolActivity ?? [] // W33: tool activity for TOOL cell hover
      ),
    [
      providerStatusUsage,
      healthRows,
      report?.rows,
      quotaRows,
      report?.trend,
      toolActivityData?.toolActivity,
      report?.toolActivity,
    ]
  )

  // 15-D.3: Derive slicer option universes from the current report data.
  // Providers:    distinct canonical provider names from providerLatencyHealth
  // Repositories: distinct repository strings from report.rows
  // Clients:      distinct client_name strings from report.clients
  // Environments: distinct environment strings from providerLatencyHealth
  // Models:       distinct model strings from providerStatusUsage
  const slicerOptions: SlicerOptions = useMemo(() => {
    const rows = report?.rows ?? []
    const healthRows = report?.providerLatencyHealth ?? []
    const clientData = report?.clients ?? []
    const statusUsage = report?.providerStatusUsage ?? []

    const uniqueSorted = (arr: string[]): string[] =>
      [...new Set(arr.filter(Boolean))].sort()

    return {
      providers: uniqueSorted(
        healthRows.map((r) => canonicalProvider(r.provider)).filter(Boolean)
      ),
      repositories: uniqueSorted(
        rows.map((r) => r.repository ?? '').filter(Boolean)
      ),
      clients: uniqueSorted(
        clientData.map((c) => c.client_name).filter(Boolean)
      ),
      environments: uniqueSorted(
        healthRows.map((r) => r.environment).filter(Boolean)
      ),
      models: uniqueSorted(statusUsage.map((r) => r.model).filter(Boolean)),
    }
  }, [
    report?.rows,
    report?.providerLatencyHealth,
    report?.clients,
    report?.providerStatusUsage,
  ])

  // 15-D.3: Notify parent of available slicer options whenever they change.
  useEffect(() => {
    if (onOptionsReady !== undefined) {
      onOptionsReady(slicerOptions)
    }
  }, [slicerOptions, onOptionsReady])

  // 15-C.4: Client-side search filtering for Model Ledger.
  // Case-insensitive substring match on model or repository child names. When
  // searchTerm is empty all rows are shown.
  const lowerSearch = searchTerm.toLowerCase()
  const filteredModelRows = useMemo(
    () =>
      lowerSearch === ''
        ? modelRows
        : modelRows
            .map((row) => ({
              ...row,
              repositoryChildren: row.repositoryChildren?.filter((repoRow) =>
                repoRow.model.toLowerCase().includes(lowerSearch)
              ),
            }))
            .filter(
              (row) =>
                row.model.toLowerCase().includes(lowerSearch) ||
                (row.repositoryChildren?.length ?? 0) > 0
            ),
    [modelRows, lowerSearch]
  )

  // Aggregate card data (fleet-wide totals from report.summary)
  // Wave 16-D: restored to summary-based aggregation to fix the row-cap
  // undercount (report.rows is server-capped at 500; summary covers all rows).
  const aggregateMetrics = useMemo(
    () => buildAggregateMetrics(healthRows, summary),
    [healthRows, summary]
  )

  // Wave 11 PR2 (11-e): renamed from 'Fleet' to 'Σ Aggregate Totals'.
  // The Σ character is intentional per the principal audit spec (S4).
  const aggregateConfig = useMemo(
    (): ProviderCardConfig => ({
      provider: 'Σ Aggregate Totals',
      color: 'var(--accent-chrome)',
    }),
    []
  )

  const aggregateHealthCells = useMemo(
    () => buildAggregateHealthCells(healthRows, providerErrorObservations),
    [healthRows, providerErrorObservations]
  )

  const fleetActivity = useMemo(
    () => ({
      toolCalls: summary?.tool_calls ?? 0,
      gitCommits: summary?.git_commit ?? 0,
      gitPushes: summary?.git_push ?? 0,
      invalidToolCalls: 0,
    }),
    [summary?.tool_calls, summary?.git_commit, summary?.git_push]
  )

  const periodDays = useMemo(
    () =>
      Math.max(
        1,
        Math.round(
          (new Date(resolvedTo).getTime() - new Date(resolvedFrom).getTime()) /
            86_400_000
        )
      ),
    [resolvedFrom, resolvedTo]
  )

  // Wave 32-Deltas: prior-window bounds — same span length, shifted back by
  // periodDays. priorTo = resolvedFrom; priorFrom = resolvedFrom − periodDays.
  const priorTo = resolvedFrom
  const priorFrom = useMemo(() => {
    const ms = new Date(resolvedFrom).getTime() - periodDays * 86_400_000
    return new Date(ms).toISOString().slice(0, 10)
  }, [resolvedFrom, periodDays])

  // Wave 32-Deltas: second useQuery for the prior window. Disabled until the
  // current report has loaded to avoid a redundant fetch on the initial render.
  // Reuses the same fetchUsageReport helper and filter params as the current
  // query so the prior-window data is structurally identical.
  const {
    data: priorReport,
    isFetching: priorReportFetching,
    refetch: refetchPriorReport,
  } = useQuery({
    queryKey: [
      'usage-report-phosphor-prior',
      priorFrom,
      priorTo,
      resolvedGrain,
      filters?.providers,
      filters?.repositories,
      filters?.clients,
      filters?.environments,
      filters?.models,
      showComparison,
    ],
    queryFn: ({ signal }) =>
      fetchUsageReport(
        {
          from: priorFrom,
          to: priorTo,
          grain: resolvedGrain,
          groupBy: ['provider', 'model', 'repository'],
          provider: filters?.providers,
          repository: filters?.repositories,
          client: filters?.clients,
          environment: filters?.environments,
          model: filters?.models,
        },
        signal
      ),
    // Only fire once the current report is available AND the ComparisonPanel is
    // visible (viewport ≥3840px). At 2275 and 5120 the panel is hidden so the
    // prior-window DB query is skipped entirely, saving a sequential waterfall
    // that previously added 20–30 s to the cold-load experience.
    enabled: !reportLoading && report !== undefined && showComparison,
    staleTime: LIVE_DASHBOARD_HEAVY_REFETCH_INTERVAL_MS,
    refetchInterval: false,
    refetchIntervalInBackground: false,
    gcTime: LIVE_DASHBOARD_HEAVY_REPORT_GC_TIME_MS,
  })

  // Wave 32-Deltas: build prior-window ProviderCurrentStats from priorReport,
  // using the same providers list and the same aggregation as the current window.
  const priorStats = useMemo((): ProviderCurrentStats[] | undefined => {
    if (priorReport === undefined) return undefined
    const priorModelRows = buildModelRows(
      priorReport.providerStatusUsage ?? [],
      priorReport.providerLatencyHealth ?? [],
      priorReport.rows ?? [],
      // Quota rows are not relevant for delta computation; pass empty array.
      [],
      priorReport.trend ?? [],
      // Tool activity not needed for delta computation; pass empty array.
      []
    )
    return buildCurrentStats(providers, priorModelRows, periodDays)
  }, [priorReport, providers, periodDays])

  // Wave 35: notify parent whenever the prior-period summary changes so index.tsx
  // can compute KPI strip signed-% deltas without duplicating the prior-window query.
  useEffect(() => {
    onPriorSummaryReady?.(priorReport?.summary)
  }, [onPriorSummaryReady, priorReport?.summary])

  // Wave 37 SF-4: compute prior-window fleet P95 and fleet errors from the
  // prior-period health rows, using the same helpers as the current-window KPI
  // computation in index.tsx. Notify the parent so it can wire all 6 KPI tiles.
  useEffect(() => {
    if (priorReport === undefined) {
      onPriorHealthReady?.(undefined)
      return
    }
    const priorHealthRows = priorReport.providerLatencyHealth ?? []
    const priorErrorObs = priorReport.providerErrorObservations ?? []
    onPriorHealthReady?.({
      priorP95: computeFleetP95(priorHealthRows),
      priorErrors: computeFleetErrors(priorErrorObs, priorFrom, priorTo),
    })
  }, [onPriorHealthReady, priorReport, priorFrom, priorTo])

  const refreshReport = useCallback(async (): Promise<void> => {
    if (onRefreshReport !== undefined) {
      await onRefreshReport()
      return
    }
    await refetchInternalReport()
  }, [onRefreshReport, refetchInternalReport])

  const refreshQuotas = useCallback(async (): Promise<void> => {
    if (onRefreshQuotas !== undefined) {
      await onRefreshQuotas()
      return
    }
    if (!internalQuotasEnabled) {
      return
    }
    await refetchInternalQuotas()
  }, [internalQuotasEnabled, onRefreshQuotas, refetchInternalQuotas])

  const refreshQuotaHistory = useCallback(async (): Promise<void> => {
    if (onRefreshQuotaHistory !== undefined) {
      await onRefreshQuotaHistory()
      return
    }
    if (!internalQuotaHistoryEnabled) {
      return
    }
    await refetchInternalQuotaHistory()
  }, [
    internalQuotaHistoryEnabled,
    onRefreshQuotaHistory,
    refetchInternalQuotaHistory,
  ])

  const refreshQuotaRangeHistory = useCallback(async (): Promise<void> => {
    if (onRefreshQuotaRangeHistory !== undefined) {
      await onRefreshQuotaRangeHistory()
      return
    }
    await refreshReport()
  }, [onRefreshQuotaRangeHistory, refreshReport])

  const refreshQuotaEstimator = useCallback(async (): Promise<void> => {
    await refetchQuotaEstimator()
  }, [refetchQuotaEstimator])

  const refreshSessionDiagnostics = useCallback(async (): Promise<void> => {
    await refetchSessionDiagnostics()
  }, [refetchSessionDiagnostics])

  const statusSectionActivity = useMemo(
    (): Record<
      ProviderSectionView,
      { updating: boolean; refresh: () => Promise<void> }
    > => ({
      health: {
        updating:
          reportFetching ||
          quotasFetching ||
          quotaHistoryFetching ||
          shellHealthFetching,
        refresh: async () => {
          await Promise.all([
            refreshReport(),
            refreshQuotas(),
            refreshQuotaHistory(),
            refetchShellHealth(),
          ])
        },
      },
      pgbouncer: {
        updating: shellHealthFetching,
        refresh: async () => {
          await refetchShellHealth()
        },
      },
      'provider-credits': {
        updating: reportFetching,
        refresh: async () => {
          await refreshReport()
        },
      },
      quota: {
        updating: quotasFetching || quotaRangeHistoryFetching,
        refresh: async () => {
          await Promise.all([refreshQuotas(), refreshQuotaRangeHistory()])
        },
      },
      'provider-auth': {
        updating: reportFetching,
        refresh: async () => {
          await refreshReport()
        },
      },
      'alias-routing': {
        updating: reportFetching,
        refresh: async () => {
          await refreshReport()
        },
      },
      weights: {
        updating: quotaEstimatorFetching,
        refresh: async () => {
          await refreshQuotaEstimator()
        },
      },
      diagnostics: {
        updating: sessionDiagnosticsFetching,
        refresh: async () => {
          await refreshSessionDiagnostics()
        },
      },
    }),
    [
      quotaEstimatorFetching,
      quotaHistoryFetching,
      quotaRangeHistoryFetching,
      quotasFetching,
      refetchShellHealth,
      refreshQuotaEstimator,
      refreshQuotaHistory,
      refreshQuotaRangeHistory,
      refreshQuotas,
      refreshReport,
      refreshSessionDiagnostics,
      reportFetching,
      sessionDiagnosticsFetching,
      shellHealthFetching,
    ]
  )

  const statusUpdating = statusSectionActivity[providerSectionView].updating

  const refreshStatusSection = useCallback(async (): Promise<void> => {
    await statusSectionActivity[providerSectionView].refresh()
  }, [providerSectionView, statusSectionActivity])

  const refreshTokenSection = useCallback(async (): Promise<void> => {
    const refreshes: Promise<unknown>[] = [
      refreshReport(),
      refetchTokenTrendSummary(),
    ]
    if (tokenTrendDetailMatchesScope) {
      refreshes.push(refetchTokenTrendDayDetail())
    }
    await Promise.all(refreshes)
  }, [
    refreshReport,
    refetchTokenTrendSummary,
    refetchTokenTrendDayDetail,
    tokenTrendDetailMatchesScope,
  ])

  const refreshComparisonSection = useCallback(async (): Promise<void> => {
    await Promise.all([refreshReport(), refetchPriorReport()])
  }, [refreshReport, refetchPriorReport])

  const refreshLedgerSection = useCallback(async (): Promise<void> => {
    await Promise.all([refreshReport(), refetchToolActivity()])
  }, [refreshReport, refetchToolActivity])

  const reportUpdating = reportFetching || toolActivityFetching
  const tokenTrendUpdating =
    reportFetching ||
    tokenTrendSummaryFetching ||
    activeTokenTrendDayDetailFetching
  const comparisonUpdating = reportFetching || priorReportFetching
  const quotaHistoryMetadata =
    quotaHistoryMetadataProp ?? internalQuotaHistoryData?.metadata
  const statusQuotaDegradedMetadata =
    quotaRangeHistoryMetadata?.degraded === true
      ? quotaRangeHistoryMetadata
      : quotaHistoryMetadata
  const statusDegraded =
    providerSectionView === 'quota' &&
    statusQuotaDegradedMetadata?.degraded === true
  const tokenTrendDegraded = shouldShowTokenTrendDegradedBadge(
    tokenTrendSummaryData?.metadata
  )
  const pgBouncerIssue = hasPgBouncerIssue(shellHealthData?.pgBouncerSidecars)
  const providerCreditsAvailable = hasProviderCreditsAvailable(
    report?.providerCreditLifecycle
  )

  return (
    <div
      className='phosphor-dashboard main-content'
      style={{
        padding: '0',
        display: 'flex',
        flexDirection: 'column',
        /* 14-H §20 #4: mockup default gap is 8px (4px only at 1600+) */
        gap: '8px',
      }}
    >
      {/* ── STATUS ────────────────────────────────────────────────────── */}
      {/* Wave 11 PR1 (11-b): provider cards move here from #models.     */}
      {/* D3: AggregateCard injected as the last peer in the grid;       */}
      {/* 1920px+ layouts wrap it onto a second row instead of hiding it. */}
      <section
        id='status'
        data-tab='status'
        aria-labelledby='section-status-heading'
      >
        <SectionTitle
          id='section-status-heading'
          tabs={
            <SectionTabs
              label='Status view'
              value={providerSectionView}
              options={[
                { value: 'health', label: 'Health' },
                {
                  value: 'pgbouncer',
                  label: 'PgBouncer',
                  indicator: pgBouncerIssue
                    ? {
                        label: 'PgBouncer has issues',
                        title: 'PgBouncer has issues',
                        className: 'is-red is-flashing',
                      }
                    : undefined,
                },
                {
                  value: 'provider-credits',
                  label: 'Provider Credits',
                  indicator: providerCreditsAvailable
                    ? {
                        label: 'Provider credits available',
                        title: 'Provider credits available',
                        className: 'is-green',
                      }
                    : undefined,
                },
                { value: 'quota', label: 'Quota' },
                { value: 'provider-auth', label: 'Provider Auth' },
                { value: 'alias-routing', label: 'Alias Routing' },
                { value: 'weights', label: 'Weights' },
                { value: 'diagnostics', label: 'Diagnostics' },
              ]}
              onChange={setProviderSectionView}
            />
          }
          accessory={
            <div className='section-title-tools'>
              <ProviderStatusLegend />
              {statusDegraded ? (
                <span
                  className='section-degraded-badge'
                  title={
                    statusQuotaDegradedMetadata?.degradedMessage ??
                    'Provider quota history is degraded.'
                  }
                >
                  Degraded
                </span>
              ) : null}
              <SectionRefreshButton
                label='Refresh provider data'
                updating={statusUpdating}
                onRefresh={refreshStatusSection}
              />
            </div>
          }
        >
          STATUS
        </SectionTitle>
        {reportLoading &&
        (providerSectionView === 'health' ||
          providerSectionView === 'provider-credits' ||
          providerSectionView === 'provider-auth' ||
          providerSectionView === 'alias-routing') ? (
          <SectionSkeleton height={120} />
        ) : providerSectionView === 'pgbouncer' ? (
          <PgBouncerHealthPanel
            health={shellHealthData?.pgBouncerSidecars}
            loading={shellHealthFetching}
          />
        ) : providerSectionView === 'provider-credits' ? (
          <ProviderCreditLifecyclePanel
            creditLifecycle={report?.providerCreditLifecycle}
          />
        ) : providerSectionView === 'health' ? (
          <ProviderHealthMasonry
            columns={providerHealthCardColumns}
            columnCount={providerHealthColumnCount}
            aggregateConfig={aggregateConfig}
            aggregateMetrics={aggregateMetrics}
            aggregateHealthCells={aggregateHealthCells}
            fleetActivity={fleetActivity}
            anomalies={anomalies}
            masonryClassName={styles['provider-health-summary-masonry']}
            columnClassName={styles['provider-health-summary-column']}
          />
        ) : providerSectionView === 'provider-auth' ? (
          <ProviderAuthHealthPanel authHealth={report?.providerAuthHealth} />
        ) : providerSectionView === 'alias-routing' ? (
          <AawmAliasRoutingPanel routing={report?.providerAliasRouting} />
        ) : providerSectionView === 'quota' ? (
          <div
            className={`provider-summary provider-quota-summary ${styles['provider-summary-grid']}`}
          >
            {providerHealthCardProviders.map((provider) => (
              <ProviderQuotaHistoryBucket
                key={`quota-${provider}`}
                provider={provider}
                rows={quotaRangeHistoryByProvider.get(provider) ?? []}
                rangeFrom={resolvedFrom}
                rangeTo={resolvedTo}
              />
            ))}
          </div>
        ) : providerSectionView === 'weights' ? (
          <QuotaEstimatorWeightsPanel
            response={quotaEstimatorData}
            loading={quotaEstimatorLoading || quotaEstimatorFetching}
          />
        ) : (
          <SessionDiagnosticsPanel
            response={sessionDiagnosticsData}
            loading={sessionDiagnosticsLoading || sessionDiagnosticsFetching}
          />
        )}
      </section>

      {/* ── TOKENS ────────────────────────────────────────────────────── */}
      <section
        id='tokens'
        data-tab='tokens'
        aria-labelledby='section-tokens-heading'
      >
        <SectionTitle
          id='section-tokens-heading'
          accessory={
            <div className='section-title-tools'>
              {tokenTrendDegraded ? (
                <span
                  className='section-degraded-badge'
                  title={
                    tokenTrendSummaryData?.metadata.degradedMessage ??
                    'Token trend summary is degraded.'
                  }
                >
                  Degraded
                </span>
              ) : null}
              <SectionRefreshButton
                label='Refresh Token Trend data'
                updating={tokenTrendUpdating}
                onRefresh={refreshTokenSection}
              />
            </div>
          }
        >
          TREND
        </SectionTitle>
        {reportLoading ? (
          <SectionSkeleton height={280} />
        ) : (
          <TokenTrendChart
            data={trendData}
            series={PROVIDER_SERIES}
            dayEnvelopes={
              tokenTrendDayEnvelopes.length > 0
                ? tokenTrendDayEnvelopes
                : undefined
            }
            requestDayEnvelopes={tokenTrendRequestDayEnvelopes}
            toolDayEnvelopes={tokenTrendToolDayEnvelopes}
            versionIntervals={tokenTrendVersions}
            modelFirstSeen={tokenTrendModelFirstSeen}
            healthRows={tokenTrendHealthRows}
            scoreRows={tokenTrendScoreRows}
            dayDetail={activeTokenTrendDayDetailData}
            detailLoading={activeTokenTrendDayDetailFetching}
            onHourHover={handleTokenTrendHourHover}
            lowerLaneMode={trendLowerLaneMode}
            onLowerLaneModeChange={onTrendLowerLaneModeChange}
          />
        )}
      </section>

      {/* ── MODEL LEDGER ──────────────────────────────────────────────── */}
      <section
        id='models'
        data-tab='models'
        aria-labelledby='section-models-heading'
      >
        <SectionTitle
          id='section-models-heading'
          tabs={
            <SectionTabs
              label='Ledger view'
              value={ledgerView}
              options={[
                { value: 'model', label: 'Model' },
                { value: 'repository', label: 'Repository' },
              ]}
              onChange={setLedgerView}
            />
          }
          accessory={
            <SectionRefreshButton
              label='Refresh Model Ledger data'
              updating={reportUpdating}
              onRefresh={refreshLedgerSection}
            />
          }
        >
          LEDGER
        </SectionTitle>
        {reportLoading ? (
          <SectionSkeleton height={200} />
        ) : (
          // 15-C.4: use filteredModelRows to apply searchTerm filter
          // Q8: pass providerErrorObservations for Err% hover tooltip
          <MasterLedgerTable
            rows={filteredModelRows}
            errorObservations={providerErrorObservations}
            ledgerView={ledgerView}
            onLedgerViewChange={setLedgerView}
          />
        )}
      </section>

      {/* ── COMPARISON (4K+ only) ─────────────────────────────────────── */}
      {showComparison ? (
        <section
          id='comparison'
          data-tab='comparison'
          aria-labelledby='section-comparison-heading'
          className={styles['comparison-section']}
        >
          <SectionTitle
            id='section-comparison-heading'
            accessory={
              <SectionRefreshButton
                label='Refresh Provider Comparison data'
                updating={comparisonUpdating}
                onRefresh={refreshComparisonSection}
              />
            }
          >
            Provider Comparison
          </SectionTitle>
          <ComparisonPanel
            providers={providers}
            modelRows={modelRows}
            trendBuckets={trendData}
            periodDays={periodDays}
            priorStats={priorStats}
          />
        </section>
      ) : null}
    </div>
  )
}
