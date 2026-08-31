import { useEffect, useState, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import {
  LIVE_DASHBOARD_QUOTAS_REFETCH_INTERVAL_MS,
  fetchShellHealth,
  type UsageReportProviderLatencyHealthRow,
  type UsageReportQuotaRow,
  type UsageReportResponse,
} from '../api/usage-report'
import {
  formatDashboardFreshness,
  formatRecencyValue,
  maxIsoTimestamp,
  selectSessionFreshnessTimestamp,
} from '../lib/freshness'

const RECENCY_CLOCK_INTERVAL_MS = 10_000

interface DashboardRecencyClockProps {
  report?: UsageReportResponse
  reportLatencyHealth?: readonly UsageReportProviderLatencyHealthRow[]
  quotaRows: readonly UsageReportQuotaRow[]
  dataUpdatedAt: number
  summaryFetching: boolean
  onRefreshReport: () => Promise<unknown> | unknown
}

function useShellSessionFreshness(
  report: UsageReportResponse | undefined
): string | null {
  const { data: shellHealthData } = useQuery({
    queryKey: ['shell-health-pgbouncer'],
    queryFn: ({ signal }) => fetchShellHealth(signal),
    staleTime: 15_000,
    refetchInterval: LIVE_DASHBOARD_QUOTAS_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  })

  return selectSessionFreshnessTimestamp(shellHealthData, report)
}

function DashboardRecencyClockRefreshButton({
  summaryFetching,
  onRefreshReport,
}: {
  summaryFetching: boolean
  onRefreshReport: () => Promise<unknown> | unknown
}): ReactElement {
  const handleClick = () => {
    void onRefreshReport()
  }

  return (
    <button
      type='button'
      className='section-refresh-button freshness-refresh-button'
      aria-label='Force refresh dashboard data'
      title='Force refresh dashboard data'
      disabled={summaryFetching}
      onClick={handleClick}
    >
      <RefreshCw
        aria-hidden='true'
        className={
          summaryFetching
            ? 'section-refresh-icon is-updating'
            : 'section-refresh-icon'
        }
        size={12}
        strokeWidth={1.8}
      />
      <span className='section-refresh-status'>
        {summaryFetching ? 'Updating' : 'Refresh'}
      </span>
    </button>
  )
}

function latestQuotaObservationAt(
  rows: readonly UsageReportQuotaRow[]
): string | null {
  return maxIsoTimestamp(
    rows.flatMap((row) => [
      row.weekly_interval_start,
      row.short_interval_start,
      row.special_interval_start,
      row.short_special_interval_start,
      row.monthly_interval_start,
    ])
  )
}

function latestHealthBucketAt(
  rows: readonly UsageReportProviderLatencyHealthRow[]
): string | null {
  return maxIsoTimestamp(rows.map((row) => row.bucket_start))
}

export function DashboardRecencyClock({
  report,
  reportLatencyHealth,
  quotaRows,
  dataUpdatedAt,
  summaryFetching,
  onRefreshReport,
}: DashboardRecencyClockProps): ReactElement {
  const [now, setNow] = useState(() => new Date())
  const sessionFreshnessAt = useShellSessionFreshness(report)

  useEffect(() => {
    const id = setInterval(() => {
      setNow(new Date())
    }, RECENCY_CLOCK_INTERVAL_MS)
    return () => {
      clearInterval(id)
    }
  }, [])

  const healthRows = reportLatencyHealth ?? []
  const freshnessText = formatDashboardFreshness(
    sessionFreshnessAt,
    dataUpdatedAt,
    now
  )
  const recencyBreakout = [
    {
      label: 'Session',
      value: formatRecencyValue(sessionFreshnessAt, now),
    },
    {
      label: 'Quota',
      value: formatRecencyValue(latestQuotaObservationAt(quotaRows), now),
    },
    {
      label: 'Health',
      value: formatRecencyValue(latestHealthBucketAt(healthRows), now),
    },
  ]

  return (
    <>
      <span
        className='freshness-indicator'
        style={{
          fontSize: '9px',
          color: 'var(--fg-muted)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
        }}
      >
        <span className='pulse-dot' />
        {freshnessText}
      </span>
      <DashboardRecencyClockRefreshButton
        summaryFetching={summaryFetching}
        onRefreshReport={onRefreshReport}
      />
      <span className='freshness-breakout' aria-label='Underlying data recency'>
        {recencyBreakout.map((item) => (
          <span className='freshness-breakout-item' key={item.label}>
            <span className='freshness-breakout-label'>{item.label}</span>
            <span className='freshness-breakout-value'>{item.value}</span>
          </span>
        ))}
      </span>
    </>
  )
}
