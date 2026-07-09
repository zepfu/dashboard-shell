/**
 * D1-451 Wave 4 — shared status-formatters module (engineer extracts from panels).
 * RED: module does not exist until Engineer 4A lands lib/status-formatters.ts.
 */
import { describe, expect, test } from 'vitest'
import {
  formatCompactQuantity,
  formatRemainingSeconds,
  formatStatusTimestamp,
} from './status-formatters'
import { formatDashboardTime } from './usage-report-display'

describe('D1-451 status-formatters — formatRemainingSeconds (C2)', () => {
  test('test_formatRemainingSeconds_10h_uses_hours_tier_not_600m', () => {
    const tenHours = 10 * 60 * 60
    expect(formatRemainingSeconds(tenHours)).toMatch(/10h/)
    expect(formatRemainingSeconds(tenHours)).not.toMatch(/600m/)
  })

  test('test_formatRemainingSeconds_floors_fractional_seconds', () => {
    expect(formatRemainingSeconds(90.5)).toBe('1m 30s')
  })

  test('test_formatRemainingSeconds_null_placeholder_consistent', () => {
    expect(formatRemainingSeconds(null)).toBe('n/a')
    expect(formatRemainingSeconds(undefined)).toBe('n/a')
  })
})

describe('D1-451 status-formatters — formatStatusTimestamp (I3)', () => {
  test('test_formatStatusTimestamp_null_uses_shared_placeholder', () => {
    expect(formatStatusTimestamp(null)).toBe('n/a')
    expect(formatStatusTimestamp(undefined)).toBe('n/a')
  })

  test('test_formatStatusTimestamp_valid_iso_truncates_to_minute', () => {
    const iso = '2026-05-20T11:30:45.000Z'
    expect(formatStatusTimestamp(iso)).toBe(formatDashboardTime(iso))
    expect(formatStatusTimestamp(iso)).toMatch(/7:30/)
  })

  test('test_status_timestamp_eastern_zone', () => {
    const iso = '2026-05-20T11:30:00Z'
    const eastern = formatDashboardTime(iso)
    expect(formatStatusTimestamp(iso)).toBe(eastern)
    expect(formatStatusTimestamp(iso)).not.toBe('2026-05-20 11:30')
    expect(eastern).toMatch(/7:30/)
  })
})

describe('D1-451 status-formatters — formatCompactQuantity (A4)', () => {
  test('test_formatCompactQuantity_compact_notation', () => {
    expect(formatCompactQuantity(1_500_000)).toMatch(/1\.5M|1,500,000/)
  })
})
