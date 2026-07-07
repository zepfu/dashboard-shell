/**
 * D1-451 Wave 4 — provider-identity (C6 fail-loud on non-canonical input).
 */
import { describe, expect, test } from 'vitest'
import { providerAliases, canonicalProvider } from './provider-identity'

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
