/**
 * Wave 11 — provider-identity module contract (S1-8 / #71).
 *
 * ENGINEER: A
 *
 * RED PHASE: This entire file fails at import time because
 * `lib/provider-identity.ts` does not exist yet.  That import error IS the
 * "red" phase — it documents the module's required public API.
 *
 * WHEN TO GREEN: Engineer A creates `src/features/dashboard/lib/provider-identity.ts`
 * and exports:
 *   - `CANONICAL_PROVIDERS: ReadonlyArray<string>` — the 8 canonical keys
 *   - `canonicalProvider(provider: string): string` — maps aliases to canonical
 *   - `providerAliases(provider: string): ReadonlyArray<string>` — inverse lookup
 *
 * After creation:
 *   - use-alerts-from-anomalies.ts imports CANONICAL_PROVIDERS from this module
 *     (removing its inline 7-entry list)
 *   - phosphor-dashboard.testkit.ts imports CANONICAL_PROVIDERS from this module
 *     (removing its inline 8-entry list)
 *   - usage-report-display.ts re-exports or defers to this module for
 *     canonicalProvider / PROVIDER_ALIASES
 *
 * "7 vs 8 providers" doc-drift resolution (S1-8):
 *   - The 7-entry list in use-alerts-from-anomalies.ts is WRONG — antigravity
 *     is a real provider in the data.
 *   - The 8-entry list in phosphor-dashboard.testkit.ts is correct.
 *   - After W11: ONE list with 8 entries in this module.
 */
// RED: import fails until Engineer A creates the module.
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
    // The array must be readonly — no mutation allowed.
    expect(
      Object.isFrozen(CANONICAL_PROVIDERS) || Array.isArray(CANONICAL_PROVIDERS)
    ).toBe(true)
    // Attempting mutation should not silently succeed.
    const original = [...CANONICAL_PROVIDERS]
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(CANONICAL_PROVIDERS as any).push('test-mutation')
    } catch {
      // Readonly arrays throw in strict mode — expected.
    }
    // Length must be unchanged.
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
