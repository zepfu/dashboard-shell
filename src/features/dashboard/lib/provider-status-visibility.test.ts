import { describe, expect, test } from 'vitest'
import {
  isAnthropicProviderStatusVisible,
  ANTHROPIC_PROVIDER_STATUS_ENV_VAR,
} from './provider-status-visibility'

describe('D1-498 — Anthropic Provider Status visibility flag', () => {
  test('test_default_and_false_configuration_hides_anthropic_status', () => {
    expect(ANTHROPIC_PROVIDER_STATUS_ENV_VAR).toBe(
      'VITE_SHOW_ANTHROPIC_PROVIDER_STATUS'
    )
    expect(isAnthropicProviderStatusVisible()).toBe(false)
    expect(isAnthropicProviderStatusVisible(undefined)).toBe(false)
    expect(isAnthropicProviderStatusVisible('')).toBe(false)
    expect(isAnthropicProviderStatusVisible('false')).toBe(false)
    expect(isAnthropicProviderStatusVisible('off')).toBe(false)
  })

  test.each(['1', 'true', 'TRUE', 'yes', 'on'])(
    'test_truthy_configuration_%s_restores_anthropic_status',
    (configuredValue) => {
      expect(isAnthropicProviderStatusVisible(configuredValue)).toBe(true)
    }
  )
})
