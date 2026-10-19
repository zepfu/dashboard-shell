import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'
import { server } from '../../../test/setup'
import {
  fetchUsageReportSessionDiagnostics,
  type RequestWaitCheckpointDiagnostics,
} from './usage-report'

const OUTCOME_NOTE =
  'Recorded wait categories overlap and are not disjoint elapsed time. An accounting duration is not a timeout. ASGI checkpoint completion does not establish provider content success or final delivery.'

function checkpoint(
  overrides: Partial<RequestWaitCheckpointDiagnostics> &
    Pick<
      RequestWaitCheckpointDiagnostics,
      'litellm_call_id' | 'record_attribution' | 'activity'
    >
): RequestWaitCheckpointDiagnostics {
  return {
    session_id: 'sess',
    missing_reason: null,
    display_states:
      overrides.activity === 'missing'
        ? ['missing']
        : [
            overrides.record_attribution,
            overrides.activity === 'completed_asgi'
              ? 'completed'
              : overrides.activity,
          ],
    checkpoint_status:
      overrides.activity === 'completed_asgi' ? 'completed' : 'running',
    freshness: overrides.activity === 'stale' ? 'stale' : 'fresh',
    freshness_age_seconds: overrides.activity === 'stale' ? 600 : 5,
    freshness_threshold_seconds: 60,
    freshness_basis: 'checkpoint_updated_at',
    sequence: 4,
    checkpoint_started_at: '2026-05-02T12:00:00.000Z',
    checkpoint_updated_at: '2026-05-02T12:00:30.000Z',
    asgi_completion_at:
      overrides.activity === 'completed_asgi'
        ? '2026-05-02T12:00:20.000Z'
        : null,
    session_history_start_time: '2026-05-02T12:00:00.000Z',
    session_history_end_time: null,
    active_wait_categories: [],
    durations_ms: {},
    counts: {},
    durations_are_disjoint: false,
    summed_duration_ms: null,
    duration_accounting: 'overlapping_categories',
    accounting_duration_is_timeout: false,
    asgi_establishes_provider_success: false,
    asgi_establishes_final_delivery: false,
    provider_content_outcome: 'not_established',
    provider_content_source: 'unavailable',
    final_delivery_outcome: 'not_established',
    outcome_note: OUTCOME_NOTE,
    qualifying_session_history:
      overrides.record_attribution === 'correlated_session_history',
    provider: 'anthropic',
    model: 'claude',
    created_at: '2026-05-02T12:00:00.000Z',
    repository: 'dashboard-shell',
    client: 'codex',
    environment: 'prod',
    trace_id: null,
    host_name: null,
    client_ip: null,
    provider_response_id: null,
    history_empty_completion_failure: null,
    generated_at: '2026-05-02T12:00:40.000Z',
    ...overrides,
  }
}

describe('fetchUsageReportSessionDiagnostics wait checkpoints', () => {
  test('preserves overlap, stale checkpoints, and history-independent records', async () => {
    const overlap = {
      ...checkpoint({
        litellm_call_id: 'call-overlap',
        record_attribution: 'correlated_session_history',
        activity: 'active',
        active_wait_categories: [
          { type: 'request_body', started_at: '2026-05-02T12:00:01.000Z' },
          { type: 'downstream_send', started_at: '2026-05-02T12:00:02.000Z' },
        ],
        durations_ms: { request_body: 1500, downstream_send: 2200 },
        counts: { request_body: 1, downstream_send: 2 },
      }),
      summed_duration_ms: 3700,
      durations_are_disjoint: true,
      provider_content_outcome: 'success',
      final_delivery_outcome: 'delivered',
      asgi_establishes_provider_success: true,
    }
    const stale = checkpoint({
      litellm_call_id: 'call-stale',
      record_attribution: 'correlated_session_history',
      activity: 'stale',
      freshness: 'stale',
      freshness_age_seconds: 640,
      sequence: 8,
      active_wait_categories: [
        { type: 'provider_stream', started_at: '2026-05-02T11:49:00.000Z' },
      ],
      durations_ms: { provider_stream: 50 },
      counts: { provider_stream: 1 },
    })
    const checkpointOnly = checkpoint({
      litellm_call_id: 'call-checkpoint-only',
      session_id: 'request:call-checkpoint-only',
      record_attribution: 'checkpoint_only',
      activity: 'active',
      qualifying_session_history: false,
      sequence: 2,
      active_wait_categories: [
        { type: 'request_body', started_at: '2026-05-02T12:00:10.000Z' },
      ],
      durations_ms: { request_body: 25 },
      counts: { request_body: 1 },
    })
    const completed = checkpoint({
      litellm_call_id: 'call-asgi',
      record_attribution: 'correlated_session_history',
      activity: 'completed_asgi',
      checkpoint_status: 'completed',
      asgi_completion_at: '2026-05-02T12:00:20.000Z',
      active_wait_categories: [],
      durations_ms: { downstream_send: 40, request_body: 15 },
      counts: { downstream_send: 1, request_body: 1 },
    })

    server.use(
      http.get('/api/shell/reports/usage/session-diagnostics', () =>
        HttpResponse.json({
          metadata: {
            from: '2026-05-01',
            to: '2026-05-08',
            limit: 20,
            generatedAt: '2026-05-02T12:00:40.000Z',
            requestWaitCheckpointFreshnessSeconds: 60,
          },
          sessionDiagnostics: [
            {
              litellm_call_id: 'call-missing',
              session_id: 'sess-missing',
              provider: 'openai',
              model: 'gpt-5',
              request_wait_checkpoint: checkpoint({
                litellm_call_id: 'call-missing',
                session_id: 'sess-missing',
                record_attribution: 'missing',
                activity: 'missing',
                missing_reason: 'no_durable_checkpoint',
                checkpoint_status: null,
                freshness: 'missing',
                freshness_age_seconds: null,
                sequence: null,
                session_history_end_time: '2026-05-02T12:09:00.000Z',
              }),
            },
          ],
          requestWaitCheckpoints: [overlap, stale, checkpointOnly, completed],
        })
      )
    )

    const response = await fetchUsageReportSessionDiagnostics({
      from: '2026-05-01',
      to: '2026-05-08',
      limit: 20,
    })

    const overlapRow = response.requestWaitCheckpoints?.find(
      (row) => row.litellm_call_id === 'call-overlap'
    )
    expect(overlapRow?.durations_ms).toEqual({
      request_body: 1500,
      downstream_send: 2200,
    })
    expect(overlapRow?.active_wait_categories.map((wait) => wait.type)).toEqual(
      ['request_body', 'downstream_send']
    )
    expect(overlapRow?.summed_duration_ms).toBeNull()
    expect(overlapRow?.durations_are_disjoint).toBe(false)
    expect(overlapRow?.accounting_duration_is_timeout).toBe(false)
    expect(overlapRow?.provider_content_outcome).toBe('not_established')
    expect(overlapRow?.final_delivery_outcome).toBe('not_established')
    expect(overlapRow?.asgi_establishes_provider_success).toBe(false)

    const staleRow = response.requestWaitCheckpoints?.find(
      (row) => row.litellm_call_id === 'call-stale'
    )
    expect(staleRow?.activity).toBe('stale')
    expect(staleRow?.freshness).toBe('stale')
    expect(staleRow?.durations_ms).toEqual({ provider_stream: 50 })
    expect(staleRow?.summed_duration_ms).toBeNull()
    expect(staleRow?.outcome_note).toContain('not a timeout')

    const historyIndependent = response.requestWaitCheckpoints?.find(
      (row) => row.litellm_call_id === 'call-checkpoint-only'
    )
    expect(historyIndependent?.record_attribution).toBe('checkpoint_only')
    expect(historyIndependent?.qualifying_session_history).toBe(false)
    expect(historyIndependent?.durations_ms).toEqual({ request_body: 25 })

    const asgi = response.requestWaitCheckpoints?.find(
      (row) => row.litellm_call_id === 'call-asgi'
    )
    expect(asgi?.activity).toBe('completed_asgi')
    expect(asgi?.checkpoint_status).toBe('completed')
    expect(asgi?.provider_content_outcome).toBe('not_established')
    expect(asgi?.final_delivery_outcome).toBe('not_established')
    expect(asgi?.asgi_establishes_final_delivery).toBe(false)
    expect(asgi?.durations_ms).toEqual({
      downstream_send: 40,
      request_body: 15,
    })

    expect(
      response.sessionDiagnostics[0]?.request_wait_checkpoint
        ?.record_attribution
    ).toBe('missing')
    expect(
      response.sessionDiagnostics[0]?.request_wait_checkpoint
        ?.session_history_end_time
    ).toBe('2026-05-02T12:09:00.000Z')
    expect(
      response.sessionDiagnostics[0]?.request_wait_checkpoint
        ?.provider_content_outcome
    ).toBe('not_established')
  })
})
