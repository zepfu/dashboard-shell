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
 * Provider aliases — maps a canonical provider key to the set of strings
 * that may appear in the `providerLatencyHealth` materialized view or
 * other API responses.
 *
 * Wave 15-B (15-B.2): The DB materialised view `provider_latency_health_5m`
 * stores Google rows under the key `'gemini'`, while the dashboard's canonical
 * provider list and the `rows` collection both use `'google'` (because
 * report-service.mjs CASE-maps them on the rows/trend side but NOT on the
 * health side). This map lets callers expand a canonical key to all its DB
 * aliases before filtering health rows.
 */
const PROVIDER_ALIASES: Record<string, readonly string[]> = {
  antigravity: ['antigravity'],
  google: ['google', 'gemini'],
  local: [
    'local',
    'local_biomed',
    'local_embed',
    'local_litellm',
    'local_llm',
    'local_rerank',
  ],
  xai: ['xai', 'x.ai', 'oa_xai'],
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
  // Fail loud on non-canonical / unknown keys — do not silently return [raw input].
  return []
}

/**
 * Maps any DB/alias provider string to its canonical key.
 *
 * Wave 15-B.2: Use in buildModelRows to normalise health row provider keys
 * so that DB keys like 'gemini' map to the canonical 'google' key used in
 * providerStatusUsage, ensuring health latency lookups succeed.
 *
 * Wave 11: nvidia_nim is idempotent (already canonical).
 *
 * @example canonicalProvider('gemini') → 'google'
 * @example canonicalProvider('openai') → 'openai'
 * @example canonicalProvider('nvidia_nim') → 'nvidia_nim'
 */
export function canonicalProvider(provider: string): string {
  const key = provider.toLowerCase()
  if (key.startsWith('xai/') || key.startsWith('oa_xai/')) return 'xai'
  for (const [canonical, aliases] of Object.entries(PROVIDER_ALIASES)) {
    if (aliases.includes(key)) return canonical
  }
  return key
}
