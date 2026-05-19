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
 * - Reasoning labels lowercase: reported/estimated/no-reasoning calls.
 * - est-mark asterisk on estimated value.
 * - no-reasoning calls wired to integer.
 *
 * Wave 20 changes (F2 / F3 / F6):
 * - F2: TOKEN CACHE + REASONING sections moved ABOVE Quotas per mockup line 2434.
 * - F3: Quota tooltip restructured: v9-tip-head (window · pct used),
 *       v9-tip-sub (velocity line), v9-tip-row × 3 (t-model / t-count).
 *       Data fields window/velocity/tipModels added to QuotaBarGroup as optional;
 *       missing fields render '—' placeholders (TODO(w20) comments for wiring).
 * - F6: cost cell in card-pane-right switched to toLocaleString() for comma
 *       formatting on values ≥ $1,000.
 *
 * Wave 26 changes (F2 / F8):
 * - F2: REQUESTS section (pc-sub-title + pc-mini-table) replaces the old
 *       'Requests' provider-metric row; contains requests + no-reasoning requests.
 *       TOKENS section (pc-sub-title + pc-mini-table) replaces the old TOKEN CACHE
 *       and REASONING blocks; contains in / out / cost / cache in / cache creation /
 *       cache miss $ / reasoning reported / reasoning estimated.
 *       Rows 1-3 (Requests, Tokens, Cost) removed from provider-metric grid.
 * - F8: Quota hover .t-model spans colored with providerBrandHex() for brand color.
 */
import type { ReactElement, ReactNode } from 'react'
import {
  formatLatency,
  formatUsd,
  formatResetDistance,
  modelBrandHex,
  providerBrandHex,
} from '../lib/usage-report-display'
import { HealthStrip } from './primitives/health-strip'
import { QuotaIntervalBar } from './primitives/quota-interval-bar'

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
  /** Count of no-reasoning calls (from no_reasoning_calls API field if available). */
  no_reasoning_calls: number
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
  label?: string
  resetDate?: string
}

/**
 * A single top-model entry for quota tooltip v9-tip-row rows.
 *
 * Wave 20 F3: mirrors mockup v9-tip-row structure (t-model / t-count).
 * TODO(w20): wire from phosphor-dashboard buildQuotaIntervals.
 */
export interface QuotaTipModel {
  model: string
  /** Signed dollar delta string, e.g. '+$24'. */
  costDelta: string
}

/**
 * A single quota-type bar (weekly / short / special / monthly) with its
 * pre-built N=12 segment array.
 *
 * Wave 11 PR3 (11-h, 11-i): replaces the old flat QuotaRowConfig[] prop so
 * the card can render multi-segment bars with per-bar label + tooltip.
 *
 * Wave 20 F3: added optional tooltip data fields (window, velocity, tipModels)
 * to support the mockup quota tooltip structure. Missing fields render '—'.
 * TODO(w20): populate these from buildQuotaIntervals in phosphor-dashboard.tsx.
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
  /** N=12 equal-width segments; all share the same severityClass. */
  segments: QuotaRowConfig[]
  /**
   * Human-readable window label for tooltip head, e.g. '−30m → now'.
   * TODO(w20): wire from buildQuotaIntervals.
   */
  tipWindow?: string
  /**
   * Velocity line for tooltip sub, e.g. '+5%/30m  ≈  +9%/h'.
   * TODO(w20): wire from buildQuotaIntervals.
   */
  tipVelocity?: string
  /**
   * Top 3 contributing models for tooltip rows.
   * TODO(w20): wire from buildQuotaIntervals.
   */
  tipModels?: QuotaTipModel[]
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

/** Format a compact token/cost value. */
function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

/** Format packet loss percentage as string. Returns '—' when null. */
function fmtPacketLoss(pct: number | null): string {
  if (pct === null) return '—'
  return `${pct.toFixed(1)}%`
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
  /** Wave 11 PR3 (11-i): each entry is one quota-type bar with 12 segments. */
  quotas: QuotaBarGroup[]
  anomalies?: AnomalyFlags
  /** Per-model mini-table rows shown in card-pane-right at ≥3840px. */
  topModels?: TopModelRow[]
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
 *         requests / no-reasoning requests
 *      2. 6 provider-metric rows: p95 Latency / Errors / Rate Limits /
 *         Capacity / Packet Loss / Status
 *      3. health-strip (via HealthStrip component, absolutely positioned)
 *      4. TOKENS section (pc-sub-title + pc-mini-table):
 *         in / out / cost / cache in / cache creation / cache miss $ /
 *         reasoning reported / reasoning estimated*
 *      5. Quotas section title + quota-list
 *  - card-pane-right (≥3840px): per-model mini-table
 *
 * Wave 26 F8: quota tip .t-model spans colored with providerBrandHex().
 */
export function ProviderCard({
  config,
  data,
  healthCells,
  quotas,
  anomalies,
  topModels = [],
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

  // Wave 12 Fix 2: build tooltip content for the vertical HealthStrip.
  // The primitive supports tooltipContent but ProviderCard never passed it —
  // operator complaint #6 ("health bars do not have hover over") unaddressed.
  const healthTooltipContent = (
    <>
      <div className='v9-tip-head'>{config.provider.toUpperCase()} HEALTH</div>
      <div className='v9-tip-row'>
        <span>P95</span>
        <span>{formatLatency(data.p95_ms)}</span>
        <span />
      </div>
      <div className='v9-tip-row'>
        <span>Errors</span>
        <span>{data.errors.toLocaleString()}</span>
        <span />
      </div>
      <div className='v9-tip-row'>
        <span>Requests</span>
        <span>{data.requests.toLocaleString()}</span>
        <span />
      </div>
      <div className='v9-tip-foot'>288 cells · last 24h</div>
    </>
  )

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
      {/* Vertical HealthStrip — absolutely positioned at right edge */}
      {/* Wave 12 Fix 2: pass healthTooltipContent so hover tooltip is functional */}
      <HealthStrip
        cells={healthCells}
        orientation='vertical'
        tooltipContent={healthTooltipContent}
      />

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
         * row. Contains requests total and no-reasoning requests count.
         */}
        <PcSubTitle title='REQUESTS' />
        <div className='pc-mini-table'>
          <PcMiniRow label='requests' value={data.requests.toLocaleString()} />
          <PcMiniRow
            label='no-reasoning requests'
            value={data.no_reasoning_calls.toLocaleString()}
          />
        </div>

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
         *        reasoning reported / reasoning estimated*
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
          {/* Reasoning sub-rows (moved from old REASONING section) */}
          <PcMiniRow
            label='reasoning reported'
            value={fmtCompact(data.reasoning_reported)}
          />
          <PcMiniRow
            label='reasoning estimated'
            value={
              <>
                {fmtCompact(data.reasoning_estimated)}
                <span className='est-mark'>*</span>
              </>
            }
          />
        </div>

        {/*
         * QUOTAS section — Wave 11 PR3 (11-i): each bar uses 12 segments.
         * Wave 20 F2: moved BELOW Token Cache + Reasoning per mockup line 2434.
         * Wave 20 F3: tooltip restructured to match mockup v9-tip-quota structure:
         *   v9-tip-head: '{window} · {pct}% used'
         *   v9-tip-sub:  velocity line
         *   v9-tip-row × 3: top models with $delta
         *   Missing data fields render '—' until TODO(w20) wiring is complete.
         */}
        {quotas.length > 0 && (
          <>
            <QuotaSectionTitle title='Quotas' />
            <div
              className='quota-list'
              style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}
            >
              {quotas.map((quotaBar, i) => {
                // Wave 20 F3: build tooltip matching mockup v9-tip-quota structure.
                // tipWindow / tipVelocity / tipModels are optional on QuotaBarGroup;
                // render '—' placeholders when not yet wired.
                const tipWindowStr = quotaBar.tipWindow ?? '—'
                const tipHeadLabel = `${tipWindowStr} · ${quotaBar.consumedPct.toFixed(0)}% used`
                const tipVelocityStr = quotaBar.tipVelocity ?? '—'
                // Top 3 model rows; fall back to empty if not populated.
                const tipModelRows =
                  quotaBar.tipModels !== undefined &&
                  quotaBar.tipModels.length > 0
                    ? quotaBar.tipModels.slice(0, 3)
                    : []
                const tooltipContent = (
                  <div className='v9-tip tip-quota tip-hover'>
                    {/* Head: "{window} · {pct}% used" */}
                    <div className='v9-tip-head'>{tipHeadLabel}</div>
                    {/* Sub: velocity line e.g. "+5%/30m  ≈  +9%/h" */}
                    <div className='v9-tip-sub'>{tipVelocityStr}</div>
                    {/* Rows: top 3 contributing models with $delta */}
                    {/* Wave 26 F8 / Wave 27 follow-up: .t-model colored by the
                        model's provider brand hex. providerBrandHex only
                        matches provider *names*; tm.model is a *model* name
                        (e.g. claude-opus-4-7) so we must first infer the
                        provider via modelBrandHex. */}
                    {tipModelRows.map((tm, mi) => (
                      <div key={mi} className='v9-tip-row'>
                        <span
                          className='t-model'
                          style={{ color: modelBrandHex(tm.model) }}
                        >
                          {tm.model}
                        </span>
                        <span className='t-count'>{tm.costDelta}</span>
                      </div>
                    ))}
                    {/* Placeholder rows when tipModels not yet wired */}
                    {tipModelRows.length === 0 && (
                      <div className='v9-tip-row'>
                        {/* TODO(w20): wire tipModels from buildQuotaIntervals */}
                        <span className='t-model'>—</span>
                        <span className='t-count'>—</span>
                      </div>
                    )}
                  </div>
                )
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
                      {/* Label + anomaly icons (11-i: icons moved here from header) */}
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
                        {showEarlyReset && (
                          <span
                            className='quota-anomaly-icon icon-reset'
                            aria-label='early reset'
                            title='Early quota reset detected'
                          >
                            ⟲
                          </span>
                        )}
                        {showCacheStale && (
                          <span
                            className='quota-anomaly-icon icon-cache'
                            aria-label='cache stale'
                            title='Cache data is stale'
                          >
                            ⚠
                          </span>
                        )}
                      </div>
                      {/* 14-E.1: display consumed% (not remaining%) per mockup line 2438
                          14-E.2: severity class colors pct text per consumption tier */}
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
                        {formatResetDistance(quotaBar.resetAt)}
                      </span>
                      {/* 14-E.3: quota-anomaly-sub row spanning all 3 cols per
                          mockup line 425-436. Rendered only when anomalies exist. */}
                      {(showEarlyReset || showCacheStale) && (
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
                    />
                  </div>
                )
              })}
            </div>
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
