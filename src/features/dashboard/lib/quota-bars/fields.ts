/**
 * Quota bar segments, tip formatting, and bar group builders.
 * Wave 11: extracted from phosphor-dashboard.testkit.ts
 */
import type {
  UsageReportQuotaBillingDetail,
  UsageReportQuotaRow,
  UsageReportQuotaUsageBreakdown,
  UsageReportProviderLatencyHealthRow,
} from '../../api/usage-report'
import type {
  QuotaBarGroup,
  QuotaRowConfig,
  QuotaTipModel,
} from '../../components/provider-card'
import type { QuotaSegmentSeverityClass } from '../../components/provider-card-types'
import {
  canonicalProvider,
  formatDashboardIntervalCompact,
} from '../usage-report-display'

export function ivClassForConsumed(
  consumedPct: number
): QuotaSegmentSeverityClass {
  if (consumedPct >= 50) return 'iv-50-p'
  if (consumedPct >= 25) return 'iv-25-50'
  if (consumedPct >= 10) return 'iv-10-25'
  if (consumedPct >= 5) return 'iv-5-10'
  return 'iv-0-5'
}

function velocityClassForScore(score: number): string | undefined {
  if (score >= 100) return 'velocity-peak'
  if (score >= 25) return 'velocity-hot'
  if (score >= 5) return 'velocity-fast'
  if (score >= 0.75) return 'velocity-steady'
  if (score > 0) return 'velocity-slow'
  return undefined
}

type QuotaIntervalKind =
  | 'short'
  | 'weekly'
  | 'weekly_overage_included'
  | 'special'
  | 'short_special'
  | 'monthly'
  | 'wtus'

/**
 * Builds 100 one-percent QuotaRowConfig segments for a single quota interval
 * row. Consumed segments are filled from the left; unconsumed quota remains
 * dim. Backend-supplied velocity flags mark only the percent buckets where
 * consumption outran the reset-window time budget.
 */
export function buildQuotaSegments(
  remainingPct: number,
  velocityScores: readonly number[] | undefined = undefined
): QuotaRowConfig[] {
  const consumedPct = Math.max(0, Math.min(100, 100 - remainingPct))
  const SEGMENTS = 100
  const consumedWholeSegments = Math.floor(consumedPct)
  const consumedSegmentLimit = Math.ceil(consumedPct)

  // Severity class for the consumed portion — based on overall consumed level.
  const consumedClass = ivClassForConsumed(consumedPct)

  return Array.from({ length: SEGMENTS }, (_, i) => {
    const isConsumed = i < consumedWholeSegments
    const isBoundary = i === consumedWholeSegments && i < consumedSegmentLimit
    let severityClass: QuotaSegmentSeverityClass

    if (isConsumed) {
      severityClass = consumedClass
    } else if (isBoundary) {
      severityClass = consumedPct >= 99.5 ? consumedClass : 'iv-5-10'
    } else {
      severityClass = 'iv-0-5'
    }

    const score = velocityScores?.[i] ?? 0
    const hasVelocityData = score > 0 && i < consumedSegmentLimit
    const velocityClass = hasVelocityData
      ? velocityClassForScore(score)
      : undefined
    const highVelocity =
      velocityClass === 'velocity-fast' ||
      velocityClass === 'velocity-hot' ||
      velocityClass === 'velocity-peak'

    return {
      widthPct: 100 / SEGMENTS,
      severityClass,
      highVelocity,
      velocityClass,
    }
  })
}

export function classifyGeminiModel(model: string): string | null {
  const lower = model.toLowerCase()
  if (!lower.startsWith('gemini-')) return null
  if (lower.includes('flash-lite')) return 'gemini-flash-lite'
  if (lower.includes('flash')) return 'gemini-flash'
  if (lower.includes('pro')) return 'gemini-pro'
  return null
}

/** Canonical provider + lowercase model key for joins across usage/health/status. */
export function keyFor(provider: string, model: string): string {
  const p = canonicalProvider(provider ?? '')
  const m = (model ?? '').toLowerCase()
  return `${p}::${m}`
}

function googleShortIntervalStartMs(row: UsageReportQuotaRow): number {
  const iso = row.short_interval_start
  if (iso == null) return 0
  const ms = new Date(iso).getTime()
  return Number.isFinite(ms) ? ms : 0
}

/** Prefer the row with the most recent short_interval_start for a Gemini class. */
export function pickBestGoogleQuotaRowForClass(
  providerRows: UsageReportQuotaRow[],
  googleClass: string
): UsageReportQuotaRow | null {
  let best: UsageReportQuotaRow | null = null
  let bestMs = -1
  for (const row of providerRows) {
    if (row.model === null) continue
    if (classifyGeminiModel(row.model) !== googleClass) continue
    const ms = googleShortIntervalStartMs(row)
    if (ms > bestMs) {
      bestMs = ms
      best = row
    }
  }
  return best
}

/**
 * Sums request counts in the 90 minutes ending at the newest health bucket_start
 * (rolling window anchored on latest data, not wall-clock `now` alone).
 */
export function sumRequestsInLast90mFromNewestBucket(
  rows: UsageReportProviderLatencyHealthRow[],
  now: Date
): number {
  let newestMs = 0
  for (const row of rows) {
    if (row.bucket_start == null) continue
    const t = new Date(row.bucket_start).getTime()
    if (Number.isFinite(t) && t > newestMs) newestMs = t
  }
  const anchorMs = newestMs > 0 ? newestMs : now.getTime()
  const recentCutoffMs = anchorMs - 90 * 60 * 1000
  return rows
    .filter((row) => {
      if (row.bucket_start === null) return false
      const time = new Date(row.bucket_start).getTime()
      return Number.isFinite(time) && time >= recentCutoffMs
    })
    .reduce((s, r) => s + r.requests, 0)
}

/**
 * Returns the best single remaining-pct from an active interval, given:
 *   - short  → '5h'
 *   - weekly → '7d'
 *   - special → '5h' (same period bucket; takes priority over short when active)
 *   - short_special → '5h'
 *   - monthly → 'monthly'
 *   - short → '24h' (for Google — caller maps intervals to display labels)
 *
 * Used by buildQuotaRows to extract single-interval bars per provider.
 */
function extractInterval(
  row: UsageReportQuotaRow,
  interval: QuotaIntervalKind
): {
  remainingPct: number
  resetAt: string | undefined
  velocitySegments?: readonly boolean[]
  velocityScores?: readonly number[]
} | null {
  switch (interval) {
    case 'short':
      if (!row.short_active || row.short_remaining_pct === null) return null
      return {
        remainingPct: row.short_remaining_pct,
        resetAt: row.short_reset_at ?? undefined,
        velocitySegments: row.short_velocity_segments,
        velocityScores: row.short_velocity_scores,
      }

    case 'weekly_overage_included':
      if (
        !row.weekly_overage_included_active ||
        row.weekly_overage_included_remaining_pct === null
      )
        return null
      return {
        remainingPct: row.weekly_overage_included_remaining_pct,
        resetAt: row.weekly_overage_included_reset_at ?? undefined,
        velocitySegments: row.weekly_overage_included_velocity_segments,
        velocityScores: row.weekly_overage_included_velocity_scores,
      }
    case 'weekly':
      if (!row.weekly_active || row.weekly_remaining_pct === null) return null
      return {
        remainingPct: row.weekly_remaining_pct,
        resetAt: row.weekly_reset_at ?? undefined,
        velocitySegments: row.weekly_velocity_segments,
        velocityScores: row.weekly_velocity_scores,
      }
    case 'special':
      if (!row.special_active || row.special_remaining_pct === null) return null
      return {
        remainingPct: row.special_remaining_pct,
        resetAt: row.special_reset_at ?? undefined,
        velocitySegments: row.special_velocity_segments,
        velocityScores: row.special_velocity_scores,
      }
    case 'short_special':
      if (!row.short_special_active || row.short_special_remaining_pct === null)
        return null
      return {
        remainingPct: row.short_special_remaining_pct,
        resetAt: row.short_special_reset_at ?? undefined,
        velocitySegments: row.short_special_velocity_segments,
        velocityScores: row.short_special_velocity_scores,
      }
    case 'monthly':
      if (!row.monthly_active || row.monthly_remaining_pct === null) return null
      return {
        remainingPct: row.monthly_remaining_pct,
        resetAt: row.monthly_reset_at ?? undefined,
        velocitySegments: row.monthly_velocity_segments,
        velocityScores: row.monthly_velocity_scores,
      }
    case 'wtus':
      if (!row.wtus_active || row.wtus_remaining_pct == null) return null
      return {
        remainingPct: row.wtus_remaining_pct,
        resetAt: row.wtus_reset_at ?? undefined,
        velocitySegments: row.wtus_velocity_segments,
        velocityScores: row.wtus_velocity_scores,
      }
    default:
      return null
  }
}

function quotaDurationHours(
  provider: string,
  interval: QuotaIntervalKind
): number {
  const providerLower = provider.toLowerCase()
  if (
    (providerLower === 'google' || providerLower === 'openrouter') &&
    interval === 'short'
  )
    return 24
  if (interval === 'monthly') return 720
  if (interval === 'wtus') return 5
  if (interval === 'short' || interval === 'short_special') return 5
  if (interval === 'weekly_overage_included') return 168
  return 168
}

function quotaUnitFromKey(quotaKey: string | null | undefined): string | null {
  if (quotaKey === undefined || quotaKey === null) return null
  if (quotaKey.endsWith(':credits')) return 'credits'
  if (quotaKey.endsWith(':requests')) return 'requests'
  return null
}

function quotaBillingIdentityBits(
  detail: UsageReportQuotaBillingDetail | undefined,
  fallbackQuotaKey: string | null
): string[] | undefined {
  const quotaKey = detail?.quota_key ?? fallbackQuotaKey
  const quotaUnit = detail?.quota_unit ?? quotaUnitFromKey(quotaKey)
  const bits = [quotaKey, detail?.source, detail?.client, quotaUnit].filter(
    (bit): bit is string => typeof bit === 'string' && bit.trim().length > 0
  )
  return bits.length > 0 ? bits : undefined
}

function quotaIdentityForInterval(
  row: UsageReportQuotaRow,
  interval: QuotaIntervalKind
): string[] | undefined {
  const provider = row.provider.toLowerCase()
  const fallbackQuotaKey =
    provider === 'xai' &&
    typeof row.model === 'string' &&
    row.model.startsWith('xai_grok_build_')
      ? row.model
      : null
  return quotaBillingIdentityBits(
    row.billing_details?.[interval],
    fallbackQuotaKey
  )
}

function resetWindowStartIso(
  resetAt: string | null,
  durationHours: number | undefined
): string | null {
  if (resetAt === null || durationHours === undefined || durationHours <= 0) {
    return null
  }

  const resetMs = new Date(resetAt).getTime()
  if (Number.isNaN(resetMs)) return null

  return new Date(resetMs - durationHours * 3_600_000).toISOString()
}

/**
 * Formats a quota tooltip window label from interval start/end ISO strings.
 *
 * Wave 45 (operator request): emits absolute date+time rather than a relative
 * span so the tooltip header shows the exact window boundaries.  Format is
 * `M/D HH:MM → M/D HH:MM` (both endpoints 30-min snapped via
 * {@link fmtIntervalCompact}).  Monthly quotas still display `this month`.
 *
 * Sentinel guard: the API uses year 9999 (e.g. "9999-12-31T00:00:00.000Z") to
 * mean "no fixed end" for ongoing intervals (i.e. the current active window).
 * For such bars the window end IS "now", so we substitute `new Date()` so the
 * tooltip displays the actual current moment (30-min snapped) rather than the
 * far-future sentinel year.
 *
 * @param intervalType - Which quota interval produced this bar.
 * @param intervalStart - ISO string for interval start, or null.
 * @param intervalEnd   - ISO string for interval end (≈ now or sentinel), or null.
 */
export function formatTipWindow(
  intervalType: QuotaIntervalKind,
  intervalStart: string | null,
  intervalEnd: string | null,
  resetAt: string | null = null,
  durationHours?: number
): string {
  // Monthly quotas: simple label; exact dates rarely meaningful in the tooltip.
  if (intervalType === 'monthly') return 'this month'

  // Current active rows use rate_limit_intervals.fromDate as the latest
  // change point, not the reset-window start. When reset metadata is available,
  // derive the true start from resetAt - durationHours.
  const effectiveStart =
    resetWindowStartIso(resetAt, durationHours) ?? intervalStart

  // Sentinel guard: the API uses year 9999 to mean "no fixed end" (ongoing
  // interval). Current bars always end at "now", so substitute the current
  // timestamp in place of the sentinel so the tooltip shows an accurate bound.
  const effectiveEnd =
    intervalEnd !== null &&
    !Number.isNaN(new Date(intervalEnd).getTime()) &&
    new Date(intervalEnd).getUTCFullYear() > 9000
      ? new Date().toISOString()
      : intervalEnd

  // Emit absolute date+time using the shared compact formatter (30-min snapped).
  return fmtIntervalCompact(effectiveStart, effectiveEnd)
}

/**
 * Rounds a UTC timestamp to the nearest 30-minute boundary.
 * Used to collapse sub-minute poll-jitter duplicates (e.g. 00:04:53, 00:04:54,
 * 00:04:56 → all round to 00:00) into a single logical reset slot.
 *
 * Wave 11: Extracted from the deleted flat-path block; still needed by
 * buildPriorBarFromHistory and lane dedup logic.
 */
export function roundToNearest30Min(iso: string): Date {
  const ms = 30 * 60 * 1000
  return new Date(Math.round(new Date(iso).getTime() / ms) * ms)
}

/**
 * Formats a compact inline date-range label for prior-bar row display, e.g.
 * `5/19 10:00 → 5/20 10:00`. Both bounds are 30-min snapped before formatting
 * so the displayed range matches the snapped slot used for time-ago.
 *
 * Falls back to '—' when either bound is null/unparseable.
 *
 * Wave 11: Extracted from the deleted flat-path block; still needed by
 * buildPriorBarFromHistory.
 */
export function fmtIntervalCompact(
  start: string | null,
  end: string | null
): string {
  if (start === null || end === null) return '—'
  const s = roundToNearest30Min(start)
  const e = roundToNearest30Min(end)
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return '—'
  return formatDashboardIntervalCompact(s, e)
}

/**
 * Derives a reset-window-aware average burn-rate label.
 *
 * The API interval_start marks the latest remaining_pct change point, not the
 * reset-window start, so using it for long quotas wildly inflates the hover
 * value. Use resetAt - durationHours instead, then choose a display unit that
 * matches the quota period.
 */
export function formatTipVelocity(
  consumedPct: number,
  resetAt: string | null,
  durationHours: number
): string | undefined {
  if (resetAt === null || consumedPct === 0 || durationHours <= 0) {
    return undefined
  }

  const resetMs = new Date(resetAt).getTime()
  if (Number.isNaN(resetMs)) return undefined

  const startMs = resetMs - durationHours * 3_600_000
  const effectiveNowMs = Math.min(Date.now(), resetMs)
  const hoursElapsed = (effectiveNowMs - startMs) / 3_600_000
  if (hoursElapsed <= 0) return undefined

  const unitHours = durationHours >= 48 ? 24 : 1
  const unitLabel = unitHours === 24 ? 'd' : 'h'
  const pctPerUnit = consumedPct / (hoursElapsed / unitHours)
  return `avg +${pctPerUnit.toFixed(1)}%/${unitLabel} since reset`
}

/** Test-only aliases for legacy tip unit tests. */
export const _formatTipWindowForTest = formatTipWindow
export const _formatTipVelocityForTest = formatTipVelocity

/**
 * Derives top-3 tipModels from a UsageReportQuotaUsageBreakdown array.
 *
 * Wave 24-PhosphorDash (operator F1b): aggregates cost per model, picks the
 * top 3 by cost, and formats costDelta as `$X.XX` strings.
 * Returns undefined when the breakdown is empty so QuotaBarGroup renders `—`.
 */
export function tipModelsFromBreakdown(
  breakdown: UsageReportQuotaUsageBreakdown[]
): QuotaTipModel[] | undefined {
  if (breakdown.length === 0) return undefined

  // Aggregate per model (breakdown may have duplicates from multiple rows).
  const costByModel = new Map<string, number>()
  const requestsByModel = new Map<string, number>()
  const recentRequests90mByModel = new Map<string, number>()
  for (const entry of breakdown) {
    if (!entry.model) continue
    costByModel.set(
      entry.model,
      (costByModel.get(entry.model) ?? 0) + entry.cost
    )
    requestsByModel.set(
      entry.model,
      (requestsByModel.get(entry.model) ?? 0) + entry.traces
    )
    recentRequests90mByModel.set(
      entry.model,
      (recentRequests90mByModel.get(entry.model) ?? 0) +
        (entry.recent_traces_90m ?? 0)
    )
  }
  if (costByModel.size === 0) return undefined

  return [...costByModel.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([model, cost]) => ({
      model,
      costDelta: `$${cost.toFixed(2)}`,
      requests: requestsByModel.get(model) ?? 0,
      recentRequests90m: recentRequests90mByModel.get(model) ?? 0,
    }))
}

export function tipRequestTotalFromBreakdown(
  breakdown: UsageReportQuotaUsageBreakdown[]
): number | undefined {
  if (breakdown.length === 0) return undefined
  return breakdown.reduce((sum, entry) => sum + entry.traces, 0)
}

export function tipRecentRequestTotal90mFromBreakdown(
  breakdown: UsageReportQuotaUsageBreakdown[]
): number | undefined {
  if (breakdown.length === 0) return undefined
  return breakdown.reduce(
    (sum, entry) => sum + (entry.recent_traces_90m ?? 0),
    0
  )
}

/**
 * Google-specific variant of tipModelsFromBreakdown for prior history bars.
 *
 * Wave 40 item #1: instead of showing raw model names (e.g. gemini-2.5-flash-001,
 * gemini-2.5-flash-preview), aggregates the usage_breakdown into Gemini model
 * class buckets: 'flash-lite', 'flash', 'pro', 'other'. Cost is summed per class
 * and the top 3 classes by cost are returned. This keeps history tooltips concise
 * and avoids overwhelming the operator with individual version names.
 */
export function tipModelsFromBreakdownGoogleAggregated(
  breakdown: UsageReportQuotaUsageBreakdown[]
): QuotaTipModel[] | undefined {
  if (breakdown.length === 0) return undefined

  // Aggregate cost into Gemini class buckets.
  const costByClass = new Map<string, number>()
  const requestsByClass = new Map<string, number>()
  const recentRequests90mByClass = new Map<string, number>()
  for (const entry of breakdown) {
    if (!entry.model) continue
    const lower = entry.model.toLowerCase()
    let cls: string
    // Order of checks matters: flash-lite before flash.
    if (lower.includes('flash-lite')) {
      cls = 'flash-lite'
    } else if (lower.includes('flash')) {
      cls = 'flash'
    } else if (lower.includes('pro')) {
      cls = 'pro'
    } else {
      cls = 'other'
    }
    costByClass.set(cls, (costByClass.get(cls) ?? 0) + entry.cost)
    requestsByClass.set(cls, (requestsByClass.get(cls) ?? 0) + entry.traces)
    recentRequests90mByClass.set(
      cls,
      (recentRequests90mByClass.get(cls) ?? 0) + (entry.recent_traces_90m ?? 0)
    )
  }
  if (costByClass.size === 0) return undefined

  return [...costByClass.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([cls, cost]) => ({
      model: cls,
      costDelta: `$${cost.toFixed(2)}`,
      requests: requestsByClass.get(cls) ?? 0,
      recentRequests90m: recentRequests90mByClass.get(cls) ?? 0,
    }))
}

/**
 * Anthropic/OpenAI weekly-tier variant of tipModelsFromBreakdown for prior bars.
 *
 * Wave 40 item #2: for Anthropic weekly + weekly_special tiers, collapses all
 * model breakdown entries into a single 'sonnet' label. For OpenAI weekly +
 * weekly_special, collapses to 'codex-spark'. Returns undefined when breakdown
 * is empty.
 *
 * Interpretation: the operator wants the *tier display name* as a single label
 * in history tooltips — the same name used in the current active bar label —
 * rather than per-model granularity.
 */
export function tipModelsFromBreakdownSingleLabel(
  breakdown: UsageReportQuotaUsageBreakdown[],
  displayLabel: string
): QuotaTipModel[] | undefined {
  if (breakdown.length === 0) return undefined
  const totalCost = breakdown.reduce((s, e) => s + e.cost, 0)
  const requests = breakdown.reduce((s, e) => s + e.traces, 0)
  const recentRequests90m = breakdown.reduce(
    (s, e) => s + (e.recent_traces_90m ?? 0),
    0
  )
  return [
    {
      model: displayLabel,
      costDelta: `$${totalCost.toFixed(2)}`,
      requests,
      recentRequests90m,
    },
  ]
}

/**
 * Formats a "time ago" string for a prior reset bar relative to now.
 *
 * Wave 40 item #5: uses the 30-min-rounded period_start timestamp as the base
 * for calculation so the displayed age is consistent with the snapped date shown
 * in the bar label. Falls back to '—' when input is null or unparseable.
 *
 * Output format (compact, one unit of precision):
 *   past:  < 1h  → "45m ago", < 24h → "3h ago", …
 *   future (>1 min ahead): "in 30m", "in 2h", … (G3 — not misleading "… ago")
 *   within 1 min in the future → "just now"
 */
function formatRelativeTimeFromAbsMs(
  absDiffMs: number,
  future: boolean
): string {
  const totalMins = Math.floor(absDiffMs / 60_000)
  const hours = Math.floor(totalMins / 60)
  const days = Math.floor(hours / 24)
  const weeks = Math.floor(days / 7)
  let core: string
  if (totalMins < 60) core = `${totalMins.toString()}m`
  else if (hours < 24) core = `${hours.toString()}h`
  else if (days < 14) core = `${days.toString()}d`
  else core = `${weeks.toString()}w`
  return future ? `in ${core}` : `${core} ago`
}

export function formatTimeAgo(roundedDate: Date): string {
  const diffMs = Date.now() - roundedDate.getTime()
  const absDiffMs = Math.abs(diffMs)
  if (diffMs < -60_000) {
    return formatRelativeTimeFromAbsMs(absDiffMs, true)
  }
  if (diffMs < 0) return 'just now'
  return formatRelativeTimeFromAbsMs(absDiffMs, false)
}

export function makeQuotaBarGroup(
  label: string,
  row: UsageReportQuotaRow,
  interval: QuotaIntervalKind
): QuotaBarGroup | null {
  const iv = extractInterval(row, interval)
  if (iv === null) return null
  const consumedPct = Math.max(0, Math.min(100, 100 - iv.remainingPct))
  const durationHours = quotaDurationHours(row.provider, interval)

  // F1b: interval_start/end for tipWindow, breakdown for tipModels.
  let intervalStart: string | null = null
  let intervalEnd: string | null = null
  let breakdown: UsageReportQuotaUsageBreakdown[] = []
  switch (interval) {
    case 'short':
      intervalStart = row.short_interval_start
      intervalEnd = row.short_interval_end
      breakdown = row.short_usage_breakdown
      break

    case 'weekly_overage_included':
      intervalStart = row.weekly_overage_included_interval_start
      intervalEnd = row.weekly_overage_included_interval_end
      breakdown = row.weekly_overage_included_usage_breakdown
      break
    case 'weekly':
      intervalStart = row.weekly_interval_start
      intervalEnd = row.weekly_interval_end
      breakdown = row.weekly_usage_breakdown
      break
    case 'special':
      intervalStart = row.special_interval_start
      intervalEnd = row.special_interval_end
      breakdown = row.special_usage_breakdown
      break
    case 'short_special':
      intervalStart = row.short_special_interval_start
      intervalEnd = row.short_special_interval_end
      breakdown = row.short_special_usage_breakdown
      break
    case 'monthly':
      intervalStart = row.monthly_interval_start
      intervalEnd = row.monthly_interval_end
      breakdown = row.monthly_usage_breakdown
      break
    case 'wtus':
      intervalStart = row.wtus_interval_start ?? null
      intervalEnd = row.wtus_interval_end ?? null
      breakdown = row.wtus_usage_breakdown ?? []
      break
  }

  return {
    label,
    consumedPct,
    remainingPct: iv.remainingPct,
    resetAt: iv.resetAt,
    segments: buildQuotaSegments(iv.remainingPct, iv.velocityScores),
    // F1b: computed tip fields.
    tipWindow: formatTipWindow(
      interval,
      intervalStart,
      intervalEnd,
      iv.resetAt ?? null,
      durationHours
    ),
    tipVelocity: formatTipVelocity(
      consumedPct,
      iv.resetAt ?? null,
      durationHours
    ),
    tipIdentity: quotaIdentityForInterval(row, interval),
    tipModels: tipModelsFromBreakdown(breakdown),
    tipRequestTotal: tipRequestTotalFromBreakdown(breakdown),
    tipRecentRequestTotal90m: tipRecentRequestTotal90mFromBreakdown(breakdown),
  }
}

/**
 * Like makeQuotaBarGroup but ALWAYS emits a bar — never returns null.
 *
 * Wave 28 fix: openai and anthropic must always render 4 quota bars so the
 * operator card layout is stable even when an interval is not currently active
 * (e.g. `short_special_active=false` for anthropic's sonnet · 5h bar).
 *
 * When the underlying interval is inactive or its remaining_pct is null, this
 * function returns a zero-consumed bar (`consumedPct=0, remainingPct=100`)
 * using the interval's timestamp fallback labels via `formatTipWindow`.
 *
 * Only used for the openai and anthropic provider branches in buildQuotaRows.
 * All other providers continue to use makeQuotaBarGroup (null → omit).
 */
export function makeQuotaBarGroupAlways(
  label: string,
  row: UsageReportQuotaRow,
  interval: QuotaIntervalKind
): QuotaBarGroup {
  const existing = makeQuotaBarGroup(label, row, interval)
  if (existing !== null) return existing
  const durationHours = quotaDurationHours(row.provider, interval)

  // Interval is inactive or pct is null — emit a 0%-consumed placeholder bar.
  let intervalStart: string | null = null
  let intervalEnd: string | null = null
  let breakdown: UsageReportQuotaUsageBreakdown[] = []
  switch (interval) {
    case 'short':
      intervalStart = row.short_interval_start
      intervalEnd = row.short_interval_end
      breakdown = row.short_usage_breakdown
      break

    case 'weekly_overage_included':
      intervalStart = row.weekly_overage_included_interval_start
      intervalEnd = row.weekly_overage_included_interval_end
      breakdown = row.weekly_overage_included_usage_breakdown
      break
    case 'weekly':
      intervalStart = row.weekly_interval_start
      intervalEnd = row.weekly_interval_end
      breakdown = row.weekly_usage_breakdown
      break
    case 'special':
      intervalStart = row.special_interval_start
      intervalEnd = row.special_interval_end
      breakdown = row.special_usage_breakdown
      break
    case 'short_special':
      intervalStart = row.short_special_interval_start
      intervalEnd = row.short_special_interval_end
      breakdown = row.short_special_usage_breakdown
      break
    case 'monthly':
      intervalStart = row.monthly_interval_start
      intervalEnd = row.monthly_interval_end
      breakdown = row.monthly_usage_breakdown
      break
    case 'wtus':
      intervalStart = row.wtus_interval_start ?? null
      intervalEnd = row.wtus_interval_end ?? null
      breakdown = row.wtus_usage_breakdown ?? []
      break
  }

  return {
    label,
    consumedPct: 0,
    remainingPct: 100,
    segments: buildQuotaSegments(100),
    tipWindow: formatTipWindow(
      interval,
      intervalStart,
      intervalEnd,
      null,
      durationHours
    ),
    tipIdentity: quotaIdentityForInterval(row, interval),
    tipModels: tipModelsFromBreakdown(breakdown),
    tipRequestTotal: tipRequestTotalFromBreakdown(breakdown),
    tipRecentRequestTotal90m: tipRecentRequestTotal90mFromBreakdown(breakdown),
  }
}

/**
 * Maps a normalised quota_type to the QuotaBarGroup periodType for prior bars.
 */
export function quotaTypeToBarPeriodType(
  quotaType: string
): QuotaBarGroup['periodType'] {
  switch (quotaType.toLowerCase()) {
    case 'short':
    case 'short_special':
    case 'wtus':
      return '5hr'
    case 'weekly':
      return 'weekly'
    case 'weekly_overage_included':
      return 'weekly_overage_included'
    case 'special':
    case 'weekly_special':
      return 'special'
    case 'monthly':
      return 'monthly'
    default:
      return 'weekly'
  }
}

export function quotaTypeToLaneKey(quotaType: string): string {
  switch (quotaType.toLowerCase()) {
    case 'short':
      return 'short'
    case 'weekly':
      return 'weekly'
    case 'weekly_overage_included':
      return 'weekly_overage_included'
    case 'special':
      return 'special'
    case 'short_special':
      return 'short_special'
    case 'monthly':
      return 'monthly'
    default:
      return quotaType.toLowerCase()
  }
}
