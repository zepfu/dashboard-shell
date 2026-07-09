import type { ModelRow } from './master-ledger-aggregation'

/**
 * Aggregated stats per provider for one time window.
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

/** Daily burn above this USD amount uses accent-hot in the Burn column. */
export const BURN_DAILY_HOT_THRESHOLD_USD = 100

function requestWeightedAverage(
  rows: ModelRow[],
  pick: (row: ModelRow) => number | undefined
): number {
  let weighted = 0
  let weight = 0
  for (const row of rows) {
    const value = pick(row)
    if (value === undefined || !Number.isFinite(value)) continue
    const w = row.requests > 0 ? row.requests : 1
    weighted += value * w
    weight += w
  }
  return weight > 0 ? weighted / weight : 0
}

export function buildCurrentStats(
  providers: string[],
  modelRows: ModelRow[],
  periodDays: number
): ProviderCurrentStats[] {
  const windowDays = Math.max(1, Math.round(periodDays))

  return providers.map((provider) => {
    const rows = modelRows.filter(
      (r) => r.provider.toLowerCase() === provider.toLowerCase()
    )
    const totalCost = rows.reduce((s, r) => s + r.cost_usd, 0)
    const totalTokens = rows.reduce((s, r) => s + r.tokens_in + r.tokens_out, 0)

    const avgP95 = requestWeightedAverage(rows, (r) =>
      r.p95_ms > 0 ? r.p95_ms : undefined
    )

    const avgErrPct = requestWeightedAverage(rows, (r) => r.error_pct)

    const avgCachePct = requestWeightedAverage(rows, (r) => r.cache_pct)

    const burn = totalCost / windowDays

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

export function computeDeltaPct(current: number, prior: number): number | null {
  if (!Number.isFinite(prior) || !Number.isFinite(current) || prior === 0) {
    return null
  }
  return ((current - prior) / prior) * 100
}

export function formatDeltaPct(delta: number | null): string {
  if (delta === null) return '—'
  const sign = delta >= 0 ? '+' : ''
  return `${sign}${delta.toFixed(1)}%`
}

export type DeltaColumnKind = 'cost' | 'tokens' | 'p95' | 'err'

export function formatDeltaPctWithPrior(
  current: number,
  prior: number | undefined,
  delta: number | null,
  column: DeltaColumnKind = 'cost'
): string {
  if (
    prior !== undefined &&
    prior === 0 &&
    Number.isFinite(current) &&
    current > 0
  ) {
    if (column === 'p95') {
      return formatLatencyDeltaFromZero(current)
    }
    return 'new'
  }
  return formatDeltaPct(delta)
}

function formatLatencyDeltaFromZero(currentMs: number): string {
  return `+${Math.round(currentMs).toString()} ms`
}

export function deltaColor(
  delta: number | null,
  column: DeltaColumnKind = 'cost'
): string {
  if (delta === null || delta === 0) return 'var(--fg-muted)'
  if (delta > 0) {
    if (column === 'tokens') return 'var(--fg)'
    return 'var(--accent-hot)'
  }
  return 'var(--accent-teal)'
}
