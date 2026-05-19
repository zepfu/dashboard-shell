/**
 * ComparisonPanel — provider-vs-provider rolling-7-day comparison table at ≥3840px.
 *
 * Wave 18-Cards C4a rewrite: column set changed from the static snapshot
 * (Provider/Toks In/Toks Out/Cost/Requests/Avg P95/Err%) to the mockup-spec
 * delta comparison (Provider/Δ Cost/Δ Tok/Δ p95/Δ Err/Cache %/Burn/Trend)
 * per mockup lines 3318-3327 and audit item §C4a.
 *
 * Delta (Δ) columns show period-over-period change vs the prior 7-day window.
 * TODO: wire prior-period data via a dedicated `priorStats` prop (or a second
 * `useUsageReportFromRange` query scoped to [now-14d, now-7d]). Until that data
 * is available, delta cells render `—` as a clear placeholder.
 *
 * The Trend column is a 24-bucket SVG polyline of the provider's hourly token
 * totals, derived from the `trendBuckets` prop (same data as TokenTrendChart).
 *
 * Structure per v9.7 reference HTML — data-tab="comparison" section,
 * grid-column: 14/21, grid-row: 7 at 4K. Display: none below 3840px.
 */
import type { CSSProperties, ReactElement } from 'react'
import { formatLatency, formatUsd } from '../lib/usage-report-display'
import type { ModelRow } from './master-ledger-table'
import type { TrendBucket } from './token-trend-chart'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Props for ComparisonPanel. */
interface ComparisonPanelProps {
  /** Canonical provider names to display (from deriveProviders). */
  providers: string[]
  /** Per-model rows from buildModelRows (used for current-period aggregates). */
  modelRows: ModelRow[]
  /**
   * 24-bucket trend data for sparkline column, keyed by provider name in
   * TrendBucket.totals. Pass `normalizeTrendData(report.trend)`.
   * Optional: when absent the Trend column renders an empty sparkline.
   */
  trendBuckets?: TrendBucket[]
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Aggregated current-period stats per provider. */
interface ProviderCurrentStats {
  provider: string
  totalCost: number
  totalTokens: number
  avgP95: number
  avgErrPct: number
  avgCachePct: number
  /** Burn = avg daily spend over the 7-day window. Derived from totalCost / 7. */
  burn: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function buildCurrentStats(
  providers: string[],
  modelRows: ModelRow[]
): ProviderCurrentStats[] {
  return providers.map((provider) => {
    const rows = modelRows.filter(
      (r) => r.provider.toLowerCase() === provider.toLowerCase()
    )
    const totalCost = rows.reduce((s, r) => s + r.cost_usd, 0)
    const totalTokens = rows.reduce((s, r) => s + r.tokens_in + r.tokens_out, 0)

    const p95Values = rows.map((r) => r.p95_ms).filter((v) => v > 0)
    const avgP95 =
      p95Values.length > 0
        ? p95Values.reduce((s, v) => s + v, 0) / p95Values.length
        : 0

    const errPcts = rows.map((r) => r.error_pct).filter((v) => v > 0)
    const avgErrPct =
      errPcts.length > 0
        ? errPcts.reduce((s, v) => s + v, 0) / errPcts.length
        : 0

    const cachePcts = rows
      .map((r) => r.cache_pct)
      .filter((v): v is number => v !== undefined && v > 0)
    const avgCachePct =
      cachePcts.length > 0
        ? cachePcts.reduce((s, v) => s + v, 0) / cachePcts.length
        : 0

    // Burn = avg daily spend. Period is rolling 7-day; divide by 7.
    const burn = totalCost / 7

    return {
      provider,
      totalCost,
      totalTokens,
      avgP95,
      avgErrPct,
      avgCachePct,
      burn,
    }
  })
}

/**
 * Derives a 24-point sparkline series for `provider` from TrendBucket totals.
 * Sums all per-provider token values (the key in totals is the provider string).
 * Returns an empty array when trendBuckets is absent.
 */
function providerSparkPoints(
  provider: string,
  trendBuckets: TrendBucket[] | undefined
): number[] {
  if (trendBuckets === undefined || trendBuckets.length === 0) return []
  const lowerProvider = provider.toLowerCase()
  return trendBuckets.map((b) => {
    // Sum all keys in totals whose lowercased form matches this provider.
    return Object.entries(b.totals)
      .filter(([key]) => key.toLowerCase() === lowerProvider)
      .reduce((s, [, v]) => s + v, 0)
  })
}

// ---------------------------------------------------------------------------
// MiniSparkline
// ---------------------------------------------------------------------------

/** Minimal SVG polyline sparkline for the Trend column. */
function MiniSparkline({
  points,
  color,
}: {
  points: number[]
  color: string
}): ReactElement {
  const W = 48
  const H = 16

  if (points.length < 2) {
    // Render a flat baseline when data is absent
    return (
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        aria-hidden='true'
        style={{ display: 'block' }}
      >
        <line
          x1={0}
          y1={H / 2}
          x2={W}
          y2={H / 2}
          stroke='var(--border)'
          strokeWidth={1}
        />
      </svg>
    )
  }

  const maxVal = Math.max(...points)
  const minVal = Math.min(...points)
  const range = maxVal - minVal || 1

  const coords = points.map((v, i) => {
    const x = (i / (points.length - 1)) * W
    const y = H - ((v - minVal) / range) * (H - 2) - 1
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      aria-hidden='true'
      style={{ display: 'block' }}
    >
      <polyline
        points={coords.join(' ')}
        fill='none'
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin='round'
        strokeLinecap='round'
        opacity={0.85}
      />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

/** Header label for each of the 8 columns. */
const COLUMN_HEADERS = [
  'Provider',
  'Δ Cost',
  'Δ Tok',
  'Δ p95',
  'Δ Err',
  'Cache %',
  'Burn',
  'Trend',
] as const

// ---------------------------------------------------------------------------
// ComparisonPanel
// ---------------------------------------------------------------------------

/**
 * ComparisonPanel renders a rolling-7-day provider comparison table.
 * Only shown at ≥3840px via CSS (parent section has display:none below 4K).
 *
 * Delta columns (Δ Cost, Δ Tok, Δ p95, Δ Err) show period-over-period change
 * vs the prior 7-day window. These render `—` until prior-period data is wired.
 */
export function ComparisonPanel({
  providers,
  modelRows,
  trendBuckets,
}: ComparisonPanelProps): ReactElement {
  const stats = buildCurrentStats(providers, modelRows)

  /** Common TH style */
  const thStyle: CSSProperties = {
    padding: '5px 6px',
    borderRight: '1px solid var(--border)',
    color: 'var(--accent-chrome)',
    fontWeight: 600,
    fontSize: 'clamp(9px, 0.5vw, 12px)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    whiteSpace: 'nowrap',
  }

  return (
    <div
      className='comparison-wrapper'
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        padding: '10px',
        overflowX: 'auto',
      }}
    >
      <div
        className='comparison-title'
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'clamp(9px, 0.5vw, 12px)',
          color: 'var(--accent-chrome)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          fontWeight: 600,
          marginBottom: '6px',
          paddingBottom: '4px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        Provider Comparison (rolling 7-day)
      </div>

      <table
        className='comparison-table'
        aria-label='Provider comparison (rolling 7-day)'
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontFamily: 'var(--font-mono)',
          fontSize: 'clamp(11px, 0.55vw, 14px)',
        }}
      >
        <thead>
          <tr>
            {COLUMN_HEADERS.map((col) => (
              <th
                key={col}
                style={{
                  ...thStyle,
                  textAlign: col === 'Provider' ? 'left' : 'right',
                  // Trend column gets a bit more space for the SVG
                  minWidth: col === 'Trend' ? '56px' : undefined,
                }}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stats.map((stat) => {
            const sparkPoints = providerSparkPoints(stat.provider, trendBuckets)
            const providerColor = 'var(--accent-cool)'

            return (
              <tr
                key={stat.provider}
                style={{ borderBottom: '1px solid var(--border)' }}
              >
                {/* Provider */}
                <td
                  style={{
                    padding: '5px 6px',
                    textAlign: 'left',
                    fontWeight: 600,
                    borderRight: '1px solid var(--border)',
                    color: 'var(--fg)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {stat.provider.toUpperCase()}
                </td>

                {/* Δ Cost — placeholder until prior-period data wired */}
                {/* TODO: render (currentCost − priorCost) when priorStats prop available */}
                <td
                  style={{
                    padding: '5px 6px',
                    textAlign: 'right',
                    borderRight: '1px solid var(--border)',
                    color: 'var(--fg-muted)',
                    whiteSpace: 'nowrap',
                  }}
                  title={`Current period cost: ${formatUsd(stat.totalCost)}`}
                >
                  —
                </td>

                {/* Δ Tok — placeholder until prior-period data wired */}
                {/* TODO: render (currentTokens − priorTokens) when priorStats prop available */}
                <td
                  style={{
                    padding: '5px 6px',
                    textAlign: 'right',
                    borderRight: '1px solid var(--border)',
                    color: 'var(--fg-muted)',
                    whiteSpace: 'nowrap',
                  }}
                  title={`Current period tokens: ${fmtCompact(stat.totalTokens)}`}
                >
                  —
                </td>

                {/* Δ p95 — placeholder until prior-period data wired */}
                {/* TODO: render (currentP95 − priorP95) when priorStats prop available */}
                <td
                  style={{
                    padding: '5px 6px',
                    textAlign: 'right',
                    borderRight: '1px solid var(--border)',
                    color: 'var(--fg-muted)',
                    whiteSpace: 'nowrap',
                  }}
                  title={`Current period p95: ${formatLatency(stat.avgP95)}`}
                >
                  —
                </td>

                {/* Δ Err — placeholder until prior-period data wired */}
                {/* TODO: render (currentErrPct − priorErrPct) when priorStats prop available */}
                <td
                  style={{
                    padding: '5px 6px',
                    textAlign: 'right',
                    borderRight: '1px solid var(--border)',
                    color: 'var(--fg-muted)',
                    whiteSpace: 'nowrap',
                  }}
                  title={`Current period err%: ${stat.avgErrPct.toFixed(1)}%`}
                >
                  —
                </td>

                {/* Cache % — current-period prompt-cache hit ratio */}
                <td
                  style={{
                    padding: '5px 6px',
                    textAlign: 'right',
                    borderRight: '1px solid var(--border)',
                    color:
                      stat.avgCachePct > 0
                        ? 'var(--accent-teal)'
                        : 'var(--fg-muted)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {stat.avgCachePct > 0
                    ? `${stat.avgCachePct.toFixed(1)}%`
                    : '—'}
                </td>

                {/* Burn — avg daily spend (totalCost / 7 for rolling 7-day) */}
                <td
                  style={{
                    padding: '5px 6px',
                    textAlign: 'right',
                    borderRight: '1px solid var(--border)',
                    color: stat.burn > 100 ? 'var(--accent-hot)' : 'var(--fg)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {formatUsd(stat.burn)}
                </td>

                {/* Trend — 24-bucket SVG polyline of hourly token totals */}
                <td
                  style={{
                    padding: '5px 6px',
                    textAlign: 'right',
                    borderRight: '1px solid var(--border)',
                  }}
                >
                  <MiniSparkline points={sparkPoints} color={providerColor} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Static footer per mockup line 3392 */}
      <div
        className='comparison-footer'
        style={{
          marginTop: '6px',
          paddingTop: '4px',
          borderTop: '1px solid var(--border)',
          fontSize: 'clamp(9px, 0.45vw, 11px)',
          color: 'var(--fg-muted)',
        }}
      >
        Δ vs prior 7d · burn = avg daily spend · cache = prompt-cache hit ratio
      </div>
    </div>
  )
}
