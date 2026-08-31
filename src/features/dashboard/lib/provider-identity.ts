/**
 * Provider identity — canonical keys, aliases, and mapping helpers.
 *
 * Single source of truth for the 8 canonical provider keys (resolves S1-8
 * "7 vs 8" doc drift) and alias mappings.
 *
 * Wave 11: extracted from inline copies in phosphor-dashboard.testkit.ts
 * and use-alerts-from-anomalies.ts, and from usage-report-display.ts.
 */

/**
 * Canonical provider keys — always 8, in fixed order.
 *
 * Wave 11 PR2 (11-f): the dashboard keeps all 8 canonical providers available
 * for attribution, trend, ledger, alerts, and comparison surfaces regardless
 * of which providers the API returns in a given time range. Provider Status may
 * choose a smaller display list and roll provider detail into another card.
 *
 * Resolves S1-8: antigravity was missing from the 7-entry list in
 * use-alerts-from-anomalies.ts; nvidia_nim lane def is required.
 */
export const CANONICAL_PROVIDERS: ReadonlyArray<string> = Object.freeze([
  'anthropic',
  'openai',
  'google',
  'antigravity',
  'xai',
  'openrouter',
  'nvidia_nim',
  'local',
])

/**
 * Labels for curated dashboard provider identities. Attribution providers stay
 * in CANONICAL_PROVIDERS; identity-only providers are intentionally separate.
 */
export const PROVIDER_LABELS: Readonly<Record<string, string>> = Object.freeze({
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  antigravity: 'Antigravity',
  xai: 'xAI',
  openrouter: 'OpenRouter',
  nvidia_nim: 'NVIDIA',
  local: 'Local',
  cursor_agent: 'Cursor Agent',
  zai_coding_plan: 'Z.ai Coding Plan',
  cohere: 'Cohere',
  opencode_go: 'OpenCode Go',
  opencode_zen: 'OpenCode Zen',
  alibaba_token_plan: 'Alibaba Token Plan',
  kimi_code: 'Kimi Code',
})

/**
 * Provider aliases — maps a canonical provider key to the set of strings
 * that may appear in the `providerLatencyHealth` materialized view or
 * other API responses.
 *
 * Wave 15-B (15-B.2): The DB materialised view `provider_latency_health_5m`
 * stores some rows under source aliases. `report-service.mjs` owns the
 * server-side provider CASE; this browser map mirrors its raw aliases and
 * route families where client filtering needs them. The legacy `oa_xai`
 * spelling remains for existing browser contracts.
 */
const PROVIDER_ALIASES: Record<string, readonly string[]> = {
  alibaba_token_plan: ['alibaba_token_plan', 'alibaba-token-plan'],
  antigravity: ['antigravity'],
  anthropic: ['anthropic', 'claude'],
  cohere: ['cohere'],
  cursor_agent: ['cursor_agent'],
  google: ['google', 'gemini'],
  kimi_code: ['kimi_code', 'kimi-code'],
  local: [
    'local',
    'local_biomed',
    'local_embed',
    'local_litellm',
    'local_llm',
    'local_rerank',
  ],
  nvidia_nim: ['nvidia_nim', 'nvidia'],
  opencode_go: ['opencode_go'],
  opencode_zen: ['opencode_zen'],
  xai: ['xai', 'x.ai', 'oa_xai'],
  zai_coding_plan: ['zai_coding_plan'],
}

/**
 * Returns all alias strings that should be matched for a given canonical
 * provider key (case-insensitive lower).
 *
 * Wave 15-B.2: Use when filtering `providerLatencyHealth` rows to avoid
 * dropping gemini rows for the google provider card.
 */
export function providerAliases(provider: string): readonly string[] {
  const key = canonicalProvider(provider)
  if (
    (CANONICAL_PROVIDERS as readonly string[]).includes(key) ||
    key in PROVIDER_ALIASES
  ) {
    return PROVIDER_ALIASES[key] ?? [key]
  }
  // Observed providers outside the curated lists remain matchable as their
  // own identity instead of being silently dropped by fixed display lists.
  return [key]
}

/**
 * Maps any DB/alias provider string to its canonical key.
 *
 * Mirrors the raw-alias branches of `providerDimensionExpression` in
 * `server/report-service.mjs` for client-side filtering. Server rows are
 * normally already normalized; retain this helper for new code paths and raw
 * health aliases such as `gemini`, `claude`, and routed provider strings.
 *
 * Wave 11: nvidia_nim is idempotent (already canonical).
 *
 * @example canonicalProvider('gemini') → 'google'
 * @example canonicalProvider('claude') → 'anthropic'
 * @example canonicalProvider('openai') → 'openai'
 * @example canonicalProvider('nvidia_nim') → 'nvidia_nim'
 */
export function canonicalProvider(provider: string): string {
  const key = provider.toLowerCase()
  // Keep the legacy browser-only oa_xai route compatible with existing data.
  if (key.startsWith('xai/') || key.startsWith('oa_xai/')) return 'xai'
  if (
    key === 'claude' ||
    key === 'anthropic' ||
    key.startsWith('claude/') ||
    key.startsWith('anthropic/')
  ) {
    return 'anthropic'
  }
  if (key.startsWith('deepseek/')) return 'deepseek'
  if (
    key === 'nvidia' ||
    key.startsWith('nvidia_nim/') ||
    key.startsWith('nvidia/')
  ) {
    return 'nvidia_nim'
  }
  if (key.startsWith('local/') || key.startsWith('local_')) return 'local'
  for (const [canonical, aliases] of Object.entries(PROVIDER_ALIASES)) {
    if (aliases.includes(key)) return canonical
  }
  return key
}

/** Groups provider-tagged rows by canonical key without rewriting row identity. */
export function groupByCanonicalProvider<
  T extends { provider?: string | null },
>(rows: readonly T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  for (const row of rows) {
    const provider = row.provider ?? ''
    if (provider === '') continue
    const key = canonicalProvider(provider)
    const existing = grouped.get(key)
    if (existing === undefined) {
      grouped.set(key, [row])
    } else {
      existing.push(row)
    }
  }
  return grouped
}

/** Returns the curated display label, or the canonical key for new providers. */
export function providerDisplayLabel(provider: string): string {
  const key = canonicalProvider(provider)
  return PROVIDER_LABELS[key] ?? key
}

/**
 * Quota-only providers that appear in Provider Status cards but are not
 * part of the canonical 8-provider attribution/trend/ledger set.
 * Alibaba Token Plan, Kimi Code, Cursor Agent, and Z.ai Coding Plan are
 * quota-only telemetry surfaces and are not part of the canonical attribution
 * provider set.
 */
export const QUOTA_ONLY_PROVIDERS: ReadonlyArray<string> = Object.freeze([
  'alibaba_token_plan',
  'kimi_code',
  'cursor_agent',
  'zai_coding_plan',
])
