/**
 * Per-provider quota lane definitions.
 * Wave 11: extracted from phosphor-dashboard.testkit.ts
 */

export interface LaneDef {
  laneKey: string
  laneLabel: string
  quotaType: string
  googleClass: string | null
  quotaKey?: string
  sourceProvider?: string
}

const ANTHROPIC_LANE_DEFS: LaneDef[] = [
  {
    laneKey: 'anthropic/short',
    laneLabel: 'All Models · 5hr',
    quotaType: 'short',
    googleClass: null,
  },
  {
    laneKey: 'anthropic/special',
    laneLabel: 'Sonnet · 7d',
    quotaType: 'special',
    googleClass: null,
  },
  {
    laneKey: 'anthropic/weekly',
    laneLabel: 'All Models · 7d',
    quotaType: 'weekly',
    googleClass: null,
  },
]

const OPENAI_LANE_DEFS: LaneDef[] = [
  {
    laneKey: 'openai/short',
    laneLabel: 'All Models · 5hr',
    quotaType: 'short',
    googleClass: null,
  },
  {
    laneKey: 'openai/short_special',
    laneLabel: 'codex-spark · 5hr',
    quotaType: 'short_special',
    googleClass: null,
  },
  {
    laneKey: 'openai/weekly',
    laneLabel: 'All Models · 7d',
    quotaType: 'weekly',
    googleClass: null,
  },
  {
    laneKey: 'openai/special',
    laneLabel: 'codex-spark · 7d',
    quotaType: 'special',
    googleClass: null,
  },
]

const ANTIGRAVITY_LANE_DEFS: LaneDef[] = [
  {
    laneKey: 'antigravity/gemini-pool',
    laneLabel: 'Gemini Pool · WTUs',
    quotaType: 'wtus',
    googleClass: null,
    quotaKey: 'antigravity_code_assist:gemini_pool',
  },
  {
    laneKey: 'antigravity/vertex-pool',
    laneLabel: 'Vertex Pool · WTUs',
    quotaType: 'wtus',
    googleClass: null,
    quotaKey: 'antigravity_code_assist:vertex_pool',
  },
]

const GOOGLE_LANE_DEFS: LaneDef[] = [
  // flash-lite MUST be checked before flash (substring containment).
  {
    laneKey: 'google/flash-lite',
    laneLabel: 'Flash-Lite · 24h',
    quotaType: 'short',
    googleClass: 'gemini-flash-lite',
  },
  {
    laneKey: 'google/flash',
    laneLabel: 'Flash · 24h',
    quotaType: 'short',
    googleClass: 'gemini-flash',
  },
  {
    laneKey: 'google/pro',
    laneLabel: 'Pro · 24h',
    quotaType: 'short',
    googleClass: 'gemini-pro',
  },
  {
    laneKey: 'google/antigravity-gemini-pool',
    laneLabel: 'Antigravity Gemini Pool · WTUs',
    quotaType: 'wtus',
    googleClass: null,
    quotaKey: 'antigravity_code_assist:gemini_pool',
    sourceProvider: 'antigravity',
  },
  {
    laneKey: 'google/antigravity-vertex-pool',
    laneLabel: 'Antigravity Vertex Pool · WTUs',
    quotaType: 'wtus',
    googleClass: null,
    quotaKey: 'antigravity_code_assist:vertex_pool',
    sourceProvider: 'antigravity',
  },
]

const XAI_LANE_DEFS: LaneDef[] = [
  {
    laneKey: 'xai/monthly',
    laneLabel: 'All Models · 30d',
    quotaType: 'monthly',
    googleClass: null,
  },
]

const OPENROUTER_LANE_DEFS: LaneDef[] = [
  {
    laneKey: 'openrouter/requests',
    laneLabel: 'Free Requests · 24h',
    quotaType: 'short',
    googleClass: null,
  },
]

export const PROVIDER_LANE_DEFS: Readonly<Record<string, LaneDef[]>> = {
  anthropic: ANTHROPIC_LANE_DEFS,
  openai: OPENAI_LANE_DEFS,
  antigravity: ANTIGRAVITY_LANE_DEFS,
  google: GOOGLE_LANE_DEFS,
  xai: XAI_LANE_DEFS,
  openrouter: OPENROUTER_LANE_DEFS,
}
