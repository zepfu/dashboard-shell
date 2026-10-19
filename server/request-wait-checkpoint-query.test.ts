import { afterEach, describe, expect, test } from 'vitest'
import { __usageReportTestHelpers } from './report-service'
import {
  BadRequestError,
  MAX_REQUEST_WAIT_CHECKPOINT_ROWS,
  assembleRequestWaitDiagnostics,
  buildRequestWaitCheckpointQuery,
  normalizeRequestWaitCheckpointRow,
} from './request-wait-checkpoint-query.mjs'

const GENERATED_AT = '2026-05-02T12:00:40.000Z'

afterEach(() => {
  __usageReportTestHelpers.resetQueryReportDatabaseTestImpl()
})

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    sequence: 4,
    status: 'running',
    started_at: '2026-05-02T12:00:00.000Z',
    updated_at: '2026-05-02T12:00:30.000Z',
    current_waits: [
      { type: 'request_body', started_at: '2026-05-02T12:00:01.000Z' },
      { type: 'downstream_send', started_at: '2026-05-02T12:00:02.000Z' },
    ],
    durations_ms: { request_body: 1500, downstream_send: 2200 },
    counts: { request_body: 1, downstream_send: 2 },
    ...overrides,
  }
}

function checkpointRow(overrides: Record<string, unknown> = {}) {
  const { wait_accounting: waitAccounting, ...rest } = overrides
  return {
    litellm_call_id: 'call-overlap',
    session_id: 'sess-overlap',
    call_type: 'acompletion',
    checkpoint_only: false,
    qualifying_session_history: true,
    created_at: '2026-05-02T12:00:00.000Z',
    start_time: '2026-05-02T12:00:00.000Z',
    end_time: null,
    provider: 'anthropic',
    model: 'claude',
    repository: 'dashboard-shell',
    client: 'codex',
    environment: 'prod',
    trace_id: 'trace-overlap',
    host_name: null,
    client_ip: null,
    provider_response_id: null,
    history_empty_completion_failure: null,
    wait_accounting: waitAccounting ?? snapshot(),
    ...rest,
  }
}

describe('buildRequestWaitCheckpointQuery', () => {
  test('bounds a correlated read of current checkpoints, including history-independent rows', () => {
    const query = buildRequestWaitCheckpointQuery(
      new URLSearchParams({
        from: '2026-05-01',
        to: '2026-05-08',
        provider: 'xai,anthropic',
        model: 'grok-4',
        repository: 'dashboard-shell',
        client: 'codex',
        environment: 'prod',
        session_id: 'sess-1',
        trace_id: 'trace-1',
        litellm_call_id: 'call-1',
        limit: '25',
      })
    )

    expect(query.metadata).toEqual({
      from: '2026-05-01',
      to: '2026-05-08',
      limit: 25,
    })
    expect(query.values).toEqual([
      '2026-05-01',
      '2026-05-08',
      ['xai', 'anthropic'],
      ['grok-4'],
      ['dashboard-shell'],
      ['codex'],
      ['prod'],
      ['sess-1'],
      ['trace-1'],
      ['call-1'],
      25,
    ])
    expect(query.sql).toContain('FROM public.session_history sh')
    expect(query.sql).toContain("sh.metadata ? 'wait_accounting'")
    expect(query.sql).toContain('AS checkpoint_only')
    expect(query.sql).toContain('AS qualifying_session_history')
    expect(query.sql).toContain(
      "(sh.call_type IS NULL AND sh.metadata ? 'wait_accounting')"
    )
    expect(query.sql).toContain(
      "sh.metadata->'wait_accounting'->>'status' AS checkpoint_status"
    )
    expect(query.sql).toContain(
      "sh.metadata->'wait_accounting'->>'sequence' AS checkpoint_sequence"
    )
    expect(query.sql).toContain(
      "sh.metadata->'wait_accounting'->>'updated_at' AS checkpoint_updated_at"
    )
    expect(query.sql).toContain(
      "sh.metadata->'wait_accounting'->'current_waits' AS current_waits"
    )
    expect(query.sql).toContain(
      "sh.metadata->'wait_accounting'->'durations_ms' AS durations_ms"
    )
    expect(query.sql).toContain(
      "sh.metadata->'wait_accounting'->'counts' AS counts"
    )
    expect(query.sql).toContain('sh.end_time')
    expect(query.sql).toContain('LIMIT $11')
    expect(query.sql).toContain('sh.session_id::text')
    expect(query.sql).toContain('sh.litellm_call_id::text')

    const where = query.sql.split('WHERE')[1] ?? ''
    expect(where).toContain("sh.metadata ? 'wait_accounting'")
    expect(where).not.toContain('call_type IS NOT NULL')
    expect(where).not.toContain('usage_output_contract')
    expect(where).not.toContain('response_cost_usd')
    expect(query.sql).not.toMatch(/\bSUM\s*\(/i)
    expect(query.sql).not.toMatch(/\bINSERT\b/i)
    expect(query.sql).not.toMatch(/\bUPDATE\b/i)
    expect(query.sql).not.toMatch(/\bDELETE\b/i)
  })

  test('clamps the checkpoint limit and rejects invalid dates', () => {
    const query = buildRequestWaitCheckpointQuery(
      new URLSearchParams({
        from: '2026-05-01',
        to: '2026-05-08',
        limit: '9000',
      })
    )
    expect(query.metadata.limit).toBe(MAX_REQUEST_WAIT_CHECKPOINT_ROWS)
    expect(query.values[query.values.length - 1]).toBe(
      MAX_REQUEST_WAIT_CHECKPOINT_ROWS
    )

    expect(() =>
      buildRequestWaitCheckpointQuery(
        new URLSearchParams({ from: '05-01-2026', to: '2026-05-08' })
      )
    ).toThrow(BadRequestError)
  })
})

describe('normalizeRequestWaitCheckpointRow', () => {
  test('retains overlapping wait categories instead of summing them', () => {
    const checkpoint = normalizeRequestWaitCheckpointRow(
      checkpointRow({
        wait_accounting: snapshot({
          current_waits: [
            { type: 'request_body', started_at: '2026-05-02T12:00:01.000Z' },
            { type: 'request_body', started_at: '2026-05-02T12:00:03.000Z' },
            {
              type: 'downstream_send',
              started_at: '2026-05-02T12:00:02.000Z',
            },
          ],
        }),
      }),
      { generatedAt: GENERATED_AT }
    )

    expect(checkpoint).not.toBeNull()
    expect(checkpoint?.activity).toBe('active')
    expect(checkpoint?.freshness).toBe('fresh')
    expect(checkpoint?.display_states).toEqual([
      'correlated_session_history',
      'active',
    ])
    expect(checkpoint?.active_wait_categories).toEqual([
      { type: 'request_body', started_at: '2026-05-02T12:00:01.000Z' },
      { type: 'request_body', started_at: '2026-05-02T12:00:03.000Z' },
      { type: 'downstream_send', started_at: '2026-05-02T12:00:02.000Z' },
    ])
    expect(checkpoint?.durations_ms).toEqual({
      request_body: 1500,
      downstream_send: 2200,
    })
    expect(checkpoint?.counts).toEqual({ request_body: 1, downstream_send: 2 })
    expect(checkpoint?.summed_duration_ms).toBeNull()
    expect(checkpoint?.durations_are_disjoint).toBe(false)
    expect(checkpoint?.accounting_duration_is_timeout).toBe(false)
    expect(checkpoint?.sequence).toBe(4)
    const separateTotal = Object.values(checkpoint?.durations_ms ?? {}).reduce(
      (sum, value) => sum + value,
      0
    )
    expect(separateTotal).toBe(3700)
    expect(checkpoint?.summed_duration_ms).not.toBe(separateTotal)
  })

  test('marks checkpoint age stale without treating a long accounting duration as a timeout', () => {
    const stale = normalizeRequestWaitCheckpointRow(
      checkpointRow({
        litellm_call_id: 'call-stale',
        wait_accounting: snapshot({
          sequence: 8,
          updated_at: '2026-05-02T11:50:00.000Z',
          current_waits: [
            {
              type: 'provider_stream',
              started_at: '2026-05-02T11:49:00.000Z',
            },
          ],
          durations_ms: { provider_stream: 50 },
          counts: { provider_stream: 1 },
        }),
      }),
      { generatedAt: GENERATED_AT }
    )
    const longButFresh = normalizeRequestWaitCheckpointRow(
      checkpointRow({
        litellm_call_id: 'call-long',
        wait_accounting: snapshot({
          updated_at: '2026-05-02T12:00:39.000Z',
          current_waits: [
            {
              type: 'provider_stream',
              started_at: '2026-05-02T11:00:00.000Z',
            },
          ],
          durations_ms: { provider_stream: 3_600_000 },
          counts: { provider_stream: 1 },
        }),
      }),
      { generatedAt: GENERATED_AT }
    )

    expect(stale?.activity).toBe('stale')
    expect(stale?.freshness).toBe('stale')
    expect(stale?.freshness_basis).toBe('checkpoint_updated_at')
    expect(stale?.freshness_age_seconds).toBeGreaterThan(60)
    expect(stale?.active_wait_categories.map((wait) => wait.type)).toEqual([
      'provider_stream',
    ])
    expect(stale?.durations_ms).toEqual({ provider_stream: 50 })
    expect(stale?.accounting_duration_is_timeout).toBe(false)
    expect(stale?.display_states).toContain('stale')
    expect(stale?.outcome_note).toContain('not a timeout')

    expect(longButFresh?.activity).toBe('active')
    expect(longButFresh?.freshness).toBe('fresh')
    expect(longButFresh?.durations_ms?.provider_stream).toBe(3_600_000)
    expect(longButFresh?.accounting_duration_is_timeout).toBe(false)
  })

  test('keeps checkpoint-only rows that have no qualifying session history', () => {
    const checkpoint = normalizeRequestWaitCheckpointRow(
      checkpointRow({
        litellm_call_id: 'call-checkpoint-only',
        session_id: 'request:call-checkpoint-only',
        call_type: null,
        checkpoint_only: true,
        qualifying_session_history: false,
        end_time: null,
        provider_response_id: null,
        wait_accounting: JSON.stringify(
          snapshot({
            sequence: 2,
            status: 'running',
            updated_at: '2026-05-02T12:00:35.000Z',
            current_waits: [
              { type: 'request_body', started_at: '2026-05-02T12:00:10.000Z' },
            ],
            durations_ms: { request_body: 25 },
            counts: { request_body: 1 },
          })
        ),
      }),
      { generatedAt: GENERATED_AT }
    )

    expect(checkpoint?.record_attribution).toBe('checkpoint_only')
    expect(checkpoint?.qualifying_session_history).toBe(false)
    expect(checkpoint?.display_states).toContain('checkpoint_only')
    expect(checkpoint?.activity).toBe('active')
    expect(checkpoint?.session_history_end_time).toBeNull()
    expect(checkpoint?.provider_content_outcome).toBe('not_established')
    expect(checkpoint?.final_delivery_outcome).toBe('not_established')
    expect(checkpoint?.durations_ms).toEqual({ request_body: 25 })
    expect(checkpoint?.sequence).toBe(2)
  })

  test('separates completed ASGI processing from provider content and final delivery', () => {
    const checkpoint = normalizeRequestWaitCheckpointRow(
      checkpointRow({
        litellm_call_id: 'call-asgi',
        end_time: null,
        history_empty_completion_failure: null,
        provider_response_id: 'resp-recorded',
        wait_accounting: snapshot({
          sequence: 9,
          status: 'completed',
          updated_at: '2026-05-02T12:00:20.000Z',
          current_waits: [],
          durations_ms: { downstream_send: 40, request_body: 15 },
          counts: { downstream_send: 1, request_body: 1 },
        }),
      }),
      { generatedAt: GENERATED_AT }
    )

    expect(checkpoint?.activity).toBe('completed_asgi')
    expect(checkpoint?.checkpoint_status).toBe('completed')
    expect(checkpoint?.display_states).toContain('completed')
    expect(checkpoint?.asgi_completion_at).toBe('2026-05-02T12:00:20.000Z')
    expect(checkpoint?.session_history_end_time).toBeNull()
    expect(checkpoint?.asgi_establishes_provider_success).toBe(false)
    expect(checkpoint?.asgi_establishes_final_delivery).toBe(false)
    expect(checkpoint?.provider_content_outcome).toBe('not_established')
    expect(checkpoint?.final_delivery_outcome).toBe('not_established')
    expect(checkpoint?.provider_response_id).toBe('resp-recorded')
    expect(checkpoint?.durations_ms).toEqual({
      downstream_send: 40,
      request_body: 15,
    })
    expect(checkpoint?.summed_duration_ms).toBeNull()
  })
})

describe('assembleRequestWaitDiagnostics', () => {
  test('correlates current snapshots, keeps checkpoint-only rows, and marks missing requests', () => {
    const assembled = assembleRequestWaitDiagnostics({
      metadata: { from: '2026-05-01', to: '2026-05-08', limit: 100 },
      generatedAt: GENERATED_AT,
      sessionDiagnostics: [
        {
          litellm_call_id: 'call-overlap',
          session_id: 'sess-overlap',
          provider: 'anthropic',
          model: 'claude',
          end_time: null,
        },
        {
          litellm_call_id: 'call-missing',
          session_id: 'sess-missing',
          provider: 'openai',
          model: 'gpt-5',
          end_time: '2026-05-02T12:09:00.000Z',
        },
      ],
      checkpointRows: [
        checkpointRow({
          wait_accounting: snapshot({
            sequence: 1,
            durations_ms: { request_body: 100_000 },
            counts: { request_body: 4 },
            current_waits: [],
          }),
        }),
        checkpointRow(),
        checkpointRow({
          litellm_call_id: 'call-checkpoint-only',
          session_id: 'request:call-checkpoint-only',
          call_type: null,
          checkpoint_only: true,
          qualifying_session_history: false,
          end_time: null,
          wait_accounting: snapshot({
            sequence: 3,
            updated_at: '2026-05-02T12:00:36.000Z',
            current_waits: [
              { type: 'request_body', started_at: '2026-05-02T12:00:10.000Z' },
            ],
            durations_ms: { request_body: 25 },
            counts: { request_body: 1 },
          }),
        }),
      ],
    })

    expect(assembled.requestWaitCheckpoints).toHaveLength(2)
    const overlap = assembled.sessionDiagnostics[0]?.request_wait_checkpoint
    expect(overlap?.sequence).toBe(4)
    expect(overlap?.durations_ms).toEqual({
      request_body: 1500,
      downstream_send: 2200,
    })
    expect(overlap?.durations_ms?.request_body).not.toBe(101_500)
    expect(overlap?.record_attribution).toBe('correlated_session_history')

    const missing = assembled.sessionDiagnostics[1]?.request_wait_checkpoint
    expect(missing?.record_attribution).toBe('missing')
    expect(missing?.missing_reason).toBe('no_durable_checkpoint')
    expect(missing?.display_states).toEqual(['missing'])
    expect(missing?.session_history_end_time).toBe('2026-05-02T12:09:00.000Z')
    expect(missing?.provider_content_outcome).toBe('not_established')
    expect(missing?.final_delivery_outcome).toBe('not_established')
    expect(missing?.asgi_establishes_provider_success).toBe(false)

    const checkpointOnly = assembled.requestWaitCheckpoints.find(
      (row) => row.litellm_call_id === 'call-checkpoint-only'
    )
    expect(checkpointOnly?.record_attribution).toBe('checkpoint_only')
    expect(checkpointOnly?.qualifying_session_history).toBe(false)
    expect(
      assembled.sessionDiagnostics.some(
        (row) => row.litellm_call_id === 'call-checkpoint-only'
      )
    ).toBe(false)
  })
})

describe('loadUsageSessionDiagnostics wait checkpoints', () => {
  test('returns history-independent checkpoints when session diagnostics has no qualifying row', async () => {
    const now = Date.now()
    const freshUpdated = new Date(now - 5_000).toISOString()
    const queries: string[] = []
    __usageReportTestHelpers.setQueryReportDatabaseTestImpl(async (sql) => {
      queries.push(sql)
      if (sql.includes('AS checkpoint_only')) {
        return {
          rows: [
            checkpointRow({
              litellm_call_id: 'call-checkpoint-only',
              session_id: 'request:call-checkpoint-only',
              call_type: null,
              checkpoint_only: true,
              qualifying_session_history: false,
              end_time: null,
              created_at: new Date(now - 5_000).toISOString(),
              wait_accounting: snapshot({
                sequence: 6,
                status: 'running',
                updated_at: freshUpdated,
                current_waits: [
                  { type: 'request_body', started_at: freshUpdated },
                  { type: 'downstream_send', started_at: freshUpdated },
                ],
                durations_ms: { request_body: 12, downstream_send: 9 },
                counts: { request_body: 1, downstream_send: 1 },
              }),
            }),
          ],
        }
      }
      return { rows: [] }
    })

    const report = await __usageReportTestHelpers.loadUsageSessionDiagnostics(
      new URLSearchParams({
        from: '2026-05-01',
        to: '2026-05-08',
        limit: '20',
      })
    )

    expect(queries.some((sql) => sql.includes('AS checkpoint_only'))).toBe(true)
    expect(
      queries.some((sql) => sql.includes("metadata ? 'wait_accounting'"))
    ).toBe(true)
    expect(report.sessionDiagnostics).toEqual([])
    expect(report.requestWaitCheckpoints).toHaveLength(1)
    const checkpoint = report.requestWaitCheckpoints[0]
    expect(checkpoint?.record_attribution).toBe('checkpoint_only')
    expect(checkpoint?.qualifying_session_history).toBe(false)
    expect(checkpoint?.activity).toBe('active')
    expect(checkpoint?.durations_ms).toEqual({
      request_body: 12,
      downstream_send: 9,
    })
    expect(checkpoint?.summed_duration_ms).toBeNull()
    expect(checkpoint?.provider_content_outcome).toBe('not_established')
    expect(checkpoint?.final_delivery_outcome).toBe('not_established')
    expect(report.metadata.requestWaitCheckpointFreshnessSeconds).toBe(60)
  })
})
