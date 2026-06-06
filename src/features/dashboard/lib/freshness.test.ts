import { describe, expect, test } from 'vitest'
import type {
  ShellHealthResponse,
  UsageReportResponse,
} from '../api/usage-report'
import {
  formatDashboardFreshness,
  latestSourceTableTimestamp,
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
