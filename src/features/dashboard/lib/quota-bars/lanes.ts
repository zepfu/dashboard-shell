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
import { providerAliases, QUOTA_ONLY_PROVIDERS } from '../usage-report-display'
import {
  buildQuotaSegments,
  classifyGeminiModel,
  formatQuotaAccountSuffix,
  fmtIntervalCompact,
  formatTimeAgo,
  isSubPercentPrecisionProvider,
  makeQuotaBarGroup,
  makeQuotaBarGroupAlways,
  matchesKimiCodeQuotaContract,
  normalizeQuotaAccountRef,
  pickBestGoogleQuotaRowForClass,
  quotaTypeToBarPeriodType,
  quotaTypeToLaneKey,
  resolveQuotaAccountIdentities,
  roundToNearest30Min,
  tipModelsFromBreakdown,
  tipModelsFromBreakdownGoogleAggregated,
  tipModelsFromBreakdownSingleLabel,
  tipRecentRequestTotal90mFromBreakdown,
  tipRequestTotalFromBreakdown,
} from './fields'
import { PROVIDER_LANE_DEFS } from './lane-defs'

type QuotaBarInterval = Parameters<typeof makeQuotaBarGroup>[2]
type ResolvedQuotaAccountIdentity = ReturnType<
  typeof resolveQuotaAccountIdentities
>[number]

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

/**
 * Expected provider-reported quota period for quota-only subscription lanes
 * (D1-489 Alibaba Token Plan credits, D1-492 Kimi Code quota units). History
 * rows carrying a quota_period must match this to join a lane.
 */
function expectedQuotaOnlyQuotaPeriod(quotaType: string): string | null {
  switch (quotaTypeToLaneKey(quotaType)) {
    case 'short':
      return '5h'
    case 'weekly':
      return '7d'
    default:
      return null
  }
}

function quotaOnlyCurrentRowMatchesContract(
  provider: string,
  row: UsageReportQuotaRow,
  interval: QuotaBarInterval,
  quotaKey: string,
  quotaPeriod: string | null
): boolean {
  const detail = row.billing_details?.[interval]
  if (provider === 'kimi_code') {
    return (
      quotaPeriod !== null &&
      matchesKimiCodeQuotaContract(detail, quotaKey, quotaPeriod as '5h' | '7d')
    )
  }

  return (
    detail?.quota_key === quotaKey &&
    (quotaPeriod === null ||
      detail.quota_period == null ||
      detail.quota_period.toLowerCase() === quotaPeriod)
  )
}

function quotaOnlyHistoryRowMatchesContract(
  provider: string,
  row: UsageReportQuotaHistoryRow,
  quotaKey: string,
  quotaPeriod: string | null
): boolean {
  if (provider === 'kimi_code') {
    return (
      quotaPeriod !== null &&
      matchesKimiCodeQuotaContract(row, quotaKey, quotaPeriod as '5h' | '7d')
    )
  }

  return (
    row.quota_key === quotaKey &&
    (quotaPeriod === null ||
      row.quota_period == null ||
      row.quota_period.toLowerCase() === quotaPeriod)
  )
}

function priorBarDedupKey(h: UsageReportQuotaHistoryRow): string {
  const identity = [
    h.provider,
    h.quota_type,
    h.quota_key ?? '',
    h.quota_period ?? '',
    h.source ?? '',
    normalizeQuotaAccountRef(h.account_ref) ?? '',
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
  const accountRef = normalizeQuotaAccountRef(row.account_ref)
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

function quotaHistoryAbsolutesUnavailable(
  row: UsageReportQuotaHistoryRow
): boolean | undefined {
  if (row.quota_unit == null) return undefined
  return row.quota_limit == null &&
    row.quota_used == null &&
    row.quota_remaining == null
    ? true
    : undefined
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
      tipQuotaLimit: h.quota_limit,
      tipQuotaUsed: h.quota_used,
      tipQuotaRemaining: h.quota_remaining,
      tipQuotaUnit: h.quota_unit ?? undefined,
      tipAbsolutesUnavailable: quotaHistoryAbsolutesUnavailable(h),
      tipModels: undefined,
      tipRequestTotal: tipRequestTotalFromBreakdown(h.usage_breakdown),
      tipRecentRequestTotal90m: tipRecentRequestTotal90mFromBreakdown(
        h.usage_breakdown
      ),
      timeAgoLabel,
      dateRangeLabel: fmtIntervalCompact(h.interval_start, h.expected_reset_at),
      periodType: quotaTypeToBarPeriodType(quotaTypeLower),
      showSubPercentPrecision: isSubPercentPrecisionProvider(provider),
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
    tipQuotaLimit: h.quota_limit,
    tipQuotaUsed: h.quota_used,
    tipQuotaRemaining: h.quota_remaining,
    tipQuotaUnit: h.quota_unit ?? undefined,
    tipAbsolutesUnavailable: quotaHistoryAbsolutesUnavailable(h),
    tipModels,
    tipRequestTotal: tipRequestTotalFromBreakdown(h.usage_breakdown),
    tipRecentRequestTotal90m: tipRecentRequestTotal90mFromBreakdown(
      h.usage_breakdown
    ),
    timeAgoLabel,
    dateRangeLabel,
    periodType: quotaTypeToBarPeriodType(quotaTypeLower),
    showSubPercentPrecision: isSubPercentPrecisionProvider(providerLower),
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

  const providerWideKimiIdentityByRow =
    providerLower === 'kimi_code'
      ? (() => {
          const kimiAliases = providerAliases('kimi_code')
          const currentRows = allQuotaRows.filter(
            (row) =>
              kimiAliases.includes(row.provider.toLowerCase()) &&
              laneDefs.some((def) => {
                if (def.quotaKey === undefined) return false
                return quotaOnlyCurrentRowMatchesContract(
                  'kimi_code',
                  row,
                  quotaTypeToBarInterval(def.quotaType),
                  def.quotaKey,
                  expectedQuotaOnlyQuotaPeriod(def.quotaType)
                )
              })
          )
          const providerHistoryRows = historyRows.filter(
            (row) =>
              kimiAliases.includes(row.provider.toLowerCase()) &&
              laneDefs.some((def) => {
                if (
                  def.quotaKey === undefined ||
                  quotaTypeToLaneKey(row.quota_type) !==
                    quotaTypeToLaneKey(def.quotaType)
                ) {
                  return false
                }
                return quotaOnlyHistoryRowMatchesContract(
                  'kimi_code',
                  row,
                  def.quotaKey,
                  expectedQuotaOnlyQuotaPeriod(def.quotaType)
                )
              })
          )
          const providerRows: Array<
            UsageReportQuotaRow | UsageReportQuotaHistoryRow
          > = [...currentRows, ...providerHistoryRows]
          const identities = resolveQuotaAccountIdentities(
            providerRows.map((row) => row.account_ref)
          )

          return new Map<
            UsageReportQuotaRow | UsageReportQuotaHistoryRow,
            ResolvedQuotaAccountIdentity
          >(providerRows.map((row, index) => [row, identities[index]] as const))
        })()
      : null

  const result: QuotaLane[] = []

  for (const def of laneDefs) {
    const laneProvider = (def.sourceProvider ?? providerLower).toLowerCase()
    const laneAliases = providerAliases(laneProvider)
    const laneQuotas = allQuotaRows.filter((r) =>
      laneAliases.includes(r.provider.toLowerCase())
    )

    if (
      QUOTA_ONLY_PROVIDERS.includes(laneProvider) &&
      def.quotaKey !== undefined
    ) {
      const interval = quotaTypeToBarInterval(def.quotaType)
      const expectedQuotaPeriod = expectedQuotaOnlyQuotaPeriod(def.quotaType)
      const matchingRows = laneQuotas.filter((quota) =>
        quotaOnlyCurrentRowMatchesContract(
          laneProvider,
          quota,
          interval,
          def.quotaKey!,
          expectedQuotaPeriod
        )
      )
      const matchingHistory = historyRows.filter((historyRow) => {
        if (
          !laneAliases.includes(historyRow.provider.toLowerCase()) ||
          quotaTypeToLaneKey(historyRow.quota_type) !==
            quotaTypeToLaneKey(def.quotaType)
        ) {
          return false
        }
        return quotaOnlyHistoryRowMatchesContract(
          laneProvider,
          historyRow,
          def.quotaKey!,
          expectedQuotaPeriod
        )
      })

      type AccountGroup = {
        publicKey: string
        accountRef: string | null
        currentRows: Array<{
          row: UsageReportQuotaRow
          promotedLegacyRef: boolean
        }>
        historyRows: UsageReportQuotaHistoryRow[]
      }
      const groups = new Map<string, AccountGroup>()
      const combinedRows = [
        ...matchingRows.map((row) => ({ kind: 'current' as const, row })),
        ...matchingHistory.map((row) => ({ kind: 'history' as const, row })),
      ]
      const identities =
        laneProvider === 'kimi_code' && providerWideKimiIdentityByRow !== null
          ? combinedRows.map(
              ({ row }) => providerWideKimiIdentityByRow.get(row)!
            )
          : resolveQuotaAccountIdentities(
              combinedRows.map(({ row }) => row.account_ref)
            )

      combinedRows.forEach((entry, index) => {
        const identity = identities[index]
        const baseGroupKey = `account:${identity.publicKey}`

        if (entry.kind === 'current') {
          let groupKey = baseGroupKey
          let group = groups.get(groupKey)
          if (
            group !== undefined &&
            group.currentRows.length > 0 &&
            identity.accountRef !== null
          ) {
            const hasExactCurrentRef = group.currentRows.some(({ row }) => {
              const normalized = normalizeQuotaAccountRef(row.account_ref)
              return normalized?.length === 12
            })
            const hasPromotedLegacyRef = group.currentRows.some(
              (current) => current.promotedLegacyRef
            )
            const isLegacyAliasPair =
              (identity.promotedLegacyRef && hasExactCurrentRef) ||
              (identity.normalizedInput?.length === 12 &&
                hasPromotedLegacyRef &&
                !hasExactCurrentRef)
            if (!isLegacyAliasPair) {
              groupKey = `${baseGroupKey}:row:${(index + 1).toString()}`
              group = undefined
            }
          }

          group ??= {
            publicKey:
              groupKey === baseGroupKey
                ? identity.publicKey
                : `${identity.publicKey}-row-${(index + 1).toString()}`,
            accountRef: identity.accountRef,
            currentRows: [],
            historyRows: [],
          }
          group.currentRows.push({
            row: entry.row,
            promotedLegacyRef: identity.promotedLegacyRef,
          })
          groups.set(groupKey, group)
          return
        }

        const group = groups.get(baseGroupKey) ?? {
          publicKey: identity.publicKey,
          accountRef: identity.accountRef,
          currentRows: [],
          historyRows: [],
        }
        group.historyRows.push({
          ...entry.row,
          account_ref: identity.accountRef,
        })
        groups.set(baseGroupKey, group)
      })

      const showAccountIdentity = groups.size > 1
      for (const group of groups.values()) {
        const accountSuffix = formatQuotaAccountSuffix(group.accountRef)
        const identityLabel =
          accountSuffix ??
          (group.publicKey.startsWith('unidentified-')
            ? group.publicKey.replace('-', ' ')
            : 'unidentified')
        const laneLabel = showAccountIdentity
          ? `${def.laneLabel} · ${identityLabel}`
          : def.laneLabel
        const preferredCurrentRow =
          group.currentRows.find(({ row }) => {
            const normalized = normalizeQuotaAccountRef(row.account_ref)
            return normalized?.length === 12 && normalized === group.accountRef
          })?.row ?? group.currentRows[0]?.row
        const currentBar =
          preferredCurrentRow === undefined
            ? null
            : makeQuotaBarGroup(laneLabel, preferredCurrentRow, interval)

        result.push({
          laneKey: showAccountIdentity
            ? `${def.laneKey}/${group.publicKey}`
            : def.laneKey,
          laneLabel,
          currentBar,
          priorBars: buildPriorBarsForLane(
            group.historyRows,
            currentBar,
            laneProvider
          ),
        })
      }
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
