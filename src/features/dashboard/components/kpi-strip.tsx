/**
 * KpiStrip — six-tile KPI summary bar for Phosphor Atlas.
 *
 * Displays token counts, cost, request/error counts, and P95 latency in a
 * compact horizontal strip. Renders skeleton tiles while data is loading.
 */
import type { ReactElement } from 'react'

interface KpiSummary {
  token_in: number
  token_out: number
  cost_usd: number
  requests: number
  errors: number
  p95_ms: number
}

interface KpiStripProps {
  summary: KpiSummary | undefined
  loading?: boolean
}

/** Format a token count with compact SI suffixes (k / M). */
function formatCompact(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}k`
  }
  return String(n)
}

/** Format a cost value as a dollar string with two decimal places. */
function formatCost(n: number): string {
  return `$${n.toFixed(2)}`
}

/** Format an integer with thousand-separator commas. */
function formatCount(n: number): string {
  return new Intl.NumberFormat().format(n)
}

/** Format a P95 latency value. */
function formatLatency(ms: number): string {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(1)}s`
  }
  return `${ms}ms`
}

interface TileData {
  label: string
  value: string
}

function buildTiles(summary: KpiSummary): TileData[] {
  return [
    { label: 'Toks In', value: formatCompact(summary.token_in) },
    { label: 'Toks Out', value: formatCompact(summary.token_out) },
    { label: 'Cost', value: formatCost(summary.cost_usd) },
    { label: 'Requests', value: formatCount(summary.requests) },
    { label: 'Errors', value: formatCount(summary.errors) },
    { label: 'P95', value: formatLatency(summary.p95_ms) },
  ]
}

const TILE_LABELS = ['Toks In', 'Toks Out', 'Cost', 'Requests', 'Errors', 'P95']

/**
 * KpiStrip renders six KPI tiles or skeleton placeholders when loading.
 */
export function KpiStrip({
  summary,
  loading = false,
}: KpiStripProps): ReactElement {
  const isLoading = loading || summary === undefined

  if (isLoading) {
    return (
      <div style={{ display: 'flex', gap: '1rem' }}>
        {TILE_LABELS.map((label) => (
          <div key={label} className='kpi-tile'>
            <div
              style={{
                fontSize: '0.625rem',
                textTransform: 'uppercase',
                color: 'var(--fg-muted)',
              }}
            >
              {label}
            </div>
            <div
              className='skeleton animate-pulse'
              data-loading='true'
              style={{
                width: '3rem',
                height: '1.5rem',
                background: 'var(--card-2)',
                borderRadius: '2px',
              }}
            />
          </div>
        ))}
      </div>
    )
  }

  const tiles = buildTiles(summary)

  return (
    <div style={{ display: 'flex', gap: '1rem' }}>
      {tiles.map(({ label, value }) => (
        <div key={label} className='kpi-tile'>
          <div
            style={{
              fontSize: '0.625rem',
              textTransform: 'uppercase',
              color: 'var(--fg-muted)',
            }}
          >
            {label}
          </div>
          <div
            style={{
              fontSize: '1.25rem',
              fontFamily: 'var(--font-serif)',
              fontStyle: 'italic',
              color: 'var(--fg)',
            }}
          >
            {value}
          </div>
        </div>
      ))}
    </div>
  )
}
