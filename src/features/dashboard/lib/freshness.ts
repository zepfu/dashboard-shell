import { formatDistance } from 'date-fns'
import type {
  ShellHealthResponse,
  UsageReportResponse,
} from '../api/usage-report'

function parseTimestampMs(value: string | null | undefined): number | null {
  if (value == null || value === '') return null
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : null
}

export function maxIsoTimestamp(
  values: Array<string | null | undefined>
): string | null {
  let maxMs: number | null = null
  for (const value of values) {
    const time = parseTimestampMs(value)
    if (time === null) continue
    if (maxMs === null || time > maxMs) maxMs = time
  }
  return maxMs === null ? null : new Date(maxMs).toISOString()
}

export function latestSourceTableTimestamp(
  health: ShellHealthResponse | undefined,
  tableName: string
): string | null {
  const table = health?.sourceTables?.tables.find(
    (row) => row.tableName === tableName
  )
  if (table === undefined) return null
  return maxIsoTimestamp([
    table.latestDataAt,
    table.latestEventAt,
    table.latestPersistedAt,
  ])
}

export function selectSessionFreshnessTimestamp(
  health: ShellHealthResponse | undefined,
  report: UsageReportResponse | undefined
): string | null {
  return (
    latestSourceTableTimestamp(health, 'session_history') ??
    report?.metadata?.latestRecordAt ??
    report?.summary?.latest_record_at ??
    null
  )
}

export function formatDashboardFreshness(
  sessionFreshnessAt: string | null,
  dataUpdatedAt: number,
  now: Date
): string {
  if (dataUpdatedAt === 0 && sessionFreshnessAt === null) {
    return 'Loading…'
  }

  const displayDate =
    sessionFreshnessAt !== null
      ? new Date(sessionFreshnessAt)
      : new Date(dataUpdatedAt)
  const timeUTC = displayDate.toUTCString().split(' ')[4] ?? ''
  const distance = formatDistance(displayDate, now, { addSuffix: false })
  return `FETCHED ${timeUTC} UTC · ${distance} ago`
}

export function formatRecencyValue(iso: string | null, now: Date): string {
  if (iso === null) return '--'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '--'
  const timeUTC = date.toUTCString().split(' ')[4] ?? ''
  const distance = formatDistance(date, now, { addSuffix: false })
  return `${timeUTC} UTC / ${distance} ago`
}
