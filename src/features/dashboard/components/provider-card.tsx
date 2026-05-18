/**
 * ProviderCard — per-provider metrics card for Phosphor Atlas dashboard.
 *
 * Renders provider metrics, health strip, quota interval bar, and anomaly
 * badges in the Phosphor design language (0 border-radius, mono values,
 * CSS custom property palette).
 */
import type { ReactElement } from 'react'
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

/** Interval configuration for one quota segment. */
export interface QuotaRowConfig {
  widthPct: number
  severityClass: string
  highVelocity: boolean
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

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface MetricRowProps {
  label: string
  value: number | string
  highlight?: boolean
}

function MetricRow({
  label,
  value,
  highlight = false,
}: MetricRowProps): ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '2px 0',
        fontSize: '11px',
        lineHeight: '1.4',
      }}
    >
      <span style={{ color: 'var(--fg-muted)' }}>{label}</span>
      <span
        style={{
          fontFamily: 'monospace',
          color: highlight ? 'var(--accent-hot)' : 'var(--fg)',
        }}
      >
        {value}
      </span>
    </div>
  )
}

interface SectionHeaderProps {
  title: string
}

function SectionHeader({ title }: SectionHeaderProps): ReactElement {
  return (
    <div
      style={{
        fontSize: '9px',
        fontWeight: 700,
        letterSpacing: '0.08em',
        color: 'var(--fg-muted)',
        marginTop: '8px',
        marginBottom: '2px',
        textTransform: 'uppercase',
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
  quotas: QuotaRowConfig[]
  anomalies?: AnomalyFlags
}

/**
 * ProviderCard renders a Phosphor Atlas provider metrics panel with health
 * strip, quota bar, and optional anomaly badges.
 */
export function ProviderCard({
  config,
  data,
  healthCells,
  quotas,
  anomalies,
}: ProviderCardProps): ReactElement {
  const showEarlyReset =
    anomalies !== undefined &&
    hasEarlyReset(anomalies.earlyReset, config.provider)
  const showCacheStale = anomalies?.cacheStale === true

  const cacheMiss = data.tokens_in - data.cache_input - data.cache_creation
  const cacheSavings = data.cache_input

  return (
    <div
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 0,
        padding: '12px',
        minWidth: '200px',
      }}
    >
      {/* Header: provider name + anomaly badges */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '8px',
        }}
      >
        <span
          style={{
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.1em',
            color: config.color,
          }}
        >
          {config.provider.toUpperCase()}
        </span>
        <div style={{ display: 'flex', gap: '4px' }}>
          {showEarlyReset && (
            <span
              className='icon-reset'
              aria-label='early reset detected'
              title='Early quota reset detected'
              style={{
                fontSize: '12px',
                color: 'var(--accent-warm)',
                cursor: 'default',
              }}
            >
              ⟲
            </span>
          )}
          {showCacheStale && (
            <span
              className='icon-cache'
              aria-label='cache stale'
              title='Cache data is stale'
              style={{
                fontSize: '12px',
                color: 'var(--accent-warm)',
                cursor: 'default',
              }}
            >
              ⚠
            </span>
          )}
        </div>
      </div>

      {/* Health strip */}
      <HealthStrip cells={healthCells} />

      {/* Quota interval bar */}
      <div style={{ marginTop: '6px' }}>
        <QuotaIntervalBar intervals={quotas} />
      </div>

      {/* Primary metric rows (7 non-duplicate metrics) */}
      <div style={{ marginTop: '8px' }}>
        <MetricRow label='Toks In' value={data.tokens_in.toLocaleString()} />
        <MetricRow label='Toks Out' value={data.tokens_out.toLocaleString()} />
        <MetricRow label='Cost' value={`$${data.cost_usd.toFixed(4)}`} />
        <MetricRow label='Requests' value={data.requests.toLocaleString()} />
        <MetricRow label='Errors' value={data.errors.toLocaleString()} />
        <MetricRow label='P95' value={`${data.p95_ms}ms`} />
        <MetricRow label='Traces' value={data.traces.toLocaleString()} />
      </div>

      {/* TOKEN CACHE section — also satisfies Cache In / Cache Create in 11-metric list */}
      <SectionHeader title='TOKEN CACHE' />
      <MetricRow label='Cache In' value={data.cache_input.toLocaleString()} />
      <MetricRow
        label='Cache Create'
        value={data.cache_creation.toLocaleString()}
      />
      <MetricRow label='Cache Miss' value={cacheMiss.toLocaleString()} />
      <MetricRow label='Cache Savings' value={cacheSavings.toLocaleString()} />

      {/* REASONING section — also satisfies Reason Rptd / Reason Est in 11-metric list */}
      <SectionHeader title='REASONING' />
      <MetricRow
        label='Reason Rptd'
        value={data.reasoning_reported.toLocaleString()}
      />
      <MetricRow
        label='Reason Est'
        value={data.reasoning_estimated.toLocaleString()}
      />
      <MetricRow label='Reason Sources' value='—' />
    </div>
  )
}
