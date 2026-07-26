import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  buildUsageReportAuxiliaryDegradedMetadata,
  __usageReportTestHelpers,
} from './report-service.mjs'

const {
  loadUsageReport,
  runUsageReportFanoutTasks,
  USAGE_REPORT_REQUEST_BUDGET_MS,
  USAGE_REPORT_RESPONSE_HEADROOM_MS,
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

function usageReportStatementTimeoutMs(options: unknown) {
  return typeof options === 'object' && options != null
    ? (options as { statementTimeoutMs?: number }).statementTimeoutMs
    : undefined
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

afterEach(() => {
  vi.useRealTimers()
  resetQueryReportDatabaseTestImpl()
  resetLoadDockerLogErrorsTestImpl()
  resetLoadLocalHealthTestImpl()
})

describe('D1-496 usage report wall-clock scheduler', () => {
  test('test_runUsageReportFanoutTasks_schedules_all_mandatory_work_before_optional_work', async () => {
    const usageRowsGate = deferred<string>()
    const started: string[] = []

    const runPromise = runUsageReportFanoutTasks(
      [
        {
          taskKey: 'usage_score_reasons',
          task: async () => {
            started.push('usage_score_reasons')
            return 'score reasons'
          },
        },
        {
          taskKey: 'usage_rows',
          task: async () => {
            started.push('usage_rows')
            return usageRowsGate.promise
          },
        },
        {
          taskKey: 'local_health',
          task: async () => {
            started.push('local_health')
            return 'local health'
          },
        },
        {
          taskKey: 'summary',
          task: async () => {
            started.push('summary')
            return 'summary'
          },
        },
      ],
      1,
      {
        now: () => 0,
        requestStartedAtMs: 0,
        requestBudgetMs: 1_000,
      }
    )

    expect(started).toEqual(['usage_rows'])
    usageRowsGate.resolve('usage rows')

    const result = await runPromise

    expect(started).toEqual([
      'usage_rows',
      'summary',
      'usage_score_reasons',
      'local_health',
    ])
    expect(result.unavailableAuxiliarySections).toEqual([])
  })

  test('test_runUsageReportFanoutTasks_skips_exhausted_optionals_and_reports_each_section', async () => {
    let nowMs = 0
    const optionalStarts: string[] = []

    const result = await runUsageReportFanoutTasks(
      [
        {
          taskKey: 'usage_score_reasons',
          task: async () => {
            optionalStarts.push('usage_score_reasons')
            return 'score reasons'
          },
        },
        {
          taskKey: 'usage_rows',
          task: async ({
            remainingBudgetMs,
            statementTimeoutMs,
          }: {
            remainingBudgetMs: number
            statementTimeoutMs: number
          }) => {
            expect(remainingBudgetMs).toBe(100)
            expect(statementTimeoutMs).toBe(100)
            nowMs = 100
            return 'usage rows'
          },
        },
        {
          taskKey: 'usage_diagnostic_strings',
          task: async () => {
            optionalStarts.push('usage_diagnostic_strings')
            return 'diagnostic strings'
          },
        },
      ],
      1,
      {
        now: () => nowMs,
        requestStartedAtMs: 0,
        requestBudgetMs: 100,
        statementTimeoutCeilingMs: 120_000,
      }
    )

    expect(optionalStarts).toEqual([])
    expect(result.unavailableAuxiliarySections).toEqual([
      'usage_score_reasons',
      'usage_diagnostic_strings',
    ])
    expect(result.results).toEqual([
      {
        status: 'skipped',
        taskKey: 'usage_score_reasons',
        reason: 'request_budget_exhausted',
      },
      {
        status: 'fulfilled',
        taskKey: 'usage_rows',
        value: 'usage rows',
      },
      {
        status: 'skipped',
        taskKey: 'usage_diagnostic_strings',
        reason: 'request_budget_exhausted',
      },
    ])
    expect(
      buildUsageReportAuxiliaryDegradedMetadata(
        result.unavailableAuxiliarySections
      )
    ).toMatchObject({
      degraded: true,
      degradedReason: 'auxiliary_fanout_failure',
      unavailableAuxiliarySections: [
        'usage_score_reasons',
        'usage_diagnostic_strings',
      ],
    })
  })

  test('test_runUsageReportFanoutTasks_awaits_started_optional_work_with_remaining_timeout', async () => {
    let nowMs = 0
    let observedStatementTimeoutMs: number | undefined
    let optionalStarted = false
    let runSettled = false
    const optionalGate = deferred<string>()

    const runPromise = runUsageReportFanoutTasks(
      [
        {
          taskKey: 'usage_rows',
          task: async () => {
            nowMs = 40
            return 'usage rows'
          },
        },
        {
          taskKey: 'usage_diagnostic_strings',
          task: async ({
            statementTimeoutMs,
          }: {
            statementTimeoutMs: number
          }) => {
            optionalStarted = true
            observedStatementTimeoutMs = statementTimeoutMs
            return optionalGate.promise
          },
        },
      ],
      1,
      {
        now: () => nowMs,
        requestStartedAtMs: 0,
        requestBudgetMs: 100,
        statementTimeoutCeilingMs: 120_000,
      }
    )
    void runPromise.then(() => {
      runSettled = true
    })

    await vi.waitFor(() => {
      expect(optionalStarted).toBe(true)
    })
    expect(observedStatementTimeoutMs).toBe(60)

    nowMs = 100
    await Promise.resolve()
    expect(runSettled).toBe(false)

    optionalGate.resolve('diagnostic strings')
    const result = await runPromise

    expect(runSettled).toBe(true)
    expect(result.unavailableAuxiliarySections).toEqual([])
  })

  test('test_runUsageReportFanoutTasks_core_failure_stops_admission_but_awaits_started_work', async () => {
    const summaryGate = deferred<string>()
    const started: string[] = []
    let runSettled = false

    const runPromise = runUsageReportFanoutTasks(
      [
        {
          taskKey: 'usage_rows',
          task: async () => {
            started.push('usage_rows')
            throw new Error('core usage query failed')
          },
        },
        {
          taskKey: 'summary',
          task: async () => {
            started.push('summary')
            return summaryGate.promise
          },
        },
        {
          taskKey: 'usage_score_reasons',
          task: async () => {
            started.push('usage_score_reasons')
            return 'score reasons'
          },
        },
      ],
      2,
      {
        now: () => 0,
        requestStartedAtMs: 0,
        requestBudgetMs: 100,
      }
    )
    void runPromise.catch(() => {
      runSettled = true
    })

    await Promise.resolve()
    expect(started).toEqual(['usage_rows', 'summary'])
    expect(runSettled).toBe(false)

    summaryGate.resolve('summary')
    await expect(runPromise).rejects.toThrow('core usage query failed')

    expect(runSettled).toBe(true)
    expect(started).toEqual(['usage_rows', 'summary'])
  })

  test('test_runUsageReportFanoutTasks_defers_optional_phase_until_mandatory_success', async () => {
    const usageRowsGate = deferred<string>()
    const summaryGate = deferred<string>()
    const started: string[] = []
    let optionalStartedBeforeMandatoryDone = false

    const runPromise = runUsageReportFanoutTasks(
      [
        {
          taskKey: 'usage_score_reasons',
          task: async () => {
            if (
              started.filter((key) => key === 'usage_rows' || key === 'summary')
                .length < 2
            ) {
              optionalStartedBeforeMandatoryDone = true
            }
            started.push('usage_score_reasons')
            return 'score reasons'
          },
        },
        {
          taskKey: 'usage_rows',
          task: async () => {
            started.push('usage_rows')
            return usageRowsGate.promise
          },
        },
        {
          taskKey: 'local_health',
          task: async () => {
            if (
              started.filter((key) => key === 'usage_rows' || key === 'summary')
                .length < 2
            ) {
              optionalStartedBeforeMandatoryDone = true
            }
            started.push('local_health')
            return 'local health'
          },
        },
        {
          taskKey: 'summary',
          task: async () => {
            started.push('summary')
            return summaryGate.promise
          },
        },
      ],
      4,
      {
        now: () => 0,
        requestStartedAtMs: 0,
        requestBudgetMs: 1_000,
      }
    )

    await vi.waitFor(() => {
      expect(started).toEqual(expect.arrayContaining(['usage_rows', 'summary']))
    })
    expect(started).toHaveLength(2)
    expect(optionalStartedBeforeMandatoryDone).toBe(false)

    usageRowsGate.resolve('usage rows')
    summaryGate.resolve('summary')
    const result = await runPromise

    expect(optionalStartedBeforeMandatoryDone).toBe(false)
    expect(started.slice(0, 2).sort()).toEqual(['summary', 'usage_rows'])
    expect(started.slice(2).sort()).toEqual([
      'local_health',
      'usage_score_reasons',
    ])
    expect(result.unavailableAuxiliarySections).toEqual([])
  })

  test('test_usage_report_budget_keeps_five_seconds_of_response_headroom', () => {
    expect(USAGE_REPORT_REQUEST_BUDGET_MS).toBe(115_000)
    expect(USAGE_REPORT_RESPONSE_HEADROOM_MS).toBe(5_000)
    expect(
      USAGE_REPORT_REQUEST_BUDGET_MS + USAGE_REPORT_RESPONSE_HEADROOM_MS
    ).toBe(120_000)
  })
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

    const statementTimeouts = new Map<string, number | undefined>()
    setQueryReportDatabaseTestImpl(async (_sql: string, _values, options) => {
      const taskKey = usageReportTaskKey(options)
      if (taskKey) {
        statementTimeouts.set(taskKey, usageReportStatementTimeoutMs(options))
      }
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

describe('D1-496 usage_diagnostic_strings auxiliary split', () => {
  const d1496Params = new URLSearchParams({
    from: '2026-05-25',
    to: '2026-06-25',
    group_by: 'provider,model,repository',
  })

  test('test_loadUsageReport_merges_diagnostic_strings_into_core_rows_on_matching_key', async () => {
    const coreRows = [
      {
        bucket: '2026-05-25',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        repository: 'aawm',
        token_total: 1000,
        reasoning_tokens_sources: null,
        cache_miss_reasons: null,
        cache_attempted_summary: 'attempted',
        cache_miss_summary: 'miss',
      },
      {
        bucket: '2026-05-25',
        provider: 'openai',
        model: 'gpt-4o',
        repository: 'aawm',
        token_total: 500,
        reasoning_tokens_sources: null,
        cache_miss_reasons: null,
        cache_attempted_summary: null,
        cache_miss_summary: null,
      },
    ]
    const diagnosticRows = [
      {
        bucket: '2026-05-25',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        repository: 'aawm',
        reasoning_tokens_sources: 'reported,estimated',
        cache_miss_reasons: 'cold_start',
      },
    ]

    const statementTimeouts = new Map<string, number | undefined>()
    setQueryReportDatabaseTestImpl(async (_sql: string, _values, options) => {
      const taskKey = usageReportTaskKey(options)
      if (taskKey) {
        statementTimeouts.set(taskKey, usageReportStatementTimeoutMs(options))
      }
      if (taskKey === 'usage_rows') {
        return { rows: coreRows }
      }
      if (taskKey === 'usage_diagnostic_strings') {
        return { rows: diagnosticRows }
      }
      return emptyDbResult()
    })
    setLoadDockerLogErrorsTestImpl(async () => [])
    setLoadLocalHealthTestImpl(async () => [])

    const report = asUsageReport(
      await loadUsageReport(d1496Params, { now: () => 0 })
    )

    const anthropicRow = report.rows.find(
      (r: Record<string, unknown>) => r.provider === 'anthropic'
    )
    expect(anthropicRow).toBeDefined()
    expect(anthropicRow!.reasoning_tokens_sources).toBe('reported,estimated')
    expect(anthropicRow!.cache_miss_reasons).toBe('cold_start')
    expect(anthropicRow!.cache_attempted_summary).toBe('attempted')
    expect(anthropicRow!.cache_miss_summary).toBe('miss')
    expect(anthropicRow!.token_total).toBe(1000)

    const openaiRow = report.rows.find(
      (r: Record<string, unknown>) => r.provider === 'openai'
    )
    expect(openaiRow).toBeDefined()
    // Default compact row serialization omits null diagnostic placeholders.
    expect(openaiRow!.reasoning_tokens_sources).toBeUndefined()
    expect(openaiRow!.cache_miss_reasons).toBeUndefined()
    expect(openaiRow!.token_total).toBe(500)
    expect(statementTimeouts.get('usage_rows')).toBe(115_000)
    expect(statementTimeouts.get('usage_diagnostic_strings')).toBe(115_000)
  })

  test('test_loadUsageReport_degrades_diagnostic_strings_timeout_without_rejecting_report', async () => {
    const coreRows = [
      {
        bucket: '2026-05-25',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        repository: 'aawm',
        token_total: 1000,
        reasoning_tokens_sources: null,
        cache_miss_reasons: null,
        cache_attempted_summary: 'attempted',
      },
    ]

    setQueryReportDatabaseTestImpl(async (_sql: string, _values, options) => {
      const taskKey = usageReportTaskKey(options)
      if (taskKey === 'usage_rows') {
        return { rows: coreRows }
      }
      if (taskKey === 'usage_diagnostic_strings') {
        const error = new Error('canceling statement due to statement timeout')
        ;(error as unknown as Record<string, unknown>).code = '57014'
        throw error
      }
      return emptyDbResult()
    })
    setLoadDockerLogErrorsTestImpl(async () => [])
    setLoadLocalHealthTestImpl(async () => [])

    const report = asUsageReport(await loadUsageReport(d1496Params))

    expect(report.metadata.degraded).toBe(true)
    expect(report.metadata.degradedReason).toBe('auxiliary_fanout_failure')
    expect(report.metadata.unavailableAuxiliarySections).toContain(
      'usage_diagnostic_strings'
    )

    expect(report.rows).toHaveLength(1)
    expect(report.rows[0].token_total).toBe(1000)
    expect(report.rows[0].cache_attempted_summary).toBe('attempted')
    // Timeout leaves placeholders null; compact serialization drops them.
    expect(report.rows[0].reasoning_tokens_sources).toBeUndefined()
    expect(report.rows[0].cache_miss_reasons).toBeUndefined()
  })

  test('test_loadUsageReport_preserves_null_diagnostic_strings_when_empty_fields_requested', async () => {
    const coreRows = [
      {
        bucket: '2026-05-25',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        repository: 'aawm',
        token_total: 1000,
        reasoning_tokens_sources: null,
        cache_miss_reasons: null,
      },
    ]

    setQueryReportDatabaseTestImpl(async (_sql: string, _values, options) => {
      const taskKey = usageReportTaskKey(options)
      if (taskKey === 'usage_rows') {
        return { rows: coreRows }
      }
      if (taskKey === 'usage_diagnostic_strings') {
        const error = new Error('canceling statement due to statement timeout')
        ;(error as unknown as Record<string, unknown>).code = '57014'
        throw error
      }
      return emptyDbResult()
    })
    setLoadDockerLogErrorsTestImpl(async () => [])
    setLoadLocalHealthTestImpl(async () => [])

    const params = new URLSearchParams(d1496Params)
    params.set('include_empty_row_fields', '1')
    const report = asUsageReport(await loadUsageReport(params))

    expect(report.metadata.unavailableAuxiliarySections).toContain(
      'usage_diagnostic_strings'
    )
    expect(report.rows[0].reasoning_tokens_sources).toBeNull()
    expect(report.rows[0].cache_miss_reasons).toBeNull()
  })

  test('test_loadUsageReport_core_fail_fast_still_works_after_diagnostic_strings_split', async () => {
    setQueryReportDatabaseTestImpl(async (_sql: string, _values, options) => {
      if (usageReportTaskKey(options) === 'usage_rows') {
        throw new Error('core usage query failed')
      }
      return emptyDbResult()
    })
    setLoadDockerLogErrorsTestImpl(async () => [])
    setLoadLocalHealthTestImpl(async () => [])

    await expect(loadUsageReport(d1496Params)).rejects.toThrow(
      'core usage query failed'
    )
  })
})
