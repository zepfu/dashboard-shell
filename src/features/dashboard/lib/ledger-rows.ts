/**
 * Model ledger row builders.
 * Wave 11: extracted from phosphor-dashboard.testkit.ts
 */
import type {
  UsageReportProviderLatencyHealthRow,
  UsageReportProviderStatusUsageRow,
  UsageReportQuotaRow,
  UsageReportRow,
  UsageReportToolActivityRow,
  UsageReportTrendRow,
} from '../api/usage-report'
import {
  type ModelLatencySummary,
  type ModelRow,
} from '../components/master-ledger-aggregation'
import { buildToolActivity } from '../components/master-ledger-tool-activity'
import type { TopModelRow } from '../components/provider-card'
import {
  agentQualityFromFlatRow,
  combineAgentQualitySummaries,
  type AgentQualitySummary,
} from './agent-quality'
import { CANONICAL_PROVIDERS } from './provider-identity'
import { keyFor } from './quota-bars/fields'
import { canonicalProvider, providerAliases } from './usage-report-display'

// ---------------------------------------------------------------------------
// computeFleetErrors lives in usage-report-display.ts (lib) so the helper
// can be imported by both phosphor-dashboard and index.tsx without violating
// the react-refresh/only-export-components constraint.
// ---------------------------------------------------------------------------

// CANONICAL_PROVIDERS is now imported from the single-owner
// lib/provider-identity.ts module (Wave 11). deriveProviders is a thin
// wrapper that returns a fresh copy for callers that expect mutability.

/**
 * Always returns the canonical 8 providers in fixed order.
 *
 * Wave 11 PR2 (11-f): replaces dynamic derivation from the API response so
 * every provider card slot (including `local`) is always present.
 */
export function deriveProviders(): string[] {
  return [...CANONICAL_PROVIDERS]
}

export function canonicalRepositoryName(
  repository: string | null | undefined
): string {
  return (repository ?? '(unknown)').replace(/\s+\(memory\)$/i, '')
}

function latencySummaryFromReportRow(
  row: UsageReportRow | UsageReportProviderStatusUsageRow
): ModelLatencySummary | undefined {
  const summary: ModelLatencySummary = {
    sampleRows: row.latency_sample_rows ?? row.traces ?? 0,
    totalServerP50Ms: row.total_server_elapsed_p50_ms,
    totalServerP95Ms: row.total_server_elapsed_p95_ms,
    totalServerCount: row.total_server_elapsed_count,
    upstreamElapsedP50Ms: row.llm_upstream_elapsed_p50_ms,
    upstreamElapsedP95Ms: row.llm_upstream_elapsed_p95_ms,
    upstreamElapsedCount: row.llm_upstream_elapsed_count,
    ttftP95Ms: row.ttft_p95_ms,
    ttftCount: row.ttft_count,
    litellmProcessingP95Ms: row.litellm_processing_p95_ms,
    litellmProcessingCount: row.litellm_processing_count,
    upstreamStreamP95Ms: row.llm_upstream_stream_p95_ms,
    upstreamStreamCount: row.llm_upstream_stream_count,
    unclassifiedP95Ms: row.latency_unclassified_p95_ms,
    unclassifiedCount: row.latency_unclassified_count,
    previousResponseGapP95Ms: row.previous_response_to_current_request_p95_ms,
    previousResponseGapCount: row.previous_response_to_current_request_count,
    upstreamOutputTokensPerSecondP50:
      row.llm_upstream_output_tokens_per_second_p50,
    upstreamOutputTokensPerSecondP95:
      row.llm_upstream_output_tokens_per_second_p95,
    upstreamOutputTokensPerSecondCount:
      row.llm_upstream_output_tokens_per_second_count,
    streamOutputTokensPerSecondP50: row.llm_stream_output_tokens_per_second_p50,
    streamOutputTokensPerSecondP95: row.llm_stream_output_tokens_per_second_p95,
    streamOutputTokensPerSecondCount:
      row.llm_stream_output_tokens_per_second_count,
  }
  const hasLatencyCoverage =
    (summary.totalServerCount ?? 0) > 0 ||
    (summary.upstreamElapsedCount ?? 0) > 0 ||
    (summary.ttftCount ?? 0) > 0 ||
    (summary.litellmProcessingCount ?? 0) > 0
  return hasLatencyCoverage ? summary : undefined
}

function maxOptionalNumber(
  left: number | null | undefined,
  right: number | null | undefined
): number | null {
  if (left == null) return right ?? null
  if (right == null) return left
  return Math.max(left, right)
}

function sumOptionalNumber(
  left: number | null | undefined,
  right: number | null | undefined
): number | null {
  if (left == null && right == null) return null
  return (left ?? 0) + (right ?? 0)
}

function mergeLatencySummaries(
  left: ModelLatencySummary | undefined,
  right: ModelLatencySummary | undefined
): ModelLatencySummary | undefined {
  if (left === undefined) return right
  if (right === undefined) return left
  return {
    sampleRows: left.sampleRows + right.sampleRows,
    totalServerP50Ms: maxOptionalNumber(
      left.totalServerP50Ms,
      right.totalServerP50Ms
    ),
    totalServerP95Ms: maxOptionalNumber(
      left.totalServerP95Ms,
      right.totalServerP95Ms
    ),
    totalServerCount: sumOptionalNumber(
      left.totalServerCount,
      right.totalServerCount
    ),
    upstreamElapsedP50Ms: maxOptionalNumber(
      left.upstreamElapsedP50Ms,
      right.upstreamElapsedP50Ms
    ),
    upstreamElapsedP95Ms: maxOptionalNumber(
      left.upstreamElapsedP95Ms,
      right.upstreamElapsedP95Ms
    ),
    upstreamElapsedCount: sumOptionalNumber(
      left.upstreamElapsedCount,
      right.upstreamElapsedCount
    ),
    ttftP95Ms: maxOptionalNumber(left.ttftP95Ms, right.ttftP95Ms),
    ttftCount: sumOptionalNumber(left.ttftCount, right.ttftCount),
    litellmProcessingP95Ms: maxOptionalNumber(
      left.litellmProcessingP95Ms,
      right.litellmProcessingP95Ms
    ),
    litellmProcessingCount: sumOptionalNumber(
      left.litellmProcessingCount,
      right.litellmProcessingCount
    ),
    upstreamStreamP95Ms: maxOptionalNumber(
      left.upstreamStreamP95Ms,
      right.upstreamStreamP95Ms
    ),
    upstreamStreamCount: sumOptionalNumber(
      left.upstreamStreamCount,
      right.upstreamStreamCount
    ),
    unclassifiedP95Ms: maxOptionalNumber(
      left.unclassifiedP95Ms,
      right.unclassifiedP95Ms
    ),
    unclassifiedCount: sumOptionalNumber(
      left.unclassifiedCount,
      right.unclassifiedCount
    ),
    previousResponseGapP95Ms: maxOptionalNumber(
      left.previousResponseGapP95Ms,
      right.previousResponseGapP95Ms
    ),
    previousResponseGapCount: sumOptionalNumber(
      left.previousResponseGapCount,
      right.previousResponseGapCount
    ),
    upstreamOutputTokensPerSecondP50: maxOptionalNumber(
      left.upstreamOutputTokensPerSecondP50,
      right.upstreamOutputTokensPerSecondP50
    ),
    upstreamOutputTokensPerSecondP95: maxOptionalNumber(
      left.upstreamOutputTokensPerSecondP95,
      right.upstreamOutputTokensPerSecondP95
    ),
    upstreamOutputTokensPerSecondCount: sumOptionalNumber(
      left.upstreamOutputTokensPerSecondCount,
      right.upstreamOutputTokensPerSecondCount
    ),
    streamOutputTokensPerSecondP50: maxOptionalNumber(
      left.streamOutputTokensPerSecondP50,
      right.streamOutputTokensPerSecondP50
    ),
    streamOutputTokensPerSecondP95: maxOptionalNumber(
      left.streamOutputTokensPerSecondP95,
      right.streamOutputTokensPerSecondP95
    ),
    streamOutputTokensPerSecondCount: sumOptionalNumber(
      left.streamOutputTokensPerSecondCount,
      right.streamOutputTokensPerSecondCount
    ),
  }
}

function ledgerP50Ms(
  summary: ModelLatencySummary | undefined,
  fallback: number | null | undefined
): number {
  return (
    summary?.totalServerP50Ms ?? summary?.upstreamElapsedP50Ms ?? fallback ?? 0
  )
}

function ledgerP95Ms(
  summary: ModelLatencySummary | undefined,
  fallback: number | null | undefined
): number {
  return (
    summary?.totalServerP95Ms ?? summary?.upstreamElapsedP95Ms ?? fallback ?? 0
  )
}

/**
 * Builds ModelRow[] for MasterLedgerTable from providerStatusUsage rows
 * aggregated by provider+model key.
 *
 * Wave 15-B fixes:
 * - 15-B.3: real token_in / token_out aggregated from usageRows (report.rows)
 *   grouped by provider+model, replacing the fake 60/40 split of token_total.
 * - 15-B.4: upstream_p50_ms wired from healthRows (was always null/0).
 * - 15-B.5: quota_pct computed from quotaRows (was always hardcoded 0).
 */
export function buildModelRows(
  rows: UsageReportProviderStatusUsageRow[],
  healthRows: UsageReportProviderLatencyHealthRow[],
  usageRows: UsageReportRow[],
  quotaRows: UsageReportQuotaRow[],
  trendRows: UsageReportTrendRow[],
  toolActivityRows: UsageReportToolActivityRow[] = []
): ModelRow[] {
  // 15-B.3: Aggregate real token_in / token_out from report.rows by provider+model.
  // providerStatusUsage (the `rows` param) lacks per-direction token fields;
  // report.rows has them and uses group_by=provider,model,repository so we sum
  // across all repository buckets.
  // 15-B.2: normalise via canonicalProvider so 'google' rows in report.rows
  // always key as 'google' (not 'gemini'), matching providerStatusUsage keys.
  //
  // 20-PhosphorDash Fix ⚠-W19-2: also accumulate token_cache_input and
  // token_cache_creation per provider+model so we can compute cache_pct.
  // cache_pct = (cache_input + cache_creation) / token_in × 100.
  // We use token_in (not token_total) as the denominator because cache tokens
  // are measured relative to input tokens processed.
  // 26-Bundle (operator F#12): extend per-key accumulator with cache_miss and
  // reasoning fields so they can be surfaced in the new ledger columns.
  const tokensByKey = new Map<
    string,
    {
      token_in: number
      token_out: number
      cache_input: number
      cache_creation: number
      cache_miss_usd: number
      reasoning_reported: number
      reasoning_estimated: number
      agentQuality?: AgentQualitySummary
    }
  >()
  for (const r of usageRows) {
    const m = (r.model ?? '').toLowerCase()
    const p = canonicalProvider(r.provider ?? '')
    if (!p || !m) continue
    const key = keyFor(r.provider ?? '', r.model ?? '')
    const existing = tokensByKey.get(key)
    const tin = r.token_in ?? 0
    const tout = r.token_out ?? 0
    const ci = r.token_cache_input ?? 0
    const cc = r.token_cache_creation ?? 0
    const cm_usd = r.cache_miss_usd_cost ?? 0
    const rr = r.token_reasoning_reported ?? 0
    const re = r.token_reasoning_estimated ?? 0
    const agentQuality = agentQualityFromFlatRow(r)
    if (existing === undefined) {
      tokensByKey.set(key, {
        token_in: tin,
        token_out: tout,
        cache_input: ci,
        cache_creation: cc,
        cache_miss_usd: cm_usd,
        reasoning_reported: rr,
        reasoning_estimated: re,
        agentQuality,
      })
    } else {
      existing.token_in += tin
      existing.token_out += tout
      existing.cache_input += ci
      existing.cache_creation += cc
      existing.cache_miss_usd += cm_usd
      existing.reasoning_reported += rr
      existing.reasoning_estimated += re
      existing.agentQuality = combineAgentQualitySummaries([
        existing.agentQuality,
        agentQuality,
      ])
    }
  }

  // quotaRows param retained in signature for backward compat with call-sites
  // but quota_pct column removed (Wave 26, operator F#13).
  void quotaRows

  // Build per-(provider, model) sparkline series from trend data (24h buckets).
  // Sort chronologically so the polyline reads left-to-right oldest-to-newest.
  // Key mirrors tokensByKey: canonicalProvider + model lowercase.
  const sortedTrendRows = [...trendRows].sort((a, b) =>
    a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0
  )
  const sparkByKey = new Map<string, number[]>()
  for (const t of sortedTrendRows) {
    const m = (t.model ?? '').toLowerCase()
    const p = canonicalProvider(t.provider ?? '')
    if (!p || !m) continue
    const sparkKey = keyFor(t.provider ?? '', t.model ?? '')
    const arr = sparkByKey.get(sparkKey) ?? []
    arr.push(t.token_total)
    sparkByKey.set(sparkKey, arr)
  }

  const sparkByRepositoryKey = new Map<string, number[]>()
  const bucketTokensByRepositoryKey = new Map<string, Map<string, number>>()
  for (const t of trendRows) {
    const p = canonicalProvider(t.provider ?? '')
    const m = (t.model ?? '').toLowerCase()
    if (!p || !m) continue
    const repo = canonicalRepositoryName(t.repository)
    const key = `${p}::${m}::${repo}`
    const bucketMap = bucketTokensByRepositoryKey.get(key) ?? new Map()
    bucketMap.set(t.bucket, (bucketMap.get(t.bucket) ?? 0) + t.token_total)
    bucketTokensByRepositoryKey.set(key, bucketMap)
  }
  for (const [key, bucketMap] of bucketTokensByRepositoryKey) {
    const sortedBuckets = [...bucketMap.entries()].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0
    )
    sparkByRepositoryKey.set(
      key,
      sortedBuckets.map(([, tokens]) => tokens)
    )
  }

  const repositoryChildrenByKey = new Map<string, Map<string, ModelRow>>()
  for (const r of usageRows) {
    const m = (r.model ?? '').toLowerCase()
    const p = canonicalProvider(r.provider ?? '')
    if (!p || !m) continue
    const repo = canonicalRepositoryName(r.repository)
    const modelKey = keyFor(r.provider ?? '', r.model ?? '')
    const repoMap = repositoryChildrenByKey.get(modelKey) ?? new Map()
    const existing = repoMap.get(repo)
    const cacheTokens =
      (r.token_cache_input ?? 0) + (r.token_cache_creation ?? 0)
    const cachePct =
      (r.token_in ?? 0) > 0
        ? Math.round((cacheTokens / Math.max(1, r.token_in ?? 0)) * 1000) / 10
        : undefined
    const cacheMissUsd = r.cache_miss_usd_cost ?? 0
    const cost = r.usd_cost ?? 0
    const cacheMissPct =
      cacheMissUsd > 0 && cost > 0
        ? Math.round((cacheMissUsd / cost) * 1000) / 10
        : undefined
    const agentQuality = agentQualityFromFlatRow(r)
    const latencySummary = latencySummaryFromReportRow(r)

    if (existing === undefined) {
      repoMap.set(repo, {
        model: repo,
        provider: p,
        tokens_in: r.token_in ?? 0,
        tokens_out: r.token_out ?? 0,
        requests: r.traces ?? 0,
        p50_ms: ledgerP50Ms(latencySummary, r.llm_upstream_elapsed_average_ms),
        p95_ms: ledgerP95Ms(latencySummary, r.llm_upstream_elapsed_average_ms),
        error_pct: 0,
        cost_usd: cost,
        cache_pct: cachePct,
        cache_miss_pct: cacheMissPct,
        cache_miss_usd_cost: cacheMissUsd > 0 ? cacheMissUsd : undefined,
        reasoning_reported: r.token_reasoning_reported ?? 0,
        reasoning_estimated: r.token_reasoning_estimated ?? 0,
        cache_toks: cacheTokens > 0 ? cacheTokens : undefined,
        tool: r.tool_calls ?? undefined,
        git_commits: r.git_commit ?? undefined,
        git_pushes: r.git_push ?? undefined,
        agentQuality,
        latencySummary,
        spark: sparkByRepositoryKey.get(`${modelKey}::${repo}`) ?? [
          r.token_total ?? 0,
        ],
      })
    } else {
      existing.tokens_in += r.token_in ?? 0
      existing.tokens_out += r.token_out ?? 0
      existing.requests += r.traces ?? 0
      existing.cost_usd += cost
      existing.latencySummary = mergeLatencySummaries(
        existing.latencySummary,
        latencySummary
      )
      existing.p50_ms = Math.max(
        existing.p50_ms,
        ledgerP50Ms(latencySummary, r.llm_upstream_elapsed_average_ms)
      )
      existing.p95_ms = Math.max(
        existing.p95_ms,
        ledgerP95Ms(latencySummary, r.llm_upstream_elapsed_average_ms)
      )
      existing.cache_miss_usd_cost =
        (existing.cache_miss_usd_cost ?? 0) + cacheMissUsd
      existing.reasoning_reported =
        (existing.reasoning_reported ?? 0) + (r.token_reasoning_reported ?? 0)
      existing.reasoning_estimated =
        (existing.reasoning_estimated ?? 0) + (r.token_reasoning_estimated ?? 0)
      existing.cache_toks = (existing.cache_toks ?? 0) + cacheTokens
      existing.tool = (existing.tool ?? 0) + (r.tool_calls ?? 0)
      existing.git_commits = (existing.git_commits ?? 0) + (r.git_commit ?? 0)
      existing.git_pushes = (existing.git_pushes ?? 0) + (r.git_push ?? 0)
      existing.agentQuality = combineAgentQualitySummaries([
        existing.agentQuality,
        agentQuality,
      ])
      existing.spark = sparkByRepositoryKey.get(`${modelKey}::${repo}`) ?? [
        ...((existing.spark ?? []).length > 0 ? (existing.spark ?? []) : []),
        r.token_total ?? 0,
      ]
      existing.cache_pct =
        existing.tokens_in > 0 && (existing.cache_toks ?? 0) > 0
          ? Math.round(
              ((existing.cache_toks ?? 0) / existing.tokens_in) * 1000
            ) / 10
          : undefined
      existing.cache_miss_pct =
        (existing.cache_miss_usd_cost ?? 0) > 0 && existing.cost_usd > 0
          ? Math.round(
              ((existing.cache_miss_usd_cost ?? 0) / existing.cost_usd) * 1000
            ) / 10
          : undefined
    }
    repositoryChildrenByKey.set(modelKey, repoMap)
  }

  // Group health data by provider+model for latency lookups
  // 15-B.4: also accumulate upstream_p50_ms (previously always left null)
  const healthByKey = new Map<
    string,
    {
      p50: number | null
      p95: number | null
      errors: number
      requests: number
    }
  >()
  for (const row of healthRows) {
    const key = keyFor(row.provider, row.model)
    const existing = healthByKey.get(key)
    const errors =
      row.provider_error_events +
      row.provider_5xx_events +
      row.provider_timeout_events
    if (existing === undefined) {
      healthByKey.set(key, {
        // 15-B.4: seed p50 from the first (most-recent) row with a non-null value
        p50: row.upstream_p50_ms,
        p95: row.upstream_p95_ms,
        errors,
        requests: row.requests,
      })
    } else {
      existing.errors += errors
      existing.requests += row.requests
      // 15-B.4: take max p50/p95 across all health buckets for this model key
      if (row.upstream_p50_ms !== null) {
        existing.p50 =
          existing.p50 !== null
            ? Math.max(existing.p50, row.upstream_p50_ms)
            : row.upstream_p50_ms
      }
      if (row.upstream_p95_ms !== null) {
        existing.p95 =
          existing.p95 !== null
            ? Math.max(existing.p95, row.upstream_p95_ms)
            : row.upstream_p95_ms
      }
    }
  }

  // W33: Build a lookup of toolActivity rows indexed by "provider::model" so
  // each ModelRow can quickly retrieve its pre-processed tool activity data.
  // Keys use lowercase provider + model to match tokensByKey and healthByKey.
  const toolActivityByKey = new Map<string, UsageReportToolActivityRow[]>()
  for (const ta of toolActivityRows) {
    const taKey = keyFor(ta.provider, ta.model)
    const existing = toolActivityByKey.get(taKey)
    if (existing === undefined) {
      toolActivityByKey.set(taKey, [ta])
    } else {
      existing.push(ta)
    }
  }

  return rows.map((row) => {
    const key = keyFor(row.provider, row.model)
    const health = healthByKey.get(key)
    const latencySummary = latencySummaryFromReportRow(row)
    const requests = health?.requests ?? row.traces
    const errors = health?.errors ?? 0
    const errorPct = requests > 0 ? (errors / requests) * 100 : 0
    // 15-B.3: use real per-direction tokens from report.rows; fall back to
    // 60/40 split only when the usage rows don't have coverage for this model
    // (e.g. providerStatusUsage has data but report.rows cap was hit)
    const tokenAgg = tokensByKey.get(key)
    const tokens_in = tokenAgg?.token_in ?? Math.round(row.token_total * 0.6)
    const tokens_out = tokenAgg?.token_out ?? Math.round(row.token_total * 0.4)

    // 20-PhosphorDash Fix ⚠-W19-2: compute cache_pct from aggregated cache
    // tokens. Formula: (cache_input + cache_creation) / token_in × 100.
    // Returns null (rendered as '—') when token_in is zero or data unavailable.
    let cache_pct: number | null = null
    if (tokenAgg !== undefined && tokenAgg.token_in > 0) {
      const cacheTokens = tokenAgg.cache_input + tokenAgg.cache_creation
      cache_pct = Math.round((cacheTokens / tokenAgg.token_in) * 1000) / 10
    }

    // 26-Bundle (operator F#12): derive cache_miss_pct + populate new fields.
    // cache_miss_pct: best-effort — use cache_miss_usd / usd_cost * 100 when
    // both are positive; otherwise undefined so table shows '—'.
    const cache_miss_usd_cost =
      tokenAgg !== undefined ? tokenAgg.cache_miss_usd : undefined
    let cache_miss_pct: number | undefined
    if (
      cache_miss_usd_cost !== undefined &&
      cache_miss_usd_cost > 0 &&
      row.usd_cost > 0
    ) {
      cache_miss_pct =
        Math.round((cache_miss_usd_cost / row.usd_cost) * 1000) / 10
    }
    const reasoning_reported =
      tokenAgg !== undefined ? tokenAgg.reasoning_reported : undefined
    const reasoning_estimated =
      tokenAgg !== undefined ? tokenAgg.reasoning_estimated : undefined

    // W33: pre-processed tool activity for the TOOL cell hover tooltip.
    // buildToolActivity returns a zero-calls result when no rows are found,
    // so undefined is only stored when the lookup is empty (no API data).
    // W34: also derive the scalar `tool` field from totalCalls so the TOOL
    // cell renders the count instead of '—' (wave34-data-flow-audit Critical #4).
    const rowToolActivity = toolActivityByKey.has(key)
      ? buildToolActivity(toolActivityByKey.get(key) ?? [])
      : undefined

    return {
      model: row.model,
      provider: row.provider,
      tokens_in,
      tokens_out,
      requests,
      p50_ms: ledgerP50Ms(latencySummary, health?.p50), // 15-B.4: wired upstream_p50_ms
      p95_ms: ledgerP95Ms(latencySummary, health?.p95),
      error_pct: Math.round(errorPct * 10) / 10,
      cost_usd: row.usd_cost,
      // quota_pct removed — Wave 26 operator F#13
      cache_pct: cache_pct ?? undefined, // 20-PhosphorDash: null → undefined for optional field
      // 26-Bundle (operator F#12): cache miss + reasoning fields
      cache_miss_pct,
      cache_miss_usd_cost:
        cache_miss_usd_cost !== undefined ? cache_miss_usd_cost : undefined,
      reasoning_reported:
        reasoning_reported !== undefined ? reasoning_reported : undefined,
      reasoning_estimated:
        reasoning_estimated !== undefined ? reasoning_estimated : undefined,
      // Wave 30 operator reorder: total cache tokens for new Cache toks column
      cache_toks:
        tokenAgg !== undefined
          ? tokenAgg.cache_input + tokenAgg.cache_creation
          : undefined,
      spark: sparkByKey.get(keyFor(row.provider, row.model)) ?? [
        row.token_total,
      ],
      tool: rowToolActivity?.totalCalls,
      toolActivity: rowToolActivity,
      agentQuality: tokenAgg?.agentQuality,
      latencySummary,
      repositoryChildren: [
        ...(repositoryChildrenByKey.get(key)?.values() ?? []),
      ].sort(
        (left, right) =>
          right.tokens_in +
          right.tokens_out -
          (left.tokens_in + left.tokens_out)
      ),
    }
  })
}

/**
 * Builds TopModelRow[] for ProviderCard card-pane-right at 4K.
 * Groups providerStatusUsage by provider+model and returns top 3 by tokens.
 *
 * Wave 18-Cards C3: populates `p95_ms` from the latest non-null
 * `upstream_p95_ms` in `healthRows` matching provider+model, fixing the
 * prior bug where the `.p95` cell displayed request count instead of latency.
 */
export function buildTopModels(
  rows: {
    provider: string
    model: string
    token_total: number
    usd_cost: number
    traces: number
  }[],
  provider: string,
  healthRows: UsageReportProviderLatencyHealthRow[],
  aliases: readonly string[] = providerAliases(provider)
): TopModelRow[] {
  // 20-PhosphorDash Fix ⚠-W19-1: canonicalize the target provider so that
  // callers passing 'google' correctly match health rows stored as 'gemini'.
  // Without this, all Google top-model .p95 cells render '0ms' despite real
  // latency data being available in providerLatencyHealth.
  const sourceCanonicals = new Set(
    aliases.map((alias) => canonicalProvider(alias))
  )

  return rows
    .filter((r) => aliases.includes(r.provider.toLowerCase()))
    .sort((a, b) => b.token_total - a.token_total)
    .slice(0, 3)
    .map((r) => {
      // Look up the most-recent health row with a non-null p95 for this
      // provider+model combination. healthRows are ordered bucket_start DESC
      // (newest first per 15-B.1), so the first match is the most recent.
      // canonicalProvider on the health row's provider handles the
      // 'gemini' → 'google' alias transparently.
      const lowerModel = r.model.toLowerCase()
      const matchingHealthRow = healthRows.find(
        (h) =>
          sourceCanonicals.has(canonicalProvider(h.provider)) &&
          h.model.toLowerCase() === lowerModel &&
          (h.upstream_p95_ms ?? h.total_p95_ms) !== null
      )
      const passiveP95 =
        matchingHealthRow !== undefined
          ? (matchingHealthRow.upstream_p95_ms ??
            matchingHealthRow.total_p95_ms ??
            null)
          : null
      return {
        model: r.model,
        tokens: r.token_total,
        cost_usd: r.usd_cost,
        requests: r.traces,
        p95_ms: passiveP95,
      }
    })
}
