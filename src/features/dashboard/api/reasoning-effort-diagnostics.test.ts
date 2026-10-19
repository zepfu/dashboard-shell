import { http, HttpResponse } from 'msw'
import { REASONING_EFFORT_PRODUCER_FIXTURES } from '../../../../server/reasoning-effort-diagnostics.mjs'
import { server } from '../../../test/setup'
import { fetchUsageReportSessionDiagnostics } from './usage-report'

const {
  unchangedMapping,
  ceilingClampProviderMapping,
  candidateOverride,
  missingMetadata,
  partialMissing,
} = REASONING_EFFORT_PRODUCER_FIXTURES

async function fetchDiagnostic(row: Record<string, unknown>) {
  server.use(
    http.get('/api/shell/reports/usage/session-diagnostics', () =>
      HttpResponse.json({
        metadata: {
          from: '2026-05-20',
          to: '2026-05-21',
          limit: 1,
          generatedAt: '2026-05-21T00:00:00.000Z',
        },
        sessionDiagnostics: [row],
      })
    )
  )
  const response = await fetchUsageReportSessionDiagnostics({
    from: '2026-05-20',
    to: '2026-05-21',
    limit: 1,
  })
  return response.sessionDiagnostics[0]
}

test('api preserves an unchanged reasoning-effort mapping', async () => {
  const row = await fetchDiagnostic({
    provider: 'row-provider',
    model: 'row-model',
    reasoning_tokens_reported: 4242,
    reasoning_effort: {
      ...unchangedMapping,
      reasoning_tokens_reported: 4242,
      effective_effort: 'low',
    },
  })

  expect(row?.reasoning_effort).toMatchObject({
    reasoning_effort_requested: 'xhigh',
    reasoning_effort_native_value: 'xhigh',
    reasoning_effort_supported_ceiling: 'xhigh',
    reasoning_effort_mapping_reason: 'within_supported_ceiling',
    reasoning_effort_resolved_provider: 'xai',
    reasoning_effort_resolved_model: 'oa_xai/grok-4.6',
    reasoning_effort_candidate_attempt: 1,
    reasoning_effort_clamped_from: null,
    reasoning_effort_config_value: null,
  })
  expect(row?.reasoning_effort).not.toHaveProperty('reasoning_tokens_reported')
  expect(row?.reasoning_effort).not.toHaveProperty('effective_effort')
  expect(row?.reasoning_effort?.reasoning_effort_resolved_model).not.toBe(
    row?.model
  )
})

test('api preserves a ceiling clamp and resolved provider mapping', async () => {
  const row = await fetchDiagnostic({
    provider: 'anthropic',
    model: 'not-this-attempt',
    alias_route_events: [{ attempt_number: 9, model: 'not-this-attempt' }],
    reasoning_effort: {
      ...ceilingClampProviderMapping,
      reasoning_effort_candidate_attempt: '2',
      codex_reasoning_effort: 'max',
    },
  })

  expect(row?.reasoning_effort).toMatchObject({
    reasoning_effort_requested: 'max',
    reasoning_effort_native_value: 'high',
    reasoning_effort_native_provider: 'openai',
    reasoning_effort_supported_ceiling: 'high',
    reasoning_effort_resolved_provider: 'openai',
    reasoning_effort_resolved_model: 'o1',
    reasoning_effort_candidate_attempt: 2,
    reasoning_effort_clamped_from: 'max',
    reasoning_effort_clamp_reason:
      'requested_effort_above_model_supported_ceiling',
    reasoning_effort_mapping_reason:
      'requested_effort_above_model_supported_ceiling',
  })
  expect(row?.reasoning_effort?.reasoning_effort_candidate_attempt).not.toBe(9)
  expect(row?.reasoning_effort?.reasoning_effort_resolved_model).not.toBe(
    'not-this-attempt'
  )
  expect(row?.reasoning_effort).not.toHaveProperty('codex_reasoning_effort')
})

test('api preserves a candidate override without treating it as the original caller value', async () => {
  const row = await fetchDiagnostic({
    model: 'caller-model',
    reasoning_effort: {
      ...candidateOverride,
      caller_reasoning_effort: 'high',
      original_reasoning_effort: 'high',
    },
  })

  expect(row?.reasoning_effort).toMatchObject({
    reasoning_effort_requested: 'low',
    reasoning_effort_native_value: 'low',
    reasoning_effort_config_value: 'low',
    reasoning_effort_config_source: 'candidate_yaml',
    reasoning_effort_candidate_attempt: 1,
    reasoning_effort_mapping_reason: 'within_supported_ceiling',
  })
  expect(row?.reasoning_effort).not.toHaveProperty('caller_reasoning_effort')
  expect(row?.reasoning_effort).not.toHaveProperty('original_reasoning_effort')
  expect(JSON.stringify(row?.reasoning_effort)).not.toContain('original caller')
  expect(JSON.stringify(row?.reasoning_effort)).not.toContain('caller-model')
})

test('api preserves missing reasoning-effort metadata', async () => {
  const missing = await fetchDiagnostic({
    provider: 'openai',
    model: 'gpt-5',
    reasoning_tokens_reported: 4242,
    alias_route_events: [{ attempt_number: 9, model: 'not-this-attempt' }],
    reasoning_effort: missingMetadata,
  })
  expect(missing?.reasoning_effort).toBeNull()

  const partial = await fetchDiagnostic({
    provider: 'openai',
    model: 'gpt-5',
    alias_route_events: [{ attempt_number: 9, model: 'not-this-attempt' }],
    reasoning_effort: partialMissing,
  })
  expect(partial?.reasoning_effort).toMatchObject({
    reasoning_effort_requested: 'high',
    reasoning_effort_native_value: null,
    reasoning_effort_supported_ceiling: null,
    reasoning_effort_resolved_model: null,
    reasoning_effort_resolved_provider: null,
    reasoning_effort_candidate_attempt: null,
    reasoning_effort_config_value: null,
  })
  expect(partial?.reasoning_effort).not.toHaveProperty(
    'reasoning_tokens_reported'
  )
  expect(partial?.reasoning_effort).not.toHaveProperty('codex_reasoning_effort')
  expect(partial?.reasoning_effort).not.toHaveProperty('effective_effort')
  expect(JSON.stringify(partial?.reasoning_effort)).not.toContain('4242')
  expect(JSON.stringify(partial?.reasoning_effort)).not.toContain(
    'not-this-attempt'
  )
  expect(JSON.stringify(partial?.reasoning_effort)).not.toContain('gpt-5')
})
