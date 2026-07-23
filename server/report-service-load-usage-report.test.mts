import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  buildUsageReportAuxiliaryDegradedMetadata,
  __usageReportTestHelpers,
} from './report-service.mjs'

const {
  loadUsageReport,
  setQueryReportDatabaseTestImpl,
  resetQueryReportDatabaseTestImpl,
  setLoadDockerLogErrorsTestImpl,
  resetLoadDockerLogErrorsTestImpl,
  setLoadLocalHealthTestImpl,
  resetLoadLocalHealthTestImpl,
} = __usageReportTestHelpers

const params = new URLSearchParams({
  from: '2026-05-01',
  to: '2026-05-08',
})

function emptyDbResult() {
  return { rows: [] }
}

function installSuccessfulCoreQueryMock() {
  setQueryReportDatabaseTestImpl(async () => emptyDbResult())
}

function usageReportTaskKey(options: unknown) {
  return typeof options === 'object' && options != null
    ? (options as { usageReportTaskKey?: string }).usageReportTaskKey
    : undefined
}

afterEach(() => {
  vi.useRealTimers()
  resetQueryReportDatabaseTestImpl()
  resetLoadDockerLogErrorsTestImpl()
  resetLoadLocalHealthTestImpl()
})

describe('D1-444 loadUsageReport optional fanout degradation', () => {
  test('test_buildUsageReportAuxiliaryDegradedMetadata_lists_unavailable_sections', () => {
    expect(buildUsageReportAuxiliaryDegradedMetadata()).toEqual({})
    expect(
      buildUsageReportAuxiliaryDegradedMetadata([
        'provider_auth_health',
        'docker_log_errors',
      ])
    ).toMatchObject({
      degraded: true,
      degradedReason: 'auxiliary_fanout_failure',
      unavailableAuxiliarySections: [
        'provider_auth_health',
        'docker_log_errors',
      ],
      degradedMessage: expect.stringContaining('provider_auth_health'),
    })
  })

  test('test_loadUsageReport_degrades_optional_auxiliary_failures_without_rejecting_report', async () => {
    installSuccessfulCoreQueryMock()
    setLoadDockerLogErrorsTestImpl(async () => {
      throw new Error('docker log scan failed')
    })
    setLoadLocalHealthTestImpl(async () => {
      throw new Error('local health probe failed')
    })
    setQueryReportDatabaseTestImpl(async (_sql: string, _values, options) => {
      if (usageReportTaskKey(options) === 'provider_alias_routing') {
        throw new Error('alias routing query failed')
      }
      return emptyDbResult()
    })

    const report = await loadUsageReport(params)

    expect(report.metadata).toMatchObject({
      degraded: true,
      degradedReason: 'auxiliary_fanout_failure',
      unavailableAuxiliarySections: expect.arrayContaining([
        'provider_alias_routing',
        'docker_log_errors',
        'local_health',
      ]),
    })
    expect(report.providerAliasRouting).toMatchObject({
      data_source: 'recent_observed_session_history',
      entries: [],
      families: expect.any(Array),
    })
    expect(report.providerAuthHealth).toMatchObject({
      data_source: 'provider_auth_current',
      entries: [],
    })
    expect(report.providerCreditLifecycle).toMatchObject({
      data_source: 'provider_credit_current',
      entries: [],
      summaries: [],
    })
    expect(report.dockerLogErrors).toEqual([])
    expect(report.localHealth).toEqual([])
    expect(report.rows).toEqual([])
    expect(report.summary).toBeDefined()
  })

  test('test_loadUsageReport_still_fails_fast_when_core_usage_query_fails', async () => {
    setQueryReportDatabaseTestImpl(async (_sql: string, _values, options) => {
      if (usageReportTaskKey(options) === 'usage_rows') {
        throw new Error('core usage query failed')
      }
      return emptyDbResult()
    })
    setLoadDockerLogErrorsTestImpl(async () => [])
    setLoadLocalHealthTestImpl(async () => [])

    await expect(loadUsageReport(params)).rejects.toThrow(
      'core usage query failed'
    )
  })

  test('test_loadUsageReport_includes_freshness_metadata_from_summary_latest_record', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-08T12:00:00.000Z'))
    setQueryReportDatabaseTestImpl(async (_sql: string, _values, options) => {
      if (usageReportTaskKey(options) === 'summary') {
        return {
          rows: [{ latest_record_at: '2026-05-08T11:56:00.000Z' }],
        }
      }
      return emptyDbResult()
    })
    setLoadDockerLogErrorsTestImpl(async () => [])
    setLoadLocalHealthTestImpl(async () => [])

    const report = await loadUsageReport(params)

    expect(report.metadata).toMatchObject({
      generatedAt: '2026-05-08T12:00:00.000Z',
      latestRecordAt: '2026-05-08T11:56:00.000Z',
      latestRecordAgeMinutes: 4,
      latestRecordStale: false,
      staleRecordThresholdMinutes: expect.any(Number),
    })
  })

  test('test_loadUsageReport_uses_null_stale_freshness_metadata_for_empty_summary', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-08T12:00:00.000Z'))
    installSuccessfulCoreQueryMock()
    setLoadDockerLogErrorsTestImpl(async () => [])
    setLoadLocalHealthTestImpl(async () => [])

    const report = await loadUsageReport(params)

    expect(report.metadata).toMatchObject({
      generatedAt: '2026-05-08T12:00:00.000Z',
      latestRecordAt: null,
      latestRecordAgeMinutes: null,
      latestRecordStale: true,
      staleRecordThresholdMinutes: expect.any(Number),
    })
  })
})
