/**
 * D1-451 Wave 4 — provider-identity (C6 fail-loud on non-canonical input).
 */
import { describe, expect, test } from 'vitest'
import {
  CANONICAL_PROVIDERS,
  QUOTA_ONLY_PROVIDERS,
  PROVIDER_LABELS,
  providerDisplayLabel,
  canonicalProvider,
  groupByCanonicalProvider,
  providerAliases,
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

  test('test_provider_aliases_unknown_alias_is_stable_self_identity', () => {
    expect(() => providerAliases('gemini')).not.toThrow()
    const raw = providerAliases('not_a_real_provider_key')
    expect(raw).toEqual(['not_a_real_provider_key'])
  })
})

test('test_canonical_provider_matches_server_raw_alias_routes', () => {
  expect(canonicalProvider('claude')).toBe('anthropic')
  expect(canonicalProvider('claude/opus-4')).toBe('anthropic')
  expect(canonicalProvider('anthropic/claude')).toBe('anthropic')
  expect(canonicalProvider('deepseek/chat')).toBe('deepseek')
  expect(canonicalProvider('nvidia')).toBe('nvidia_nim')
  expect(canonicalProvider('nvidia/llama')).toBe('nvidia_nim')
})

test('test_groupByCanonicalProvider_preserves_alias_row_identity', () => {
  const legacyGoogle = { provider: 'gemini', model: 'legacy-model' }
  const canonicalGoogle = { provider: 'Google', model: 'current-model' }
  const legacyXai = { provider: 'x.ai', model: 'grok-4' }

  const grouped = groupByCanonicalProvider([
    legacyGoogle,
    canonicalGoogle,
    legacyXai,
  ])

  expect(grouped.get('google')).toEqual([legacyGoogle, canonicalGoogle])
  expect(grouped.get('google')?.[0]).toBe(legacyGoogle)
  expect(grouped.get('xai')).toEqual([legacyXai])
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

describe('D1-495 — distinct provider identities and observed unknowns', () => {
  test('test_distinct_provider_identities_are_curated', () => {
    const providers = [
      'cursor_agent',
      'alibaba_token_plan',
      'zai_coding_plan',
      'kimi_code',
      'opencode_go',
      'opencode_zen',
      'cohere',
    ]

    for (const provider of providers) {
      expect(canonicalProvider(provider)).toBe(provider)
      expect(providerAliases(provider)).toContain(provider)
      expect(providerDisplayLabel(provider)).not.toBe(provider)
    }

    expect(new Set(providers).size).toBe(providers.length)
    expect(QUOTA_ONLY_PROVIDERS).toContain('cursor_agent')
    expect(QUOTA_ONLY_PROVIDERS).toContain('zai_coding_plan')
    expect(QUOTA_ONLY_PROVIDERS).not.toContain('opencode_go')
    expect(QUOTA_ONLY_PROVIDERS).not.toContain('opencode_zen')
    expect(QUOTA_ONLY_PROVIDERS).not.toContain('cohere')
  })

  test('test_legacy_aliases_and_curated_order_are_preserved', () => {
    expect(canonicalProvider('gemini')).toBe('google')
    expect(canonicalProvider('x.ai')).toBe('xai')
    expect(canonicalProvider('local_llm')).toBe('local')
    expect(CANONICAL_PROVIDERS.slice(0, 8)).toEqual([
      'anthropic',
      'openai',
      'google',
      'antigravity',
      'xai',
      'openrouter',
      'nvidia_nim',
      'local',
    ])
    expect(Object.keys(PROVIDER_LABELS).slice(0, 8)).toEqual(
      CANONICAL_PROVIDERS
    )
  })

  test('test_observed_unknown_providers_have_identity_not_dropped', () => {
    expect(canonicalProvider('Emerging_Provider')).toBe('emerging_provider')
    expect(providerAliases('Emerging_Provider')).toEqual(['emerging_provider'])
    expect(providerDisplayLabel('Emerging_Provider')).toBe('emerging_provider')
  })

  test('test_new_providers_have_stable_distinct_colors', () => {
    const providers = [
      'cursor_agent',
      'zai_coding_plan',
      'kimi_code',
      'opencode_go',
      'opencode_zen',
      'cohere',
    ]
    const colors = providers.map((provider) => providerColorFor(provider))
    const brandColors = providers.map((provider) => providerBrandHex(provider))

    expect(new Set(colors).size).toBe(colors.length)
    expect(new Set(brandColors).size).toBe(brandColors.length)
    for (const color of brandColors) {
      expect(color).not.toBe('var(--fg)')
    }
  })
})
