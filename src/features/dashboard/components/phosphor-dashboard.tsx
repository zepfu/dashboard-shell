/**
 * PhosphorDashboard — Wave 9 reference-parity integration component.
 *
 * Composes the full set of Phosphor Atlas components into five anchored
 * sections that match the AnchorBar shortcuts:
 *   status → tokens → models → repos → clients
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
 * - Section order: status → tokens → [models+repos row] → clients.
 * - models+repos wrapped in .ledger-repo-row: side-by-side 8fr/4fr at ≥1600px.
 * - Section titles: Models→Model Ledger, Repos→Repository Breakdown,
 *   Clients→Client Usage.
 *
 * Data is fetched via fetchUsageReport + fetchUsageReportQuotas; anomaly
 * flags come from useAnomalyDetection.
 */
import { useEffect, useMemo, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  fetchUsageReport,
  fetchUsageReportQuotas,
  type UsageReportProviderErrorObservationRow,
  type UsageReportProviderLatencyHealthRow,
  type UsageReportQuotaHistoryRow,
  type UsageReportQuotaRow,
  type UsageReportQuotaUsageBreakdown,
  type UsageReportResponse,
  type UsageReportRow,
  type UsageReportSummary,
  type UsageReportToolActivityRow,
  type UsageReportTrendRow,
  type UsageReportGrain,
} from '../api/usage-report'
import { useAnomalyDetection } from '../hooks/use-anomaly-detection'
import { CLIENT_BRAND_COLORS } from '../lib/client-brand-colors'
import { normalizeTrendData } from '../lib/trend-utils'
import {
  canonicalProvider,
  clientColorFor,
  computeFleetErrors,
  computeFleetP95,
  PROVIDER_BRAND_HEX,
  providerAliases,
  providerBrandHex,
} from '../lib/usage-report-display'
import { AggregateCard } from './aggregate-card'
import { ClientBreakdownTable, type ClientRow } from './client-breakdown-table'
import {
  buildCurrentStats,
  ComparisonPanel,
  type ProviderCurrentStats,
} from './comparison-panel'
import { DonutChart, type SliceConfig } from './donut-chart'
import {
  buildToolActivity,
  MasterLedgerTable,
  type ModelRow,
} from './master-ledger-table'
import styles from './phosphor-dashboard.module.css'
import { type CellDef, type HealthStripEvent } from './primitives/health-strip'
import {
  ProviderCard,
  type ProviderCardConfig,
  type ProviderMetrics,
  type QuotaBarGroup,
  type QuotaLane,
  type QuotaRowConfig,
  type QuotaTipModel,
  type TopModelRow,
} from './provider-card'
import { RepoBreakdownTable, type RepoRow } from './repo-breakdown-table'
import { type SlicerFilters, type SlicerOptions } from './slicer-bar'
import { TokenTrendChart, type ProviderSeries } from './token-trend-chart'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Cell count expected by HealthStrip inside ProviderCard. */
const HEALTH_CELL_COUNT = 288

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
    key: 'xai',
    label: 'xAI',
    // W28-TrendVisual Track A: was '#f5f5f5' (near-white, visually problematic).
    // Changed to '#475569' to match PROVIDER_BRAND_HEX.xai for brand-color
    // visibility per operator request (W26-Research Track A recommendation).
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
}

// ---------------------------------------------------------------------------
// Section title style helper
// ---------------------------------------------------------------------------

/** Returns a consistent section-title <h2> element matching v9.7 spec. */
function SectionTitle({
  id,
  children,
}: {
  id: string
  children: string
}): ReactElement {
  return (
    <h2
      id={id}
      className='section-title'
      style={{
        fontSize: 'clamp(10px, 0.6vw, 18px)',
        color: 'var(--accent-chrome)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        fontWeight: 600,
        marginBottom: '6px',
        borderBottom: '1px solid var(--border)',
        paddingBottom: '4px',
      }}
    >
      {children}
    </h2>
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
function _localFallbackRange(): { from: string; to: string } {
  const now = new Date()
  const from = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 30)
  )
  const to = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  )
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  }
}

/**
 * Pads or truncates a health cell array to exactly HEALTH_CELL_COUNT entries.
 * Missing cells are filled with a neutral muted color.
 *
 * Wave 24-PhosphorDash (operator F1a): wires CellDef hover metadata —
 * `bucketStart` from health row bucket_start, `eventCount` from aggregate
 * error/timeout/rate-limit/capacity counts, and `events: []` (no per-event
 * detail is available at health-row granularity from the API).
 *
 * Wave 30-Track5: The API returns multiple rows per 5-minute bucket (one per
 * environment × model × model_group tuple). Prior code mapped every row to its
 * own cell, inflating the cell count and causing the tail-slice to discard the
 * newest buckets. Fix: collapse rows by bucket_start first (Step 1), then emit
 * one CellDef per bucket using max p95 / summed error counts (Step 2). The
 * resulting array is reversed to ASC order (oldest → newest) so that the strip
 * renders correctly with the oldest cell on the left (-24h) and the newest on
 * the right (now).
 */
function padHealthCells(
  rows: UsageReportProviderLatencyHealthRow[],
  provider: string
): CellDef[] {
  // 15-B.2: use alias map so 'google' also picks up 'gemini' health rows
  const aliases = providerAliases(provider)
  const providerRows = rows.filter((r) =>
    aliases.includes(r.provider.toLowerCase())
  )
  // Satisfy the HealthStripEvent[] type even though we have no per-event data.
  const emptyEvents: HealthStripEvent[] = []

  // Wave 30-Track5 Step 1: group rows by bucket_start.
  // The API arrives bucket_start DESC (newest first); Map insertion order
  // preserves that ordering within each group.
  // Rows with null/undefined bucket_start get a synthetic key so they are
  // not incorrectly merged with each other or with valid buckets.
  const bucketMap = new Map<string, UsageReportProviderLatencyHealthRow[]>()
  providerRows.forEach((row, idx) => {
    const key =
      row.bucket_start != null
        ? String(row.bucket_start)
        : `__missing_${idx.toString()}__`
    const group = bucketMap.get(key)
    if (group !== undefined) {
      group.push(row)
    } else {
      bucketMap.set(key, [row])
    }
  })

  // Wave 30-Track5 Step 2: emit one CellDef per bucket group.
  // Aggregation rules:
  //   rawP95Ms      = max non-null upstream_p95_ms across group (null if all null)
  //   eventCount    = sum of all error-class counters (undefined when total = 0)
  //   rawErrorCount = same numeric total, defaults to 0 (not undefined)
  //   rawErrorBreakdown = per-class sums (undefined when eventCount = 0)
  // Ordering: bucketMap iterates in insertion order = DESC (newest first).
  const cellsDesc: CellDef[] = Array.from(bucketMap.values()).map((group) => {
    // Max non-null p95 across all tuples in this bucket.
    let maxP95: number | null = null
    for (const r of group) {
      if (r.upstream_p95_ms !== null) {
        maxP95 =
          maxP95 === null
            ? r.upstream_p95_ms
            : Math.max(maxP95, r.upstream_p95_ms)
      }
    }

    // Summed error-class counters.
    let sumProviderError = 0
    let sum5xx = 0
    let sumTimeout = 0
    let sumNetwork = 0
    let sumRateLimit = 0
    let sumCapacity = 0
    for (const r of group) {
      sumProviderError += r.provider_error_events
      sum5xx += r.provider_5xx_events
      sumTimeout += r.provider_timeout_events
      sumNetwork += r.network_error_events
      sumRateLimit += r.rate_limit_events
      sumCapacity += r.capacity_events
    }
    const eventCount =
      sumProviderError +
      sum5xx +
      sumTimeout +
      sumNetwork +
      sumRateLimit +
      sumCapacity

    // Wave 29-E2 (Track 6): pass the per-type breakdown to CellDef so
    // buildCellTooltip can render labeled rows instead of the generic placeholder.
    // Undefined when no errors occurred in the bucket (avoids an empty breakdown
    // object reaching the tooltip renderer for clean error-free buckets).
    const rawErrorBreakdown: CellDef['rawErrorBreakdown'] =
      eventCount > 0
        ? {
            provider_error_events: sumProviderError,
            provider_5xx_events: sum5xx,
            provider_timeout_events: sumTimeout,
            network_error_events: sumNetwork,
            rate_limit_events: sumRateLimit,
            capacity_events: sumCapacity,
          }
        : undefined

    // First non-null bucket_start in the group (all rows in the group share
    // the same bucket_start when the key is not synthetic).
    const bucketStart = group.find((r) => r.bucket_start != null)?.bucket_start

    return {
      // Wave 25-PhosphorDash (F#11): neutral fallback color; deriveCellStyle
      // path-2 now drives coloring from rawP95Ms / rawErrorCount via the W24
      // percentile recalibration (absolute-threshold function removed W34).
      color: 'var(--card-2)',
      // F1a: bucket_start drives the relative-time header in buildCellTooltip.
      bucketStart: bucketStart ?? undefined,
      // F1a: total events in this bucket (errors + timeouts + rate-limits + capacity).
      eventCount: eventCount > 0 ? eventCount : undefined,
      // F1a: no per-event JSON available at health-row granularity; pass empty
      // array so W24-HealthStrip's buildCellTooltip renders a summary-only tooltip.
      events: emptyEvents,
      // Wave 25-PhosphorDash (F#11): wire upstream p95 so deriveCellStyle path-2
      // (percentile-relative thresholds) is activated instead of falling through
      // to the legacy color fallback. null when the bucket has no latency data,
      // which deriveCellStyle handles as a cat-miss cell.
      rawP95Ms: maxP95,
      // Wave 25-PhosphorDash (F#11): wire raw error count for the amber trigger
      // in deriveCellStyle (any error event → amber regardless of p95).
      rawErrorCount: eventCount > 0 ? eventCount : 0,
      // Wave 29-E2 (Track 6): per-type error breakdown for hover tooltip.
      rawErrorBreakdown,
    }
  })

  // Wave 30-Track5: rows arrived DESC (newest first); reverse to ASC so that
  // cells[0] = oldest bucket (left / top of strip, labelled "-24h") and
  // cells[N-1] = newest bucket (right / bottom, labelled "now"). This ensures
  // the tail-slice below keeps the newest HEALTH_CELL_COUNT buckets and the
  // strip's left-to-right / top-to-bottom axis matches the time direction.
  const cells = cellsDesc.reverse()

  if (cells.length >= HEALTH_CELL_COUNT) {
    return cells.slice(cells.length - HEALTH_CELL_COUNT)
  }

  const pad = Array.from<CellDef>({
    length: HEALTH_CELL_COUNT - cells.length,
  }).fill({
    color: 'var(--card-2)',
    events: emptyEvents,
  })
  return [...pad, ...cells]
}

/**
 * Builds ProviderMetrics from latency health rows and per-row usage data for
 * a specific provider.
 *
 * Wave 11 PR2 (11-g): token_in / token_out / usd_cost / traces and cache /
 * reasoning fields are now aggregated from `rows` (UsageReportRow[]) filtered
 * to the matching provider, resolving the $0 / 0-tokens bug.
 */
function buildProviderMetrics(
  provider: string,
  healthRows: UsageReportProviderLatencyHealthRow[],
  rows: UsageReportRow[]
): ProviderMetrics {
  // 15-B.2: expand canonical provider key to all DB aliases
  // (e.g. 'google' → ['google','gemini'] so gemini health rows are included)
  const aliases = providerAliases(provider)
  const providerHealthRows = healthRows.filter((r) =>
    aliases.includes(r.provider.toLowerCase())
  )
  const providerUsageRows = rows.filter((r) =>
    aliases.includes((r.provider ?? '').toLowerCase())
  )

  const requests = providerHealthRows.reduce((s, r) => s + r.requests, 0)
  const errors = providerHealthRows.reduce(
    (s, r) =>
      s +
      r.provider_error_events +
      r.provider_5xx_events +
      r.provider_timeout_events +
      r.network_error_events,
    0
  )

  // 15-B.1: providerLatencyHealth is ordered bucket_start DESC (newest first).
  // The original code used `[length - 1]` (oldest row), which consistently
  // has upstream_p95_ms = null (no-traffic tail buckets). Fix: scan from
  // index 0 (most-recent) and pick the first row with a non-null p95.
  const latestP95Row = providerHealthRows.find(
    (r) => r.upstream_p95_ms !== null
  )
  const p95 = latestP95Row?.upstream_p95_ms ?? 0

  // Wave 14-C: rate_limits, capacity from health rows; packet_loss from ping probe.
  const rate_limits = providerHealthRows.reduce(
    (s, r) => s + r.rate_limit_events,
    0
  )
  const capacity = providerHealthRows.reduce((s, r) => s + r.capacity_events, 0)
  // Use average packet loss across all health rows that have data; null if none probed.
  const packetLossValues = providerHealthRows
    .map((r) => r.provider_ping_packet_loss_pct)
    .filter((v): v is number => v !== null)
  const packet_loss_pct =
    packetLossValues.length > 0
      ? packetLossValues.reduce((s, v) => s + v, 0) / packetLossValues.length
      : null

  // Aggregate per-provider token / cost / cache / reasoning from usage rows
  const tokens_in = providerUsageRows.reduce((s, r) => s + (r.token_in ?? 0), 0)
  const tokens_out = providerUsageRows.reduce(
    (s, r) => s + (r.token_out ?? 0),
    0
  )
  const cost_usd = providerUsageRows.reduce((s, r) => s + (r.usd_cost ?? 0), 0)
  const traces = providerUsageRows.reduce((s, r) => s + (r.traces ?? 0), 0)
  const cache_input = providerUsageRows.reduce(
    (s, r) => s + (r.token_cache_input ?? 0),
    0
  )
  const cache_creation = providerUsageRows.reduce(
    (s, r) => s + (r.token_cache_creation ?? 0),
    0
  )
  // Wave 14-C: cache_miss_usd from cache_miss_usd_cost API field (dollar cost of misses).
  const cache_miss_usd = providerUsageRows.reduce(
    (s, r) => s + (r.cache_miss_usd_cost ?? 0),
    0
  )
  const reasoning_reported = providerUsageRows.reduce(
    (s, r) => s + (r.token_reasoning_reported ?? 0),
    0
  )
  const reasoning_estimated = providerUsageRows.reduce(
    (s, r) => s + (r.token_reasoning_estimated ?? 0),
    0
  )
  // TODO: API doesn't expose no_reasoning_calls yet — wired as zero.
  // reasoning_tokens_sources field exists but holds a JSON string, not a count.
  const no_reasoning_calls = 0

  return {
    tokens_in,
    tokens_out,
    cost_usd,
    requests,
    errors,
    p95_ms: p95,
    cache_input,
    cache_creation,
    cache_miss_usd,
    reasoning_reported,
    reasoning_estimated,
    no_reasoning_calls,
    traces,
    rate_limits,
    capacity,
    packet_loss_pct,
  }
}

/**
 * Builds aggregate ProviderMetrics by summing across all providers.
 *
 * Wave 11 PR2 (11-g item 4): token / cost / cache / reasoning totals were
 * previously derived from `rows` (all UsageReportRow entries). However, the
 * server caps `report.rows` at 500 entries, causing systematic 20-30%
 * undercounts in the Aggregate card when real usage exceeds 500 rows.
 *
 * Wave 16-D: restores summary-based aggregation for token / cost / cache /
 * reasoning / trace totals. `report.summary` is computed server-side from the
 * full untruncated dataset, so it always matches the KPI strip values.
 * Health-derived metrics (requests, errors, p95_ms, rate_limits, capacity,
 * packet_loss_pct) are unaffected — they come from health rows, not usage rows.
 */
function buildAggregateMetrics(
  healthRows: UsageReportProviderLatencyHealthRow[],
  summary: UsageReportSummary | undefined
): ProviderMetrics {
  const requests = healthRows.reduce((s, r) => s + r.requests, 0)
  const errors = healthRows.reduce(
    (s, r) =>
      s +
      r.provider_error_events +
      r.provider_5xx_events +
      r.provider_timeout_events +
      r.network_error_events,
    0
  )
  // Fleet-wide P95: pick max P95 across all health rows
  const p95Values = healthRows
    .map((r) => r.upstream_p95_ms)
    .filter((v): v is number => v !== null)
  const p95 = p95Values.length > 0 ? Math.max(...p95Values) : 0

  // Wave 14-C: aggregate rate_limits, capacity, packet_loss across all health rows.
  const rate_limits = healthRows.reduce((s, r) => s + r.rate_limit_events, 0)
  const capacity = healthRows.reduce((s, r) => s + r.capacity_events, 0)
  const packetLossValues = healthRows
    .map((r) => r.provider_ping_packet_loss_pct)
    .filter((v): v is number => v !== null)
  const packet_loss_pct =
    packetLossValues.length > 0
      ? packetLossValues.reduce((s, v) => s + v, 0) / packetLossValues.length
      : null

  // Wave 16-D: use summary (server-side full-dataset totals) to avoid the
  // row-cap undercount. When summary is undefined (data still loading), return
  // zeros for these fields.
  const tokens_in = summary?.token_in ?? 0
  const tokens_out = summary?.token_out ?? 0
  const cost_usd = summary?.usd_cost ?? 0
  const traces = summary?.traces ?? 0
  const cache_input = summary?.token_cache_input ?? 0
  const cache_creation = summary?.token_cache_creation ?? 0
  // Wave 14-C: cache_miss_usd from summary's cache_miss_usd_cost field.
  const cache_miss_usd = summary?.cache_miss_usd_cost ?? 0
  const reasoning_reported = summary?.token_reasoning_reported ?? 0
  const reasoning_estimated = summary?.token_reasoning_estimated ?? 0
  // TODO: API doesn't expose no_reasoning_calls yet — wired as zero.
  const no_reasoning_calls = 0

  return {
    tokens_in,
    tokens_out,
    cost_usd,
    requests,
    errors,
    p95_ms: p95,
    cache_input,
    cache_creation,
    cache_miss_usd,
    reasoning_reported,
    reasoning_estimated,
    no_reasoning_calls,
    traces,
    rate_limits,
    capacity,
    packet_loss_pct,
  }
}

/**
 * Maps a consumed-percent value to the appropriate iv-* threshold CSS class.
 *
 * Wave 11 PR3 (11-h): classes now key on consumed% (100 − remaining%) so
 * colours align with intuitive severity — high consumption = red/amber.
 *   <5%  consumed → iv-0-5  (dim cool — nearly empty bar)
 *   5–10%         → iv-5-10 (cool blue)
 *   10–25%        → iv-10-25 (teal)
 *   25–50%        → iv-25-50 (amber)
 *   ≥50%          → iv-50-p  (red — more than half consumed)
 */
function ivClassForConsumed(consumedPct: number): string {
  if (consumedPct >= 50) return 'iv-50-p'
  if (consumedPct >= 25) return 'iv-25-50'
  if (consumedPct >= 10) return 'iv-10-25'
  if (consumedPct >= 5) return 'iv-5-10'
  return 'iv-0-5'
}

/**
 * Builds 12 equal QuotaRowConfig segments for a single quota interval row,
 * with a VISIBLE COLOR GRADIENT across segments.
 *
 * Wave 11 PR3 (11-h): emitted 12 entries all sharing the SAME iv-* class —
 * visually a single solid-colored bar, NOT the rainbow strip the reference
 * shows (operator complaint #8 not fully addressed).
 *
 * Wave 12 Fix 5: each segment now gets its OWN severity class based on its
 * relative position in the consumption window:
 *   - Segments before the "now" cursor (already consumed) use a deeper class
 *     based on overall consumed% severity.
 *   - The "now" cursor segment uses iv-5-10 (transition color).
 *   - Segments after the cursor (remaining quota) use iv-0-5 (dim/cool).
 *
 * This produces a visible left→right color gradient: deeper on the consumed
 * side, lighter on the remaining side, matching the reference's rainbow strip
 * appearance even without real time-bucket backend data.
 */
function buildQuotaSegments(remainingPct: number): QuotaRowConfig[] {
  const consumedPct = Math.max(0, Math.min(100, 100 - remainingPct))
  const SEGMENTS = 12
  const highVelocityIdx = Math.min(
    SEGMENTS - 1,
    Math.floor((consumedPct / 100) * SEGMENTS)
  )

  // Severity class for the consumed portion — based on overall consumed level
  const consumedClass = ivClassForConsumed(consumedPct)

  return Array.from({ length: SEGMENTS }, (_, i) => {
    let severityClass: string
    if (i < highVelocityIdx) {
      // Fully consumed segment: use the overall consumed severity
      severityClass = consumedClass
    } else if (i === highVelocityIdx) {
      // Transition "now" segment: one step lighter to mark the boundary
      severityClass = 'iv-5-10'
    } else {
      // Unconsumed remaining quota: dim cool
      severityClass = 'iv-0-5'
    }
    return {
      widthPct: 100 / SEGMENTS,
      severityClass,
      highVelocity: i === highVelocityIdx,
    }
  })
}

/**
 * Builds QuotaBarGroup[] from all quota rows for a single provider.
 *
 * Wave 11 PR3 (11-h): replaces the legacy flat QuotaRowConfig[] return.
 * Each active interval type (weekly, short, special, monthly) produces one
 * QuotaBarGroup whose `segments` field holds the 12-segment array.
 */
function buildQuotaIntervals(
  quotaRows: UsageReportQuotaRow[],
  provider: string
): QuotaBarGroup[] {
  const providerQuotas = quotaRows.filter(
    (r) => r.provider.toLowerCase() === provider.toLowerCase()
  )
  if (providerQuotas.length === 0) return []

  const result: QuotaBarGroup[] = []
  for (const row of providerQuotas) {
    // F-QB-1 / 15-B.10: Added short_special so openai's exhausted
    // short_special_remaining_pct=0 (and similar) is rendered.
    // Wave 35 S4: include intervalStart so tipVelocity can be derived.
    const candidates = [
      {
        remainingPct: row.weekly_remaining_pct,
        active: row.weekly_active,
        label: 'Weekly',
        resetAt: row.weekly_reset_at ?? undefined,
        usedTokens: row.weekly_usage_tokens,
        intervalStart: row.weekly_interval_start,
      },
      {
        remainingPct: row.short_remaining_pct,
        active: row.short_active,
        label: 'Short',
        resetAt: row.short_reset_at ?? undefined,
        usedTokens: row.short_usage_tokens,
        intervalStart: row.short_interval_start,
      },
      {
        remainingPct: row.special_remaining_pct,
        active: row.special_active,
        label: 'Special',
        resetAt: row.special_reset_at ?? undefined,
        usedTokens: row.special_usage_tokens,
        intervalStart: row.special_interval_start,
      },
      {
        remainingPct: row.short_special_remaining_pct,
        active: row.short_special_active,
        label: 'Short-Special',
        resetAt: row.short_special_reset_at ?? undefined,
        usedTokens: row.short_special_usage_tokens,
        intervalStart: row.short_special_interval_start,
      },
      {
        remainingPct: row.monthly_remaining_pct,
        active: row.monthly_active,
        label: 'Monthly',
        resetAt: row.monthly_reset_at ?? undefined,
        usedTokens: row.monthly_usage_tokens,
        intervalStart: row.monthly_interval_start,
      },
    ]

    for (const candidate of candidates) {
      if (!candidate.active || candidate.remainingPct === null) continue
      const consumedPct = Math.max(
        0,
        Math.min(100, 100 - candidate.remainingPct)
      )
      result.push({
        label: candidate.label,
        consumedPct,
        remainingPct: candidate.remainingPct,
        resetAt: candidate.resetAt,
        segments: buildQuotaSegments(candidate.remainingPct),
        // Wave 35 S4: derive velocity from (consumedPct / hoursElapsed).
        tipVelocity: formatTipVelocity(consumedPct, candidate.intervalStart),
      })
    }
  }

  return result
}

/**
 * Classifies a raw model string into a Google quota class label.
 *
 * API quota rows for Google have model names like 'gemini-2.5-pro',
 * 'gemini-3-pro-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', etc.
 * The mockup aggregates these into three display classes per F1:
 *   gemini-*-pro*  → 'gemini-pro'
 *   gemini-*-flash-lite* → 'gemini-flash-lite'
 *   gemini-*-flash* → 'gemini-flash'  (must be checked AFTER flash-lite)
 *
 * Returns null for non-gemini or unrecognised model strings.
 */
function classifyGeminiModel(model: string): string | null {
  const lower = model.toLowerCase()
  if (!lower.startsWith('gemini-')) return null
  if (lower.includes('flash-lite')) return 'gemini-flash-lite'
  if (lower.includes('flash')) return 'gemini-flash'
  if (lower.includes('pro')) return 'gemini-pro'
  return null
}

/**
 * Returns the best single remaining-pct from an active interval, given:
 *   - short  → '5h'
 *   - weekly → '7d'
 *   - special → '5h' (same period bucket; takes priority over short when active)
 *   - short_special → '5h'
 *   - monthly → 'monthly'
 *   - short → '24h' (for Google — caller maps intervals to display labels)
 *
 * Used by buildQuotaRows to extract single-interval bars per provider.
 */
function extractInterval(
  row: UsageReportQuotaRow,
  interval: 'short' | 'weekly' | 'special' | 'short_special' | 'monthly'
): { remainingPct: number; resetAt: string | undefined } | null {
  switch (interval) {
    case 'short':
      if (!row.short_active || row.short_remaining_pct === null) return null
      return {
        remainingPct: row.short_remaining_pct,
        resetAt: row.short_reset_at ?? undefined,
      }
    case 'weekly':
      if (!row.weekly_active || row.weekly_remaining_pct === null) return null
      return {
        remainingPct: row.weekly_remaining_pct,
        resetAt: row.weekly_reset_at ?? undefined,
      }
    case 'special':
      if (!row.special_active || row.special_remaining_pct === null) return null
      return {
        remainingPct: row.special_remaining_pct,
        resetAt: row.special_reset_at ?? undefined,
      }
    case 'short_special':
      if (!row.short_special_active || row.short_special_remaining_pct === null)
        return null
      return {
        remainingPct: row.short_special_remaining_pct,
        resetAt: row.short_special_reset_at ?? undefined,
      }
    case 'monthly':
      if (!row.monthly_active || row.monthly_remaining_pct === null) return null
      return {
        remainingPct: row.monthly_remaining_pct,
        resetAt: row.monthly_reset_at ?? undefined,
      }
    default:
      return null
  }
}

/**
 * Formats a quota tooltip window label from interval start/end ISO strings.
 *
 * Wave 24-PhosphorDash (operator F1b): produces relative labels like
 * `−30m → now` (short/5h), `−12h → now` (weekly/7d), `−24h → now` (Google
 * 24h short), `this month` (monthly).  Falls back to `—` when timestamps are
 * unavailable.
 *
 * @param intervalType - Which quota interval produced this bar.
 * @param intervalStart - ISO string for interval start, or null.
 * @param intervalEnd   - ISO string for interval end (≈ now), or null.
 */
function formatTipWindow(
  intervalType: 'short' | 'weekly' | 'special' | 'short_special' | 'monthly',
  intervalStart: string | null,
  intervalEnd: string | null
): string {
  // Monthly quotas: simple label; exact dates rarely meaningful in the tooltip.
  if (intervalType === 'monthly') return 'this month'

  // For time-bounded intervals, compute the elapsed span and render relative.
  if (intervalStart !== null && intervalEnd !== null) {
    const startMs = new Date(intervalStart).getTime()
    const endDate = new Date(intervalEnd)
    const endMs = endDate.getTime()
    // Sentinel guard: the API uses year 9999 (e.g. "9999-12-31T00:00:00.000Z")
    // to mean "no fixed end". Treating it literally yields ~2.9M days. Fall
    // through to the type-based label below instead of computing that span.
    if (
      !Number.isNaN(startMs) &&
      !Number.isNaN(endMs) &&
      endDate.getUTCFullYear() <= 9000
    ) {
      const spanMs = endMs - startMs
      const spanH = spanMs / 3_600_000
      // Round to nearest sensible unit for display.
      if (spanH <= 1) {
        const spanM = Math.round(spanMs / 60_000)
        return `−${spanM.toString()}m → now`
      }
      if (spanH <= 36) {
        const rounded = Math.round(spanH)
        return `−${rounded.toString()}h → now`
      }
      const spanD = Math.round(spanH / 24)
      return `−${spanD.toString()}d → now`
    }
  }

  // Fallback by interval type when timestamps are absent.
  switch (intervalType) {
    case 'short':
    case 'short_special':
      return '−5h → now'
    case 'weekly':
    case 'special':
      return '−7d → now'
    default:
      return '—'
  }
}

/**
 * Test-only re-export of {@link formatTipWindow}.
 *
 * Prefixed with `_` and suffixed with `ForTest` to signal that this export
 * exists solely to enable unit tests.  Do not use in production code paths
 * outside of this module.
 *
 * @internal
 */
export { formatTipWindow as _formatTipWindowForTest }

/**
 * Test-only re-export of {@link formatTipVelocity}.
 *
 * Wave 35 S4: exported solely to support unit tests of the velocity
 * computation. Do not use in production code paths outside of this module.
 *
 * @internal
 */
export { formatTipVelocity as _formatTipVelocityForTest }

/**
 * Test-only re-exports for Wave 40/41 multi-quota redesign helpers.
 * Do not use in production code paths outside this module.
 *
 * @internal
 */
export {
  formatTimeAgo as _formatTimeAgoForTest,
  quotaTypeToPeriodType as _quotaTypeToPeriodTypeForTest,
  tipModelsFromBreakdownGoogleAggregated as _tipModelsGoogleForTest,
  tipModelsFromBreakdownSingleLabel as _tipModelsSingleLabelForTest,
  buildProviderLanes as _buildProviderLanesForTest,
  classifyGeminiModel as _classifyGeminiModelForTest,
}

/**
 * Derives a velocity string from `consumedPct` and `intervalStart`.
 *
 * Wave 35 S4: computes `consumedPct / hoursElapsed` where
 * `hoursElapsed = (Date.now() − intervalStart) / 3_600_000`.
 *
 * Returns `undefined` when:
 * - `intervalStart` is null / invalid
 * - `hoursElapsed ≤ 0` (clock skew or future start)
 * - `consumedPct === 0` (nothing consumed yet — velocity is meaningless)
 *
 * Format: `"+X.X%/h"` (one decimal place).
 *
 * @param consumedPct   - Percentage of quota consumed (0–100).
 * @param intervalStart - ISO-8601 start timestamp of the interval, or null.
 */
function formatTipVelocity(
  consumedPct: number,
  intervalStart: string | null
): string | undefined {
  if (intervalStart === null || consumedPct === 0) return undefined

  const startMs = new Date(intervalStart).getTime()
  if (Number.isNaN(startMs)) return undefined

  const hoursElapsed = (Date.now() - startMs) / 3_600_000
  if (hoursElapsed <= 0) return undefined

  const pctPerHour = consumedPct / hoursElapsed
  return `+${pctPerHour.toFixed(1)}%/h`
}

/**
 * Derives top-3 tipModels from a UsageReportQuotaUsageBreakdown array.
 *
 * Wave 24-PhosphorDash (operator F1b): aggregates cost per model, picks the
 * top 3 by cost, and formats costDelta as `$X.XX` strings.
 * Returns undefined when the breakdown is empty so QuotaBarGroup renders `—`.
 */
function tipModelsFromBreakdown(
  breakdown: UsageReportQuotaUsageBreakdown[]
): QuotaTipModel[] | undefined {
  if (breakdown.length === 0) return undefined

  // Aggregate cost per model (breakdown may have duplicates from multiple rows).
  const costByModel = new Map<string, number>()
  for (const entry of breakdown) {
    if (!entry.model) continue
    costByModel.set(
      entry.model,
      (costByModel.get(entry.model) ?? 0) + entry.cost
    )
  }
  if (costByModel.size === 0) return undefined

  return [...costByModel.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([model, cost]) => ({
      model,
      costDelta: `$${cost.toFixed(2)}`,
    }))
}

/**
 * Google-specific variant of tipModelsFromBreakdown for prior history bars.
 *
 * Wave 40 item #1: instead of showing raw model names (e.g. gemini-2.5-flash-001,
 * gemini-2.5-flash-preview), aggregates the usage_breakdown into Gemini model
 * class buckets: 'flash-lite', 'flash', 'pro', 'other'. Cost is summed per class
 * and the top 3 classes by cost are returned. This keeps history tooltips concise
 * and avoids overwhelming the operator with individual version names.
 */
function tipModelsFromBreakdownGoogleAggregated(
  breakdown: UsageReportQuotaUsageBreakdown[]
): QuotaTipModel[] | undefined {
  if (breakdown.length === 0) return undefined

  // Aggregate cost into Gemini class buckets.
  const costByClass = new Map<string, number>()
  for (const entry of breakdown) {
    if (!entry.model) continue
    const lower = entry.model.toLowerCase()
    let cls: string
    // Order of checks matters: flash-lite before flash.
    if (lower.includes('flash-lite')) {
      cls = 'flash-lite'
    } else if (lower.includes('flash')) {
      cls = 'flash'
    } else if (lower.includes('pro')) {
      cls = 'pro'
    } else {
      cls = 'other'
    }
    costByClass.set(cls, (costByClass.get(cls) ?? 0) + entry.cost)
  }
  if (costByClass.size === 0) return undefined

  return [...costByClass.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([cls, cost]) => ({
      model: cls,
      costDelta: `$${cost.toFixed(2)}`,
    }))
}

/**
 * Anthropic/OpenAI weekly-tier variant of tipModelsFromBreakdown for prior bars.
 *
 * Wave 40 item #2: for Anthropic weekly + weekly_special tiers, collapses all
 * model breakdown entries into a single 'sonnet' label. For OpenAI weekly +
 * weekly_special, collapses to 'codex-spark'. Returns undefined when breakdown
 * is empty.
 *
 * Interpretation: the operator wants the *tier display name* as a single label
 * in history tooltips — the same name used in the current active bar label —
 * rather than per-model granularity.
 */
function tipModelsFromBreakdownSingleLabel(
  breakdown: UsageReportQuotaUsageBreakdown[],
  displayLabel: string
): QuotaTipModel[] | undefined {
  if (breakdown.length === 0) return undefined
  const totalCost = breakdown.reduce((s, e) => s + e.cost, 0)
  return [{ model: displayLabel, costDelta: `$${totalCost.toFixed(2)}` }]
}

/**
 * Formats a "time ago" string for a prior reset bar relative to now.
 *
 * Wave 40 item #5: uses the 30-min-rounded period_start timestamp as the base
 * for calculation so the displayed age is consistent with the snapped date shown
 * in the bar label. Falls back to '—' when input is null or unparseable.
 *
 * Output format (compact, one unit of precision):
 *   < 1h  → "45m ago"
 *   < 24h → "3h ago"
 *   < 14d → "2d ago"
 *   ≥ 14d → "2w ago"
 */
function formatTimeAgo(roundedDate: Date): string {
  const diffMs = Date.now() - roundedDate.getTime()
  // Treat slightly-future timestamps (rounding artefacts ≤ 30 min) as their
  // absolute distance so the label is sensible rather than "now".
  const absDiffMs = Math.abs(diffMs)
  if (diffMs < -60_000) {
    // More than a minute in the future — use absolute distance with "ago" label
    // so rounding artefacts still produce readable output (e.g. "30m ago").
    const totalMins = Math.floor(absDiffMs / 60_000)
    const hours = Math.floor(totalMins / 60)
    const days = Math.floor(hours / 24)
    const weeks = Math.floor(days / 7)
    if (totalMins < 60) return `${totalMins.toString()}m ago`
    if (hours < 24) return `${hours.toString()}h ago`
    if (days < 14) return `${days.toString()}d ago`
    return `${weeks.toString()}w ago`
  }
  if (diffMs < 0) return 'just now' // within 1 minute in future — truly at boundary
  const totalMins = Math.floor(diffMs / 60_000)
  const hours = Math.floor(totalMins / 60)
  const days = Math.floor(hours / 24)
  const weeks = Math.floor(days / 7)
  if (totalMins < 60) return `${totalMins.toString()}m ago`
  if (hours < 24) return `${hours.toString()}h ago`
  if (days < 14) return `${days.toString()}d ago`
  return `${weeks.toString()}w ago`
}

/**
 * Maps a quota_type string to the QuotaBarGroup periodType used for stacked
 * lane grouping in provider-card.tsx.
 *
 * Wave 40 item #3: returns '5hr' for short/short_special, 'weekly' for weekly,
 * 'special' for special/weekly_special, 'monthly' for monthly.
 */
function quotaTypeToPeriodType(quotaType: string): QuotaBarGroup['periodType'] {
  switch (quotaType.toLowerCase()) {
    case 'short':
    case 'short_special':
      return '5hr'
    case 'weekly':
      return 'weekly'
    case 'special':
    case 'weekly_special':
      return 'special'
    case 'monthly':
      return 'monthly'
    default:
      return 'weekly'
  }
}

/**
 * Creates a QuotaBarGroup for a single (label, interval) pair.
 *
 * Wave 24-PhosphorDash (operator F1b): now wires optional `tipWindow` from
 * interval timestamps and `tipModels` from the usage breakdown array for the
 * same interval. `tipVelocity` is left undefined (no time-series data available).
 *
 * Returns null if the interval is not active on the given row.
 */
function makeQuotaBarGroup(
  label: string,
  row: UsageReportQuotaRow,
  interval: 'short' | 'weekly' | 'special' | 'short_special' | 'monthly'
): QuotaBarGroup | null {
  const iv = extractInterval(row, interval)
  if (iv === null) return null
  const consumedPct = Math.max(0, Math.min(100, 100 - iv.remainingPct))

  // F1b: interval_start/end for tipWindow, breakdown for tipModels.
  let intervalStart: string | null = null
  let intervalEnd: string | null = null
  let breakdown: UsageReportQuotaUsageBreakdown[] = []
  switch (interval) {
    case 'short':
      intervalStart = row.short_interval_start
      intervalEnd = row.short_interval_end
      breakdown = row.short_usage_breakdown
      break
    case 'weekly':
      intervalStart = row.weekly_interval_start
      intervalEnd = row.weekly_interval_end
      breakdown = row.weekly_usage_breakdown
      break
    case 'special':
      intervalStart = row.special_interval_start
      intervalEnd = row.special_interval_end
      breakdown = row.special_usage_breakdown
      break
    case 'short_special':
      intervalStart = row.short_special_interval_start
      intervalEnd = row.short_special_interval_end
      breakdown = row.short_special_usage_breakdown
      break
    case 'monthly':
      intervalStart = row.monthly_interval_start
      intervalEnd = row.monthly_interval_end
      breakdown = row.monthly_usage_breakdown
      break
  }

  return {
    label,
    consumedPct,
    remainingPct: iv.remainingPct,
    resetAt: iv.resetAt,
    segments: buildQuotaSegments(iv.remainingPct),
    // F1b: computed tip fields.
    tipWindow: formatTipWindow(interval, intervalStart, intervalEnd),
    // Wave 35 S4: derive velocity from (consumedPct / hoursElapsed).
    tipVelocity: formatTipVelocity(consumedPct, intervalStart),
    tipModels: tipModelsFromBreakdown(breakdown),
  }
}

/**
 * Like makeQuotaBarGroup but ALWAYS emits a bar — never returns null.
 *
 * Wave 28 fix: openai and anthropic must always render 4 quota bars so the
 * operator card layout is stable even when an interval is not currently active
 * (e.g. `short_special_active=false` for anthropic's sonnet · 5h bar).
 *
 * When the underlying interval is inactive or its remaining_pct is null, this
 * function returns a zero-consumed bar (`consumedPct=0, remainingPct=100`)
 * using the interval's timestamp fallback labels via `formatTipWindow`.
 *
 * Only used for the openai and anthropic provider branches in buildQuotaRows.
 * All other providers continue to use makeQuotaBarGroup (null → omit).
 */
function makeQuotaBarGroupAlways(
  label: string,
  row: UsageReportQuotaRow,
  interval: 'short' | 'weekly' | 'special' | 'short_special' | 'monthly'
): QuotaBarGroup {
  const existing = makeQuotaBarGroup(label, row, interval)
  if (existing !== null) return existing

  // Interval is inactive or pct is null — emit a 0%-consumed placeholder bar.
  let intervalStart: string | null = null
  let intervalEnd: string | null = null
  let breakdown: UsageReportQuotaUsageBreakdown[] = []
  switch (interval) {
    case 'short':
      intervalStart = row.short_interval_start
      intervalEnd = row.short_interval_end
      breakdown = row.short_usage_breakdown
      break
    case 'weekly':
      intervalStart = row.weekly_interval_start
      intervalEnd = row.weekly_interval_end
      breakdown = row.weekly_usage_breakdown
      break
    case 'special':
      intervalStart = row.special_interval_start
      intervalEnd = row.special_interval_end
      breakdown = row.special_usage_breakdown
      break
    case 'short_special':
      intervalStart = row.short_special_interval_start
      intervalEnd = row.short_special_interval_end
      breakdown = row.short_special_usage_breakdown
      break
    case 'monthly':
      intervalStart = row.monthly_interval_start
      intervalEnd = row.monthly_interval_end
      breakdown = row.monthly_usage_breakdown
      break
  }

  return {
    label,
    consumedPct: 0,
    remainingPct: 100,
    segments: buildQuotaSegments(100),
    tipWindow: formatTipWindow(interval, intervalStart, intervalEnd),
    tipModels: tipModelsFromBreakdown(breakdown),
  }
}

/**
 * Builds per-provider curated QuotaBarGroup[] matching the operator F1 mockup.
 *
 * This replaces the raw `buildQuotaIntervals` call at the ProviderCard callsite
 * so each provider shows only the quota rows relevant to its contract shape.
 * `buildQuotaIntervals` is preserved for multi-bar rendering compatibility.
 *
 * ### Returned shape (QuotaBarGroup[])
 * Each element has:
 *   - `label`        — display label per mockup (e.g. `'all · 5h'`, `'gemini-pro · 24h'`)
 *   - `consumedPct`  — 0–100 (100 − remainingPct, clamped)
 *   - `remainingPct` — raw API remaining_pct
 *   - `resetAt?`     — ISO timestamp of next reset if known
 *   - `segments`     — 12-segment array from buildQuotaSegments
 *
 * ### Provider → row mapping (Operator F1)
 * | provider   | rows included                                                   |
 * |------------|-----------------------------------------------------------------|
 * | openai     | all·5h (short), all·7d (weekly), codex-spark·5h, codex-spark·7d|
 * | anthropic  | all·5h (short), all·7d (weekly), sonnet·7d (W29: sonnet·5h dropped)|
 * | google     | gemini-pro·24h, gemini-flash·24h, gemini-flash-lite·24h (short) |
 * | xai        | grok·monthly                                                    |
 * | nvidia_nim | NIM credits·monthly                                             |
 * | openrouter | credits·monthly, gemma-4-31b free·monthly, qwen3-coder free·monthly |
 * | local      | [] (no quotas)                                                  |
 *
 * openai always emits exactly 4 bars (inactive intervals render at 0% consumed).
 * anthropic emits 3 bars (sonnet·5h dropped in W29 Fix #3).
 * All other providers silently omit inactive intervals.
 *
 * @param provider - Canonical provider name from CANONICAL_PROVIDERS
 * @param allQuotaRows - Full quota rows array from /api/shell/reports/quotas
 */
function buildQuotaRows(
  provider: string,
  allQuotaRows: UsageReportQuotaRow[]
): QuotaBarGroup[] {
  const providerLower = provider.toLowerCase()

  // Filter all quota rows to this provider (API returns canonical names for quotas)
  const providerRows = allQuotaRows.filter(
    (r) => r.provider.toLowerCase() === providerLower
  )

  if (providerRows.length === 0 || provider === 'local') return []

  const result: QuotaBarGroup[] = []

  switch (providerLower) {
    case 'openai': {
      // 22-PhosphorDash Fix ⚠-W21-1: the live API encodes codex-spark quotas in
      // the special_* and short_special_* columns of the model=null row — there is
      // no separate model-scoped row for codex-spark.  Read all 4 bars from the
      // single provider-level row:
      //   short          → 'all · 5h'
      //   weekly         → 'all · 7d'
      //   short_special  → 'codex-spark · 5h'
      //   special        → 'codex-spark · 7d'
      //
      // W28: always emit all 4 bars (inactive → 0% consumed) via
      // makeQuotaBarGroupAlways so the card layout is stable.
      const allRow = providerRows.find((r) => r.model === null)
      if (allRow !== undefined) {
        result.push(makeQuotaBarGroupAlways('all · 5h', allRow, 'short'))
        result.push(makeQuotaBarGroupAlways('all · 7d', allRow, 'weekly'))
        result.push(
          makeQuotaBarGroupAlways('codex-spark · 5h', allRow, 'short_special')
        )
        result.push(
          makeQuotaBarGroupAlways('codex-spark · 7d', allRow, 'special')
        )
      }
      break
    }

    case 'anthropic': {
      // 22-PhosphorDash Fix ⚠-W21-1: same pattern as OpenAI — sonnet quotas live
      // in the special_* / short_special_* columns of the model=null row.
      //   short          → 'all · 5h'
      //   weekly         → 'all · 7d'
      //   special        → 'sonnet · 7d'
      //
      // W29 Fix #3: operator dropped the sonnet·5h bar — emit 3 bars only.
      // short_special (sonnet·5h) is omitted entirely.
      const allRow = providerRows.find((r) => r.model === null)
      if (allRow !== undefined) {
        const g5h = makeQuotaBarGroup('all · 5h', allRow, 'short')
        if (g5h !== null) result.push(g5h)
        const g7d = makeQuotaBarGroup('all · 7d', allRow, 'weekly')
        if (g7d !== null) result.push(g7d)
        const gs7d = makeQuotaBarGroup('sonnet · 7d', allRow, 'special')
        if (gs7d !== null) result.push(gs7d)
      }
      break
    }

    case 'google': {
      // Google uses short interval but labels it as '24h' per the mockup.
      // Aggregate by gemini model class (gemini-pro / gemini-flash / gemini-flash-lite).
      // When multiple API rows map to the same class, take the first active one
      // (they share the same rate-limit pool per class in practice).
      //
      // 22-PhosphorDash Fix ⚠-W21-2275-#1: emit in mockup order
      // (gemini-flash · 24h, gemini-pro · 24h, gemini-flash-lite · 24h).
      // See mockup 06-phosphor-atlas.html L2533–2548.  We collect the best row
      // per class first (sorting by name length so shorter names are preferred),
      // then emit rows in the canonical class order.
      const GOOGLE_CLASS_ORDER: Record<string, number> = {
        'gemini-flash': 0,
        'gemini-pro': 1,
        'gemini-flash-lite': 2,
      }

      // Collect best row per class (prefer shorter model names as a tiebreak)
      const bestRowByClass = new Map<string, UsageReportQuotaRow>()
      const sortedGoogleRows = [...providerRows].sort((a, b) => {
        const am = (a.model ?? '').length
        const bm = (b.model ?? '').length
        return am - bm
      })
      for (const row of sortedGoogleRows) {
        if (row.model === null) continue
        const cls = classifyGeminiModel(row.model)
        if (cls === null || bestRowByClass.has(cls)) continue
        bestRowByClass.set(cls, row)
      }

      // Emit in mockup order
      const orderedClasses = [...bestRowByClass.keys()].sort(
        (a, b) => (GOOGLE_CLASS_ORDER[a] ?? 99) - (GOOGLE_CLASS_ORDER[b] ?? 99)
      )
      for (const cls of orderedClasses) {
        const row = bestRowByClass.get(cls)
        if (row === undefined) continue
        const g = makeQuotaBarGroup(`${cls} · 24h`, row, 'short')
        if (g !== null) result.push(g)
      }
      break
    }

    case 'xai': {
      // All xAI quota rows aggregate under 'grok · monthly'
      // Take the first active monthly row (usually provider-level, model=null)
      for (const row of providerRows) {
        const g = makeQuotaBarGroup('grok · monthly', row, 'monthly')
        if (g !== null) {
          result.push(g)
          break
        }
      }
      break
    }

    case 'nvidia_nim': {
      // NIM credits → monthly
      for (const row of providerRows) {
        const g = makeQuotaBarGroup('NIM credits · monthly', row, 'monthly')
        if (g !== null) {
          result.push(g)
          break
        }
      }
      break
    }

    case 'openrouter': {
      // Provider-level (model === null): 'credits · monthly'
      const creditsRow = providerRows.find((r) => r.model === null)
      if (creditsRow !== undefined) {
        const gc = makeQuotaBarGroup('credits · monthly', creditsRow, 'monthly')
        if (gc !== null) result.push(gc)
      }
      // Free-tier model rows by name
      const gemmaRow = providerRows.find(
        (r) => r.model !== null && r.model.toLowerCase().includes('gemma-4-31b')
      )
      if (gemmaRow !== undefined) {
        const gg = makeQuotaBarGroup(
          'gemma-4-31b free · monthly',
          gemmaRow,
          'monthly'
        )
        if (gg !== null) result.push(gg)
      }
      const qwenRow = providerRows.find(
        (r) => r.model !== null && r.model.toLowerCase().includes('qwen3-coder')
      )
      if (qwenRow !== undefined) {
        const gq = makeQuotaBarGroup(
          'qwen3-coder free · monthly',
          qwenRow,
          'monthly'
        )
        if (gq !== null) result.push(gq)
      }
      break
    }

    default:
      // Unknown provider: fall back to raw interval rendering
      return buildQuotaIntervals(allQuotaRows, provider)
  }

  return result
}

/**
 * Maps a normalised quota_type string from quotaHistory[] to the operator
 * display label prefix used in buildQuotaRows labels (e.g. 'weekly' → '7d',
 * 'short' → '5h'). Falls back to the raw quota_type when unrecognised.
 */
function quotaTypeToSuffix(quotaType: string): string {
  switch (quotaType.toLowerCase()) {
    case 'weekly':
      return '7d'
    case 'short':
      return '5h'
    case 'special':
      return '7d'
    case 'short_special':
      return '5h'
    case 'monthly':
      return 'monthly'
    default:
      return quotaType
  }
}

/**
 * Rounds a UTC timestamp to the nearest 30-minute boundary.
 * Used to collapse sub-minute poll-jitter duplicates (e.g. 00:04:53, 00:04:54,
 * 00:04:56 → all round to 00:00) into a single logical reset slot.
 */
function roundToNearest30Min(iso: string): Date {
  const ms = 30 * 60 * 1000
  return new Date(Math.round(new Date(iso).getTime() / ms) * ms)
}

/**
 * Formats a compact interval label for the history bar tipWindow, e.g.
 * `Sun 5/11 → Sun 5/18`. Used in place of the live '−7d → now' style.
 * Falls back to '—' when either bound is null/unparseable.
 */
function fmtIntervalForHistory(
  start: string | null,
  end: string | null
): string {
  if (start === null || end === null) return '—'
  const s = new Date(start)
  const e = new Date(end)
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return '—'
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const fmt = (d: Date): string => {
    const day = dayNames[d.getUTCDay()]
    const m = d.getUTCMonth() + 1
    const dd = d.getUTCDate()
    return `${day} ${m.toString()}/${dd.toString()}`
  }
  return `${fmt(s)} → ${fmt(e)}`
}

/**
 * Builds QuotaBarGroup[] for past reset windows from quotaHistory[] for a
 * single provider. Full parity with current bars: identical 12-segment fills,
 * per-model tooltip content, and visual weight. Only the label heading differs
 * (model prefix · time-ago instead of model prefix · duration tag).
 *
 * Wave 40 multi-quota redesign changes:
 *
 * #1 Google model-class aggregation (prior bars only):
 *   Raw model names (gemini-2.5-flash-001, gemini-2.5-flash-preview, …) are
 *   aggregated into class buckets: flash-lite / flash / pro / other. The
 *   tooltip shows the class name, not individual model names. The current
 *   active bar (built by buildQuotaRows) is NOT changed.
 *
 * #2 Anthropic/OpenAI weekly-tier display names:
 *   For Anthropic weekly + special quota types: tooltip displays 'sonnet'.
 *   For OpenAI weekly + special quota types: tooltip displays 'codex-spark'.
 *   Short/5hr bars use the standard tipModelsFromBreakdown (per-model).
 *
 * #3 Render ALL history bars (no fixed-count slice):
 *   The 1.5× lookback server change (Engineer A, W40) extends the window.
 *   All returned bars are rendered; the operator can always see the full
 *   1.5× interval history for each tier.
 *
 * #4 30-min snapped period_start for time-ago base:
 *   timeAgoLabel is derived from roundToNearest30Min(expected_reset_at) so
 *   the displayed age matches the bar's rounded date label.
 *
 * #5 Time-ago in label and reset cell:
 *   Label format changed from 'prefix · YYYY-MM-DD HH:MM' to 'prefix · Xd ago'
 *   (time-ago of the rounded expected_reset_at). The same string populates
 *   timeAgoLabel for the reset cell in provider-card.tsx.
 *
 * #6 periodType set on all history bars for stacked-lane grouping.
 *
 * Dedup: history rows whose expected_reset_at matches the resetAt of any
 * current bar (same live window) are skipped.
 *
 * Sort: descending by expected_reset_at (most-recent past reset first).
 *
 * @param provider - canonical provider name
 * @param historyRows - flat quotaHistory[] from the API response
 * @param currentBars - already-built current QuotaBarGroup[] for this provider
 *   (used for deduplication and quota_type → model-label mapping)
 */
function buildHistoryBarsForProvider(
  provider: string,
  historyRows: UsageReportQuotaHistoryRow[],
  currentBars: QuotaBarGroup[]
): QuotaBarGroup[] {
  const aliases = providerAliases(provider)
  const providerLower = provider.toLowerCase()

  // Filter history to this provider (handle aliases like 'gemini' → 'google').
  const relevant = historyRows.filter((h) =>
    aliases.includes(h.provider.toLowerCase())
  )
  if (relevant.length === 0) return []

  // If no current bars exist the provider has no active quotas — skip history.
  if (currentBars.length === 0) return []

  // Build an array of numeric timestamps (ms) from current bars' rounded reset
  // times.  We use numeric comparison for ±30 min proximity so that rounding
  // artefacts from Math.round (which can push a past reset into the future
  // slot) don't slip through an exact ISO-string match.
  const THIRTY_MIN_MS_H = 30 * 60 * 1000
  const currentRoundedResetMsList: number[] = currentBars
    .map((b) => b.resetAt)
    .filter((r): r is string => r !== undefined)
    .map((r) => roundToNearest30Min(r).getTime())

  /** Returns true if slotMs is within ±30 min of any current bar's reset. */
  const isNearCurrentReset = (slotMs: number): boolean =>
    currentRoundedResetMsList.some(
      (cur) => Math.abs(cur - slotMs) <= THIRTY_MIN_MS_H
    )

  // Build a lookup: quota_type → model-prefix from current bar labels.
  // e.g. 'all · 7d' for quota_type='weekly' gives prefix='all'.
  const modelPrefixByQuotaType = new Map<string, string>()
  for (const bar of currentBars) {
    const dotIdx = bar.label.indexOf(' · ')
    if (dotIdx === -1) continue
    const suffix = bar.label.slice(dotIdx + 3)
    const modelPrefix = bar.label.slice(0, dotIdx)
    for (const qt of [
      'weekly',
      'short',
      'special',
      'short_special',
      'monthly',
    ] as const) {
      if (quotaTypeToSuffix(qt) === suffix && !modelPrefixByQuotaType.has(qt)) {
        modelPrefixByQuotaType.set(qt, modelPrefix)
      }
    }
  }

  // Pre-pass: for each rounded slot, collect the set of distinct quota_types
  // that appear.  Any slot with >1 quota_type needs label disambiguation so
  // bars that would otherwise render identical labels become distinguishable.
  const quotaTypesPerSlot = new Map<string, Set<string>>()
  for (const h of relevant) {
    if (h.min_remaining_pct === null) continue
    if (h.expected_reset_at === null) continue
    const slotDate = roundToNearest30Min(h.expected_reset_at)
    if (isNearCurrentReset(slotDate.getTime())) continue
    const slot = slotDate.toISOString()
    let types = quotaTypesPerSlot.get(slot)
    if (types === undefined) {
      types = new Set<string>()
      quotaTypesPerSlot.set(slot, types)
    }
    types.add(h.quota_type.toLowerCase())
  }

  // Deduplicate by (quota_type, rounded-slot) — sub-minute poll-jitter
  // duplicates of the same quota type collapse to one bar per 30-min window.
  const seen = new Set<string>()
  const result: QuotaBarGroup[] = []

  for (const h of relevant) {
    // Skip rows without usable data.
    if (h.min_remaining_pct === null) continue

    const roundedSlotDate =
      h.expected_reset_at !== null
        ? roundToNearest30Min(h.expected_reset_at)
        : null
    const roundedSlot =
      roundedSlotDate !== null ? roundedSlotDate.toISOString() : ''

    // Dedup against current bars — skip if within ±30 min of any live reset
    // window (proximity check absorbs Math.round artefacts).
    if (
      roundedSlotDate !== null &&
      isNearCurrentReset(roundedSlotDate.getTime())
    ) {
      continue
    }

    // Dedup across multiple history rows for the same (quota_type, rounded slot).
    const dedupeKey = `${h.quota_type}::${roundedSlot}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    const quotaTypeLower = h.quota_type.toLowerCase()

    // Wave 40 #5: time-ago label derived from the 30-min-snapped reset time.
    // Used in both the bar label (replaces YYYY-MM-DD HH:MM) and the reset cell.
    const timeAgoLabel =
      roundedSlotDate !== null ? formatTimeAgo(roundedSlotDate) : '—'

    // Build the display label: '<model-prefix> · <time-ago>[(quota_type)]'
    // The time-ago replaces the previous absolute date string so the operator
    // sees "flash · 2d ago" instead of "flash · 2026-05-18 00:00".
    const modelPrefix =
      modelPrefixByQuotaType.get(quotaTypeLower) ??
      (h.model !== null ? h.model : 'all')
    const disambig =
      roundedSlot !== '' && (quotaTypesPerSlot.get(roundedSlot)?.size ?? 0) > 1
        ? ` (${quotaTypeLower})`
        : ''
    const label = `${modelPrefix} · ${timeAgoLabel}${disambig}`

    // Wave 40 #6: determine periodType for stacked-lane grouping.
    const periodType = quotaTypeToPeriodType(quotaTypeLower)

    // Wave 40 #1/#2: choose the correct tipModels builder based on provider
    // and quota type.
    let tipModels: QuotaTipModel[] | undefined
    if (providerLower === 'google') {
      // #1: Google history bars → aggregate by model class (flash-lite/flash/pro/other)
      tipModels = tipModelsFromBreakdownGoogleAggregated(h.usage_breakdown)
    } else if (
      providerLower === 'anthropic' &&
      (quotaTypeLower === 'weekly' || quotaTypeLower === 'special')
    ) {
      // #2: Anthropic weekly-tier bars → single 'sonnet' label
      tipModels = tipModelsFromBreakdownSingleLabel(h.usage_breakdown, 'sonnet')
    } else if (
      providerLower === 'openai' &&
      (quotaTypeLower === 'weekly' || quotaTypeLower === 'special')
    ) {
      // #2: OpenAI weekly-tier bars → single 'codex-spark' label
      tipModels = tipModelsFromBreakdownSingleLabel(
        h.usage_breakdown,
        'codex-spark'
      )
    } else {
      // All other providers/tiers: standard per-model breakdown
      tipModels = tipModelsFromBreakdown(h.usage_breakdown)
    }

    // Full-parity 12-segment render using the same buildQuotaSegments function
    // as current bars. Use min_remaining_pct (peak consumption).
    const remainingPct = h.min_remaining_pct
    const consumedPct = Math.max(0, Math.min(100, 100 - remainingPct))

    result.push({
      label,
      consumedPct,
      remainingPct,
      resetAt: h.expected_reset_at ?? undefined,
      segments: buildQuotaSegments(remainingPct),
      tipWindow: fmtIntervalForHistory(h.interval_start, h.interval_end),
      tipModels,
      // Wave 40 #3: no slice — all history bars returned (1.5× lookback from server).
      // Wave 40 #4/#5: time-ago label for the reset cell.
      timeAgoLabel,
      // Wave 40 #6: stacked-lane grouping by period type.
      periodType,
    })
  }

  // Sort descending by expected_reset_at (most-recent past reset first).
  result.sort((a, b) => {
    const aDate = a.resetAt ?? ''
    const bDate = b.resetAt ?? ''
    return bDate < aDate ? -1 : bDate > aDate ? 1 : 0
  })

  return result
}

// ---------------------------------------------------------------------------
// Lane key constants — maps quota_type normalised values to lane identifiers.
// ---------------------------------------------------------------------------

/**
 * Maps a normalised quota_type to its canonical lane key suffix.
 * These keys match the lane definitions in PROVIDER_LANE_DEFS below.
 */
function quotaTypeToLaneKey(quotaType: string): string {
  switch (quotaType.toLowerCase()) {
    case 'short':
      return 'short'
    case 'weekly':
      return 'weekly'
    case 'special':
      return 'special'
    case 'short_special':
      return 'short_special'
    case 'monthly':
      return 'monthly'
    default:
      return quotaType.toLowerCase()
  }
}

/**
 * Maps a normalised quota_type to the `QuotaBarGroup['periodType']` so that
 * lane-based priorBars use the correct type tag (kept for tooltip reuse).
 */
function quotaTypeToBarPeriodType(
  quotaType: string
): QuotaBarGroup['periodType'] {
  switch (quotaType.toLowerCase()) {
    case 'short':
    case 'short_special':
      return '5hr'
    case 'weekly':
      return 'weekly'
    case 'special':
      return 'special'
    case 'monthly':
      return 'monthly'
    default:
      return 'weekly'
  }
}

/**
 * Per-provider lane definitions.
 *
 * Wave 41: each entry describes one quota lane for a provider.
 *   laneKey  — stable ID used to group current + prior bars
 *   laneLabel — human-readable label shown on the left of the lane row
 *   quotaType — the normalised quota_type value from quotaHistory / quotaRows
 *               that feeds this lane
 *   googleClass — (Google only) the classifyGeminiModel class that feeds
 *                 this lane (null for non-Google providers)
 *
 * Anthropic: 3 lanes — all·5h (short), all·7d (weekly), sonnet·7d (special)
 * OpenAI:    4 lanes — all·5h (short), all·7d (weekly),
 *                      codex-spark·5h (short_special), codex-spark·7d (special)
 * Google:    3 lanes — flash·24h, flash-lite·24h, pro·24h (all short, per-class)
 * xAI:       1 lane  — all·monthly (monthly)
 */
interface LaneDef {
  laneKey: string
  laneLabel: string
  quotaType: string
  googleClass: string | null
}

const ANTHROPIC_LANE_DEFS: LaneDef[] = [
  {
    laneKey: 'anthropic/short',
    laneLabel: 'All Models · 5hr',
    quotaType: 'short',
    googleClass: null,
  },
  {
    laneKey: 'anthropic/special',
    laneLabel: 'Sonnet · 7d',
    quotaType: 'special',
    googleClass: null,
  },
  {
    laneKey: 'anthropic/weekly',
    laneLabel: 'All Models · 7d',
    quotaType: 'weekly',
    googleClass: null,
  },
]

const OPENAI_LANE_DEFS: LaneDef[] = [
  {
    laneKey: 'openai/short',
    laneLabel: 'All Models · 5hr',
    quotaType: 'short',
    googleClass: null,
  },
  {
    laneKey: 'openai/short_special',
    laneLabel: 'codex-spark · 5hr',
    quotaType: 'short_special',
    googleClass: null,
  },
  {
    laneKey: 'openai/weekly',
    laneLabel: 'All Models · 7d',
    quotaType: 'weekly',
    googleClass: null,
  },
  {
    laneKey: 'openai/special',
    laneLabel: 'codex-spark · 7d',
    quotaType: 'special',
    googleClass: null,
  },
]

const GOOGLE_LANE_DEFS: LaneDef[] = [
  // flash-lite MUST be checked before flash (substring containment).
  {
    laneKey: 'google/flash-lite',
    laneLabel: 'Flash-Lite · 24h',
    quotaType: 'short',
    googleClass: 'gemini-flash-lite',
  },
  {
    laneKey: 'google/flash',
    laneLabel: 'Flash · 24h',
    quotaType: 'short',
    googleClass: 'gemini-flash',
  },
  {
    laneKey: 'google/pro',
    laneLabel: 'Pro · 24h',
    quotaType: 'short',
    googleClass: 'gemini-pro',
  },
]

const XAI_LANE_DEFS: LaneDef[] = [
  {
    laneKey: 'xai/monthly',
    laneLabel: 'All Models · 30d',
    quotaType: 'monthly',
    googleClass: null,
  },
]

const PROVIDER_LANE_DEFS: Readonly<Record<string, LaneDef[]>> = {
  anthropic: ANTHROPIC_LANE_DEFS,
  openai: OPENAI_LANE_DEFS,
  google: GOOGLE_LANE_DEFS,
  xai: XAI_LANE_DEFS,
}

/**
 * Builds a QuotaBarGroup for a single history row in a lane.
 *
 * Wave 41: all prior bars use the same 12-segment fill as current bars.
 * The `timeAgoLabel` is derived from roundToNearest30Min(expected_reset_at).
 * The `periodType` is set for legacy compat but lanes don't need it.
 */
function buildPriorBarFromHistory(
  h: UsageReportQuotaHistoryRow,
  provider: string
): QuotaBarGroup {
  const quotaTypeLower = h.quota_type.toLowerCase()
  const roundedSlotDate =
    h.expected_reset_at !== null
      ? roundToNearest30Min(h.expected_reset_at)
      : null
  const timeAgoLabel =
    roundedSlotDate !== null ? formatTimeAgo(roundedSlotDate) : '—'

  const remainingPct = h.min_remaining_pct ?? 0
  const consumedPct = Math.max(0, Math.min(100, 100 - remainingPct))

  let tipModels: QuotaTipModel[] | undefined
  const providerLower = provider.toLowerCase()
  if (providerLower === 'google') {
    tipModels = tipModelsFromBreakdownGoogleAggregated(h.usage_breakdown)
  } else if (
    providerLower === 'anthropic' &&
    (quotaTypeLower === 'weekly' || quotaTypeLower === 'special')
  ) {
    tipModels = tipModelsFromBreakdownSingleLabel(h.usage_breakdown, 'sonnet')
  } else if (
    providerLower === 'openai' &&
    (quotaTypeLower === 'weekly' || quotaTypeLower === 'special')
  ) {
    tipModels = tipModelsFromBreakdownSingleLabel(
      h.usage_breakdown,
      'codex-spark'
    )
  } else {
    tipModels = tipModelsFromBreakdown(h.usage_breakdown)
  }

  return {
    label: timeAgoLabel,
    consumedPct,
    remainingPct,
    resetAt: h.expected_reset_at ?? undefined,
    segments: buildQuotaSegments(remainingPct),
    tipWindow: fmtIntervalForHistory(h.interval_start, h.interval_end),
    tipModels,
    timeAgoLabel,
    periodType: quotaTypeToBarPeriodType(quotaTypeLower),
  }
}

/**
 * Builds `QuotaLane[]` for a single provider by combining current quota rows
 * with history rows. Each lane = one quota type, current bar + prior bars.
 *
 * Wave 41 multi-reset redesign (replaces Wave 40 flat list):
 *
 * For each lane defined in PROVIDER_LANE_DEFS[provider]:
 * 1. Find the current bar from `allQuotaRows` using the existing `buildQuotaRows`
 *    (single-bar) logic per quota type.
 * 2. Find all matching history rows for this lane's quota_type (and Google
 *    model class) from `historyRows`, deduplicate by 30-min slot, and sort
 *    newest-first.
 * 3. Return a `QuotaLane` with `currentBar` + `priorBars`.
 *
 * Only lanes defined in PROVIDER_LANE_DEFS are rendered; unknown providers
 * fall back to the old `buildQuotaRows` flat-list path (no lanes prop passed).
 *
 * @param provider    — canonical provider name (lowercase)
 * @param allQuotaRows — full quotas[] from /api/shell/reports/quotas
 * @param historyRows  — full quotaHistory[] from the usage report
 */
function buildProviderLanes(
  provider: string,
  allQuotaRows: UsageReportQuotaRow[],
  historyRows: UsageReportQuotaHistoryRow[]
): QuotaLane[] {
  const providerLower = provider.toLowerCase()
  const laneDefs = PROVIDER_LANE_DEFS[providerLower]
  if (laneDefs === undefined || laneDefs.length === 0) return []

  // Pre-filter quota rows to this provider.
  const providerQuotas = allQuotaRows.filter(
    (r) => r.provider.toLowerCase() === providerLower
  )

  // Pre-filter history rows to this provider (handle aliases e.g. gemini→google).
  const aliases = providerAliases(providerLower)
  const providerHistory = historyRows.filter((h) =>
    aliases.includes(h.provider.toLowerCase())
  )

  const result: QuotaLane[] = []

  for (const def of laneDefs) {
    // ── 1. Build current bar ────────────────────────────────────────────────
    let currentBar: QuotaBarGroup | null = null

    if (providerLower === 'google' && def.googleClass !== null) {
      // Google: find the best row for this model class.
      // Sort by model name length (shorter = more generic = preferred).
      const sorted = [...providerQuotas].sort((a, b) => {
        const am = (a.model ?? '').length
        const bm = (b.model ?? '').length
        return am - bm
      })
      let bestRow: UsageReportQuotaRow | null = null
      for (const row of sorted) {
        if (row.model === null) continue
        if (classifyGeminiModel(row.model) !== def.googleClass) continue
        if (bestRow === null) bestRow = row
      }
      if (bestRow !== null) {
        const g = makeQuotaBarGroup(`${def.laneLabel}`, bestRow, 'short')
        if (g !== null) {
          // Aggregate short_usage_breakdown across ALL same-class rows so that
          // split quota rows (e.g. gemini-2.5-flash-lite vs gemini-3.1-flash-lite-preview)
          // are merged into one class-bucket tooltip instead of showing "— —".
          const mergedBreakdown = providerQuotas
            .filter(
              (r) =>
                r.model !== null &&
                classifyGeminiModel(r.model) === def.googleClass
            )
            .flatMap((r) => r.short_usage_breakdown)
          const aggregatedTipModels =
            tipModelsFromBreakdownGoogleAggregated(mergedBreakdown)
          currentBar = {
            ...g,
            label: def.laneLabel,
            tipModels: aggregatedTipModels,
          }
        }
      }
    } else if (providerLower === 'xai') {
      // xAI: aggregate all rows under monthly.
      for (const row of providerQuotas) {
        const g = makeQuotaBarGroup(def.laneLabel, row, 'monthly')
        if (g !== null) {
          currentBar = g
          break
        }
      }
    } else {
      // Anthropic / OpenAI: all quota data lives in the model=null row.
      const allRow = providerQuotas.find((r) => r.model === null)
      if (allRow !== undefined) {
        const interval = ((): Parameters<typeof makeQuotaBarGroup>[2] => {
          switch (def.quotaType) {
            case 'short':
              return 'short'
            case 'weekly':
              return 'weekly'
            case 'special':
              return 'special'
            case 'short_special':
              return 'short_special'
            case 'monthly':
              return 'monthly'
            default:
              return 'weekly'
          }
        })()
        const g =
          providerLower === 'openai'
            ? makeQuotaBarGroupAlways(def.laneLabel, allRow, interval)
            : makeQuotaBarGroup(def.laneLabel, allRow, interval)
        if (g !== null) {
          currentBar = g
        }
      }
    }

    // ── 2. Build prior bars ─────────────────────────────────────────────────
    // Filter history rows to this lane's quota_type (+ Google class).
    const laneHistory = providerHistory.filter((h) => {
      const htLower = h.quota_type.toLowerCase()
      if (htLower !== quotaTypeToLaneKey(def.quotaType)) return false
      // Google: additionally filter by model class.
      if (providerLower === 'google' && def.googleClass !== null) {
        if (h.model === null) return false
        const cls = classifyGeminiModel(h.model)
        return cls === def.googleClass
      }
      return true
    })

    // Deduplicate by (rounded-30min slot) — suppress current reset window.
    // Use a numeric timestamp for ±30 min proximity comparison to handle
    // rounding artefacts where Math.round pushes a past reset into the future.
    const THIRTY_MIN_MS = 30 * 60 * 1000
    const currentRoundedResetMs: number | null =
      currentBar?.resetAt !== undefined
        ? roundToNearest30Min(currentBar.resetAt).getTime()
        : null
    const seen = new Set<string>()
    const priorBars: QuotaBarGroup[] = []

    // Sort by expected_reset_at DESC so newest prior is first.
    const sortedHistory = [...laneHistory].sort((a, b) => {
      const ad = a.expected_reset_at ?? ''
      const bd = b.expected_reset_at ?? ''
      return bd < ad ? -1 : bd > ad ? 1 : 0
    })

    for (const h of sortedHistory) {
      if (h.min_remaining_pct === null) continue

      const roundedSlotDate =
        h.expected_reset_at !== null
          ? roundToNearest30Min(h.expected_reset_at)
          : null
      const roundedSlot =
        roundedSlotDate !== null ? roundedSlotDate.toISOString() : ''

      // Skip if this slot is within ±30 min of the current bar's reset time.
      // The ±30 min window absorbs rounding artefacts from Math.round that can
      // push a history row's slot to the next 30-min boundary, making an exact
      // ISO-string match miss rows that belong to the live reset window.
      if (
        roundedSlotDate !== null &&
        currentRoundedResetMs !== null &&
        Math.abs(currentRoundedResetMs - roundedSlotDate.getTime()) <=
          THIRTY_MIN_MS
      )
        continue

      // Dedup within the same 30-min slot.
      if (seen.has(roundedSlot)) continue
      seen.add(roundedSlot)

      priorBars.push(buildPriorBarFromHistory(h, providerLower))
    }

    result.push({
      laneKey: def.laneKey,
      laneLabel: def.laneLabel,
      currentBar,
      priorBars,
    })
  }

  // Return only lanes that have at least a current bar OR prior bars.
  return result.filter((l) => l.currentBar !== null || l.priorBars.length > 0)
}

// ---------------------------------------------------------------------------
// computeFleetErrors lives in usage-report-display.ts (lib) so the helper
// can be imported by both phosphor-dashboard and index.tsx without violating
// the react-refresh/only-export-components constraint.
// ---------------------------------------------------------------------------

/**
 * Canonical provider order — always present in fixed sequence.
 *
 * Wave 11 PR2 (11-f): the dashboard always shows all 7 canonical providers so
 * the 8-card row is fully populated regardless of which providers the API
 * happens to return data for in a given time range. Providers absent from
 * the API response receive zeroed metrics.
 */
const CANONICAL_PROVIDERS = [
  'anthropic',
  'openai',
  'google',
  'xai',
  'nvidia_nim',
  'openrouter',
  'local',
] as const

/**
 * Always returns the canonical 7 providers in fixed order.
 *
 * Wave 11 PR2 (11-f): replaces the old dynamic derivation that only returned
 * providers present in the API response. This ensures `local` (and any other
 * provider the mock API omits) always appears in the grid with zeroed metrics.
 */
function deriveProviders(): string[] {
  return [...CANONICAL_PROVIDERS]
}

/**
 * Builds RepoRow[] from raw UsageReportRow records by aggregating per
 * repository.
 */
function buildRepoRows(
  rows: {
    repository?: string
    token_total: number | null
    usd_cost: number | null
    traces: number | null
    model?: string
  }[],
  trendRows: UsageReportTrendRow[]
): RepoRow[] {
  // Build per-repository sparkline series from trend data (24h buckets).
  // Each bucket can have multiple rows (one per provider+model combination for
  // that repository). Aggregate token_total per (repository, bucket) first so
  // each sparkline point represents the full repository output for that bucket,
  // then sort chronologically so the polyline reads left-to-right oldest-to-newest.
  const bucketSumByRepo = new Map<string, Map<string, number>>()
  for (const t of trendRows) {
    const repo = t.repository ?? '(unknown)'
    const bucketMap = bucketSumByRepo.get(repo) ?? new Map<string, number>()
    bucketMap.set(t.bucket, (bucketMap.get(t.bucket) ?? 0) + t.token_total)
    bucketSumByRepo.set(repo, bucketMap)
  }
  const sparkByRepo = new Map<string, number[]>()
  for (const [repo, bucketMap] of bucketSumByRepo) {
    const sortedBuckets = [...bucketMap.entries()].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0
    )
    sparkByRepo.set(
      repo,
      sortedBuckets.map(([, sum]) => sum)
    )
  }

  // 15-B.7: Track per-repo model token sums so we can pick the genuine top
  // model (max token_total) instead of the last-iterated model.
  const repoMap = new Map<
    string,
    {
      tokens: number
      cost: number
      traces: number
      modelTokens: Map<string, number>
    }
  >()

  for (const row of rows) {
    const repo = row.repository ?? '(unknown)'
    const rowTokens = row.token_total ?? 0
    const existing = repoMap.get(repo)
    if (existing === undefined) {
      const modelTokens = new Map<string, number>()
      if (row.model) modelTokens.set(row.model, rowTokens)
      repoMap.set(repo, {
        tokens: rowTokens,
        cost: row.usd_cost ?? 0,
        traces: row.traces ?? 0,
        modelTokens,
      })
    } else {
      existing.tokens += rowTokens
      existing.cost += row.usd_cost ?? 0
      existing.traces += row.traces ?? 0
      // Accumulate per-model token totals for max selection
      if (row.model) {
        existing.modelTokens.set(
          row.model,
          (existing.modelTokens.get(row.model) ?? 0) + rowTokens
        )
      }
    }
  }

  return [...repoMap.entries()]
    .sort(([, a], [, b]) => b.tokens - a.tokens)
    .map(([repository, data]) => {
      // 15-B.7: Pick the model with the most accumulated tokens for this repo.
      // 16-D: Exclude sentinel/placeholder model names ('', 'unknown', 'null')
      // from the top-model competition. These entries (e.g. rows where
      // sh.model IS NULL in the DB) were out-massing named models and causing
      // every repo to display top_model="unknown". Token sums are unaffected —
      // only the topModel picker is filtered.
      let topModel = ''
      let topTokens = -1
      for (const [model, modelTokens] of data.modelTokens) {
        const normalized = model.toLowerCase().trim()
        if (
          normalized === '' ||
          normalized === 'unknown' ||
          normalized === 'null'
        ) {
          continue
        }
        if (modelTokens > topTokens) {
          topTokens = modelTokens
          topModel = model
        }
      }
      return {
        repository,
        tokens: data.tokens,
        cost_usd: data.cost,
        traces: data.traces,
        top_model: topModel,
        spark: sparkByRepo.get(repository) ?? [data.tokens],
      }
    })
}

/**
 * Builds ModelRow[] for MasterLedgerTable from providerStatusUsage rows
 * aggregated by provider+model key.
 *
 * Wave 15-B fixes:
 * - 15-B.3: real token_in / token_out aggregated from usageRows (report.rows)
 *   grouped by provider+model, replacing the fake 60/40 split of token_total.
 * - 15-B.4: upstream_p50_ms wired from healthRows (was always null/0).
 * - 15-B.5: quota_pct computed from quotaRows (was always hardcoded 0).
 */
function buildModelRows(
  rows: {
    provider: string
    model: string
    traces: number
    token_total: number
    usd_cost: number
  }[],
  healthRows: UsageReportProviderLatencyHealthRow[],
  usageRows: UsageReportRow[],
  quotaRows: UsageReportQuotaRow[],
  trendRows: UsageReportTrendRow[],
  toolActivityRows: UsageReportToolActivityRow[] = []
): ModelRow[] {
  // 15-B.3: Aggregate real token_in / token_out from report.rows by provider+model.
  // providerStatusUsage (the `rows` param) lacks per-direction token fields;
  // report.rows has them and uses group_by=provider,model,repository so we sum
  // across all repository buckets.
  // 15-B.2: normalise via canonicalProvider so 'google' rows in report.rows
  // always key as 'google' (not 'gemini'), matching providerStatusUsage keys.
  //
  // 20-PhosphorDash Fix ⚠-W19-2: also accumulate token_cache_input and
  // token_cache_creation per provider+model so we can compute cache_pct.
  // cache_pct = (cache_input + cache_creation) / token_in × 100.
  // We use token_in (not token_total) as the denominator because cache tokens
  // are measured relative to input tokens processed.
  // 26-Bundle (operator F#12): extend per-key accumulator with cache_miss and
  // reasoning fields so they can be surfaced in the new ledger columns.
  const tokensByKey = new Map<
    string,
    {
      token_in: number
      token_out: number
      cache_input: number
      cache_creation: number
      cache_miss_usd: number
      reasoning_reported: number
      reasoning_estimated: number
    }
  >()
  for (const r of usageRows) {
    const p = canonicalProvider(r.provider ?? '')
    const m = (r.model ?? '').toLowerCase()
    if (!p || !m) continue
    const key = `${p}::${m}`
    const existing = tokensByKey.get(key)
    const tin = r.token_in ?? 0
    const tout = r.token_out ?? 0
    const ci = r.token_cache_input ?? 0
    const cc = r.token_cache_creation ?? 0
    const cm_usd = r.cache_miss_usd_cost ?? 0
    const rr = r.token_reasoning_reported ?? 0
    const re = r.token_reasoning_estimated ?? 0
    if (existing === undefined) {
      tokensByKey.set(key, {
        token_in: tin,
        token_out: tout,
        cache_input: ci,
        cache_creation: cc,
        cache_miss_usd: cm_usd,
        reasoning_reported: rr,
        reasoning_estimated: re,
      })
    } else {
      existing.token_in += tin
      existing.token_out += tout
      existing.cache_input += ci
      existing.cache_creation += cc
      existing.cache_miss_usd += cm_usd
      existing.reasoning_reported += rr
      existing.reasoning_estimated += re
    }
  }

  // quotaRows param retained in signature for backward compat with call-sites
  // but quota_pct column removed (Wave 26, operator F#13).
  void quotaRows

  // Build per-(provider, model) sparkline series from trend data (24h buckets).
  // Sort chronologically so the polyline reads left-to-right oldest-to-newest.
  // Key mirrors tokensByKey: canonicalProvider + model lowercase.
  const sortedTrendRows = [...trendRows].sort((a, b) =>
    a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0
  )
  const sparkByKey = new Map<string, number[]>()
  for (const t of sortedTrendRows) {
    const p = canonicalProvider(t.provider ?? '')
    const m = (t.model ?? '').toLowerCase()
    if (!p || !m) continue
    const sparkKey = `${p}::${m}`
    const arr = sparkByKey.get(sparkKey) ?? []
    arr.push(t.token_total)
    sparkByKey.set(sparkKey, arr)
  }

  // Group health data by provider+model for latency lookups
  // 15-B.4: also accumulate upstream_p50_ms (previously always left null)
  const healthByKey = new Map<
    string,
    {
      p50: number | null
      p95: number | null
      errors: number
      requests: number
    }
  >()
  for (const row of healthRows) {
    // 15-B.2: normalise health provider key via alias map so 'gemini' rows
    // map to canonical 'google' (health view uses 'gemini'; providerStatusUsage
    // and report.rows use 'google' — the canonical key).
    const canonical = canonicalProvider(row.provider)
    const key = `${canonical}::${row.model}`
    const existing = healthByKey.get(key)
    const errors =
      row.provider_error_events +
      row.provider_5xx_events +
      row.provider_timeout_events
    if (existing === undefined) {
      healthByKey.set(key, {
        // 15-B.4: seed p50 from the first (most-recent) row with a non-null value
        p50: row.upstream_p50_ms,
        p95: row.upstream_p95_ms,
        errors,
        requests: row.requests,
      })
    } else {
      existing.errors += errors
      existing.requests += row.requests
      // 15-B.4: take max p50/p95 across all health buckets for this model key
      if (row.upstream_p50_ms !== null) {
        existing.p50 =
          existing.p50 !== null
            ? Math.max(existing.p50, row.upstream_p50_ms)
            : row.upstream_p50_ms
      }
      if (row.upstream_p95_ms !== null) {
        existing.p95 =
          existing.p95 !== null
            ? Math.max(existing.p95, row.upstream_p95_ms)
            : row.upstream_p95_ms
      }
    }
  }

  // W33: Build a lookup of toolActivity rows indexed by "provider::model" so
  // each ModelRow can quickly retrieve its pre-processed tool activity data.
  // Keys use lowercase provider + model to match tokensByKey and healthByKey.
  const toolActivityByKey = new Map<string, UsageReportToolActivityRow[]>()
  for (const ta of toolActivityRows) {
    const taKey = `${ta.provider.toLowerCase()}::${ta.model.toLowerCase()}`
    const existing = toolActivityByKey.get(taKey)
    if (existing === undefined) {
      toolActivityByKey.set(taKey, [ta])
    } else {
      existing.push(ta)
    }
  }

  return rows.map((row) => {
    const providerKey = row.provider.toLowerCase()
    const modelKey = row.model.toLowerCase()
    const key = `${providerKey}::${modelKey}`
    const health = healthByKey.get(key)
    const requests = health?.requests ?? row.traces
    const errors = health?.errors ?? 0
    const errorPct = requests > 0 ? (errors / requests) * 100 : 0
    const costPer1k =
      row.token_total > 0 ? (row.usd_cost / row.token_total) * 1000 : 0

    // 15-B.3: use real per-direction tokens from report.rows; fall back to
    // 60/40 split only when the usage rows don't have coverage for this model
    // (e.g. providerStatusUsage has data but report.rows cap was hit)
    const tokenAgg = tokensByKey.get(key)
    const tokens_in = tokenAgg?.token_in ?? Math.round(row.token_total * 0.6)
    const tokens_out = tokenAgg?.token_out ?? Math.round(row.token_total * 0.4)

    // 20-PhosphorDash Fix ⚠-W19-2: compute cache_pct from aggregated cache
    // tokens. Formula: (cache_input + cache_creation) / token_in × 100.
    // Returns null (rendered as '—') when token_in is zero or data unavailable.
    let cache_pct: number | null = null
    if (tokenAgg !== undefined && tokenAgg.token_in > 0) {
      const cacheTokens = tokenAgg.cache_input + tokenAgg.cache_creation
      cache_pct = Math.round((cacheTokens / tokenAgg.token_in) * 1000) / 10
    }

    // 26-Bundle (operator F#12): derive cache_miss_pct + populate new fields.
    // cache_miss_pct: best-effort — use cache_miss_usd / usd_cost * 100 when
    // both are positive; otherwise undefined so table shows '—'.
    const cache_miss_usd_cost =
      tokenAgg !== undefined ? tokenAgg.cache_miss_usd : undefined
    let cache_miss_pct: number | undefined
    if (
      cache_miss_usd_cost !== undefined &&
      cache_miss_usd_cost > 0 &&
      row.usd_cost > 0
    ) {
      cache_miss_pct =
        Math.round((cache_miss_usd_cost / row.usd_cost) * 1000) / 10
    }
    const reasoning_reported =
      tokenAgg !== undefined ? tokenAgg.reasoning_reported : undefined
    const reasoning_estimated =
      tokenAgg !== undefined ? tokenAgg.reasoning_estimated : undefined

    // W33: pre-processed tool activity for the TOOL cell hover tooltip.
    // buildToolActivity returns a zero-calls result when no rows are found,
    // so undefined is only stored when the lookup is empty (no API data).
    // W34: also derive the scalar `tool` field from totalCalls so the TOOL
    // cell renders the count instead of '—' (wave34-data-flow-audit Critical #4).
    const rowToolActivity = toolActivityByKey.has(key)
      ? buildToolActivity(toolActivityByKey.get(key) ?? [])
      : undefined

    return {
      model: row.model,
      provider: row.provider,
      tokens_in,
      tokens_out,
      requests,
      p50_ms: health?.p50 ?? 0, // 15-B.4: wired upstream_p50_ms
      p95_ms: health?.p95 ?? 0,
      error_pct: Math.round(errorPct * 10) / 10,
      cost_usd: row.usd_cost,
      cost_per_1k: Math.round(costPer1k * 10000) / 10000,
      // quota_pct removed — Wave 26 operator F#13
      cache_pct: cache_pct ?? undefined, // 20-PhosphorDash: null → undefined for optional field
      // 26-Bundle (operator F#12): cache miss + reasoning fields
      cache_miss_pct,
      cache_miss_usd_cost:
        cache_miss_usd_cost !== undefined ? cache_miss_usd_cost : undefined,
      reasoning_reported:
        reasoning_reported !== undefined ? reasoning_reported : undefined,
      reasoning_estimated:
        reasoning_estimated !== undefined ? reasoning_estimated : undefined,
      // Wave 30 operator reorder: total cache tokens for new Cache toks column
      cache_toks:
        tokenAgg !== undefined
          ? tokenAgg.cache_input + tokenAgg.cache_creation
          : undefined,
      spark: sparkByKey.get(
        `${canonicalProvider(row.provider)}::${modelKey}`
      ) ?? [row.token_total],
      tool: rowToolActivity?.totalCalls,
      toolActivity: rowToolActivity,
    }
  })
}

// ---------------------------------------------------------------------------
// Client family aggregation (operator F7)
// ---------------------------------------------------------------------------

/**
 * Maps raw client_name variants → canonical { family, provider }.
 *
 * Wave 24-PhosphorDash (operator F7): collapses all observed client_name
 * variants (from live API + test fixtures) into four display families so the
 * Client Adoption chart matches the mockup. The normalization key is produced
 * by `normalizeClientKey()` which lowercases, trims, and collapses hyphens,
 * underscores and spaces to a single space.
 *
 * Observed live variants:
 *   claude-code, claude_code, claude-cli    → 'claude code' / anthropic
 *   codex, codex-cli, codex-exec, codex-tui → 'codex'       / openai
 *   gemini, gemini-cli                       → 'gemini'      / google
 *   grok-build, grok-cli, grok              → 'grok build'  / xai
 *   cursor                                   → 'cursor'      / openai (brand hex)
 *   aider                                    → 'aider'       / local  (brand hex)
 */
const CLIENT_FAMILY_MAP: Record<string, { family: string; provider: string }> =
  {
    // Anthropic / Claude Code
    'claude code': { family: 'claude code', provider: 'anthropic' },
    'claude cli': { family: 'claude code', provider: 'anthropic' },
    // OpenAI / Codex
    codex: { family: 'codex', provider: 'openai' },
    'codex cli': { family: 'codex', provider: 'openai' },
    'codex exec': { family: 'codex', provider: 'openai' },
    'codex tui': { family: 'codex', provider: 'openai' },
    // Google / Gemini
    gemini: { family: 'gemini', provider: 'google' },
    'gemini cli': { family: 'gemini', provider: 'google' },
    // xAI / Grok Build
    'grok build': { family: 'grok build', provider: 'xai' },
    'grok cli': { family: 'grok build', provider: 'xai' },
    grok: { family: 'grok build', provider: 'xai' },
    // Cursor (standalone; use openai brand hex as its color)
    cursor: { family: 'cursor', provider: 'openai' },
    // Aider (standalone; use local brand hex as its color)
    aider: { family: 'aider', provider: 'local' },
  }

/**
 * Normalizes a raw client_name to a lookup key for CLIENT_FAMILY_MAP.
 * Lowercases, trims, and collapses all hyphens / underscores / spaces to a
 * single ASCII space so that 'claude-code', 'claude_code', 'Claude Code' all
 * map to 'claude code'.
 */
function normalizeClientKey(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[-_ ]+/g, ' ')
}

/**
 * Returns the CSS color to use for a client family.
 *
 * Priority (F7):
 *   1. PROVIDER_BRAND_HEX[provider] from CLIENT_FAMILY_MAP entry.
 *   2. CLIENT_BRAND_COLORS[rawClientName] legacy lookup.
 *   3. clientColorFor hash fallback.
 */
function clientFamilyColor(
  rawName: string,
  provider: string | undefined
): string {
  if (provider !== undefined) {
    const brandHex = PROVIDER_BRAND_HEX[provider]
    if (brandHex !== undefined) return brandHex
  }
  return CLIENT_BRAND_COLORS[rawName] ?? clientColorFor(rawName)
}

/**
 * Aggregates a flat list of client rows into family buckets.
 *
 * Wave 24-PhosphorDash (operator F7): collapses 'claude-code', 'claude_code',
 * etc. into a single 'claude code' entry, deriving color from provider brand.
 * Unknown client_name variants are left as-is (ungrouped) so new clients that
 * don't appear in CLIENT_FAMILY_MAP still surface rather than disappear.
 */
function aggregateByClientFamily(
  clients: {
    client_name: string
    traces: number
    token_total: number
    usd_cost: number
    client_version?: string
  }[]
): {
  family: string
  provider: string | undefined
  traces: number
  token_total: number
  usd_cost: number
}[] {
  const buckets = new Map<
    string,
    {
      family: string
      provider: string | undefined
      traces: number
      token_total: number
      usd_cost: number
    }
  >()

  for (const c of clients) {
    const key = normalizeClientKey(c.client_name)
    const mapping = CLIENT_FAMILY_MAP[key]
    const family = mapping?.family ?? c.client_name
    const provider = mapping?.provider
    const bucketKey = family // one bucket per family

    const existing = buckets.get(bucketKey)
    if (existing === undefined) {
      buckets.set(bucketKey, {
        family,
        provider,
        traces: c.traces,
        token_total: c.token_total,
        usd_cost: c.usd_cost,
      })
    } else {
      existing.traces += c.traces
      existing.token_total += c.token_total
      existing.usd_cost += c.usd_cost
    }
  }

  return [...buckets.values()]
}

/**
 * Builds DonutChart SliceConfig[] from client usage data.
 *
 * Wave 24-PhosphorDash (operator F7): aggregates raw client_name variants into
 * canonical families (claude code, codex, gemini, grok build) before slicing.
 * Colors are derived from PROVIDER_BRAND_HEX for the family's provider.
 */
function buildClientSlices(
  clients: {
    client_name: string
    token_total: number
  }[]
): SliceConfig[] {
  const families = aggregateByClientFamily(
    clients.map((c) => ({
      client_name: c.client_name,
      traces: 0,
      token_total: c.token_total,
      usd_cost: 0,
    }))
  )
  return families
    .filter((f) => f.token_total > 0)
    .sort((a, b) => b.token_total - a.token_total)
    .slice(0, 7)
    .map((f) => ({
      client: f.family,
      tokens: f.token_total,
      color: clientFamilyColor(f.family, f.provider),
    }))
}

/**
 * Builds ClientRow[] for ClientBreakdownTable from API client rows.
 *
 * Wave 24-PhosphorDash (operator F7): previously aggregated raw client_name
 * variants into canonical families before building rows. The donut chart
 * (buildClientSlices) retains that family-collapsed behavior.
 *
 * Wave 25-PhosphorDash (operator F#12): the breakout TABLE now emits one row
 * per (client_name, client_version) tuple from the raw API response so
 * individual versions are visible. Each row is still colored by its resolved
 * CLIENT_FAMILY_MAP provider so the visual grouping is preserved.
 *
 * Wave 35 cycle-2 (⚠-4): removed degenerate `spark: [c.token_total]` field.
 * The sparkline column was removed from ClientBreakdownTable in Wave 18 (§6.1).
 * The `spark` field was dead code — ClientRow does not include it and the column
 * was never rendered. Removed to eliminate the misleading placeholder.
 */
function buildClientRows(
  clients: {
    client_name: string
    client_version: string
    first_seen_at?: string | null
    last_seen_at?: string | null
    traces: number
    token_total: number
    usd_cost: number
  }[]
): ClientRow[] {
  return clients
    .slice()
    .sort((a, b) => b.token_total - a.token_total)
    .map((c) => {
      const key = normalizeClientKey(c.client_name)
      const mapping = CLIENT_FAMILY_MAP[key]
      // W31: Parse first_seen_at ISO string → YYYY-MM-DD compact date.
      // Null / undefined / unparseable → empty string (cell renders blank).
      const firstSeen =
        c.first_seen_at != null
          ? new Date(c.first_seen_at).toISOString().slice(0, 10)
          : ''
      // W32: Parse last_seen_at ISO string → YYYY-MM-DD compact date.
      // Null / undefined / unparseable → empty string (cell renders blank).
      const lastSeen =
        c.last_seen_at != null
          ? new Date(c.last_seen_at).toISOString().slice(0, 10)
          : ''
      return {
        client: c.client_name,
        version: c.client_version,
        first_seen: firstSeen,
        last_seen: lastSeen,
        requests: c.traces,
        tokens: c.token_total,
        cost_usd: c.usd_cost,
        // Color by family provider so visual grouping survives the un-collapse.
        color: clientFamilyColor(c.client_name, mapping?.provider),
        // family exposed for tests / W25-ClientTable consumption.
        family: mapping?.family ?? c.client_name,
      }
    })
}

/**
 * Builds TopModelRow[] for ProviderCard card-pane-right at 4K.
 * Groups providerStatusUsage by provider+model and returns top 3 by tokens.
 *
 * Wave 18-Cards C3: populates `p95_ms` from the latest non-null
 * `upstream_p95_ms` in `healthRows` matching provider+model, fixing the
 * prior bug where the `.p95` cell displayed request count instead of latency.
 */
function buildTopModels(
  rows: {
    provider: string
    model: string
    token_total: number
    usd_cost: number
    traces: number
  }[],
  provider: string,
  healthRows: UsageReportProviderLatencyHealthRow[]
): TopModelRow[] {
  // 20-PhosphorDash Fix ⚠-W19-1: canonicalize the target provider so that
  // callers passing 'google' correctly match health rows stored as 'gemini'.
  // Without this, all Google top-model .p95 cells render '0ms' despite real
  // latency data being available in providerLatencyHealth.
  const targetCanonical = canonicalProvider(provider)

  return rows
    .filter((r) => r.provider.toLowerCase() === provider.toLowerCase())
    .sort((a, b) => b.token_total - a.token_total)
    .slice(0, 3)
    .map((r) => {
      // Look up the most-recent health row with a non-null p95 for this
      // provider+model combination. healthRows are ordered bucket_start DESC
      // (newest first per 15-B.1), so the first match is the most recent.
      // canonicalProvider on the health row's provider handles the
      // 'gemini' → 'google' alias transparently.
      const lowerModel = r.model.toLowerCase()
      const matchingHealthRow = healthRows.find(
        (h) =>
          canonicalProvider(h.provider) === targetCanonical &&
          h.model.toLowerCase() === lowerModel &&
          h.upstream_p95_ms !== null
      )
      return {
        model: r.model,
        tokens: r.token_total,
        cost_usd: r.usd_cost,
        requests: r.traces,
        p95_ms: matchingHealthRow?.upstream_p95_ms ?? null,
      }
    })
}

// ---------------------------------------------------------------------------
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
  showComparison = false,
  quotas: quotasProp,
}: PhosphorDashboardProps): ReactElement {
  const defaults = useMemo(() => _localFallbackRange(), [])
  const resolvedFrom = from ?? defaults.from
  const resolvedTo = to ?? defaults.to
  const resolvedGrain: UsageReportGrain = grain ?? 'day'

  // Wave 36 Fix 1: the /usage query is hoisted to index.tsx so a single HTTP
  // request is shared across the whole dashboard. This internal query is ONLY
  // used when PhosphorDashboard is rendered in isolation (e.g. Storybook, tests)
  // without a parent supplying `report` + `reportLoading` props.
  const internalQueryEnabled = reportProp === undefined
  const { data: internalReport, isLoading: internalLoading } = useQuery({
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
  })

  // Resolve the effective report + loading state: prefer parent-supplied values
  // (Fix 1 dedup); fall back to the internal query for standalone usage.
  const report = reportProp ?? internalReport
  const reportLoading = internalQueryEnabled
    ? internalLoading
    : reportLoadingProp

  // 15-C.5 / Wave 37 SF-1: Include resolvedFrom/resolvedTo in the queryKey so
  // the quotas query re-fetches when the user changes the date range. The
  // /api/shell/reports/quotas endpoint does not currently accept from/to params
  // (server-side it is a live snapshot from rate_limit_intervals). This wiring
  // ensures the query invalidates on period changes, ready for when the API
  // supports date-scoped quotas.
  //
  // Wave 37 SF-1: this query is ONLY used when PhosphorDashboard is rendered
  // in isolation (e.g. Storybook, tests) without a parent supplying `quotas`.
  // index.tsx now hoists this query with the same key shape so React Query
  // deduplicates both subscribers into a single cache entry.
  const internalQuotasEnabled = quotasProp === undefined
  const { data: quotasData } = useQuery({
    queryKey: ['usage-report-quotas', resolvedFrom, resolvedTo],
    queryFn: fetchUsageReportQuotas,
    // Skip when the parent has already provided quota rows.
    enabled: internalQuotasEnabled,
    // W38-2: match the staleTime override used by index.tsx so Storybook /
    // standalone behaviour is consistent with production (index.tsx sets
    // staleTime: 5 * 60 * 1000 on its hoisted copy of this query).
    staleTime: 5 * 60 * 1000,
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

  const providers = useMemo(() => deriveProviders(), [])

  // Wave 37 SF-1: prefer parent-supplied quotas (dedup fix); fall back to the
  // internal quotasData query result (standalone usage) then report?.quotas.
  const quotaRows = useMemo(
    () => quotasProp ?? quotasData?.quotas ?? report?.quotas ?? [],
    [quotasProp, quotasData?.quotas, report?.quotas]
  )

  const repoRows = useMemo(
    () => buildRepoRows(report?.rows ?? [], report?.trend ?? []),
    [report?.rows, report?.trend]
  )

  const modelRows = useMemo(
    () =>
      buildModelRows(
        report?.providerStatusUsage ?? [],
        report?.providerLatencyHealth ?? [],
        report?.rows ?? [], // 15-B.3: real token_in/token_out
        quotaRows, // 15-B.5: quota_pct from quota rows
        report?.trend ?? [], // Wave 30 Track 4: real 24h sparkline data
        report?.toolActivity ?? [] // W33: tool activity for TOOL cell hover
      ),
    [
      report?.providerStatusUsage,
      report?.providerLatencyHealth,
      report?.rows,
      quotaRows,
      report?.trend,
      report?.toolActivity,
    ]
  )

  const clientSlices = useMemo(
    () =>
      buildClientSlices(
        (report?.clients ?? []).map((c) => ({
          client_name: c.client_name,
          token_total: c.token_total,
        }))
      ),
    [report?.clients]
  )

  const clientRows = useMemo(
    () => buildClientRows(report?.clients ?? []),
    [report?.clients]
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

  // 15-C.4: Client-side search filtering for Model Ledger, Repo Breakdown,
  // and Client Usage tables. Case-insensitive substring match on the primary
  // name field for each row type. When searchTerm is empty all rows are shown.
  const lowerSearch = searchTerm.toLowerCase()
  const filteredModelRows = useMemo(
    () =>
      lowerSearch === ''
        ? modelRows
        : modelRows.filter((r) => r.model.toLowerCase().includes(lowerSearch)),
    [modelRows, lowerSearch]
  )

  const providerErrorObservations = useMemo(
    (): UsageReportProviderErrorObservationRow[] =>
      report?.providerErrorObservations ?? [],
    [report?.providerErrorObservations]
  )
  const filteredRepoRows = useMemo(
    () =>
      lowerSearch === ''
        ? repoRows
        : repoRows.filter((r) =>
            r.repository.toLowerCase().includes(lowerSearch)
          ),
    [repoRows, lowerSearch]
  )
  const filteredClientRows = useMemo(
    () =>
      lowerSearch === ''
        ? clientRows
        : clientRows.filter((r) =>
            r.client.toLowerCase().includes(lowerSearch)
          ),
    [clientRows, lowerSearch]
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
  const aggregateConfig: ProviderCardConfig = {
    provider: 'Σ Aggregate Totals',
    color: 'var(--accent-chrome)',
  }

  const aggregateHealthCells = useMemo(
    () => padHealthCells(healthRows, ''),
    [healthRows]
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
  const { data: priorReport } = useQuery({
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
      {/* ── TOKENS ────────────────────────────────────────────────────── */}
      {/* Wave 35 C3 fix: moved above STATUS so the trend chart appears   */}
      {/* within the visible viewport at 2275×1280 without scrolling.     */}
      {/* Previously at y=1314px (34px below the 1280px fold) because the */}
      {/* 920px-tall provider-card row pushed it fully below the fold.     */}
      <section
        id='tokens'
        data-tab='tokens'
        aria-labelledby='section-tokens-heading'
      >
        <SectionTitle id='section-tokens-heading'>
          Token Trend · Stacked by Provider · 24h
        </SectionTitle>
        {reportLoading ? (
          <SectionSkeleton height={120} />
        ) : (
          <TokenTrendChart data={trendData} series={PROVIDER_SERIES} />
        )}
      </section>

      {/* ── STATUS (Provider Health Summary) ─────────────────────────── */}
      {/* Wave 11 PR1 (11-b): provider cards move here from #models.     */}
      {/* D3: AggregateCard injected as the last peer in the grid;       */}
      {/* CSS hides it below 2100px (see provider-card.module.css).      */}
      <section
        id='status'
        data-tab='status'
        aria-labelledby='section-status-heading'
      >
        <SectionTitle id='section-status-heading'>
          Provider Health Summary
        </SectionTitle>
        {reportLoading ? (
          <SectionSkeleton height={120} />
        ) : (
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
              const cells = padHealthCells(healthRows, provider)
              // Wave 41: build structured QuotaLane[] for providers with lane
              // definitions (anthropic, openai, google, xai). Each lane groups
              // the current bar + prior bars for a single quota type side-by-side.
              // Providers without lane defs (nvidia_nim, openrouter, local) fall
              // back to the flat quotaIntervals path via quotas prop.
              const lanes = buildProviderLanes(
                provider,
                quotaRows,
                report?.quotaHistory ?? []
              )
              // Flat quota list is still needed for providers without lane defs.
              const currentBars =
                lanes.length === 0 ? buildQuotaRows(provider, quotaRows) : []
              const historyBars =
                lanes.length === 0
                  ? buildHistoryBarsForProvider(
                      provider,
                      report?.quotaHistory ?? [],
                      currentBars
                    )
                  : []
              const quotaIntervals =
                lanes.length === 0 ? [...currentBars, ...historyBars] : []
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
                  quotas={quotaIntervals}
                  lanes={lanes.length > 0 ? lanes : undefined}
                  anomalies={anomalies}
                  topModels={topModels}
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
                recentErrors: healthRows.reduce(
                  (s, r) =>
                    s +
                    r.provider_error_events +
                    r.provider_5xx_events +
                    r.provider_timeout_events,
                  0
                ),
              }}
              anomalies={anomalies}
            />
          </div>
        )}
      </section>

      {/* ── MODEL LEDGER + REPOSITORY BREAKDOWN (side-by-side ≥1600px) ── */}
      {/* Wave 11 PR1 (11-b, 11-c): ledger moves from #health → #models; */}
      {/* repo stays in #repos; both wrapped for 8fr/4fr grid at 1600px+. */}
      <div className={styles['ledger-repo-row']}>
        <section
          id='models'
          data-tab='models'
          aria-labelledby='section-models-heading'
        >
          <SectionTitle id='section-models-heading'>Model Ledger</SectionTitle>
          {reportLoading ? (
            <SectionSkeleton height={200} />
          ) : (
            // 15-C.4: use filteredModelRows to apply searchTerm filter
            // Q8: pass providerErrorObservations for Err% hover tooltip
            <MasterLedgerTable
              rows={filteredModelRows}
              errorObservations={providerErrorObservations}
            />
          )}
        </section>

        <section
          id='repos'
          data-tab='repos'
          aria-labelledby='section-repos-heading'
        >
          <SectionTitle id='section-repos-heading'>
            Repository Breakdown
          </SectionTitle>
          {reportLoading ? (
            <SectionSkeleton height={120} />
          ) : (
            // 15-C.4: use filteredRepoRows to apply searchTerm filter
            <RepoBreakdownTable rows={filteredRepoRows} />
          )}
        </section>
      </div>

      {/* ── CLIENTS ───────────────────────────────────────────────────── */}
      <section
        id='clients'
        data-tab='clients'
        aria-labelledby='section-clients-heading'
      >
        <SectionTitle id='section-clients-heading'>Client Usage</SectionTitle>
        {/* Wave 11 PR6 (11-o, C14): table caption */}
        <div
          className='table-caption'
          style={{
            fontSize: '9px',
            color: 'var(--fg-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            padding: '2px 0 4px',
          }}
        >
          By client · 24h aggregate
        </div>
        {reportLoading ? (
          <SectionSkeleton height={200} />
        ) : (
          <div
            className='client-section'
            style={{
              display: 'grid',
              gridTemplateColumns: '140px 1fr',
              gap: '4px',
            }}
          >
            <div className='client-donut'>
              <DonutChart slices={clientSlices} />
            </div>
            <div className='client-table-wrapper'>
              {/* 15-C.4: use filteredClientRows to apply searchTerm filter */}
              <ClientBreakdownTable rows={filteredClientRows} />
            </div>
          </div>
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
        <SectionTitle id='section-comparison-heading'>
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
