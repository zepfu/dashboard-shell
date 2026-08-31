/**
 * Wave 4 (P05-F04, P05-F05) — master-ledger-aggregation unit tests (RED phase).
 */
import { expect, test } from 'vitest'
import {
  _aggregateRowsForTest,
  _sumSparkForTest,
  type ModelRow,
} from './master-ledger-aggregation'

function makeRow(overrides: Partial<ModelRow> = {}): ModelRow {
  return {
    model: 'claude-3',
    provider: 'anthropic',
    tokens_in: 1000,
    tokens_out: 2000,
    requests: 100,
    p50_ms: 200,
    p95_ms: 500,
    error_pct: 0.5,
    cost_usd: 0.1,
    ...overrides,
  }
}

test('test_aggregate_p95_labeled_or_true_percentile', () => {
  const lowTrafficHighTail = makeRow({
    model: 'a',
    requests: 10,
    p95_ms: 900,
    latencySummary: {
      sampleRows: 10,
      totalServerP95Ms: 900,
      totalServerCount: 10,
    },
  })
  const highTrafficLowTail = makeRow({
    model: 'b',
    requests: 990,
    p95_ms: 100,
    latencySummary: {
      sampleRows: 990,
      totalServerP95Ms: 100,
      totalServerCount: 990,
    },
  })

  const aggregated = _aggregateRowsForTest(
    [lowTrafficHighTail, highTrafficLowTail],
    {
      ledgerLevel: 'provider',
      ledgerId: 'provider:anthropic',
      ledgerLabel: 'Anthropic',
      providerKey: 'anthropic',
      childCount: 2,
      exactModelCount: 2,
      isExpandable: true,
    }
  )

  const countWeightedP95 = (900 * 10 + 100 * 990) / (10 + 990)
  const maxChildP95 = Math.max(900, 100)

  const derivedFromSummary =
    aggregated.latencySummary?.totalServerP95Ms ?? aggregated.p95_ms

  const matchesWeighted = Math.abs(derivedFromSummary - countWeightedP95) < 0.01
  const matchesMax = derivedFromSummary === maxChildP95

  expect(matchesWeighted || matchesMax).toBe(true)
  if (!matchesWeighted) {
    expect(aggregated.p95_ms).toBe(maxChildP95)
  }
})

test('test_sumSpark_mixed_axes_aligns_by_date', () => {
  const bucketed = makeRow({
    model: 'bucketed',
    spark: [10, 20],
    sparkBuckets: ['2026-06-01', '2026-06-02'],
  })
  const bucketless = makeRow({
    model: 'bucketless',
    spark: [1000],
  })

  const result = _sumSparkForTest([bucketed, bucketless])

  expect(result).toEqual([10, 20])
  expect(result).not.toEqual([1010, 20])
})

test('test_aggregateRows_preserves_unavailable_and_measured_zero_tokens', () => {
  const overrides = {
    ledgerLevel: 'provider' as const,
    ledgerId: 'provider:anthropic',
    ledgerLabel: 'Anthropic',
    providerKey: 'anthropic',
    childCount: 2,
    exactModelCount: 2,
    isExpandable: true,
  }
  const aggregated = _aggregateRowsForTest(
    [
      makeRow({ tokens_in: undefined, tokens_out: 0 }),
      makeRow({ tokens_in: 0, tokens_out: undefined }),
    ],
    overrides
  )

  expect(aggregated.tokens_in).toBe(0)
  expect(aggregated.tokens_out).toBe(0)

  const unavailable = _aggregateRowsForTest(
    [makeRow({ tokens_in: undefined, tokens_out: undefined })],
    { ...overrides, childCount: 1, exactModelCount: 1 }
  )
  expect(unavailable.tokens_in).toBeUndefined()
  expect(unavailable.tokens_out).toBeUndefined()
})
