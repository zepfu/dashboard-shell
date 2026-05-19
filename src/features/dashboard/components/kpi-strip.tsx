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
 *
 * Wave 11 PR7-lite (audit C27–C29):
 * - Label renames: Cost → Cost (24h), Errors → Errors (24h), P95 → P95 Latency,
 *   Toks In → Tokens In, Toks Out → Tokens Out; Requests unchanged.
 * - Added `deltas` optional prop for real delta values; falls back to em-dash.
 * - Microbar fill computed proportionally via CSS --fill custom property.
 *
 * Wave 29 Fix #6:
 * - Label rename: Cost (24h) → Cost (operator direction change).
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

/** Keys matching KpiSummary fields, used for delta lookup. */
type KpiKey = keyof KpiSummary

interface KpiStripProps {
  summary: KpiSummary | undefined
  loading?: boolean
  /**
   * Optional delta values (fractional, e.g. 0.124 = +12.4%).
   * When present, rendered as ↑/↓ percentage; when absent, shows em-dash.
   */
  deltas?: Partial<Record<KpiKey, number>>
}

/**
 * Format a large number with compact B/M/K suffixes (operator F#9).
 *
 * Thresholds:
 *   ≥ 1e9 → B (billions)
 *   ≥ 1e6 → M (millions)
 *   ≥ 1e3 → K (thousands)
 *   else  → as-is integer string
 *
 * Examples: 19_471_800_848 → "19.5B", 587_234 → "587.2K", 1_200_000 → "1.2M"
 */
function fmtCompact(n: number): string {
  if (n >= 1_000_000_000) {
    return `${(n / 1_000_000_000).toFixed(1)}B`
  }
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}K`
  }
  return String(n)
}

/**
 * Format a cost value as a dollar string with two decimal places and
 * thousand-separator commas for values ≥ $1000 (operator F#10).
 *
 * Examples: 7196.60 → "$7,196.60", 0.50 → "$0.50"
 */
function formatCost(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
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

/** Render a delta fraction as a ↑/↓ percentage string. */
function renderDelta(delta: number | undefined): string {
  if (delta === undefined) return '—'
  const pct = (Math.abs(delta) * 100).toFixed(1)
  return delta >= 0 ? `↑ ${pct}%` : `↓ ${pct}%`
}

interface TileData {
  label: string
  key: KpiKey
  rawValue: number
  value: string
  isError?: boolean
}

function buildTiles(summary: KpiSummary): TileData[] {
  return [
    {
      label: 'Tokens In',
      key: 'token_in',
      rawValue: summary.token_in,
      value: fmtCompact(summary.token_in),
    },
    {
      label: 'Tokens Out',
      key: 'token_out',
      rawValue: summary.token_out,
      value: fmtCompact(summary.token_out),
    },
    {
      label: 'Cost',
      key: 'cost_usd',
      rawValue: summary.cost_usd,
      value: formatCost(summary.cost_usd),
    },
    {
      label: 'Requests',
      key: 'requests',
      rawValue: summary.requests,
      value: formatCount(summary.requests),
    },
    {
      label: 'Errors (24h)',
      key: 'errors',
      rawValue: summary.errors,
      value: formatCount(summary.errors),
      isError: summary.errors > 0,
    },
    {
      label: 'P95 Latency',
      key: 'p95_ms',
      rawValue: summary.p95_ms,
      value: formatLatency(summary.p95_ms),
    },
  ]
}

/** Updated skeleton labels to match renamed tiles. */
const TILE_LABELS = [
  'Tokens In',
  'Tokens Out',
  'Cost',
  'Requests',
  'Errors (24h)',
  'P95 Latency',
]

/**
 * KpiStrip renders six KPI tiles or skeleton placeholders when loading.
 *
 * The strip is designed to sit inside the header flex row as the dominant
 * visual element, with each tile separated by a border-right divider.
 */
export function KpiStrip({
  summary,
  loading = false,
  deltas,
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

  // Compute max raw value across tiles for proportional microbar fill.
  // Use max of all rawValues; guard against zero-division with fallback of 1.
  const maxRaw = Math.max(...tiles.map((t) => t.rawValue), 1)

  return (
    <div style={stripStyle}>
      {tiles.map(({ label, key, rawValue, value, isError }, i) => {
        const deltaVal = deltas?.[key]
        const deltaStr = renderDelta(deltaVal)
        // 14-B.6: mockup §5 line 300 — .kpi-delta { color: var(--fg-muted); }
        // All deltas use uniform muted color regardless of sign (no amber/red).
        const fillPct = Math.round((rawValue / maxRaw) * 100)

        return (
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
                  isError === true
                    ? 'var(--accent-hot)'
                    : 'var(--accent-chrome)',
                lineHeight: 1,
                fontWeight: 400,
              }}
            >
              {value}
            </div>
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
              <span>{deltaStr}</span>
              {/* Microbar: --fill drives the CSS animation width (11-v). */}
              <span
                className='kpi-microbar'
                style={
                  {
                    display: 'inline-block',
                    width: '40px',
                    height: '2px',
                    background:
                      'linear-gradient(90deg, var(--accent-cool) 0%, var(--accent-teal) 40%, var(--accent-warm) 70%, var(--accent-hot) 100%)',
                    '--fill': `${fillPct}%`,
                  } as React.CSSProperties
                }
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
