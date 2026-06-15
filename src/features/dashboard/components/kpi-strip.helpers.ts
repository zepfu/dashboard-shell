export interface KpiSummary {
  token_in: number
  token_out: number
  cost_usd: number
  requests: number
  errors: number
  p95_ms: number
}

export type KpiKey = keyof KpiSummary

const DELTA_DEADBAND_FRACTION = 0.0005

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
      return Math.max(summary.p95_ms, 1)
    default:
      return 1
  }
}

export function kpiMicrobarFillPct(
  key: KpiKey,
  summary: KpiSummary,
  rawValue: number,
  priorFraction: number | undefined
): number {
  if (priorFraction !== undefined) {
    return Math.min(
      100,
      Math.max(
        0,
        Math.round((Math.abs(priorFraction) * 100) / DELTA_DEADBAND_FRACTION)
      )
    )
  }
  return Math.min(
    100,
    Math.max(0, Math.round((rawValue / microbarScale(key, summary)) * 100))
  )
}

/** Render a delta fraction as a ↑/↓/→ percentage string. */
export function renderDelta(delta: number | undefined): string {
  if (delta === undefined) return '—'
  const absFraction = Math.abs(delta)
  if (delta === 0 || absFraction * 100 < 0.05) {
    return '→ 0.0%'
  }
  const pct = (absFraction * 100).toFixed(1)
  return delta > 0 ? `↑ ${pct}%` : `↓ ${pct}%`
}
