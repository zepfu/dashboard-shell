/**
 * Quota history tab builders for status quota view.
 * Wave 11: extracted from phosphor-dashboard.testkit.ts
 */
import type {
  UsageReportQuotaHistoryRow,
  UsageReportQuotaUsageBreakdown,
} from '../api/usage-report'
import {
  classifyGeminiModel,
  quotaTypeToLaneKey,
  roundToNearest30Min,
} from './quota-bars/fields'
import { PROVIDER_LANE_DEFS } from './quota-bars/lane-defs'
import { canonicalProvider } from './usage-report-display'

const FORMAT_COMPACT_QUANTITY = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

export function formatCompactQuantity(value: number): string {
  return FORMAT_COMPACT_QUANTITY.format(value)
}

export function quotaHistoryConsumedPct(
  row: UsageReportQuotaHistoryRow
): number {
  const remaining = row.min_remaining_pct ?? row.max_remaining_pct ?? 100
  return Math.max(0, Math.min(100, 100 - remaining))
}

export function quotaHistoryFillColor(consumedPct: number): string {
  if (consumedPct >= 75) return 'var(--accent-hot)'
  if (consumedPct >= 25) return 'var(--accent-warm)'
  if (consumedPct >= 10) return 'var(--accent-teal)'
  return 'var(--accent-cool)'
}

export function quotaHistoryRequests(row: UsageReportQuotaHistoryRow): number {
  return row.usage_breakdown.reduce((sum, entry) => sum + entry.traces, 0)
}

function quotaHistoryHasUsage(row: UsageReportQuotaHistoryRow): boolean {
  return row.usage_tokens > 0 || quotaHistoryRequests(row) > 0
}

interface ProviderQuotaHistoryTab {
  tabKey: string
  label: string
  rows: UsageReportQuotaHistoryRow[]
}

function compareQuotaHistoryResetDesc(
  a: UsageReportQuotaHistoryRow,
  b: UsageReportQuotaHistoryRow
): number {
  const resetCompare = String(b.expected_reset_at ?? '').localeCompare(
    String(a.expected_reset_at ?? '')
  )
  if (resetCompare !== 0) return resetCompare
  return String(b.interval_start ?? '').localeCompare(
    String(a.interval_start ?? '')
  )
}

function shouldHideQuotaHistoryLane(
  providerLower: string,
  def: { laneLabel: string }
): boolean {
  if (providerLower !== 'anthropic' && providerLower !== 'openai') {
    return false
  }
  return def.laneLabel.toLowerCase().includes('5hr')
}

function quotaHistoryRowMatchesLane(
  providerLower: string,
  def: { quotaType: string; googleClass: string | null; quotaKey?: string },
  row: UsageReportQuotaHistoryRow
): boolean {
  if (quotaTypeToLaneKey(row.quota_type) !== quotaTypeToLaneKey(def.quotaType))
    return false

  if (providerLower === 'antigravity' && def.quotaKey !== undefined) {
    return row.model === def.quotaKey
  }

  if (providerLower === 'google' && def.googleClass !== null) {
    if (row.model === null) return false
    return classifyGeminiModel(row.model) === def.googleClass
  }

  return true
}

function quotaHistoryLaneRank(
  providerLower: string,
  def: { quotaType: string }
): number {
  if (providerLower === 'anthropic') {
    switch (quotaTypeToLaneKey(def.quotaType)) {
      case 'weekly':
        return 0
      case 'special':
        return 1
      default:
        return 2
    }
  }

  return 0
}

function googleQuotaHistoryFamilyLabel(
  googleClass: string | null | undefined
): string {
  switch (googleClass) {
    case 'gemini-flash-lite':
      return 'Flash-Lite'
    case 'gemini-flash':
      return 'Flash'
    case 'gemini-pro':
      return 'Pro'
    default:
      return 'Google'
  }
}

function minIso(values: (string | null)[]): string | null {
  const concrete = values.filter((value): value is string => value !== null)
  return concrete.length === 0 ? null : concrete.sort()[0]
}

function maxIso(values: (string | null)[]): string | null {
  const concrete = values.filter((value): value is string => value !== null)
  const sorted = concrete.sort()
  return sorted.length === 0 ? null : sorted[sorted.length - 1]
}

function minNullableNumber(values: (number | null)[]): number | null {
  const concrete = values.filter(
    (value): value is number => value !== null && Number.isFinite(value)
  )
  return concrete.length === 0 ? null : Math.min(...concrete)
}

function maxNullableNumber(values: (number | null)[]): number | null {
  const concrete = values.filter(
    (value): value is number => value !== null && Number.isFinite(value)
  )
  return concrete.length === 0 ? null : Math.max(...concrete)
}

function aggregateQuotaUsageBreakdown(
  breakdown: UsageReportQuotaUsageBreakdown[]
): UsageReportQuotaUsageBreakdown[] {
  const byModel = new Map<string, UsageReportQuotaUsageBreakdown>()

  for (const entry of breakdown) {
    const model = entry.model || 'unknown'
    const existing = byModel.get(model)
    if (existing === undefined) {
      byModel.set(model, { ...entry, model })
      continue
    }
    byModel.set(model, {
      model,
      tokens: Math.max(existing.tokens, entry.tokens),
      cost: Math.max(existing.cost, entry.cost),
      traces: Math.max(existing.traces, entry.traces),
      recent_traces_90m:
        existing.recent_traces_90m === undefined &&
        entry.recent_traces_90m === undefined
          ? undefined
          : Math.max(
              existing.recent_traces_90m ?? 0,
              entry.recent_traces_90m ?? 0
            ),
    })
  }

  return [...byModel.values()].sort((a, b) => b.tokens - a.tokens)
}

function quotaHistoryResetGroupKey(row: UsageReportQuotaHistoryRow): string {
  const reset = row.expected_reset_at ?? row.interval_end
  if (reset === null) return 'unknown'
  const laneKey = quotaTypeToLaneKey(row.quota_type)
  const provider = canonicalProvider(row.provider)
  const parsed = new Date(reset)
  if (!Number.isNaN(parsed.getTime())) {
    if (
      laneKey === 'weekly' ||
      laneKey === 'special' ||
      laneKey === 'monthly' ||
      (laneKey === 'short' &&
        (provider === 'google' || provider === 'openrouter'))
    ) {
      return parsed.toISOString().slice(0, 10)
    }
  }
  const rounded = roundToNearest30Min(reset)
  return Number.isNaN(rounded.getTime()) ? reset : rounded.toISOString()
}

function aggregateQuotaHistoryRowsByReset(
  rows: UsageReportQuotaHistoryRow[],
  modelLabel?: string
): UsageReportQuotaHistoryRow[] {
  const grouped = new Map<string, UsageReportQuotaHistoryRow[]>()

  for (const row of rows) {
    const resetKey = quotaHistoryResetGroupKey(row)
    const groupKey = [
      row.provider,
      modelLabel ?? row.model ?? 'all',
      row.quota_type,
      resetKey,
    ].join('|')
    const group = grouped.get(groupKey) ?? []
    group.push(row)
    grouped.set(groupKey, group)
  }

  return [...grouped.values()]
    .map((group) => {
      const first = group[0]
      const resetAt = maxIso(group.map((row) => row.expected_reset_at))
      const usageBreakdown = aggregateQuotaUsageBreakdown(
        group.flatMap((row) => row.usage_breakdown)
      )
      const usageTokens =
        usageBreakdown.length > 0
          ? usageBreakdown.reduce((sum, entry) => sum + entry.tokens, 0)
          : (maxNullableNumber(group.map((row) => row.usage_tokens)) ?? 0)
      return {
        provider: first.provider,
        model: modelLabel ?? first.model,
        quota_type: first.quota_type,
        expected_reset_at: resetAt,
        interval_start: minIso(group.map((row) => row.interval_start)),
        interval_end: resetAt ?? maxIso(group.map((row) => row.interval_end)),
        min_remaining_pct: minNullableNumber(
          group.map((row) => row.min_remaining_pct)
        ),
        max_remaining_pct: maxNullableNumber(
          group.map((row) => row.max_remaining_pct)
        ),
        velocity_segments: [],
        velocity_scores: [],
        velocity_sample_count: 0,
        usage_tokens: usageTokens,
        usage_breakdown: usageBreakdown,
      }
    })
    .sort(compareQuotaHistoryResetDesc)
}

function aggregateGoogleQuotaHistoryRows(
  def: { googleClass: string | null },
  rows: UsageReportQuotaHistoryRow[]
): UsageReportQuotaHistoryRow[] {
  return aggregateQuotaHistoryRowsByReset(
    rows,
    googleQuotaHistoryFamilyLabel(def.googleClass)
  )
}

function fallbackQuotaHistoryLabel(quotaType: string): string {
  switch (quotaTypeToLaneKey(quotaType)) {
    case 'short':
      return 'Requests · 24h'
    case 'weekly':
      return 'All Models · 7d'
    case 'special':
      return 'Special · 7d'
    case 'short_special':
      return 'Special · 5hr'
    case 'monthly':
      return 'All Models · 30d'
    case 'wtus':
      return 'WTUs'
    default:
      return quotaType
  }
}

export function buildProviderQuotaHistoryTabs(
  provider: string,
  rows: UsageReportQuotaHistoryRow[]
): ProviderQuotaHistoryTab[] {
  const providerLower = canonicalProvider(provider).toLowerCase()
  const laneDefs = (PROVIDER_LANE_DEFS[providerLower] ?? [])
    .filter((def) => !shouldHideQuotaHistoryLane(providerLower, def))
    .sort(
      (a, b) =>
        quotaHistoryLaneRank(providerLower, a) -
        quotaHistoryLaneRank(providerLower, b)
    )

  if (laneDefs.length > 0) {
    return laneDefs.map((def) => {
      const laneRows = rows
        .filter((row) => quotaHistoryRowMatchesLane(providerLower, def, row))
        .sort(compareQuotaHistoryResetDesc)
      const displayRows =
        providerLower === 'google'
          ? aggregateGoogleQuotaHistoryRows(def, laneRows)
          : aggregateQuotaHistoryRowsByReset(laneRows)
      return {
        tabKey: def.laneKey,
        label: def.laneLabel,
        rows: displayRows.filter(quotaHistoryHasUsage),
      }
    })
  }

  const grouped = new Map<string, UsageReportQuotaHistoryRow[]>()
  for (const row of rows) {
    const key = quotaTypeToLaneKey(row.quota_type)
    const group = grouped.get(key) ?? []
    group.push(row)
    grouped.set(key, group)
  }

  return [...grouped.entries()]
    .map(([quotaType, group]) => ({
      tabKey: `${providerLower}/${quotaType}`,
      label: fallbackQuotaHistoryLabel(quotaType),
      rows: group.sort(compareQuotaHistoryResetDesc),
    }))
    .sort((a, b) => {
      const aNewest = a.rows[0]?.expected_reset_at ?? ''
      const bNewest = b.rows[0]?.expected_reset_at ?? ''
      return String(bNewest).localeCompare(String(aNewest))
    })
}
