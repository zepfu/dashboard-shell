import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  SidebarGroup,
  SidebarGroupContent,
  useSidebar,
} from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  type UsageReportQuotaRow,
  fetchUsageReportQuotas,
} from '@/features/dashboard/api/usage-report'
import {
  colorWithAlpha,
  formatPercent,
  googleQuotaClass,
  googleQuotaClasses,
  type GoogleQuotaClass,
  providerColorFor,
} from '@/features/dashboard/lib/usage-report-display'

type SidebarQuotaItem = {
  key: string
  label: string
  percent: number | null
  color: string
}

export function SidebarQuotaRemaining() {
  const { state } = useSidebar()
  const collapsed = state === 'collapsed'
  const quotaQuery = useQuery({
    queryKey: ['shell-sidebar-quota-remaining'],
    queryFn: fetchUsageReportQuotas,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
  const items = useMemo(
    () => buildSidebarQuotaItems(quotaQuery.data?.quotas ?? []),
    [quotaQuery.data?.quotas]
  )

  if (quotaQuery.isPending) {
    return (
      <SidebarGroup className='py-1 group-data-[collapsible=icon]:px-2'>
        <SidebarGroupContent>
          {collapsed ? (
            <Skeleton className='mx-auto h-8 w-8 rounded-md' />
          ) : (
            <div className='space-y-2 rounded-md border border-sidebar-border p-2'>
              <Skeleton className='h-3 w-20' />
              <Skeleton className='h-2 w-full' />
              <Skeleton className='h-2 w-full' />
              <Skeleton className='h-2 w-full' />
            </div>
          )}
        </SidebarGroupContent>
      </SidebarGroup>
    )
  }

  if (!items.length) return null

  if (collapsed) {
    return (
      <SidebarGroup className='px-2 py-1'>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type='button'
              className='mx-auto flex w-8 flex-col gap-1 rounded-md border border-sidebar-border bg-sidebar-accent/40 p-1.5 ring-sidebar-ring outline-none focus-visible:ring-2'
              aria-label='Provider quota remaining'
            >
              {items.map((item) => (
                <div
                  key={item.key}
                  className='h-1.5 rounded-full bg-sidebar-border'
                  role='progressbar'
                  aria-label={`${item.label} quota remaining`}
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={quotaAriaValue(item.percent)}
                  aria-valuetext={formatPercent(item.percent)}
                >
                  <div
                    className='h-full rounded-full'
                    style={{
                      width: `${quotaWidth(item.percent)}%`,
                      backgroundColor: item.color,
                    }}
                  />
                </div>
              ))}
            </button>
          </TooltipTrigger>
          <TooltipContent
            side='right'
            align='center'
            sideOffset={8}
            className='w-64 border bg-popover text-popover-foreground shadow-md'
          >
            <SidebarQuotaTooltip items={items} />
          </TooltipContent>
        </Tooltip>
      </SidebarGroup>
    )
  }

  return (
    <SidebarGroup className='py-1'>
      <SidebarGroupContent>
        <div className='space-y-2 rounded-md border border-sidebar-border bg-sidebar-accent/30 p-2'>
          <div className='flex items-center justify-between text-xs'>
            <span className='font-medium'>Quota</span>
            <span className='text-muted-foreground'>remaining</span>
          </div>
          <div className='space-y-1.5'>
            {items.map((item) => (
              <SidebarQuotaRow key={item.key} item={item} />
            ))}
          </div>
        </div>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function SidebarQuotaTooltip({ items }: { items: SidebarQuotaItem[] }) {
  return (
    <div className='space-y-2'>
      <div className='border-b pb-2 text-xs font-medium'>Quota remaining</div>
      <div className='space-y-1.5'>
        {items.map((item) => (
          <SidebarQuotaRow key={item.key} item={item} />
        ))}
      </div>
    </div>
  )
}

function SidebarQuotaRow({ item }: { item: SidebarQuotaItem }) {
  return (
    <div className='space-y-1'>
      <div className='flex items-center justify-between gap-2 text-[11px]'>
        <span className='truncate'>{item.label}</span>
        <span className='shrink-0 text-muted-foreground tabular-nums'>
          {formatPercent(item.percent)}
        </span>
      </div>
      <div
        className='h-1.5 overflow-hidden rounded-full'
        style={{ backgroundColor: colorWithAlpha(item.color, 0.16) }}
        role='progressbar'
        aria-label={`${item.label} quota remaining`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={quotaAriaValue(item.percent)}
        aria-valuetext={formatPercent(item.percent)}
      >
        <div
          className='h-full rounded-full'
          style={{
            width: `${quotaWidth(item.percent)}%`,
            backgroundColor: item.color,
          }}
        />
      </div>
    </div>
  )
}

function buildSidebarQuotaItems(rows: UsageReportQuotaRow[]) {
  const items: SidebarQuotaItem[] = []
  const openai = providerRow(rows, 'openai')
  const anthropic = providerRow(rows, 'anthropic')
  const openaiColor = providerColorFor('openai')
  const anthropicColor = providerColorFor('anthropic')
  const googleColor = providerColorFor('google')

  if (openai?.weekly_remaining_pct != null) {
    items.push({
      key: 'openai-weekly',
      label: 'OpenAI Weekly',
      percent: openai?.weekly_remaining_pct ?? null,
      color: openaiColor,
    })
  }
  if (openai?.special_remaining_pct != null) {
    items.push({
      key: 'openai-spark',
      label: 'OpenAI Spark',
      percent: openai?.special_remaining_pct ?? null,
      color: openaiColor,
    })
  }
  if (anthropic?.weekly_remaining_pct != null) {
    items.push({
      key: 'anthropic-weekly',
      label: 'Anthropic Weekly',
      percent: anthropic?.weekly_remaining_pct ?? null,
      color: anthropicColor,
    })
  }
  if (anthropic?.special_remaining_pct != null) {
    items.push({
      key: 'anthropic-sonnet',
      label: 'Anthropic Sonnet',
      percent: anthropic?.special_remaining_pct ?? null,
      color: anthropicColor,
    })
  }

  const googleRows = googleQuotaRows(rows)
  for (const quotaClass of googleQuotaClasses) {
    const row = googleRows.get(quotaClass.key)
    if (!row) continue
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
  return rows.find((row) => row.provider.toLowerCase() === provider)
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

function quotaWidth(value: number | null) {
  if (value === null) return 0
  return Math.max(0, Math.min(value, 100))
}

function quotaAriaValue(value: number | null) {
  return value === null ? undefined : quotaWidth(value)
}
