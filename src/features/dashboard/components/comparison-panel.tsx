/**
 * ComparisonPanel — provider-vs-provider comparison table at ≥3840px.
 *
 * Wave 18-Cards C4a rewrite: column set changed from the static snapshot
 * (Provider/Toks In/Toks Out/Cost/Requests/Avg P95/Err%) to the mockup-spec
 * delta comparison (Provider/Δ Cost/Δ Tok/Δ p95/Δ Err/Cache %/Burn/Trend)
 * per mockup lines 3318-3327 and audit item §C4a.
 *
 * Delta (Δ) columns show period-over-period change vs the prior window.
 * When `priorStats` is provided the Δ cells show a signed percentage change
 * vs the prior window; when absent they fall back to `—`.
 *
 * The Trend column is a 24-bucket SVG polyline of the provider's hourly token
 * totals, derived from the `trendBuckets` prop (same data as TokenTrendChart).
 *
 * Structure per v9.7 reference HTML — data-tab="comparison" section,
 * grid-column: 14/21, grid-row: 7 at 4K. Display: none below 3840px.
 *
 * Wave 20-Comparison: `periodDays` prop added (optional, defaults to 1) so
 * burn = totalCost / periodDays reflects the user-selected date range.
 * ⚠-W19-3 fix: the hardcoded `/ 7` divisor silently mis-reported daily spend
 * for any window other than 7 days; the default 1-day window (index.tsx
 * Wave 16-V) produced values 7× too low.
 *
 * Wave 32-Deltas: `priorStats` prop added. PhosphorDashboard fetches a second
 * usage report for the prior window (same span, shifted back by periodDays)
 * and passes the aggregated stats here for Δ column rendering.
 *
 * Design choice: `periodDays` is optional and defaults to 1.
 * — This keeps the parent call site (phosphor-dashboard.tsx) unchanged: the
 *   W20-PhosphorDash engineer will add `periodDays={rangeDays}` in their pass.
 * — Default=1 is mathematically sound: burn = totalCost / 1 = raw total cost,
 *   which is the correct daily burn rate for a 1-day window.
 */
import type { CSSProperties, ReactElement } from 'react'
import { formatLatency, formatUsd } from '../lib/usage-report-display'
import type { ModelRow } from './master-ledger-table'
import type { TrendBucket } from './token-trend-chart'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Aggregated stats per provider for one time window.
 * Exported so PhosphorDashboard can build the same shape for the prior window
 * and pass it as the `priorStats` prop.
 */
export interface ProviderCurrentStats {
  provider: string
  totalCost: number
  totalTokens: number
  avgP95: number
  avgErrPct: number
  avgCachePct: number
  /** Burn = avg daily spend = totalCost / periodDays. */
  burn: number
}

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
  /**
   * Number of calendar days covered by the current date-range selection.
   * Used as the divisor for the Burn column: burn = totalCost / periodDays.
   *
   * Defaults to 1 (= the Wave 16-V default 1-day window in index.tsx).
   * The W20-PhosphorDash engineer will pass the computed range value once
   * phosphor-dashboard.tsx resolvedFrom/resolvedTo are threaded through.
   *
   * Computing periodDays from resolvedFrom and resolvedTo (ISO YYYY-MM-DD):
   *   const msPerDay = 86_400_000
   *   const periodDays = Math.max(
   *     1,
   *     Math.round(
   *       (new Date(resolvedTo).getTime() - new Date(resolvedFrom).getTime())
   *       / msPerDay
   *     )
   *   )
   */
  periodDays?: number
  /**
   * Aggregated stats for the prior window (same span, shifted back by
   * periodDays). When provided, Δ columns render signed percentage change
   * vs the prior window. When absent (or a provider is missing from the array),
   * the corresponding delta cells fall back to `—`.
   *
   * Built by PhosphorDashboard from a second `useQuery` call with shifted
   * `from`/`to` parameters. See Wave 32-Deltas implementation.
   */
  priorStats?: ProviderCurrentStats[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export function buildCurrentStats(
  providers: string[],
  modelRows: ModelRow[],
  periodDays: number
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

    // Burn = avg daily spend. Divide by the actual window length so the value
    // is correct regardless of the user-selected date range. When periodDays=1
    // (the default 1-day window), burn equals totalCost (i.e. the raw daily
    // spend for that single day).
    const burn = totalCost / periodDays

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

// ---------------------------------------------------------------------------
// Delta helpers (Wave 32-Deltas)
// ---------------------------------------------------------------------------

/**
 * Computes a signed percentage change: ((current - prior) / prior) * 100.
 * Returns `null` when prior is zero or either value is not finite, which
 * causes the caller to render `—` instead of a misleading Infinity/NaN.
 */
export function computeDeltaPct(current: number, prior: number): number | null {
  if (!isFinite(prior) || !isFinite(current) || prior === 0) return null
  return ((current - prior) / prior) * 100
}

/**
 * Formats a signed percentage delta for display: `+N.N%` or `-N.N%`.
 * Returns `—` when `delta` is `null` (no prior data or division by zero).
 */
export function formatDeltaPct(delta: number | null): string {
  if (delta === null) return '—'
  const sign = delta >= 0 ? '+' : ''
  return `${sign}${delta.toFixed(1)}%`
}

/**
 * Returns the CSS color token for a delta value.
 *
 * For cost / tokens / latency / error metrics a positive delta (increase) is
 * hot (bad) and a negative delta (decrease) is cool (good). Zero stays neutral.
 */
export function deltaColor(delta: number | null): string {
  if (delta === null || delta === 0) return 'var(--fg-muted)'
  return delta > 0 ? 'var(--accent-hot)' : 'var(--accent-teal)'
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
 * ComparisonPanel renders a provider comparison table (4K+ only).
 * Only shown at ≥3840px via CSS (parent section has display:none below 4K).
 *
 * Delta columns (Δ Cost, Δ Tok, Δ p95, Δ Err) show period-over-period change
 * vs the prior window. These render `—` until prior-period data is wired.
 *
 * The Burn column shows avg daily spend = totalCost / periodDays.
 * Pass `periodDays` to reflect the user-selected date range; defaults to 1.
 */
export function ComparisonPanel({
  providers,
  modelRows,
  trendBuckets,
  periodDays = 1,
  priorStats,
}: ComparisonPanelProps): ReactElement {
  const stats = buildCurrentStats(providers, modelRows, periodDays)

  /** Derive title label from actual period length. */
  const periodLabel =
    periodDays === 1 ? '1-day' : `${periodDays.toString()}-day`

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
        {`Provider Comparison (${periodLabel})`}
      </div>

      <table
        className='comparison-table'
        aria-label={`Provider comparison (${periodLabel})`}
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

            // Wave 32-Deltas: look up the matching prior-window entry.
            const prior = priorStats?.find(
              (p) => p.provider.toLowerCase() === stat.provider.toLowerCase()
            )

            const deltaCost =
              prior !== undefined
                ? computeDeltaPct(stat.totalCost, prior.totalCost)
                : null
            const deltaTok =
              prior !== undefined
                ? computeDeltaPct(stat.totalTokens, prior.totalTokens)
                : null
            const deltaP95 =
              prior !== undefined
                ? computeDeltaPct(stat.avgP95, prior.avgP95)
                : null
            const deltaErr =
              prior !== undefined
                ? computeDeltaPct(stat.avgErrPct, prior.avgErrPct)
                : null

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

                {/* Δ Cost — signed % change vs prior window */}
                <td
                  style={{
                    padding: '5px 6px',
                    textAlign: 'right',
                    borderRight: '1px solid var(--border)',
                    color: deltaColor(deltaCost),
                    whiteSpace: 'nowrap',
                  }}
                  title={
                    prior !== undefined
                      ? `Current: ${formatUsd(stat.totalCost)} · Prior: ${formatUsd(prior.totalCost)}`
                      : `Current period cost: ${formatUsd(stat.totalCost)}`
                  }
                >
                  {formatDeltaPct(deltaCost)}
                </td>

                {/* Δ Tok — signed % change vs prior window */}
                <td
                  style={{
                    padding: '5px 6px',
                    textAlign: 'right',
                    borderRight: '1px solid var(--border)',
                    color: deltaColor(deltaTok),
                    whiteSpace: 'nowrap',
                  }}
                  title={
                    prior !== undefined
                      ? `Current: ${fmtCompact(stat.totalTokens)} · Prior: ${fmtCompact(prior.totalTokens)}`
                      : `Current period tokens: ${fmtCompact(stat.totalTokens)}`
                  }
                >
                  {formatDeltaPct(deltaTok)}
                </td>

                {/* Δ p95 — signed % change vs prior window */}
                <td
                  style={{
                    padding: '5px 6px',
                    textAlign: 'right',
                    borderRight: '1px solid var(--border)',
                    color: deltaColor(deltaP95),
                    whiteSpace: 'nowrap',
                  }}
                  title={
                    prior !== undefined
                      ? `Current: ${formatLatency(stat.avgP95)} · Prior: ${formatLatency(prior.avgP95)}`
                      : `Current period p95: ${formatLatency(stat.avgP95)}`
                  }
                >
                  {formatDeltaPct(deltaP95)}
                </td>

                {/* Δ Err — signed % change vs prior window */}
                <td
                  style={{
                    padding: '5px 6px',
                    textAlign: 'right',
                    borderRight: '1px solid var(--border)',
                    color: deltaColor(deltaErr),
                    whiteSpace: 'nowrap',
                  }}
                  title={
                    prior !== undefined
                      ? `Current: ${stat.avgErrPct.toFixed(1)}% · Prior: ${prior.avgErrPct.toFixed(1)}%`
                      : `Current period err%: ${stat.avgErrPct.toFixed(1)}%`
                  }
                >
                  {formatDeltaPct(deltaErr)}
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

                {/* Burn — avg daily spend (totalCost / periodDays) */}
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
        {`Δ vs prior ${periodLabel} · burn = avg daily spend · cache = prompt-cache hit ratio`}
      </div>
    </div>
  )
}
