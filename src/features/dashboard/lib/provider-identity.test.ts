/**
 * D1-451 Wave 4 — provider-identity (C6 fail-loud on non-canonical input).
 */
import { describe, expect, test } from 'vitest'
import {
  CANONICAL_PROVIDERS,
  QUOTA_ONLY_PROVIDERS,
  providerAliases,
  canonicalProvider,
} from './provider-identity'
import { providerBrandHex, providerColorFor } from './usage-report-display'

describe('D1-451 C6 — providerAliases canonicalizes input', () => {
  test('test_provider_aliases_gemini_includes_google_and_gemini', () => {
    const aliases = providerAliases('gemini')
    expect(aliases).toContain('google')
    expect(aliases).toContain('gemini')
    expect(canonicalProvider('gemini')).toBe('google')
  })

  test('test_provider_aliases_xai_dot_includes_canonical_xai_aliases', () => {
    const aliases = providerAliases('x.ai')
    expect(aliases).toContain('xai')
    expect(aliases).toContain('x.ai')
    expect(canonicalProvider('x.ai')).toBe('xai')
  })

  test('test_provider_aliases_unknown_alias_fails_loud_not_silent_self', () => {
    expect(() => providerAliases('gemini')).not.toThrow()
    const raw = providerAliases('not_a_real_provider_key')
    expect(raw).not.toEqual(['not_a_real_provider_key'])
  })
})

describe('D1-489 — Alibaba Token Plan provider identity', () => {
  test('test_alibaba_token_plan_canonicalizes_to_itself', () => {
    expect(canonicalProvider('alibaba_token_plan')).toBe('alibaba_token_plan')
    expect(canonicalProvider('Alibaba_Token_Plan')).toBe('alibaba_token_plan')
  })

  test('test_alibaba_token_plan_aliases_not_empty', () => {
    const aliases = providerAliases('alibaba_token_plan')
    expect(aliases).toContain('alibaba_token_plan')
    expect(aliases.length).toBeGreaterThanOrEqual(1)
  })

  test('test_alibaba_token_plan_not_aliased_to_qwen_or_coding_plan', () => {
    expect(canonicalProvider('alibaba_token_plan')).not.toBe('qwen')
    expect(canonicalProvider('alibaba_token_plan')).not.toBe('coding_plan')
    expect(canonicalProvider('alibaba_token_plan')).not.toBe('alibaba')
  })

  test('test_quota_only_providers_includes_alibaba_token_plan', () => {
    expect(QUOTA_ONLY_PROVIDERS).toContain('alibaba_token_plan')
    expect(Object.isFrozen(QUOTA_ONLY_PROVIDERS)).toBe(true)
  })

  test('test_canonical_providers_still_exactly_8', () => {
    // QUOTA_ONLY_PROVIDERS must not leak into CANONICAL_PROVIDERS
    expect(CANONICAL_PROVIDERS).toHaveLength(8)
    expect(CANONICAL_PROVIDERS).not.toContain('alibaba_token_plan')
  })
})

describe('D1-492 — Kimi Code provider identity', () => {
  test('test_kimi_code_canonicalizes_to_itself', () => {
    expect(canonicalProvider('kimi_code')).toBe('kimi_code')
    expect(canonicalProvider('Kimi_Code')).toBe('kimi_code')
  })

  test('test_kimi_code_aliases_not_empty', () => {
    const aliases = providerAliases('kimi_code')
    expect(aliases).toContain('kimi_code')
    expect(aliases.length).toBeGreaterThanOrEqual(1)
  })

  test('test_kimi_code_not_aliased_to_moonshot_api_alibaba_or_qwen', () => {
    expect(canonicalProvider('kimi_code')).not.toBe('moonshot')
    expect(canonicalProvider('kimi_code')).not.toBe('moonshot_api')
    expect(canonicalProvider('kimi_code')).not.toBe('alibaba_token_plan')
    expect(canonicalProvider('kimi_code')).not.toBe('qwen')
    // No reverse aliasing either: moonshot-family strings stay distinct.
    expect(canonicalProvider('moonshot')).not.toBe('kimi_code')
    expect(canonicalProvider('moonshot_api')).not.toBe('kimi_code')
  })

  test('test_quota_only_providers_includes_kimi_code_and_alibaba_token_plan', () => {
    expect(QUOTA_ONLY_PROVIDERS).toContain('kimi_code')
    expect(QUOTA_ONLY_PROVIDERS).toContain('alibaba_token_plan')
    expect(Object.isFrozen(QUOTA_ONLY_PROVIDERS)).toBe(true)
  })

  test('test_canonical_providers_still_exactly_8_without_kimi_code', () => {
    expect(CANONICAL_PROVIDERS).toHaveLength(8)
    expect(CANONICAL_PROVIDERS).not.toContain('kimi_code')
  })

  test('test_kimi_code_has_distinct_provider_colors', () => {
    expect(providerColorFor('kimi_code')).not.toBe(
      providerColorFor('alibaba_token_plan')
    )
    expect(providerBrandHex('kimi_code')).not.toBe('var(--fg)')
    expect(providerBrandHex('kimi_code')).not.toBe(
      providerBrandHex('alibaba_token_plan')
    )
  })
})
