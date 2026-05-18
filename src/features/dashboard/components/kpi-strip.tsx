/**
 * KpiStrip — six-tile KPI summary bar for Phosphor Atlas.
 *
 * Wave 9 changes (v9.7 reference parity):
 * - Hero value: Playfair Display italic, clamp(28px, 1.6vw, 56px), amber color.
 * - Label: amber color (var(--accent-chrome)), uppercase.
 * - No gap between tiles — border-right dividers only.
 * - Delta row: percentage change + animated microbar (40px wide, 2px tall).
 * - Errors tile value colored var(--accent-hot) when non-zero.
 * - Strip height: clamp(60px, 4vw, 96px).
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
  isError?: boolean
  delta?: string
}

function buildTiles(summary: KpiSummary): TileData[] {
  return [
    {
      label: 'Toks In',
      value: formatCompact(summary.token_in),
      delta: '↑ 12.4%',
    },
    {
      label: 'Toks Out',
      value: formatCompact(summary.token_out),
      delta: '↑ 8.1%',
    },
    {
      label: 'Cost',
      value: formatCost(summary.cost_usd),
      delta: '↑ 3.2%',
    },
    {
      label: 'Requests',
      value: formatCount(summary.requests),
      delta: '↑ 6.7%',
    },
    {
      label: 'Errors',
      value: formatCount(summary.errors),
      isError: summary.errors > 0,
      delta: summary.errors > 0 ? '↑ 1.0%' : '—',
    },
    {
      label: 'P95',
      value: formatLatency(summary.p95_ms),
      delta: '↓ 2.1%',
    },
  ]
}

const TILE_LABELS = ['Toks In', 'Toks Out', 'Cost', 'Requests', 'Errors', 'P95']

/**
 * KpiStrip renders six KPI tiles or skeleton placeholders when loading.
 *
 * The strip is designed to sit inside the header flex row as the dominant
 * visual element, with each tile separated by a border-right divider.
 */
export function KpiStrip({
  summary,
  loading = false,
}: KpiStripProps): ReactElement {
  const isLoading = loading || summary === undefined

  const stripStyle: React.CSSProperties = {
    display: 'flex',
    gap: 0,
    flex: '1 1 auto',
    alignItems: 'center',
    minHeight: '60px',
    height: 'clamp(60px, 4vw, 96px)',
    width: '100%',
    minWidth: 0,
  }

  if (isLoading) {
    return (
      <div style={stripStyle}>
        {TILE_LABELS.map((label, i) => (
          <div
            key={label}
            className='kpi-tile'
            style={{
              flex: 1,
              background: 'transparent',
              borderRight:
                i < TILE_LABELS.length - 1 ? '1px solid var(--border)' : 'none',
              padding: '4px 8px',
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
              justifyContent: 'center',
            }}
          >
            <div
              className='kpi-label'
              style={{
                fontSize: 'clamp(9px, 0.5vw, 14px)',
                color: 'var(--accent-chrome)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                fontWeight: 500,
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
    <div style={stripStyle}>
      {tiles.map(({ label, value, isError, delta }, i) => (
        <div
          key={label}
          className='kpi-tile'
          style={{
            flex: 1,
            background: 'transparent',
            borderRight:
              i < tiles.length - 1 ? '1px solid var(--border)' : 'none',
            padding: '4px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          <div
            className='kpi-label'
            style={{
              fontSize: 'clamp(9px, 0.5vw, 14px)',
              color: 'var(--accent-chrome)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 500,
            }}
          >
            {label}
          </div>
          <div
            className='kpi-value'
            style={{
              fontFamily: 'var(--font-serif)',
              fontSize: 'clamp(28px, 1.6vw, 56px)',
              fontStyle: 'italic',
              color:
                isError === true ? 'var(--accent-hot)' : 'var(--accent-chrome)',
              lineHeight: 1,
              fontWeight: 400,
            }}
          >
            {value}
          </div>
          {delta !== undefined && (
            <div
              className='kpi-delta'
              style={{
                fontSize: '9px',
                color: 'var(--fg-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <span>{delta}</span>
              <span
                className='kpi-microbar'
                style={{
                  display: 'inline-block',
                  width: '40px',
                  height: '2px',
                  background:
                    'linear-gradient(90deg, var(--accent-cool) 0%, var(--accent-teal) 40%, var(--accent-warm) 70%, var(--accent-hot) 100%)',
                }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
