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
 */
import type { ReactElement, ReactNode } from 'react'
import {
  formatLatency,
  formatUsd,
  formatResetDistance,
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
  reasoning_reported: number
  reasoning_estimated: number
  traces: number
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
 * A single quota-type bar (weekly / short / special / monthly) with its
 * pre-built N=12 segment array.
 *
 * Wave 11 PR3 (11-h, 11-i): replaces the old flat QuotaRowConfig[] prop so
 * the card can render multi-segment bars with per-bar label + tooltip.
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
}

/** Per-model mini-row for card-pane-right at ≥3840px. */
export interface TopModelRow {
  model: string
  tokens: number
  cost_usd: number
  requests: number
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
  value: string
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
 * Layout:
 *  - Absolutely positioned vertical HealthStrip at right edge (v9w1 update)
 *  - card-pane-left: metrics, quota, TOKEN CACHE, REASONING
 *  - card-pane-right (≥3840px): per-model mini-table
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

  const cacheMiss = data.tokens_in - data.cache_input - data.cache_creation
  const cacheSavings = data.cache_input

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

      {/* Header: provider name (anomaly badges moved to quota-row-label per 11-i) */}
      <div
        className='provider-name'
        style={{
          color: config.color,
          fontWeight: 600,
          fontSize: '11px',
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
        {/* Primary metric rows */}
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
          <span>Toks In</span>
          <span
            className='provider-metric-value'
            style={{
              textAlign: 'right',
              color: 'var(--fg)',
              fontWeight: 500,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {fmtCompact(data.tokens_in)}
          </span>
        </div>
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
          <span>Toks Out</span>
          <span
            className='provider-metric-value'
            style={{
              textAlign: 'right',
              color: 'var(--fg)',
              fontWeight: 500,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {fmtCompact(data.tokens_out)}
          </span>
        </div>
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
          <span>Cost</span>
          <span
            className='provider-metric-value'
            style={{
              textAlign: 'right',
              color: 'var(--fg)',
              fontWeight: 500,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatUsd(data.cost_usd)}
          </span>
        </div>
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
          <span>Requests</span>
          <span
            className='provider-metric-value'
            style={{
              textAlign: 'right',
              color: 'var(--fg)',
              fontWeight: 500,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {data.requests.toLocaleString()}
          </span>
        </div>
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
          <span>Errors</span>
          <span
            className='provider-metric-value'
            style={{
              textAlign: 'right',
              color: data.errors > 0 ? 'var(--accent-hot)' : 'var(--fg)',
              fontWeight: 500,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {data.errors.toLocaleString()}
          </span>
        </div>
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
          <span>P95</span>
          <span
            className='provider-metric-value'
            style={{
              textAlign: 'right',
              color: 'var(--fg)',
              fontWeight: 500,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatLatency(data.p95_ms)}
          </span>
        </div>
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
          <span>Traces</span>
          <span
            className='provider-metric-value'
            style={{
              textAlign: 'right',
              color: 'var(--fg)',
              fontWeight: 500,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {data.traces.toLocaleString()}
          </span>
        </div>

        {/* QUOTAS section — Wave 11 PR3 (11-i): each bar uses 12 segments */}
        {quotas.length > 0 && (
          <>
            <QuotaSectionTitle title='Quotas' />
            <div
              className='quota-list'
              style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}
            >
              {quotas.map((quotaBar, i) => {
                const tooltipContent = (
                  <>
                    <div className='v9-tip-head'>{quotaBar.label}</div>
                    <div className='v9-tip-row'>
                      <span>Used</span>
                      <span>{quotaBar.consumedPct.toFixed(0)}%</span>
                      <span />
                    </div>
                    <div className='v9-tip-row'>
                      <span>Resets</span>
                      <span>{formatResetDistance(quotaBar.resetAt)}</span>
                      <span />
                    </div>
                  </>
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
                            style={{ fontSize: '9px', color: '#a3e635' }}
                          >
                            ⟲
                          </span>
                        )}
                        {showCacheStale && (
                          <span
                            className='quota-anomaly-icon icon-cache'
                            aria-label='cache stale'
                            title='Cache data is stale'
                            style={{
                              fontSize: '9px',
                              color: 'var(--accent-warm)',
                            }}
                          >
                            ⚠
                          </span>
                        )}
                      </div>
                      <span
                        className='quota-row-pct'
                        style={{
                          textAlign: 'right',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {quotaBar.remainingPct.toFixed(0)}%
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

        {/* TOKEN CACHE sub-section */}
        <PcSubTitle title='TOKEN CACHE' />
        <div className='pc-mini-table'>
          <PcMiniRow label='Cache In' value={fmtCompact(data.cache_input)} />
          <PcMiniRow
            label='Cache Create'
            value={fmtCompact(data.cache_creation)}
          />
          <PcMiniRow
            label='Cache Miss'
            value={fmtCompact(cacheMiss)}
            valueMod='muted'
          />
          <PcMiniRow
            label='Cache Savings'
            value={fmtCompact(cacheSavings)}
            valueMod='cost'
          />
        </div>

        {/* REASONING sub-section */}
        <PcSubTitle title='REASONING' />
        <div className='pc-mini-table'>
          <PcMiniRow
            label='Reason Rptd'
            value={fmtCompact(data.reasoning_reported)}
          />
          <PcMiniRow
            label='Reason Est'
            value={fmtCompact(data.reasoning_estimated)}
          />
          <PcMiniRow label='Reason Sources' value='—' valueMod='muted' />
        </div>

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
              <span
                className='cost'
                style={{
                  color: 'var(--fg)',
                  fontVariantNumeric: 'tabular-nums',
                  fontSize: '9.5px',
                }}
              >
                ${m.cost_usd.toFixed(2)}
              </span>
              <span
                className='p95'
                style={{
                  color: 'var(--fg)',
                  fontVariantNumeric: 'tabular-nums',
                  fontSize: '9.5px',
                }}
              >
                {m.requests.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
