/**
 * Shared formatters for status-section panels and quota/history display.
 * D1-451 Wave 4: single home for duration, timestamp, and compact quantity (A4/C2/I3).
 */
import { formatDashboardTime } from './usage-report-display'

const FORMAT_COMPACT_QUANTITY = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

export function formatCompactQuantity(value: number): string {
  return FORMAT_COMPACT_QUANTITY.format(value)
}

const STATUS_TIMESTAMP_PLACEHOLDER = 'n/a'

export function formatStatusTimestamp(
  value: string | null | undefined
): string {
  if (value == null || value === '') return STATUS_TIMESTAMP_PLACEHOLDER
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return STATUS_TIMESTAMP_PLACEHOLDER
  const eastern = formatDashboardTime(value)
  return eastern === '--' ? STATUS_TIMESTAMP_PLACEHOLDER : eastern
}

export function formatRemainingSeconds(
  value: number | null | undefined
): string {
  if (value == null || !Number.isFinite(value))
    return STATUS_TIMESTAMP_PLACEHOLDER
  const total = Math.floor(value)
  if (total < 0) return STATUS_TIMESTAMP_PLACEHOLDER

  const hours = Math.floor(total / 3600)
  const remainderAfterHours = total % 3600
  const minutes = Math.floor(remainderAfterHours / 60)
  const seconds = remainderAfterHours % 60

  if (hours > 0) {
    const parts = [`${hours.toString()}h`]
    if (minutes > 0) parts.push(`${minutes.toString()}m`)
    if (seconds > 0) parts.push(`${seconds.toString()}s`)
    return parts.join(' ')
  }

  if (minutes > 0) {
    return `${minutes.toString()}m ${seconds.toString()}s`
  }

  return `${seconds.toString()}s`
}
