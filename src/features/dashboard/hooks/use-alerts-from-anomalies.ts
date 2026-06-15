/**
 * useAlertsFromAnomalies — converts anomaly detection output and summary
 * deltas into AlertItem[] for the AlertsRail component.
 *
 * Wave 9 operator decision 3: alerts wiring via this new hook.
 * Converts useAnomalyDetection output → AlertItem[].
 *
 * Wave 10 D4: informational alerts always surface when conditions are
 * modestly true (rate-limit headroom, quota nearing, cache hit ratio).
 * Target density: 6–11 items in typical operation.
 * Wave 10 D20: `warn` type emitted for quota-nearing alerts.
 *
 * Wave 11 PR7-lite (audit C32): always-on per-provider healthy alerts and a
 * "Sync on schedule" info alert raise baseline density to 7-11 items.
 *
 * Wave 24-Alerts: budget alerts removed — no budget configuration exists in
 * this product. Both the critical-threshold ($100) and the always-on daily
 * budget progress alerts have been deleted.
 */
import { useMemo } from 'react'
import type {
  UsageReportDockerLogErrorRow,
  UsageReportProviderErrorObservationRow,
  UsageReportProviderLatencyHealthRow,
  UsageReportQuotaRow,
} from '../api/usage-report'
import type { AlertItem } from '../components/alerts-rail'
import type { AnomalyFlags } from '../hooks/use-anomaly-detection'
import {
  canonicalProvider,
  googleQuotaClass,
} from '../lib/usage-report-display'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal summary shape needed for rate-limit and cache alerts. */
export interface AlertSummaryShape {
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

export interface DashboardAlertIssue {
  severity: 'warning' | 'error'
  head: string
  sub?: string
}

export interface DashboardAlertSummary {
  severity: 'ok' | 'warning' | 'error'
  issues: DashboardAlertIssue[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Canonical 7-provider list for always-on healthy alerts (Wave 11 PR7-lite).
 * Inline duplicate per spec to avoid crossing PR2's phosphor-dashboard.tsx.
 */
const CANONICAL_PROVIDERS: ReadonlyArray<string> = [
  'Anthropic',
  'OpenAI',
  'Google',
  'xAI',
  'NVIDIA',
  'OpenRouter',
  'Local',
]

const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  xai: 'xAI',
  nvidia_nim: 'NVIDIA',
  openrouter: 'OpenRouter',
  local: 'Local',
}

const NINETY_MINUTES_MS = 90 * 60 * 1000

function providerLabel(provider: string): string {
  const normalized = provider.toLowerCase()
  const canonical =
    normalized === 'nvidia' || normalized === 'nvidia_nim'
      ? 'nvidia_nim'
      : normalized === 'open-router'
        ? 'openrouter'
        : canonicalProvider(provider)
  return PROVIDER_LABELS[canonical] ?? provider
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural
}

function parseTime(value: string | null | undefined): number | null {
  if (value == null || value === '') return null
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : null
}

function formatResetMoveSub(prior: string, current: string): string {
  const priorDay = prior.slice(0, 10)
  const currentDay = current.slice(0, 10)
  if (priorDay === currentDay) {
    return `Reset moved ${prior} -> ${current}`
  }
  return `Reset moved ${priorDay} -> ${currentDay}`
}

function compactAlertMessage(value: string | null | undefined): string | null {
  const compact = value?.replace(/\s+/g, ' ').trim()
  if (!compact) return null
  return compact.length > 140 ? `${compact.slice(0, 137)}...` : compact
}

function quotaPeriodLabel(interval: string): string {
  switch (interval) {
    case 'short':
      return '5h'
    case 'weekly':
      return '7d'
    case 'special':
      return '7d'
    case 'short_special':
      return '5h'
    case 'monthly':
      return '30d'
    default:
      return interval
  }
}

function quotaLaneLabel(row: UsageReportQuotaRow, interval: string): string {
  const provider = canonicalProvider(row.provider)
  if (provider === 'google') {
    const cls = googleQuotaClass(row.model)
    const period = interval === 'short' ? '24h' : quotaPeriodLabel(interval)
    const prefix =
      cls === 'flash-lite'
        ? 'Flash Lite'
        : cls === 'flash'
          ? 'Flash'
          : cls === 'pro'
            ? 'Pro'
            : ''
    if (prefix === '') return `${period} requests`
    return `${prefix} ${period} requests`
  }
  if (provider === 'openrouter') {
    const period = interval === 'short' ? '24h' : quotaPeriodLabel(interval)
    if (row.model !== null && row.model.toLowerCase().includes(':free')) {
      return `Free ${period} requests`
    }
    if (interval === 'monthly') return 'Monthly credits'
    return `${period} requests`
  }
  if (provider === 'openai') {
    if (interval === 'short_special') return 'Codex Spark 5h'
    if (interval === 'special') return 'Codex Spark 7d'
    if (interval === 'short') return 'All Models 5h'
    if (interval === 'weekly') return 'All Models 7d'
  }
  if (provider === 'anthropic') {
    if (interval === 'special') return 'Sonnet 7d'
    if (interval === 'short_special') return 'Sonnet 5h'
    if (interval === 'short') return 'All Models 5h'
    if (interval === 'weekly') return 'All Models 7d'
  }
  if (provider === 'xai') return `Grok ${quotaPeriodLabel(interval)}`
  if (provider === 'nvidia_nim') return 'NIM credits monthly'
  return `${quotaPeriodLabel(interval)} quota`
}

function quotaStateText(usedPct: number): string {
  if (usedPct >= 99.5) return 'exhausted'
  return `at ${usedPct.toFixed(0)}% used`
}

function quotaCandidates(row: UsageReportQuotaRow) {
  return [
    {
      interval: 'short',
      active: row.short_active,
      remainingPct: row.short_remaining_pct,
    },
    {
      interval: 'weekly',
      active: row.weekly_active,
      remainingPct: row.weekly_remaining_pct,
    },
    {
      interval: 'special',
      active: row.special_active,
      remainingPct: row.special_remaining_pct,
    },
    {
      interval: 'short_special',
      active: row.short_special_active,
      remainingPct: row.short_special_remaining_pct,
    },
    {
      interval: 'monthly',
      active: row.monthly_active,
      remainingPct: row.monthly_remaining_pct,
    },
  ] as const
}

export function buildDashboardAlertSummary({
  anomalies,
  summary,
  quotas,
  providerErrorObservations,
  dockerLogErrors,
  providerLatencyHealth,
  now = new Date(),
}: {
  anomalies: AnomalyFlags
  summary?: AlertSummaryShape
  quotas?: UsageReportQuotaRow[]
  providerErrorObservations?: UsageReportProviderErrorObservationRow[]
  dockerLogErrors?: UsageReportDockerLogErrorRow[]
  providerLatencyHealth?: UsageReportProviderLatencyHealthRow[]
  now?: Date
}): DashboardAlertSummary {
  const issues: DashboardAlertIssue[] = []
  const cutoff = now.getTime() - NINETY_MINUTES_MS

  const recentProviderErrors = new Map<
    string,
    { count: number; messages: string[] }
  >()
  const addProviderError = (
    provider: string,
    code: string | number | null | undefined,
    message?: string | null
  ): void => {
    const key = `${provider}\u0000${code ?? 'provider'}`
    const current = recentProviderErrors.get(key) ?? { count: 0, messages: [] }
    current.count += 1
    const compactMessage = compactAlertMessage(message)
    if (compactMessage && !current.messages.includes(compactMessage)) {
      current.messages.push(compactMessage)
    }
    recentProviderErrors.set(key, current)
  }

  for (const row of providerErrorObservations ?? []) {
    const observedAt = parseTime(row.observed_at)
    if (observedAt === null || observedAt < cutoff) continue
    const provider = providerLabel(row.provider)
    const code =
      row.status_code ?? row.error_code ?? row.error_class ?? 'provider'
    addProviderError(provider, code, row.error_message)
  }

  for (const row of dockerLogErrors ?? []) {
    const observedAt = parseTime(row.observed_at)
    if (observedAt === null || observedAt < cutoff) continue
    const provider =
      row.provider && row.provider !== 'unknown'
        ? providerLabel(row.provider)
        : row.container
    addProviderError(provider, row.status_code ?? row.level, row.message)
  }

  for (const [key, { count, messages }] of recentProviderErrors) {
    const [provider, code] = key.split('\u0000')
    const codeText = /^\d+$/.test(code)
      ? `${code} ${pluralize(count, 'error')}`
      : `${code} ${pluralize(count, 'event')}`
    const messageSummary = messages.slice(0, 2).join(' · ')
    issues.push({
      severity: 'error',
      head: `${count} ${codeText} from ${provider}`,
      sub: messageSummary
        ? `Observed in the last 90 minutes · ${messageSummary}`
        : 'Observed in the last 90 minutes',
    })
  }

  const recentPingFailures = new Map<string, number>()
  for (const row of providerLatencyHealth ?? []) {
    const bucketStart = parseTime(row.bucket_start)
    if (bucketStart === null || bucketStart < cutoff) continue
    const count = row.status_probe_count ?? 0
    let failures = 0
    if (count > 0 && row.status_probe_success_pct !== null) {
      failures += Math.round(count * (1 - row.status_probe_success_pct / 100))
    }
    failures +=
      (row.icmp_failures ?? 0) +
      (row.dns_failures ?? 0) +
      (row.tcp_failures ?? 0) +
      (row.tls_failures ?? 0)
    if (failures <= 0) continue
    const provider = providerLabel(row.provider)
    recentPingFailures.set(
      provider,
      (recentPingFailures.get(provider) ?? 0) + failures
    )
  }

  for (const [provider, count] of recentPingFailures) {
    issues.push({
      severity: 'error',
      head: `${count} failed ${pluralize(count, 'ping result')} from ${provider}`,
      sub: 'Probe failures in the last 90 minutes',
    })
  }

  for (const [provider, { prior, current }] of anomalies.earlyReset) {
    issues.push({
      severity: 'warning',
      head: `Early reset from ${providerLabel(provider)}`,
      sub: formatResetMoveSub(prior, current),
    })
  }

  if (anomalies.cacheStale) {
    issues.push({
      severity: 'warning',
      head: 'Report cache may be stale',
      sub: 'Refresh if recent session rows are missing',
    })
  }

  const traces = summary?.traces ?? 0
  if (traces > 10_000) {
    issues.push({
      severity: 'warning',
      head: `High request volume: ${new Intl.NumberFormat().format(traces)} traces`,
    })
  }

  const quotaIssues = new Map<
    string,
    {
      provider: string
      lane: string
      usedPct: number
      remainingPct: number
    }
  >()
  for (const row of quotas ?? []) {
    for (const candidate of quotaCandidates(row)) {
      if (!candidate.active || candidate.remainingPct === null) continue
      const usedPct = Math.max(0, Math.min(100, 100 - candidate.remainingPct))
      if (usedPct <= 75) continue
      const provider = providerLabel(row.provider)
      const lane = quotaLaneLabel(row, candidate.interval)
      const key = `${provider}\u0000${lane}`
      const existing = quotaIssues.get(key)
      if (existing === undefined || usedPct > existing.usedPct) {
        quotaIssues.set(key, {
          provider,
          lane,
          usedPct,
          remainingPct: candidate.remainingPct,
        })
      }
    }
  }

  for (const issue of quotaIssues.values()) {
    issues.push({
      severity: 'warning',
      head: `${issue.provider} ${issue.lane} ${quotaStateText(issue.usedPct)}`,
      sub: `${issue.remainingPct.toFixed(0)}% remaining`,
    })
  }

  const hasError = issues.some((issue) => issue.severity === 'error')
  const hasWarning = issues.some((issue) => issue.severity === 'warning')
  return {
    severity: hasError ? 'error' : hasWarning ? 'warning' : 'ok',
    issues,
  }
}

export function useDashboardAlertSummary(
  anomalies: AnomalyFlags,
  summary?: AlertSummaryShape,
  quotas?: UsageReportQuotaRow[],
  providerErrorObservations?: UsageReportProviderErrorObservationRow[],
  dockerLogErrors?: UsageReportDockerLogErrorRow[],
  providerLatencyHealth?: UsageReportProviderLatencyHealthRow[],
  now?: Date
): DashboardAlertSummary {
  return useMemo(
    () =>
      buildDashboardAlertSummary({
        anomalies,
        summary,
        quotas,
        providerErrorObservations,
        dockerLogErrors,
        providerLatencyHealth,
        now,
      }),
    [
      anomalies,
      summary,
      quotas,
      providerErrorObservations,
      dockerLogErrors,
      providerLatencyHealth,
      now,
    ]
  )
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useAlertsFromAnomalies converts anomaly flags and summary data into
 * the AlertItem[] format consumed by AlertsRail.
 *
 * @param anomalies - Output from useAnomalyDetection hook.
 * @param summary - Optional usage summary for rate-limit and cache alerts.
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
        sub: formatResetMoveSub(prior, current),
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

    // ── Rate limit info: high request volume ────────────────────────── //

    const traces = summary?.traces ?? 0
    if (traces > 10_000) {
      alerts.push({
        type: 'info',
        head: `High request volume: ${new Intl.NumberFormat().format(traces)} traces`,
      })
    }

    // ── D4: Informational alerts — always-visible when modestly true ── //

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

    // ── Wave 11 PR7-lite: always-on per-provider healthy alerts ────── //
    // For each canonical provider with no anomalies (no early-reset entry),
    // emit an info alert "Provider X: healthy".
    const anomalousCanonical = new Set(
      [...anomalies.earlyReset.keys()].map((p) => canonicalProvider(p))
    )
    const emittedHealthy = new Set<string>()
    for (const providerName of CANONICAL_PROVIDERS) {
      const canonicalKey =
        Object.entries(PROVIDER_LABELS).find(
          ([, label]) => label === providerName
        )?.[0] ?? canonicalProvider(providerName)
      if (anomalousCanonical.has(canonicalKey)) continue
      if (emittedHealthy.has(providerName)) continue
      emittedHealthy.add(providerName)
      alerts.push({
        type: 'info',
        head: `${providerName}: healthy`,
      })
    }

    return alerts
  }, [anomalies, summary, quotas])
}
