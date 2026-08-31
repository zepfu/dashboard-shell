import type {
  UsageReportQuotaBillingDetail,
  UsageReportQuotaRow,
} from '@/features/dashboard/api/usage-report'
import { isAnthropicProviderStatusVisible } from '@/features/dashboard/lib/provider-status-visibility'
import {
  formatQuotaAccountSuffix,
  matchesKimiCodeQuotaContract,
  resolveQuotaAccountIdentities,
} from '@/features/dashboard/lib/quota-bars/fields'
import {
  ALIBABA_TOKEN_PLAN_5H_CREDITS_KEY,
  ALIBABA_TOKEN_PLAN_7D_CREDITS_KEY,
  KIMI_CODE_5H_QUOTA_UNITS_KEY,
  KIMI_CODE_7D_QUOTA_UNITS_KEY,
} from '@/features/dashboard/lib/quota-bars/lane-defs'
import {
  googleQuotaClass,
  googleQuotaClasses,
  type GoogleQuotaClass,
  providerColorFor,
} from '@/features/dashboard/lib/usage-report-display'

export type SidebarQuotaItem = {
  key: string
  label: string
  percent: number | null
  color: string
}

type QuotaOnlySidebarConfig = {
  provider: string
  keyPrefix: string
  keyUnit: string
  labelPrefix: string
  labelUnit: string
  shortQuotaKey: string
  weeklyQuotaKey: string
}

function quotaOnlySidebarDetailMatches(
  config: QuotaOnlySidebarConfig,
  detail: UsageReportQuotaBillingDetail | undefined,
  quotaKey: string,
  quotaPeriod: '5h' | '7d'
): boolean {
  if (config.provider === 'kimi_code') {
    return matchesKimiCodeQuotaContract(detail, quotaKey, quotaPeriod)
  }
  return (
    detail?.quota_key === quotaKey &&
    (detail.quota_period == null || detail.quota_period === quotaPeriod)
  )
}

function appendQuotaOnlySidebarItems(
  items: SidebarQuotaItem[],
  rows: UsageReportQuotaRow[],
  config: QuotaOnlySidebarConfig
): void {
  const providerRows = rows
    .filter((row) => row.provider.toLowerCase() === config.provider)
    .map((row) => ({
      row,
      shortMatches: quotaOnlySidebarDetailMatches(
        config,
        row.billing_details?.short,
        config.shortQuotaKey,
        '5h'
      ),
      weeklyMatches: quotaOnlySidebarDetailMatches(
        config,
        row.billing_details?.weekly,
        config.weeklyQuotaKey,
        '7d'
      ),
    }))
    .filter(({ shortMatches, weeklyMatches }) => shortMatches || weeklyMatches)
  const identities = resolveQuotaAccountIdentities(
    providerRows.map(({ row }) => row.account_ref)
  )
  const showAccountSuffix =
    new Set(identities.map((identity) => identity.publicKey)).size > 1
  const seenItems = new Map<
    string,
    { itemIndex: number; normalizedInput: string | null }
  >()
  const color = providerColorFor(config.provider)

  const appendItem = (
    key: string,
    item: SidebarQuotaItem,
    rowIndex: number
  ): void => {
    const identity = identities[rowIndex]
    const existing = seenItems.get(key)
    if (existing === undefined) {
      seenItems.set(key, {
        itemIndex: items.length,
        normalizedInput: identity.normalizedInput,
      })
      items.push(item)
      return
    }

    const isLegacyAliasPair =
      identity.accountRef !== null &&
      ((existing.normalizedInput?.length === 8 &&
        identity.normalizedInput?.length === 12) ||
        (existing.normalizedInput?.length === 12 &&
          identity.normalizedInput?.length === 8))
    if (isLegacyAliasPair) {
      if (identity.normalizedInput?.length === 12) {
        items[existing.itemIndex] = item
        existing.normalizedInput = identity.normalizedInput
      }
      return
    }

    const distinctKey = `${key}-row-${(rowIndex + 1).toString()}`
    seenItems.set(distinctKey, {
      itemIndex: items.length,
      normalizedInput: identity.normalizedInput,
    })
    items.push({ ...item, key: distinctKey })
  }

  providerRows.forEach(({ row, shortMatches, weeklyMatches }, rowIndex) => {
    const identity = identities[rowIndex]
    const includeAccountKey =
      identity.accountRef !== null ||
      Boolean(row.account_ref?.trim()) ||
      showAccountSuffix
    const accountKeySuffix = includeAccountKey ? `-${identity.publicKey}` : ''
    const accountSuffix = formatQuotaAccountSuffix(identity.accountRef)
    const identityLabel =
      accountSuffix ??
      (identity.publicKey.startsWith('unidentified-')
        ? identity.publicKey.replace('-', ' ')
        : null)
    const labelSuffix =
      showAccountSuffix && identityLabel !== null ? ` · ${identityLabel}` : ''

    if (shortMatches && row.short_remaining_pct != null) {
      const key = `${config.keyPrefix}-5h-${config.keyUnit}${accountKeySuffix}`
      appendItem(
        key,
        {
          key,
          label: `${config.labelPrefix} 5h ${config.labelUnit}${labelSuffix}`,
          percent: row.short_remaining_pct,
          color,
        },
        rowIndex
      )
    }
    if (weeklyMatches && row.weekly_remaining_pct != null) {
      const key = `${config.keyPrefix}-7d-${config.keyUnit}${accountKeySuffix}`
      appendItem(
        key,
        {
          key,
          label: `${config.labelPrefix} 7d ${config.labelUnit}${labelSuffix}`,
          percent: row.weekly_remaining_pct,
          color,
        },
        rowIndex
      )
    }
  })
}

export function buildSidebarQuotaItems(
  rows: UsageReportQuotaRow[] | null | undefined
): SidebarQuotaItem[] {
  const safeRows = rows ?? []
  const items: SidebarQuotaItem[] = []
  const openaiWeekly = providerRowForWeekly(safeRows, 'openai')
  const openaiSpecial = providerRowForSpecial(safeRows, 'openai')
  const anthropicWeekly = providerRowForWeekly(safeRows, 'anthropic')
  const anthropicSpecial = providerRowForSpecial(safeRows, 'anthropic')
  const showAnthropicProviderStatus = isAnthropicProviderStatusVisible()
  const openaiColor = providerColorFor('openai')
  const anthropicColor = providerColorFor('anthropic')
  const googleColor = providerColorFor('google')

  if (openaiWeekly?.weekly_remaining_pct != null) {
    items.push({
      key: 'openai-weekly',
      label: 'OpenAI Weekly',
      percent: openaiWeekly.weekly_remaining_pct,
      color: openaiColor,
    })
  }
  if (openaiSpecial?.special_remaining_pct != null) {
    items.push({
      key: 'openai-spark',
      label: 'OpenAI Spark',
      percent: openaiSpecial.special_remaining_pct,
      color: openaiColor,
    })
  }
  if (
    showAnthropicProviderStatus &&
    anthropicWeekly?.weekly_remaining_pct != null
  ) {
    items.push({
      key: 'anthropic-weekly',
      label: 'Anthropic Weekly',
      percent: anthropicWeekly.weekly_remaining_pct,
      color: anthropicColor,
    })
  }
  if (
    showAnthropicProviderStatus &&
    anthropicWeekly?.weekly_overage_included_remaining_pct != null
  ) {
    items.push({
      key: 'anthropic-fable-overage',
      label: 'Anthropic Fable 7d OI',
      percent: anthropicWeekly.weekly_overage_included_remaining_pct,
      color: anthropicColor,
    })
  }
  if (
    showAnthropicProviderStatus &&
    anthropicSpecial?.special_remaining_pct != null
  ) {
    items.push({
      key: 'anthropic-sonnet-retired',
      label: 'Anthropic Retired Sonnet',
      percent: anthropicSpecial.special_remaining_pct,
      color: anthropicColor,
    })
  }

  const googleRows = googleQuotaRows(safeRows)
  for (const quotaClass of googleQuotaClasses) {
    const row = googleRows.get(quotaClass.key)
    if (!row || row.short_remaining_pct == null) continue
    items.push({
      key: `google-${quotaClass.key}`,
      label: quotaClass.sidebarLabel,
      percent: row.short_remaining_pct,
      color: googleColor,
    })
  }

  appendQuotaOnlySidebarItems(items, safeRows, {
    provider: 'alibaba_token_plan',
    keyPrefix: 'alibaba',
    keyUnit: 'credits',
    labelPrefix: 'Alibaba',
    labelUnit: 'Credits',
    shortQuotaKey: ALIBABA_TOKEN_PLAN_5H_CREDITS_KEY,
    weeklyQuotaKey: ALIBABA_TOKEN_PLAN_7D_CREDITS_KEY,
  })
  appendQuotaOnlySidebarItems(items, safeRows, {
    provider: 'kimi_code',
    keyPrefix: 'kimi',
    keyUnit: 'quota-units',
    labelPrefix: 'Kimi Code',
    labelUnit: 'Quota Units',
    shortQuotaKey: KIMI_CODE_5H_QUOTA_UNITS_KEY,
    weeklyQuotaKey: KIMI_CODE_7D_QUOTA_UNITS_KEY,
  })

  return items
}

function providerRowForWeekly(rows: UsageReportQuotaRow[], provider: string) {
  const matches = rows.filter(
    (row) => row.provider.toLowerCase() === provider.toLowerCase()
  )
  if (matches.length === 0) return undefined

  return matches.reduce((best, row) => {
    if (!best) return row
    return compareWeeklyQuotaRows(row, best) < 0 ? row : best
  })
}

function providerRowForSpecial(rows: UsageReportQuotaRow[], provider: string) {
  const matches = rows.filter(
    (row) => row.provider.toLowerCase() === provider.toLowerCase()
  )
  if (matches.length === 0) return undefined

  return matches.reduce((best, row) => {
    if (!best) return row
    return compareSpecialQuotaRows(row, best) < 0 ? row : best
  })
}

function compareWeeklyQuotaRows(
  left: UsageReportQuotaRow,
  right: UsageReportQuotaRow
) {
  if (left.weekly_active !== right.weekly_active) {
    return left.weekly_active ? -1 : 1
  }
  return (
    quotaSortValue(left.weekly_remaining_pct) -
    quotaSortValue(right.weekly_remaining_pct)
  )
}

function compareSpecialQuotaRows(
  left: UsageReportQuotaRow,
  right: UsageReportQuotaRow
) {
  if (left.special_active !== right.special_active) {
    return left.special_active ? -1 : 1
  }
  return (
    quotaSortValue(left.special_remaining_pct) -
    quotaSortValue(right.special_remaining_pct)
  )
}

function googleQuotaRows(rows: UsageReportQuotaRow[]) {
  const classRows = new Map<GoogleQuotaClass, UsageReportQuotaRow>()
  for (const row of rows) {
    if (!isGoogleQuotaRow(row)) continue
    const quotaClass = googleQuotaClass(row.model)
    if (!quotaClass) continue
    const current = classRows.get(quotaClass)
    if (!current || compareQuotaClassRows(row, current) < 0) {
      classRows.set(quotaClass, row)
    }
  }
  return classRows
}

function isGoogleQuotaRow(row: UsageReportQuotaRow) {
  const provider = row.provider.toLowerCase()
  return provider === 'google' || provider === 'gemini'
}

function compareQuotaClassRows(
  left: UsageReportQuotaRow,
  right: UsageReportQuotaRow
) {
  if (left.short_active !== right.short_active) {
    return left.short_active ? -1 : 1
  }
  return (
    quotaSortValue(left.short_remaining_pct) -
    quotaSortValue(right.short_remaining_pct)
  )
}

function quotaSortValue(value: number | null) {
  return value ?? Number.POSITIVE_INFINITY
}
