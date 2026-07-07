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
  tokens_in: number
  tokens_out: number
  requests: number
  p50_ms: number
  p95_ms: number
  /** Raw rate; round only at display. Undefined = no error data (repository leaves). */
  error_pct?: number
  cost_usd: number
  cache_pct?: number
  queue?: number
  resets?: number
  cache_miss_pct?: number
  cache_miss_usd_cost?: number
  reasoning_reported?: number
  reasoning_estimated?: number
  cache_toks?: number
  tool?: number
  git_commits?: number
  git_pushes?: number
  inval?: number
  spark?: number[]
  sparkBuckets?: string[]
  toolActivity?: import('./master-ledger-tool-activity').ModelToolActivity
  agentQuality?: AgentQualitySummary
  latencySummary?: ModelLatencySummary
  repositoryChildren?: ModelRow[]
  /** When true, Toks In/Out used a synthetic 60/40 split (no usage row coverage). */
  tokensDirectionEstimated?: boolean
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

function sumSparkIndexAligned(rows: readonly ModelRow[]): number[] | undefined {
  const maxLength = Math.max(0, ...rows.map((row) => row.spark?.length ?? 0))
  if (maxLength === 0) return undefined
  return Array.from({ length: maxLength }, (_value, index) =>
    rows.reduce((sum, row) => sum + (row.spark?.[index] ?? 0), 0)
  )
}

function sumSpark(rows: readonly ModelRow[]): number[] | undefined {
  const hasBucketAxis = rows.some(
    (row) => (row.sparkBuckets?.length ?? 0) > 0 && (row.spark?.length ?? 0) > 0
  )
  if (hasBucketAxis) {
    const bucketTotals = new Map<string, number>()
    const bucketlessRows: ModelRow[] = []
    for (const row of rows) {
      const buckets = row.sparkBuckets ?? []
      const values = row.spark ?? []
      if (buckets.length === 0 && values.length > 0) {
        bucketlessRows.push(row)
        continue
      }
      for (let i = 0; i < values.length; i++) {
        const bucket = buckets[i]
        if (bucket === undefined) continue
        bucketTotals.set(bucket, (bucketTotals.get(bucket) ?? 0) + values[i])
      }
    }
    if (bucketTotals.size > 0) {
      const orderedBuckets = [...bucketTotals.keys()].sort()
      const bucketAligned = orderedBuckets.map(
        (bucket) => bucketTotals.get(bucket) ?? 0
      )
      const indexAligned = sumSparkIndexAligned(bucketlessRows)
      if (indexAligned === undefined) return bucketAligned
      const maxLength = Math.max(bucketAligned.length, indexAligned.length)
      return Array.from({ length: maxLength }, (_v, index) => {
        const fromBuckets =
          index < bucketAligned.length ? bucketAligned[index] : 0
        const fromIndex =
          index < indexAligned.length ? (indexAligned[index] ?? 0) : 0
        return fromBuckets + fromIndex
      })
    }
    return sumSparkIndexAligned(bucketlessRows)
  }

  return sumSparkIndexAligned(rows)
}

export { sumSpark as _sumSparkForTest }

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
  const cost = rows.reduce((sum, row) => sum + row.cost_usd, 0)
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
  const queueSum = optionalSum((row) => row.queue, true)
  const resetsSum = optionalSum((row) => row.resets, true)

  // C9: p50_ms / p95_ms use max of child rollups (conservative upper bound, not a true group percentile).
  return {
    model: overrides.ledgerLabel,
    provider: overrides.providerKey,
    tokens_in: rows.reduce((sum, row) => sum + row.tokens_in, 0),
    tokens_out: rows.reduce((sum, row) => sum + row.tokens_out, 0),
    requests,
    p50_ms: Math.max(0, ...rows.map((row) => row.p50_ms)),
    p95_ms: Math.max(0, ...rows.map((row) => row.p95_ms)),
    error_pct:
      errorRequestTotal > 0
        ? Math.round((weightedErrorTotal / errorRequestTotal) * 10) / 10
        : undefined,
    cost_usd: cost,
    cache_pct: cachePctFromTokens(
      cacheToks,
      rows.reduce((sum, row) => sum + row.tokens_in, 0)
    ),
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
    latencySummary: combineLatencySummaries(
      rows.map((row) => row.latencySummary)
    ),
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
