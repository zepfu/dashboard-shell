import {
  agentQualityIssueSortValue,
  combineAgentQualitySummaries,
  type AgentQualitySummary,
} from '../lib/agent-quality'
import {
  formatLedgerModelDisplayName,
  type ModelFamilyDefinition,
} from './master-ledger-model-meta'

// ---------------------------------------------------------------------------
// Core row / ledger types (source of truth for aggregation + display)
// These are re-exported from master-ledger-table.tsx for public API compat.
// ---------------------------------------------------------------------------

/** One row in the master ledger table. */
export interface ModelLatencySummary {
  sampleRows: number
  totalServerP50Ms?: number | null
  totalServerP95Ms?: number | null
  totalServerCount?: number | null
  upstreamElapsedP50Ms?: number | null
  upstreamElapsedP95Ms?: number | null
  upstreamElapsedCount?: number | null
  ttftP95Ms?: number | null
  ttftCount?: number | null
  litellmProcessingP95Ms?: number | null
  litellmProcessingCount?: number | null
  upstreamStreamP95Ms?: number | null
  upstreamStreamCount?: number | null
  unclassifiedP95Ms?: number | null
  unclassifiedCount?: number | null
  previousResponseGapP95Ms?: number | null
  previousResponseGapCount?: number | null
  upstreamOutputTokensPerSecondP50?: number | null
  upstreamOutputTokensPerSecondP95?: number | null
  upstreamOutputTokensPerSecondCount?: number | null
  streamOutputTokensPerSecondP50?: number | null
  streamOutputTokensPerSecondP95?: number | null
  streamOutputTokensPerSecondCount?: number | null
}

export interface ModelRow {
  model: string
  provider: string
  tokens_in: number
  tokens_out: number
  requests: number
  p50_ms: number
  p95_ms: number
  error_pct: number
  cost_usd: number
  // 4K-only optional fields
  cache_pct?: number
  queue?: number
  resets?: number
  // Wave 26 — new cache/reasoning columns (operator F#12)
  /** Percentage of total row USD cost attributed to cache miss premium
   *  (cache_miss_usd_cost / usd_cost × 100). Range 0–100. */
  cache_miss_pct?: number
  /** Dollar cost attributed to cache misses. */
  cache_miss_usd_cost?: number
  /** Reasoning tokens as reported by the provider. */
  reasoning_reported?: number
  /** Reasoning tokens estimated (may be approximate). */
  reasoning_estimated?: number
  // Wave 30 operator reorder — total cache tokens (cache_input + cache_creation)
  /** Total cache tokens used: token_cache_input + token_cache_creation. */
  cache_toks?: number
  // 5K-only optional fields
  tool?: number
  git_commits?: number
  git_pushes?: number
  inval?: number
  // Sparkline data (numeric series parallel to sparkBuckets when bucket-aligned)
  spark?: number[]
  /** ISO date (or bucket key) per spark point; enables bucket-aligned aggregation. */
  sparkBuckets?: string[]
  // W33: pre-processed tool activity for TOOL cell hover tooltip
  toolActivity?: import('./master-ledger-tool-activity').ModelToolActivity
  /** Deterministic session-history agent-quality score rollup. */
  agentQuality?: AgentQualitySummary
  /** Millisecond timing split and throughput rollup from session_history. */
  latencySummary?: ModelLatencySummary
  /** Display-only repository children for exact model drilldown. */
  repositoryChildren?: ModelRow[]
}

export type LedgerLevel = 'provider' | 'family' | 'model' | 'repository'
export type LedgerView = 'model' | 'repository'

export interface LedgerDisplayRow extends ModelRow {
  ledgerLevel: LedgerLevel
  ledgerId: string
  ledgerLabel: string
  providerKey: string
  familyKey?: string
  repositoryKey?: string
  childCount: number
  exactModelCount: number
  isExpandable: boolean
}

export interface RepositoryModelEntry {
  repository: string
  providerKey: string
  sourceRow: ModelRow
  repoRow: ModelRow
  family: ModelFamilyDefinition | null
}

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

function sumSpark(rows: readonly ModelRow[]): number[] | undefined {
  const hasBucketAxis = rows.some(
    (row) => (row.sparkBuckets?.length ?? 0) > 0 && (row.spark?.length ?? 0) > 0
  )
  if (hasBucketAxis) {
    const bucketTotals = new Map<string, number>()
    for (const row of rows) {
      const buckets = row.sparkBuckets ?? []
      const values = row.spark ?? []
      for (let i = 0; i < values.length; i++) {
        const bucket = buckets[i]
        if (bucket === undefined) continue
        bucketTotals.set(bucket, (bucketTotals.get(bucket) ?? 0) + values[i])
      }
    }
    if (bucketTotals.size === 0) return undefined
    const orderedBuckets = [...bucketTotals.keys()].sort()
    return orderedBuckets.map((bucket) => bucketTotals.get(bucket) ?? 0)
  }

  const maxLength = Math.max(0, ...rows.map((row) => row.spark?.length ?? 0))
  if (maxLength === 0) return undefined

  return Array.from({ length: maxLength }, (_value, index) =>
    rows.reduce((sum, row) => sum + (row.spark?.[index] ?? 0), 0)
  )
}

export { sumSpark as _sumSparkForTest }

function maxNullable(values: readonly (number | null | undefined)[]) {
  const present = values.filter((value): value is number => value != null)
  return present.length > 0 ? Math.max(...present) : null
}

function sumNullable(values: readonly (number | null | undefined)[]) {
  const present = values.filter((value): value is number => value != null)
  return present.length > 0
    ? present.reduce((sum, value) => sum + value, 0)
    : null
}

function combineModelLatencySummaries(
  rows: readonly ModelRow[]
): ModelLatencySummary | undefined {
  const summaries = rows
    .map((row) => row.latencySummary)
    .filter((summary): summary is ModelLatencySummary => summary !== undefined)
  if (summaries.length === 0) return undefined

  return {
    sampleRows: summaries.reduce((sum, summary) => sum + summary.sampleRows, 0),
    totalServerP50Ms: maxNullable(
      summaries.map((summary) => summary.totalServerP50Ms)
    ),
    totalServerP95Ms: maxNullable(
      summaries.map((summary) => summary.totalServerP95Ms)
    ),
    totalServerCount: sumNullable(
      summaries.map((summary) => summary.totalServerCount)
    ),
    upstreamElapsedP50Ms: maxNullable(
      summaries.map((summary) => summary.upstreamElapsedP50Ms)
    ),
    upstreamElapsedP95Ms: maxNullable(
      summaries.map((summary) => summary.upstreamElapsedP95Ms)
    ),
    upstreamElapsedCount: sumNullable(
      summaries.map((summary) => summary.upstreamElapsedCount)
    ),
    ttftP95Ms: maxNullable(summaries.map((summary) => summary.ttftP95Ms)),
    ttftCount: sumNullable(summaries.map((summary) => summary.ttftCount)),
    litellmProcessingP95Ms: maxNullable(
      summaries.map((summary) => summary.litellmProcessingP95Ms)
    ),
    litellmProcessingCount: sumNullable(
      summaries.map((summary) => summary.litellmProcessingCount)
    ),
    upstreamStreamP95Ms: maxNullable(
      summaries.map((summary) => summary.upstreamStreamP95Ms)
    ),
    upstreamStreamCount: sumNullable(
      summaries.map((summary) => summary.upstreamStreamCount)
    ),
    unclassifiedP95Ms: maxNullable(
      summaries.map((summary) => summary.unclassifiedP95Ms)
    ),
    unclassifiedCount: sumNullable(
      summaries.map((summary) => summary.unclassifiedCount)
    ),
    previousResponseGapP95Ms: maxNullable(
      summaries.map((summary) => summary.previousResponseGapP95Ms)
    ),
    previousResponseGapCount: sumNullable(
      summaries.map((summary) => summary.previousResponseGapCount)
    ),
    upstreamOutputTokensPerSecondP50: maxNullable(
      summaries.map((summary) => summary.upstreamOutputTokensPerSecondP50)
    ),
    upstreamOutputTokensPerSecondP95: maxNullable(
      summaries.map((summary) => summary.upstreamOutputTokensPerSecondP95)
    ),
    upstreamOutputTokensPerSecondCount: sumNullable(
      summaries.map((summary) => summary.upstreamOutputTokensPerSecondCount)
    ),
    streamOutputTokensPerSecondP50: maxNullable(
      summaries.map((summary) => summary.streamOutputTokensPerSecondP50)
    ),
    streamOutputTokensPerSecondP95: maxNullable(
      summaries.map((summary) => summary.streamOutputTokensPerSecondP95)
    ),
    streamOutputTokensPerSecondCount: sumNullable(
      summaries.map((summary) => summary.streamOutputTokensPerSecondCount)
    ),
  }
}

export function aggregateRows(
  rows: readonly ModelRow[],
  overrides: Pick<
    LedgerDisplayRow,
    | 'ledgerLevel'
    | 'ledgerId'
    | 'ledgerLabel'
    | 'providerKey'
    | 'familyKey'
    | 'repositoryKey'
    | 'childCount'
    | 'exactModelCount'
    | 'isExpandable'
  >
): LedgerDisplayRow {
  const requests = rows.reduce((sum, row) => sum + row.requests, 0)
  const cost = rows.reduce((sum, row) => sum + row.cost_usd, 0)
  const cacheToks = rows.reduce((sum, row) => sum + (row.cache_toks ?? 0), 0)
  const weightedErrorTotal = rows.reduce(
    (sum, row) => sum + row.error_pct * row.requests,
    0
  )
  const optionalSum = (
    selector: (row: ModelRow) => number | undefined,
    keepZero = false
  ): number | undefined => {
    const values = rows
      .map(selector)
      .filter((value): value is number => value !== undefined)
    if (values.length === 0) return undefined
    const total = values.reduce((sum, value) => sum + value, 0)
    return total > 0 || keepZero ? total : undefined
  }
  const cacheMissUsdDefined = rows.some(
    (row) => row.cache_miss_usd_cost !== undefined
  )
  const cacheMissUsdSum = rows.reduce(
    (sum, row) => sum + (row.cache_miss_usd_cost ?? 0),
    0
  )
  // queue/resets: summed across children; explicit zero contributes (not suppressed).
  const queueSum = optionalSum((row) => row.queue, true)
  const resetsSum = optionalSum((row) => row.resets, true)

  return {
    model: overrides.ledgerLabel,
    provider: overrides.providerKey,
    tokens_in: rows.reduce((sum, row) => sum + row.tokens_in, 0),
    tokens_out: rows.reduce((sum, row) => sum + row.tokens_out, 0),
    requests,
    p50_ms: Math.max(0, ...rows.map((row) => row.p50_ms)),
    p95_ms: Math.max(0, ...rows.map((row) => row.p95_ms)),
    error_pct:
      requests > 0 ? Math.round((weightedErrorTotal / requests) * 10) / 10 : 0,
    cost_usd: cost,
    cache_pct:
      cacheToks > 0 && rows.some((row) => row.tokens_in > 0)
        ? Math.round(
            (cacheToks /
              Math.max(
                1,
                rows.reduce((sum, row) => sum + row.tokens_in, 0)
              )) *
              1000
          ) / 10
        : undefined,
    cache_miss_pct: (() => {
      const defined = rows.filter((row) => row.cache_miss_pct !== undefined)
      if (defined.length === 0) return undefined
      const definedRequests = defined.reduce(
        (sum, row) => sum + row.requests,
        0
      )
      if (definedRequests <= 0) return undefined
      const weighted = defined.reduce(
        (sum, row) => sum + (row.cache_miss_pct ?? 0) * row.requests,
        0
      )
      return Math.round((weighted / definedRequests) * 10) / 10
    })(),
    cache_miss_usd_cost: cacheMissUsdDefined ? cacheMissUsdSum : undefined,
    reasoning_reported: optionalSum((row) => row.reasoning_reported, true),
    reasoning_estimated: optionalSum((row) => row.reasoning_estimated, true),
    cache_toks: cacheToks > 0 ? cacheToks : undefined,
    queue: queueSum,
    resets: resetsSum,
    tool: optionalSum((row) => row.tool),
    git_commits: optionalSum((row) => row.git_commits),
    git_pushes: optionalSum((row) => row.git_pushes),
    inval: optionalSum((row) => row.inval),
    spark: sumSpark(rows),
    toolActivity: undefined,
    agentQuality: combineAgentQualitySummaries(
      rows.map((row) => row.agentQuality)
    ),
    latencySummary: combineModelLatencySummaries(rows),
    ...overrides,
  }
}

export { aggregateRows as _aggregateRowsForTest }

export function toModelDisplayRow(
  row: ModelRow,
  providerKey: string,
  familyKey?: string
): LedgerDisplayRow {
  const repositoryChildCount = row.repositoryChildren?.length ?? 0
  return {
    ...row,
    provider: providerKey,
    ledgerLevel: 'model',
    ledgerId: `model:${providerKey}:${familyKey ?? 'direct'}:${row.model}`,
    ledgerLabel: formatLedgerModelDisplayName(providerKey, row.model),
    providerKey,
    familyKey,
    childCount: repositoryChildCount,
    exactModelCount: 1,
    isExpandable: repositoryChildCount > 0,
  }
}

export function toRepositoryDisplayRow(
  row: ModelRow,
  providerKey: string,
  familyKey: string | undefined,
  parentModel: string
): LedgerDisplayRow {
  const repositoryKey = row.model
  return {
    ...row,
    provider: providerKey,
    ledgerLevel: 'repository',
    ledgerId: `repository:${providerKey}:${familyKey ?? 'direct'}:${parentModel}:${repositoryKey}`,
    ledgerLabel: repositoryKey,
    providerKey,
    familyKey,
    repositoryKey,
    childCount: 0,
    exactModelCount: 0,
    isExpandable: false,
  }
}

export function toRepositoryPerspectiveModelRow(
  entry: RepositoryModelEntry,
  familyKey?: string
): LedgerDisplayRow {
  return {
    ...entry.repoRow,
    model: entry.sourceRow.model,
    provider: entry.providerKey,
    ledgerLevel: 'model',
    ledgerId: `repository-model:${entry.repository}:${entry.providerKey}:${familyKey ?? 'direct'}:${entry.sourceRow.model}`,
    ledgerLabel: formatLedgerModelDisplayName(
      entry.providerKey,
      entry.sourceRow.model
    ),
    providerKey: entry.providerKey,
    familyKey,
    repositoryKey: entry.repository,
    childCount: 0,
    exactModelCount: 1,
    isExpandable: false,
  }
}

export function compareLedgerValues(
  left: LedgerDisplayRow,
  right: LedgerDisplayRow,
  columnId: string
): number {
  const valueFor = (row: LedgerDisplayRow): number | string => {
    switch (columnId) {
      case 'model':
        return row.ledgerLabel
      case 'provider':
        return row.provider
      case 'reasoning':
        return (row.reasoning_reported ?? 0) + (row.reasoning_estimated ?? 0)
      case 'agent_quality':
        return agentQualityIssueSortValue(row.agentQuality)
      case 'sparkline':
        return row.spark?.reduce((sum, value) => sum + value, 0) ?? 0
      default: {
        const value = row[columnId as keyof ModelRow]
        if (typeof value === 'number' || typeof value === 'string') {
          return value
        }
        return 0
      }
    }
  }

  const leftValue = valueFor(left)
  const rightValue = valueFor(right)
  if (typeof leftValue === 'string' || typeof rightValue === 'string') {
    return String(leftValue).localeCompare(String(rightValue), undefined, {
      sensitivity: 'base',
    })
  }
  return leftValue - rightValue
}

export function sortLedgerRows<T extends LedgerDisplayRow>(
  rows: readonly T[],
  sorting: import('@tanstack/react-table').SortingState
): T[] {
  if (sorting.length === 0) {
    return [...rows].sort((left, right) =>
      left.ledgerLabel.localeCompare(right.ledgerLabel, undefined, {
        sensitivity: 'base',
      })
    )
  }
  return [...rows].sort((left, right) => {
    for (const sort of sorting) {
      const result = compareLedgerValues(left, right, sort.id)
      if (result !== 0) return sort.desc ? -result : result
    }
    return 0
  })
}
