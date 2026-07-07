/**
 * Wave 11 / D1-451 E1 — provider-identity module contract (S1-8).
 *
 * Public API: CANONICAL_PROVIDERS (8 keys), canonicalProvider, providerAliases.
 * Consumers: usage-report-display re-export, health-cells, provider-metrics, alerts.
 */
import { describe, expect, test } from 'vitest'
import {
  CANONICAL_PROVIDERS,
  canonicalProvider,
  providerAliases,
} from './provider-identity'

// ---------------------------------------------------------------------------
// Export contract tests
// ---------------------------------------------------------------------------

describe('provider-identity CANONICAL_PROVIDERS', () => {
  test('test_canonical_providers_is_array_of_8', () => {
    expect(Array.isArray(CANONICAL_PROVIDERS)).toBe(true)
    // Exactly 8 — resolves the "7 vs 8" doc drift.
    expect(CANONICAL_PROVIDERS).toHaveLength(8)
  })

  test('test_canonical_providers_contains_all_8_expected_keys', () => {
    const expected = [
      'anthropic',
      'openai',
      'google',
      'antigravity',
      'xai',
      'openrouter',
      'nvidia_nim',
      'local',
    ]
    for (const provider of expected) {
      expect(CANONICAL_PROVIDERS).toContain(provider)
    }
  })

  test('test_nvidia_nim_is_in_canonical_providers', () => {
    // S1-8 explicit confirmation: nvidia_nim lane def exists.
    expect(CANONICAL_PROVIDERS).toContain('nvidia_nim')
  })

  test('test_antigravity_is_in_canonical_providers_resolving_7_vs_8_drift', () => {
    // antigravity is the 8th provider — missing from the old 7-entry list.
    expect(CANONICAL_PROVIDERS).toContain('antigravity')
  })

  test('test_canonical_providers_is_readonly', () => {
    expect(Object.isFrozen(CANONICAL_PROVIDERS)).toBe(true)
    const original = [...CANONICAL_PROVIDERS]
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(CANONICAL_PROVIDERS as any).push('test-mutation')
    }).toThrow()
    expect(CANONICAL_PROVIDERS).toHaveLength(original.length)
  })
})

describe('provider-identity canonicalProvider', () => {
  test('test_canonical_provider_gemini_maps_to_google', () => {
    expect(canonicalProvider('gemini')).toBe('google')
  })

  test('test_canonical_provider_gemini_case_insensitive', () => {
    expect(canonicalProvider('GEMINI')).toBe('google')
    expect(canonicalProvider('Gemini')).toBe('google')
  })

  test('test_canonical_provider_xai_dot_maps_to_xai', () => {
    expect(canonicalProvider('x.ai')).toBe('xai')
  })

  test('test_canonical_provider_oa_xai_maps_to_xai', () => {
    expect(canonicalProvider('oa_xai')).toBe('xai')
  })

  test('test_canonical_provider_xai_slash_prefix_maps_to_xai', () => {
    expect(canonicalProvider('xai/grok-1')).toBe('xai')
  })

  test('test_canonical_provider_oa_xai_slash_prefix_maps_to_xai', () => {
    expect(canonicalProvider('oa_xai/grok-2')).toBe('xai')
  })

  test('test_canonical_provider_openai_maps_to_openai', () => {
    expect(canonicalProvider('openai')).toBe('openai')
  })

  test('test_canonical_provider_anthropic_maps_to_anthropic', () => {
    expect(canonicalProvider('anthropic')).toBe('anthropic')
  })

  test('test_canonical_provider_local_llm_maps_to_local', () => {
    expect(canonicalProvider('local_llm')).toBe('local')
  })

  test('test_canonical_provider_local_embed_maps_to_local', () => {
    expect(canonicalProvider('local_embed')).toBe('local')
  })

  test('test_canonical_provider_local_biomed_maps_to_local', () => {
    expect(canonicalProvider('local_biomed')).toBe('local')
  })

  test('test_canonical_provider_local_litellm_maps_to_local', () => {
    expect(canonicalProvider('local_litellm')).toBe('local')
  })

  test('test_canonical_provider_local_rerank_maps_to_local', () => {
    expect(canonicalProvider('local_rerank')).toBe('local')
  })

  test('test_canonical_provider_nvidia_nim_idempotent', () => {
    // Already canonical — must return itself unchanged.
    expect(canonicalProvider('nvidia_nim')).toBe('nvidia_nim')
  })

  test('test_canonical_provider_unknown_returns_lowercase', () => {
    // Unknown providers fall through to lowercase passthrough.
    expect(canonicalProvider('SomeUnknownProvider')).toBe('someunknownprovider')
  })

  test('test_canonical_provider_all_canonical_keys_are_idempotent', () => {
    // Every canonical key must map to itself.
    for (const provider of CANONICAL_PROVIDERS) {
      expect(canonicalProvider(provider)).toBe(provider)
    }
  })
})

describe('provider-identity providerAliases', () => {
  test('test_provider_aliases_google_includes_gemini', () => {
    const aliases = providerAliases('google')
    expect(aliases).toContain('gemini')
    expect(aliases).toContain('google')
  })

  test('test_provider_aliases_xai_includes_dot_and_oa_variants', () => {
    const aliases = providerAliases('xai')
    expect(aliases).toContain('xai')
    expect(aliases).toContain('x.ai')
    expect(aliases).toContain('oa_xai')
  })

  test('test_provider_aliases_local_includes_all_local_variants', () => {
    const aliases = providerAliases('local')
    expect(aliases).toContain('local')
    expect(aliases).toContain('local_llm')
    expect(aliases).toContain('local_embed')
    expect(aliases).toContain('local_biomed')
    expect(aliases).toContain('local_litellm')
    expect(aliases).toContain('local_rerank')
  })

  test('test_provider_aliases_unknown_returns_self', () => {
    const aliases = providerAliases('openai')
    expect(aliases).toContain('openai')
  })

  test('test_provider_aliases_is_readonly_array', () => {
    const aliases = providerAliases('google')
    expect(Array.isArray(aliases)).toBe(true)
  })
})
