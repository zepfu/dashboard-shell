import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type {
  RequestWaitCheckpointDiagnostics,
  UsageReportSessionDiagnosticsResponse,
  UsageReportSessionDiagnosticsRow,
} from '../../api/usage-report'
import { SessionDiagnosticsPanel } from './session-diagnostics-panel'

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
    freshness_age_seconds: overrides.activity === 'stale' ? 640 : 5,
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

function row(
  overrides: Partial<UsageReportSessionDiagnosticsRow>
): UsageReportSessionDiagnosticsRow {
  return {
    session_id: 'sess',
    provider: 'anthropic',
    model: 'claude',
    created_at: '2026-05-02T12:00:00.000Z',
    diagnostic_flags: [],
    diagnostic_categories: [],
    ...overrides,
  }
}

function checkpointBlock(callId: string): HTMLElement {
  const element = document.querySelector(
    `[data-testid="request-wait-checkpoint"][data-litellm-call-id="${callId}"]`
  )
  if (!(element instanceof HTMLElement)) {
    throw new Error(`missing wait checkpoint block for ${callId}`)
  }
  return element
}

describe('SessionDiagnosticsPanel request wait checkpoints', () => {
  test('renders overlap, stale, missing, and completed ASGI states with explicit attribution', () => {
    const overlap = checkpoint({
      litellm_call_id: 'call-overlap',
      record_attribution: 'correlated_session_history',
      activity: 'active',
      active_wait_categories: [
        { type: 'request_body', started_at: '2026-05-02T12:00:01.000Z' },
        { type: 'downstream_send', started_at: '2026-05-02T12:00:02.000Z' },
      ],
      durations_ms: { request_body: 1500, downstream_send: 2200 },
      counts: { request_body: 1, downstream_send: 2 },
    })
    const stale = checkpoint({
      litellm_call_id: 'call-stale',
      record_attribution: 'correlated_session_history',
      activity: 'stale',
      sequence: 8,
      active_wait_categories: [
        { type: 'provider_stream', started_at: '2026-05-02T11:49:00.000Z' },
      ],
      durations_ms: { provider_stream: 50 },
      counts: { provider_stream: 1 },
    })
    const missing = checkpoint({
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
    })
    const completed = checkpoint({
      litellm_call_id: 'call-asgi',
      record_attribution: 'correlated_session_history',
      activity: 'completed_asgi',
      durations_ms: { downstream_send: 40, request_body: 15 },
      counts: { downstream_send: 1, request_body: 1 },
    })
    const response: UsageReportSessionDiagnosticsResponse = {
      metadata: { from: '2026-05-01', to: '2026-05-08', limit: 20 },
      sessionDiagnostics: [
        row({
          litellm_call_id: 'call-overlap',
          request_wait_checkpoint: overlap,
        }),
        row({ litellm_call_id: 'call-stale', request_wait_checkpoint: stale }),
        row({
          litellm_call_id: 'call-missing',
          session_id: 'sess-missing',
          provider: 'openai',
          model: 'gpt-5',
          request_wait_checkpoint: missing,
        }),
        row({
          litellm_call_id: 'call-asgi',
          request_wait_checkpoint: completed,
        }),
      ],
      requestWaitCheckpoints: [overlap, stale, completed],
    }

    render(<SessionDiagnosticsPanel response={response} loading={false} />)

    const overlapBlock = checkpointBlock('call-overlap')
    expect(overlapBlock.dataset.waitActivity).toBe('active')
    expect(overlapBlock.dataset.waitAttribution).toBe(
      'correlated_session_history'
    )
    expect(overlapBlock.textContent).toContain('Current active waits')
    expect(overlapBlock.textContent).toContain('request_body')
    expect(overlapBlock.textContent).toContain('downstream_send')
    expect(overlapBlock.textContent).toContain('1500 ms')
    expect(overlapBlock.textContent).toContain('2200 ms')
    expect(overlapBlock.textContent).not.toContain('3700')
    expect(overlapBlock.textContent).toContain(
      'Qualifying session history row is present'
    )
    expect(overlapBlock.textContent).toContain('Provider content:')
    expect(overlapBlock.textContent).toContain('not established')
    expect(overlapBlock.textContent).toContain('Final delivery:')
    expect(overlapBlock.textContent).toContain('not disjoint elapsed time')

    const staleBlock = checkpointBlock('call-stale')
    expect(staleBlock.dataset.waitActivity).toBe('stale')
    expect(staleBlock.textContent).toContain('Stale checkpoint')
    expect(staleBlock.textContent).toContain('freshness stale')
    expect(staleBlock.textContent).toContain('provider_stream')
    expect(staleBlock.textContent).toContain('50 ms')
    expect(staleBlock.textContent).toContain('not a request timeout')
    expect(staleBlock.textContent).toContain('sequence 8')

    const missingBlock = checkpointBlock('call-missing')
    expect(missingBlock.dataset.waitAttribution).toBe('missing')
    expect(missingBlock.textContent).toContain(
      'Missing durable wait checkpoint'
    )
    expect(missingBlock.textContent).toContain(
      'No durable checkpoint row for this request.'
    )
    expect(missingBlock.textContent).toContain(
      'History completion 2026-05-02T12:09:00.000Z'
    )
    expect(missingBlock.textContent).not.toContain(
      'No qualifying session history row'
    )

    const completedBlock = checkpointBlock('call-asgi')
    expect(completedBlock.dataset.waitActivity).toBe('completed_asgi')
    expect(completedBlock.textContent).toContain(
      'Completed ASGI processing (completed)'
    )
    expect(completedBlock.textContent).toContain(
      'ASGI completion 2026-05-02T12:00:20.000Z'
    )
    expect(completedBlock.textContent).toContain('Provider content:')
    expect(completedBlock.textContent).toContain('not established')
    expect(completedBlock.textContent).toContain('Final delivery:')
    expect(completedBlock.textContent).toContain(
      'does not establish provider content success'
    )
    expect(completedBlock.textContent).not.toContain('provider success')
  })

  test('renders a checkpoint-only record when no qualifying session diagnostic row exists', () => {
    const checkpointOnly = checkpoint({
      litellm_call_id: 'call-checkpoint-only',
      session_id: 'request:call-checkpoint-only',
      record_attribution: 'checkpoint_only',
      activity: 'active',
      qualifying_session_history: false,
      sequence: 2,
      active_wait_categories: [
        { type: 'request_body', started_at: '2026-05-02T12:00:10.000Z' },
        { type: 'downstream_send', started_at: '2026-05-02T12:00:11.000Z' },
      ],
      durations_ms: { request_body: 25, downstream_send: 11 },
      counts: { request_body: 1, downstream_send: 1 },
    })
    const response: UsageReportSessionDiagnosticsResponse = {
      metadata: { from: '2026-05-01', to: '2026-05-08', limit: 20 },
      sessionDiagnostics: [],
      requestWaitCheckpoints: [checkpointOnly],
    }

    render(<SessionDiagnosticsPanel response={response} loading={false} />)

    expect(
      screen.queryByText('No session diagnostics for the selected range.')
    ).toBeNull()
    const block = checkpointBlock('call-checkpoint-only')
    expect(block.dataset.waitAttribution).toBe('checkpoint_only')
    expect(block.textContent).toContain('Checkpoint-only record')
    expect(block.textContent).toContain('No qualifying session history row')
    expect(block.textContent).toContain('request_body')
    expect(block.textContent).toContain('downstream_send')
    expect(block.textContent).toContain('25 ms')
    expect(block.textContent).toContain('11 ms')
    expect(block.textContent).not.toContain('36')
    expect(block.textContent).toContain('not established')
    expect(block.textContent).toContain('freshness fresh')
    expect(block.textContent).toContain('sequence 2')
  })
})
