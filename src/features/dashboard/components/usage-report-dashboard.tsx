import { useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  Clock3,
  Coins,
  Cpu,
  GitCommitHorizontal,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip as UiTooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  type UsageReportGrain,
  type UsageReportClientRow,
  type UsageReportProviderErrorObservationRow,
  type UsageReportProviderLatencyHealthRow,
  type UsageReportProviderStatusUsageRow,
  type UsageReportQuotaRow,
  type UsageReportQuotaUsageBreakdown,
  type UsageReportResponse,
  type UsageReportTrendRow,
  fetchUsageReport,
  usageReportGrains,
} from '../api/usage-report'
import {
  clientColorFor,
  colorWithAlpha,
  formatCompact,
  formatCurrency,
  formatPercent,
  googleQuotaClass,
  googleQuotaClasses,
  type GoogleQuotaClass,
  modelColorFor,
  providerColorKey,
  providerColorFor,
  repositoryColors,
} from '../lib/usage-report-display'

const EMPTY_TREND_ROWS: UsageReportTrendRow[] = []
const EMPTY_CLIENT_ROWS: UsageReportClientRow[] = []
const EMPTY_HEALTH_ROWS: UsageReportProviderLatencyHealthRow[] = []
const EMPTY_PROVIDER_ERROR_ROWS: UsageReportProviderErrorObservationRow[] = []
const MAX_REPOSITORY_SERIES = 8
const MAX_CLIENT_SLICES = 7
const OTHER_REPOSITORY = 'Other'
const OTHER_CLIENTS = 'Other'
const FIVE_MINUTES_MS = 5 * 60 * 1000
const RECENT_HEALTH_ERROR_WINDOW_MS = 24 * 60 * 60 * 1000
const PROVIDER_STATUS_24H_WINDOW_MS = 24 * 60 * 60 * 1000

const unmeteredProviderConfigs = [
  { key: 'xai', label: 'xAI' },
  { key: 'openrouter', label: 'OpenRouter' },
  { key: 'local', label: 'Local' },
] as const

type UnmeteredProviderKey = (typeof unmeteredProviderConfigs)[number]['key']

const grainLabels: Record<UsageReportGrain, string> = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
}

const healthAttributionDisplayOrder: HealthAttributionLayer[] = [
  'control',
  'provider_path',
  'provider_api',
  'workload',
  'normal',
  'unknown',
]

function defaultDateRange(now = new Date()) {
  const from = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)
  )
  const to = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  )

  return {
    from: toDateInputValue(from),
    to: toDateInputValue(to),
  }
}

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10)
}

function isValidDateInput(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

type ModelBreakdown = {
  model: string
  tokens: number
  cost: number
  traces: number
}

type RepositoryBreakdown = {
  repository: string
  tokens: number
  cost: number
  traces: number
  color: string
}

type ProviderSeries = {
  provider: string
  key: string
  color: string
}

type TokenTrendChartRow = {
  bucket: string
  total: number
  costs: Record<string, number>
  breakdowns: Record<string, ModelBreakdown[]>
  repositoryBreakdowns: RepositoryBreakdown[]
} & Record<
  string,
  | number
  | string
  | Record<string, number>
  | Record<string, ModelBreakdown[]>
  | RepositoryBreakdown[]
>

type HealthTrendSeries = {
  provider: string
  key: string
  color: string
}

type HealthTrendChartRow = {
  bucket: string
} & Record<string, number | string | null>

type HealthModelSummary = {
  model: string
  requests: number
  upstreamP95Ms: number | null
  providerErrors: number
}

type ProviderHealthSummary = {
  provider: string
  color: string
  requests: number
  providerErrors: number
  rateLimitEvents: number
  capacityEvents: number
  networkEvents: number
  authFailedEvents: number
  adapterErrorEvents: number
  statusProbeCount: number
  statusProbeSuccessPct: number | null
  upstreamP95Ms: number | null
  totalP95Ms: number | null
  providerPingAvgMs: number | null
  controlPingAvgMs: number | null
  providerPingDeltaMs: number | null
  packetLossPct: number | null
  controlPacketLossPct: number | null
  controlProbeSuccessPct: number | null
  attributionCounts: HealthAttributionCounts
  dominantAttribution: HealthAttributionLayer
  latestBucketStart: string | null
  models: HealthModelSummary[]
}

type ProviderHealthMetrics = {
  latestBucketStart: string | null
  totalRequests: number
  providerErrors: number
  rateLimitEvents: number
  controlPingAvgMs: number | null
  providerPingDeltaMs: number | null
  controlPacketLossPct: number | null
  controlProbeSuccessPct: number | null
  rows: HealthTrendChartRow[]
  series: HealthTrendSeries[]
  summaries: ProviderHealthSummary[]
}

type QuotaHealthSeverity = 'good' | 'warn' | 'bad' | 'unknown'
type HealthAttributionLayer =
  | 'normal'
  | 'control'
  | 'provider_path'
  | 'provider_api'
  | 'workload'
  | 'unknown'

type HealthAttributionCounts = Record<HealthAttributionLayer, number>

type HealthAttribution = {
  layer: HealthAttributionLayer
  severity: QuotaHealthSeverity
  label: string
  detail: string
}

type QuotaHealthSegment = {
  key: string
  topPct: number
  heightPct: number
  severity: QuotaHealthSeverity
  attribution: HealthAttributionLayer
  attributionDetail: string
  latencyMs: number | null
}

type QuotaHealthMarker = {
  key: string
  topPct: number
  count: number
  observedAt: string
  classes: string[]
  models: string[]
}

type QuotaHealthOverlay = {
  label: string
  startAt: string
  endAt: string
  segments: QuotaHealthSegment[]
  markers: QuotaHealthMarker[]
  sampleCount: number
  latestLatencyMs: number | null
  latestControlPingMs: number | null
  latestProviderPingDeltaMs: number | null
  latestAttribution: HealthAttribution | null
  attributionCounts: HealthAttributionCounts
  providerErrorCount: number
  worstSeverity: QuotaHealthSeverity
}

type QuotaHealthInput = {
  healthRows: UsageReportProviderLatencyHealthRow[]
  errorRows: UsageReportProviderErrorObservationRow[]
}

type QuotaUsageSummary = {
  tokens: number
  breakdown: UsageReportQuotaUsageBreakdown[]
}

type UnmeteredProviderStatus = {
  key: UnmeteredProviderKey
  label: string
  color: string
  tokens: number
  cost: number
  traces: number
  breakdown: UsageReportQuotaUsageBreakdown[]
}

type ClientVersionBreakdown = {
  client: string
  version: string
  firstSeenAt: string | null
  tokens: number
  cost: number
  traces: number
  sourceClients: string[]
}

type ClientUsageSlice = {
  key: string
  client: string
  tokens: number
  cost: number
  traces: number
  color: string
  versions: ClientVersionBreakdown[]
}

type ChartHoverState = {
  activeTooltipIndex?: number | string | null
  activeLabel?: string | number
  isTooltipActive?: boolean
}

type TokenTrendHover = {
  index: number
  label: string | number
  row: TokenTrendChartRow
  series: ProviderSeries[]
}

export function UsageReportDashboard() {
  const defaultRange = useMemo(() => defaultDateRange(), [])
  const [fromDate, setFromDate] = useState(defaultRange.from)
  const [toDate, setToDate] = useState(defaultRange.to)
  const [draftFromDate, setDraftFromDate] = useState(defaultRange.from)
  const [draftToDate, setDraftToDate] = useState(defaultRange.to)
  const [grain, setGrain] = useState<UsageReportGrain>('day')
  const dateRangeDirty = draftFromDate !== fromDate || draftToDate !== toDate
  const dateRangeValid =
    isValidDateInput(draftFromDate) && isValidDateInput(draftToDate)
  const commitDateRange = () => {
    if (!dateRangeValid) return false
    setFromDate(draftFromDate)
    setToDate(draftToDate)
    return true
  }

  const usageReport = useQuery({
    queryKey: ['shell-usage-report', fromDate, toDate, grain],
    queryFn: () =>
      fetchUsageReport({
        from: fromDate,
        to: toDate,
        grain,
        groupBy: ['provider', 'model', 'repository'],
      }),
  })

  const summary = usageReport.data?.summary
  const usageTrendRows = usageReport.data?.trend ?? EMPTY_TREND_ROWS
  const trend = useMemo(
    () => buildProviderTrendRows(usageTrendRows),
    [usageTrendRows]
  )
  const quotas = useMemo(
    () => usageReport.data?.quotas ?? [],
    [usageReport.data?.quotas]
  )
  const clientUsage = useMemo(
    () =>
      buildClientUsageSlices(usageReport.data?.clients ?? EMPTY_CLIENT_ROWS),
    [usageReport.data?.clients]
  )
  const healthMetrics = useMemo(
    () =>
      buildProviderHealthMetrics(
        usageReport.data?.providerLatencyHealth ?? EMPTY_HEALTH_ROWS
      ),
    [usageReport.data?.providerLatencyHealth]
  )
  const quotaHealthInput = useMemo(
    () => ({
      healthRows: usageReport.data?.providerLatencyHealth ?? EMPTY_HEALTH_ROWS,
      errorRows:
        usageReport.data?.providerErrorObservations ??
        EMPTY_PROVIDER_ERROR_ROWS,
    }),
    [
      usageReport.data?.providerLatencyHealth,
      usageReport.data?.providerErrorObservations,
    ]
  )
  const unmeteredProviderStatuses = useMemo(
    () =>
      buildUnmeteredProviderStatuses(
        usageReport.data?.providerStatusUsage ?? []
      ),
    [usageReport.data?.providerStatusUsage]
  )
  const recentHealthErrorCount = useMemo(
    () => countRecentHealthErrors(quotaHealthInput),
    [quotaHealthInput]
  )
  const [tokenTrendHover, setTokenTrendHover] =
    useState<TokenTrendHover | null>(null)
  const [clientUsageHover, setClientUsageHover] =
    useState<ClientUsageSlice | null>(null)
  const activeTokenTrend =
    tokenTrendHover && trend.rows.includes(tokenTrendHover.row)
      ? tokenTrendHover
      : latestTokenTrendHover(trend)
  const activeClientUsage =
    clientUsageHover && clientUsage.slices.includes(clientUsageHover)
      ? clientUsageHover
      : (clientUsage.slices[0] ?? null)

  const handleTokenTrendHover = (state: ChartHoverState) => {
    const index = activeChartIndex(state)
    if (index === null) return
    const row = trend.rows[index]
    if (!row) return

    setTokenTrendHover({
      index,
      label: state.activeLabel ?? row.bucket,
      row,
      series: trend.series,
    })
  }

  return (
    <div className='space-y-4'>
      <div className='grid gap-3 md:grid-cols-[repeat(3,minmax(0,1fr))_auto]'>
        <Field label='From'>
          <Input
            type='date'
            value={draftFromDate}
            aria-invalid={!isValidDateInput(draftFromDate)}
            onBlur={commitDateRange}
            onChange={(event) => setDraftFromDate(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitDateRange()
            }}
          />
        </Field>
        <Field label='To'>
          <Input
            type='date'
            value={draftToDate}
            aria-invalid={!isValidDateInput(draftToDate)}
            onBlur={commitDateRange}
            onChange={(event) => setDraftToDate(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitDateRange()
            }}
          />
        </Field>
        <Field label='Grain'>
          <Select
            value={grain}
            onValueChange={(value) => setGrain(value as UsageReportGrain)}
          >
            <SelectTrigger className='w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {usageReportGrains.map((reportGrain) => (
                <SelectItem key={reportGrain} value={reportGrain}>
                  {grainLabels[reportGrain]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className='flex items-end'>
          <Button
            type='button'
            variant='outline'
            className='w-full md:w-auto'
            disabled={usageReport.isFetching || !dateRangeValid}
            onClick={() => {
              if (dateRangeDirty) {
                commitDateRange()
                return
              }
              void usageReport.refetch()
            }}
          >
            <RefreshCw
              className={`size-4 ${
                usageReport.isFetching ? 'animate-spin' : ''
              }`}
            />
            {dateRangeDirty ? 'Apply' : 'Refresh'}
          </Button>
        </div>
      </div>

      <FreshnessIndicator
        loading={usageReport.isPending}
        metadata={usageReport.data?.metadata}
      />

      {usageReport.isError ? (
        <Card className='border-destructive/50'>
          <CardHeader>
            <CardTitle>Usage Report Unavailable</CardTitle>
            <CardDescription>
              {usageReport.error instanceof Error
                ? usageReport.error.message
                : 'Report request failed.'}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
        <MetricCard
          title='Traces'
          value={formatNumber(summary?.traces)}
          detail={formatRecordWindow(summary)}
          icon={Activity}
          loading={usageReport.isPending}
        />
        <MetricCard
          title='Tokens'
          value={formatCompact(summary?.token_total)}
          detail={`${formatCompact(summary?.token_in)} in / ${formatCompact(summary?.token_out)} out`}
          icon={Cpu}
          loading={usageReport.isPending}
        />
        <MetricCard
          title='USD Cost'
          value={formatCurrency(summary?.usd_cost)}
          detail={`${formatCurrency(summary?.cache_miss_usd_cost)} cache miss`}
          icon={Coins}
          loading={usageReport.isPending}
        />
        <MetricCard
          title='Git Activity'
          value={formatNumber(
            (summary?.git_commit ?? 0) + (summary?.git_push ?? 0)
          )}
          detail={`${formatNumber(summary?.git_commit)} commits / ${formatNumber(summary?.git_push)} pushes`}
          icon={GitCommitHorizontal}
          loading={usageReport.isPending}
        />
      </div>

      <Tabs defaultValue='usage' className='space-y-4'>
        <TabsList>
          <TabsTrigger value='usage'>Usage</TabsTrigger>
          <TabsTrigger value='client' data-client-tab=''>
            Client
          </TabsTrigger>
          <TabsTrigger
            value='health'
            aria-label={
              recentHealthErrorCount > 0
                ? `Health, ${formatNumber(recentHealthErrorCount)} recent errors in the last 24 hours`
                : 'Health'
            }
            data-health-tab=''
            data-recent-error-count={recentHealthErrorCount}
          >
            Health
            {recentHealthErrorCount > 0 ? (
              <span
                aria-hidden='true'
                data-health-tab-alert=''
                className='size-2 animate-pulse rounded-full bg-destructive'
              />
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value='usage' className='mt-0'>
          <div className='usage-report-layout grid grid-cols-1 gap-4 xl:items-stretch'>
            <Card className='usage-report-token-card xl:flex xl:flex-col'>
              <CardHeader>
                <CardTitle>Token Trend</CardTitle>
                <CardDescription>
                  Provider-colored tokens for{' '}
                  {formatDateRange(fromDate, toDate)}
                </CardDescription>
              </CardHeader>
              <CardContent className='flex flex-1 flex-col gap-3 ps-2'>
                {usageReport.isPending ? (
                  <Skeleton className='h-[320px] w-full' />
                ) : trend.rows.length ? (
                  <>
                    <div className='relative h-[260px] shrink-0'>
                      <ResponsiveContainer width='100%' height='100%'>
                        <BarChart
                          accessibilityLayer
                          role='img'
                          title='Token trend chart'
                          desc='Stacked bar chart showing token usage by provider for each time bucket in the selected report range.'
                          aria-label={`Token trend by provider for ${formatDateRange(fromDate, toDate)}`}
                          data={trend.rows}
                          onMouseMove={handleTokenTrendHover}
                        >
                          <CartesianGrid
                            strokeDasharray='3 3'
                            vertical={false}
                          />
                          <XAxis
                            dataKey='bucket'
                            stroke='#888888'
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            minTickGap={18}
                          />
                          <YAxis
                            stroke='#888888'
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(value) =>
                              formatCompact(Number(value))
                            }
                          />
                          {trend.series.map((series) => (
                            <Bar
                              key={series.key}
                              dataKey={series.key}
                              name={series.provider}
                              stackId='tokens'
                              fill={series.color}
                              radius={[3, 3, 0, 0]}
                            />
                          ))}
                        </BarChart>
                      </ResponsiveContainer>
                      <ActiveChartTotalOverlay
                        active={activeTokenTrend}
                        rows={trend.rows}
                      />
                    </div>
                    {activeTokenTrend ? (
                      <TokenTrendDetail
                        label={activeTokenTrend.label}
                        row={activeTokenTrend.row}
                        series={activeTokenTrend.series}
                      />
                    ) : null}
                  </>
                ) : (
                  <div className='flex h-[320px] items-center justify-center text-sm text-muted-foreground'>
                    No token trend data returned for this range.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className='usage-report-provider-card'>
              <CardHeader>
                <CardTitle>Provider Status</CardTitle>
                <CardDescription>
                  Quota windows, 24-hour usage, and provider health
                </CardDescription>
              </CardHeader>
              <CardContent className='space-y-4'>
                {usageReport.isPending ? (
                  <div className='space-y-3'>
                    <Skeleton className='h-16 w-full' />
                    <Skeleton className='h-16 w-full' />
                    <Skeleton className='h-16 w-full' />
                    <Skeleton className='h-72 w-full' />
                  </div>
                ) : (
                  <ProviderStatusList
                    rows={quotas}
                    health={quotaHealthInput}
                    unmeteredStatuses={unmeteredProviderStatuses}
                  />
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value='client' className='mt-0'>
          <Card className='flex flex-col'>
            <CardHeader>
              <CardTitle>Client Usage</CardTitle>
              <CardDescription>
                Token share and version detail by client for the selected range
              </CardDescription>
            </CardHeader>
            <CardContent className='flex flex-1 flex-col'>
              {usageReport.isPending ? (
                <Skeleton className='h-[520px] w-full' />
              ) : (
                <ClientUsagePie
                  clientUsage={clientUsage}
                  activeSlice={activeClientUsage}
                  onSliceHover={setClientUsageHover}
                  variant='standalone'
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value='health' className='mt-0'>
          <Card className='flex flex-col'>
            <CardHeader>
              <CardTitle>Health Metrics</CardTitle>
              <CardDescription>
                Provider latency, errors, and probes over the last 14 days
              </CardDescription>
            </CardHeader>
            <CardContent className='flex flex-1 flex-col gap-3'>
              {usageReport.isPending ? (
                <Skeleton className='h-[520px] w-full' />
              ) : (
                <HealthMetricsPanel health={healthMetrics} />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function activeChartIndex(state: ChartHoverState) {
  if (!state.isTooltipActive) return null
  const index = Number(state.activeTooltipIndex)
  return Number.isInteger(index) && index >= 0 ? index : null
}

function latestTokenTrendHover({
  rows,
  series,
}: {
  rows: TokenTrendChartRow[]
  series: ProviderSeries[]
}): TokenTrendHover | null {
  const index = rows.length - 1
  const row = rows[index]
  return row ? { index, label: row.bucket, row, series } : null
}

function countRecentHealthErrors(
  health: QuotaHealthInput,
  nowMs = new Date().getTime()
) {
  const cutoffMs = nowMs - RECENT_HEALTH_ERROR_WINDOW_MS
  const recentErrorRows = health.errorRows.filter((row) => {
    const observedMs = parseDateMs(row.observed_at)
    return observedMs !== null && observedMs >= cutoffMs && observedMs <= nowMs
  })
  if (recentErrorRows.length) return recentErrorRows.length

  return health.healthRows.reduce((total, row) => {
    const bucketMs = parseDateMs(row.bucket_start)
    if (bucketMs === null || bucketMs < cutoffMs || bucketMs > nowMs) {
      return total
    }
    return (
      total +
      row.provider_error_events +
      row.provider_5xx_events +
      row.provider_timeout_events +
      row.network_error_events +
      row.auth_failed_events +
      row.adapter_error_events +
      row.capacity_events
    )
  }, 0)
}

function ActiveChartTotalOverlay({
  active,
  rows,
}: {
  active: { index: number; row: { total: number } } | null
  rows: { total: number }[]
}) {
  if (!active || !rows.length || !active.row.total) return null

  const maxTotal = Math.max(...rows.map((row) => Number(row.total) || 0))
  if (!maxTotal) return null

  const xRatio = (active.index + 0.5) / rows.length
  const yRatio = clamp(0.08, 0.84 - (active.row.total / maxTotal) * 0.76, 0.84)

  return (
    <div
      aria-hidden='true'
      data-active-bar-total-label=''
      className='pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded border bg-background/95 px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap tabular-nums shadow-sm'
      style={{
        left: `calc(48px + (100% - 66px) * ${xRatio})`,
        top: `calc(12px + (100% - 58px) * ${yRatio})`,
      }}
    >
      {formatCompact(active.row.total)}
    </div>
  )
}

function clamp(min: number, value: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className='space-y-2'>
      <Label className='text-xs font-medium text-muted-foreground'>
        {label}
      </Label>
      {children}
    </div>
  )
}

function FreshnessIndicator({
  loading,
  metadata,
}: {
  loading: boolean
  metadata: UsageReportResponse['metadata'] | undefined
}) {
  if (loading) {
    return <Skeleton className='h-16 w-full' />
  }
  if (!metadata) return null

  const Icon = metadata.latestRecordStale ? AlertTriangle : ShieldCheck

  return (
    <Alert variant={metadata.latestRecordStale ? 'destructive' : 'default'}>
      <Icon />
      <AlertTitle>
        Latest record: {formatDateTime(metadata.latestRecordAt)}
      </AlertTitle>
      <AlertDescription>
        {metadata.latestRecordAgeMinutes === null
          ? 'No session records were found.'
          : `${formatAge(metadata.latestRecordAgeMinutes)} old; warning threshold is ${formatAge(metadata.staleRecordThresholdMinutes)}.`}
      </AlertDescription>
    </Alert>
  )
}

function MetricCard({
  title,
  value,
  detail,
  icon: Icon,
  loading,
}: {
  title: string
  value: string
  detail: string
  icon: ComponentType<{ className?: string }>
  loading: boolean
}) {
  return (
    <Card>
      <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
        <CardTitle className='text-sm font-medium'>{title}</CardTitle>
        <Icon className='size-4 text-muted-foreground' />
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className='space-y-2'>
            <Skeleton className='h-8 w-24' />
            <Skeleton className='h-4 w-32' />
          </div>
        ) : (
          <>
            <div className='text-2xl font-bold tabular-nums'>{value}</div>
            <p className='text-xs text-muted-foreground'>{detail}</p>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function ProviderStatusList({
  rows,
  health,
  unmeteredStatuses,
}: {
  rows: UsageReportQuotaRow[]
  health: QuotaHealthInput
  unmeteredStatuses: UnmeteredProviderStatus[]
}) {
  const quotaRows = rows.filter((row) =>
    [
      row.weekly_remaining_pct,
      row.short_remaining_pct,
      row.special_remaining_pct,
      row.short_special_remaining_pct,
    ].some((value) => value !== null)
  )
  const googleRows = quotaRows.filter(
    (row) =>
      isGoogleQuotaRow(row) &&
      (row.short_remaining_pct !== null || row.short_reset_at !== null)
  )
  const providerRows = quotaRows.filter((row) => !isGoogleQuotaRow(row))
  const sortedProviderRows = [...providerRows].sort(compareProviderQuotaRows)
  const openAiRow = sortedProviderRows.find(isOpenAiQuotaRow)
  const anthropicRow = sortedProviderRows.find(isAnthropicQuotaRow)
  const fallbackRows = sortedProviderRows.filter(
    (row) => !isOpenAiQuotaRow(row) && !isAnthropicQuotaRow(row)
  )

  return (
    <div className='provider-status-grid'>
      {openAiRow ? <OpenAiStatusCard row={openAiRow} health={health} /> : null}
      {anthropicRow ? (
        <AnthropicStatusCard row={anthropicRow} health={health} />
      ) : null}
      {googleRows.length ? (
        <GoogleQuotaCard
          rows={googleRows}
          color={providerColorFor('google')}
          health={health}
        />
      ) : null}
      {fallbackRows.map((row) => (
        <GenericProviderStatusCard
          key={`${row.provider}:${row.model ?? ''}`}
          row={row}
          health={health}
        />
      ))}
      {unmeteredStatuses.map((status) => (
        <UnmeteredProviderStatusCard
          key={status.key}
          status={status}
          health={health}
        />
      ))}
    </div>
  )
}

function ProviderStatusFrame({
  providerKey,
  title,
  description,
  badge,
  color,
  className,
  children,
}: {
  providerKey: string
  title: string
  description?: string
  badge: string
  color: string
  className?: string
  children: ReactNode
}) {
  return (
    <div
      data-provider-quota={providerKey}
      data-provider-status={providerKey}
      className={`space-y-3 rounded-md border border-l-4 p-3 ${className ?? ''}`}
      style={{
        borderLeftColor: color,
        backgroundColor: colorWithAlpha(color, 0.07),
      }}
    >
      <div className='flex items-center justify-between gap-3'>
        <div className='min-w-0'>
          <div className='truncate text-sm font-medium'>{title}</div>
          {description ? (
            <div className='text-xs text-muted-foreground'>{description}</div>
          ) : null}
        </div>
        <Badge variant='outline'>{badge}</Badge>
      </div>
      {children}
    </div>
  )
}

function OpenAiStatusCard({
  row,
  health,
}: {
  row: UsageReportQuotaRow
  health: QuotaHealthInput
}) {
  return (
    <ProviderStatusFrame
      providerKey='openai'
      title='OpenAI'
      description='Normal and Spark quota windows'
      badge={quotaFreshnessLabel(row)}
      color={providerColorFor(row.provider)}
      className='provider-status-span'
    >
      <div className='grid gap-3 text-xs sm:grid-cols-2'>
        <div className='grid gap-3'>
          <QuotaValue
            label='5-Hour'
            percent={row.short_remaining_pct}
            resetAt={row.short_reset_at}
            active={row.short_active}
            usageTokens={row.short_usage_tokens}
            usageBreakdown={row.short_usage_breakdown}
            healthOverlay={buildQuotaHealthOverlay({
              label: 'OpenAI 5-Hour',
              provider: row.provider,
              windowMs: 5 * 60 * 60 * 1000,
              health,
              modelMatches: (model) => !isSparkModel(model),
            })}
          />
          <QuotaValue
            label='Spark 5-Hour'
            percent={openAiSparkShortSpecialPercent(row)}
            resetAt={shortSpecialResetAt(row)}
            active={row.short_special_active}
            usageTokens={row.short_special_usage_tokens}
            usageBreakdown={row.short_special_usage_breakdown}
            healthOverlay={buildQuotaHealthOverlay({
              label: 'OpenAI Spark 5-Hour',
              provider: row.provider,
              windowMs: 5 * 60 * 60 * 1000,
              health,
              modelMatches: isSparkModel,
            })}
          />
        </div>
        <div className='grid gap-3'>
          <QuotaValue
            label='Weekly'
            percent={row.weekly_remaining_pct}
            resetAt={row.weekly_reset_at}
            active={row.weekly_active}
            usageTokens={row.weekly_usage_tokens}
            usageBreakdown={row.weekly_usage_breakdown}
            healthOverlay={buildQuotaHealthOverlay({
              label: 'OpenAI Weekly',
              provider: row.provider,
              windowMs: 7 * 24 * 60 * 60 * 1000,
              health,
              modelMatches: (model) => !isSparkModel(model),
            })}
          />
          <QuotaValue
            label='Spark Weekly'
            percent={row.special_remaining_pct}
            resetAt={row.special_reset_at}
            active={row.special_active}
            usageTokens={row.special_usage_tokens}
            usageBreakdown={row.special_usage_breakdown}
            healthOverlay={buildQuotaHealthOverlay({
              label: 'OpenAI Spark Weekly',
              provider: row.provider,
              windowMs: 7 * 24 * 60 * 60 * 1000,
              health,
              modelMatches: isSparkModel,
            })}
          />
        </div>
      </div>
    </ProviderStatusFrame>
  )
}

function AnthropicStatusCard({
  row,
  health,
}: {
  row: UsageReportQuotaRow
  health: QuotaHealthInput
}) {
  return (
    <ProviderStatusFrame
      providerKey='anthropic'
      title='Anthropic'
      description='5-hour, weekly, and Sonnet windows'
      badge={quotaFreshnessLabel(row)}
      color={providerColorFor(row.provider)}
    >
      <div className='grid gap-3 text-xs'>
        <QuotaValue
          label='5-Hour'
          percent={row.short_remaining_pct}
          resetAt={row.short_reset_at}
          active={row.short_active}
          usageTokens={row.short_usage_tokens}
          usageBreakdown={row.short_usage_breakdown}
          healthOverlay={buildQuotaHealthOverlay({
            label: 'Anthropic 5-Hour',
            provider: row.provider,
            windowMs: 5 * 60 * 60 * 1000,
            health,
          })}
        />
        <QuotaValue
          label='Weekly'
          percent={row.weekly_remaining_pct}
          resetAt={row.weekly_reset_at}
          active={row.weekly_active}
          usageTokens={row.weekly_usage_tokens}
          usageBreakdown={row.weekly_usage_breakdown}
          healthOverlay={buildQuotaHealthOverlay({
            label: 'Anthropic Weekly',
            provider: row.provider,
            windowMs: 7 * 24 * 60 * 60 * 1000,
            health,
          })}
        />
        <QuotaValue
          label='Sonnet'
          percent={row.special_remaining_pct}
          resetAt={row.special_reset_at}
          active={row.special_active}
          usageTokens={row.special_usage_tokens}
          usageBreakdown={row.special_usage_breakdown}
          healthOverlay={buildQuotaHealthOverlay({
            label: 'Anthropic Sonnet',
            provider: row.provider,
            windowMs: 7 * 24 * 60 * 60 * 1000,
            health,
            modelMatches: isSonnetModel,
          })}
        />
      </div>
    </ProviderStatusFrame>
  )
}

function GenericProviderStatusCard({
  row,
  health,
}: {
  row: UsageReportQuotaRow
  health: QuotaHealthInput
}) {
  return (
    <ProviderStatusFrame
      providerKey={providerColorKey(row.provider)}
      title={formatProviderQuotaTitle(row)}
      badge={quotaFreshnessLabel(row)}
      color={providerColorFor(row.provider)}
    >
      <div className='grid gap-3 text-xs'>
        <QuotaValue
          label={shortQuotaLabel(row.provider)}
          percent={row.short_remaining_pct}
          resetAt={row.short_reset_at}
          active={row.short_active}
          usageTokens={row.short_usage_tokens}
          usageBreakdown={row.short_usage_breakdown}
          healthOverlay={buildQuotaHealthOverlay({
            label: `${providerDisplayName(row.provider)} ${shortQuotaLabel(row.provider)}`,
            provider: row.provider,
            windowMs: 5 * 60 * 60 * 1000,
            health,
          })}
        />
        <QuotaValue
          label='Weekly'
          percent={row.weekly_remaining_pct}
          resetAt={row.weekly_reset_at}
          active={row.weekly_active}
          usageTokens={row.weekly_usage_tokens}
          usageBreakdown={row.weekly_usage_breakdown}
          healthOverlay={buildQuotaHealthOverlay({
            label: `${providerDisplayName(row.provider)} Weekly`,
            provider: row.provider,
            windowMs: 7 * 24 * 60 * 60 * 1000,
            health,
          })}
        />
        <QuotaValue
          label={specialQuotaLabel(row.provider)}
          percent={row.special_remaining_pct}
          resetAt={row.special_reset_at}
          active={row.special_active}
          usageTokens={row.special_usage_tokens}
          usageBreakdown={row.special_usage_breakdown}
          healthOverlay={buildQuotaHealthOverlay({
            label: `${providerDisplayName(row.provider)} ${specialQuotaLabel(row.provider)}`,
            provider: row.provider,
            windowMs: 7 * 24 * 60 * 60 * 1000,
            health,
          })}
        />
        {shouldShowShortSpecialQuota(row) ? (
          <QuotaValue
            label={shortSpecialQuotaLabel(row.provider)}
            percent={row.short_special_remaining_pct}
            resetAt={row.short_special_reset_at}
            active={row.short_special_active}
            usageTokens={row.short_special_usage_tokens}
            usageBreakdown={row.short_special_usage_breakdown}
            healthOverlay={buildQuotaHealthOverlay({
              label: `${providerDisplayName(row.provider)} ${shortSpecialQuotaLabel(row.provider)}`,
              provider: row.provider,
              windowMs: 5 * 60 * 60 * 1000,
              health,
            })}
          />
        ) : null}
      </div>
    </ProviderStatusFrame>
  )
}

function UnmeteredProviderStatusCard({
  status,
  health,
}: {
  status: UnmeteredProviderStatus
  health: QuotaHealthInput
}) {
  return (
    <ProviderStatusFrame
      providerKey={status.key}
      title={status.label}
      description='24-hour usage and health window'
      badge='Unmetered'
      color={status.color}
    >
      <div className='grid gap-3 text-xs'>
        <QuotaValue
          label='24-Hour'
          percent={null}
          percentLabel='∞'
          resetAt={nextLocalMidnightIso()}
          active
          usageTokens={status.tokens}
          usageBreakdown={status.breakdown}
          usageLabel='tokens over 24h'
          healthOverlay={buildQuotaHealthOverlay({
            label: `${status.label} 24-Hour`,
            provider: status.key,
            windowMs: PROVIDER_STATUS_24H_WINDOW_MS,
            health,
          })}
        />
      </div>
    </ProviderStatusFrame>
  )
}

function ClientUsagePie({
  clientUsage,
  activeSlice,
  onSliceHover,
  variant = 'embedded',
}: {
  clientUsage: { total: number; slices: ClientUsageSlice[] }
  activeSlice: ClientUsageSlice | null
  onSliceHover: (slice: ClientUsageSlice | null) => void
  variant?: 'embedded' | 'standalone'
}) {
  if (!clientUsage.slices.length) {
    return (
      <div className='rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground'>
        No client usage rows returned.
      </div>
    )
  }

  const embedded = variant === 'embedded'
  const layoutClass = embedded
    ? 'space-y-3 border-t pt-4'
    : 'grid flex-1 gap-3 min-[2200px]:grid-cols-[minmax(220px,0.65fr)_minmax(0,1.35fr)] min-[2200px]:items-start'

  return (
    <div className={layoutClass} data-client-usage-panel=''>
      {embedded ? (
        <div>
          <div className='text-sm font-medium'>Client Usage</div>
          <div className='text-xs text-muted-foreground'>
            Token share by client for the selected range
          </div>
        </div>
      ) : null}
      <div className='h-[220px]'>
        <ResponsiveContainer width='100%' height='100%'>
          <PieChart
            accessibilityLayer
            role='img'
            title='Client usage chart'
            desc='Pie chart showing token usage share by client for the selected report range.'
            aria-label='Client token usage by client'
          >
            <Pie
              data={clientUsage.slices}
              dataKey='tokens'
              nameKey='client'
              innerRadius='50%'
              outerRadius='82%'
              paddingAngle={1}
              onMouseEnter={(_slice, index) => {
                onSliceHover(clientUsage.slices[index] ?? null)
              }}
            >
              {clientUsage.slices.map((slice) => (
                <Cell key={slice.key} fill={slice.color} stroke='none' />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className='grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-1 text-xs'>
        {clientUsage.slices.map((slice) => (
          <button
            key={slice.key}
            data-client-usage-option=''
            type='button'
            className='grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-sm px-2 py-1 text-start ring-sidebar-ring outline-none hover:bg-muted focus-visible:ring-2'
            onFocus={() => onSliceHover(slice)}
            onMouseEnter={() => onSliceHover(slice)}
          >
            <span className='flex min-w-0 items-center gap-2'>
              <span
                className='size-2 shrink-0 rounded-full'
                style={{ backgroundColor: slice.color }}
              />
              <span className='truncate'>{slice.client}</span>
            </span>
            <span className='text-muted-foreground tabular-nums'>
              {formatPercent(
                clientUsage.total ? (slice.tokens / clientUsage.total) * 100 : 0
              )}
            </span>
          </button>
        ))}
      </div>
      {activeSlice ? (
        <ClientUsageDetail total={clientUsage.total} slice={activeSlice} />
      ) : null}
    </div>
  )
}

function ClientUsageDetail({
  total,
  slice,
}: {
  total: number
  slice: ClientUsageSlice
}) {
  return (
    <div
      data-client-usage-detail=''
      className='h-64 overflow-auto rounded-md border bg-muted/20 p-3 min-[2200px]:col-span-full'
    >
      <div className='mb-2 border-b pb-2'>
        <div className='flex items-start justify-between gap-3'>
          <div className='min-w-0'>
            <div className='truncate text-sm font-medium'>{slice.client}</div>
            <div className='text-xs text-muted-foreground'>
              Client version detail
            </div>
          </div>
          <div className='text-right text-xs text-muted-foreground tabular-nums'>
            {formatPercent(total ? (slice.tokens / total) * 100 : 0)}
            <span className='block'>{formatCompact(slice.tokens)} tokens</span>
          </div>
        </div>
      </div>
      <div
        className='grid grid-cols-[repeat(auto-fit,minmax(16rem,1fr))] gap-1'
        data-client-version-grid=''
      >
        {slice.versions.map((item) => (
          <div
            key={`${item.client}:${item.version}`}
            data-client-version-row=''
            data-client-version-first-seen={item.firstSeenAt ?? ''}
            className='grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-sm border-l-4 px-2 py-1 text-xs'
            style={{
              borderColor: slice.color,
              backgroundColor: colorWithAlpha(slice.color, 0.08),
            }}
          >
            <span className='min-w-0 truncate'>
              {item.client === slice.client
                ? item.version
                : clientVersionLabel(item)}
              <span className='block text-[10px] text-muted-foreground'>
                First seen {formatShortDateTime(item.firstSeenAt)}
              </span>
            </span>
            <span className='text-right text-muted-foreground tabular-nums'>
              {formatPercent(
                slice.tokens ? (item.tokens / slice.tokens) * 100 : null
              )}{' '}
              / {formatCompact(item.tokens)}
              <span className='block'>
                {formatCurrency(item.cost)} / {formatNumber(item.traces)} traces
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function HealthMetricsPanel({ health }: { health: ProviderHealthMetrics }) {
  if (!health.summaries.length) {
    return (
      <div className='flex h-[360px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground'>
        No provider health metrics returned.
      </div>
    )
  }

  return (
    <div className='flex flex-1 flex-col gap-4' data-health-metrics-panel=''>
      <div className='grid gap-2 sm:grid-cols-2 xl:grid-cols-6'>
        <HealthStat
          label='Latest bucket'
          value={formatShortDateTime(health.latestBucketStart)}
        />
        <HealthStat
          label='Requests'
          value={formatCompact(health.totalRequests)}
        />
        <HealthStat
          label='Provider errors'
          value={formatNumber(health.providerErrors)}
        />
        <HealthStat
          label='Rate limits'
          value={formatNumber(health.rateLimitEvents)}
        />
        <HealthStat
          label='Control ping'
          value={formatDurationMs(health.controlPingAvgMs)}
        />
        <HealthStat
          label='Provider delta'
          value={formatSignedDurationMs(health.providerPingDeltaMs)}
        />
      </div>

      {health.rows.length ? (
        <div className='h-[220px] shrink-0 ps-2'>
          <ResponsiveContainer width='100%' height='100%'>
            <LineChart
              accessibilityLayer
              role='img'
              title='Health metrics chart'
              desc='Line chart showing daily weighted upstream p95 latency by provider over the last fourteen days.'
              aria-label='Provider health p95 latency over the last 14 days'
              data={health.rows}
            >
              <CartesianGrid strokeDasharray='3 3' vertical={false} />
              <XAxis
                dataKey='bucket'
                stroke='#888888'
                fontSize={12}
                tickLine={false}
                axisLine={false}
                minTickGap={18}
              />
              <YAxis
                stroke='#888888'
                fontSize={12}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => formatDurationMs(Number(value))}
              />
              <Legend
                verticalAlign='top'
                height={28}
                wrapperStyle={{ fontSize: 12 }}
              />
              {health.series.map((series) => (
                <Line
                  key={series.key}
                  type='monotone'
                  dataKey={series.key}
                  name={series.provider}
                  stroke={series.color}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      <div className='grid gap-2 lg:grid-cols-2' data-health-provider-list=''>
        {health.summaries.map((summary) => (
          <div
            key={summary.provider}
            className='space-y-2 rounded-md border border-l-4 p-3'
            style={{
              borderLeftColor: summary.color,
              backgroundColor: colorWithAlpha(summary.color, 0.06),
            }}
            data-health-provider={summary.provider.toLowerCase()}
          >
            <div className='flex items-start justify-between gap-3'>
              <div className='min-w-0'>
                <div className='truncate text-sm font-medium'>
                  {providerDisplayName(summary.provider)}
                </div>
                <div className='text-xs text-muted-foreground'>
                  Last seen {formatShortDateTime(summary.latestBucketStart)}
                </div>
              </div>
              <div className='flex shrink-0 flex-col items-end gap-1'>
                <Badge
                  variant='outline'
                  data-health-attribution={summary.dominantAttribution}
                >
                  {healthAttributionLayerLabel(summary.dominantAttribution)}
                </Badge>
                <Badge variant='outline'>
                  {formatPercent(summary.statusProbeSuccessPct)} probe
                </Badge>
              </div>
            </div>
            <div className='grid grid-cols-2 gap-2 text-xs'>
              <HealthMetric
                label='Requests'
                value={formatCompact(summary.requests)}
              />
              <HealthMetric
                label='Upstream p95'
                value={formatDurationMs(summary.upstreamP95Ms)}
              />
              <HealthMetric
                label='Total p95'
                value={formatDurationMs(summary.totalP95Ms)}
              />
              <HealthMetric
                label='Ping'
                value={formatDurationMs(summary.providerPingAvgMs)}
              />
              <HealthMetric
                label='Control ping'
                value={formatDurationMs(summary.controlPingAvgMs)}
              />
              <HealthMetric
                label='Provider delta'
                value={formatSignedDurationMs(summary.providerPingDeltaMs)}
              />
              <HealthMetric
                label='Provider errors'
                value={formatNumber(summary.providerErrors)}
              />
              <HealthMetric
                label='Rate limits'
                value={formatNumber(summary.rateLimitEvents)}
              />
              <HealthMetric
                label='Control loss'
                value={formatPercent(summary.controlPacketLossPct)}
              />
              <HealthMetric
                label='Control probe'
                value={formatPercent(summary.controlProbeSuccessPct)}
              />
              <HealthMetric
                label='Path loss'
                value={formatPercent(summary.packetLossPct)}
              />
            </div>
            <HealthAttributionSummary counts={summary.attributionCounts} />
            {summary.models.length ? (
              <div className='space-y-1 border-t pt-2'>
                {summary.models.map((model) => (
                  <div
                    key={model.model}
                    className='grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-sm px-2 py-1 text-xs'
                    style={{
                      backgroundColor: colorWithAlpha(
                        modelColorFor(model.model),
                        0.08
                      ),
                    }}
                  >
                    <span className='truncate text-muted-foreground'>
                      {model.model}
                    </span>
                    <span className='text-right tabular-nums'>
                      {formatCompact(model.requests)}
                      <span className='ms-2 text-muted-foreground'>
                        {formatDurationMs(model.upstreamP95Ms)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

function HealthStat({ label, value }: { label: string; value: string }) {
  return (
    <div className='rounded-md border bg-muted/20 p-3'>
      <div className='text-xs text-muted-foreground'>{label}</div>
      <div className='mt-1 text-lg font-semibold tabular-nums'>{value}</div>
    </div>
  )
}

function HealthMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className='text-muted-foreground'>{label}</div>
      <div className='font-medium tabular-nums'>{value}</div>
    </div>
  )
}

function HealthAttributionSummary({
  counts,
}: {
  counts: HealthAttributionCounts
}) {
  const items = healthAttributionDisplayOrder
    .map((layer) => ({
      layer,
      count: counts[layer] ?? 0,
      label: healthAttributionLayerLabel(layer),
    }))
    .filter((item) => item.count > 0)

  if (!items.length) return null

  return (
    <div
      className='grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-1 border-t pt-2 text-xs'
      data-health-attribution-summary=''
    >
      {items.map((item) => (
        <div
          key={item.layer}
          className='rounded-sm bg-background/60 px-2 py-1'
          data-health-attribution-count={item.layer}
        >
          <div className='text-muted-foreground'>{item.label}</div>
          <div className='font-medium tabular-nums'>
            {formatNumber(item.count)} bucket{item.count === 1 ? '' : 's'}
          </div>
        </div>
      ))}
    </div>
  )
}

function shortSpecialResetAt(row: UsageReportQuotaRow) {
  if (
    isOpenAiQuotaRow(row) &&
    isZeroPercent(row.special_remaining_pct) &&
    isBefore(row.short_special_reset_at, row.special_reset_at)
  ) {
    return row.special_reset_at
  }

  return row.short_special_reset_at
}

function openAiSparkShortSpecialPercent(row: UsageReportQuotaRow) {
  if (isZeroPercent(row.special_remaining_pct)) return 0
  return row.short_special_remaining_pct
}

function isZeroPercent(value: number | null) {
  return value !== null && value <= 0
}

function isBefore(left: string | null, right: string | null) {
  if (!left || !right) return false
  return new Date(left).getTime() < new Date(right).getTime()
}

function isOpenAiQuotaRow(row: UsageReportQuotaRow) {
  return row.provider.toLowerCase() === 'openai'
}

function isAnthropicQuotaRow(row: UsageReportQuotaRow) {
  return row.provider.toLowerCase() === 'anthropic'
}

function compareProviderQuotaRows(
  left: UsageReportQuotaRow,
  right: UsageReportQuotaRow
) {
  const byProvider =
    providerQuotaSortRank(left.provider) - providerQuotaSortRank(right.provider)
  if (byProvider !== 0) return byProvider

  return formatProviderQuotaTitle(left).localeCompare(
    formatProviderQuotaTitle(right)
  )
}

function providerQuotaSortRank(provider: string) {
  const normalized = provider.toLowerCase()
  if (normalized === 'openai') return 0
  if (normalized === 'anthropic') return 1
  if (normalized === 'google' || normalized === 'gemini') return 2
  return 3
}

function GoogleQuotaCard({
  rows,
  color,
  health,
}: {
  rows: UsageReportQuotaRow[]
  color: string
  health: QuotaHealthInput
}) {
  const classRows = new Map<GoogleQuotaClass, UsageReportQuotaRow>()
  const classUsage = new Map<GoogleQuotaClass, QuotaUsageSummary>()
  for (const row of rows) {
    const quotaClass = googleQuotaClass(row.model)
    if (!quotaClass) continue

    const current = classRows.get(quotaClass)
    if (!current || compareQuotaClassRows(row, current) < 0) {
      classRows.set(quotaClass, row)
    }
    classUsage.set(
      quotaClass,
      mergeQuotaUsage(classUsage.get(quotaClass), {
        tokens: row.short_usage_tokens,
        breakdown: row.short_usage_breakdown,
      })
    )
  }

  return (
    <ProviderStatusFrame
      providerKey='google'
      title='Gemini'
      description='Independent model-class request windows'
      badge={googleQuotaFreshnessLabel(classRows)}
      color={color}
    >
      <div className='grid gap-3 text-xs'>
        {googleQuotaClasses.map((quotaClass) => {
          const row = classRows.get(quotaClass.key)
          return (
            <QuotaValue
              key={quotaClass.key}
              label={quotaClass.label}
              percent={row?.short_remaining_pct ?? null}
              resetAt={row?.short_reset_at ?? null}
              active={row?.short_active ?? false}
              usageTokens={classUsage.get(quotaClass.key)?.tokens ?? 0}
              usageBreakdown={classUsage.get(quotaClass.key)?.breakdown ?? []}
              healthOverlay={buildQuotaHealthOverlay({
                label: `Gemini ${quotaClass.label}`,
                provider: 'google',
                windowMs: 24 * 60 * 60 * 1000,
                health,
                modelMatches: (model) =>
                  googleQuotaClass(model) === quotaClass.key,
              })}
            />
          )
        })}
      </div>
    </ProviderStatusFrame>
  )
}

function QuotaValue({
  label,
  percent,
  percentLabel: percentLabelOverride,
  resetAt,
  active,
  usageTokens,
  usageBreakdown,
  usageLabel,
  healthOverlay,
}: {
  label: string
  percent: number | null
  percentLabel?: string
  resetAt: string | null
  active: boolean
  usageTokens: number
  usageBreakdown: UsageReportQuotaUsageBreakdown[]
  usageLabel?: string
  healthOverlay?: QuotaHealthOverlay | null
}) {
  const percentLabel = percentLabelOverride ?? formatPercent(percent)
  const tokenUsageLabel = usageLabel ?? 'tokens since reset'

  return (
    <div
      data-quota-value={label}
      data-quota-percent={percentLabel}
      className='min-w-0 space-y-1'
    >
      <div
        className={
          healthOverlay
            ? 'grid min-w-0 grid-cols-[minmax(0,1fr)_0.875rem] gap-2'
            : 'min-w-0'
        }
      >
        <div className='min-w-0 space-y-1'>
          <div className='flex min-w-0 items-start gap-1 text-muted-foreground'>
            <Clock3 className='mt-0.5 size-3 shrink-0' />
            <span className='min-w-0 leading-tight'>{label}</span>
          </div>
          <div className='font-semibold tabular-nums'>{percentLabel}</div>
          <div className='truncate text-muted-foreground'>
            {active ? 'Resets ' : 'Latest '}
            {formatShortDateTime(resetAt)}
          </div>
          <QuotaUsageBar
            tokens={usageTokens}
            breakdown={usageBreakdown}
            usageLabel={tokenUsageLabel}
          />
        </div>
        <QuotaHealthTimeline overlay={healthOverlay} />
      </div>
    </div>
  )
}

function QuotaUsageBar({
  tokens,
  breakdown,
  usageLabel = 'tokens since reset',
}: {
  tokens: number
  breakdown: UsageReportQuotaUsageBreakdown[]
  usageLabel?: string
}) {
  const visibleBreakdown = breakdown.filter((item) => item.tokens > 0)

  return (
    <div className='space-y-1 pt-1'>
      <div className='text-[11px] text-muted-foreground tabular-nums'>
        {formatCompact(tokens)} {usageLabel}
      </div>
      <UiTooltip>
        <TooltipTrigger asChild>
          <div
            className='flex h-2 overflow-hidden rounded-full bg-muted ring-sidebar-ring outline-none focus-visible:ring-2'
            aria-label={`${formatCompact(tokens)} ${usageLabel}`}
            tabIndex={0}
          >
            {visibleBreakdown.length ? (
              visibleBreakdown.map((item) => {
                const width = tokens ? (item.tokens / tokens) * 100 : 0
                const color = modelColorFor(item.model)
                return (
                  <div
                    key={item.model}
                    className='h-full min-w-px'
                    style={{
                      width: `${Math.max(width, 1)}%`,
                      backgroundColor: color,
                    }}
                  />
                )
              })
            ) : (
              <div className='h-full w-0' />
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent
          align='start'
          side='top'
          sideOffset={6}
          className='max-h-72 w-80 overflow-auto border bg-popover text-popover-foreground shadow-md'
        >
          <QuotaUsageTooltip
            tokens={tokens}
            breakdown={visibleBreakdown}
            usageLabel={usageLabel}
          />
        </TooltipContent>
      </UiTooltip>
      {visibleBreakdown.length ? (
        <div
          className='grid gap-1 text-[10px] text-muted-foreground'
          data-quota-model-list=''
        >
          {visibleBreakdown.slice(0, 3).map((item) => (
            <span
              key={item.model}
              className='flex min-w-0 items-center gap-1'
              data-quota-model-row=''
            >
              <span
                className='size-1.5 shrink-0 rounded-full'
                style={{ backgroundColor: modelColorFor(item.model) }}
              />
              <span className='min-w-0 truncate'>{item.model}</span>
            </span>
          ))}
          {visibleBreakdown.length > 3 ? (
            <span>+{visibleBreakdown.length - 3}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function QuotaUsageTooltip({
  tokens,
  breakdown,
  usageLabel = 'tokens since reset',
}: {
  tokens: number
  breakdown: UsageReportQuotaUsageBreakdown[]
  usageLabel?: string
}) {
  if (!breakdown.length) {
    return (
      <div className='text-xs text-muted-foreground'>
        No token usage recorded for this window.
      </div>
    )
  }

  return (
    <div className='space-y-2'>
      <div className='border-b pb-2 text-xs font-medium'>
        {formatCompact(tokens)} {usageLabel}
      </div>
      <div className='space-y-1'>
        {breakdown.map((item) => {
          const percent = tokens ? (item.tokens / tokens) * 100 : null
          return (
            <div
              key={item.model}
              className='grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-sm border-l-4 px-2 py-1 text-xs'
              style={{
                borderColor: modelColorFor(item.model),
                backgroundColor: colorWithAlpha(
                  modelColorFor(item.model),
                  0.08
                ),
              }}
            >
              <span className='truncate font-medium'>{item.model}</span>
              <span className='text-right text-muted-foreground tabular-nums'>
                {formatPercent(percent)} / {formatCompact(item.tokens)}
                <span className='block'>{formatCurrency(item.cost)}</span>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function QuotaHealthTimeline({
  overlay,
}: {
  overlay?: QuotaHealthOverlay | null
}) {
  if (!overlay) return null

  return (
    <UiTooltip>
      <TooltipTrigger asChild>
        <div
          data-quota-health-overlay={overlay.label}
          data-quota-health-attribution={
            overlay.latestAttribution?.layer ?? 'unknown'
          }
          data-quota-health-orientation='vertical'
          role='img'
          aria-label={quotaHealthAriaLabel(overlay)}
          tabIndex={0}
          className='flex min-h-28 justify-center py-1 ring-sidebar-ring outline-none focus-visible:ring-2'
        >
          <div className='relative min-h-28 w-2 overflow-hidden rounded-full bg-muted'>
            {overlay.segments.map((segment) => (
              <span
                key={segment.key}
                className='absolute left-0 w-full'
                style={{
                  top: `${segment.topPct}%`,
                  height: `${segment.heightPct}%`,
                  backgroundColor: quotaHealthSeverityColor(segment.severity),
                }}
              />
            ))}
            <div
              className='absolute inset-0'
              aria-hidden='true'
              data-quota-health-markers=''
            >
              {overlay.markers.map((marker) => (
                <span
                  key={marker.key}
                  className='absolute left-1/2 h-1 rounded-full border border-background'
                  style={{
                    top: `${marker.topPct}%`,
                    width: `${Math.min(18, 8 + marker.count)}px`,
                    transform: 'translate(-50%, -50%)',
                    backgroundColor: quotaHealthSeverityColor('bad'),
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent
        align='center'
        side='right'
        sideOffset={6}
        className='w-80 border bg-popover text-popover-foreground shadow-md'
      >
        <QuotaHealthTooltip overlay={overlay} />
      </TooltipContent>
    </UiTooltip>
  )
}

function QuotaHealthTooltip({ overlay }: { overlay: QuotaHealthOverlay }) {
  const recentMarkers = overlay.markers.slice(0, 4)

  return (
    <div className='space-y-2 text-xs'>
      <div className='border-b pb-2'>
        <div className='font-medium'>{overlay.label} health window</div>
        <div className='text-muted-foreground'>
          {overlay.sampleCount} latency buckets / {overlay.providerErrorCount}{' '}
          provider errors
        </div>
        <div className='text-muted-foreground'>
          {formatShortDateTime(overlay.endAt)} to{' '}
          {formatShortDateTime(overlay.startAt)}
        </div>
      </div>
      <div className='grid grid-cols-2 gap-2 text-muted-foreground'>
        <div>
          Latest p95
          <span className='block font-medium text-foreground tabular-nums'>
            {formatDurationMs(overlay.latestLatencyMs)}
          </span>
        </div>
        <div>
          Worst band
          <span className='block font-medium text-foreground'>
            {quotaHealthSeverityLabel(overlay.worstSeverity)}
          </span>
        </div>
        <div>
          Control ping
          <span className='block font-medium text-foreground tabular-nums'>
            {formatDurationMs(overlay.latestControlPingMs)}
          </span>
        </div>
        <div>
          Provider delta
          <span className='block font-medium text-foreground tabular-nums'>
            {formatSignedDurationMs(overlay.latestProviderPingDeltaMs)}
          </span>
        </div>
      </div>
      {overlay.latestAttribution ? (
        <div className='rounded-sm border bg-background/60 px-2 py-1'>
          <div className='font-medium'>
            Likely cause: {overlay.latestAttribution.label}
          </div>
          <div className='text-muted-foreground'>
            {overlay.latestAttribution.detail}
          </div>
        </div>
      ) : null}
      <div className='grid grid-cols-2 gap-1 border-t pt-2 text-muted-foreground'>
        {healthAttributionDisplayOrder.map((layer) => (
          <div key={layer}>
            {healthAttributionLayerLabel(layer)}
            <span className='ms-1 font-medium text-foreground tabular-nums'>
              {formatNumber(overlay.attributionCounts[layer] ?? 0)}
            </span>
          </div>
        ))}
      </div>
      {recentMarkers.length ? (
        <div className='space-y-1 border-t pt-2'>
          {recentMarkers.map((marker) => (
            <div
              key={marker.key}
              className='rounded-sm border-l-4 px-2 py-1'
              style={{
                borderColor: quotaHealthSeverityColor('bad'),
                backgroundColor: colorWithAlpha(
                  quotaHealthSeverityColor('bad'),
                  0.08
                ),
              }}
            >
              <div className='font-medium'>
                {marker.count} error{marker.count === 1 ? '' : 's'} at{' '}
                {formatShortDateTime(marker.observedAt)}
              </div>
              <div className='text-muted-foreground'>
                {marker.classes.join(', ')}
                {marker.models.length ? ` / ${marker.models.join(', ')}` : ''}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className='border-t pt-2 text-muted-foreground'>
          No provider error observations in this quota window.
        </div>
      )}
    </div>
  )
}

function TokenTrendDetail({
  label,
  row,
  series,
}: {
  label: string | number
  row: TokenTrendChartRow
  series: ProviderSeries[]
}) {
  const providerItems = series
    .map((item) => ({
      dataKey: item.key,
      name: item.provider,
      value: Number(row[item.key] ?? 0),
      color: item.color,
    }))
    .filter((item) => item.value > 0)
    .sort((left, right) => Number(right.value ?? 0) - Number(left.value ?? 0))
  const repositoryItems = row.repositoryBreakdowns
    .filter((item) => item.tokens > 0)
    .sort((left, right) => right.tokens - left.tokens)

  if (!providerItems.length && !repositoryItems.length) return null

  return (
    <div
      data-trend-detail='token'
      className='max-h-[calc(100vh-12rem)] min-h-0 flex-1 overflow-auto rounded-md border bg-muted/20 p-3 sm:max-h-[32rem]'
    >
      <div className='mb-2 border-b pb-2 text-sm font-medium'>{label}</div>
      {providerItems.length ? (
        <div
          data-trend-detail-grid=''
          className='grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-2'
        >
          {providerItems.map((item) => {
            const dataKey = item.dataKey
            const providerTokens = item.value
            const providerCost = Number(row.costs[dataKey] ?? 0)
            const providerPct = row.total
              ? (providerTokens / Number(row.total)) * 100
              : 0
            const breakdowns = row.breakdowns[dataKey] ?? []
            const providerColor = item.color

            return (
              <div
                key={dataKey}
                data-token-provider-detail=''
                className='rounded-sm border-l-4 ps-2'
                style={{ borderColor: providerColor }}
              >
                <div
                  className='flex items-start justify-between gap-3 rounded-sm px-2 py-1 text-xs'
                  style={{
                    backgroundColor: colorWithAlpha(providerColor, 0.1),
                  }}
                >
                  <span className='flex min-w-0 items-center gap-2 font-medium'>
                    <span
                      className='size-2 shrink-0 rounded-full'
                      style={{ backgroundColor: providerColor }}
                    />
                    <span className='truncate'>{item.name}</span>
                  </span>
                  <span className='shrink-0 text-right text-muted-foreground tabular-nums'>
                    {formatPercent(providerPct)} /{' '}
                    {formatCompact(providerTokens)}
                    <span className='block'>
                      {formatCurrency(providerCost)}
                    </span>
                  </span>
                </div>
                <div className='mt-1 grid gap-1'>
                  {breakdowns.map((breakdown) => (
                    <div
                      key={breakdown.model}
                      data-token-trend-model-row=''
                      className='grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-sm px-2 py-0.5 text-xs'
                    >
                      <span className='truncate text-muted-foreground'>
                        {breakdown.model}
                      </span>
                      <span className='text-right tabular-nums'>
                        {formatPercent(
                          providerTokens
                            ? (breakdown.tokens / providerTokens) * 100
                            : null
                        )}
                        <span className='ms-2 text-muted-foreground'>
                          {formatCurrency(breakdown.cost)}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
      {repositoryItems.length ? (
        <div className='mt-3 border-t pt-3'>
          <div className='mb-2 text-xs font-medium text-muted-foreground'>
            Repository breakdown
          </div>
          <div
            data-token-repository-breakdown=''
            className='grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-1'
          >
            {repositoryItems.map((item) => {
              const percent = row.total
                ? (item.tokens / Number(row.total)) * 100
                : 0

              return (
                <div
                  key={item.repository}
                  className='grid gap-1 rounded-sm border-l-4 px-2 py-1 text-xs'
                  style={{
                    borderColor: item.color,
                    backgroundColor: colorWithAlpha(item.color, 0.08),
                  }}
                >
                  <span
                    className='min-w-0 truncate text-right font-medium'
                    data-token-repository-name=''
                  >
                    {item.repository}
                  </span>
                  <span
                    className='text-left text-muted-foreground tabular-nums'
                    data-token-repository-usage=''
                  >
                    {formatPercent(percent)} / {formatCompact(item.tokens)}
                    <span className='ms-2'>{formatCurrency(item.cost)}</span>
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function buildUnmeteredProviderStatuses(
  rows: UsageReportProviderStatusUsageRow[]
): UnmeteredProviderStatus[] {
  const byProvider = new Map<UnmeteredProviderKey, UnmeteredProviderStatus>()
  for (const config of unmeteredProviderConfigs) {
    byProvider.set(config.key, {
      key: config.key,
      label: config.label,
      color: providerColorFor(config.key),
      tokens: 0,
      cost: 0,
      traces: 0,
      breakdown: [],
    })
  }

  for (const row of rows) {
    const providerKey = providerColorKey(row.provider)
    if (!isUnmeteredProviderKey(providerKey)) continue
    const status = byProvider.get(providerKey)
    if (!status) continue

    status.tokens += row.token_total
    status.cost += row.usd_cost
    status.traces += row.traces
    status.breakdown = mergeQuotaUsage(
      {
        tokens: status.tokens - row.token_total,
        breakdown: status.breakdown,
      },
      {
        tokens: row.token_total,
        breakdown: [
          {
            model: row.model,
            tokens: row.token_total,
            cost: row.usd_cost,
            traces: row.traces,
          },
        ],
      }
    ).breakdown
  }

  return unmeteredProviderConfigs.map((config) => byProvider.get(config.key)!)
}

function isUnmeteredProviderKey(value: string): value is UnmeteredProviderKey {
  return unmeteredProviderConfigs.some((config) => config.key === value)
}

function buildProviderTrendRows(rows: UsageReportTrendRow[]) {
  const providerTotals = new Map<string, number>()
  const repositoryTotals = new Map<string, number>()
  for (const row of rows) {
    providerTotals.set(
      row.provider,
      (providerTotals.get(row.provider) ?? 0) + row.token_total
    )
    repositoryTotals.set(
      row.repository,
      (repositoryTotals.get(row.repository) ?? 0) + row.token_total
    )
  }

  const providers = [...providerTotals.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([provider]) => provider)
  const topRepositories = [...repositoryTotals.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, MAX_REPOSITORY_SERIES)
    .map(([repository]) => repository)
  const topRepositorySet = new Set(topRepositories)
  const hasOtherRepository = rows.some(
    (row) => !topRepositorySet.has(row.repository)
  )
  const repositories = hasOtherRepository
    ? [...topRepositories, OTHER_REPOSITORY]
    : topRepositories
  const repositoryColorByName = new Map(
    repositories.map((repository, index) => [
      repository,
      repositoryColors[index % repositoryColors.length],
    ])
  )

  const series: ProviderSeries[] = providers.map((provider, index) => ({
    provider,
    key: `provider_${index}`,
    color: providerColorFor(provider),
  }))
  const providerKeys = new Map(series.map((item) => [item.provider, item.key]))
  const buckets = new Map<string, TokenTrendChartRow>()

  for (const row of rows) {
    const bucket = formatBucket(row.bucket)
    const providerKey = providerKeys.get(row.provider)
    if (!providerKey) continue

    const existing =
      buckets.get(bucket) ??
      ({
        bucket,
        total: 0,
        costs: {},
        breakdowns: {},
        repositoryBreakdowns: [],
      } as TokenTrendChartRow)

    existing[providerKey] = Number(existing[providerKey] ?? 0) + row.token_total
    existing.total = Number(existing.total) + row.token_total
    existing.costs[providerKey] =
      Number(existing.costs[providerKey] ?? 0) + row.usd_cost
    existing.breakdowns[providerKey] = mergeModelBreakdown(
      existing.breakdowns[providerKey],
      row
    )
    const repository = topRepositorySet.has(row.repository)
      ? row.repository
      : OTHER_REPOSITORY
    existing.repositoryBreakdowns = mergeRepositoryBreakdown(
      existing.repositoryBreakdowns,
      row,
      repository,
      repositoryColorByName.get(repository) ?? repositoryColors[0]
    )
    buckets.set(bucket, existing)
  }

  const trendRows = [...buckets.values()].sort((left, right) =>
    left.bucket.localeCompare(right.bucket)
  )

  for (const row of trendRows) {
    for (const key of Object.keys(row.breakdowns)) {
      row.breakdowns[key].sort((left, right) => right.tokens - left.tokens)
    }
    row.repositoryBreakdowns.sort((left, right) => right.tokens - left.tokens)
  }

  return { rows: trendRows, series }
}

function buildClientUsageSlices(rows: UsageReportClientRow[]) {
  const clientTotals = new Map<
    string,
    {
      tokens: number
      cost: number
      traces: number
      versions: Map<string, ClientVersionBreakdown>
    }
  >()
  let total = 0

  for (const row of rows) {
    const sourceClient = row.client_name || 'unknown'
    const client = canonicalClientName(sourceClient)
    const version = row.client_version || '0.0.0'
    const firstSeenAt = row.first_seen_at
    const existing =
      clientTotals.get(client) ??
      ({
        tokens: 0,
        cost: 0,
        traces: 0,
        versions: new Map<string, ClientVersionBreakdown>(),
      } satisfies {
        tokens: number
        cost: number
        traces: number
        versions: Map<string, ClientVersionBreakdown>
      })

    existing.tokens += row.token_total
    existing.cost += row.usd_cost
    existing.traces += row.traces
    const versionKey = `${client}:${version}`
    const versionSummary = existing.versions.get(versionKey)
    if (versionSummary) {
      versionSummary.tokens += row.token_total
      versionSummary.cost += row.usd_cost
      versionSummary.traces += row.traces
      versionSummary.firstSeenAt = earliestIso(
        versionSummary.firstSeenAt,
        firstSeenAt
      )
      if (!versionSummary.sourceClients.includes(sourceClient)) {
        versionSummary.sourceClients.push(sourceClient)
        versionSummary.sourceClients.sort()
      }
    } else {
      existing.versions.set(versionKey, {
        client,
        version,
        firstSeenAt,
        tokens: row.token_total,
        cost: row.usd_cost,
        traces: row.traces,
        sourceClients: [sourceClient],
      })
    }
    clientTotals.set(client, existing)
    total += row.token_total
  }

  const rankedClients = [...clientTotals.entries()].sort(
    (left, right) => right[1].tokens - left[1].tokens
  )
  const topClients = rankedClients
    .slice(0, MAX_CLIENT_SLICES)
    .map(([client]) => client)
  const topClientSet = new Set(topClients)
  const hasOther = rankedClients.some(([client]) => !topClientSet.has(client))
  const clientNames = hasOther ? [...topClients, OTHER_CLIENTS] : topClients

  const slices: ClientUsageSlice[] = clientNames.flatMap((client, index) => {
    if (client !== OTHER_CLIENTS) {
      const summary = clientTotals.get(client)
      if (!summary) return []
      return [
        {
          key: `client_${index}`,
          client,
          tokens: summary.tokens,
          cost: summary.cost,
          traces: summary.traces,
          color: clientColorFor(client),
          versions: sortClientVersions([...summary.versions.values()]),
        },
      ]
    }

    const otherVersions: ClientVersionBreakdown[] = []
    let otherTokens = 0
    let otherCost = 0
    let otherTraces = 0
    for (const [otherClient, summary] of rankedClients) {
      if (topClientSet.has(otherClient)) continue
      otherTokens += summary.tokens
      otherCost += summary.cost
      otherTraces += summary.traces
      otherVersions.push(...summary.versions.values())
    }

    return [
      {
        key: `client_${index}`,
        client: OTHER_CLIENTS,
        tokens: otherTokens,
        cost: otherCost,
        traces: otherTraces,
        color: '#64748b',
        versions: sortClientVersions(otherVersions),
      },
    ]
  })

  return {
    total,
    slices: slices.filter((slice) => slice.tokens > 0),
  }
}

function mergeModelBreakdown(
  current: ModelBreakdown[] | undefined,
  row: UsageReportTrendRow
) {
  const breakdowns = current ?? []
  const existing = breakdowns.find((item) => item.model === row.model)
  if (existing) {
    existing.tokens += row.token_total
    existing.cost += row.usd_cost
    existing.traces += row.traces
    return breakdowns
  }

  breakdowns.push({
    model: row.model,
    tokens: row.token_total,
    cost: row.usd_cost,
    traces: row.traces,
  })
  return breakdowns
}

function mergeRepositoryBreakdown(
  current: RepositoryBreakdown[],
  row: UsageReportTrendRow,
  repository: string,
  color: string
) {
  const existing = current.find((item) => item.repository === repository)
  if (existing) {
    existing.tokens += row.token_total
    existing.cost += row.usd_cost
    existing.traces += row.traces
    return current
  }

  current.push({
    repository,
    tokens: row.token_total,
    cost: row.usd_cost,
    traces: row.traces,
    color,
  })
  return current
}

function buildQuotaHealthOverlay({
  label,
  provider,
  windowMs,
  health,
  modelMatches = () => true,
}: {
  label: string
  provider: string
  windowMs: number
  health: QuotaHealthInput
  modelMatches?: (model: string) => boolean
}): QuotaHealthOverlay | null {
  const bounds = quotaWindowBounds(windowMs)
  if (!bounds) return null

  const { startMs, endMs } = bounds
  const durationMs = endMs - startMs
  const healthRows = health.healthRows.filter((row) => {
    const bucketMs = parseDateMs(row.bucket_start)
    return (
      bucketMs !== null &&
      bucketMs >= startMs &&
      bucketMs < endMs &&
      providerMatchesQuota(row.provider, provider) &&
      quotaModelMatches(row.model, row.model_group, modelMatches)
    )
  })
  const segments = buildQuotaHealthSegments(healthRows, startMs, endMs)
  const attributionCounts = healthRows.reduce(
    (counts, row) =>
      incrementHealthAttributionCount(
        counts,
        classifyHealthRow(row, quotaHealthLatencyMs(row)).layer
      ),
    emptyHealthAttributionCounts()
  )
  const markers = buildQuotaHealthMarkers({
    errorRows: health.errorRows,
    provider,
    startMs,
    endMs,
    durationMs,
    modelMatches,
  })
  applyQuotaHealthMarkersToSegments(segments, markers)
  const latestHealthRow = [...healthRows].sort(
    (left, right) =>
      (parseDateMs(right.bucket_start) ?? 0) -
      (parseDateMs(left.bucket_start) ?? 0)
  )[0]
  const latestLatencyMs = latestHealthRow
    ? quotaHealthLatencyMs(latestHealthRow)
    : null

  return {
    label,
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(endMs).toISOString(),
    segments,
    markers,
    sampleCount: healthRows.length,
    latestLatencyMs,
    latestControlPingMs: latestHealthRow?.control_ping_avg_ms ?? null,
    latestProviderPingDeltaMs:
      latestHealthRow?.provider_ping_minus_control_ms ?? null,
    latestAttribution: latestHealthRow
      ? classifyHealthRow(latestHealthRow, latestLatencyMs)
      : null,
    attributionCounts,
    providerErrorCount: markers.reduce(
      (total, marker) => total + marker.count,
      0
    ),
    worstSeverity: segments.reduce(
      (severity, segment) =>
        worstQuotaHealthSeverity(severity, segment.severity),
      'unknown' as QuotaHealthSeverity
    ),
  }
}

function quotaWindowBounds(windowMs: number) {
  const endMs = new Date().getTime()
  const startMs = endMs - windowMs
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    endMs <= startMs
  ) {
    return null
  }
  return { startMs, endMs }
}

function buildQuotaHealthSegments(
  rows: UsageReportProviderLatencyHealthRow[],
  startMs: number,
  endMs: number
) {
  const durationMs = endMs - startMs
  const segmentCount = Math.max(1, Math.ceil(durationMs / FIVE_MINUTES_MS))
  const heightPct = 100 / segmentCount
  const segments: QuotaHealthSegment[] = Array.from(
    { length: segmentCount },
    (_, index) => ({
      key: `segment-${index}`,
      topPct: index * heightPct,
      heightPct,
      severity: 'unknown' as QuotaHealthSeverity,
      attribution: 'unknown' as HealthAttributionLayer,
      attributionDetail: 'No latency sample',
      latencyMs: null,
    })
  )

  for (const row of rows) {
    const bucketMs = parseDateMs(row.bucket_start)
    if (bucketMs === null) continue

    const index = clamp(
      0,
      Math.floor((endMs - bucketMs) / FIVE_MINUTES_MS),
      segmentCount - 1
    )
    const latencyMs = quotaHealthLatencyMs(row)
    const attribution = classifyHealthRow(row, latencyMs)
    const severity = attribution.severity
    const segment = segments[index]
    const previousSeverity = segment.severity
    segment.severity = worstQuotaHealthSeverity(previousSeverity, severity)
    if (
      segment.severity !== previousSeverity ||
      segment.attribution === 'unknown' ||
      segment.attribution === 'normal'
    ) {
      segment.attribution = attribution.layer
      segment.attributionDetail = attribution.detail
    }
    if (
      latencyMs !== null &&
      (segment.latencyMs === null || latencyMs > segment.latencyMs)
    ) {
      segment.latencyMs = latencyMs
    }
  }

  return segments
}

function applyQuotaHealthMarkersToSegments(
  segments: QuotaHealthSegment[],
  markers: QuotaHealthMarker[]
) {
  if (!segments.length) return
  for (const marker of markers) {
    const index = clamp(
      0,
      Math.floor((marker.topPct / 100) * segments.length),
      segments.length - 1
    )
    const segment = segments[index]
    segment.severity = worstQuotaHealthSeverity(segment.severity, 'bad')
  }
}

function buildQuotaHealthMarkers({
  errorRows,
  provider,
  startMs,
  endMs,
  durationMs,
  modelMatches,
}: {
  errorRows: UsageReportProviderErrorObservationRow[]
  provider: string
  startMs: number
  endMs: number
  durationMs: number
  modelMatches: (model: string) => boolean
}) {
  const markers = new Map<
    string,
    {
      topPct: number
      count: number
      observedAt: string
      classes: Set<string>
      models: Set<string>
    }
  >()

  for (const row of errorRows) {
    const observedMs = parseDateMs(row.observed_at)
    if (
      observedMs === null ||
      observedMs < startMs ||
      observedMs >= endMs ||
      !providerMatchesQuota(row.provider, provider) ||
      !quotaModelMatches(row.model, row.model_group, modelMatches)
    ) {
      continue
    }

    const topPct = clamp(0, ((endMs - observedMs) / durationMs) * 100, 100)
    const groupedPct = Math.round(topPct * 2) / 2
    const key = `${groupedPct.toFixed(1)}`
    const marker =
      markers.get(key) ??
      ({
        topPct: groupedPct,
        count: 0,
        observedAt: row.observed_at ?? '',
        classes: new Set<string>(),
        models: new Set<string>(),
      } satisfies {
        topPct: number
        count: number
        observedAt: string
        classes: Set<string>
        models: Set<string>
      })

    marker.count += 1
    marker.observedAt = latestIso(marker.observedAt, row.observed_at) ?? ''
    marker.classes.add(row.error_class || 'unknown')
    if (row.model && row.model !== 'unknown') marker.models.add(row.model)
    markers.set(key, marker)
  }

  return [...markers.entries()]
    .map(([key, marker]) => ({
      key,
      topPct: marker.topPct,
      count: marker.count,
      observedAt: marker.observedAt,
      classes: [...marker.classes].sort(),
      models: [...marker.models].sort(),
    }))
    .sort(
      (left, right) =>
        (parseDateMs(right.observedAt) ?? 0) -
        (parseDateMs(left.observedAt) ?? 0)
    )
}

type WeightedSample = {
  value: number
  weight: number
}

type HealthModelAccumulator = {
  model: string
  requests: number
  providerErrors: number
  upstreamP95Samples: WeightedSample[]
}

type ProviderHealthAccumulator = {
  provider: string
  color: string
  requests: number
  providerErrors: number
  rateLimitEvents: number
  capacityEvents: number
  networkEvents: number
  authFailedEvents: number
  adapterErrorEvents: number
  statusProbeCount: number
  latestBucketStart: string | null
  upstreamP95Samples: WeightedSample[]
  totalP95Samples: WeightedSample[]
  probeSuccessSamples: WeightedSample[]
  pingSamples: WeightedSample[]
  controlPingSamples: WeightedSample[]
  providerPingDeltaSamples: WeightedSample[]
  packetLossSamples: WeightedSample[]
  controlPacketLossSamples: WeightedSample[]
  controlProbeSuccessSamples: WeightedSample[]
  attributionCounts: HealthAttributionCounts
  probeBuckets: Set<string>
  models: Map<string, HealthModelAccumulator>
}

function buildProviderHealthMetrics(
  rows: UsageReportProviderLatencyHealthRow[]
): ProviderHealthMetrics {
  const providerTotals = new Map<string, number>()
  for (const row of rows) {
    providerTotals.set(
      row.provider,
      (providerTotals.get(row.provider) ?? 0) + row.requests
    )
  }
  const providers = [...providerTotals.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([provider]) => provider)
  const providerKeys = new Map(
    providers.map((provider, index) => [provider, `health_provider_${index}`])
  )
  const summaries = new Map<string, ProviderHealthAccumulator>()
  const trendAccumulators = new Map<string, WeightedSample[]>()
  const controlBuckets = new Set<string>()
  const controlPingSamples: WeightedSample[] = []
  const controlPacketLossSamples: WeightedSample[] = []
  const controlProbeSuccessSamples: WeightedSample[] = []
  const providerPingDeltaSamples: WeightedSample[] = []
  let latestBucketStart: string | null = null

  for (const row of rows) {
    const provider = row.provider || 'unknown'
    const color = providerColorFor(provider)
    const summary =
      summaries.get(provider) ??
      ({
        provider,
        color,
        requests: 0,
        providerErrors: 0,
        rateLimitEvents: 0,
        capacityEvents: 0,
        networkEvents: 0,
        authFailedEvents: 0,
        adapterErrorEvents: 0,
        statusProbeCount: 0,
        latestBucketStart: null,
        upstreamP95Samples: [],
        totalP95Samples: [],
        probeSuccessSamples: [],
        pingSamples: [],
        controlPingSamples: [],
        providerPingDeltaSamples: [],
        packetLossSamples: [],
        controlPacketLossSamples: [],
        controlProbeSuccessSamples: [],
        attributionCounts: emptyHealthAttributionCounts(),
        probeBuckets: new Set<string>(),
        models: new Map<string, HealthModelAccumulator>(),
      } satisfies ProviderHealthAccumulator)

    summary.requests += row.requests
    summary.providerErrors += row.provider_error_events
    summary.rateLimitEvents += row.rate_limit_events
    summary.capacityEvents += row.capacity_events
    summary.networkEvents +=
      row.network_error_events +
      row.dns_failures +
      row.tcp_failures +
      row.tls_failures +
      row.icmp_failures
    summary.authFailedEvents += row.auth_failed_events
    summary.adapterErrorEvents += row.adapter_error_events
    summary.latestBucketStart = latestIso(
      summary.latestBucketStart,
      row.bucket_start
    )
    latestBucketStart = latestIso(latestBucketStart, row.bucket_start)

    const weight = Math.max(row.requests, 1)
    addWeightedSample(summary.upstreamP95Samples, row.upstream_p95_ms, weight)
    addWeightedSample(summary.totalP95Samples, row.total_p95_ms, weight)
    incrementHealthAttributionCount(
      summary.attributionCounts,
      classifyHealthRow(row, quotaHealthLatencyMs(row)).layer
    )

    const controlKey = `${row.environment}:${row.bucket_start ?? 'unknown'}`
    if (!controlBuckets.has(controlKey)) {
      controlBuckets.add(controlKey)
      addWeightedSample(controlPingSamples, row.control_ping_avg_ms, 1)
      addWeightedSample(
        controlPacketLossSamples,
        row.control_packet_loss_pct,
        1
      )
      addWeightedSample(
        controlProbeSuccessSamples,
        row.control_probe_success_pct,
        1
      )
    }

    const probeKey = `${provider}:${row.bucket_start ?? 'unknown'}`
    if (!summary.probeBuckets.has(probeKey)) {
      summary.probeBuckets.add(probeKey)
      summary.statusProbeCount += row.status_probe_count
      addWeightedSample(
        summary.probeSuccessSamples,
        row.status_probe_success_pct,
        Math.max(row.status_probe_count, 1)
      )
      addWeightedSample(summary.pingSamples, row.provider_ping_avg_ms, 1)
      addWeightedSample(summary.controlPingSamples, row.control_ping_avg_ms, 1)
      addWeightedSample(
        summary.providerPingDeltaSamples,
        row.provider_ping_minus_control_ms,
        1
      )
      addWeightedSample(
        providerPingDeltaSamples,
        row.provider_ping_minus_control_ms,
        1
      )
      addWeightedSample(
        summary.packetLossSamples,
        row.provider_ping_packet_loss_pct,
        1
      )
      addWeightedSample(
        summary.controlPacketLossSamples,
        row.control_packet_loss_pct,
        1
      )
      addWeightedSample(
        summary.controlProbeSuccessSamples,
        row.control_probe_success_pct,
        1
      )
    }

    if (row.upstream_p95_ms !== null && row.bucket_start) {
      const providerKey = providerKeys.get(provider)
      if (providerKey) {
        const trendKey = `${formatBucket(row.bucket_start)}:${providerKey}`
        const samples = trendAccumulators.get(trendKey) ?? []
        addWeightedSample(samples, row.upstream_p95_ms, weight)
        trendAccumulators.set(trendKey, samples)
      }
    }

    if (row.model !== 'unknown' || row.requests > 0) {
      const model =
        summary.models.get(row.model) ??
        ({
          model: row.model,
          requests: 0,
          providerErrors: 0,
          upstreamP95Samples: [],
        } satisfies HealthModelAccumulator)
      model.requests += row.requests
      model.providerErrors += row.provider_error_events
      addWeightedSample(model.upstreamP95Samples, row.upstream_p95_ms, weight)
      summary.models.set(row.model, model)
    }

    summaries.set(provider, summary)
  }

  const series: HealthTrendSeries[] = providers.map((provider) => ({
    provider,
    key: providerKeys.get(provider) ?? provider,
    color: providerColorFor(provider),
  }))
  const trendRowsByBucket = new Map<string, HealthTrendChartRow>()
  for (const [key, samples] of trendAccumulators) {
    const [bucket, providerKey] = splitTrendKey(key)
    const row =
      trendRowsByBucket.get(bucket) ??
      ({
        bucket,
      } as HealthTrendChartRow)
    row[providerKey] = weightedAverage(samples)
    trendRowsByBucket.set(bucket, row)
  }

  const providerSummaries = [...summaries.values()]
    .map((summary) => ({
      provider: summary.provider,
      color: summary.color,
      requests: summary.requests,
      providerErrors: summary.providerErrors,
      rateLimitEvents: summary.rateLimitEvents,
      capacityEvents: summary.capacityEvents,
      networkEvents: summary.networkEvents,
      authFailedEvents: summary.authFailedEvents,
      adapterErrorEvents: summary.adapterErrorEvents,
      statusProbeCount: summary.statusProbeCount,
      statusProbeSuccessPct: weightedAverage(summary.probeSuccessSamples),
      upstreamP95Ms: weightedAverage(summary.upstreamP95Samples),
      totalP95Ms: weightedAverage(summary.totalP95Samples),
      providerPingAvgMs: weightedAverage(summary.pingSamples),
      controlPingAvgMs: weightedAverage(summary.controlPingSamples),
      providerPingDeltaMs: weightedAverage(summary.providerPingDeltaSamples),
      packetLossPct: weightedAverage(summary.packetLossSamples),
      controlPacketLossPct: weightedAverage(summary.controlPacketLossSamples),
      controlProbeSuccessPct: weightedAverage(
        summary.controlProbeSuccessSamples
      ),
      attributionCounts: summary.attributionCounts,
      dominantAttribution: dominantHealthAttribution(summary.attributionCounts),
      latestBucketStart: summary.latestBucketStart,
      models: [...summary.models.values()]
        .map((model) => ({
          model: model.model,
          requests: model.requests,
          upstreamP95Ms: weightedAverage(model.upstreamP95Samples),
          providerErrors: model.providerErrors,
        }))
        .sort((left, right) => right.requests - left.requests)
        .slice(0, 4),
    }))
    .sort(
      (left, right) =>
        providerQuotaSortRank(left.provider) -
          providerQuotaSortRank(right.provider) ||
        right.requests - left.requests
    )

  return {
    latestBucketStart,
    totalRequests: providerSummaries.reduce(
      (total, summary) => total + summary.requests,
      0
    ),
    providerErrors: providerSummaries.reduce(
      (total, summary) => total + summary.providerErrors,
      0
    ),
    rateLimitEvents: providerSummaries.reduce(
      (total, summary) => total + summary.rateLimitEvents,
      0
    ),
    controlPingAvgMs: weightedAverage(controlPingSamples),
    providerPingDeltaMs: weightedAverage(providerPingDeltaSamples),
    controlPacketLossPct: weightedAverage(controlPacketLossSamples),
    controlProbeSuccessPct: weightedAverage(controlProbeSuccessSamples),
    rows: [...trendRowsByBucket.values()].sort((left, right) =>
      left.bucket.localeCompare(right.bucket)
    ),
    series,
    summaries: providerSummaries,
  }
}

function addWeightedSample(
  samples: WeightedSample[],
  value: number | null,
  weight: number
) {
  if (value === null || !Number.isFinite(value)) return
  samples.push({ value, weight: Math.max(weight, 1) })
}

function weightedAverage(samples: WeightedSample[]) {
  if (!samples.length) return null
  const totalWeight = samples.reduce(
    (total, sample) => total + sample.weight,
    0
  )
  if (!totalWeight) return null
  return (
    samples.reduce((total, sample) => total + sample.value * sample.weight, 0) /
    totalWeight
  )
}

function parseDateMs(value: string | null | undefined) {
  if (!value) return null
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

function quotaHealthLatencyMs(row: UsageReportProviderLatencyHealthRow) {
  return (
    row.upstream_p95_ms ??
    row.total_p95_ms ??
    row.status_probe_p95_ms ??
    row.provider_ping_avg_ms
  )
}

function classifyHealthRow(
  row: UsageReportProviderLatencyHealthRow,
  latencyMs: number | null
): HealthAttribution {
  const controlIssue = controlNetworkSeverity(row)
  if (controlIssue.severity !== 'good') {
    return {
      layer: 'control',
      severity: controlIssue.severity,
      label: healthAttributionLayerLabel('control'),
      detail: controlIssue.detail,
    }
  }

  const providerPathIssue = providerPathSeverity(row)
  if (providerPathIssue.severity !== 'good') {
    return {
      layer: 'provider_path',
      severity: providerPathIssue.severity,
      label: healthAttributionLayerLabel('provider_path'),
      detail: providerPathIssue.detail,
    }
  }

  if (
    row.provider_error_events > 0 ||
    row.provider_5xx_events > 0 ||
    row.provider_timeout_events > 0 ||
    row.network_error_events > 0 ||
    row.auth_failed_events > 0 ||
    (row.status_probe_success_pct !== null && row.status_probe_success_pct < 90)
  ) {
    return {
      layer: 'provider_api',
      severity: 'bad',
      label: healthAttributionLayerLabel('provider_api'),
      detail: providerApiDetail(row),
    }
  }

  if (
    row.rate_limit_events > 0 ||
    row.capacity_events > 0 ||
    row.adapter_error_events > 0 ||
    (row.status_probe_success_pct !== null && row.status_probe_success_pct < 99)
  ) {
    return {
      layer: 'provider_api',
      severity: 'warn',
      label: healthAttributionLayerLabel('provider_api'),
      detail: providerApiDetail(row),
    }
  }

  if (latencyMs !== null && latencyMs >= 90_000) {
    return {
      layer: 'workload',
      severity: 'bad',
      label: healthAttributionLayerLabel('workload'),
      detail: `Upstream p95 ${formatDurationMs(latencyMs)} with normal control and provider path probes`,
    }
  }

  if (latencyMs !== null && latencyMs >= 30_000) {
    return {
      layer: 'workload',
      severity: 'warn',
      label: healthAttributionLayerLabel('workload'),
      detail: `Upstream p95 ${formatDurationMs(latencyMs)} with normal control and provider path probes`,
    }
  }

  if (latencyMs === null) {
    return {
      layer: 'unknown',
      severity: 'unknown',
      label: healthAttributionLayerLabel('unknown'),
      detail: 'No latency sample for this bucket',
    }
  }

  return {
    layer: 'normal',
    severity: 'good',
    label: healthAttributionLayerLabel('normal'),
    detail: 'Control, provider path, and upstream probes are normal',
  }
}

function controlNetworkSeverity(row: UsageReportProviderLatencyHealthRow) {
  const parts = [
    row.control_ping_avg_ms !== null
      ? `control ${formatDurationMs(row.control_ping_avg_ms)}`
      : null,
    row.control_packet_loss_pct !== null
      ? `${formatPercent(row.control_packet_loss_pct)} control loss`
      : null,
    row.control_probe_success_pct !== null
      ? `${formatPercent(row.control_probe_success_pct)} control probe`
      : null,
  ].filter(Boolean)

  if (
    (row.control_ping_avg_ms !== null && row.control_ping_avg_ms >= 1_000) ||
    (row.control_packet_loss_pct !== null &&
      row.control_packet_loss_pct >= 10) ||
    (row.control_probe_success_pct !== null &&
      row.control_probe_success_pct < 90)
  ) {
    return {
      severity: 'bad' as const,
      detail: `General network degraded (${parts.join(', ') || 'control probe failed'})`,
    }
  }

  if (
    (row.control_ping_avg_ms !== null && row.control_ping_avg_ms >= 250) ||
    (row.control_packet_loss_pct !== null && row.control_packet_loss_pct > 0) ||
    (row.control_probe_success_pct !== null &&
      row.control_probe_success_pct < 99)
  ) {
    return {
      severity: 'warn' as const,
      detail: `General network elevated (${parts.join(', ') || 'control probe elevated'})`,
    }
  }

  return { severity: 'good' as const, detail: 'Control probe normal' }
}

function providerPathSeverity(row: UsageReportProviderLatencyHealthRow) {
  const parts = [
    row.provider_ping_minus_control_ms !== null
      ? `${formatSignedDurationMs(row.provider_ping_minus_control_ms)} vs control`
      : null,
    row.provider_ping_packet_loss_pct !== null
      ? `${formatPercent(row.provider_ping_packet_loss_pct)} provider loss`
      : null,
  ].filter(Boolean)

  if (
    (row.provider_ping_minus_control_ms !== null &&
      row.provider_ping_minus_control_ms >= 1_000) ||
    (row.provider_ping_packet_loss_pct !== null &&
      row.provider_ping_packet_loss_pct >= 10)
  ) {
    return {
      severity: 'bad' as const,
      detail: `Provider path degraded (${parts.join(', ') || 'provider path probe failed'})`,
    }
  }

  if (
    (row.provider_ping_minus_control_ms !== null &&
      row.provider_ping_minus_control_ms >= 250) ||
    (row.provider_ping_packet_loss_pct !== null &&
      row.provider_ping_packet_loss_pct > 0)
  ) {
    return {
      severity: 'warn' as const,
      detail: `Provider path elevated (${parts.join(', ') || 'provider path elevated'})`,
    }
  }

  return { severity: 'good' as const, detail: 'Provider path normal' }
}

function providerApiDetail(row: UsageReportProviderLatencyHealthRow) {
  const events = [
    row.provider_error_events > 0
      ? `${formatNumber(row.provider_error_events)} provider errors`
      : null,
    row.provider_5xx_events > 0
      ? `${formatNumber(row.provider_5xx_events)} 5xx`
      : null,
    row.provider_timeout_events > 0
      ? `${formatNumber(row.provider_timeout_events)} timeouts`
      : null,
    row.rate_limit_events > 0
      ? `${formatNumber(row.rate_limit_events)} rate limits`
      : null,
    row.capacity_events > 0
      ? `${formatNumber(row.capacity_events)} capacity`
      : null,
    row.adapter_error_events > 0
      ? `${formatNumber(row.adapter_error_events)} adapter`
      : null,
    row.status_probe_success_pct !== null
      ? `${formatPercent(row.status_probe_success_pct)} status probe`
      : null,
  ].filter(Boolean)

  return events.length
    ? events.join(', ')
    : 'Provider API/status probe degraded'
}

function worstQuotaHealthSeverity(
  left: QuotaHealthSeverity,
  right: QuotaHealthSeverity
): QuotaHealthSeverity {
  return quotaHealthSeverityRank(right) > quotaHealthSeverityRank(left)
    ? right
    : left
}

function quotaHealthSeverityRank(severity: QuotaHealthSeverity) {
  if (severity === 'bad') return 3
  if (severity === 'warn') return 2
  if (severity === 'good') return 1
  return 0
}

function emptyHealthAttributionCounts(): HealthAttributionCounts {
  return {
    normal: 0,
    control: 0,
    provider_path: 0,
    provider_api: 0,
    workload: 0,
    unknown: 0,
  }
}

function incrementHealthAttributionCount(
  counts: HealthAttributionCounts,
  layer: HealthAttributionLayer
) {
  counts[layer] += 1
  return counts
}

function dominantHealthAttribution(counts: HealthAttributionCounts) {
  return healthAttributionDisplayOrder.reduce(
    (dominant, layer) => {
      const count = counts[layer] ?? 0
      if (count > dominant.count) return { layer, count }
      return dominant
    },
    { layer: 'unknown' as HealthAttributionLayer, count: 0 }
  ).layer
}

function healthAttributionLayerLabel(layer: HealthAttributionLayer) {
  if (layer === 'control') return 'Network'
  if (layer === 'provider_path') return 'Provider path'
  if (layer === 'provider_api') return 'Provider API'
  if (layer === 'workload') return 'Workload'
  if (layer === 'normal') return 'Normal'
  return 'Unknown'
}

function quotaHealthSeverityColor(severity: QuotaHealthSeverity) {
  if (severity === 'bad') return '#dc2626'
  if (severity === 'warn') return '#eab308'
  if (severity === 'good') return '#16a34a'
  return '#cbd5e1'
}

function quotaHealthSeverityLabel(severity: QuotaHealthSeverity) {
  if (severity === 'bad') return 'High latency'
  if (severity === 'warn') return 'Elevated latency'
  if (severity === 'good') return 'Normal latency'
  return 'No latency sample'
}

function quotaHealthAriaLabel(overlay: QuotaHealthOverlay) {
  const attribution = overlay.latestAttribution
    ? `, likely cause ${overlay.latestAttribution.label}`
    : ''
  return `${overlay.label} latency timeline, ${overlay.sampleCount} health buckets, ${overlay.providerErrorCount} provider errors, worst band ${quotaHealthSeverityLabel(overlay.worstSeverity)}${attribution}, control ping ${formatDurationMs(overlay.latestControlPingMs)}, provider delta ${formatSignedDurationMs(overlay.latestProviderPingDeltaMs)}`
}

function providerMatchesQuota(actualProvider: string, quotaProvider: string) {
  const actual = providerColorKey(actualProvider)
  const expected = providerColorKey(quotaProvider)
  return expected === 'google' ? actual === 'google' : actual === expected
}

function quotaModelMatches(
  model: string | null,
  modelGroup: string | null,
  modelMatches: (model: string) => boolean
) {
  return (
    modelMatches(model ?? 'unknown') || modelMatches(modelGroup ?? 'unknown')
  )
}

function isSparkModel(model: string) {
  return model.toLowerCase().includes('spark')
}

function isSonnetModel(model: string) {
  return model.toLowerCase().includes('sonnet')
}

function latestIso(left: string | null, right: string | null) {
  if (!right) return left
  if (!left) return right
  return new Date(right).getTime() > new Date(left).getTime() ? right : left
}

function splitTrendKey(key: string): [string, string] {
  const separator = key.lastIndexOf(':')
  return [key.slice(0, separator), key.slice(separator + 1)]
}

function canonicalClientName(client: string) {
  const normalized = client
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
  if (normalized === 'claude-cli' || normalized === 'claude-code') {
    return 'Claude'
  }
  if (normalized === 'codex-exec' || normalized === 'codex-tui') {
    return 'Codex'
  }
  if (normalized === 'gemini' || normalized === 'gemini-cli') {
    return 'Gemini'
  }
  return client
}

function sortClientVersions(versions: ClientVersionBreakdown[]) {
  return versions.sort((left, right) => {
    const byFirstSeen =
      (parseDateMs(right.firstSeenAt) ?? 0) -
      (parseDateMs(left.firstSeenAt) ?? 0)
    if (byFirstSeen !== 0) return byFirstSeen
    return right.tokens - left.tokens
  })
}

function earliestIso(left: string | null, right: string | null) {
  if (!right) return left
  if (!left) return right
  return new Date(right).getTime() < new Date(left).getTime() ? right : left
}

function clientVersionLabel(item: ClientVersionBreakdown) {
  return `${item.client} [${item.version}]`
}

function quotaFreshnessLabel(row: UsageReportQuotaRow) {
  const active = providerActiveCount(row)
  return active ? `${active} active` : 'Latest only'
}

function providerActiveCount(row: UsageReportQuotaRow) {
  return [
    row.weekly_active,
    row.short_active,
    row.special_active,
    row.short_special_active,
  ].filter(Boolean).length
}

function googleQuotaFreshnessLabel(
  rows: Map<GoogleQuotaClass, UsageReportQuotaRow>
) {
  const active = [...rows.values()].filter((row) => row.short_active).length
  return active ? `${active} active` : 'Latest only'
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
    quotaPercentSortValue(left.short_remaining_pct) -
    quotaPercentSortValue(right.short_remaining_pct)
  )
}

function quotaPercentSortValue(value: number | null) {
  return value ?? Number.POSITIVE_INFINITY
}

function shouldShowShortSpecialQuota(row: UsageReportQuotaRow) {
  return (
    row.provider.toLowerCase() === 'openai' ||
    row.short_special_remaining_pct !== null ||
    row.short_special_reset_at !== null
  )
}

function specialQuotaLabel(provider: string) {
  const normalized = provider.toLowerCase()
  if (normalized === 'anthropic') return 'Sonnet'
  if (normalized === 'openai') return 'Spark Weekly'
  return 'Special'
}

function shortQuotaLabel(provider: string) {
  const normalized = provider.toLowerCase()
  return normalized === 'anthropic' || normalized === 'openai'
    ? '5-Hour'
    : 'Short'
}

function shortSpecialQuotaLabel(provider: string) {
  return provider.toLowerCase() === 'openai' ? 'Spark 5-Hour' : 'Short special'
}

function formatProviderQuotaTitle(row: UsageReportQuotaRow) {
  const provider = providerDisplayName(row.provider)
  return row.model ? `${provider} / ${row.model}` : provider
}

function providerDisplayName(provider: string) {
  const normalized = provider.toLowerCase()
  if (normalized === 'openai') return 'OpenAI'
  if (normalized === 'anthropic') return 'Anthropic'
  if (normalized === 'google' || normalized === 'gemini') return 'Gemini'
  if (normalized === 'xai' || normalized === 'x.ai') return 'xAI'
  if (normalized === 'openrouter' || normalized === 'open-router') {
    return 'OpenRouter'
  }
  if (normalized === 'local' || normalized.startsWith('local_')) {
    return 'Local'
  }
  if (normalized === 'nvidia_nim') return 'NVIDIA NIM'
  if (normalized === 'chatgpt') return 'ChatGPT'
  return provider
}

function mergeQuotaUsage(
  current: QuotaUsageSummary | undefined,
  next: QuotaUsageSummary
) {
  const mergedBreakdown = new Map<string, UsageReportQuotaUsageBreakdown>()
  for (const item of [...(current?.breakdown ?? []), ...next.breakdown]) {
    const existing = mergedBreakdown.get(item.model)
    if (existing) {
      existing.tokens += item.tokens
      existing.cost += item.cost
      existing.traces += item.traces
    } else {
      mergedBreakdown.set(item.model, { ...item })
    }
  }

  return {
    tokens: (current?.tokens ?? 0) + next.tokens,
    breakdown: [...mergedBreakdown.values()].sort(
      (left, right) => right.tokens - left.tokens
    ),
  }
}

function formatBucket(value: string | null) {
  if (!value) return 'n/a'
  return value.slice(0, 10)
}

function formatDateRange(from: string, to: string) {
  return `${from} to ${to}`
}

function formatRecordWindow(
  summary: UsageReportResponse['summary'] | undefined
) {
  if (!summary?.period_start || !summary.period_end) return 'No records'
  return `${formatBucket(summary.period_start)} to ${formatBucket(summary.period_end)}`
}

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return 'n/a'
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(value)
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'n/a'
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatShortDateTime(value: string | null | undefined) {
  if (!value) return 'n/a'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function nextLocalMidnightIso(now = new Date()) {
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    0,
    0
  ).toISOString()
}

function formatDurationMs(value: number | null | undefined) {
  if (value === null || value === undefined) return 'n/a'
  if (value >= 1000) {
    return `${new Intl.NumberFormat('en-US', {
      maximumFractionDigits: 1,
    }).format(value / 1000)}s`
  }
  return `${new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(value)}ms`
}

function formatSignedDurationMs(value: number | null | undefined) {
  if (value === null || value === undefined) return 'n/a'
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}${formatDurationMs(Math.abs(value))}`
}

function formatAge(minutes: number) {
  if (minutes < 60) return `${formatNumber(minutes)} minutes`
  const hours = minutes / 60
  if (hours < 48) {
    return `${new Intl.NumberFormat('en-US', {
      maximumFractionDigits: 1,
    }).format(hours)} hours`
  }
  return `${new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 1,
  }).format(hours / 24)} days`
}
