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

type UsageReportResult = {
  metadata: Record<string, unknown>
  rows: Array<Record<string, unknown>>
  summary: Record<string, unknown>
  [key: string]: unknown
}

function asUsageReport(report: unknown): UsageReportResult {
  return report as UsageReportResult
}

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

describe('D1-493 usage_score_reasons auxiliary split', () => {
  const d1493Params = new URLSearchParams({
    from: '2026-05-01',
    to: '2026-05-08',
    group_by: 'provider,model,repository',
  })

  test('test_loadUsageReport_merges_score_reasons_into_core_rows_on_matching_key', async () => {
    const coreRows = [
      {
        bucket: '2026-05-01',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        repository: 'aawm',
        token_total: 1000,
      },
      {
        bucket: '2026-05-01',
        provider: 'openai',
        model: 'gpt-4o',
        repository: 'aawm',
        token_total: 500,
      },
    ]
    const reasonRows = [
      {
        bucket: '2026-05-01',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        repository: 'aawm',
        agent_score_reasons_top: [
          { family: 'quality', reason: 'high_score', count: 5 },
        ],
        agent_score_reasons_bounded_min_id: 100,
        agent_score_reasons_bounded_max_id: 200,
        agent_score_reasons_recent_row_limit: 10000,
        agent_score_reasons_recent_id_cap_active: true,
        agent_score_reasons_recent_id_cap_truncates_requested_window: false,
      },
    ]

    setQueryReportDatabaseTestImpl(async (_sql: string, _values, options) => {
      const taskKey = usageReportTaskKey(options)
      if (taskKey === 'usage_rows') {
        return { rows: coreRows }
      }
      if (taskKey === 'usage_score_reasons') {
        return { rows: reasonRows }
      }
      return emptyDbResult()
    })
    setLoadDockerLogErrorsTestImpl(async () => [])
    setLoadLocalHealthTestImpl(async () => [])

    const report = asUsageReport(await loadUsageReport(d1493Params))

    expect(report.metadata.agentScoreReasonsDegraded).toBe(false)
    expect(
      report.metadata.agentScoreReasonsRecentIdCapTruncatesRequestedWindow
    ).toBe(false)
    expect(report.metadata.agentScoreReasonsRecentRowLimit).toBe(10_000)
    expect(report.metadata.agentScoreReasonsRecentIdCapActive).toBe(true)
    expect(report.metadata.agentScoreReasonsBoundedMinId).toBe(100)
    expect(report.metadata.agentScoreReasonsBoundedMaxId).toBe(200)

    const anthropicRow = report.rows.find(
      (r: Record<string, unknown>) => r.provider === 'anthropic'
    )
    expect(anthropicRow).toBeDefined()
    expect(anthropicRow!.agent_score_reasons_top).toEqual([
      { family: 'quality', reason: 'high_score', count: 5 },
    ])
    expect(anthropicRow!.agent_score_reasons_bounded_min_id).toBe(100)
    expect(anthropicRow!.agent_score_reasons_bounded_max_id).toBe(200)

    const openaiRow = report.rows.find(
      (r: Record<string, unknown>) => r.provider === 'openai'
    )
    expect(openaiRow).toBeDefined()
    expect(openaiRow!.agent_score_reasons_top).toEqual([])
    expect(openaiRow!.agent_score_reasons_bounded_min_id).toBe(100)
    expect(openaiRow!.agent_score_reasons_bounded_max_id).toBe(200)
  })

  test('test_loadUsageReport_preserves_cap_state_when_reason_summary_has_zero_groups', async () => {
    const coreRows = [
      {
        bucket: '2026-05-01',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        repository: 'aawm',
        token_total: 1000,
      },
    ]
    const capStateOnlyRows = [
      {
        bucket: null,
        provider: null,
        model: null,
        repository: null,
        agent_score_reasons_top: null,
        agent_score_reasons_bounded_min_id: 250,
        agent_score_reasons_bounded_max_id: 10250,
        agent_score_reasons_recent_row_limit: 10000,
        agent_score_reasons_recent_id_cap_active: true,
        agent_score_reasons_recent_id_cap_truncates_requested_window: true,
        agent_score_reasons_cap_state_only: true,
      },
    ]

    setQueryReportDatabaseTestImpl(async (_sql: string, _values, options) => {
      const taskKey = usageReportTaskKey(options)
      if (taskKey === 'usage_rows') {
        return { rows: coreRows }
      }
      if (taskKey === 'usage_score_reasons') {
        return { rows: capStateOnlyRows }
      }
      return emptyDbResult()
    })
    setLoadDockerLogErrorsTestImpl(async () => [])
    setLoadLocalHealthTestImpl(async () => [])

    const report = asUsageReport(await loadUsageReport(d1493Params))

    expect(report.metadata.agentScoreReasonsDegraded).toBe(false)
    expect(
      report.metadata.agentScoreReasonsRecentIdCapTruncatesRequestedWindow
    ).toBe(true)
    expect(report.metadata.agentScoreReasonsBoundedMinId).toBe(250)
    expect(report.metadata.agentScoreReasonsBoundedMaxId).toBe(10250)
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0]).toMatchObject({
      bucket: '2026-05-01',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      repository: 'aawm',
      token_total: 1000,
      agent_score_reasons_top: [],
      agent_score_reasons_bounded_min_id: 250,
      agent_score_reasons_bounded_max_id: 10250,
      agent_score_reasons_recent_id_cap_truncates_requested_window: true,
    })
  })

  test('test_loadUsageReport_degrades_score_reasons_timeout_without_rejecting_report', async () => {
    const coreRows = [
      {
        bucket: '2026-05-01',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        repository: 'aawm',
        token_total: 1000,
      },
    ]

    setQueryReportDatabaseTestImpl(async (_sql: string, _values, options) => {
      const taskKey = usageReportTaskKey(options)
      if (taskKey === 'usage_rows') {
        return { rows: coreRows }
      }
      if (taskKey === 'usage_score_reasons') {
        const error = new Error('canceling statement due to statement timeout')
        ;(error as unknown as Record<string, unknown>).code = '57014'
        throw error
      }
      return emptyDbResult()
    })
    setLoadDockerLogErrorsTestImpl(async () => [])
    setLoadLocalHealthTestImpl(async () => [])

    const report = asUsageReport(await loadUsageReport(d1493Params))

    expect(report.metadata.degraded).toBe(true)
    expect(report.metadata.degradedReason).toBe('auxiliary_fanout_failure')
    expect(report.metadata.unavailableAuxiliarySections).toContain(
      'usage_score_reasons'
    )
    expect(report.metadata.agentScoreReasonsDegraded).toBe(true)
    expect(
      report.metadata.agentScoreReasonsRecentIdCapTruncatesRequestedWindow
    ).toBe(false)

    expect(report.rows).toHaveLength(1)
    expect(report.rows[0].token_total).toBe(1000)
    expect(report.rows[0].agent_score_reasons_top).toEqual([])
  })

  test('test_loadUsageReport_core_fail_fast_still_works_after_score_reasons_split', async () => {
    setQueryReportDatabaseTestImpl(async (_sql: string, _values, options) => {
      if (usageReportTaskKey(options) === 'usage_rows') {
        throw new Error('core usage query failed')
      }
      return emptyDbResult()
    })
    setLoadDockerLogErrorsTestImpl(async () => [])
    setLoadLocalHealthTestImpl(async () => [])

    await expect(loadUsageReport(d1493Params)).rejects.toThrow(
      'core usage query failed'
    )
  })

  test('test_loadUsageReport_score_reasons_metadata_present_on_success', async () => {
    installSuccessfulCoreQueryMock()
    setLoadDockerLogErrorsTestImpl(async () => [])
    setLoadLocalHealthTestImpl(async () => [])

    const report = asUsageReport(await loadUsageReport(d1493Params))

    expect(report.metadata.agentScoreReasonsRecentRowLimit).toBe(10_000)
    expect(report.metadata.agentScoreReasonsRecentIdCapActive).toBe(true)
    expect(report.metadata.agentScoreReasonsBoundedMinId).toBeNull()
    expect(report.metadata.agentScoreReasonsBoundedMaxId).toBeNull()
    expect(report.metadata.agentScoreReasonsDegraded).toBe(false)
    expect(
      report.metadata.agentScoreReasonsRecentIdCapTruncatesRequestedWindow
    ).toBe(false)
  })
})
