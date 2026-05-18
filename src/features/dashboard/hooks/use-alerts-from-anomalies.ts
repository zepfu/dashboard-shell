/**
 * useAlertsFromAnomalies — converts anomaly detection output and summary
 * deltas into AlertItem[] for the AlertsRail component.
 *
 * Wave 9 operator decision 3: alerts wiring via this new hook.
 * Converts useAnomalyDetection output → AlertItem[].
 */
import { useMemo } from 'react'
import type { AlertItem } from '../components/alerts-rail'
import type { AnomalyFlags } from '../hooks/use-anomaly-detection'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal summary shape needed for budget/rate-limit alerts. */
export interface AlertSummaryShape {
  usd_cost?: number
  traces?: number
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useAlertsFromAnomalies converts anomaly flags and summary data into
 * the AlertItem[] format consumed by AlertsRail.
 *
 * @param anomalies - Output from useAnomalyDetection hook.
 * @param summary - Optional usage summary for budget-related alerts.
 * @returns Memoised AlertItem[] array.
 */
export function useAlertsFromAnomalies(
  anomalies: AnomalyFlags,
  summary?: AlertSummaryShape
): AlertItem[] {
  return useMemo<AlertItem[]>(() => {
    const alerts: AlertItem[] = []

    // Early reset alerts — one per affected provider
    for (const [provider, { prior, current }] of anomalies.earlyReset) {
      alerts.push({
        type: 'early-reset',
        head: `⟲ Early reset — ${provider}`,
        sub: `Reset moved ${prior.slice(0, 10)} → ${current.slice(0, 10)}`,
      })
    }

    // Cache stale alert
    if (anomalies.cacheStale) {
      alerts.push({
        type: 'cache-stale',
        head: '⚠ Cache stale',
        sub: 'Quota cache data may be outdated — refresh to update',
      })
    }

    // Budget alert: warn if cost exceeds $100 in the summary window
    const cost = summary?.usd_cost ?? 0
    if (cost > 100) {
      alerts.push({
        type: 'budget',
        head: `Budget threshold: $${cost.toFixed(2)}`,
        sub: 'Cost exceeds $100 for selected period',
      })
    }

    // Rate limit info: if traces are very high
    const traces = summary?.traces ?? 0
    if (traces > 10_000) {
      alerts.push({
        type: 'info',
        head: `High request volume: ${new Intl.NumberFormat().format(traces)} traces`,
      })
    }

    return alerts
  }, [anomalies, summary])
}
