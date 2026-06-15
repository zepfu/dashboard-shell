/**
 * Wave 20-Comparison — ComparisonPanel tests.
 *
 * Component path: src/features/dashboard/components/comparison-panel.tsx
 * Expected export: ComparisonPanel (named)
 *
 * Primary regression coverage for ⚠-W19-3:
 *   burn = totalCost / 7 was hardcoded; now burn = totalCost / periodDays
 *   with periodDays defaulting to 1 (the Wave 16-V default window).
 */
import { render, screen } from '@testing-library/react'
import { formatUsd } from '../lib/usage-report-display'
import {
  buildCurrentStats,
  ComparisonPanel,
  computeDeltaPct,
  deltaColor,
  formatDeltaPct,
  type ProviderCurrentStats,
} from './comparison-panel'
import type { ModelRow } from './master-ledger-table'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRow(
  provider: string,
  cost_usd: number,
  overrides: Partial<ModelRow> = {}
): ModelRow {
  return {
    model: `${provider}-model`,
    provider,
    tokens_in: 1000,
    tokens_out: 500,
    requests: 10,
    p50_ms: 100,
    p95_ms: 300,
    error_pct: 0,
    cost_usd,
    quota_pct: 0,
    ...overrides,
  }
}

const PROVIDERS = ['anthropic', 'openai']

const MODEL_ROWS: ModelRow[] = [
  makeRow('anthropic', 70), // 70 USD for the period
  makeRow('openai', 14), // 14 USD for the period
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('test_comparison_panel_renders_provider_rows', () => {
  render(<ComparisonPanel providers={PROVIDERS} modelRows={MODEL_ROWS} />)

  // Both provider names should be rendered in upper case
  expect(screen.getByText('ANTHROPIC')).toBeTruthy()
  expect(screen.getByText('OPENAI')).toBeTruthy()
})

test('test_comparison_panel_burn_defaults_to_period_1_day', () => {
  // Without periodDays prop (default=1), burn = totalCost / 1 = totalCost
  render(<ComparisonPanel providers={PROVIDERS} modelRows={MODEL_ROWS} />)

  // Anthropic burn = 70 / 1 = 70.00
  expect(screen.getByText(formatUsd(70))).toBeTruthy()
  // OpenAI burn = 14 / 1 = 14.00
  expect(screen.getByText(formatUsd(14))).toBeTruthy()
})

test('test_comparison_panel_burn_uses_period_days_when_provided', () => {
  // With periodDays=7, burn = totalCost / 7
  render(
    <ComparisonPanel
      providers={PROVIDERS}
      modelRows={MODEL_ROWS}
      periodDays={7}
    />
  )

  // Anthropic burn = 70 / 7 = 10.00
  expect(screen.getByText(formatUsd(10))).toBeTruthy()
  // OpenAI burn = 14 / 7 = 2.00
  expect(screen.getByText(formatUsd(2))).toBeTruthy()
})

test('test_comparison_panel_burn_divides_by_14_day_window', () => {
  // 14-day window: burn = totalCost / 14
  render(
    <ComparisonPanel
      providers={PROVIDERS}
      modelRows={MODEL_ROWS}
      periodDays={14}
    />
  )

  // Anthropic burn = 70 / 14 = 5.00
  expect(screen.getByText(formatUsd(5))).toBeTruthy()
  // OpenAI burn = 14 / 14 = 1.00
  expect(screen.getByText(formatUsd(1))).toBeTruthy()
})

test('test_comparison_panel_title_reflects_period_days_1', () => {
  render(<ComparisonPanel providers={PROVIDERS} modelRows={MODEL_ROWS} />)

  // Default 1-day: title should contain "1-day"
  const title = screen.getByText(/provider comparison/i)
  expect(title.textContent?.toLowerCase()).toContain('1-day')
})

test('test_comparison_panel_title_reflects_period_days_7', () => {
  render(
    <ComparisonPanel
      providers={PROVIDERS}
      modelRows={MODEL_ROWS}
      periodDays={7}
    />
  )

  // 7-day window: title should contain "7-day"
  const title = screen.getByText(/provider comparison/i)
  expect(title.textContent?.toLowerCase()).toContain('7-day')
})

test('test_comparison_panel_footer_reflects_period_label', () => {
  render(
    <ComparisonPanel
      providers={PROVIDERS}
      modelRows={MODEL_ROWS}
      periodDays={30}
    />
  )

  // 30-day window: footer should include "30-day"
  const footer = document.querySelector('.comparison-footer')
  expect(footer?.textContent?.toLowerCase()).toContain('30-day')
})

test('test_comparison_panel_renders_eight_columns', () => {
  const { container } = render(
    <ComparisonPanel providers={PROVIDERS} modelRows={MODEL_ROWS} />
  )

  const headers = container.querySelectorAll('th')
  // Provider, Δ Cost, Δ Tok, Δ p95, Δ Err, Cache %, Burn, Trend
  expect(headers.length).toBe(8)
})

test('test_comparison_panel_empty_providers_renders_no_rows', () => {
  const { container } = render(
    <ComparisonPanel providers={[]} modelRows={MODEL_ROWS} />
  )

  const bodyRows = container.querySelectorAll('tbody tr')
  expect(bodyRows.length).toBe(0)
})

test('test_comparison_panel_zero_cost_burn_is_zero', () => {
  const zeroRows: ModelRow[] = [makeRow('anthropic', 0)]

  render(
    <ComparisonPanel
      providers={['anthropic']}
      modelRows={zeroRows}
      periodDays={7}
    />
  )

  // burn = 0 / 7 = 0.00
  expect(screen.getByText(formatUsd(0))).toBeTruthy()
})

// ---------------------------------------------------------------------------
// Wave 32-Deltas: delta helper unit tests
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// computeDeltaPct
// ---------------------------------------------------------------------------

test('test_compute_delta_pct_positive_increase', () => {
  // 100 → 150 = +50%
  expect(computeDeltaPct(150, 100)).toBeCloseTo(50)
})

test('test_compute_delta_pct_negative_decrease', () => {
  // 100 → 80 = -20%
  expect(computeDeltaPct(80, 100)).toBeCloseTo(-20)
})

test('test_compute_delta_pct_zero_change', () => {
  expect(computeDeltaPct(100, 100)).toBeCloseTo(0)
})

test('test_compute_delta_pct_prior_zero_returns_null', () => {
  // Division by zero — must return null, not Infinity
  expect(computeDeltaPct(50, 0)).toBeNull()
})

test('test_compute_delta_pct_both_zero_returns_null', () => {
  expect(computeDeltaPct(0, 0)).toBeNull()
})

// ---------------------------------------------------------------------------
// formatDeltaPct
// ---------------------------------------------------------------------------

test('test_format_delta_pct_positive_has_plus_sign', () => {
  expect(formatDeltaPct(50)).toBe('+50.0%')
})

test('test_format_delta_pct_negative_has_minus_sign', () => {
  expect(formatDeltaPct(-20.5)).toBe('-20.5%')
})

test('test_format_delta_pct_zero_has_plus_sign', () => {
  expect(formatDeltaPct(0)).toBe('+0.0%')
})

test('test_format_delta_pct_null_returns_dash', () => {
  expect(formatDeltaPct(null)).toBe('—')
})

// ---------------------------------------------------------------------------
// deltaColor
// ---------------------------------------------------------------------------

test('test_delta_color_positive_is_hot', () => {
  expect(deltaColor(10)).toBe('var(--accent-hot)')
})

test('test_delta_color_negative_is_teal', () => {
  expect(deltaColor(-5)).toBe('var(--accent-teal)')
})

test('test_delta_color_zero_is_muted', () => {
  expect(deltaColor(0)).toBe('var(--fg-muted)')
})

test('test_delta_color_null_is_muted', () => {
  expect(deltaColor(null)).toBe('var(--fg-muted)')
})

// ---------------------------------------------------------------------------
// ComparisonPanel — priorStats prop integration
// ---------------------------------------------------------------------------

const PRIOR_STATS: ProviderCurrentStats[] = [
  {
    provider: 'anthropic',
    totalCost: 50, // prior cost — current is 70, so +40%
    totalTokens: 1000,
    avgP95: 200,
    avgErrPct: 0,
    avgCachePct: 0,
    burn: 50,
  },
  {
    provider: 'openai',
    totalCost: 20, // prior cost — current is 14, so -30%
    totalTokens: 2000,
    avgP95: 400,
    avgErrPct: 2,
    avgCachePct: 0,
    burn: 20,
  },
]

test('test_comparison_panel_delta_cost_renders_signed_pct_when_prior_provided', () => {
  render(
    <ComparisonPanel
      providers={PROVIDERS}
      modelRows={MODEL_ROWS}
      priorStats={PRIOR_STATS}
    />
  )
  // anthropic: (70 - 50) / 50 * 100 = +40.0%
  expect(screen.getByText('+40.0%')).toBeTruthy()
  // openai: (14 - 20) / 20 * 100 = -30.0%
  expect(screen.getByText('-30.0%')).toBeTruthy()
})

test('test_comparison_panel_falls_back_to_dash_when_no_prior_stats', () => {
  const { container } = render(
    <ComparisonPanel providers={PROVIDERS} modelRows={MODEL_ROWS} />
  )
  // All four Δ columns render '—' when priorStats absent; also Cache % when avgCachePct=0
  const allTds = Array.from(container.querySelectorAll('tbody td'))
  const dashCount = allTds.filter((td) => td.textContent === '—').length
  // 4 delta columns × 2 providers = 8 dashes, plus 2 Cache % dashes (avgCachePct=0
  // renders '—' per component logic) → 10 total
  expect(dashCount).toBe(10)

  // Per-cell localization: count dashes per row independently to verify
  // each provider row has the correct fallback count (not a global table sum).
  const rows = Array.from(container.querySelectorAll('tbody tr'))
  expect(rows).toHaveLength(2)

  for (const row of rows) {
    const cells = Array.from(row.querySelectorAll('td'))
    const rowDashCount = cells.filter((td) => td.textContent === '—').length
    // Each provider row: 4 delta dashes + 1 cache dash = 5
    expect(rowDashCount).toBe(5)
  }
})

test('test_comparison_panel_falls_back_to_dash_for_missing_provider_in_prior', () => {
  // Only anthropic has prior data; openai is absent
  const partialPrior: ProviderCurrentStats[] = [PRIOR_STATS[0]]
  const { container: partialContainer } = render(
    <ComparisonPanel
      providers={PROVIDERS}
      modelRows={MODEL_ROWS}
      priorStats={partialPrior}
    />
  )
  // anthropic gets computed values
  expect(screen.getByText('+40.0%')).toBeTruthy()

  // Per-cell localization: count dashes per row independently.
  const rows = Array.from(partialContainer.querySelectorAll('tbody tr'))
  expect(rows).toHaveLength(2)

  // Find the anthropic and openai rows by their provider name cell (first td)
  const anthropicRow = rows.find((r) =>
    r
      .querySelectorAll('td')[0]
      ?.textContent?.toUpperCase()
      .includes('ANTHROPIC')
  )
  const openaiRow = rows.find((r) =>
    r.querySelectorAll('td')[0]?.textContent?.toUpperCase().includes('OPENAI')
  )

  expect(anthropicRow).toBeDefined()
  expect(openaiRow).toBeDefined()

  // anthropic: Δ Err prior=0 → computeDeltaPct(0,0)=null → '—', plus 1 cache dash = 2
  const anthropicDashes = Array.from(
    anthropicRow!.querySelectorAll('td')
  ).filter((td) => td.textContent === '—').length
  expect(anthropicDashes).toBe(2)

  // openai: 4 delta dashes + 1 cache dash (avgCachePct=0) = 5
  const openaiDashes = Array.from(openaiRow!.querySelectorAll('td')).filter(
    (td) => td.textContent === '—'
  ).length
  expect(openaiDashes).toBe(5)

  // Total dashes across the whole table = 2 + 5 = 7
  const allTds = Array.from(partialContainer.querySelectorAll('tbody td'))
  const totalDashCount = allTds.filter((td) => td.textContent === '—').length
  expect(totalDashCount).toBe(7)
})

// ---------------------------------------------------------------------------
// buildCurrentStats export
// ---------------------------------------------------------------------------

test('test_build_current_stats_exported_aggregates_correctly', () => {
  const stats = buildCurrentStats(PROVIDERS, MODEL_ROWS, 1)
  const anthropic = stats.find((s) => s.provider === 'anthropic')
  const openai = stats.find((s) => s.provider === 'openai')

  expect(anthropic?.totalCost).toBeCloseTo(70)
  expect(openai?.totalCost).toBeCloseTo(14)

  // tokens: 1000 + 500 = 1500 per row
  expect(anthropic?.totalTokens).toBe(1500)
  expect(openai?.totalTokens).toBe(1500)

  // burn = totalCost / 1 (periodDays = 1)
  expect(anthropic?.burn).toBeCloseTo(70)
  expect(openai?.burn).toBeCloseTo(14)
})

// ---------------------------------------------------------------------------
// S5-1: buildCurrentStats weighted error excludes only undefined cache%
// ---------------------------------------------------------------------------

/**
 * S5-1 — request-weighted error rate must not be inflated by 0% models.
 *
 * Scenario: 9 models at 0% error + 1 model at 10% error. The simple average
 * would be 10/10 = 1%. A weighted-by-request average over equal request counts
 * is also ~1%. The cache% calculation must include genuine 0% hits (not filter
 * them out), so avgCachePct over models with cache_pct=0 must be 0 (not NaN).
 *
 * The current implementation filters `filter((v) => v > 0)` for both errPct
 * AND cachePct, which causes:
 *  - avgErrPct = 10/1 = 10% (only the one non-zero value counted) — WRONG
 *  - avgCachePct drops genuine 0% entries too
 *
 * This test verifies the expected behaviour where:
 *  - avgErrPct ≈ 1% (request-weighted over all 10 models)
 *  - avgCachePct = 0 (all models have cache_pct 0, average is 0 not NaN)
 *
 * EXPECTED FAIL: current implementation produces avgErrPct=10 (only 1 non-zero
 * model counted), not ≈1.
 */
test('test_buildCurrentStats_weighted_excludes_only_undefined', () => {
  // 9 models at 0% error + 1 model at 10% error, equal request counts → ~1%
  const rows: ModelRow[] = [
    ...Array.from({ length: 9 }, (_, i) => ({
      model: `model-zero-${i}`,
      provider: 'openai',
      tokens_in: 1000,
      tokens_out: 500,
      requests: 100,
      p50_ms: 100,
      p95_ms: 200,
      error_pct: 0,
      cost_usd: 1,
      quota_pct: 0,
      cache_pct: 0, // genuine 0% cache — must be included in average
    })),
    {
      model: 'model-error',
      provider: 'openai',
      tokens_in: 1000,
      tokens_out: 500,
      requests: 100,
      p50_ms: 100,
      p95_ms: 200,
      error_pct: 10,
      cost_usd: 1,
      quota_pct: 0,
      cache_pct: 0,
    },
  ]

  const stats = buildCurrentStats(['openai'], rows, 1)
  const openai = stats.find((s) => s.provider === 'openai')

  // Request-weighted average: (9×0 + 1×10) / 10 = 1%
  // Current impl filters > 0 → only 1 value counted → returns 10%
  // This assertion will FAIL against current implementation.
  expect(openai?.avgErrPct).toBeCloseTo(1, 0)

  // avgCachePct over all-zero values = 0 (not NaN, not dropped)
  expect(openai?.avgCachePct).toBeDefined()
  expect(Number.isNaN(openai?.avgCachePct)).toBe(false)
  expect(openai?.avgCachePct).toBeCloseTo(0)
})

// ---------------------------------------------------------------------------
// S5-2: 0%→5% delta shows "new" / "↑ from 0" instead of "—"
// ---------------------------------------------------------------------------

/**
 * S5-2 — when prior value is zero, delta should render "new" or "↑ from 0",
 * NOT the generic "—" fallback.
 *
 * computeDeltaPct(5, 0) returns null (division-by-zero guard) which causes
 * formatDeltaPct(null) → "—". But semantically, going from 0 to any positive
 * value should surface a "new"/"↑ from 0" label rather than silence.
 *
 * EXPECTED FAIL: current formatDeltaPct(null) returns "—", not "new".
 */
test('test_delta_zero_prior_renders_new_not_dash', () => {
  // Prior cost = 0, current cost = 5 → 0%→5% transition
  const priorStats: ProviderCurrentStats[] = [
    {
      provider: 'anthropic',
      totalCost: 0,
      totalTokens: 0,
      avgP95: 0,
      avgErrPct: 0,
      avgCachePct: 0,
      burn: 0,
    },
  ]
  const currentRows: ModelRow[] = [makeRow('anthropic', 5)]

  render(
    <ComparisonPanel
      providers={['anthropic']}
      modelRows={currentRows}
      priorStats={priorStats}
    />
  )

  // Should render "new" or "↑ from 0" — not "—"
  // The cost delta cell (Δ Cost column) should NOT show just "—"
  const allCells = Array.from(document.querySelectorAll('tbody td'))
  const deltaCostCell = allCells[1] // second column = Δ Cost
  expect(deltaCostCell?.textContent).not.toBe('—')
  // Must explicitly signal a "new" value or "from 0" context
  const text = deltaCostCell?.textContent ?? ''
  const signalsNew =
    text.toLowerCase().includes('new') ||
    text.toLowerCase().includes('from 0') ||
    text.includes('↑')
  expect(signalsNew).toBe(true)
})

// ---------------------------------------------------------------------------
// S5-3: sparkline color must be per-provider, not a constant
// ---------------------------------------------------------------------------

/**
 * S5-3 — each provider's sparkline must use a distinct per-provider color.
 *
 * Current implementation hardcodes `const providerColor = 'var(--accent-cool)'`
 * for every row. A table with 2+ providers should have different stroke colors
 * on their sparkline polylines.
 *
 * EXPECTED FAIL: current code sets providerColor = 'var(--accent-cool)' for
 * all providers, so both polylines will have the same stroke.
 */
test('test_comparison_sparkline_color_per_provider', () => {
  // 24 buckets with different totals per provider
  const trendBuckets = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    totals: { anthropic: i * 100, openai: i * 50 },
  }))

  const rows: ModelRow[] = [makeRow('anthropic', 10), makeRow('openai', 5)]

  const { container } = render(
    <ComparisonPanel
      providers={['anthropic', 'openai']}
      modelRows={rows}
      trendBuckets={trendBuckets}
    />
  )

  // Each row's sparkline polyline should carry a stroke attribute
  const polylines = container.querySelectorAll('polyline')
  expect(polylines.length).toBeGreaterThanOrEqual(2)

  // The two polylines must have DIFFERENT stroke colors (per-provider)
  const strokes = Array.from(polylines).map((p) => p.getAttribute('stroke'))
  const uniqueStrokes = new Set(strokes)
  expect(uniqueStrokes.size).toBeGreaterThan(1)
})
