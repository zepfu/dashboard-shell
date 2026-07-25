/**
 * Quota lane assembly (current + prior bars).
 * Wave 11: extracted from phosphor-dashboard.testkit.ts
 */
import type {
  UsageReportQuotaHistoryRow,
  UsageReportQuotaRow,
} from '../../api/usage-report'
import type {
  QuotaBarGroup,
  QuotaLane,
  QuotaTipModel,
} from '../../components/provider-card'
import { providerAliases } from '../usage-report-display'
import {
  buildQuotaSegments,
  classifyGeminiModel,
  formatQuotaAccountSuffix,
  fmtIntervalCompact,
  formatTimeAgo,
  makeQuotaBarGroup,
  makeQuotaBarGroupAlways,
  pickBestGoogleQuotaRowForClass,
  quotaTypeToBarPeriodType,
  quotaTypeToLaneKey,
  roundToNearest30Min,
  tipModelsFromBreakdown,
  tipModelsFromBreakdownGoogleAggregated,
  tipModelsFromBreakdownSingleLabel,
  tipRecentRequestTotal90mFromBreakdown,
  tipRequestTotalFromBreakdown,
} from './fields'
import { PROVIDER_LANE_DEFS } from './lane-defs'

type QuotaBarInterval = Parameters<typeof makeQuotaBarGroup>[2]

function quotaTypeToBarInterval(quotaType: string): QuotaBarInterval {
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
    case 'wtus':
      return 'wtus'
    default:
      return 'weekly'
  }
}

function safeQuotaHistoryAccountRef(
  accountRef: string | null | undefined
): string | null {
  const normalized = accountRef?.trim()
  return normalized !== undefined && /^[a-f0-9]{8}$/i.test(normalized)
    ? normalized
    : null
}

function expectedAlibabaQuotaPeriod(quotaType: string): string | null {
  switch (quotaTypeToLaneKey(quotaType)) {
    case 'short':
      return '5h'
    case 'weekly':
      return '7d'
    default:
      return null
  }
}

function quotaHistoryAccountRefIsSafe(
  row: UsageReportQuotaHistoryRow
): boolean {
  const supplied = row.account_ref?.trim()
  return !supplied || safeQuotaHistoryAccountRef(supplied) !== null
}

function priorBarDedupKey(h: UsageReportQuotaHistoryRow): string {
  const identity = [
    h.provider,
    h.quota_type,
    h.quota_key ?? '',
    h.quota_period ?? '',
    h.source ?? '',
    safeQuotaHistoryAccountRef(h.account_ref) ?? '',
  ].join(':')
  if (h.expected_reset_at !== null) {
    const rounded = roundToNearest30Min(h.expected_reset_at)
    if (!Number.isNaN(rounded.getTime())) {
      return `${identity}:${rounded.toISOString()}`
    }
  }
  const start = h.interval_start?.trim()
  if (start) return `${identity}:null-reset:${start}`
  return `${identity}:null-reset:${String(h.min_remaining_pct)}`
}

function shouldSuppressProviderLanePriorBars(
  providerLower: string,
  def: { quotaType: string }
): boolean {
  return (
    providerLower === 'openai' &&
    quotaTypeToLaneKey(def.quotaType) === 'short_special'
  )
}

function quotaHistoryIdentityBits(
  row: UsageReportQuotaHistoryRow
): string[] | undefined {
  const accountRef = safeQuotaHistoryAccountRef(row.account_ref)
  const accountSuffix =
    accountRef === null ? null : formatQuotaAccountSuffix(accountRef)
  const bits = [
    row.provider,
    row.quota_key,
    row.quota_period,
    row.source,
    row.client,
    row.quota_unit,
    accountSuffix === null ? null : `account ${accountSuffix}`,
  ].filter(
    (bit): bit is string => typeof bit === 'string' && bit.trim().length > 0
  )
  return bits.length > 0 ? bits : undefined
}

function buildPriorBarsForLane(
  laneHistory: UsageReportQuotaHistoryRow[],
  currentBar: QuotaBarGroup | null,
  laneProvider: string
): QuotaBarGroup[] {
  const thirtyMinutesMs = 30 * 60 * 1000
  const currentRoundedResetMs: number | null =
    currentBar?.resetAt !== undefined
      ? roundToNearest30Min(currentBar.resetAt).getTime()
      : null
  const seen = new Set<string>()
  const priorBars: QuotaBarGroup[] = []
  const sortedHistory = [...laneHistory].sort((a, b) => {
    const ad = a.expected_reset_at ?? ''
    const bd = b.expected_reset_at ?? ''
    return bd < ad ? -1 : bd > ad ? 1 : 0
  })

  for (const historyRow of sortedHistory) {
    if (historyRow.min_remaining_pct === null) continue

    const roundedSlotDate =
      historyRow.expected_reset_at !== null
        ? roundToNearest30Min(historyRow.expected_reset_at)
        : null
    if (roundedSlotDate !== null && Number.isNaN(roundedSlotDate.getTime())) {
      continue
    }

    const roundedSlot = priorBarDedupKey(historyRow)
    if (
      roundedSlotDate !== null &&
      currentRoundedResetMs !== null &&
      Math.abs(currentRoundedResetMs - roundedSlotDate.getTime()) <=
        thirtyMinutesMs
    ) {
      continue
    }

    if (seen.has(roundedSlot)) continue
    seen.add(roundedSlot)
    priorBars.push(buildPriorBarFromHistory(historyRow, laneProvider))
  }

  return priorBars
}

export function buildPriorBarFromHistory(
  h: UsageReportQuotaHistoryRow,
  provider: string
): QuotaBarGroup {
  const quotaTypeLower = h.quota_type.toLowerCase()
  const roundedSlotDate =
    h.expected_reset_at !== null
      ? roundToNearest30Min(h.expected_reset_at)
      : null
  const timeAgoLabel =
    roundedSlotDate !== null ? formatTimeAgo(roundedSlotDate) : '—'

  if (h.min_remaining_pct === null) {
    return {
      label: timeAgoLabel,
      consumedPct: 0,
      remainingPct: 100,
      resetAt: h.expected_reset_at ?? undefined,
      segments: buildQuotaSegments(100, h.velocity_scores),
      tipWindow: fmtIntervalCompact(h.interval_start, h.interval_end),
      tipIdentity: quotaHistoryIdentityBits(h),
      tipModels: undefined,
      tipRequestTotal: tipRequestTotalFromBreakdown(h.usage_breakdown),
      tipRecentRequestTotal90m: tipRecentRequestTotal90mFromBreakdown(
        h.usage_breakdown
      ),
      timeAgoLabel,
      dateRangeLabel: fmtIntervalCompact(h.interval_start, h.expected_reset_at),
      periodType: quotaTypeToBarPeriodType(quotaTypeLower),
      showSubPercentPrecision: provider.toLowerCase() === 'alibaba_token_plan',
    }
  }

  const remainingPct = h.min_remaining_pct
  const consumedPct = Math.max(0, Math.min(100, 100 - remainingPct))

  let tipModels: QuotaTipModel[] | undefined
  const providerLower = provider.toLowerCase()
  if (providerLower === 'google') {
    tipModels = tipModelsFromBreakdownGoogleAggregated(h.usage_breakdown)
  } else if (
    providerLower === 'anthropic' &&
    quotaTypeLower === 'weekly_overage_included'
  ) {
    tipModels = tipModelsFromBreakdownSingleLabel(
      h.usage_breakdown,
      'fable-7d-oi'
    )
  } else if (providerLower === 'anthropic' && quotaTypeLower === 'special') {
    tipModels = tipModelsFromBreakdownSingleLabel(
      h.usage_breakdown,
      'retired-sonnet'
    )
  } else if (
    providerLower === 'openai' &&
    (quotaTypeLower === 'weekly' || quotaTypeLower === 'special')
  ) {
    tipModels = tipModelsFromBreakdownSingleLabel(
      h.usage_breakdown,
      'codex-spark'
    )
  } else {
    tipModels = tipModelsFromBreakdown(h.usage_breakdown)
  }

  const dateRangeLabel = fmtIntervalCompact(
    h.interval_start,
    h.expected_reset_at
  )

  return {
    label: timeAgoLabel,
    consumedPct,
    remainingPct,
    resetAt: h.expected_reset_at ?? undefined,
    segments: buildQuotaSegments(remainingPct, h.velocity_scores),
    tipWindow: fmtIntervalCompact(h.interval_start, h.interval_end),
    tipIdentity: quotaHistoryIdentityBits(h),
    tipModels,
    tipRequestTotal: tipRequestTotalFromBreakdown(h.usage_breakdown),
    tipRecentRequestTotal90m: tipRecentRequestTotal90mFromBreakdown(
      h.usage_breakdown
    ),
    timeAgoLabel,
    dateRangeLabel,
    periodType: quotaTypeToBarPeriodType(quotaTypeLower),
    showSubPercentPrecision: providerLower === 'alibaba_token_plan',
  }
}

/**
 * Builds `QuotaLane[]` for a single provider by combining current quota rows
 * with history rows. Each lane = one quota type, current bar + prior bars.
 *
 * Wave 41 multi-reset redesign (replaces Wave 40 flat list):
 *
 * For each lane defined in PROVIDER_LANE_DEFS[provider]:
 * 1. Find the current bar from `allQuotaRows` using the existing `buildQuotaRows`
 *    (single-bar) logic per quota type.
 * 2. Find all matching history rows for this lane's quota_type (and Google
 *    model class) from `historyRows`, deduplicate by 30-min slot, and sort
 *    newest-first.
 * 3. Return a `QuotaLane` with `currentBar` + `priorBars`.
 *
 * Only lanes defined in PROVIDER_LANE_DEFS are rendered; unknown providers
 * fall back to the old `buildQuotaRows` flat-list path (no lanes prop passed).
 *
 * @param provider    — canonical provider name (lowercase)
 * @param allQuotaRows — full quotas[] from /api/shell/reports/quotas
 * @param historyRows  — full quotaHistory[] from the usage report
 */
export function buildProviderLanes(
  provider: string,
  allQuotaRows: UsageReportQuotaRow[],
  historyRows: UsageReportQuotaHistoryRow[]
): QuotaLane[] {
  const providerLower = provider.toLowerCase()
  const laneDefs = PROVIDER_LANE_DEFS[providerLower]
  if (laneDefs === undefined || laneDefs.length === 0) return []

  const result: QuotaLane[] = []
  const alibabaAccountRefs =
    providerLower === 'alibaba_token_plan'
      ? new Set(
          allQuotaRows
            .filter(
              (row) =>
                row.provider.toLowerCase() === 'alibaba_token_plan' &&
                safeQuotaHistoryAccountRef(row.account_ref) !== null
            )
            .map((row) => safeQuotaHistoryAccountRef(row.account_ref)!)
        )
      : new Set<string>()
  const hasMultipleAlibabaAccounts = alibabaAccountRefs.size > 1
  const singleAlibabaAccountRef =
    alibabaAccountRefs.size === 1
      ? (alibabaAccountRefs.values().next().value ?? null)
      : null

  for (const def of laneDefs) {
    const laneProvider = (def.sourceProvider ?? providerLower).toLowerCase()
    const laneAliases = providerAliases(laneProvider)
    const laneQuotas = allQuotaRows.filter((r) =>
      laneAliases.includes(r.provider.toLowerCase())
    )

    if (
      laneProvider === 'alibaba_token_plan' &&
      def.quotaKey !== undefined &&
      hasMultipleAlibabaAccounts
    ) {
      const interval = quotaTypeToBarInterval(def.quotaType)
      const matchingRows = laneQuotas.filter(
        (quota) => quota.billing_details?.[interval]?.quota_key === def.quotaKey
      )
      const seenAccounts = new Set<string>()
      const expectedQuotaPeriod = expectedAlibabaQuotaPeriod(def.quotaType)

      matchingRows.forEach((row, index) => {
        const accountRef =
          safeQuotaHistoryAccountRef(row.account_ref) ?? `unidentified-${index}`
        if (seenAccounts.has(accountRef)) return
        seenAccounts.add(accountRef)

        const accountSuffix = formatQuotaAccountSuffix(row.account_ref)
        const laneLabel =
          accountSuffix === null
            ? def.laneLabel
            : `${def.laneLabel} · ${accountSuffix}`
        const currentBar = makeQuotaBarGroup(laneLabel, row, interval)
        if (currentBar === null) return
        const laneHistory = historyRows.filter((historyRow) => {
          if (!quotaHistoryAccountRefIsSafe(historyRow)) return false
          if (
            !laneAliases.includes(historyRow.provider.toLowerCase()) ||
            quotaTypeToLaneKey(historyRow.quota_type) !==
              quotaTypeToLaneKey(def.quotaType) ||
            historyRow.quota_key !== def.quotaKey
          ) {
            return false
          }
          if (
            expectedQuotaPeriod !== null &&
            historyRow.quota_period !== null &&
            historyRow.quota_period !== undefined &&
            historyRow.quota_period.toLowerCase() !== expectedQuotaPeriod
          ) {
            return false
          }
          return (
            safeQuotaHistoryAccountRef(historyRow.account_ref) === accountRef
          )
        })

        result.push({
          laneKey: `${def.laneKey}/${accountRef}`,
          laneLabel,
          currentBar,
          priorBars: buildPriorBarsForLane(
            laneHistory,
            currentBar,
            laneProvider
          ),
        })
      })
      continue
    }

    // ── 1. Build current bar ────────────────────────────────────────────────
    let currentBar: QuotaBarGroup | null = null

    if (laneProvider === 'google' && def.googleClass !== null) {
      const bestRow = pickBestGoogleQuotaRowForClass(
        laneQuotas,
        def.googleClass
      )
      if (bestRow !== null) {
        const g = makeQuotaBarGroup(`${def.laneLabel}`, bestRow, 'short')
        if (g !== null) {
          // Aggregate short_usage_breakdown across ALL same-class rows so that
          // split quota rows (e.g. gemini-2.5-flash-lite vs gemini-3.1-flash-lite-preview)
          // are merged into one class-bucket tooltip instead of showing "— —".
          const mergedBreakdown = laneQuotas
            .filter(
              (r) =>
                r.model !== null &&
                classifyGeminiModel(r.model) === def.googleClass
            )
            .flatMap((r) => r.short_usage_breakdown)
          const aggregatedTipModels =
            tipModelsFromBreakdownGoogleAggregated(mergedBreakdown)
          currentBar = {
            ...g,
            label: def.laneLabel,
            tipModels: aggregatedTipModels,
            tipRequestTotal: tipRequestTotalFromBreakdown(mergedBreakdown),
            tipRecentRequestTotal90m:
              tipRecentRequestTotal90mFromBreakdown(mergedBreakdown),
          }
        }
      }
    } else if (laneProvider === 'antigravity' && def.quotaKey !== undefined) {
      const row = laneQuotas.find((quota) => quota.model === def.quotaKey)
      if (row !== undefined) {
        currentBar = makeQuotaBarGroup(def.laneLabel, row, 'wtus')
      }
    } else if (laneProvider === 'xai' && def.quotaKey !== undefined) {
      const row = laneQuotas.find((quota) => quota.model === def.quotaKey)
      if (row !== undefined) {
        const interval =
          def.quotaType === 'weekly'
            ? 'weekly'
            : def.quotaType === 'monthly'
              ? 'monthly'
              : 'monthly'
        currentBar = makeQuotaBarGroup(def.laneLabel, row, interval)
      }
    } else if (
      laneProvider === 'alibaba_token_plan' &&
      def.quotaKey !== undefined
    ) {
      const interval = quotaTypeToBarInterval(def.quotaType)
      const row = laneQuotas.find(
        (quota) => quota.billing_details?.[interval]?.quota_key === def.quotaKey
      )
      if (row !== undefined) {
        currentBar = makeQuotaBarGroup(def.laneLabel, row, interval)
      }
    } else {
      // Anthropic / OpenAI: all quota data lives in the model=null row.
      const allRow = laneQuotas.find((r) => r.model === null)
      if (allRow !== undefined) {
        const interval = quotaTypeToBarInterval(def.quotaType)
        const g =
          laneProvider === 'openai'
            ? makeQuotaBarGroupAlways(def.laneLabel, allRow, interval)
            : makeQuotaBarGroup(def.laneLabel, allRow, interval)
        if (g !== null) {
          currentBar = g
        }
      }
    }

    // ── 2. Build prior bars ─────────────────────────────────────────────────
    // Filter history rows to this lane's quota_type (+ Google class).
    const laneHistory = shouldSuppressProviderLanePriorBars(laneProvider, def)
      ? []
      : historyRows.filter((h) => {
          if (!laneAliases.includes(h.provider.toLowerCase())) return false
          const htLower = h.quota_type.toLowerCase()
          if (htLower !== quotaTypeToLaneKey(def.quotaType)) return false
          // Google: additionally filter by model class.
          if (laneProvider === 'google' && def.googleClass !== null) {
            if (h.model === null) return false
            const cls = classifyGeminiModel(h.model)
            return cls === def.googleClass
          }
          if (laneProvider === 'antigravity' && def.quotaKey !== undefined) {
            return h.model === def.quotaKey
          }
          if (laneProvider === 'xai' && def.quotaKey !== undefined) {
            return h.model === def.quotaKey || h.quota_key === def.quotaKey
          }
          if (
            laneProvider === 'alibaba_token_plan' &&
            def.quotaKey !== undefined
          ) {
            if (!quotaHistoryAccountRefIsSafe(h)) return false
            if (h.quota_key !== def.quotaKey) return false
            const expectedQuotaPeriod = expectedAlibabaQuotaPeriod(
              def.quotaType
            )
            if (
              expectedQuotaPeriod !== null &&
              h.quota_period !== null &&
              h.quota_period !== undefined &&
              h.quota_period.toLowerCase() !== expectedQuotaPeriod
            ) {
              return false
            }
            const historyAccountRef = safeQuotaHistoryAccountRef(h.account_ref)
            return (
              singleAlibabaAccountRef === null ||
              historyAccountRef === null ||
              historyAccountRef === singleAlibabaAccountRef
            )
          }
          return true
        })

    const priorBars = buildPriorBarsForLane(
      laneHistory,
      currentBar,
      laneProvider
    )

    result.push({
      laneKey: def.laneKey,
      laneLabel: def.laneLabel,
      currentBar,
      priorBars,
    })
  }

  // Return only lanes that have at least a current bar OR prior bars.
  return result.filter((l) => l.currentBar !== null || l.priorBars.length > 0)
}
