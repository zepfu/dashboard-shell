export interface KpiSummary {
  token_in: number
  token_out: number
  cost_usd: number
  requests: number
  errors: number
  p95_ms: number | null
}

export type KpiKey = keyof KpiSummary

/** Max raw value across KPI tiles for share-of-max microbar when no explicit max passed. */
function kpiShareOfMaxDenominator(summary: KpiSummary): number {
  return Math.max(
    summary.token_in,
    summary.token_out,
    summary.cost_usd,
    summary.requests,
    summary.errors,
    summary.p95_ms ?? 0,
    1
  )
}

/** Per-tile scale for microbar fill (avoids token counts dominating other tiles). */
export function microbarScale(key: KpiKey, summary: KpiSummary): number {
  switch (key) {
    case 'token_in':
      return Math.max(summary.token_in, 1)
    case 'token_out':
      return Math.max(summary.token_out, 1)
    case 'cost_usd':
      return Math.max(summary.cost_usd, 0.01)
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
  _key: KpiKey,
  summary: KpiSummary,
  rawValue: number,
  priorFraction: number | undefined,
  maxRawAcrossTiles?: number
): number {
  if (priorFraction !== undefined) {
    const pctPoints = Math.abs(priorFraction) * 100
    return Math.min(100, Math.max(0, Math.round((pctPoints / 5) * 100) / 100))
  }
  const denominator =
    maxRawAcrossTiles !== undefined && maxRawAcrossTiles > 0
      ? maxRawAcrossTiles
      : kpiShareOfMaxDenominator(summary)
  const shareMax = rawValue / denominator
  const pct = Math.round(shareMax * 100)
  if (pct === 0 && rawValue > 0) {
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
