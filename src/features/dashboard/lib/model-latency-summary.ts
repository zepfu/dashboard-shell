/**
 * Single field-policy rollup for ModelLatencySummary (D1-449 A1).
 * Used by ledger-rows (pairwise merge) and master-ledger-aggregation (N-way combine).
 */
import type {
  UsageReportProviderStatusUsageRow,
  UsageReportRow,
} from '../api/usage-report'
import type { ModelLatencySummary } from '../components/master-ledger-aggregation'

type LatencyNumericField = Exclude<keyof ModelLatencySummary, 'sampleRows'>

const MAX_FIELDS: LatencyNumericField[] = [
  'totalServerP50Ms',
  'totalServerP95Ms',
  'upstreamElapsedP50Ms',
  'upstreamElapsedP95Ms',
  'ttftP95Ms',
  'litellmProcessingP95Ms',
  'upstreamStreamP95Ms',
  'unclassifiedP95Ms',
  'previousResponseGapP95Ms',
  'upstreamOutputTokensPerSecondP50',
  'upstreamOutputTokensPerSecondP95',
  'streamOutputTokensPerSecondP50',
  'streamOutputTokensPerSecondP95',
]

const SUM_FIELDS: LatencyNumericField[] = [
  'totalServerCount',
  'upstreamElapsedCount',
  'ttftCount',
  'litellmProcessingCount',
  'upstreamStreamCount',
  'unclassifiedCount',
  'previousResponseGapCount',
  'upstreamOutputTokensPerSecondCount',
  'streamOutputTokensPerSecondCount',
]

function maxNullable(
  values: readonly (number | null | undefined)[]
): number | null {
  const present = values.filter((value): value is number => value != null)
  return present.length > 0 ? Math.max(...present) : null
}

function sumNullable(
  values: readonly (number | null | undefined)[]
): number | null {
  const present = values.filter((value): value is number => value != null)
  return present.length > 0
    ? present.reduce((sum, value) => sum + value, 0)
    : null
}

/** Max-of-child percentiles at rollup levels — conservative upper bound, not a true group percentile (C9). */
export function combineModelLatencySummaries(
  summaries: readonly ModelLatencySummary[]
): ModelLatencySummary | undefined {
  if (summaries.length === 0) return undefined
  const result = {
    sampleRows: summaries.reduce((sum, s) => sum + s.sampleRows, 0),
  } as ModelLatencySummary
  for (const field of MAX_FIELDS) {
    result[field] = maxNullable(summaries.map((s) => s[field]))
  }
  for (const field of SUM_FIELDS) {
    result[field] = sumNullable(summaries.map((s) => s[field]))
  }
  return result
}

export function mergeLatencySummaries(
  left: ModelLatencySummary | undefined,
  right: ModelLatencySummary | undefined
): ModelLatencySummary | undefined {
  if (left === undefined) return right
  if (right === undefined) return left
  return combineModelLatencySummaries([left, right])
}

/** N-way merge alias used when folding repository child rows. */
export function combineLatencySummaries(
  summaries: readonly (ModelLatencySummary | undefined)[]
): ModelLatencySummary | undefined {
  const present = summaries.filter(
    (summary): summary is ModelLatencySummary => summary !== undefined
  )
  return combineModelLatencySummaries(present)
}

export function latencySummaryFromReportRow(
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
