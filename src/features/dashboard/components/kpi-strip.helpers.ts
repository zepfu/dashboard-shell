export interface KpiSummary {
  token_in: number
  token_out: number
  cost_usd: number | null
  requests: number
  errors: number
  p95_ms: number | null
}

export type KpiKey = keyof KpiSummary

/**
 * Per-tile scale for microbar fill.
 *
 * Token tiles share a denom so Tokens In/Out stay proportional to each other
 * (C-3). Other tiles scale against their own value so cost/requests/p95 are not
 * collapsed by million-scale token counts (P07-F02).
 */
export function microbarScale(key: KpiKey, summary: KpiSummary): number {
  switch (key) {
    case 'token_in':
    case 'token_out':
      return Math.max(summary.token_in, summary.token_out, 1)
    case 'cost_usd':
      return Math.max(summary.cost_usd ?? 0, 0.01)
    case 'requests':
      return Math.max(summary.requests, 1)
    case 'errors':
      return Math.max(summary.errors, 1)
    case 'p95_ms':
      return Math.max(summary.p95_ms ?? 0, 1)
    default:
      return 1
  }
}

export function kpiMicrobarFillPct(
  key: KpiKey,
  summary: KpiSummary,
  rawValue: number | null,
  priorFraction: number | undefined
): number {
  if (priorFraction !== undefined) {
    const pctPoints = Math.abs(priorFraction) * 100
    return Math.min(100, Math.max(0, Math.round((pctPoints / 5) * 100) / 100))
  }

  const value = rawValue ?? 0
  const denominator = microbarScale(key, summary)
  const shareMax = value / denominator
  const pct = Math.round(shareMax * 100)
  if (pct === 0 && value > 0) {
    return 1
  }
  return Math.min(100, Math.max(0, pct))
}

/** Render a delta fraction as a ↑/↓/→ percentage string. */
export function renderDelta(delta: number | undefined): string {
  if (delta === undefined) return '—'
  const absFraction = Math.abs(delta)
  if (delta === 0 || absFraction * 100 < 0.05) {
    return '→ 0.0%'
  }
  const pctPoints = absFraction * 100
  const pct = pctPoints < 0.1 ? pctPoints.toFixed(2) : pctPoints.toFixed(1)
  return delta > 0 ? `↑ ${pct}%` : `↓ ${pct}%`
}
