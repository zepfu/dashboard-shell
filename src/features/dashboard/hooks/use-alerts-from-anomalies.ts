/**
 * useAlertsFromAnomalies — converts anomaly detection output and summary
 * deltas into AlertItem[] for the AlertsRail component.
 *
 * Wave 9 operator decision 3: alerts wiring via this new hook.
 * Converts useAnomalyDetection output → AlertItem[].
 *
 * Wave 10 D4: informational alerts always surface when conditions are
 * modestly true (rate-limit headroom, quota nearing, cache hit ratio,
 * daily budget). Target density: 6–11 items in typical operation.
 * Wave 10 D20: `warn` type emitted for quota-nearing alerts.
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
  token_in?: number
  token_out?: number
  token_cache_input?: number
  token_cache_creation?: number
}

/** Minimal quota row shape needed for quota-nearing alerts. */
export interface AlertQuotaShape {
  provider: string
  weekly_remaining_pct: number | null
  weekly_active: boolean
  short_remaining_pct: number | null
  short_active: boolean
  monthly_remaining_pct: number | null
  monthly_active: boolean
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
 * @param quotas - Optional quota rows for quota-nearing informational alerts.
 * @returns Memoised AlertItem[] array.
 */
export function useAlertsFromAnomalies(
  anomalies: AnomalyFlags,
  summary?: AlertSummaryShape,
  quotas?: AlertQuotaShape[]
): AlertItem[] {
  return useMemo<AlertItem[]>(() => {
    const alerts: AlertItem[] = []

    // ── Anomaly-triggered alerts (critical / structural) ─────────────── //

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

    // ── Budget alert (critical threshold) ───────────────────────────── //

    const cost = summary?.usd_cost ?? 0
    if (cost > 100) {
      alerts.push({
        type: 'budget',
        head: `Budget threshold: $${cost.toFixed(2)}`,
        sub: 'Cost exceeds $100 for selected period',
      })
    }

    // ── Rate limit info: high request volume ────────────────────────── //

    const traces = summary?.traces ?? 0
    if (traces > 10_000) {
      alerts.push({
        type: 'info',
        head: `High request volume: ${new Intl.NumberFormat().format(traces)} traces`,
      })
    }

    // ── D4: Informational alerts — always-visible when modestly true ── //

    // Daily budget progress (always show if we have cost data)
    if (cost > 0) {
      const dailyBudget = 150 // default daily budget cap assumption
      const spendPct = Math.round((cost / dailyBudget) * 100)
      alerts.push({
        type: 'info',
        head: `Daily budget: $${cost.toFixed(2)} / $${dailyBudget} (${spendPct}%)`,
        sub: 'Aggregated spend for selected period',
      })
    }

    // Cache hit ratio (always show if we have cache data)
    const cacheInput = summary?.token_cache_input ?? 0
    const totalTokenIn = summary?.token_in ?? 0
    if (totalTokenIn > 0 && cacheInput > 0) {
      const hitPct = Math.round((cacheInput / totalTokenIn) * 100)
      alerts.push({
        type: 'info',
        head: `Cache hit ratio: ${hitPct}%`,
        sub: `${new Intl.NumberFormat().format(cacheInput)} tokens served from cache`,
      })
    } else if (totalTokenIn > 0) {
      // Surface even when 0% to inform operator
      alerts.push({
        type: 'info',
        head: 'Cache hit ratio: 0%',
        sub: 'No cache hits detected for selected period',
      })
    }

    // Quota-nearing and rate-limit headroom from quota rows
    if (quotas !== undefined && quotas.length > 0) {
      const seenProviders = new Set<string>()

      for (const row of quotas) {
        if (seenProviders.has(row.provider)) continue

        // Collect active remaining percentages
        const activePcts: { pct: number; label: string }[] = []
        if (row.weekly_active && row.weekly_remaining_pct !== null) {
          activePcts.push({ pct: row.weekly_remaining_pct, label: 'weekly' })
        }
        if (row.short_active && row.short_remaining_pct !== null) {
          activePcts.push({ pct: row.short_remaining_pct, label: 'short' })
        }
        if (row.monthly_active && row.monthly_remaining_pct !== null) {
          activePcts.push({ pct: row.monthly_remaining_pct, label: 'monthly' })
        }

        for (const { pct, label } of activePcts) {
          const usedPct = 100 - pct

          if (usedPct > 75) {
            // D20: quota-nearing → warn type (amber)
            alerts.push({
              type: 'warn',
              head: `Quota nearing — ${row.provider} ${label}`,
              sub: `${usedPct.toFixed(0)}% used, ${pct.toFixed(0)}% remaining`,
            })
            seenProviders.add(row.provider)
          } else if (usedPct > 50) {
            // D4: rate limit headroom — info type
            alerts.push({
              type: 'info',
              head: `Rate limit headroom — ${row.provider} ${label}`,
              sub: `${pct.toFixed(0)}% quota remaining`,
            })
            seenProviders.add(row.provider)
          }
        }
      }
    }

    return alerts
  }, [anomalies, summary, quotas])
}
