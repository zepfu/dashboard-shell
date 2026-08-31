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
    laneKey: 'anthropic/weekly',
    laneLabel: 'All Models · 7d',
    quotaType: 'weekly',
    googleClass: null,
  },
  {
    laneKey: 'anthropic/weekly_overage_included',
    laneLabel: 'Fable · 7d overage-included',
    quotaType: 'weekly_overage_included',
    googleClass: null,
  },
  {
    laneKey: 'anthropic/special',
    laneLabel: 'Retired Sonnet · 7d',
    quotaType: 'special',
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
    quotaKey: 'codex_spark:tokens',
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
    quotaKey: 'codex_spark:tokens',
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

export const XAI_GROK_BUILD_WEEKLY_CREDITS_KEY =
  'xai_grok_build_weekly_credits:credits' as const
export const XAI_GROK_BUILD_MONTHLY_REQUESTS_KEY =
  'xai_grok_build_monthly_requests:requests' as const

export const OPENAI_CODEX_SPARK_CURRENT_KEY = 'codex_spark:tokens' as const

const XAI_LANE_DEFS: LaneDef[] = [
  {
    laneKey: 'xai/grok-build-weekly-credits',
    laneLabel: 'Grok Build · Weekly credits',
    quotaType: 'weekly',
    googleClass: null,
    quotaKey: XAI_GROK_BUILD_WEEKLY_CREDITS_KEY,
  },
  {
    laneKey: 'xai/grok-build-monthly-requests',
    laneLabel: 'Grok Build · Monthly requests',
    quotaType: 'monthly',
    googleClass: null,
    quotaKey: XAI_GROK_BUILD_MONTHLY_REQUESTS_KEY,
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

export const ALIBABA_TOKEN_PLAN_5H_CREDITS_KEY =
  'alibaba_token_plan_5h:credits' as const
export const ALIBABA_TOKEN_PLAN_7D_CREDITS_KEY =
  'alibaba_token_plan_7d:credits' as const
export const KIMI_CODE_5H_QUOTA_UNITS_KEY = 'kimi_code_5h:quota_units' as const
export const KIMI_CODE_7D_QUOTA_UNITS_KEY = 'kimi_code_7d:quota_units' as const

export const CURSOR_AGENT_MONTHLY_CENTS_KEY =
  'cursor_agent_monthly:cents' as const

export const ZAI_CODING_PLAN_5H_CREDITS_KEY =
  'zai_coding_plan_5h:credits' as const
export const ZAI_CODING_PLAN_5H_PERCENT_KEY =
  'zai_coding_plan_5h:percent' as const
export const ZAI_CODING_PLAN_5H_COUNT_KEY = 'zai_coding_plan_5h:count' as const
export const ZAI_CODING_PLAN_7D_CREDITS_KEY =
  'zai_coding_plan_7d:credits' as const
export const ZAI_CODING_PLAN_7D_PERCENT_KEY =
  'zai_coding_plan_7d:percent' as const
export const ZAI_CODING_PLAN_7D_COUNT_KEY = 'zai_coding_plan_7d:count' as const

const ALIBABA_TOKEN_PLAN_LANE_DEFS: LaneDef[] = [
  {
    laneKey: 'alibaba_token_plan/5h-credits',
    laneLabel: '5-hour Credits',
    quotaType: 'short',
    googleClass: null,
    quotaKey: ALIBABA_TOKEN_PLAN_5H_CREDITS_KEY,
  },
  {
    laneKey: 'alibaba_token_plan/7d-credits',
    laneLabel: '7-day Credits',
    quotaType: 'weekly',
    googleClass: null,
    quotaKey: ALIBABA_TOKEN_PLAN_7D_CREDITS_KEY,
  },
]

/**
 * D1-492: Kimi Code (Moonshot AI) subscription quota windows. The stored
 * contract reports one row per window with quota_type/unit `quota_units`,
 * periods `5h`/`7d`, and absolute quota_limit/used/remaining values —
 * unlike Alibaba Token Plan's percentage-only credits. Do not alias to
 * Moonshot API or any other subscription product.
 */
const KIMI_CODE_LANE_DEFS: LaneDef[] = [
  {
    laneKey: 'kimi_code/5h-quota-units',
    laneLabel: '5-hour Quota Units',
    quotaType: 'short',
    googleClass: null,
    quotaKey: KIMI_CODE_5H_QUOTA_UNITS_KEY,
  },
  {
    laneKey: 'kimi_code/7d-quota-units',
    laneLabel: '7-day Quota Units',
    quotaType: 'weekly',
    googleClass: null,
    quotaKey: KIMI_CODE_7D_QUOTA_UNITS_KEY,
  },
]

const CURSOR_AGENT_LANE_DEFS: LaneDef[] = [
  {
    laneKey: 'cursor_agent/monthly-cents',
    laneLabel: 'Monthly Cents',
    quotaType: 'monthly',
    googleClass: null,
    quotaKey: CURSOR_AGENT_MONTHLY_CENTS_KEY,
  },
]

const ZAI_CODING_PLAN_LANE_DEFS: LaneDef[] = [
  {
    laneKey: 'zai_coding_plan/5h-credits',
    laneLabel: '5-hour Credits',
    quotaType: 'short',
    googleClass: null,
    quotaKey: ZAI_CODING_PLAN_5H_CREDITS_KEY,
  },
  {
    laneKey: 'zai_coding_plan/5h-percent',
    laneLabel: '5-hour Percent',
    quotaType: 'short',
    googleClass: null,
    quotaKey: ZAI_CODING_PLAN_5H_PERCENT_KEY,
  },
  {
    laneKey: 'zai_coding_plan/5h-count',
    laneLabel: '5-hour Count',
    quotaType: 'short',
    googleClass: null,
    quotaKey: ZAI_CODING_PLAN_5H_COUNT_KEY,
  },
  {
    laneKey: 'zai_coding_plan/7d-credits',
    laneLabel: '7-day Credits',
    quotaType: 'weekly',
    googleClass: null,
    quotaKey: ZAI_CODING_PLAN_7D_CREDITS_KEY,
  },
  {
    laneKey: 'zai_coding_plan/7d-percent',
    laneLabel: '7-day Percent',
    quotaType: 'weekly',
    googleClass: null,
    quotaKey: ZAI_CODING_PLAN_7D_PERCENT_KEY,
  },
  {
    laneKey: 'zai_coding_plan/7d-count',
    laneLabel: '7-day Count',
    quotaType: 'weekly',
    googleClass: null,
    quotaKey: ZAI_CODING_PLAN_7D_COUNT_KEY,
  },
]

export const PROVIDER_LANE_DEFS: Readonly<Record<string, LaneDef[]>> = {
  anthropic: ANTHROPIC_LANE_DEFS,
  openai: OPENAI_LANE_DEFS,
  antigravity: ANTIGRAVITY_LANE_DEFS,
  google: GOOGLE_LANE_DEFS,
  xai: XAI_LANE_DEFS,
  openrouter: OPENROUTER_LANE_DEFS,
  alibaba_token_plan: ALIBABA_TOKEN_PLAN_LANE_DEFS,
  kimi_code: KIMI_CODE_LANE_DEFS,
  cursor_agent: CURSOR_AGENT_LANE_DEFS,
  zai_coding_plan: ZAI_CODING_PLAN_LANE_DEFS,
}
