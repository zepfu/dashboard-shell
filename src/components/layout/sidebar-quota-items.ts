import type { UsageReportQuotaRow } from '@/features/dashboard/api/usage-report'
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
  const openai = providerRow(safeRows, 'openai')
  const anthropic = providerRow(safeRows, 'anthropic')
  const openaiColor = providerColorFor('openai')
  const anthropicColor = providerColorFor('anthropic')
  const googleColor = providerColorFor('google')

  if (openai?.weekly_remaining_pct != null) {
    items.push({
      key: 'openai-weekly',
      label: 'OpenAI Weekly',
      percent: openai.weekly_remaining_pct,
      color: openaiColor,
    })
  }
  if (openai?.special_remaining_pct != null) {
    items.push({
      key: 'openai-spark',
      label: 'OpenAI Spark',
      percent: openai.special_remaining_pct,
      color: openaiColor,
    })
  }
  if (anthropic?.weekly_remaining_pct != null) {
    items.push({
      key: 'anthropic-weekly',
      label: 'Anthropic Weekly',
      percent: anthropic.weekly_remaining_pct,
      color: anthropicColor,
    })
  }
  if (anthropic?.weekly_overage_included_remaining_pct != null) {
    items.push({
      key: 'anthropic-fable-overage',
      label: 'Anthropic Fable 7d OI',
      percent: anthropic.weekly_overage_included_remaining_pct,
      color: anthropicColor,
    })
  }
  if (anthropic?.special_remaining_pct != null) {
    items.push({
      key: 'anthropic-sonnet-retired',
      label: 'Anthropic Retired Sonnet',
      percent: anthropic.special_remaining_pct,
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

  return items
}

function providerRow(rows: UsageReportQuotaRow[], provider: string) {
  const matches = rows.filter(
    (row) => row.provider.toLowerCase() === provider.toLowerCase()
  )
  if (matches.length === 0) return undefined

  return matches.reduce((best, row) => {
    if (!best) return row
    return compareProviderQuotaRows(row, best, 'weekly') < 0 ? row : best
  })
}

function compareProviderQuotaRows(
  left: UsageReportQuotaRow,
  right: UsageReportQuotaRow,
  kind: 'weekly' | 'special'
) {
  const leftActive =
    kind === 'weekly' ? left.weekly_active : left.special_active
  const rightActive =
    kind === 'weekly' ? right.weekly_active : right.special_active
  if (leftActive !== rightActive) {
    return leftActive ? -1 : 1
  }
  const leftPct =
    kind === 'weekly' ? left.weekly_remaining_pct : left.special_remaining_pct
  const rightPct =
    kind === 'weekly' ? right.weekly_remaining_pct : right.special_remaining_pct
  return quotaSortValue(leftPct) - quotaSortValue(rightPct)
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
