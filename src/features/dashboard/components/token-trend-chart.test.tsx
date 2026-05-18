/**
 * Wave 5 — TokenTrendChart red-phase tests.
 *
 * Component path: src/features/dashboard/components/token-trend-chart.tsx
 * Expected export: TokenTrendChart (named)
 * Props: { data: TrendBucket[]; series: ProviderSeries[] }
 *
 * All tests expected to FAIL (red) — source file does not exist yet.
 */
import { render, screen } from '@testing-library/react'
import { TokenTrendChart } from './token-trend-chart'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const series = [
  {
    key: 'anthropic',
    label: 'Anthropic',
    color: '#cc7855',
    cssClass: 'tt-anthropic',
  },
  { key: 'openai', label: 'OpenAI', color: '#10a37f', cssClass: 'tt-openai' },
  { key: 'google', label: 'Google', color: '#4285f4', cssClass: 'tt-google' },
  { key: 'xai', label: 'xAI', color: '#000000', cssClass: 'tt-xai' },
  { key: 'nvidia', label: 'NVIDIA', color: '#76b900', cssClass: 'tt-nvidia' },
  {
    key: 'openrouter',
    label: 'OpenRouter',
    color: '#94a3b8',
    cssClass: 'tt-openrouter',
  },
  { key: 'local', label: 'Local', color: '#a1a1aa', cssClass: 'tt-local' },
]

const mock24Buckets = Array.from({ length: 24 }, (_, i) => ({
  label: `${i}h`,
  totals: { anthropic: 100 + i, openai: 50, google: 25 },
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('test_renders_24_bars', () => {
  const { container } = render(
    <TokenTrendChart data={mock24Buckets} series={series} />
  )

  const bars =
    container.querySelectorAll('.trend-bar').length > 0
      ? container.querySelectorAll('.trend-bar')
      : container.querySelectorAll('[data-testid="trend-bar"]')

  expect(bars.length).toBe(24)
})

test('test_bar_contains_slices_for_providers_present', () => {
  const { container } = render(
    <TokenTrendChart data={mock24Buckets} series={series} />
  )

  const bars =
    container.querySelectorAll('.trend-bar').length > 0
      ? container.querySelectorAll('.trend-bar')
      : container.querySelectorAll('[data-testid="trend-bar"]')

  const firstBar = bars[0] as HTMLElement

  // First bar should contain slices for the 3 providers present in mock data
  expect(firstBar.querySelector('.tt-anthropic')).not.toBeNull()
  expect(firstBar.querySelector('.tt-openai')).not.toBeNull()
  expect(firstBar.querySelector('.tt-google')).not.toBeNull()
})

test('test_legend_strip_renders_7_items', () => {
  const { container } = render(
    <TokenTrendChart data={mock24Buckets} series={series} />
  )

  const legendItems =
    container.querySelectorAll('.tt-leg-item').length > 0
      ? container.querySelectorAll('.tt-leg-item')
      : container.querySelectorAll('[data-testid="tt-leg-item"]')

  expect(legendItems.length).toBe(7)

  // Verify provider labels are present
  const providerLabels = [
    'Anthropic',
    'OpenAI',
    'Google',
    'xAI',
    'NVIDIA',
    'OpenRouter',
    'Local',
  ]
  for (const label of providerLabels) {
    expect(screen.getByText(label)).toBeInTheDocument()
  }
})

test('test_stacked_heights_proportional', () => {
  const { container } = render(
    <TokenTrendChart data={mock24Buckets} series={series} />
  )

  const bars =
    container.querySelectorAll('.trend-bar').length > 0
      ? container.querySelectorAll('.trend-bar')
      : container.querySelectorAll('[data-testid="trend-bar"]')

  const firstBar = bars[0] as HTMLElement
  const anthropicSlice = firstBar.querySelector('.tt-anthropic') as HTMLElement
  expect(anthropicSlice).not.toBeNull()

  // Bucket 0: anthropic=100, openai=50, google=25, total=175
  // Expected proportion: (100/175)*100 ≈ 57.14%
  const expectedPct = (100 / 175) * 100

  const flexBasis = anthropicSlice.style.flexBasis
  const height = anthropicSlice.style.height

  const rawValue = flexBasis !== '' ? flexBasis : height
  expect(rawValue).toBeTruthy()

  const parsedPct = parseFloat(rawValue)
  expect(Math.abs(parsedPct - expectedPct)).toBeLessThan(1)
})
