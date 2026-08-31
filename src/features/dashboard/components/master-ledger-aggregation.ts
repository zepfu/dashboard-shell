import {
  agentQualityIssueSortValue,
  combineAgentQualitySummaries,
  type AgentQualitySummary,
} from '../lib/agent-quality'
import { cachePctFromTokens } from '../lib/ledger-math'
import { combineLatencySummaries } from '../lib/model-latency-summary'
import {
  compareFamilyLedgerLabels,
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
  /** Measured input tokens; unavailable when no directional measurement exists. */
  tokens_in?: number
  /** Measured output tokens; unavailable when no directional measurement exists. */
  tokens_out?: number
  requests: number
  p50_ms: number
  p95_ms: number
  /** Raw rate; round only at display. Undefined = no error data (repository leaves). */
  error_pct?: number
  cost_usd: number | null
  cache_pct?: number
  cache_miss_pct?: number
  cache_miss_usd_cost?: number
  reasoning_reported?: number
  reasoning_estimated?: number
  cache_toks?: number
  tool?: number
  git_commits?: number
  git_pushes?: number
  spark?: number[]
  sparkBuckets?: string[]
  toolActivity?: import('./master-ledger-tool-activity').ModelToolActivity
  agentQuality?: AgentQualitySummary
  latencySummary?: ModelLatencySummary
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

/** Resolve a family node's children without substituting another family. */
export function resolveFamilyRows<T>(
  familyRows: ReadonlyMap<string, { rows: readonly T[] }>,
  familyKey: string | undefined
): readonly T[] {
  return familyRows.get(familyKey ?? '')?.rows ?? []
}

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

function sumSparkIndexAligned(rows: readonly ModelRow[]): number[] | undefined {
  const maxLength = Math.max(0, ...rows.map((row) => row.spark?.length ?? 0))
  if (maxLength === 0) return undefined
  return Array.from({ length: maxLength }, (_value, index) =>
    rows.reduce((sum, row) => sum + (row.spark?.[index] ?? 0), 0)
  )
}

/**
 * Sum sparklines. When any child carries a date-bucket axis, only bucket-aligned
 * values contribute — bucketless rows must not be index-merged into day slots
 * (P05-F05). Bucketless-only groups still fall back to index alignment.
 */
function sumSpark(rows: readonly ModelRow[]): number[] | undefined {
  const hasBucketAxis = rows.some(
    (row) => (row.sparkBuckets?.length ?? 0) > 0 && (row.spark?.length ?? 0) > 0
  )
  if (hasBucketAxis) {
    const bucketTotals = new Map<string, number>()
    for (const row of rows) {
      const buckets = row.sparkBuckets ?? []
      const values = row.spark ?? []
      // P05-F05: skip bucketless rows rather than index-merging into day slots.
      if (buckets.length === 0) continue
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

  return sumSparkIndexAligned(rows)
}

export { sumSpark as _sumSparkForTest }

/**
 * Count-weighted p50/p95 from child latencySummary when every contributing
 * child has both a percentile and a positive sample count; otherwise fall back
 * to the conservative max of child rollups (P05-F04).
 */
function countWeightedLatencyMs(
  rows: readonly ModelRow[],
  pickMs: (summary: ModelLatencySummary) => number | null | undefined,
  pickCount: (summary: ModelLatencySummary) => number | null | undefined,
  fallbackField: 'p50_ms' | 'p95_ms'
): number {
  let weightedSum = 0
  let totalCount = 0
  for (const row of rows) {
    const summary = row.latencySummary
    if (summary === undefined) continue
    const ms = pickMs(summary)
    const count = pickCount(summary)
    if (ms == null || count == null || count <= 0) continue
    weightedSum += ms * count
    totalCount += count
  }
  if (totalCount > 0) return weightedSum / totalCount
  return Math.max(0, ...rows.map((row) => row[fallbackField]))
}

function sumMeasured(
  rows: readonly ModelRow[],
  pick: (row: ModelRow) => number | undefined
): number | undefined {
  let total: number | undefined
  for (const row of rows) {
    const value = pick(row)
    if (value === undefined) continue
    total = (total ?? 0) + value
  }
  return total
}

// G2: cost_usd and cache_miss_usd_cost are summed as IEEE doubles; rounding at display only.
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
  const persistedCostRows = rows.filter((row) => row.cost_usd !== null)
  const cost = persistedCostRows.reduce((sum, row) => {
    if (row.cost_usd === null) return sum
    return sum + row.cost_usd
  }, 0)
  const cacheToks = rows.reduce((sum, row) => sum + (row.cache_toks ?? 0), 0)
  const errorRows = rows.filter((row) => row.error_pct !== undefined)
  const errorRequestTotal = errorRows.reduce(
    (sum, row) => sum + row.requests,
    0
  )
  const weightedErrorTotal = errorRows.reduce(
    (sum, row) => sum + (row.error_pct ?? 0) * row.requests,
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

  // P05-F04: prefer count-weighted latencySummary percentiles when available.
  const p50_ms = countWeightedLatencyMs(
    rows,
    (s) => s.totalServerP50Ms,
    (s) => s.totalServerCount,
    'p50_ms'
  )
  const p95_ms = countWeightedLatencyMs(
    rows,
    (s) => s.totalServerP95Ms,
    (s) => s.totalServerCount,
    'p95_ms'
  )

  const combinedLatency = combineLatencySummaries(
    rows.map((row) => row.latencySummary)
  )
  // Overlay count-weighted server totals so latencySummary stays consistent with
  // the scalar p50_ms/p95_ms fields (P05-F04).
  const latencySummary =
    combinedLatency === undefined
      ? undefined
      : {
          ...combinedLatency,
          totalServerP50Ms: p50_ms,
          totalServerP95Ms: p95_ms,
        }
  const tokensIn = sumMeasured(rows, (row) => row.tokens_in)
  const tokensOut = sumMeasured(rows, (row) => row.tokens_out)

  return {
    model: overrides.ledgerLabel,
    provider: overrides.providerKey,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    requests,
    p50_ms,
    p95_ms,
    error_pct:
      errorRequestTotal > 0
        ? Math.round((weightedErrorTotal / errorRequestTotal) * 10) / 10
        : undefined,
    cost_usd: persistedCostRows.length > 0 ? cost : null,
    cache_pct: cachePctFromTokens(cacheToks, tokensIn ?? 0),
    cache_miss_pct:
      cacheMissUsdDefined && cost !== null && cost > 0 && cacheMissUsdSum > 0
        ? (cacheMissUsdSum / cost) * 100
        : undefined,
    cache_miss_usd_cost: cacheMissUsdDefined ? cacheMissUsdSum : undefined,
    reasoning_reported: optionalSum((row) => row.reasoning_reported, true),
    reasoning_estimated: optionalSum((row) => row.reasoning_estimated, true),
    cache_toks: cacheToks > 0 ? cacheToks : undefined,
    tool: optionalSum((row) => row.tool),
    git_commits: optionalSum((row) => row.git_commits),
    git_pushes: optionalSum((row) => row.git_pushes),
    spark: sumSpark(rows),
    toolActivity: undefined,
    agentQuality: combineAgentQualitySummaries(
      rows.map((row) => row.agentQuality)
    ),
    latencySummary,
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
    return [...rows].sort((left, right) => {
      if (
        left.ledgerLevel === 'family' &&
        right.ledgerLevel === 'family' &&
        left.providerKey === right.providerKey
      ) {
        const familyOrder = compareFamilyLedgerLabels(
          left.providerKey,
          left.ledgerLabel,
          right.ledgerLabel
        )
        if (familyOrder !== 0) return familyOrder
      }
      if (left.ledgerLevel === 'model' && right.ledgerLevel === 'model') {
        return left.ledgerLabel.localeCompare(right.ledgerLabel, undefined, {
          sensitivity: 'base',
        })
      }
      if (left.ledgerLevel === 'provider' && right.ledgerLevel === 'provider') {
        return 0
      }
      return left.ledgerLabel.localeCompare(right.ledgerLabel, undefined, {
        sensitivity: 'base',
      })
    })
  }
  return [...rows].sort((left, right) => {
    for (const sort of sorting) {
      const result = compareLedgerValues(left, right, sort.id)
      if (result !== 0) return sort.desc ? -result : result
    }
    return 0
  })
}
