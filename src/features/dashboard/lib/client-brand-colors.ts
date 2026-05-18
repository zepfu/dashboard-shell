/**
 * client-brand-colors — Brand colour map for known AI coding clients.
 *
 * Used by DonutChart and ClientBreakdownTable to render consistent
 * client-specific colours. Falls back to the `other` colour for
 * unrecognised clients.
 */

/** Map of client identifier → brand hex colour. */
export const CLIENT_BRAND_COLORS: Record<string, string> = {
  'claude-code': '#cc7855',
  'gemini-cli': '#4285f4',
  codex: '#10a37f',
  cursor: '#9575cd',
  aider: '#ef4444',
  other: '#94a3b8',
}
