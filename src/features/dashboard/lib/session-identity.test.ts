import { describe, expect, test } from 'vitest'
import {
  UNCAPTURED_AGENT_ID_FILTER,
  UNKNOWN_INBOUND_MODEL_FILTER,
  displaySessionIdentityValue,
  sessionIdentityFilterOptions,
} from './session-identity'

describe('session identity display', () => {
  test('keeps known values and renders only blank identity as unknown', () => {
    expect(displaySessionIdentityValue('agent_harness')).toBe('agent_harness')
    expect(displaySessionIdentityValue('orchestrator')).toBe('orchestrator')
    expect(displaySessionIdentityValue('aawm-read-anthropic')).toBe(
      'aawm-read-anthropic'
    )
    expect(displaySessionIdentityValue('claude-sonnet-4-6')).toBe(
      'claude-sonnet-4-6'
    )
    expect(displaySessionIdentityValue(null)).toBe('unknown')
    expect(displaySessionIdentityValue(undefined)).toBe('unknown')
    expect(displaySessionIdentityValue('')).toBe('unknown')
    expect(displaySessionIdentityValue('  agent_harness  ')).toBe(
      '  agent_harness  '
    )
    expect(displaySessionIdentityValue(UNCAPTURED_AGENT_ID_FILTER)).toBe(
      UNCAPTURED_AGENT_ID_FILTER
    )
  })
})

describe('session identity filter options', () => {
  test('offers exact ids and the absent sentinel without copying other fields', () => {
    expect(
      sessionIdentityFilterOptions(
        ['agent_harness', null, undefined, ''],
        UNCAPTURED_AGENT_ID_FILTER,
        ['agent_harness']
      )
    ).toEqual(['agent_harness', UNCAPTURED_AGENT_ID_FILTER])

    expect(
      sessionIdentityFilterOptions(
        ['aawm-read-anthropic', undefined],
        UNKNOWN_INBOUND_MODEL_FILTER,
        ['historical alias']
      )
    ).toEqual(['aawm-read-anthropic', 'historical alias'])

    expect(
      sessionIdentityFilterOptions(
        [undefined, undefined],
        UNCAPTURED_AGENT_ID_FILTER
      )
    ).toEqual([])
  })
})
