/**
 * PhosphorDashboard — Wave 9 reference-parity integration component.
 *
 * Composes the full set of Phosphor Atlas components into primary report
 * sections that match the AnchorBar shortcuts:
 *   status → tokens → models → repos
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
 * - Section order: status → tokens → [models+repos row].
 * - models+repos wrapped in .ledger-repo-row: side-by-side 8fr/4fr at ≥1600px.
 * - Section titles: Models→Model Ledger, Repos→Repository Breakdown.
 *
 * Data is fetched via fetchUsageReport + fetchUsageReportQuotas; anomaly
 * flags come from useAnomalyDetection.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import {
  fetchShellHealth,
  fetchUsageReport,
  fetchUsageReportQuotaEstimator,
  fetchUsageReportQuotaHistory,
  usageReportQuotasQueryOptions,
  fetchUsageReportToolActivity,
  fetchUsageReportTokenTrendDay,
  fetchUsageReportTokenTrendSummary,
  type ShellPgBouncerHealth,
  type ShellPgBouncerSidecar,
  type UsageReportQuotaEstimatorCoefficient,
  type UsageReportQuotaEstimatorEstimate,
  type UsageReportQuotaEstimatorResponse,
  type UsageReportProviderErrorObservationRow,
  type UsageReportQuotaHistoryRow,
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
import styles from './phosphor-dashboard.module.css'
import {
  buildAggregateHealthCells,
  buildAggregateMetrics,
  buildModelRows,
  buildProviderMetrics,
  buildProviderQuotaHistoryTabs,
  buildProviderLanes,
  buildTopModels,
  deriveProviders,
  fmtIntervalCompact,
  formatCompactQuantity,
  padHealthCells,
  quotaHistoryConsumedPct,
  quotaHistoryFillColor,
  quotaHistoryRequests,
  localFallbackRange,
} from './phosphor-dashboard.testkit'
// fmtIntervalCompact is re-exported from the testkit (defined locally after flat-path
// deletion) so it is available for quota-history rendering in this component.
import { ProviderCard, type ProviderCardConfig } from './provider-card'
import { type SlicerFilters, type SlicerOptions } from './slicer-bar'
import {
  TokenTrendChart,
  type LowerLaneMode,
  type ProviderSeries,
} from './token-trend-chart'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LIVE_DASHBOARD_REFETCH_INTERVAL_MS = 60_000

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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProviderSectionView = 'health' | 'quota' | 'weights'

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
   * Wave 36 Fix 4: Whether the ComparisonPanel is visible (viewport ≥3840px).
   * Controls the `enabled` flag on the priorReport useQuery so that the prior-
   * period API call is only made when the panel is actually rendered.
   * Defaults to false (safe: prior-report query skipped on sub-4K viewports).
   */
  showComparison?: boolean
  /**
   * Wave 37 SF-1: Pre-fetched quota rows from the parent (index.tsx).
   * Hoisting the /quotas query to index.tsx with the same queryKey shape
   * (`['usage-report-quotas', from, to]`) eliminates the duplicate HTTP request
   * that arose from the key mismatch between index.tsx and PhosphorDashboard.
   * When provided, the internal quotas useQuery is bypassed.
   */
  quotas?: UsageReportQuotaRow[]
  /** True whenever the quota query is fetching/refetching. */
  quotasFetching?: boolean
  /** Recent quota history rows for Provider Status health-tab quota lanes. */
  quotaHistory?: UsageReportQuotaHistoryRow[]
  /** True whenever the recent quota history query is fetching/refetching. */
  quotaHistoryFetching?: boolean
  /** Range-aware quota history rows for the Status / Quota tab. */
  quotaRangeHistory?: UsageReportQuotaHistoryRow[]
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
// Section title style helper
// ---------------------------------------------------------------------------

/** Returns a consistent section-title <h2> element matching v9.7 spec. */
function SectionTitle({
  id,
  children,
  accessory,
  tabs,
}: {
  id: string
  children: string
  accessory?: ReactNode
  tabs?: ReactNode
}): ReactElement {
  const title = (
    <h2
      id={id}
      className='section-title'
      style={{
        fontSize: 'clamp(10px, 0.6vw, 18px)',
        color: 'var(--accent-chrome)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        fontWeight: 600,
        margin: 0,
      }}
    >
      {children}
    </h2>
  )

  return (
    <div className='section-title-row'>
      <div className='section-title-main'>
        {title}
        {tabs}
      </div>
      {accessory === undefined ? null : (
        <div className='section-title-accessory'>{accessory}</div>
      )}
    </div>
  )
}

function SectionRefreshButton({
  label,
  updating,
  onRefresh,
}: {
  label: string
  updating: boolean
  onRefresh?: () => Promise<unknown> | unknown
}): ReactElement {
  return (
    <button
      type='button'
      className='section-refresh-button'
      aria-label={label}
      title={label}
      onClick={() => {
        void onRefresh?.()
      }}
      disabled={onRefresh === undefined || updating}
    >
      <RefreshCw
        aria-hidden='true'
        className={
          updating ? 'section-refresh-icon is-updating' : 'section-refresh-icon'
        }
        size={13}
        strokeWidth={1.8}
      />
      <span className='section-refresh-status'>
        {updating ? 'Updating' : 'Refresh'}
      </span>
    </button>
  )
}

function SectionTabs<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
}): ReactElement {
  return (
    <div role='tablist' aria-label={label} className='section-tabs'>
      {options.map((option) => {
        const selected = value === option.value
        return (
          <button
            key={option.value}
            type='button'
            role='tab'
            aria-selected={selected}
            className={selected ? 'is-active' : undefined}
            onClick={() => {
              onChange(option.value)
            }}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function ProviderQuotaHistoryBucket({
  provider,
  rows,
  rangeFrom,
  rangeTo,
}: {
  provider: string
  rows: UsageReportQuotaHistoryRow[]
  rangeFrom: string
  rangeTo: string
}): ReactElement {
  const providerColor = providerBrandHex(provider)
  const providerLabel = canonicalProvider(provider)
  const rangeLabel =
    rangeFrom.trim().length > 0 && rangeTo.trim().length > 0
      ? `${rangeFrom} to ${rangeTo}`
      : 'the selected range'
  const quotaTabs = useMemo(
    () => buildProviderQuotaHistoryTabs(provider, rows),
    [provider, rows]
  )
  const [activeTabKey, setActiveTabKey] = useState<string | null>(null)
  const defaultTab =
    quotaTabs.find((tab) => tab.rows.length > 0) ?? quotaTabs[0]
  const selectedTab =
    quotaTabs.find((tab) => tab.tabKey === activeTabKey) ?? defaultTab ?? null
  const selectedRows = selectedTab?.rows ?? []
  const visibleRowCount = quotaTabs.reduce(
    (sum, tab) => sum + tab.rows.length,
    0
  )

  return (
    <article
      className='provider-quota-bucket'
      style={{ borderTopColor: providerColor }}
    >
      <div className='provider-quota-bucket-head'>
        <span style={{ color: providerColor }}>{provider}</span>
        <span>{visibleRowCount.toLocaleString()} bars</span>
      </div>
      {quotaTabs.length === 0 ? null : (
        <div
          role='tablist'
          aria-label={`${provider} quota bars`}
          className='provider-quota-type-tabs'
        >
          {quotaTabs.map((tab) => {
            const selected = selectedTab?.tabKey === tab.tabKey
            return (
              <button
                key={tab.tabKey}
                type='button'
                role='tab'
                aria-selected={selected}
                className={selected ? 'is-active' : undefined}
                onClick={() => {
                  setActiveTabKey(tab.tabKey)
                }}
              >
                <span>{tab.label}</span>
                <span className='provider-quota-type-count'>
                  {tab.rows.length}
                </span>
              </button>
            )
          })}
        </div>
      )}
      <div className='provider-quota-bucket-scroll'>
        {selectedRows.length === 0 ? (
          <div className='provider-quota-empty'>
            no quota history for {providerLabel} in {rangeLabel}
          </div>
        ) : (
          selectedRows.map((row, rowIndex) => {
            const consumedPct = quotaHistoryConsumedPct(row)
            const requests = quotaHistoryRequests(row)
            const modelLabel = row.model ?? 'all models'
            const rangeLabel = fmtIntervalCompact(
              row.interval_start,
              row.interval_end
            )
            return (
              <div
                key={[
                  row.provider,
                  row.model ?? 'all',
                  row.quota_type,
                  row.expected_reset_at ?? rangeLabel,
                  rowIndex,
                ].join('|')}
                className='provider-quota-history-row'
              >
                <div className='provider-quota-history-meta'>
                  <span className='provider-quota-history-label'>
                    {modelLabel}
                  </span>
                  <span className='provider-quota-history-pct'>
                    {consumedPct.toFixed(0)}%
                  </span>
                </div>
                <div className='provider-quota-static-bar'>
                  <div
                    className='provider-quota-static-fill'
                    style={{
                      width: `${consumedPct.toFixed(1)}%`,
                      background: quotaHistoryFillColor(consumedPct),
                    }}
                  />
                </div>
                <div className='provider-quota-history-foot'>
                  <span>{rangeLabel}</span>
                  <span>
                    {formatCompactQuantity(row.usage_tokens)} tok ·{' '}
                    {formatCompactQuantity(requests)} req
                  </span>
                </div>
              </div>
            )
          })
        )}
      </div>
    </article>
  )
}

function formatEstimatorPercent(
  value: number | null | undefined,
  decimals = 2
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }
  return `${value.toFixed(decimals)}%`
}

function formatEstimatorNumber(
  value: number | null | undefined,
  decimals = 2
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }
  return value.toFixed(decimals)
}

function formatEstimatorStatusLabel(status: string): string {
  switch (status) {
    case 'high_confidence':
      return 'high_confidence'
    case 'directional_only':
      return 'directional_only'
    case 'not_identifiable':
      return 'not_identifiable'
    case 'evaluated':
      return 'evaluated'
    case 'not_enough_holdout_data':
      return 'holdout pending'
    case 'anomalous':
      return 'anomalous'
    case 'consistent':
      return 'consistent'
    default:
      return status.replace(/_/g, ' ')
  }
}

function quotaEstimatorLaneLabel(
  estimate: UsageReportQuotaEstimatorEstimate
): string {
  const provider = canonicalProvider(estimate.provider).toLowerCase()
  const quotaType = estimate.quota_type.toLowerCase()
  if (provider === 'openai') {
    switch (quotaType) {
      case 'short':
        return 'all models · 5h'
      case 'weekly':
        return 'all models · 7d'
      case 'short_special':
        return 'codex-spark · 5h'
      case 'special':
        return 'codex-spark · 7d'
      default:
        return estimate.quota_lane
    }
  }
  if (provider === 'anthropic') {
    switch (quotaType) {
      case 'short':
        return 'all models · 5h'
      case 'weekly':
        return 'all models · 7d'
      case 'special':
        return 'sonnet-only · 7d'
      default:
        return estimate.quota_lane
    }
  }
  return estimate.quota_lane
}

function groupEstimatorCoefficients(
  coefficients: UsageReportQuotaEstimatorCoefficient[]
): Array<{
  tokenCategory: UsageReportQuotaEstimatorCoefficient['token_category']
  families: Array<{
    modelFamily: string
    rows: UsageReportQuotaEstimatorCoefficient[]
  }>
}> {
  const byCategory = new Map<
    UsageReportQuotaEstimatorCoefficient['token_category'],
    Map<string, UsageReportQuotaEstimatorCoefficient[]>
  >()

  for (const coefficient of coefficients) {
    const category = coefficient.token_category
    const familyRows = byCategory.get(category) ?? new Map()
    const family = coefficient.model_family || 'unknown'
    const rows = familyRows.get(family) ?? []
    rows.push(coefficient)
    familyRows.set(family, rows)
    byCategory.set(category, familyRows)
  }

  return [...byCategory.entries()].map(([tokenCategory, familyRows]) => ({
    tokenCategory,
    families: [...familyRows.entries()]
      .map(([modelFamily, rows]) => ({
        modelFamily,
        rows: rows.sort((a, b) =>
          a.estimate_kind.localeCompare(b.estimate_kind)
        ),
      }))
      .sort((a, b) => a.modelFamily.localeCompare(b.modelFamily)),
  }))
}

function QuotaEstimatorWeightsPanel({
  response,
  loading,
}: {
  response: UsageReportQuotaEstimatorResponse | undefined
  loading: boolean
}): ReactElement {
  const estimates = response?.estimates ?? []
  const metadata = response?.metadata
  const hasEstimates = estimates.length > 0

  if (loading && !hasEstimates) {
    return (
      <div className='status-estimator-empty' role='status'>
        Loading Phase 0-2 estimator detail…
      </div>
    )
  }

  if (!loading && !hasEstimates) {
    return (
      <div className='status-estimator-empty' role='status'>
        No Phase 0-2 estimator lanes for the selected range.
      </div>
    )
  }

  return (
    <div className='status-estimator-panel'>
      <header className='status-estimator-header'>
        <strong>Phase 0-2 estimator detail</strong>
        <span>
          {metadata?.phase === '0-2' ? 'Phase 0-2' : 'Phase unknown'} ·{' '}
          {metadata?.estimatorVersion ?? 'version unknown'}
        </span>
      </header>
      <div className='status-estimator-grid'>
        {estimates.map((estimate, index) => {
          const identStatus = estimate.identifiability.status
          const statusClass = identStatus.replace(/_/g, '-')
          const coefficientGroups = groupEstimatorCoefficients(
            estimate.coefficients
          )

          return (
            <article
              key={[
                estimate.provider,
                estimate.quota_key,
                estimate.quota_type,
                estimate.quota_lane,
                estimate.selected_lag_minutes,
                index,
              ].join('|')}
              className='status-estimator-lane'
            >
              <div className='status-estimator-lane-head'>
                <span style={{ color: providerBrandHex(estimate.provider) }}>
                  {canonicalProvider(estimate.provider)}
                </span>
                <span>{quotaEstimatorLaneLabel(estimate)}</span>
              </div>
              <div className='status-estimator-lane-key'>
                {estimate.quota_key} · {estimate.quota_lane}
              </div>
              <div
                className={`status-estimator-lane-state is-${statusClass}`}
                role='status'
              >
                {formatEstimatorStatusLabel(identStatus)}
              </div>
              <div className='status-estimator-meta-grid'>
                <span>
                  lag <strong>{estimate.selected_lag_minutes}m</strong>
                </span>
                <span>
                  trainable{' '}
                  <strong>
                    {estimate.trainable_interval_count.toLocaleString()}
                  </strong>
                </span>
                <span>
                  effective sample{' '}
                  <strong>
                    {estimate.identifiability.effective_sample_size.toLocaleString()}
                  </strong>
                </span>
              </div>
              <div className='status-estimator-meta-grid'>
                <span>
                  intervals{' '}
                  <strong>{estimate.interval_count.toLocaleString()}</strong>
                </span>
                <span>
                  excluded{' '}
                  <strong>
                    {estimate.excluded_interval_count.toLocaleString()}
                  </strong>
                </span>
                <span>
                  active features{' '}
                  <strong>
                    {estimate.identifiability.active_feature_count.toLocaleString()}
                  </strong>
                </span>
              </div>
              <div className='status-estimator-block'>
                <strong>Residuals</strong>
                <span>
                  static RMSE{' '}
                  {formatEstimatorPercent(
                    estimate.residuals.static_baseline.rmse_pct
                  )}
                  , MAE{' '}
                  {formatEstimatorPercent(
                    estimate.residuals.static_baseline.mae_pct
                  )}
                </span>
                <span>
                  rolling RMSE{' '}
                  {formatEstimatorPercent(
                    estimate.residuals.rolling_exponential.rmse_pct
                  )}
                  , MAE{' '}
                  {formatEstimatorPercent(
                    estimate.residuals.rolling_exponential.mae_pct
                  )}
                </span>
                <span>
                  backtest{' '}
                  {formatEstimatorStatusLabel(estimate.backtest.status)} ·
                  holdout{' '}
                  {estimate.backtest.holdout_interval_count?.toLocaleString() ??
                    '—'}{' '}
                  · improved {estimate.backtest.rolling_improved ? 'yes' : 'no'}
                </span>
              </div>
              <div className='status-estimator-block'>
                <strong>Lag sensitivity</strong>
                {estimate.lag_sensitivity.length === 0 ? (
                  <span className='status-estimator-muted'>none</span>
                ) : (
                  estimate.lag_sensitivity.map((lag) => (
                    <span
                      key={`${estimate.quota_lane}-lag-${lag.lag_minutes}`}
                      className='status-estimator-row'
                    >
                      {lag.lag_minutes}m: {formatEstimatorPercent(lag.rmse_pct)}{' '}
                      RMSE · {lag.trainable_interval_count.toLocaleString()}{' '}
                      trainable · {formatEstimatorStatusLabel(lag.status)}
                    </span>
                  ))
                )}
              </div>
              <div className='status-estimator-block'>
                <strong>Cache-read ratios</strong>
                {estimate.cache_read_ratios.length === 0 ? (
                  <span className='status-estimator-muted'>none</span>
                ) : (
                  estimate.cache_read_ratios.map((ratio) => (
                    <span
                      key={`${estimate.quota_lane}-${ratio.model_family}`}
                      className='status-estimator-row'
                    >
                      {ratio.model_family}:&nbsp;
                      {formatEstimatorNumber(
                        ratio.cache_read_vs_uncached_workload_ratio,
                        3
                      )}{' '}
                      ({formatEstimatorStatusLabel(ratio.status)})
                    </span>
                  ))
                )}
              </div>
              <div className='status-estimator-block'>
                <strong>Coefficients</strong>
                {coefficientGroups.length === 0 ? (
                  <span className='status-estimator-muted'>none</span>
                ) : (
                  coefficientGroups.map((group) => (
                    <div key={`${estimate.quota_lane}-${group.tokenCategory}`}>
                      <div className='status-estimator-token-category'>
                        {group.tokenCategory === 'workload_excluding_cache_read'
                          ? 'workload (uncached + output + cache create/write + reasoning)'
                          : 'cache read'}
                      </div>
                      {group.families.map((family) => (
                        <div
                          key={`${estimate.quota_lane}-${group.tokenCategory}-${family.modelFamily}`}
                          className='status-estimator-family'
                        >
                          <div className='status-estimator-family-name'>
                            {family.modelFamily}
                          </div>
                          {family.rows.map((row) => (
                            <span
                              key={`${row.feature}-${row.estimate_kind}`}
                              className='status-estimator-row'
                            >
                              {row.estimate_kind === 'rolling_exponential'
                                ? 'rolling'
                                : 'static'}
                              :{' '}
                              {formatEstimatorPercent(
                                row.coefficient_pct_per_mtok
                              )}{' '}
                              / M tok, CI{' '}
                              {formatEstimatorPercent(
                                row.confidence_low_pct_per_mtok
                              )}{' '}
                              to{' '}
                              {formatEstimatorPercent(
                                row.confidence_high_pct_per_mtok
                              )}{' '}
                              ({formatEstimatorStatusLabel(row.estimate_status)}
                              )
                            </span>
                          ))}
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
              <div className='status-estimator-block'>
                <strong>Diagnostics</strong>
                {estimate.diagnostics.length === 0 ? (
                  <span className='status-estimator-muted'>none</span>
                ) : (
                  estimate.diagnostics.map((diagnostic, diagnosticIndex) => (
                    <span
                      key={`${estimate.quota_lane}-${diagnostic.code}-${diagnosticIndex}`}
                      className='status-estimator-row'
                    >
                      {diagnostic.severity}: {diagnostic.code} ·{' '}
                      {diagnostic.detail}
                    </span>
                  ))
                )}
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}

function ProviderStatusLegend(): ReactElement {
  return (
    <div
      role='region'
      aria-label='Provider health and quota color legend'
      className='status-color-legend'
    >
      <span className='legend-group-label'>Health</span>
      {[
        ['ok', 'health-ok'],
        ['degraded', 'health-degraded'],
        ['down', 'health-down'],
        ['no data', 'health-no-data'],
        ['miss', 'health-miss'],
      ].map(([label, className]) => (
        <span className='status-legend-item' key={`health-${label}`}>
          <span
            aria-hidden='true'
            className={`status-legend-swatch ${className}`}
          />
          {label}
        </span>
      ))}
      <span className='legend-group-label'>Quota used</span>
      {[
        ['0-5', 'quota-0-5'],
        ['5-10', 'quota-5-10'],
        ['10-25', 'quota-10-25'],
        ['25-50', 'quota-25-50'],
        ['50+', 'quota-50-p'],
      ].map(([label, className]) => (
        <span className='status-legend-item' key={`quota-${label}`}>
          <span
            aria-hidden='true'
            className={`status-legend-swatch ${className}`}
          />
          {label}
        </span>
      ))}
      <span className='legend-group-label'>Burn</span>
      {[
        ['slow', 'velocity-slow'],
        ['steady', 'velocity-steady'],
        ['fast', 'velocity-fast'],
        ['hot', 'velocity-hot'],
        ['peak', 'velocity-peak'],
      ].map(([label, className]) => (
        <span className='status-legend-item' key={`velocity-${label}`}>
          <span
            aria-hidden='true'
            className={`status-legend-swatch ${className}`}
          />
          {label}
        </span>
      ))}
    </div>
  )
}

function pgBouncerStatusLabel(status: ShellPgBouncerSidecar['status']): string {
  switch (status) {
    case 'green':
      return 'ok'
    case 'yellow':
      return 'degraded'
    case 'red':
      return 'down'
  }
}

function pgBouncerStatusClass(status: ShellPgBouncerSidecar['status']): string {
  switch (status) {
    case 'green':
      return 'is-green'
    case 'yellow':
      return 'is-yellow'
    case 'red':
      return 'is-red'
  }
}

function formatPgBouncerWait(seconds: number, microseconds: number): string {
  if (seconds > 0) return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`
  if (microseconds > 0) return `${Math.round(microseconds).toLocaleString()}us`
  return '0s'
}

function formatPgBouncerBytes(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}GB`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}MB`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}KB`
  return `${Math.round(value).toString()}B`
}

function PgBouncerSidecarCard({
  sidecar,
}: {
  sidecar: ShellPgBouncerSidecar
}): ReactElement {
  const logConfig = sidecar.container.logConfig
  const pool = sidecar.admin.poolSummary
  const stats = sidecar.admin.statsSummary
  const servers = sidecar.admin.serverSummary
  const poolRows = sidecar.admin.pools.slice(0, 3)

  return (
    <article
      className={`pgbouncer-card ${pgBouncerStatusClass(sidecar.status)}`}
    >
      <div className='pgbouncer-card-head'>
        <div>
          <span className='pgbouncer-card-name'>{sidecar.label}</span>
          <span className='pgbouncer-card-sub'>{sidecar.containerName}</span>
        </div>
        <span className='pgbouncer-status-pill'>
          {pgBouncerStatusLabel(sidecar.status)}
        </span>
      </div>
      <div className='pgbouncer-metrics'>
        <span>
          clients <strong>{pool.clActive}</strong>/
          <strong>{pool.clWaiting}</strong>
        </span>
        <span>
          servers <strong>{pool.svActive}</strong>/
          <strong>{pool.svIdle}</strong>
        </span>
        <span>
          max wait{' '}
          <strong>
            {formatPgBouncerWait(pool.maxWaitSeconds, pool.maxWaitMicroseconds)}
          </strong>
        </span>
        <span>
          upstream <strong>{servers.total}</strong>
        </span>
      </div>
      <div className='pgbouncer-detail-grid'>
        <span>container</span>
        <strong>
          {sidecar.container.status ??
            (sidecar.container.present ? 'unknown' : 'missing')}
        </strong>
        <span>health</span>
        <strong>{sidecar.container.health ?? 'unknown'}</strong>
        <span>admin</span>
        <strong>{sidecar.admin.status}</strong>
        <span>traffic</span>
        <strong>
          {formatCompactQuantity(stats.totalXactCount)} tx /{' '}
          {formatCompactQuantity(stats.totalQueryCount)} q
        </strong>
        <span>bytes</span>
        <strong>
          {formatPgBouncerBytes(stats.totalReceived)} in /{' '}
          {formatPgBouncerBytes(stats.totalSent)} out
        </strong>
        <span>logs</span>
        <strong>
          {logConfig
            ? `${logConfig.type ?? 'unknown'} ${logConfig.maxSize ?? '?'} x${
                logConfig.maxFile ?? '?'
              }`
            : 'unknown'}
        </strong>
      </div>
      {poolRows.length > 0 ? (
        <div className='pgbouncer-pools' aria-label={`${sidecar.label} pools`}>
          {poolRows.map((row) => (
            <div
              className='pgbouncer-pool-row'
              key={`${sidecar.key}-${row.database}-${row.user}`}
            >
              <span>{row.database ?? 'unknown'}</span>
              <span>
                c {row.clActive}/{row.clWaiting} | s {row.svActive}/{row.svIdle}
              </span>
              <span>{row.poolMode ?? 'unknown'}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className='pgbouncer-empty'>
          {sidecar.admin.error ?? sidecar.container.error ?? 'no pool rows'}
        </div>
      )}
    </article>
  )
}

function PgBouncerHealthPanel({
  health,
  loading,
}: {
  health?: ShellPgBouncerHealth
  loading: boolean
}): ReactElement {
  const sidecars = health?.sidecars ?? []
  return (
    <section className='pgbouncer-health-panel' aria-label='PgBouncer health'>
      <div className='pgbouncer-panel-head'>
        <span>PgBouncer</span>
        <span className='pgbouncer-panel-status'>
          {loading ? 'updating' : (health?.status ?? 'unknown')}
        </span>
      </div>
      <div className='pgbouncer-grid'>
        {sidecars.length > 0 ? (
          sidecars.map((sidecar) => (
            <PgBouncerSidecarCard key={sidecar.key} sidecar={sidecar} />
          ))
        ) : (
          <div className='pgbouncer-empty'>no sidecars reported</div>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------

/**
 * Local fallback date range when PhosphorDashboard is rendered without
 * from/to props (e.g. in isolation / Storybook). Returns the last 30 days
 * through tomorrow — matching the operator-approved Wave 24-Index F3 default
 * in index.tsx. The previous 7-day value here was an undocumented divergence
 * (wave35-code-css-audit ⚠-7).
 */
// Skeleton helpers
// ---------------------------------------------------------------------------

interface SectionSkeletonProps {
  height?: number
}

/** A simple skeleton block used while data is loading. */
function SectionSkeleton({ height = 80 }: SectionSkeletonProps): ReactElement {
  return (
    <div
      aria-hidden='true'
      className='skeleton-block'
      style={{ height, borderRadius: 0 }}
    />
  )
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
 * under #models, standalone #health removed, side-by-side ledger+repo row at
 * ≥1600px via .ledger-repo-row CSS module class.
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
  showComparison = false,
  quotas: quotasProp,
  quotasFetching: quotasFetchingProp = false,
  quotaHistory: quotaHistoryProp,
  quotaHistoryFetching: quotaHistoryFetchingProp = false,
  quotaRangeHistory: quotaRangeHistoryProp,
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
  const internalQueryEnabled = reportProp === undefined
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
    queryFn: () =>
      fetchUsageReport({
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
      }),
    // Skip when the parent has already provided the report data.
    enabled: internalQueryEnabled,
    refetchInterval: LIVE_DASHBOARD_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
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

  // 15-C.5 / Wave 37 SF-1: Include resolvedFrom/resolvedTo in the queryKey so
  // the quotas query re-fetches when the user changes the date range. The
  // /api/shell/reports/quotas endpoint does not currently accept from/to params
  // (server-side it is a live snapshot from rate_limit_intervals). This wiring
  // ensures the query invalidates on period changes, ready for when the API
  // supports date-scoped quotas.
  //
  // Wave 37 SF-1: this query is ONLY used when PhosphorDashboard is rendered
  // in isolation (e.g. Storybook, tests) without a parent supplying `quotas`.
  // index.tsx hoists this query with the same prefix/date shape; the optional
  // cache-bust element is only populated by explicit refresh.
  const internalQuotasEnabled = quotasProp === undefined
  const {
    data: quotasData,
    isFetching: internalQuotasFetching,
    refetch: refetchInternalQuotas,
  } = useQuery({
    ...usageReportQuotasQueryOptions({
      from: resolvedFrom,
      to: resolvedTo,
      cacheBust: reportRefreshKey,
    }),
    // Skip when the parent has already provided quota rows.
    enabled: internalQuotasEnabled,
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
    staleTime: LIVE_DASHBOARD_REFETCH_INTERVAL_MS,
    refetchInterval: false,
    refetchIntervalInBackground: true,
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
    enabled: providerSectionView === 'health',
    staleTime: 15_000,
    refetchInterval: LIVE_DASHBOARD_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
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
      filters?.providers,
      filters?.repositories,
      filters?.clients,
      filters?.environments,
      filters?.models,
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
    staleTime: LIVE_DASHBOARD_REFETCH_INTERVAL_MS,
    refetchInterval: false,
    refetchIntervalInBackground: true,
  })

  const anomalies = useAnomalyDetection(
    (report?.providerLatencyHealth ?? []).filter(
      (r): r is typeof r & { bucket_start: string } => r.bucket_start !== null
    ),
    report?.metadata
  )

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
  } = useQuery({
    queryKey: [
      'usage-report-token-trend-summary',
      tokenTrendScopeKey,
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
    staleTime: LIVE_DASHBOARD_REFETCH_INTERVAL_MS,
    refetchInterval: LIVE_DASHBOARD_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
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
  const tokenTrendHealthRows = useMemo(
    () =>
      tokenTrendSummaryData?.tokenTrendHealth ??
      report?.tokenTrendHealth ??
      report?.providerLatencyHealth ??
      [],
    [
      tokenTrendSummaryData?.tokenTrendHealth,
      report?.tokenTrendHealth,
      report?.providerLatencyHealth,
    ]
  )
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

  const tokenTrendDayEnvelopes = useMemo(
    () =>
      buildTokenTrendDayEnvelopes(
        tokenTrendSummaryData?.tokenTrendHours ?? report?.tokenTrendHours ?? []
      ),
    [tokenTrendSummaryData?.tokenTrendHours, report?.tokenTrendHours]
  )
  const tokenTrendRequestDayEnvelopes = useMemo(
    () =>
      buildTokenTrendDayEnvelopes(
        tokenTrendSummaryData?.tokenTrendHours ?? report?.tokenTrendHours ?? [],
        'requests'
      ),
    [tokenTrendSummaryData?.tokenTrendHours, report?.tokenTrendHours]
  )
  const tokenTrendToolDayEnvelopes = useMemo(
    () =>
      buildTokenTrendDayEnvelopes(
        tokenTrendSummaryData?.tokenTrendHours ?? report?.tokenTrendHours ?? [],
        'tools'
      ),
    [tokenTrendSummaryData?.tokenTrendHours, report?.tokenTrendHours]
  )

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

  const {
    data: tokenTrendDayDetailData,
    isFetching: tokenTrendDayDetailFetching,
    refetch: refetchTokenTrendDayDetail,
  } = useQuery({
    queryKey: [
      'usage-report-token-trend-day',
      tokenTrendScopeKey,
      tokenTrendDetailRequest,
      resolvedFrom,
      resolvedTo,
      filters?.providers,
      filters?.repositories,
      filters?.clients,
      filters?.environments,
      filters?.models,
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
    staleTime: LIVE_DASHBOARD_REFETCH_INTERVAL_MS,
    refetchInterval:
      tokenTrendDetailRequest !== null
        ? LIVE_DASHBOARD_REFETCH_INTERVAL_MS
        : false,
    refetchIntervalInBackground: true,
  })

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
    staleTime: LIVE_DASHBOARD_REFETCH_INTERVAL_MS,
    refetchInterval: LIVE_DASHBOARD_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
  })

  const providers = useMemo(() => deriveProviders(), [])

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

  const quotaRangeHistoryByProvider = useMemo(() => {
    const map = new Map<string, UsageReportQuotaHistoryRow[]>()
    for (const row of quotaRangeHistoryProp ??
      report?.quotaRangeHistory ??
      []) {
      const provider = canonicalProvider(row.provider)
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
        report?.providerStatusUsage ?? [],
        report?.providerLatencyHealth ?? [],
        report?.rows ?? [], // 15-B.3: real token_in/token_out
        quotaRows, // 15-B.5: quota_pct from quota rows
        report?.trend ?? [], // Wave 30 Track 4: real 24h sparkline data
        toolActivityData?.toolActivity ?? report?.toolActivity ?? [] // W33: tool activity for TOOL cell hover
      ),
    [
      report?.providerStatusUsage,
      report?.providerLatencyHealth,
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

  const providerStatusUsage = useMemo(
    () => report?.providerStatusUsage ?? [],
    [report?.providerStatusUsage]
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
    ],
    queryFn: () =>
      fetchUsageReport({
        from: priorFrom,
        to: priorTo,
        grain: resolvedGrain,
        groupBy: ['provider', 'model', 'repository'],
        provider: filters?.providers,
        repository: filters?.repositories,
        client: filters?.clients,
        environment: filters?.environments,
        model: filters?.models,
      }),
    // Only fire once the current report is available AND the ComparisonPanel is
    // visible (viewport ≥3840px). At 2275 and 5120 the panel is hidden so the
    // prior-window DB query is skipped entirely, saving a sequential waterfall
    // that previously added 20–30 s to the cold-load experience.
    enabled: !reportLoading && report !== undefined && showComparison,
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
    await refetchInternalQuotas()
  }, [onRefreshQuotas, refetchInternalQuotas])

  const refreshQuotaHistory = useCallback(async (): Promise<void> => {
    if (onRefreshQuotaHistory !== undefined) {
      await onRefreshQuotaHistory()
      return
    }
    await refetchInternalQuotaHistory()
  }, [onRefreshQuotaHistory, refetchInternalQuotaHistory])

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

  const refreshStatusSection = useCallback(async (): Promise<void> => {
    if (providerSectionView === 'quota') {
      await Promise.all([refreshQuotas(), refreshQuotaRangeHistory()])
      return
    }
    if (providerSectionView === 'weights') {
      await refreshQuotaEstimator()
      return
    }
    await Promise.all([
      refreshReport(),
      refreshQuotas(),
      refreshQuotaHistory(),
      refetchShellHealth(),
    ])
  }, [
    providerSectionView,
    refetchShellHealth,
    refreshQuotaEstimator,
    refreshQuotaHistory,
    refreshQuotaRangeHistory,
    refreshQuotas,
    refreshReport,
  ])

  const refreshTokenSection = useCallback(async (): Promise<void> => {
    const refreshes: Promise<unknown>[] = [
      refreshReport(),
      refetchTokenTrendSummary(),
    ]
    if (tokenTrendDetailRequest !== null) {
      refreshes.push(refetchTokenTrendDayDetail())
    }
    await Promise.all(refreshes)
  }, [
    refreshReport,
    refetchTokenTrendSummary,
    refetchTokenTrendDayDetail,
    tokenTrendDetailRequest,
  ])

  const refreshComparisonSection = useCallback(async (): Promise<void> => {
    await Promise.all([refreshReport(), refetchPriorReport()])
  }, [refreshReport, refetchPriorReport])

  const refreshLedgerSection = useCallback(async (): Promise<void> => {
    await Promise.all([refreshReport(), refetchToolActivity()])
  }, [refreshReport, refetchToolActivity])

  const statusUpdating =
    providerSectionView === 'quota'
      ? quotasFetching || quotaRangeHistoryFetching
      : providerSectionView === 'weights'
        ? quotaEstimatorFetching
        : reportFetching ||
          quotasFetching ||
          quotaHistoryFetching ||
          shellHealthFetching
  const reportUpdating = reportFetching || toolActivityFetching
  const tokenTrendUpdating =
    reportFetching || tokenTrendSummaryFetching || tokenTrendDayDetailFetching
  const comparisonUpdating = reportFetching || priorReportFetching

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
                { value: 'quota', label: 'Quota' },
                { value: 'weights', label: 'Weights' },
              ]}
              onChange={setProviderSectionView}
            />
          }
          accessory={
            <div className='section-title-tools'>
              <ProviderStatusLegend />
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
        {reportLoading ? (
          <SectionSkeleton height={120} />
        ) : providerSectionView === 'health' ? (
          <>
            <PgBouncerHealthPanel
              health={shellHealthData?.pgBouncerSidecars}
              loading={shellHealthFetching}
            />
            <div
              className={`provider-summary ${styles['provider-summary-grid']}`}
            >
              {providers.map((provider) => {
                const config: ProviderCardConfig = {
                  provider,
                  // Wave 12 Fix 1: use reference brand hex for card header name color
                  color: providerBrandHex(provider),
                }
                const metrics = buildProviderMetrics(
                  provider,
                  healthRows,
                  report?.rows ?? []
                )
                const cells = padHealthCells(
                  healthRows,
                  provider,
                  providerErrorObservations
                )
                // Wave 41: build structured QuotaLane[] for providers with lane
                // definitions. Each lane groups
                // the current bar + prior bars for a single quota type side-by-side.
                // Providers without lane defs (nvidia_nim, local) are not
                // rendered in the status grid (no lane defs = no quota bars).
                const lanes = buildProviderLanes(
                  provider,
                  quotaRows,
                  quotaHistoryRows
                )
                const topModels = buildTopModels(
                  providerStatusUsage,
                  provider,
                  healthRows
                )

                return (
                  <ProviderCard
                    key={provider}
                    config={config}
                    data={metrics}
                    healthCells={cells}
                    quotas={[]}
                    lanes={lanes.length > 0 ? lanes : undefined}
                    anomalies={anomalies}
                    topModels={topModels}
                    localHealthItems={
                      provider === 'local' ? (report?.localHealth ?? []) : []
                    }
                  />
                )
              })}
              {/* D3: AggregateCard as 8th peer — Σ Aggregate Totals in the provider row */}
              <AggregateCard
                config={aggregateConfig}
                data={aggregateMetrics}
                healthCells={aggregateHealthCells}
                fleetActivity={{
                  toolCalls: summary?.tool_calls ?? 0,
                  gitCommits: summary?.git_commit ?? 0,
                  gitPushes: summary?.git_push ?? 0,
                  invalidToolCalls: 0,
                }}
                anomalies={anomalies}
              />
            </div>
          </>
        ) : providerSectionView === 'quota' ? (
          <div
            className={`provider-summary provider-quota-summary ${styles['provider-summary-grid']}`}
          >
            {providers.map((provider) => (
              <ProviderQuotaHistoryBucket
                key={`quota-${provider}`}
                provider={provider}
                rows={quotaRangeHistoryByProvider.get(provider) ?? []}
                rangeFrom={resolvedFrom}
                rangeTo={resolvedTo}
              />
            ))}
          </div>
        ) : (
          <QuotaEstimatorWeightsPanel
            response={quotaEstimatorData}
            loading={quotaEstimatorLoading || quotaEstimatorFetching}
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
            <SectionRefreshButton
              label='Refresh Token Trend data'
              updating={tokenTrendUpdating}
              onRefresh={refreshTokenSection}
            />
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
            dayDetail={tokenTrendDayDetailData}
            detailLoading={tokenTrendDayDetailFetching}
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
      {/* D19: hidden by default; CSS module shows at ≥3840px */}
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
    </div>
  )
}
