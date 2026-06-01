/**
 * ProviderCard — per-provider metrics card for Phosphor Atlas dashboard.
 *
 * Wave 9 changes (v9.7 reference parity):
 * - HealthStrip: vertical orientation, absolutely positioned right edge.
 *   Card reserves padding-right: 22px to avoid overlap.
 * - Header: border-bottom, font-weight 600 (was 700), letter-spacing 0.05em.
 * - Metric rows: provider-metric grid (1fr auto) pattern.
 * - Quota section: labeled rows with percent + reset columns around bar.
 * - TOKEN CACHE / REASONING: pc-sub-title + pc-mini-table pattern with
 *   dashed border-top on section title.
 * - card-pane-right at ≥3840px: per-model mini-table via topModels prop.
 *
 * Wave 14-C changes:
 * - Provider-name color reverted to var(--accent-chrome) per mockup line 1047.
 * - Provider-name fontSize removed (inherits clamp from .provider-card).
 * - 9-row metric grid per mockup lines 2424-2432.
 * - Token Cache labels lowercase: in/create/miss/miss $.
 * - miss $ row shows cache_miss_usd dollar value.
 * - Reasoning shown as reported+estimated total, with est-mark asterisk when
 *   estimated tokens contribute and a hover breakdown for reported/estimated.
 * - Recent request count derived from provider health buckets.
 *
 * Wave 20 changes (F2 / F3 / F6):
 * - F2: TOKEN CACHE + REASONING sections moved ABOVE Quotas per mockup line 2434.
 * - F3: Quota tooltip restructured: v9-tip-head (window · pct used),
 *       v9-tip-sub (velocity line), v9-tip-row × 3 (t-model / t-count).
 *       Data fields window/velocity/tipModels added to QuotaBarGroup as optional;
 *       missing fields render '—' placeholders when not yet populated.
 * - F6: cost cell in card-pane-right switched to toLocaleString() for comma
 *       formatting on values ≥ $1,000.
 *
 * Wave 26 changes (F2 / F8):
 * - F2: REQUESTS section (pc-sub-title + pc-mini-table) replaces the old
 *       'Requests' provider-metric row; contains requests + last-90m requests.
 *       TOKENS section (pc-sub-title + pc-mini-table) replaces the old TOKEN CACHE
 *       and REASONING blocks; contains in / out / cost / cache in / cache creation /
 *       cache miss $ / reasoning.
 *       Rows 1-3 (Requests, Tokens, Cost) removed from provider-metric grid.
 * - F8: Quota hover .t-model spans colored with providerBrandHex() for brand color.
 */
import type { ReactElement, ReactNode } from 'react'
import type { UsageReportLocalHealthRow } from '../api/usage-report'
import { fmtCompact } from '../lib/format-utils'
import {
  formatLatency,
  formatUsd,
  formatResetDistance,
  modelBrandHex,
  providerBrandHex,
} from '../lib/usage-report-display'
import { HealthStrip } from './primitives/health-strip'
import { QuotaIntervalBar } from './primitives/quota-interval-bar'
import { ReasoningTokenValue } from './primitives/reasoning-token-value'

// ---------------------------------------------------------------------------
// Types (exported for use by AggregateCard and dashboard)
// ---------------------------------------------------------------------------

/** Configuration for a provider card (display metadata). */
export interface ProviderCardConfig {
  provider: string
  color: string
}

/** Core metrics for a single provider. */
export interface ProviderMetrics {
  tokens_in: number
  tokens_out: number
  cost_usd: number
  requests: number
  errors: number
  p95_ms: number
  cache_input: number
  cache_creation: number
  /** Dollar cost of cache misses (from cache_miss_usd_cost API field). */
  cache_miss_usd: number
  reasoning_reported: number
  reasoning_estimated: number
  /** Requests observed in provider health buckets from the last 90 minutes. */
  recent_requests_90m: number
  traces: number
  /** Rate limit events from UsageReportProviderLatencyHealthRow.rate_limit_events. */
  rate_limits: number
  /** Capacity events from UsageReportProviderLatencyHealthRow.capacity_events. */
  capacity: number
  /**
   * Provider ping packet loss percentage.
   * From UsageReportProviderLatencyHealthRow.provider_ping_packet_loss_pct.
   * null when not probed.
   */
  packet_loss_pct: number | null
}

/** Interval configuration for one segment within a quota bar. */
export interface QuotaRowConfig {
  widthPct: number
  /** v9.7 threshold class: iv-0-5 | iv-5-10 | iv-10-25 | iv-25-50 | iv-50-p */
  severityClass: string
  highVelocity: boolean
  velocityClass?: string
  label?: string
  resetDate?: string
}

/**
 * A single top-model entry for quota tooltip v9-tip-row rows.
 *
 * Wave 20 F3: mirrors mockup v9-tip-row structure (t-model / t-count).
 */
export interface QuotaTipModel {
  model: string
  /** Signed dollar delta string, e.g. '+$24'. */
  costDelta: string
  /** Requests observed for this model during the bar's quota window. */
  requests?: number
  /** Requests observed for this model in the most recent 90 minutes. */
  recentRequests90m?: number
}

/**
 * A single quota-type bar (weekly / short / special / monthly) with its
 * pre-built N=100 segment array.
 *
 * Wave 11 PR3 (11-h, 11-i): replaces the old flat QuotaRowConfig[] prop so
 * the card can render multi-segment bars with per-bar label + tooltip.
 *
 * Wave 20 F3: added optional tooltip data fields (window, velocity, tipModels)
 * to support the mockup quota tooltip structure. Missing fields render '—'.
 *
 * Wave 40 multi-quota redesign: added `periodType` for stacked-lane grouping
 * and `timeAgoLabel` for "Xd ago" display on prior-reset history bars.
 *
 * Wave 41: `periodType` and `timeAgoLabel` preserved for backward compat with
 * existing tests; new lane rendering uses `QuotaLane` instead.
 */
export interface QuotaBarGroup {
  /** Human-readable quota type: 'Weekly' | 'Short' | 'Special' | 'Monthly'. */
  label: string
  /** 0–100: percentage of quota already consumed (100 − remaining). */
  consumedPct: number
  /** 0–100: raw remaining percentage from the API. */
  remainingPct: number
  /** ISO timestamp when the interval next resets, if known. */
  resetAt?: string
  /** N=100 equal-width percent segments. */
  segments: QuotaRowConfig[]
  /**
   * Human-readable window label for tooltip head, e.g. '−30m → now'.
   * Wired from buildQuotaIntervals (W24/W35). Optional: renders '—' when absent.
   */
  tipWindow?: string
  /**
   * Velocity line for tooltip sub, e.g. '+5%/30m  ≈  +9%/h'.
   * Wired from buildQuotaIntervals (W24/W35). Omitted entirely when absent (W35 S4).
   */
  tipVelocity?: string
  /**
   * Top 3 contributing models for tooltip rows.
   * Wired from buildQuotaIntervals (W24/W35). Optional: falls back to empty placeholder.
   */
  tipModels?: QuotaTipModel[]
  /** Total requests observed across the full quota-window breakdown. */
  tipRequestTotal?: number
  /** Total requests observed across those models in the most recent 90 minutes. */
  tipRecentRequestTotal90m?: number
  /**
   * Period type for prior-reset history bars used to group them into stacked
   * display lanes within the ProviderCard quota section.
   * Undefined for current active bars (rendered first, ungrouped).
   *
   * Wave 40: '5hr' maps to short/short_special; 'weekly' to weekly;
   * 'special' to weekly_special; 'monthly' to monthly.
   */
  periodType?: '5hr' | 'weekly' | 'special' | 'monthly'
  /**
   * Time-ago label for prior-reset history bars, e.g. '2d ago', '3h ago'.
   * When present, replaces formatResetDistance(resetAt) in the quota-row-reset
   * cell so past bars do not incorrectly display "now".
   *
   * Wave 40: derived from the 30-min-snapped period_start of each history row.
   */
  timeAgoLabel?: string
  /**
   * Compact date-range label for prior-reset history bars, e.g.
   * '5/19 10:00 → 5/20 10:00'. Shown as a subordinate sub-label below the
   * timeAgoLabel so operators can see the exact reset-window boundaries.
   *
   * Wave 43: derived from roundToNearest30Min(interval_start) →
   * roundToNearest30Min(expected_reset_at) in buildPriorBarFromHistory.
   * Undefined for current active bars.
   */
  dateRangeLabel?: string
}

/**
 * A single quota lane — one row in the provider card's quota section.
 *
 * Wave 41 multi-reset redesign: each lane represents one bucket of quota for
 * the provider (e.g., "All Models · 5hr", "Sonnet · 7d"). The lane holds:
 *   - `currentBar`: the currently-active reset bar, or null if not active.
 *   - `priorBars`: historical reset bars within the 1.5× lookback window,
 *     sorted newest-first. These bars are static (no animation).
 *
 * Rendered as a horizontal row: [lane label] [current bar] [prior bar...].
 */
export interface QuotaLane {
  /**
   * Stable identifier for this lane, e.g. 'anthropic/short' or
   * 'google/flash-lite'. Used as React key.
   */
  laneKey: string
  /**
   * Human-readable label displayed to the left of the bar row,
   * e.g. 'All Models · 5hr', 'Sonnet · 7d', 'Flash · 24h'.
   */
  laneLabel: string
  /**
   * The current active reset bar for this lane, or null when no active
   * interval is present (e.g. quota not yet reset or not observed).
   */
  currentBar: QuotaBarGroup | null
  /**
   * Prior reset bars for this lane, sorted newest-first.
   * Empty array when no history exists within the lookback window.
   */
  priorBars: QuotaBarGroup[]
}

/** Per-model mini-row for card-pane-right at ≥3840px. */
export interface TopModelRow {
  model: string
  tokens: number
  cost_usd: number
  requests: number
  /** Upstream P95 latency in ms; null when no matching health row. */
  p95_ms?: number | null
  sparkline?: number[]
}

/**
 * Anomaly flags raised by useAnomalyDetection.
 * earlyReset accepts both Set<string> (legacy ProviderCard contract)
 * and Map<string, {prior:string; current:string}> (hook output).
 */
export interface AnomalyFlags {
  earlyReset: Set<string> | Map<string, { prior: string; current: string }>
  cacheStale: boolean
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Check whether a provider is flagged in either Set or Map form. */
function hasEarlyReset(
  earlyReset: Set<string> | Map<string, { prior: string; current: string }>,
  provider: string
): boolean {
  return earlyReset.has(provider)
}

/** Format packet loss percentage as string. Returns '—' when null. */
function fmtPacketLoss(pct: number | null): string {
  if (pct === null) return '—'
  return `${pct.toFixed(1)}%`
}

function fmtRequestCount(count: number | undefined): string {
  if (count === undefined) return '—'
  return Math.round(count).toLocaleString()
}

function renderQuotaRequestTotals(
  quotaBar: QuotaBarGroup
): ReactElement | null {
  if (
    quotaBar.tipRequestTotal === undefined &&
    quotaBar.tipRecentRequestTotal90m === undefined
  ) {
    return null
  }

  return (
    <>
      {quotaBar.tipRequestTotal !== undefined && (
        <div
          className='v9-tip-row quota-tip-total'
          style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}
        >
          <span className='t-model'>requests</span>
          <span className='t-count'>
            {fmtRequestCount(quotaBar.tipRequestTotal)}
          </span>
        </div>
      )}
      {quotaBar.tipRecentRequestTotal90m !== undefined && (
        <div
          className='v9-tip-row quota-tip-total'
          style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}
        >
          <span className='t-model'>requests 90m</span>
          <span className='t-count'>
            {fmtRequestCount(quotaBar.tipRecentRequestTotal90m)}
          </span>
        </div>
      )}
    </>
  )
}

/**
 * Returns the CSS modifier class for a `.quota-row-pct` element based on
 * consumed percentage.
 *
 * Tier thresholds per mockup lines 1261-1264 (Section 10 #3):
 *   <10%   → cool (blue)
 *   10–25% → teal
 *   25–75% → warm (amber)
 *   ≥75%   → hot  (red)
 *
 * Wave 14-E.2: applied to `.quota-row-pct` so consumed% values are color-coded
 * by severity instead of rendering uniformly in the default foreground color.
 */
function pctSeverityClass(consumedPct: number): string {
  if (consumedPct >= 75) return 'hot'
  if (consumedPct >= 25) return 'warm'
  if (consumedPct >= 10) return 'teal'
  return 'cool'
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface PcSubTitleProps {
  title: string
}

/** Section sub-title with dashed border-top, amber color. */
function PcSubTitle({ title }: PcSubTitleProps): ReactElement {
  return (
    <div
      className='pc-sub-title'
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '10px',
        color: 'var(--accent-chrome)',
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        marginTop: '6px',
        marginBottom: '3px',
        paddingTop: '4px',
        borderTop: '1px dashed var(--border)',
      }}
    >
      {title}
    </div>
  )
}

interface PcMiniRowProps {
  label: string
  /** String or JSX value (e.g. with est-mark asterisk). */
  value: ReactNode
  valueMod?: 'cost' | 'muted' | undefined
}

/** Mini table row: label left, value right. */
function PcMiniRow({ label, value, valueMod }: PcMiniRowProps): ReactElement {
  const valueColor =
    valueMod === 'cost'
      ? 'var(--accent-warm)'
      : valueMod === 'muted'
        ? 'var(--fg-muted)'
        : 'var(--fg)'

  return (
    <div
      className='pc-mini-row'
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        columnGap: '6px',
        alignItems: 'baseline',
        fontFamily: 'var(--font-mono)',
        fontSize: '10px',
        color: 'var(--fg-muted)',
        padding: '1px 0',
      }}
    >
      <span className='label' style={{ color: 'var(--fg-muted)' }}>
        {label}
      </span>
      <span
        className={`value${valueMod !== undefined ? ` ${valueMod}` : ''}`}
        style={{
          textAlign: 'right',
          color: valueColor,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
    </div>
  )
}

function localHealthStatusLabel(
  status: UsageReportLocalHealthRow['status']
): string {
  if (status === 'green') return 'healthy'
  if (status === 'yellow') return 'warning'
  return 'down'
}

function LocalHealthIndicators({
  items,
}: {
  items: UsageReportLocalHealthRow[]
}): ReactElement | null {
  if (items.length === 0) return null

  return (
    <>
      <PcSubTitle title='LOCAL HEALTH' />
      <div className='local-health-list'>
        {items.map((item) => (
          <div
            key={`${item.category}-${item.key}`}
            className={`local-health-chip is-${item.status}`}
            title={[
              item.label,
              localHealthStatusLabel(item.status),
              item.detail,
              item.target,
            ]
              .filter(Boolean)
              .join(' · ')}
            aria-label={`${item.label}: ${localHealthStatusLabel(item.status)}`}
          >
            <span className='local-health-dot' aria-hidden='true' />
            <span className='local-health-label'>{item.label}</span>
          </div>
        ))}
      </div>
    </>
  )
}

interface QuotaSectionTitleProps {
  title: string
}

/** Quota section title with dashed border-top. */
function QuotaSectionTitle({ title }: QuotaSectionTitleProps): ReactElement {
  return (
    <div
      className='quota-section-title'
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '9px',
        color: 'var(--accent-chrome)',
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        marginTop: '6px',
        marginBottom: '3px',
        paddingTop: '4px',
        borderTop: '1px dashed var(--border)',
      }}
    >
      {title}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ProviderMetric — single primary metric row
// ---------------------------------------------------------------------------

interface ProviderMetricProps {
  label: string
  children: ReactNode
  /** When true, inherits error color on value (errors > 0 pattern). */
  valueColor?: string
}

/** Primary metric row matching mockup .provider-metric pattern. */
function ProviderMetric({
  label,
  children,
  valueColor,
}: ProviderMetricProps): ReactElement {
  return (
    <div
      className='provider-metric'
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: '4px',
        padding: '2px 0',
        color: 'var(--fg-muted)',
        fontSize: 'clamp(9px, 0.5vw, 13px)',
      }}
    >
      <span>{label}</span>
      <span
        className='provider-metric-value'
        style={{
          textAlign: 'right',
          color: valueColor ?? 'var(--fg)',
          fontWeight: 500,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {children}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ProviderCard
// ---------------------------------------------------------------------------

export interface ProviderCardProps {
  config: ProviderCardConfig
  data: ProviderMetrics
  healthCells: { color: string }[]
  /** Wave 11 PR3 (11-i): each entry is one quota-type bar with 100 segments. */
  quotas: QuotaBarGroup[]
  /**
   * Wave 41 multi-reset redesign: structured lane data for the quota section.
   * When provided, `lanes` takes precedence over `quotas` for rendering.
   * Each lane is one quota type (e.g. "All Models · 5hr") and contains
   * the current bar plus any prior reset bars for that type.
   */
  lanes?: QuotaLane[]
  anomalies?: AnomalyFlags
  /** Per-model mini-table rows shown in card-pane-right at ≥3840px. */
  topModels?: TopModelRow[]
  /** Local infrastructure and model health chips shown only on the Local card. */
  localHealthItems?: UsageReportLocalHealthRow[]
  /**
   * Additional class name(s) merged into the root `provider-card` div.
   * Used by AggregateCard to add the `aggregate` class for CSS targeting.
   */
  wrapperClassName?: string
  /**
   * Optional content rendered at the end of `card-pane-left`, after the
   * REASONING sub-section. Used by AggregateCard to inject FLEET ACTIVITY
   * inside the standard card layout flow.
   */
  extraPaneLeft?: ReactNode
}

/**
 * ProviderCard renders a Phosphor Atlas provider metrics panel.
 *
 * Layout (Wave 26 F2 order):
 *  - Absolutely positioned vertical HealthStrip at right edge (v9w1 update)
 *  - card-pane-left:
 *      1. REQUESTS section (pc-sub-title + pc-mini-table):
 *         requests / requests 90m
 *      2. 6 provider-metric rows: p95 Latency / Errors / Rate Limits /
 *         Capacity / Packet Loss / Status
 *      3. health-strip (via HealthStrip component, absolutely positioned)
 *      4. TOKENS section (pc-sub-title + pc-mini-table):
 *         in / out / cost / cache in / cache creation / cache miss $ /
 *         reasoning*
 *      5. Quotas section title + quota lanes (Wave 41) or quota-list (legacy)
 *  - card-pane-right (≥3840px): per-model mini-table
 *
 * Wave 26 F8: quota tip .t-model spans colored with providerBrandHex().
 * Wave 41: when `lanes` prop is supplied, renders structured lane rows with
 *   current + prior bars side-by-side per quota type instead of a flat list.
 */
export function ProviderCard({
  config,
  data,
  healthCells,
  quotas,
  lanes,
  anomalies,
  topModels = [],
  localHealthItems = [],
  wrapperClassName,
  extraPaneLeft,
}: ProviderCardProps): ReactElement {
  const showEarlyReset =
    anomalies !== undefined &&
    hasEarlyReset(anomalies.earlyReset, config.provider)
  const showCacheStale = anomalies?.cacheStale === true

  // 14-C.6: status is healthy unless errors are significant or data says otherwise.
  const isHealthy = data.errors === 0
  const statusColor = isHealthy
    ? providerBrandHex(config.provider)
    : 'var(--accent-hot)'
  const statusGlyph = isHealthy ? '✓' : '✗'

  const rootClassName = ['provider-card', wrapperClassName]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={rootClassName}
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 0,
        padding: '10px',
        paddingRight: '22px', // reserve space for vertical health strip
        maxWidth: '460px',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        fontSize: 'clamp(10px, 0.55vw, 14px)',
      }}
    >
      {/* Vertical HealthStrip — auto-tooltip uses bucket-level relative time and health metadata. */}
      <HealthStrip cells={healthCells} orientation='vertical' />

      {/* Header: provider name
          14-C.1: color is var(--accent-chrome) per mockup line 1047 (not brand hex).
          14-C.2: no fontSize — inherits clamp(10px, 0.55vw, 14px) from .provider-card.
          18-Cards: aggregate variant uses var(--fg) per mockup L980-982. Omit inline
          color when aggregate so the CSS rule `.provider-card.aggregate .provider-name
          { color: var(--fg) !important }` from W18-CSS can take effect.
      */}
      <div
        className='provider-name'
        style={{
          // Only set the inline accent color for non-aggregate cards.
          // Aggregate cards have wrapperClassName='aggregate' and mockup L980-982
          // specifies color: var(--fg) for that variant — handled via CSS class.
          ...(wrapperClassName !== 'aggregate' && {
            color: 'var(--accent-chrome)',
          }),
          fontWeight: 600,
          textTransform: 'uppercase',
          marginBottom: '6px',
          borderBottom: '1px solid var(--border)',
          paddingBottom: '4px',
          letterSpacing: '0.05em',
        }}
      >
        <span>{config.provider.toUpperCase()}</span>
      </div>

      {/* card-pane-left — metrics, quotas, sub-sections */}
      <div
        className='card-pane-left'
        style={{ display: 'flex', flexDirection: 'column' }}
      >
        {/*
         * Wave 26 F2: REQUESTS section replaces the old 'Requests' provider-metric
         * row. Contains selected-window requests total and last-90m request count.
         */}
        <PcSubTitle title='REQUESTS' />
        <div className='pc-mini-table'>
          <PcMiniRow label='requests' value={data.requests.toLocaleString()} />
          <PcMiniRow
            label='requests 90m'
            value={data.recent_requests_90m.toLocaleString()}
          />
        </div>

        {config.provider.toLowerCase() === 'local' ? (
          <LocalHealthIndicators items={localHealthItems} />
        ) : null}

        {/*
         * Wave 26 F2: Remaining 6 provider-metric rows (Requests, Tokens, Cost
         * moved out into REQUESTS and TOKENS sections above / below).
         * Order: p95 Latency, Errors, Rate Limits, Capacity, Packet Loss, Status.
         */}

        {/* p95 Latency (lowercase p per mockup) */}
        <ProviderMetric label='p95 Latency'>
          {formatLatency(data.p95_ms)}
        </ProviderMetric>

        {/* Errors */}
        <ProviderMetric
          label='Errors'
          valueColor={data.errors > 0 ? 'var(--accent-hot)' : 'var(--fg)'}
        >
          {data.errors.toLocaleString()}
        </ProviderMetric>

        {/* Rate Limits (from rate_limit_events health row field) */}
        <ProviderMetric label='Rate Limits'>
          {data.rate_limits.toLocaleString()}
        </ProviderMetric>

        {/* Capacity (from capacity_events health row field) */}
        <ProviderMetric label='Capacity'>
          {data.capacity.toLocaleString()}
        </ProviderMetric>

        {/* Packet Loss (from provider_ping_packet_loss_pct; null → '—') */}
        <ProviderMetric label='Packet Loss'>
          {fmtPacketLoss(data.packet_loss_pct)}
        </ProviderMetric>

        {/*
         * Status (14-C.4): brand hex ✓ for healthy, accent-hot ✗ otherwise.
         * This is the ONLY place in the card where provider brand color is applied
         * in the metric grid.
         */}
        <ProviderMetric label='Status'>
          <span style={{ color: statusColor }}>{statusGlyph}</span>
        </ProviderMetric>

        {/*
         * Wave 26 F2: TOKENS section consolidates the old TOKEN CACHE and REASONING
         * sub-sections, and absorbs the old Tokens + Cost provider-metric rows.
         * Order: in / out / cost / cache in / cache creation / cache miss $ /
         *        reasoning*
         */}
        <PcSubTitle title='TOKENS' />
        <div className='pc-mini-table'>
          {/* Token volume split: in / out */}
          <PcMiniRow label='in' value={fmtCompact(data.tokens_in)} />
          <PcMiniRow label='out' value={fmtCompact(data.tokens_out)} />
          {/* Cost (moved from old Row 3 of metric grid) */}
          <PcMiniRow
            label='cost'
            value={formatUsd(data.cost_usd)}
            valueMod='cost'
          />
          {/* Cache sub-rows (moved from old TOKEN CACHE section) */}
          <PcMiniRow label='cache in' value={fmtCompact(data.cache_input)} />
          <PcMiniRow
            label='cache creation'
            value={fmtCompact(data.cache_creation)}
          />
          <PcMiniRow
            label='cache miss $'
            value={formatUsd(data.cache_miss_usd)}
            valueMod='cost'
          />
          {/* Reasoning total: reported + estimated, with hover breakdown. */}
          <PcMiniRow
            label='reasoning'
            value={
              <ReasoningTokenValue
                reported={data.reasoning_reported}
                estimated={data.reasoning_estimated}
              />
            }
          />
        </div>

        {/*
         * QUOTAS section — Wave 11 PR3 (11-i): each bar uses 100 segments.
         * Wave 20 F2: moved BELOW Token Cache + Reasoning per mockup line 2434.
         * Wave 20 F3: tooltip restructured to match mockup v9-tip-quota structure:
         *   v9-tip-head: '{window} · {pct}% used'
         *   v9-tip-sub:  velocity line
         *   v9-tip-row × 3: top models with $delta
         *   Optional data fields render '—' when not yet populated.
         *
         * Wave 41 lane-based redesign (replaces Wave 40 flat list approach):
         * - When `lanes` prop is provided, each lane renders as a vertical stack:
         *   [lane label]
         *   [current bar — full width, animated]
         *   [prior bar 1 — full width, animated when velocity data exists, "Xh ago" label]
         *   [prior bar 2 — full width, animated when velocity data exists, "Xd ago" label]
         *   ...
         * - Lane label on the top (e.g., "All Models · 5hr", "Sonnet · 7d").
         * - Current bar is first; prior bars follow beneath and animate when velocity data exists.
         * - Prior bars have subtle left accent line + indent for visual hierarchy.
         * - Anomaly icons only on current bar.
         * - Falls back to legacy flat `quotas` list when `lanes` is not provided.
         */}
        {(lanes !== undefined ? lanes.length > 0 : quotas.length > 0) && (
          <>
            <QuotaSectionTitle title='Quotas' />
            {lanes !== undefined ? (
              /* ── Wave 41: structured lane rendering ── */
              <div
                className='quota-lanes'
                style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}
              >
                {lanes.map((lane) => {
                  const allBars: Array<{
                    bar: QuotaBarGroup
                    isPrior: boolean
                  }> = []
                  if (lane.currentBar !== null) {
                    allBars.push({ bar: lane.currentBar, isPrior: false })
                  }
                  for (const pb of lane.priorBars) {
                    allBars.push({ bar: pb, isPrior: true })
                  }
                  if (allBars.length === 0) return null

                  return (
                    <div
                      key={lane.laneKey}
                      className='quota-lane-row'
                      style={{ marginTop: '2px' }}
                    >
                      {/* Lane label: subtle, monospace, left-aligned */}
                      <div
                        className='quota-lane-label'
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '8.5px',
                          color: 'var(--accent-chrome)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.07em',
                          opacity: 0.7,
                          marginBottom: '2px',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {lane.laneLabel}
                      </div>
                      {/* Stacked bar rows: current bar first, then each prior bar as its own full-width row */}
                      <div
                        className='quota-lane-bars'
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '3px',
                        }}
                      >
                        {allBars.map(({ bar: quotaBar, isPrior }, barIdx) => {
                          const tipWindowStr = quotaBar.tipWindow ?? '—'
                          const tipHeadLabel = `${tipWindowStr} · ${quotaBar.consumedPct.toFixed(0)}% used`
                          const tipVelocity = quotaBar.tipVelocity
                          const tipModelRows =
                            quotaBar.tipModels !== undefined &&
                            quotaBar.tipModels.length > 0
                              ? quotaBar.tipModels.slice(0, 3)
                              : []
                          const tooltipContent = (
                            <>
                              <div className='v9-tip-head'>{tipHeadLabel}</div>
                              {tipVelocity !== undefined && (
                                <div className='v9-tip-sub'>{tipVelocity}</div>
                              )}
                              {renderQuotaRequestTotals(quotaBar)}
                              {tipModelRows.map((tm, mi) => (
                                <div key={mi} className='v9-tip-row'>
                                  <span
                                    className='t-model'
                                    style={{ color: modelBrandHex(tm.model) }}
                                  >
                                    {tm.model}
                                  </span>
                                  <span className='t-count'>
                                    {fmtRequestCount(tm.requests)} req
                                    {tm.recentRequests90m !== undefined
                                      ? ` · ${fmtRequestCount(tm.recentRequests90m)} 90m`
                                      : ''}
                                  </span>
                                  <span className='t-count'>
                                    {tm.costDelta}
                                  </span>
                                </div>
                              ))}
                              {tipModelRows.length === 0 && (
                                <div className='v9-tip-row'>
                                  <span className='t-model'>—</span>
                                  <span className='t-count'>—</span>
                                </div>
                              )}
                            </>
                          )
                          // Time display: current → "resets in Xh Ym"; prior → "Xh ago" / "Xd ago"
                          const resetDisplay =
                            isPrior && quotaBar.timeAgoLabel !== undefined
                              ? quotaBar.timeAgoLabel
                              : formatResetDistance(quotaBar.resetAt)

                          return (
                            <div
                              key={barIdx}
                              className={`quota-bar-slot ${isPrior ? 'is-prior-slot' : 'is-current-slot'}`}
                              style={{
                                /* Full-width row for every bar — current and prior alike */
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '1px',
                                /* Prior bars: subtle left accent line + indent to signal hierarchy */
                                ...(isPrior
                                  ? {
                                      paddingLeft: '6px',
                                      borderLeft:
                                        '2px solid var(--accent-chrome, rgba(255,255,255,0.12))',
                                      opacity: 0.72,
                                    }
                                  : {}),
                              }}
                            >
                              {/* Pct + reset time header above bar */}
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'baseline',
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: '8px',
                                  color: 'var(--fg-muted)',
                                  lineHeight: '1.2',
                                  gap: '2px',
                                }}
                              >
                                <span
                                  className={`quota-row-pct ${pctSeverityClass(quotaBar.consumedPct)}`}
                                  style={{ fontVariantNumeric: 'tabular-nums' }}
                                >
                                  {quotaBar.consumedPct.toFixed(0)}%
                                </span>
                                <span
                                  className='quota-row-reset'
                                  style={{
                                    fontSize: '7.5px',
                                    color: 'var(--fg-muted)',
                                    opacity: 0.7,
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    flexShrink: 1,
                                  }}
                                >
                                  {resetDisplay}
                                </span>
                                {/* Anomaly icons only on current bar */}
                                {!isPrior && showEarlyReset && (
                                  <span
                                    className='quota-anomaly-icon icon-reset'
                                    aria-label='early reset'
                                    title='Early quota reset detected'
                                    style={{ fontSize: '8px' }}
                                  >
                                    ⟲
                                  </span>
                                )}
                                {!isPrior && showCacheStale && (
                                  <span
                                    className='quota-anomaly-icon icon-cache'
                                    aria-label='cache stale'
                                    title='Cache data is stale'
                                    style={{ fontSize: '8px' }}
                                  >
                                    ⚠
                                  </span>
                                )}
                              </div>
                              {/* Date-range sub-label: prior bars only — shows exact window boundaries */}
                              {isPrior &&
                                quotaBar.dateRangeLabel !== undefined && (
                                  <span
                                    className='quota-row-date-range'
                                    style={{
                                      fontFamily: 'var(--font-mono)',
                                      fontSize: '6.5px',
                                      color: 'var(--fg-muted)',
                                      opacity: 0.55,
                                      whiteSpace: 'nowrap',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      lineHeight: '1.2',
                                      letterSpacing: '0.02em',
                                    }}
                                  >
                                    {quotaBar.dateRangeLabel}
                                  </span>
                                )}
                              {/* The actual quota bar — full width for both current and prior */}
                              <QuotaIntervalBar
                                intervals={quotaBar.segments}
                                tooltipContent={tooltipContent}
                                isPrior={isPrior}
                              />
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              /* ── Legacy flat quotas[] rendering (backward compat for tests) ── */
              (() => {
                // Partition into current (no periodType) vs prior history bars.
                const currentQuotas = quotas.filter(
                  (q) => q.periodType === undefined
                )
                const historyQuotas = quotas.filter(
                  (q) => q.periodType !== undefined
                )

                // Ordered lanes for prior-reset display.
                const LEGACY_LANE_ORDER: ReadonlyArray<
                  QuotaBarGroup['periodType']
                > = ['5hr', 'weekly', 'special', 'monthly']
                const LEGACY_LANE_LABEL: Readonly<Record<string, string>> = {
                  '5hr': '5hr resets',
                  weekly: 'weekly resets',
                  special: 'special resets',
                  monthly: 'monthly resets',
                }

                const renderLegacyBar = (
                  quotaBar: QuotaBarGroup,
                  i: number,
                  isPrior: boolean
                ): ReactElement => {
                  const tipWindowStr = quotaBar.tipWindow ?? '—'
                  const tipHeadLabel = `${tipWindowStr} · ${quotaBar.consumedPct.toFixed(0)}% used`
                  const tipVelocity = quotaBar.tipVelocity
                  const tipModelRows =
                    quotaBar.tipModels !== undefined &&
                    quotaBar.tipModels.length > 0
                      ? quotaBar.tipModels.slice(0, 3)
                      : []
                  const tooltipContent = (
                    <>
                      <div className='v9-tip-head'>{tipHeadLabel}</div>
                      {tipVelocity !== undefined && (
                        <div className='v9-tip-sub'>{tipVelocity}</div>
                      )}
                      {renderQuotaRequestTotals(quotaBar)}
                      {tipModelRows.map((tm, mi) => (
                        <div key={mi} className='v9-tip-row'>
                          <span
                            className='t-model'
                            style={{ color: modelBrandHex(tm.model) }}
                          >
                            {tm.model}
                          </span>
                          <span className='t-count'>
                            {fmtRequestCount(tm.requests)} req
                            {tm.recentRequests90m !== undefined
                              ? ` · ${fmtRequestCount(tm.recentRequests90m)} 90m`
                              : ''}
                          </span>
                          <span className='t-count'>{tm.costDelta}</span>
                        </div>
                      ))}
                      {tipModelRows.length === 0 && (
                        <div className='v9-tip-row'>
                          <span className='t-model'>—</span>
                          <span className='t-count'>—</span>
                        </div>
                      )}
                    </>
                  )
                  const resetDisplay =
                    isPrior && quotaBar.timeAgoLabel !== undefined
                      ? quotaBar.timeAgoLabel
                      : formatResetDistance(quotaBar.resetAt)
                  return (
                    <div key={i}>
                      <div
                        className='quota-row'
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'minmax(0, 1fr) 28px 38px',
                          columnGap: '6px',
                          alignItems: 'center',
                          fontFamily: 'var(--font-mono)',
                          fontSize: '10px',
                          color: 'var(--fg-muted)',
                          lineHeight: '1.15',
                        }}
                      >
                        <div
                          className='quota-row-label'
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '3px',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          <span
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {quotaBar.label}
                          </span>
                          {!isPrior && showEarlyReset && (
                            <span
                              className='quota-anomaly-icon icon-reset'
                              aria-label='early reset'
                              title='Early quota reset detected'
                            >
                              ⟲
                            </span>
                          )}
                          {!isPrior && showCacheStale && (
                            <span
                              className='quota-anomaly-icon icon-cache'
                              aria-label='cache stale'
                              title='Cache data is stale'
                            >
                              ⚠
                            </span>
                          )}
                        </div>
                        <span
                          className={`quota-row-pct ${pctSeverityClass(quotaBar.consumedPct)}`}
                          style={{
                            textAlign: 'right',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {quotaBar.consumedPct.toFixed(0)}%
                        </span>
                        <span
                          className='quota-row-reset'
                          style={{
                            textAlign: 'right',
                            fontSize: '9px',
                            color: 'var(--fg-muted)',
                          }}
                        >
                          {resetDisplay}
                        </span>
                        {!isPrior && (showEarlyReset || showCacheStale) && (
                          <span className='quota-anomaly-sub'>
                            {showEarlyReset && (
                              <>
                                <span className='anomaly-glyph-reset'>⟲</span>
                                {'early reset '}
                              </>
                            )}
                            {showEarlyReset && showCacheStale && ' · '}
                            {showCacheStale && (
                              <>
                                <span className='anomaly-glyph-cache'>⚠</span>
                                {'cache stale'}
                              </>
                            )}
                          </span>
                        )}
                      </div>
                      <QuotaIntervalBar
                        intervals={quotaBar.segments}
                        tooltipContent={tooltipContent}
                        isPrior={isPrior}
                      />
                    </div>
                  )
                }

                return (
                  <>
                    {currentQuotas.length > 0 && (
                      <div
                        className='quota-list quota-list-current'
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '3px',
                        }}
                      >
                        {currentQuotas.map((qb, i) =>
                          renderLegacyBar(qb, i, false)
                        )}
                      </div>
                    )}
                    {historyQuotas.length > 0 && (
                      <div
                        className='quota-history-lanes'
                        style={{ marginTop: '4px' }}
                      >
                        {LEGACY_LANE_ORDER.map((lane) => {
                          const laneBars = historyQuotas.filter(
                            (q) => q.periodType === lane
                          )
                          if (laneBars.length === 0) return null
                          return (
                            <div
                              key={lane}
                              className={`quota-lane quota-lane-${lane ?? ''}`}
                            >
                              <div
                                className='quota-lane-label'
                                style={{
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: '8px',
                                  color:
                                    lane === '5hr'
                                      ? 'var(--accent-teal, #2dd4bf)'
                                      : 'var(--fg-muted)',
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.08em',
                                  opacity: lane === '5hr' ? 0.85 : 0.55,
                                  marginTop: '4px',
                                  marginBottom: '2px',
                                }}
                              >
                                {LEGACY_LANE_LABEL[lane ?? ''] ?? lane}
                              </div>
                              <div
                                className='quota-list quota-list-history'
                                style={{
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '3px',
                                }}
                              >
                                {laneBars.map((qb, i) =>
                                  renderLegacyBar(qb, i, true)
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </>
                )
              })()
            )}
          </>
        )}

        {/* Extra pane-left content injected by subclasses (e.g. AggregateCard FLEET ACTIVITY) */}
        {extraPaneLeft}
      </div>

      {/* card-pane-right — per-model mini-table at ≥3840px */}
      {topModels.length > 0 && (
        <div
          className='card-pane-right'
          style={{ display: 'none' }} // shown via CSS at ≥3840px
        >
          <div
            className='pane-title'
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '9px',
              color: 'var(--accent-chrome)',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              paddingBottom: '4px',
              borderBottom: '1px dashed var(--border)',
              marginBottom: '4px',
            }}
          >
            Top Models
          </div>
          {topModels.map((m, i) => (
            <div
              key={i}
              className='model-mini-row'
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) auto auto auto',
                columnGap: '6px',
                alignItems: 'baseline',
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                color: 'var(--fg-muted)',
                padding: '3px 0',
                borderBottom: '1px solid rgba(42,53,71,0.4)',
              }}
            >
              <span
                className='name'
                style={{
                  color: 'var(--fg)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {m.model}
              </span>
              <span
                className='tok'
                style={{
                  color: 'var(--fg)',
                  fontVariantNumeric: 'tabular-nums',
                  fontSize: '9.5px',
                }}
              >
                {fmtCompact(m.tokens)}
              </span>
              {/*
               * Wave 20 F6: use toLocaleString() so values ≥ $1,000 render
               * with comma grouping (e.g. $1,284.00 not $1284.00).
               */}
              <span
                className='cost'
                style={{
                  color: 'var(--fg)',
                  fontVariantNumeric: 'tabular-nums',
                  fontSize: '9.5px',
                }}
              >
                $
                {m.cost_usd.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
              <span
                className='p95'
                style={{
                  color: 'var(--fg)',
                  fontVariantNumeric: 'tabular-nums',
                  fontSize: '9.5px',
                }}
              >
                {formatLatency(m.p95_ms ?? 0)}
              </span>
            </div>
          ))}
          {/* 18-Cards C4: errors-row-only-5k — hidden by default, revealed at ≥5120px
              via `.errors-row-only-5k { display: none }` + `@media (min-width:5120px)
              { .errors-row-only-5k { display: grid } }` added by W18-CSS engineer. */}
          <div className='model-mini-row errors errors-row-only-5k'>
            <span className='name'>{`${data.errors.toLocaleString()} errors`}</span>
          </div>
        </div>
      )}
    </div>
  )
}
