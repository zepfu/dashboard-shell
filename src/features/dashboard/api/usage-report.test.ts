import { http, HttpResponse } from 'msw'
import { expectTypeOf } from 'vitest'
import { server } from '../../../test/setup'
import {
  type ReportCacheMetadata,
  type UsageReportTokenTrendSummaryResponse,
  USAGE_REPORT_DEFAULT_LIMIT,
  USAGE_REPORT_DEFAULT_INCLUDE_QUOTAS,
  USAGE_REPORT_DEFAULT_INCLUDE_QUOTA_HISTORY,
  USAGE_REPORT_DEFAULT_INCLUDE_TOOL_ACTIVITY,
  USAGE_REPORT_MONOLITH_PAYLOAD_DEFAULT_INCLUDES,
  isReportCacheMetadata,
  type UsageReportFilterParams,
  type UsageReportQuotaBillingDetail,
  usageReportQuotasKey,
  fetchUsageReport,
  fetchUsageReportQuotaEstimator,
  fetchUsageReportQuotaHistory,
  fetchUsageReportQuotaRangeHistory,
  fetchUsageReportQuotas,
  fetchShellHealth,
  fetchUsageReportSessionDiagnostics,
  fetchUsageReportTokenTrendDay,
  fetchUsageReportTokenTrendSummary,
  fetchUsageReportToolActivity,
  usageReportQuotasQueryOptions,
  type UsageReportProviderCreditLifecycleStatus,
  type UsageReportQuotaHistoryRow,
  type UsageReportSessionDiagnosticsResponse,
  type UsageReportSessionDiagnosticsRow,
} from './usage-report'

test('test_usageReportQuotasQueryOptions_disables_background_polling', () => {
  const options = usageReportQuotasQueryOptions({
    from: '2026-05-20',
    to: '2026-05-21',
  })

  expect(options.refetchInterval).toBe(60_000)
  expect(options.refetchIntervalInBackground).toBe(false)
  expect(options.queryKey).toHaveLength(1)
})

test('test_usageReportQuotasKey_includes_cacheBust_token', () => {
  expect(usageReportQuotasKey('2026-05-20', '2026-05-21', 'manual-1')).toEqual([
    'usage-report-quotas',
    'manual-1',
  ])
})

test('test_usageReportQuotasKey_omits_cacheBust_without_token', () => {
  expect(usageReportQuotasKey('2026-05-20', '2026-05-21')).toEqual([
    'usage-report-quotas',
  ])
})

test('test_fetchUsageReportTokenTrendSummary_sends_filters', async () => {
  let requestedUrl: URL | null = null

  server.use(
    http.get('/api/shell/reports/usage/token-trend-summary', ({ request }) => {
      requestedUrl = new URL(request.url)
      return HttpResponse.json({
        metadata: {
          from: '2026-05-20',
          to: '2026-05-21',
        },
        tokenTrendHours: [],
        tokenTrendVersions: [],
      })
    })
  )

  await expect(
    fetchUsageReportTokenTrendSummary({
      from: '2026-05-20',
      to: '2026-05-21',
      model: ['claude-sonnet-4'],
    })
  ).resolves.toMatchObject({ tokenTrendHours: [], tokenTrendVersions: [] })

  expect(requestedUrl?.searchParams.get('from')).toBe('2026-05-20')
  expect(requestedUrl?.searchParams.get('to')).toBe('2026-05-21')
  expect(requestedUrl?.searchParams.get('model')).toBe('claude-sonnet-4')
})

test('test_fetchUsageReportTokenTrendSummary_sends_health_opt_in', async () => {
  let requestedUrl: URL | null = null

  server.use(
    http.get('/api/shell/reports/usage/token-trend-summary', ({ request }) => {
      requestedUrl = new URL(request.url)
      return HttpResponse.json({
        metadata: {
          from: '2026-05-20',
          to: '2026-05-21',
          includeTokenTrendHealth: true,
        },
        tokenTrendHours: [],
        tokenTrendHealth: [],
        tokenTrendVersions: [],
      })
    })
  )

  await expect(
    fetchUsageReportTokenTrendSummary({
      from: '2026-05-20',
      to: '2026-05-21',
      includeHealth: true,
    })
  ).resolves.toMatchObject({
    metadata: { includeTokenTrendHealth: true },
    tokenTrendHealth: [],
  })

  expect(requestedUrl?.searchParams.get('include_health')).toBe('1')
})

test('test_fetchUsageReportTokenTrendSummary_preserves_degraded_metadata', async () => {
  server.use(
    http.get('/api/shell/reports/usage/token-trend-summary', () =>
      HttpResponse.json({
        metadata: {
          from: '2026-05-20',
          to: '2026-05-21',
          degraded: true,
          degradedReason: 'database_timeout',
          degradedMessage: 'Token trend summary exceeded the bounded timeout.',
          timeout: true,
          timedOutSubquery: 'health',
          timedOutSubqueries: ['health'],
          tokenTrendSummaryStatementTimeoutMs: 15000,
        },
        tokenTrendHours: [],
        tokenTrendHealth: [],
        tokenTrendScores: [],
        tokenTrendVersions: [],
        tokenTrendModelFirstSeen: [],
      })
    )
  )

  await expect(
    fetchUsageReportTokenTrendSummary({
      from: '2026-05-20',
      to: '2026-05-21',
    })
  ).resolves.toMatchObject({
    metadata: {
      degraded: true,
      degradedReason: 'database_timeout',
      timeout: true,
      timedOutSubquery: 'health',
      timedOutSubqueries: ['health'],
      tokenTrendSummaryStatementTimeoutMs: 15000,
    },
    tokenTrendHours: [],
    tokenTrendVersions: [],
  })
})

function minimalUsageReportPayload() {
  return {
    metadata: {
      from: '2026-05-20',
      to: '2026-05-21',
      grain: 'day',
      groupBy: ['provider', 'model', 'repository'],
      limit: USAGE_REPORT_DEFAULT_LIMIT,
      generatedAt: '2026-05-21T00:00:00.000Z',
      latestRecordAt: null,
      latestRecordAgeMinutes: null,
      latestRecordStale: false,
      staleRecordThresholdMinutes: 60,
    },
    summary: {
      traces: 0,
      token_in: 0,
      token_out: 0,
      token_cache_input: 0,
      token_cache_creation: 0,
      token_reasoning_reported: 0,
      token_reasoning_estimated: 0,
      token_total: 0,
      usd_cost: 0,
      cache_miss_usd_cost: 0,
      tool_calls: 0,
      git_commit: 0,
      git_push: 0,
      period_start: '2026-05-20',
      period_end: '2026-05-21',
      latest_record_at: null,
    },
    trend: [],
    clients: [],
    providerLatencyHealth: [],
    providerErrorObservations: [],
    providerStatusUsage: [],
    quotas: [],
    quotaHistory: [],
    toolActivity: [],
    rows: [],
  }
}

type UsageReportMonolithPayloadSection =
  | 'quotas'
  | 'quotaHistory'
  | 'toolActivity'

function minimalUsageReportPayloadWithoutMonolithSections(
  omittedSections: readonly UsageReportMonolithPayloadSection[]
) {
  const payload = minimalUsageReportPayload() as Record<string, unknown>
  const filteredPayload = { ...payload }
  for (const section of omittedSections) {
    delete filteredPayload[section]
  }
  return filteredPayload
}

type UsageReportPayload = ReturnType<typeof minimalUsageReportPayload>

function usageReportPayloadForTests(
  overrides: {
    metadata?: Partial<UsageReportPayload['metadata']>
    summary?: Partial<UsageReportPayload['summary']>
    providerAliasRouting?: unknown
    providerAuthHealth?: unknown
    providerCreditLifecycle?: unknown
  } = {}
) {
  const payload = minimalUsageReportPayload()
  return {
    ...payload,
    ...overrides,
    metadata: {
      ...payload.metadata,
      ...(overrides.metadata ?? {}),
    },
    summary: {
      ...payload.summary,
      ...(overrides.summary ?? {}),
    },
  }
}

const BASE_USAGE_REPORT_SESSION_DIAGNOSTIC_ROW = {
  session_id: 'sess-1',
  litellm_call_id: 'call-1',
  provider: 'xai',
  model: 'grok-composer-2.5-fast',
  repository: 'dashboard-shell',
  client: 'grok-build',
  diagnostic_flags: ['grok_oauth', 'xai_sanitizer'],
  diagnostic_categories: ['route_identity', 'request_shape'],
  grok_oauth: {
    credential_family: 'xai_grok_oidc',
    grok_native_oauth_managed: true,
    grok_native_entrypoint: 'openai_responses',
  },
  output_contract: {
    usage_output_contract_required_final_phrase: 'done',
    usage_output_contract_required_final_phrase_present: true,
    usage_output_contract_failure_class: null,
    usage_output_contract_setup_only_detected: false,
  },
  xai_sanitizer: {
    xai_responses_request_sanitized: true,
    xai_responses_sanitized_removed_params: ['instructions'],
    xai_responses_sanitized_tool_count: 2,
    xai_responses_sanitized_tool_types: ['web_search'],
    xai_tool_choice_without_tools_removed: {
      name: 'Bash',
      type: 'function',
    },
    xai_tool_choice_without_tools_removed_reason: 'missing_tools',
  },
  transcript_attribution: {
    session_history_transcript_attribution_status: 'recoverable',
    session_history_transcript_attribution_source:
      'd1-229-claude-raw-transcript-attribution',
    session_history_transcript_attribution: {
      status: 'recoverable',
      match_rule: 'transcript_model_event',
    },
  },
  tool_definitions: {
    snapshot_hash: 'abc123',
    tool_definition_snapshot: [{ name: 'Bash', type: 'function' }],
  },
  alias_route_events: [
    {
      observed_at: '2026-05-20T12:00:00.000Z',
      alias_model: 'aawm-code',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      event_type: 'candidate_selected',
      redispatch_required: false,
    },
  ],
  anthropic_context_window: {
    mode: 'extended_1m',
    requested_tokens: 1000000,
    source: 'model_suffix_1m',
    beta: 'context-1m-2025-08-07',
    classification: { label: 'extended_1m', evidence: 'suffix' },
  },
}

function usageReportSessionDiagnosticsPayload(
  overrides: {
    metadata?: Partial<UsageReportSessionDiagnosticsResponse['metadata']>
    sessionDiagnostics?: Array<Record<string, unknown>>
  } = {}
) {
  const payload = {
    metadata: {
      from: '2026-05-20',
      to: '2026-05-21',
      limit: 100,
      generatedAt: '2026-05-21T00:00:00.000Z',
    },
    sessionDiagnostics: [BASE_USAGE_REPORT_SESSION_DIAGNOSTIC_ROW],
  } as {
    metadata: UsageReportSessionDiagnosticsResponse['metadata']
    sessionDiagnostics: Array<Record<string, unknown>>
  }

  return {
    ...payload,
    ...overrides,
    metadata: {
      ...payload.metadata,
      ...(overrides.metadata ?? {}),
    },
    sessionDiagnostics:
      overrides.sessionDiagnostics ?? payload.sessionDiagnostics,
  }
}

test('test_fetchUsageReport_uses_compact_rows_by_default', async () => {
  let requestedUrl: URL | null = null

  server.use(
    http.get('/api/shell/reports/usage', ({ request }) => {
      requestedUrl = new URL(request.url)
      return HttpResponse.json(minimalUsageReportPayload())
    })
  )

  await fetchUsageReport({
    from: '2026-05-20',
    to: '2026-05-21',
    grain: 'day',
  })

  expect(requestedUrl?.searchParams.get('group_by')).toBe(
    'environment,client,repository,provider_model'
  )
  expect(requestedUrl?.searchParams.get('limit')).toBe(
    String(USAGE_REPORT_DEFAULT_LIMIT)
  )
  expect(requestedUrl?.searchParams.get('sort')).toBe('period_end')
  expect(requestedUrl?.searchParams.get('include_quotas')).toBe(
    USAGE_REPORT_MONOLITH_PAYLOAD_DEFAULT_INCLUDES.includeQuotas ? '1' : '0'
  )
  expect(requestedUrl?.searchParams.get('include_quota_history')).toBe(
    USAGE_REPORT_MONOLITH_PAYLOAD_DEFAULT_INCLUDES.includeQuotaHistory
      ? '1'
      : '0'
  )
  expect(requestedUrl?.searchParams.get('include_tool_activity')).toBe(
    USAGE_REPORT_MONOLITH_PAYLOAD_DEFAULT_INCLUDES.includeToolActivity
      ? '1'
      : '0'
  )
  expect(requestedUrl?.searchParams.has('include_empty_row_fields')).toBe(false)
})

test('test_usage_report_monolith_section_defaults_are_explicit', () => {
  expect(USAGE_REPORT_MONOLITH_PAYLOAD_DEFAULT_INCLUDES).toEqual({
    includeQuotas: true,
    includeQuotaHistory: true,
    includeToolActivity: true,
  })
  expect(USAGE_REPORT_DEFAULT_INCLUDE_QUOTAS).toBe(
    USAGE_REPORT_MONOLITH_PAYLOAD_DEFAULT_INCLUDES.includeQuotas
  )
  expect(USAGE_REPORT_DEFAULT_INCLUDE_QUOTA_HISTORY).toBe(
    USAGE_REPORT_MONOLITH_PAYLOAD_DEFAULT_INCLUDES.includeQuotaHistory
  )
  expect(USAGE_REPORT_DEFAULT_INCLUDE_TOOL_ACTIVITY).toBe(
    USAGE_REPORT_MONOLITH_PAYLOAD_DEFAULT_INCLUDES.includeToolActivity
  )
})

test('test_fetchUsageReport_uses_caller_supplied_limit_and_can_toggle_monolith_payload_sections', async () => {
  let requestedUrl: URL | null = null

  server.use(
    http.get('/api/shell/reports/usage', ({ request }) => {
      requestedUrl = new URL(request.url)
      return HttpResponse.json(minimalUsageReportPayload())
    })
  )

  await fetchUsageReport({
    from: '2026-05-20',
    to: '2026-05-21',
    grain: 'day',
    limit: 25,
    includeQuotas: false,
    includeQuotaHistory: false,
    includeToolActivity: false,
  })

  expect(requestedUrl?.searchParams.get('limit')).toBe('25')
  expect(requestedUrl?.searchParams.get('include_quotas')).toBe('0')
  expect(requestedUrl?.searchParams.get('include_quota_history')).toBe('0')
  expect(requestedUrl?.searchParams.get('include_tool_activity')).toBe('0')
})

test('test_fetchUsageReport_can_individually_opt_out_of_each_monolith_payload_section', async () => {
  let requestedUrl: URL | null

  server.use(
    http.get('/api/shell/reports/usage', ({ request }) => {
      requestedUrl = new URL(request.url)
      return HttpResponse.json(minimalUsageReportPayload())
    })
  )

  const toggles: Array<{
    request: Pick<
      Parameters<typeof fetchUsageReport>[0],
      'includeQuotas' | 'includeQuotaHistory' | 'includeToolActivity'
    >
    expected: {
      includeQuotas: '0' | '1'
      includeQuotaHistory: '0' | '1'
      includeToolActivity: '0' | '1'
    }
  }> = [
    {
      request: { includeQuotas: false },
      expected: {
        includeQuotas: '0',
        includeQuotaHistory: '1',
        includeToolActivity: '1',
      },
    },
    {
      request: { includeQuotaHistory: false },
      expected: {
        includeQuotas: '1',
        includeQuotaHistory: '0',
        includeToolActivity: '1',
      },
    },
    {
      request: { includeToolActivity: false },
      expected: {
        includeQuotas: '1',
        includeQuotaHistory: '1',
        includeToolActivity: '0',
      },
    },
  ]

  for (const { request, expected } of toggles) {
    requestedUrl = null
    await fetchUsageReport({
      from: '2026-05-20',
      to: '2026-05-21',
      grain: 'day',
      ...request,
    })

    expect(requestedUrl?.searchParams.get('include_quotas')).toBe(
      expected.includeQuotas
    )
    expect(requestedUrl?.searchParams.get('include_quota_history')).toBe(
      expected.includeQuotaHistory
    )
    expect(requestedUrl?.searchParams.get('include_tool_activity')).toBe(
      expected.includeToolActivity
    )
  }
})

test('test_usage_report_cache_metadata_exports_capture_decomposition_contract', () => {
  // W1: runtime guard is the intentional cache-metadata contract companion
  // after removing the exported field tuple while preserving metadata validation.
  expect(
    isReportCacheMetadata({
      cacheBackend: 'memory',
      cacheFreshUntil: null,
      cacheGeneratedAt: '2026-05-21T00:00:00.000Z',
      cacheStaleUntil: null,
      cacheStatus: 'fresh',
      cacheRefreshing: false,
    })
  ).toBe(true)
  expect(
    isReportCacheMetadata({
      cacheFreshUntil: 123 as unknown as string,
      cacheBackend: 'memory',
    })
  ).toBe(false)
})

test('test_fetchUsageReport_can_opt_into_full_empty_row_fields', async () => {
  let requestedUrl: URL | null = null

  server.use(
    http.get('/api/shell/reports/usage', ({ request }) => {
      requestedUrl = new URL(request.url)
      return HttpResponse.json(minimalUsageReportPayload())
    })
  )

  await fetchUsageReport({
    from: '2026-05-20',
    to: '2026-05-21',
    grain: 'day',
    includeEmptyRowFields: true,
  })

  expect(requestedUrl?.searchParams.get('include_empty_row_fields')).toBe('1')
})

test('test_fetchUsageReportTokenTrendSummary_supports_partial_degraded_payload', async () => {
  let requestedUrl: URL | null = null
  server.use(
    http.get('/api/shell/reports/usage/token-trend-summary', ({ request }) => {
      requestedUrl = new URL(request.url)
      return HttpResponse.json({
        metadata: {
          from: '2026-05-20',
          to: '2026-05-21',
          degraded: true,
          degradedReason: 'database_timeout',
          degradedMessage:
            'Token trend summary subquery "hours" exceeded timeout; returning partial payload.',
          timeout: true,
          timedOutSubquery: 'hours',
          timedOutSubqueries: ['hours'],
          tokenTrendSummaryStatementTimeoutMs: 15000,
        },
        tokenTrendHours: [],
        tokenTrendHealth: [{ provider: 'openai', value: 1 }],
        tokenTrendScores: [{ score_bucket: 0 }],
        tokenTrendVersions: [{ provider: 'openai', model: 'gpt-5' }],
        tokenTrendModelFirstSeen: [{ date: '2026-05-20', provider: 'openai' }],
      })
    })
  )

  const response = await fetchUsageReportTokenTrendSummary({
    from: '2026-05-20',
    to: '2026-05-21',
    provider: ['anthropic'],
  })

  expect(response).toMatchObject({
    metadata: {
      degraded: true,
      degradedReason: 'database_timeout',
      timeout: true,
      timedOutSubquery: 'hours',
      timedOutSubqueries: ['hours'],
      tokenTrendSummaryStatementTimeoutMs: 15000,
    },
    tokenTrendHours: [],
    tokenTrendHealth: [{ provider: 'openai', value: 1 }],
    tokenTrendScores: [{ score_bucket: 0 }],
    tokenTrendVersions: [{ provider: 'openai', model: 'gpt-5' }],
    tokenTrendModelFirstSeen: [{ date: '2026-05-20', provider: 'openai' }],
  })
  expect(requestedUrl?.searchParams.get('provider')).toBe('anthropic')
})

test('test_fetchUsageReportTokenTrendSummary_preserves_bounded_raw_lane_policy_metadata', async () => {
  server.use(
    http.get('/api/shell/reports/usage/token-trend-summary', () =>
      HttpResponse.json({
        metadata: {
          from: '2026-05-01',
          to: '2026-06-01',
          degraded: true,
          degradedReason: 'bounded_raw_lane_policy',
          degradedMessage:
            'Token trend summary bounded raw-lane policy skipped lanes for broad range.',
          skippedSubqueries: ['hours', 'scores', 'versions', 'modelFirstSeen'],
          unavailableSubqueries: [
            'hours',
            'scores',
            'versions',
            'modelFirstSeen',
          ],
          tokenTrendSummaryRawLaneMaxDays: 7,
          tokenTrendSummaryRangeDays: 30,
        },
        tokenTrendHours: [],
        tokenTrendHealth: [{ provider: 'openai', value: 1 }],
        tokenTrendScores: [],
        tokenTrendVersions: [],
        tokenTrendModelFirstSeen: [],
      })
    )
  )

  const response = await fetchUsageReportTokenTrendSummary({
    from: '2026-05-01',
    to: '2026-06-01',
  })

  expect(response).toMatchObject({
    metadata: {
      degraded: true,
      degradedReason: 'bounded_raw_lane_policy',
      skippedSubqueries: ['hours', 'scores', 'versions', 'modelFirstSeen'],
      unavailableSubqueries: ['hours', 'scores', 'versions', 'modelFirstSeen'],
      tokenTrendSummaryRawLaneMaxDays: 7,
      tokenTrendSummaryRangeDays: 30,
    },
    tokenTrendHours: [],
    tokenTrendHealth: [{ provider: 'openai', value: 1 }],
    tokenTrendVersions: [],
    tokenTrendModelFirstSeen: [],
  })
})

test('test_usageReportTokenTrendSummaryMetadataContract_allows_timeoutFields', () => {
  expectTypeOf<
    UsageReportTokenTrendSummaryResponse['metadata']
  >().toMatchTypeOf<
    {
      from: string
      to: string
      generatedAt?: string
      degraded?: boolean
      degradedReason?: string
      degradedMessage?: string
      timeout?: boolean
      timedOutSubquery?: string
      timedOutSubqueries?: string[]
      skippedSubqueries?: string[]
      unavailableSubqueries?: string[]
      tokenTrendSummaryRawLaneMaxDays?: number
      tokenTrendSummaryRangeDays?: number
      tokenTrendSummaryStatementTimeoutMs?: number
      includeTokenTrendHealth?: boolean
      tokenTrendHealthOmitted?: boolean
    } & ReportCacheMetadata
  >()
})

test('test_fetchUsageReportTokenTrendDay_sends_date_filters_and_signal', async () => {
  let requestedUrl: URL | null = null
  const controller = new AbortController()

  server.use(
    http.get('/api/shell/reports/usage/token-trend-day', ({ request }) => {
      requestedUrl = new URL(request.url)
      expect(controller.signal.aborted).toBe(false)
      return HttpResponse.json({
        metadata: {
          date: '2026-05-20',
          from: '2026-05-20',
          to: '2026-05-21',
        },
        date: '2026-05-20',
        rows: [],
      })
    })
  )

  await expect(
    fetchUsageReportTokenTrendDay(
      {
        from: '2026-05-20',
        to: '2026-05-21',
        date: '2026-05-20',
        provider: ['anthropic', 'openai'],
        repository: ['dashboard-shell'],
        client: ['codex-tui'],
      },
      controller.signal
    )
  ).resolves.toMatchObject({ date: '2026-05-20', rows: [] })

  expect(requestedUrl?.searchParams.get('date')).toBe('2026-05-20')
  expect(requestedUrl?.searchParams.get('from')).toBe('2026-05-20')
  expect(requestedUrl?.searchParams.get('to')).toBe('2026-05-21')
  expect(requestedUrl?.searchParams.get('provider')).toBe('anthropic,openai')
  expect(requestedUrl?.searchParams.get('repository')).toBe('dashboard-shell')
  expect(requestedUrl?.searchParams.get('client')).toBe('codex-tui')
})

test('test_fetchUsageReportTokenTrendDay_uses_server_error_message', async () => {
  server.use(
    http.get('/api/shell/reports/usage/token-trend-day', () =>
      HttpResponse.json({ error: 'bad day' }, { status: 400 })
    )
  )

  await expect(
    fetchUsageReportTokenTrendDay({
      from: '2026-05-20',
      to: '2026-05-21',
      date: '2026-05-20',
    })
  ).rejects.toThrow('bad day')
})

test('test_fetchUsageReport_uses_server_error_message', async () => {
  server.use(
    http.get('/api/shell/reports/usage', () =>
      HttpResponse.json({ error: 'bad usage report' }, { status: 400 })
    )
  )

  await expect(
    fetchUsageReport({ from: '2026-05-20', to: '2026-05-21', grain: 'day' })
  ).rejects.toThrow('bad usage report')
})

test('test_fetchUsageReport_preserves_providerAliasRouting_contract', async () => {
  const future = new Date(Date.now() + 120_000).toISOString()
  server.use(
    http.get('/api/shell/reports/usage', () =>
      HttpResponse.json(
        usageReportPayloadForTests({
          metadata: {
            groupBy: ['provider', 'model'],
          },
          summary: {
            traces: 1,
            token_in: 1,
            token_out: 1,
            token_total: 2,
          },
          providerAliasRouting: {
            data_source: 'recent_observed_session_history',
            freshness_label:
              'Recent observed routing from session history (not live Redis/DualCache)',
            generated_at: '2026-05-21T00:00:00.000Z',
            lookback_hours: 24,
            families: [
              { family: 'codex', observed: true },
              { family: 'anthropic', observed: false },
            ],
            entries: [
              {
                family: 'codex',
                alias_label: 'aawm-code',
                provider: 'openai',
                model: 'gpt-5',
                route_family: 'codex_primary',
                state_kind: 'affinity',
                state_source: 'durable_cache',
                observed_at: '2026-05-21T00:00:00.000Z',
                expires_at: future,
                remaining_seconds: 120,
                is_active: true,
                skipped_candidates: [],
              },
            ],
          },
        })
      )
    )
  )

  const report = await fetchUsageReport({
    from: '2026-05-20',
    to: '2026-05-21',
    grain: 'day',
  })
  expect(report.providerAliasRouting?.entries[0]?.state_kind).toBe('affinity')
  expect(report.providerAliasRouting?.data_source).toBe(
    'recent_observed_session_history'
  )
})

test('test_fetchUsageReport_preserves_providerAuthHealth_contract', async () => {
  const future = new Date(Date.now() + 180_000).toISOString()
  server.use(
    http.get('/api/shell/reports/usage', () =>
      HttpResponse.json(
        usageReportPayloadForTests({
          metadata: {
            groupBy: ['provider', 'model'],
          },
          providerAuthHealth: {
            data_source: 'provider_auth_current',
            freshness_label: 'Current provider credential refresh state',
            generated_at: '2026-05-21T00:00:00.000Z',
            entries: [
              {
                observed_at: '2026-05-21T00:00:00.000Z',
                environment: 'production',
                provider: 'xai',
                auth_family: 'grok_oidc',
                status: 'refreshed',
                attempted: true,
                refreshed: true,
                skipped: false,
                expires_at: future,
                remaining_seconds: 180,
                auth_health_state: 'refreshed',
                source_task: 'grok_oidc_refresh',
                auth_file_hash_short: 'abcd1234',
              },
            ],
          },
        })
      )
    )
  )

  const report = await fetchUsageReport({
    from: '2026-05-20',
    to: '2026-05-21',
    grain: 'day',
  })
  expect(report.providerAuthHealth?.data_source).toBe('provider_auth_current')
  expect(report.providerAuthHealth?.entries[0]?.auth_family).toBe('grok_oidc')
  expect(report.providerAuthHealth?.entries[0]?.auth_health_state).toBe(
    'refreshed'
  )
})

test('test_fetchUsageReport_preserves_providerCreditLifecycle_contract', async () => {
  server.use(
    http.get('/api/shell/reports/usage', () =>
      HttpResponse.json(
        usageReportPayloadForTests({
          metadata: {
            groupBy: ['provider', 'model'],
          },
          providerCreditLifecycle: {
            data_source: 'provider_credit_current',
            freshness_label: 'Current provider credit lifecycle',
            generated_at: '2026-05-21T00:00:00.000Z',
            summaries: [
              {
                environment: 'production',
                provider: 'openai',
                credit_family: 'codex_rate_limit_reset',
                label: 'openai codex_rate_limit_reset credits',
                available_count: 2,
                used_count: 1,
                expired_count: 0,
                total_count: 3,
              },
            ],
            entries: [
              {
                observed_at: '2026-05-21T00:00:00.000Z',
                environment: 'production',
                provider: 'openai',
                account_hash_short: '8e928548',
                credit_family: 'codex_rate_limit_reset',
                status: 'available',
                available_count: 1,
                credit_identity: 'codex-1',
              },
            ],
          },
        })
      )
    )
  )

  const report = await fetchUsageReport({
    from: '2026-05-20',
    to: '2026-05-21',
    grain: 'day',
  })
  expect(report.providerCreditLifecycle?.data_source).toBe(
    'provider_credit_current'
  )
  expect(report.providerCreditLifecycle?.summaries[0]?.available_count).toBe(2)
  expect(report.providerCreditLifecycle?.entries[0]?.credit_identity).toBe(
    'codex-1'
  )
})

test('test_fetchUsageReportQuotaHistory_preserves_degraded_metadata', async () => {
  server.use(
    http.get('/api/shell/reports/usage/quota-history', () =>
      HttpResponse.json({
        metadata: {
          generatedAt: '2026-05-21T00:00:00.000Z',
          degraded: true,
          degradedReason: 'database_timeout',
          degradedMessage: 'Quota history exceeded the bounded timeout.',
          quotaHistoryStatementTimeoutMs: 15000,
        },
        quotaHistory: [],
      })
    )
  )

  await expect(fetchUsageReportQuotaHistory()).resolves.toMatchObject({
    metadata: {
      degraded: true,
      degradedReason: 'database_timeout',
      quotaHistoryStatementTimeoutMs: 15000,
    },
    quotaHistory: [],
  })
})

test('test_fetchUsageReportQuotaHistory_preserves_partial_payload', async () => {
  server.use(
    http.get('/api/shell/reports/usage/quota-history', () =>
      HttpResponse.json({
        metadata: {
          generatedAt: '2026-06-01T00:00:00.000Z',
          degraded: true,
          degradedReason: 'database_timeout',
          degradedMessage:
            'Quota history history_enrichment exceeded the bounded database timeout; returning partial payload from base rows.',
          timeout: true,
          timedOutSubquery: 'history_enrichment',
          timedOutSubqueries: ['history_enrichment'],
          quotaHistoryStatementTimeoutMs: 15000,
        },
        quotaHistory: [
          {
            provider: 'openai',
            model: null,
            quota_type: 'weekly',
            expected_reset_at: '2026-06-01T00:00:00.000Z',
            interval_start: '2026-05-25T00:00:00.000Z',
            interval_end: '2026-06-01T00:00:00.000Z',
            min_remaining_pct: 10,
            max_remaining_pct: 100,
            velocity_segments: [true, false],
            velocity_scores: [0.4, 0.6],
            velocity_sample_count: 2,
            usage_tokens: 1234,
            usage_breakdown: [
              {
                model: 'gpt-5',
                tokens: 1234,
                cost: 1.23,
                traces: 5,
                recent_traces_90m: 2,
              },
            ],
          },
        ],
      })
    )
  )

  const report = await fetchUsageReportQuotaHistory()
  expect(report).toMatchObject({
    metadata: {
      degraded: true,
      degradedReason: 'database_timeout',
      timeout: true,
      timedOutSubquery: 'history_enrichment',
      timedOutSubqueries: ['history_enrichment'],
      quotaHistoryStatementTimeoutMs: 15000,
    },
  })
  expect(report.quotaHistory).toHaveLength(1)
  expect(report.quotaHistory?.[0]?.provider).toBe('openai')
})

test('test_fetchUsageReportQuotaRangeHistory_preserves_partial_payload', async () => {
  server.use(
    http.get('/api/shell/reports/usage/quota-range-history', ({ request }) => {
      const url = new URL(request.url)
      return HttpResponse.json({
        metadata: {
          from: url.searchParams.get('from') ?? '2026-06-01',
          to: url.searchParams.get('to') ?? '2026-06-08',
          generatedAt: '2026-06-01T00:00:00.000Z',
          degraded: true,
          degradedReason: 'database_timeout',
          degradedMessage:
            'Quota range history subquery "history_enrichment" exceeded the bounded database timeout; returning partial payload from base rows.',
          timeout: true,
          timedOutSubquery: 'history_enrichment',
          timedOutSubqueries: ['history_enrichment'],
          quotaRangeHistoryStatementTimeoutMs: 15000,
        },
        quotaRangeHistory: [
          {
            provider: 'openai',
            model: null,
            quota_type: 'weekly',
            expected_reset_at: '2026-06-08T00:00:00.000Z',
            interval_start: '2026-06-01T00:00:00.000Z',
            interval_end: '2026-06-08T00:00:00.000Z',
            min_remaining_pct: 10,
            max_remaining_pct: 100,
            velocity_segments: [],
            velocity_scores: [],
            velocity_sample_count: 0,
            usage_tokens: 0,
            usage_breakdown: [],
          },
        ],
      })
    })
  )

  const report = await fetchUsageReportQuotaRangeHistory({
    from: '2026-06-01',
    to: '2026-06-08',
    cacheBust: 'manual-1',
  })

  expect(report).toMatchObject({
    metadata: {
      from: '2026-06-01',
      to: '2026-06-08',
      degraded: true,
      degradedReason: 'database_timeout',
      timeout: true,
      timedOutSubquery: 'history_enrichment',
      timedOutSubqueries: ['history_enrichment'],
      quotaRangeHistoryStatementTimeoutMs: 15000,
    },
  })
  expect(report.quotaRangeHistory).toHaveLength(1)
  expect(report.quotaRangeHistory[0]?.usage_tokens).toBe(0)
})

// ─────────────────────────────────────────────────────────────────────────────
// Wave 5 / S4-1, S4-5: Boundary-validation and malformed-payload tests
// ─────────────────────────────────────────────────────────────────────────────

describe('test_fetchers_validate_metadata_summary_firstrow', () => {
  // Payload with renamed metadata key — no valid `metadata` field present.
  const malformedMetadata = {
    _metadata_broken: { from: '2026-05-20', to: '2026-05-21' },
    summary: {
      traces: 10,
      token_in: 100,
      token_out: 50,
      usd_cost: 0.1,
    },
    rows: [],
    trend: [],
    clients: [],
    providerLatencyHealth: [],
    providerErrorObservations: [],
    providerStatusUsage: [],
    quotas: [],
    quotaHistory: [],
    toolActivity: [],
  }

  test('fetchUsageReport rejects malformed metadata', async () => {
    server.use(
      http.get('/api/shell/reports/usage', () =>
        HttpResponse.json(malformedMetadata)
      )
    )
    await expect(
      fetchUsageReport({ from: '2026-05-20', to: '2026-05-21', grain: 'day' })
    ).rejects.toThrow()
  })

  test('fetchUsageReport rejects metadata_missing_required_fields', async () => {
    server.use(
      http.get('/api/shell/reports/usage', () =>
        HttpResponse.json({
          metadata: {
            from: '2026-05-20',
            to: '2026-05-21',
          },
          ...(() => {
            const payload = minimalUsageReportPayload()
            const { metadata, ...rest } = payload
            return rest
          })(),
        })
      )
    )

    await expect(
      fetchUsageReport({
        from: '2026-05-20',
        to: '2026-05-21',
        grain: 'day',
      })
    ).rejects.toThrow('Invalid usage report metadata: missing grain')
  })

  test('fetchUsageReport rejects malformed top-level payload_contract_shape', async () => {
    server.use(
      http.get('/api/shell/reports/usage', () =>
        HttpResponse.json({
          metadata: {
            from: '2026-05-20',
            to: '2026-05-21',
            grain: 'day',
            groupBy: ['provider', 'model'],
            limit: USAGE_REPORT_DEFAULT_LIMIT,
            generatedAt: '2026-05-21T00:00:00.000Z',
            latestRecordAt: null,
            latestRecordAgeMinutes: null,
            latestRecordStale: false,
            staleRecordThresholdMinutes: 60,
          },
          summary: null,
          rows: [],
          trend: [],
          clients: [],
          providerLatencyHealth: [],
          providerErrorObservations: [],
          providerStatusUsage: [],
          quotas: [],
          quotaHistory: [],
          toolActivity: [],
        })
      )
    )

    await expect(
      fetchUsageReport({
        from: '2026-05-20',
        to: '2026-05-21',
        grain: 'day',
      })
    ).rejects.toThrow('Invalid usage report summary')
  })

  test('fetchUsageReport rejects malformed summary field types', async () => {
    const payload = minimalUsageReportPayload() as {
      summary: Record<string, unknown>
      rows: Array<Record<string, unknown>>
    }
    payload.summary.token_total = 'three-hundred' as unknown as number

    server.use(
      http.get('/api/shell/reports/usage', () => HttpResponse.json(payload))
    )
    await expect(
      fetchUsageReport({
        from: '2026-05-20',
        to: '2026-05-21',
        grain: 'day',
      })
    ).rejects.toThrow('Invalid usage report summary.token_total')
  })

  test('fetchUsageReport rejects malformed row field types', async () => {
    const payload = minimalUsageReportPayload() as {
      summary: Record<string, unknown>
      rows: Array<Record<string, unknown>>
    }
    payload.rows = [
      {
        bucket: '2026-05-20',
        traces: 12,
        token_in: 20,
        token_out: 30,
        token_cache_input: 0,
        token_cache_creation: 0,
        token_reasoning_reported: 0,
        token_reasoning_estimated: 0,
        token_total: 'bad-total' as unknown as number,
        usd_cost: 0.12,
        cache_miss_usd_cost: 0,
        tool_calls: 0,
        git_commit: 0,
        git_push: 0,
        period_start: '2026-05-20',
        period_end: '2026-05-21',
      },
    ]

    server.use(
      http.get('/api/shell/reports/usage', () => HttpResponse.json(payload))
    )
    await expect(
      fetchUsageReport({
        from: '2026-05-20',
        to: '2026-05-21',
        grain: 'day',
      })
    ).rejects.toThrow('Invalid usage report rows[0].token_total')
  })

  test('fetchUsageReport rejects malformed summary optional field types', async () => {
    const payload = minimalUsageReportPayload() as {
      summary: Record<string, unknown>
      rows: Array<Record<string, unknown>>
    }
    payload.summary.changed_gitignore_true_rows = 'four' as unknown as number

    server.use(
      http.get('/api/shell/reports/usage', () => HttpResponse.json(payload))
    )
    await expect(
      fetchUsageReport({
        from: '2026-05-20',
        to: '2026-05-21',
        grain: 'day',
      })
    ).rejects.toThrow(
      'Invalid usage report summary.changed_gitignore_true_rows'
    )
  })

  test('fetchUsageReport rejects malformed row optional string field types', async () => {
    const payload = minimalUsageReportPayload() as {
      summary: Record<string, unknown>
      rows: Array<Record<string, unknown>>
    }
    payload.rows = [
      {
        bucket: '2026-05-20',
        traces: 12,
        token_total: 40,
        provider: 123 as unknown as string,
      },
    ]

    server.use(
      http.get('/api/shell/reports/usage', () => HttpResponse.json(payload))
    )
    await expect(
      fetchUsageReport({
        from: '2026-05-20',
        to: '2026-05-21',
        grain: 'day',
      })
    ).rejects.toThrow('Invalid usage report rows[0].provider')
  })

  test('fetchUsageReport accepts minimal payloads after stronger contract checks', async () => {
    server.use(
      http.get('/api/shell/reports/usage', () =>
        HttpResponse.json(minimalUsageReportPayload())
      )
    )

    await expect(
      fetchUsageReport({
        from: '2026-05-20',
        to: '2026-05-21',
        grain: 'day',
      })
    ).resolves.toMatchObject({
      summary: {
        traces: 0,
        token_in: 0,
        token_out: 0,
        token_cache_input: 0,
        token_cache_creation: 0,
        token_reasoning_reported: 0,
        token_reasoning_estimated: 0,
        token_total: 0,
      },
      rows: [],
    })
  })

  test('fetchUsageReport accepts missing monolith sections when include flags opt out', async () => {
    let omittedSections: UsageReportMonolithPayloadSection[] = []

    server.use(
      http.get('/api/shell/reports/usage', () =>
        HttpResponse.json(
          minimalUsageReportPayloadWithoutMonolithSections(omittedSections)
        )
      )
    )

    const toggles: Array<{
      request: Pick<
        Parameters<typeof fetchUsageReport>[0],
        'includeQuotas' | 'includeQuotaHistory' | 'includeToolActivity'
      >
      omittedSections: UsageReportMonolithPayloadSection[]
    }> = [
      {
        request: { includeQuotas: false },
        omittedSections: ['quotas'],
      },
      {
        request: { includeQuotaHistory: false },
        omittedSections: ['quotaHistory'],
      },
      {
        request: { includeToolActivity: false },
        omittedSections: ['toolActivity'],
      },
      {
        request: {
          includeQuotas: false,
          includeQuotaHistory: false,
          includeToolActivity: false,
        },
        omittedSections: ['quotas', 'quotaHistory', 'toolActivity'],
      },
    ]

    for (const { request, omittedSections: sectionsToOmit } of toggles) {
      omittedSections = sectionsToOmit
      await expect(
        fetchUsageReport({
          from: '2026-05-20',
          to: '2026-05-21',
          grain: 'day',
          ...request,
        })
      ).resolves.toMatchObject({
        summary: {
          traces: 0,
          token_in: 0,
          token_out: 0,
          token_cache_input: 0,
          token_cache_creation: 0,
          token_reasoning_reported: 0,
          token_reasoning_estimated: 0,
          token_total: 0,
        },
        rows: [],
      })
    }
  })

  test('fetchUsageReport rejects missing monolith sections when defaults include them', async () => {
    let omittedSection: UsageReportMonolithPayloadSection = 'quotas'
    server.use(
      http.get('/api/shell/reports/usage', () =>
        HttpResponse.json(
          minimalUsageReportPayloadWithoutMonolithSections([omittedSection])
        )
      )
    )

    const requiredCases: Array<{
      omittedSection: UsageReportMonolithPayloadSection
      expectedError: string
    }> = [
      {
        omittedSection: 'quotas',
        expectedError: 'Invalid usage report quotas',
      },
      {
        omittedSection: 'quotaHistory',
        expectedError: 'Invalid usage report quotaHistory',
      },
      {
        omittedSection: 'toolActivity',
        expectedError: 'Invalid usage report toolActivity',
      },
    ]

    for (const { omittedSection: section, expectedError } of requiredCases) {
      omittedSection = section
      await expect(
        fetchUsageReport({
          from: '2026-05-20',
          to: '2026-05-21',
          grain: 'day',
        })
      ).rejects.toThrow(expectedError)
    }
  })

  test('fetchUsageReportTokenTrendSummary rejects malformed metadata', async () => {
    server.use(
      http.get('/api/shell/reports/usage/token-trend-summary', () =>
        HttpResponse.json({
          _metadata_broken: {},
          tokenTrendHours: [],
          tokenTrendVersions: [],
        })
      )
    )
    await expect(
      fetchUsageReportTokenTrendSummary({
        from: '2026-05-20',
        to: '2026-05-21',
      })
    ).rejects.toThrow()
  })

  test('fetchUsageReportTokenTrendDay rejects malformed metadata', async () => {
    server.use(
      http.get('/api/shell/reports/usage/token-trend-day', () =>
        HttpResponse.json({
          _metadata_broken: {},
          date: '2026-05-20',
          rows: [],
        })
      )
    )
    await expect(
      fetchUsageReportTokenTrendDay({
        from: '2026-05-20',
        to: '2026-05-21',
        date: '2026-05-20',
      })
    ).rejects.toThrow()
  })

  test('fetchUsageReportQuotas rejects malformed metadata', async () => {
    server.use(
      http.get('/api/shell/reports/quotas', () =>
        HttpResponse.json({ _metadata_broken: {}, quotas: [] })
      )
    )
    await expect(fetchUsageReportQuotas()).rejects.toThrow()
  })

  test('fetchUsageReportQuotaRangeHistory rejects malformed metadata', async () => {
    server.use(
      http.get('/api/shell/reports/usage/quota-range-history', () =>
        HttpResponse.json({ _metadata_broken: {}, quotaRangeHistory: [] })
      )
    )
    await expect(
      fetchUsageReportQuotaRangeHistory({
        from: '2026-05-20',
        to: '2026-05-21',
      })
    ).rejects.toThrow()
  })

  test('fetchUsageReportQuotaHistory rejects malformed metadata', async () => {
    server.use(
      http.get('/api/shell/reports/usage/quota-history', () =>
        HttpResponse.json({ _metadata_broken: {}, quotaHistory: [] })
      )
    )
    await expect(fetchUsageReportQuotaHistory()).rejects.toThrow()
  })

  test('fetchUsageReportQuotaEstimator rejects malformed metadata', async () => {
    server.use(
      http.get('/api/shell/reports/usage/quota-estimator', () =>
        HttpResponse.json({
          _metadata_broken: {},
          coefficients: [],
          lagSensitivity: [],
          cacheReadRatios: [],
          diagnostics: [],
          estimates: [],
        })
      )
    )
    await expect(
      fetchUsageReportQuotaEstimator({ from: '2026-05-20', to: '2026-05-21' })
    ).rejects.toThrow()
  })

  test('fetchUsageReportToolActivity rejects malformed metadata', async () => {
    server.use(
      http.get('/api/shell/reports/usage/tool-activity', () =>
        HttpResponse.json({ _metadata_broken: {}, toolActivity: [] })
      )
    )
    await expect(
      fetchUsageReportToolActivity({ from: '2026-05-20', to: '2026-05-21' })
    ).rejects.toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// S4-3: cacheBust forwarded by fetchUsageReportTokenTrendDay
// ─────────────────────────────────────────────────────────────────────────────
test('test_token_trend_day_forwards_cache_bust', async () => {
  let capturedUrl: URL | null = null

  server.use(
    http.get('/api/shell/reports/usage/token-trend-day', ({ request }) => {
      capturedUrl = new URL(request.url)
      return HttpResponse.json({
        metadata: { date: '2026-05-20', from: '2026-05-20', to: '2026-05-21' },
        date: '2026-05-20',
        rows: [],
      })
    })
  )

  await fetchUsageReportTokenTrendDay({
    from: '2026-05-20',
    to: '2026-05-21',
    date: '2026-05-20',
    cacheBust: 'bust-abc',
  } as Parameters<typeof fetchUsageReportTokenTrendDay>[0])

  expect(capturedUrl?.searchParams.get('cache_bust')).toBe('bust-abc')
})

// ─────────────────────────────────────────────────────────────────────────────
// S4-2: Comma in filter value round-trips without splitting
// ─────────────────────────────────────────────────────────────────────────────

test('test_filter_values_comma_escaped', async () => {
  let capturedUrl: URL | null = null

  server.use(
    http.get('/api/shell/reports/usage', ({ request }) => {
      capturedUrl = new URL(request.url)
      const payload = minimalUsageReportPayload()
      payload.metadata.groupBy = []
      return HttpResponse.json(payload)
    })
  )

  await fetchUsageReport({
    from: '2026-05-20',
    to: '2026-05-21',
    grain: 'day',
    repository: ['acme,corp'],
  })

  const repoParam = capturedUrl?.searchParams.get('repository') ?? ''
  expect(decodeURIComponent(repoParam)).toBe('acme,corp')
  expect(repoParam).not.toBe('acme,corp')
})

test('test_fetchUsageReport_forwards_config_change_filters', async () => {
  let capturedUrl: URL | null = null

  server.use(
    http.get('/api/shell/reports/usage', ({ request }) => {
      capturedUrl = new URL(request.url)
      return HttpResponse.json(minimalUsageReportPayload())
    })
  )

  await fetchUsageReport({
    from: '2026-05-20',
    to: '2026-05-21',
    grain: 'day',
    changed_env_file: ['false', 'null'],
    changed_pre_commit_config: ['true'],
    changed_pyproject_toml: ['unevaluated', 'evaluated'],
    changed_gitignore: ['null'],
  } as Parameters<typeof fetchUsageReport>[0])

  expect(capturedUrl?.searchParams.get('changed_env_file')).toBe('false,null')
  expect(capturedUrl?.searchParams.get('changed_pre_commit_config')).toBe(
    'true'
  )
  expect(capturedUrl?.searchParams.get('changed_pyproject_toml')).toBe(
    'unevaluated,evaluated'
  )
  expect(capturedUrl?.searchParams.get('changed_gitignore')).toBe('null')
})

// ─────────────────────────────────────────────────────────────────────────────
// S4-5: AbortSignal propagation — controller.abort() must reject
// ─────────────────────────────────────────────────────────────────────────────

test('test_real_abort_rejects_with_AbortError', async () => {
  const controller = new AbortController()

  server.use(
    http.get('/api/shell/reports/usage/quota-range-history', async () => {
      // Hang forever — the abort will cancel the request
      await new Promise<never>(() => undefined)
    })
  )

  const fetchPromise = fetchUsageReportQuotaRangeHistory(
    { from: '2026-05-20', to: '2026-05-21' },
    controller.signal
  )

  controller.abort()

  await expect(fetchPromise).rejects.toSatisfy(
    (err: unknown) =>
      err instanceof Error &&
      (err.name === 'AbortError' || err.message.toLowerCase().includes('abort'))
  )
})

test('test_fetchUsageReportSessionDiagnostics_forwards_grok_side_channel_filters', async () => {
  let capturedUrl: URL | null = null

  server.use(
    http.get('/api/shell/reports/usage/session-diagnostics', ({ request }) => {
      capturedUrl = new URL(request.url)
      return HttpResponse.json({
        metadata: {
          from: '2026-05-20',
          to: '2026-05-21',
          limit: 25,
          generatedAt: '2026-05-21T00:00:00.000Z',
        },
        sessionDiagnostics: [
          {
            provider: 'xai',
            model: 'grok-composer-2.5-fast',
            diagnostic_flags: ['grok_side_channel'],
            grok_side_channel: {
              enabled: true,
              endpoint_type: 'register',
              endpoint_template: '/grok/v1/sessions/register',
              content_type: 'application/json',
              body_byte_length: 128,
              body_sha256: 'abc123deadbeef',
              digest_source: 'request_body',
              json_container_type: 'object',
              top_level_key_types: { session: 'object' },
              array_length: null,
            },
          },
        ],
      })
    })
  )

  const response = await fetchUsageReportSessionDiagnostics({
    from: '2026-05-20',
    to: '2026-05-21',
    grok_side_channel: true,
    grok_side_channel_endpoint_type: ['register'],
    limit: 25,
  })

  expect(capturedUrl?.searchParams.get('grok_side_channel')).toBe('true')
  expect(capturedUrl?.searchParams.get('grok_side_channel_endpoint_type')).toBe(
    'register'
  )
  expect(response.sessionDiagnostics[0]?.grok_side_channel).toMatchObject({
    endpoint_type: 'register',
    body_sha256: 'abc123deadbeef',
    digest_source: 'request_body',
  })
  const grok = response.sessionDiagnostics[0]?.grok_side_channel
  expect(grok).toBeDefined()
  expect(grok).not.toHaveProperty('request_body')
  expect(grok).not.toHaveProperty('body_raw')
  expect(grok).not.toHaveProperty('raw_body')
  expect(JSON.stringify(grok)).not.toContain('RAW_SECRET')
})

test('test_fetchUsageReportSessionDiagnostics_forwards_grok_side_channel_false', async () => {
  let capturedUrl: URL | null = null

  server.use(
    http.get('/api/shell/reports/usage/session-diagnostics', ({ request }) => {
      capturedUrl = new URL(request.url)
      return HttpResponse.json({
        metadata: {
          from: '2026-05-20',
          to: '2026-05-21',
          limit: 1,
          generatedAt: '2026-05-21T00:00:00.000Z',
        },
        sessionDiagnostics: [],
      })
    })
  )

  await fetchUsageReportSessionDiagnostics({
    from: '2026-05-20',
    to: '2026-05-21',
    grok_side_channel: false,
    limit: 1,
  })

  expect(capturedUrl?.searchParams.has('grok_side_channel')).toBe(true)
  expect(capturedUrl?.searchParams.get('grok_side_channel')).toEqual('false')
})

// ---------------------------------------------------------------------------
// D1-212/215/213/178/221/222 session diagnostics API contracts
// ---------------------------------------------------------------------------

describe('D1-212/215/213/178/221/222 session diagnostics API contracts', () => {
  test('test_usage_report_types_expose_session_diagnostics_response_and_row_shapes', async () => {
    expectTypeOf<UsageReportSessionDiagnosticsResponse>().toMatchTypeOf<{
      metadata: {
        from: string
        to: string
        limit: number
        generatedAt?: string
      } & ReportCacheMetadata
      sessionDiagnostics: Array<UsageReportSessionDiagnosticsRow>
    }>()
    expectTypeOf<UsageReportSessionDiagnosticsRow>().toMatchTypeOf<{
      diagnostic_flags?: string[]
      diagnostic_categories?: string[]
      grok_oauth?: {
        credential_family?: string | null
        grok_native_oauth_managed?: boolean | string | null
        grok_native_entrypoint?: string | null
      }
      grok_side_channel?: {
        enabled?: boolean | string | null
        endpoint_type?: string | null
        endpoint_template?: string | null
        content_type?: string | null
        body_sha256?: string | null
        digest_source?: string | null
      }
      output_contract?: {
        usage_output_contract_required_final_phrase?: string | null
        usage_output_contract_required_final_phrase_present?:
          | boolean
          | string
          | null
        usage_output_contract_failure_class?: string | null
        usage_output_contract_setup_only_detected?: boolean | string | null
      }
      xai_sanitizer?: {
        xai_responses_request_sanitized?: boolean | string | null
      }
      transcript_attribution?: {
        session_history_transcript_attribution_status?: string | null
        session_history_transcript_attribution_source?: string | null
      }
      tool_definitions?: {
        snapshot_hash?: string | null
      }
      alias_route_events?: unknown
      anthropic_context_window?: {
        mode?: string | null
        requested_tokens?: number | null
      }
    }>()
  })

  test('test_fetchUsageReportSessionDiagnostics_forwards_filters_and_returns_diagnostic_rows', async () => {
    let capturedUrl: URL | null = null

    server.use(
      http.get(
        '/api/shell/reports/usage/session-diagnostics',
        ({ request }) => {
          capturedUrl = new URL(request.url)
          return HttpResponse.json({
            ...usageReportSessionDiagnosticsPayload(),
          })
        }
      )
    )

    const response = await fetchUsageReportSessionDiagnostics({
      from: '2026-05-20',
      to: '2026-05-21',
      provider: ['xai', 'anthropic'],
      model: ['grok-composer-2.5-fast'],
      repository: ['dashboard-shell'],
      client: ['grok-build'],
      limit: 100,
    } as Parameters<typeof fetchUsageReportSessionDiagnostics>[0])

    expect(capturedUrl?.searchParams.get('from')).toBe('2026-05-20')
    expect(capturedUrl?.searchParams.get('to')).toBe('2026-05-21')
    expect(capturedUrl?.searchParams.get('provider')).toBe('xai,anthropic')
    expect(capturedUrl?.searchParams.get('model')).toBe(
      'grok-composer-2.5-fast'
    )
    expect(capturedUrl?.searchParams.get('repository')).toBe('dashboard-shell')
    expect(capturedUrl?.searchParams.get('client')).toBe('grok-build')
    expect(capturedUrl?.searchParams.get('limit')).toBe('100')

    expect(response.sessionDiagnostics[0]).toMatchObject({
      provider: 'xai',
      model: 'grok-composer-2.5-fast',
      diagnostic_flags: ['grok_oauth', 'xai_sanitizer'],
      grok_oauth: {
        credential_family: 'xai_grok_oidc',
        grok_native_oauth_managed: true,
      },
      output_contract: {
        usage_output_contract_required_final_phrase_present: true,
      },
      xai_sanitizer: {
        xai_tool_choice_without_tools_removed_reason: 'missing_tools',
      },
      transcript_attribution: {
        session_history_transcript_attribution_status: 'recoverable',
      },
      tool_definitions: {
        snapshot_hash: 'abc123',
      },
      alias_route_events: [
        {
          alias_model: 'aawm-code',
          event_type: 'candidate_selected',
        },
      ],
      anthropic_context_window: {
        mode: 'extended_1m',
        requested_tokens: 1000000,
        source: 'model_suffix_1m',
        beta: 'context-1m-2025-08-07',
        classification: { label: 'extended_1m', evidence: 'suffix' },
      },
    })
  })

  test('test_fetchUsageReportSessionDiagnostics_normalizes_stringish_boolean_fields', async () => {
    server.use(
      http.get('/api/shell/reports/usage/session-diagnostics', () =>
        HttpResponse.json({
          metadata: {
            from: '2026-05-20',
            to: '2026-05-21',
            limit: 1,
            generatedAt: '2026-05-21T00:00:00.000Z',
          },
          sessionDiagnostics: [
            {
              provider: 'xai',
              model: 'grok-composer-2.5-fast',
              grok_oauth: {
                credential_family: 'xai_grok_oidc',
                grok_native_oauth_managed: 'true',
              },
              grok_side_channel: {
                enabled: '0',
                endpoint_type: 'tool_register',
              },
              output_contract: {
                usage_output_contract_required_final_phrase_present: 'false',
                usage_output_contract_setup_only_detected: '1',
              },
              xai_sanitizer: {
                xai_responses_request_sanitized: '1',
              },
              tool_definitions: {
                snapshot_hash: 'abc123',
                aawm_tool_definition_snapshot_truncated: '0',
              },
              alias_route_events: [
                {
                  alias_model: 'aawm-code',
                  redispatch_required: '1',
                  last_resort: 'false',
                  attempt_number: '7',
                },
              ],
            },
          ],
        })
      )
    )

    const response = await fetchUsageReportSessionDiagnostics({
      from: '2026-05-20',
      to: '2026-05-21',
      provider: ['xai'],
      limit: 1,
    } as Parameters<typeof fetchUsageReportSessionDiagnostics>[0])

    expect(response.sessionDiagnostics[0].grok_oauth).toMatchObject({
      grok_native_oauth_managed: true,
    })
    expect(response.sessionDiagnostics[0].grok_side_channel).toMatchObject({
      enabled: false,
    })
    expect(
      response.sessionDiagnostics[0].output_contract
        ?.usage_output_contract_required_final_phrase_present
    ).toBe(false)
    expect(
      response.sessionDiagnostics[0].output_contract
        ?.usage_output_contract_setup_only_detected
    ).toBe(true)
    expect(
      response.sessionDiagnostics[0].xai_sanitizer
        ?.xai_responses_request_sanitized
    ).toBe(true)
    expect(
      response.sessionDiagnostics[0].tool_definitions
        ?.aawm_tool_definition_snapshot_truncated
    ).toBe(false)
    expect(
      response.sessionDiagnostics[0].alias_route_events?.[0]
    ).toMatchObject({
      redispatch_required: true,
      last_resort: false,
    })
    expect(
      response.sessionDiagnostics[0].alias_route_events?.[0]?.attempt_number
    ).toBe('7')
  })
})

test('test_fetchShellHealth_validates_shell_health_payload_shape', async () => {
  server.use(
    http.get('/api/shell/health', () =>
      HttpResponse.json({
        ok: true,
        sourceTables: {
          status: 'ok',
          checkedAt: '2026-07-01T00:00:00.000Z',
          tables: [],
        },
      })
    )
  )

  await expect(fetchShellHealth()).resolves.toMatchObject({ ok: true })
})

test('test_fetchShellHealth_rejects_nonBoolean_ok', async () => {
  server.use(
    http.get('/api/shell/health', () =>
      HttpResponse.json({ ok: 'not-a-boolean' as unknown as boolean })
    )
  )

  await expect(fetchShellHealth()).rejects.toThrow(
    'Invalid shell health response: missing ok'
  )
})

test('test_fetchShellHealth_rejects_malformed_source_tables_payload', async () => {
  server.use(
    http.get('/api/shell/health', () =>
      HttpResponse.json({
        ok: true,
        sourceTables: {
          status: 'ok',
          checkedAt: '2026-07-01T00:00:00.000Z',
          tables: 'not-an-array',
        },
      })
    )
  )

  await expect(fetchShellHealth()).rejects.toThrow(
    'Invalid shell health payload sourceTables'
  )
})

// ---------------------------------------------------------------------------
// D1-223/224/225 usage identity and billing contracts
// ---------------------------------------------------------------------------

describe('D1-223/224/225 usage identity and billing contracts', () => {
  test('test_usage_report_types_expose_inbound_model_alias_agent_name_and_agent_id', async () => {
    expectTypeOf<UsageReportFilterParams>().toMatchTypeOf<{
      inbound_model_alias?: readonly string[]
      agent_name?: readonly string[]
      agent_id?: readonly string[]
    }>()
  })

  test('test_fetchUsageReport_forwards_inbound_model_alias_agent_name_and_agent_id_filters', async () => {
    let capturedUrl: URL | null = null

    server.use(
      http.get('/api/shell/reports/usage', ({ request }) => {
        capturedUrl = new URL(request.url)
        return HttpResponse.json({
          metadata: {
            from: '2026-05-20',
            to: '2026-05-21',
            grain: 'day',
            groupBy: [
              'repository',
              'inbound_model_alias',
              'agent_name',
              'agent_id',
            ],
            limit: USAGE_REPORT_DEFAULT_LIMIT,
            generatedAt: '2026-05-21T00:00:00.000Z',
            latestRecordAt: null,
            latestRecordAgeMinutes: null,
            latestRecordStale: false,
            staleRecordThresholdMinutes: 60,
          },
          summary: {
            traces: 0,
            token_in: 0,
            token_out: 0,
            token_cache_input: 0,
            token_cache_creation: 0,
            token_reasoning_reported: 0,
            token_reasoning_estimated: 0,
            token_total: 0,
            usd_cost: 0,
            cache_miss_usd_cost: 0,
            tool_calls: 0,
            git_commit: 0,
            git_push: 0,
            period_start: '2026-05-20',
            period_end: '2026-05-21',
            latest_record_at: null,
          },
          trend: [],
          clients: [],
          providerLatencyHealth: [],
          providerErrorObservations: [],
          providerStatusUsage: [],
          quotas: [],
          quotaHistory: [],
          toolActivity: [],
          rows: [],
        })
      })
    )

    await fetchUsageReport({
      from: '2026-05-20',
      to: '2026-05-21',
      grain: 'day',
      groupBy: ['repository', 'inbound_model_alias', 'agent_name', 'agent_id'],
      inbound_model_alias: ['aawm-read-anthropic'],
      agent_name: ['orchestrator'],
      agent_id: ['agent_harness'],
    } as Parameters<typeof fetchUsageReport>[0])

    expect(capturedUrl?.searchParams.get('group_by')).toBe(
      'repository,inbound_model_alias,agent_name,agent_id'
    )
    expect(capturedUrl?.searchParams.get('inbound_model_alias')).toBe(
      'aawm-read-anthropic'
    )
    expect(capturedUrl?.searchParams.get('agent_name')).toBe('orchestrator')
    expect(capturedUrl?.searchParams.get('agent_id')).toBe('agent_harness')
  })

  test('test_fetchUsageReportToolActivity_forwards_agent_id_filter_and_returns_grouped_rows', async () => {
    let capturedUrl: URL | null = null

    server.use(
      http.get('/api/shell/reports/usage/tool-activity', ({ request }) => {
        capturedUrl = new URL(request.url)
        return HttpResponse.json({
          metadata: {
            from: '2026-05-20',
            to: '2026-05-21',
            generatedAt: '2026-05-21T00:00:00.000Z',
            degraded: true,
            degradedReason: 'database_timeout',
            toolActivityRecentRowLimit: 5000,
          },
          toolActivity: [
            {
              provider: 'anthropic',
              model: 'claude-sonnet-4-6',
              agent_names: ['orchestrator'],
              agent_ids: ['agent_harness'],
              kind: 'outer',
              label: 'Bash',
              calls: 3,
            },
          ],
        })
      })
    )

    const response = await fetchUsageReportToolActivity({
      from: '2026-05-20',
      to: '2026-05-21',
      agent_id: ['agent_harness'],
    } as Parameters<typeof fetchUsageReportToolActivity>[0])

    expect(capturedUrl?.searchParams.get('agent_id')).toBe('agent_harness')
    expect(response.metadata).toMatchObject({
      degraded: true,
      degradedReason: 'database_timeout',
      toolActivityRecentRowLimit: 5000,
    })
    expect(response.toolActivity[0]).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      agent_names: ['orchestrator'],
      agent_ids: ['agent_harness'],
      kind: 'outer',
      label: 'Bash',
      calls: 3,
    })
  })

  test('test_quota_response_contract_surfaces_billing_detail_fields', async () => {
    expectTypeOf<UsageReportQuotaBillingDetail>().toMatchTypeOf<{
      quota_key?: string | null
      source?: string | null
      client?: string | null
      quota_unit?: string | null
      quota_limit?: number | null
      quota_used?: number | null
      quota_remaining?: number | null
      billing_period_start_at?: string | null
      billing_period_end_at?: string | null
      raw_provider_fields?: Record<string, unknown>
      evidence?: Record<string, unknown>
    }>()
  })

  test('test_usage_report_quota_history_row_accepts_grok_build_identity_fields', () => {
    const row: UsageReportQuotaHistoryRow = {
      provider: 'xai',
      model: 'xai_grok_build_weekly_credits:credits',
      quota_type: 'weekly',
      quota_key: 'xai_grok_build_weekly_credits:credits',
      source: 'grok-build',
      client: 'grok-build',
      quota_unit: 'credits',
      expected_reset_at: '2026-07-01T00:00:00.000Z',
      interval_start: '2026-06-24T00:00:00.000Z',
      interval_end: '2026-07-01T00:00:00.000Z',
      min_remaining_pct: 98,
      max_remaining_pct: 100,
      usage_tokens: 0,
      usage_breakdown: [],
    }
    expect(row.quota_key).toBe('xai_grok_build_weekly_credits:credits')
    expect(row.quota_unit).toBe('credits')
  })
})

// D1-451 Wave 4 — G4 ProviderCreditLifecycleStatus tightened or documented
describe('D1-451 G4 — UsageReportProviderCreditLifecycleStatus', () => {
  test('test_credit_lifecycle_status_is_closed_union_not_collapsed_string', () => {
    type StatusWithoutStringFallback = Exclude<
      UsageReportProviderCreditLifecycleStatus,
      string
    >
    expectTypeOf<StatusWithoutStringFallback>().toEqualTypeOf<
      'available' | 'used' | 'expired'
    >()
    // RED: `| string` on the exported type collapses assignability — remove fallback or document.
    expectTypeOf<UsageReportProviderCreditLifecycleStatus>().not.toEqualTypeOf<
      'available' | 'used' | 'expired'
    >()
  })
})
