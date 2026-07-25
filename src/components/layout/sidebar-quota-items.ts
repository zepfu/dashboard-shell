import type { UsageReportQuotaRow } from '@/features/dashboard/api/usage-report'
import { formatQuotaAccountSuffix } from '@/features/dashboard/lib/quota-bars/fields'
import {
  ALIBABA_TOKEN_PLAN_5H_CREDITS_KEY,
  ALIBABA_TOKEN_PLAN_7D_CREDITS_KEY,
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

export function buildSidebarQuotaItems(
  rows: UsageReportQuotaRow[] | null | undefined
): SidebarQuotaItem[] {
  const safeRows = rows ?? []
  const items: SidebarQuotaItem[] = []
  const openaiWeekly = providerRowForWeekly(safeRows, 'openai')
  const openaiSpecial = providerRowForSpecial(safeRows, 'openai')
  const anthropicWeekly = providerRowForWeekly(safeRows, 'anthropic')
  const anthropicSpecial = providerRowForSpecial(safeRows, 'anthropic')
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
  if (anthropicWeekly?.weekly_remaining_pct != null) {
    items.push({
      key: 'anthropic-weekly',
      label: 'Anthropic Weekly',
      percent: anthropicWeekly.weekly_remaining_pct,
      color: anthropicColor,
    })
  }
  if (anthropicWeekly?.weekly_overage_included_remaining_pct != null) {
    items.push({
      key: 'anthropic-fable-overage',
      label: 'Anthropic Fable 7d OI',
      percent: anthropicWeekly.weekly_overage_included_remaining_pct,
      color: anthropicColor,
    })
  }
  if (anthropicSpecial?.special_remaining_pct != null) {
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

  const alibabaColor = providerColorFor('alibaba_token_plan')
  const alibabaRows = safeRows.filter(
    (row) => row.provider.toLowerCase() === 'alibaba_token_plan'
  )
  const alibabaAccountRefs = new Set(
    alibabaRows
      .map((row) => row.account_ref?.trim())
      .filter((ref): ref is string => Boolean(ref))
  )
  const showAlibabaAccountSuffix = alibabaAccountRefs.size > 1
  const seenAlibabaItems = new Set<string>()

  alibabaRows.forEach((row, rowIndex) => {
    const shortKey = row.billing_details?.short?.quota_key
    const weeklyKey = row.billing_details?.weekly?.quota_key
    const accountRef = row.account_ref?.trim()
    const accountKeySuffix =
      accountRef !== undefined && accountRef !== ''
        ? `-${accountRef}`
        : alibabaRows.length > 1
          ? `-unidentified-${rowIndex}`
          : ''
    const accountSuffix = formatQuotaAccountSuffix(row.account_ref)
    const labelSuffix =
      showAlibabaAccountSuffix && accountSuffix !== null
        ? ` · ${accountSuffix}`
        : ''
    if (
      shortKey === ALIBABA_TOKEN_PLAN_5H_CREDITS_KEY &&
      row.short_remaining_pct != null
    ) {
      const key = `alibaba-5h-credits${accountKeySuffix}`
      if (!seenAlibabaItems.has(key)) {
        seenAlibabaItems.add(key)
        items.push({
          key,
          label: `Alibaba 5h Credits${labelSuffix}`,
          percent: row.short_remaining_pct,
          color: alibabaColor,
        })
      }
    }
    if (
      weeklyKey === ALIBABA_TOKEN_PLAN_7D_CREDITS_KEY &&
      row.weekly_remaining_pct != null
    ) {
      const key = `alibaba-7d-credits${accountKeySuffix}`
      if (!seenAlibabaItems.has(key)) {
        seenAlibabaItems.add(key)
        items.push({
          key,
          label: `Alibaba 7d Credits${labelSuffix}`,
          percent: row.weekly_remaining_pct,
          color: alibabaColor,
        })
      }
    }
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
