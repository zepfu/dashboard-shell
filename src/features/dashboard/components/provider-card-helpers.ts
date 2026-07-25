/**
 * Pure helpers for ProviderCard (S2-22 decomposition).
 */
import { formatResetDistance } from '../lib/usage-report-display'
import type { EarlyResetMap, QuotaBarGroup } from './provider-card-types'

/** Packet loss at or above this threshold degrades Status (S2-18 / C-4). */
export const PACKET_LOSS_STATUS_WARN_THRESHOLD = 49

/** Whether the provider is flagged for an early quota reset. */
export function hasEarlyReset(
  earlyReset: EarlyResetMap | Set<string>,
  provider: string
): boolean {
  return earlyReset.has(provider)
}

export function wrapperIncludesAggregate(
  wrapperClassName?: string,
  variant?: 'aggregate'
): boolean {
  if (variant === 'aggregate') return true
  if (wrapperClassName === undefined || wrapperClassName === '') return false
  return wrapperClassName.split(/\s+/).includes('aggregate')
}

/**
 * Reset label for a quota bar row.
 * Prior bars without timeAgoLabel render '—' (S2-17), not formatResetDistance.
 */
export function quotaBarResetDisplay(
  quotaBar: QuotaBarGroup,
  isPrior: boolean
): string {
  if (isPrior) {
    return quotaBar.timeAgoLabel ?? '—'
  }
  return formatResetDistance(quotaBar.resetAt)
}

/** Format packet loss percentage as string. Returns '—' when null. */
export function fmtPacketLoss(pct: number | null): string {
  if (pct === null) return '—'
  return `${pct.toFixed(1)}%`
}

export function fmtRequestCount(count: number | undefined): string {
  if (count === undefined) return '—'
  return Math.round(count).toLocaleString()
}

export function quotaConsumedPctDisplay(quotaBar: QuotaBarGroup): string {
  if (
    quotaBar.showSubPercentPrecision === true &&
    quotaBar.consumedPct > 0 &&
    quotaBar.consumedPct < 1
  ) {
    return '<1%'
  }
  return `${quotaBar.consumedPct.toFixed(0)}%`
}

/**
 * Returns the CSS modifier class for a `.quota-row-pct` element based on
 * consumed percentage (aligned with segment iv-* scale intent).
 */
export function pctSeverityClass(consumedPct: number): string {
  if (consumedPct >= 75) return 'hot'
  if (consumedPct >= 25) return 'warm'
  if (consumedPct >= 10) return 'teal'
  return 'cool'
}
