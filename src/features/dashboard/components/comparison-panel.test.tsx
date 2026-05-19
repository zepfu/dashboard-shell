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
    cost_per_1k: cost_usd / 1.5,
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
// Helpers
// ---------------------------------------------------------------------------

/** Formats a USD value the same way formatUsd does (2 decimal places, $ prefix). */
function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`
}

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
  // All four Δ columns render '—' when priorStats absent
  const allTds = Array.from(container.querySelectorAll('tbody td'))
  const dashCount = allTds.filter((td) => td.textContent === '—').length
  // 4 delta columns × 2 providers = 8 dashes, plus 2 Cache % dashes (avgCachePct=0
  // renders '—' per component logic) → 10 total
  expect(dashCount).toBe(10)
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
  // openai: 4 delta dashes + 1 cache dash (avgCachePct=0) = 5
  // anthropic: Δ Err prior=0 → computeDeltaPct(0,0)=null → '—', plus 1 cache dash = 2
  // Total dashes: 5 + 2 = 7
  const allTds = Array.from(partialContainer.querySelectorAll('tbody td'))
  const dashCount = allTds.filter((td) => td.textContent === '—').length
  expect(dashCount).toBe(7)
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
