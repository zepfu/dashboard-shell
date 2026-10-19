import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { REASONING_EFFORT_PRODUCER_FIXTURES } from '../../../../../server/reasoning-effort-diagnostics.mjs'
import type { UsageReportSessionDiagnosticsResponse } from '../../api/usage-report'
import { SessionDiagnosticsPanel } from './session-diagnostics-panel'

const {
  unchangedMapping,
  ceilingClampProviderMapping,
  candidateOverride,
  missingMetadata,
  partialMissing,
} = REASONING_EFFORT_PRODUCER_FIXTURES

afterEach(() => {
  cleanup()
})

function renderRow(row: Record<string, unknown>) {
  const response: UsageReportSessionDiagnosticsResponse = {
    metadata: { from: '2026-05-20', to: '2026-05-21', limit: 1 },
    sessionDiagnostics: [
      {
        session_id: 'sess-effort',
        provider: 'row-provider',
        model: 'row-model',
        created_at: '2026-05-20T10:00:00Z',
        diagnostic_flags: ['reasoning_effort_mapping'],
        diagnostic_categories: ['request_attempt'],
        alias_route_events: [
          {
            attempt_number: 9,
            model: 'not-this-attempt',
            provider: 'anthropic',
            event_type: 'candidate_selected',
            details: {
              reasoning_effort_native_value: 'xhigh',
              reasoning_effort_requested: 'max',
            },
          },
        ],
        ...row,
      },
    ],
  }
  render(<SessionDiagnosticsPanel response={response} loading={false} />)
}

function mappingBlock() {
  return screen.getByTestId('reasoning-effort-mapping')
}

function fieldText(key: string) {
  return within(mappingBlock()).getByTestId(`reasoning-effort-${key}`)
    .textContent
}

test('component shows an unchanged mapping separately from reasoning tokens', () => {
  renderRow({
    reasoning_effort: {
      ...unchangedMapping,
      reasoning_tokens_reported: 4242,
    },
  })

  const block = mappingBlock()
  expect(block.textContent).toContain(
    'Requested effort is the value that entered reconciliation. It may already include a candidate-configuration override.'
  )
  expect(block.textContent).toContain(
    'separate from observed reasoning-token usage'
  )
  expect(block.textContent).not.toMatch(/original caller/i)
  expect(fieldText('reasoning_effort_requested')).toContain('xhigh')
  expect(fieldText('reasoning_effort_native_value')).toContain('xhigh')
  expect(fieldText('reasoning_effort_supported_ceiling')).toContain('xhigh')
  expect(fieldText('reasoning_effort_mapping_reason')).toContain(
    'within_supported_ceiling'
  )
  expect(fieldText('reasoning_effort_resolved_provider')).toContain('xai')
  expect(fieldText('reasoning_effort_resolved_model')).toContain(
    'oa_xai/grok-4.6'
  )
  expect(fieldText('reasoning_effort_candidate_attempt')).toContain('1')
  expect(fieldText('reasoning_effort_clamped_from')).toContain('unknown')
  expect(fieldText('reasoning_effort_resolved_model')).not.toContain(
    'row-model'
  )
  expect(fieldText('reasoning_effort_resolved_model')).not.toContain(
    'not-this-attempt'
  )
  expect(block.textContent).not.toContain('4242')
  expect(document.querySelector('.reasoning-token-value')).toBeNull()
})

test('component shows a ceiling clamp and the resolved provider mapping', () => {
  renderRow({
    reasoning_effort: ceilingClampProviderMapping,
  })

  expect(fieldText('reasoning_effort_requested')).toContain('max')
  expect(fieldText('reasoning_effort_native_value')).toContain('high')
  expect(fieldText('reasoning_effort_native_value')).not.toContain('max')
  expect(fieldText('reasoning_effort_supported_ceiling')).toContain('high')
  expect(fieldText('reasoning_effort_clamped_from')).toContain('max')
  expect(fieldText('reasoning_effort_clamp_reason')).toContain(
    'requested_effort_above_model_supported_ceiling'
  )
  expect(fieldText('reasoning_effort_resolved_provider')).toContain('openai')
  expect(fieldText('reasoning_effort_resolved_model')).toContain('o1')
  expect(fieldText('reasoning_effort_candidate_attempt')).toContain('2')
  expect(fieldText('reasoning_effort_candidate_attempt')).not.toContain('9')
  expect(fieldText('reasoning_effort_native_value')).not.toContain('xhigh')
  expect(mappingBlock().textContent).not.toContain('not-this-attempt')
  expect(mappingBlock().textContent).not.toMatch(/original caller/i)
})

test('component labels a candidate override as the value entering reconciliation', () => {
  renderRow({
    reasoning_effort: {
      ...candidateOverride,
      caller_reasoning_effort: 'high',
    },
  })

  const block = mappingBlock()
  expect(block.textContent).toContain(
    'Requested effort (entering reconciliation)'
  )
  expect(block.textContent).toContain(
    'may already include a candidate-configuration override'
  )
  expect(block.textContent).not.toMatch(/original caller/i)
  expect(fieldText('reasoning_effort_requested')).toContain('low')
  expect(fieldText('reasoning_effort_native_value')).toContain('low')
  expect(fieldText('reasoning_effort_config_value')).toContain('low')
  expect(fieldText('reasoning_effort_config_source')).toContain(
    'candidate_yaml'
  )
  expect(fieldText('reasoning_effort_candidate_attempt')).toContain('1')
  expect(block.textContent).not.toContain('caller_reasoning_effort')
})

test('component preserves missing reasoning-effort metadata', () => {
  renderRow({
    reasoning_tokens_reported: 4242,
    reasoning_effort: missingMetadata,
  })

  expect(screen.queryByTestId('reasoning-effort-mapping')).toBeNull()
  expect(document.body.textContent).not.toContain('4242')
  expect(document.body.textContent).not.toContain('Native effort')
  expect(document.querySelector('.reasoning-token-value')).toBeNull()

  cleanup()
  renderRow({
    model: 'gpt-5',
    provider: 'openai',
    reasoning_effort: partialMissing,
  })

  expect(fieldText('reasoning_effort_requested')).toContain('high')
  expect(fieldText('reasoning_effort_native_value')).toContain('unknown')
  expect(fieldText('reasoning_effort_supported_ceiling')).toContain('unknown')
  expect(fieldText('reasoning_effort_resolved_model')).toContain('unknown')
  expect(fieldText('reasoning_effort_resolved_provider')).toContain('unknown')
  expect(fieldText('reasoning_effort_candidate_attempt')).toContain('unknown')
  expect(fieldText('reasoning_effort_native_value')).not.toContain('high')
  expect(fieldText('reasoning_effort_native_value')).not.toContain('max')
  expect(fieldText('reasoning_effort_native_value')).not.toContain('xhigh')
  expect(mappingBlock().textContent).not.toContain('4242')
  expect(mappingBlock().textContent).not.toContain('gpt-5')
  expect(mappingBlock().textContent).not.toContain('not-this-attempt')
  expect(mappingBlock().textContent).not.toMatch(/original caller/i)
})
