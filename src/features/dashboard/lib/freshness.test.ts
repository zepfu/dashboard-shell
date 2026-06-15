import { describe, expect, test } from 'vitest'
import type {
  ShellHealthResponse,
  UsageReportResponse,
} from '../api/usage-report'
import {
  formatDashboardFreshness,
  formatRecencyValue,
  latestSourceTableTimestamp,
  maxIsoTimestamp,
  selectSessionFreshnessTimestamp,
} from './freshness'

function makeHealth(
  latestDataAt: string | null,
  latestEventAt: string | null
): ShellHealthResponse {
  return {
    ok: true,
    sourceTables: {
      status: 'ok',
      checkedAt: '2026-06-06T18:00:00.000Z',
      tables: [
        {
          tableName: 'session_history',
          status: 'ok',
          latestDataAt,
          latestEventAt,
        },
      ],
    },
  }
}

function makeReport(latestRecordAt: string): UsageReportResponse {
  return {
    metadata: { latestRecordAt },
    summary: { latest_record_at: latestRecordAt },
  } as UsageReportResponse
}

describe('dashboard freshness helpers', () => {
  test('test_latestSourceTableTimestamp_uses_newest_session_history_timestamp', () => {
    expect(
      latestSourceTableTimestamp(
        makeHealth('2026-06-06T18:00:46.114Z', '2026-06-06T18:00:32.402Z'),
        'session_history'
      )
    ).toBe('2026-06-06T18:00:46.114Z')

    expect(
      latestSourceTableTimestamp(
        makeHealth('2026-06-06T18:00:32.402Z', '2026-06-06T18:00:46.114Z'),
        'session_history'
      )
    ).toBe('2026-06-06T18:00:46.114Z')
  })

  test('test_selectSessionFreshnessTimestamp_prefers_health_over_usage_metadata', () => {
    const report = makeReport('2026-06-06T13:00:00.000Z')
    const health = makeHealth(
      '2026-06-06T18:00:46.114Z',
      '2026-06-06T18:00:32.402Z'
    )

    expect(selectSessionFreshnessTimestamp(health, report)).toBe(
      '2026-06-06T18:00:46.114Z'
    )
  })

  test('test_selectSessionFreshnessTimestamp_falls_back_to_usage_metadata', () => {
    expect(
      selectSessionFreshnessTimestamp(
        undefined,
        makeReport('2026-06-06T13:00:00.000Z')
      )
    ).toBe('2026-06-06T13:00:00.000Z')
  })

  test('test_formatDashboardFreshness_uses_selected_session_timestamp', () => {
    expect(
      formatDashboardFreshness(
        '2026-06-06T18:00:00.000Z',
        Date.parse('2026-06-06T13:00:00.000Z'),
        new Date('2026-06-06T18:10:00.000Z')
      )
    ).toBe('FETCHED 18:00:00 UTC · 10 minutes ago')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Wave 5 / S4-T8: freshness — formatRecencyValue, Loading branch, invalid maxIsoTimestamp
// ─────────────────────────────────────────────────────────────────────────────

/**
 * S4-T8: Coverage for three paths that lack tests:
 * 1. `formatRecencyValue` with a valid ISO → produces "HH:MM:SS UTC / N minutes ago"
 * 2. `formatDashboardFreshness` Loading branch: both inputs absent → 'Loading…'
 * 3. `maxIsoTimestamp` with an invalid/non-parseable string → skips, returns null
 *    when all inputs are invalid.
 */
describe('freshness — S4-T8 additional coverage', () => {
  test('test_formatRecencyValue_valid_iso_returns_utc_and_distance', () => {
    const iso = '2026-06-13T14:30:00.000Z'
    const now = new Date('2026-06-13T14:45:00.000Z') // 15 minutes later
    const result = formatRecencyValue(iso, now)

    // Must include the UTC time component
    expect(result).toContain('UTC')
    // Must not be the sentinel '--'
    expect(result).not.toBe('--')
    // Must contain the time "14:30:00"
    expect(result).toContain('14:30:00')
    // Must mention minutes
    expect(result).toContain('minutes')
  })

  test('test_formatRecencyValue_null_returns_double_dash', () => {
    expect(formatRecencyValue(null, new Date())).toBe('--')
  })

  test('test_formatRecencyValue_invalid_iso_returns_double_dash', () => {
    // 'not-a-date' → new Date('not-a-date').getTime() === NaN
    const result = formatRecencyValue('not-a-date', new Date())
    expect(result).toBe('--')
  })

  test('test_formatDashboardFreshness_loading_branch_when_both_absent', () => {
    // dataUpdatedAt=0 and sessionFreshnessAt=null → 'Loading…'
    const result = formatDashboardFreshness(null, 0, new Date())
    expect(result).toBe('Loading…')
  })

  test('test_maxIsoTimestamp_invalid_strings_return_null', () => {
    // All invalid timestamps → null
    const result = maxIsoTimestamp(['not-a-date', '', 'also-bad', null])
    expect(result).toBeNull()
  })

  test('test_maxIsoTimestamp_picks_latest_from_mixed_valid_invalid', () => {
    const result = maxIsoTimestamp([
      'not-a-date',
      '2026-06-13T10:00:00.000Z',
      null,
      '2026-06-13T12:00:00.000Z', // latest valid
      'garbage',
    ])
    expect(result).toBe('2026-06-13T12:00:00.000Z')
  })

  test('test_maxIsoTimestamp_all_null_returns_null', () => {
    expect(maxIsoTimestamp([null, null, undefined])).toBeNull()
  })
})
