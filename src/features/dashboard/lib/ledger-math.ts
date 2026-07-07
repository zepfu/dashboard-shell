/**
 * Shared ledger rollup math (D1-449 A2): percent rounding and cache ratios.
 */
export function roundPct1(value: number): number {
  return Math.round(value * 1000) / 10
}

export function cachePctFromTokens(
  cacheTokens: number,
  tokensIn: number
): number | undefined {
  if (tokensIn <= 0 || cacheTokens <= 0) return undefined
  return roundPct1(cacheTokens / Math.max(1, tokensIn))
}

export function cacheMissPctFromCost(
  cacheMissUsd: number,
  costUsd: number
): number | undefined {
  if (cacheMissUsd <= 0 || costUsd <= 0) return undefined
  return roundPct1(cacheMissUsd / costUsd)
}

/** @deprecated Use cacheMissPctFromCost — kept for call-site clarity (usd numerator). */
export const cacheMissPctFromUsd = cacheMissPctFromCost
