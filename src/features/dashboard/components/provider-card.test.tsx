/**
 * Wave 4 — ProviderCard red-phase tests.
 *
 * Component path: src/features/dashboard/components/provider-card.tsx
 * Expected export: ProviderCard (named)
 *
 * All tests expected to FAIL (red) — source file does not exist yet.
 */
import { render, screen } from '@testing-library/react'
import { ProviderCard } from './provider-card'

// ---------------------------------------------------------------------------
// Minimal fixtures
// ---------------------------------------------------------------------------

const mockData = {
  tokens_in: 1000,
  tokens_out: 2000,
  cost_usd: 0.5,
  requests: 50,
  errors: 1,
  p95_ms: 1200,
  cache_input: 0,
  cache_creation: 0,
  reasoning_reported: 100,
  reasoning_estimated: 90,
  traces: 5,
}

const anthropicConfig = { provider: 'anthropic', color: '#cc7855' }

const mockHealthCells = Array.from({ length: 288 }, () => ({
  color: 'var(--card-2)',
}))

// Wave 11 PR3 (11-h/11-i): QuotaBarGroup[] — each entry is a quota-type bar
// with pre-built N=12 segment array.
const makeSegments = () =>
  Array.from({ length: 12 }, (_, i) => ({
    widthPct: 100 / 12,
    severityClass: 'iv-ok',
    highVelocity: i === 0,
  }))

const mockQuotas = Array.from({ length: 1 }, () => ({
  label: 'Weekly',
  consumedPct: 30,
  remainingPct: 70,
  resetAt: '2026-05-19',
  segments: makeSegments(),
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('test_provider_card_renders_provider_name', () => {
  render(
    <ProviderCard
      config={anthropicConfig}
      data={mockData}
      healthCells={mockHealthCells}
      quotas={mockQuotas}
    />
  )

  // Provider name rendered as uppercase
  expect(screen.getByText('ANTHROPIC')).toBeInTheDocument()
})

test('test_provider_card_renders_11_metrics', () => {
  render(
    <ProviderCard
      config={anthropicConfig}
      data={mockData}
      healthCells={mockHealthCells}
      quotas={mockQuotas}
    />
  )

  const metricLabels = [
    'Toks In',
    'Toks Out',
    'Cost',
    'Requests',
    'Errors',
    'P95',
    'Cache In',
    'Cache Create',
    'Reason Rptd',
    'Reason Est',
    'Traces',
  ]

  // Wave 12 Fix 2: healthTooltipContent now repeats 'P95', 'Errors', 'Requests'
  // in the HoverTooltip content panel, so getByText (single-match) would throw.
  // Use getAllByText and assert at least one match exists.
  for (const label of metricLabels) {
    const matches = screen.getAllByText(new RegExp(label, 'i'))
    expect(matches.length).toBeGreaterThanOrEqual(1)
  }
})

test('test_provider_card_renders_token_cache_section', () => {
  render(
    <ProviderCard
      config={anthropicConfig}
      data={mockData}
      healthCells={mockHealthCells}
      quotas={mockQuotas}
    />
  )

  expect(screen.getByText('TOKEN CACHE')).toBeInTheDocument()

  const cacheRowLabels = [
    'Cache In',
    'Cache Create',
    'Cache Miss',
    'Cache Savings',
  ]
  let foundCount = 0
  for (const label of cacheRowLabels) {
    const el = screen.queryByText(new RegExp(label, 'i'))
    if (el) foundCount++
  }
  expect(foundCount).toBeGreaterThanOrEqual(4)
})

test('test_provider_card_renders_reasoning_section', () => {
  render(
    <ProviderCard
      config={anthropicConfig}
      data={mockData}
      healthCells={mockHealthCells}
      quotas={mockQuotas}
    />
  )

  expect(screen.getByText('REASONING')).toBeInTheDocument()

  const reasoningRowLabels = ['Reason Rptd', 'Reason Est', 'Reason Sources']
  let foundCount = 0
  for (const label of reasoningRowLabels) {
    const el = screen.queryByText(new RegExp(label, 'i'))
    if (el) foundCount++
  }
  expect(foundCount).toBeGreaterThanOrEqual(3)
})

test('test_provider_card_renders_health_strip', () => {
  const { container } = render(
    <ProviderCard
      config={anthropicConfig}
      data={mockData}
      healthCells={mockHealthCells}
      quotas={mockQuotas}
    />
  )

  // HealthStrip should render 288 cells
  const cellEls =
    container.querySelectorAll('.health-strip-cell').length > 0
      ? container.querySelectorAll('.health-strip-cell')
      : container.querySelectorAll('[data-testid="health-strip-cell"]')

  if (cellEls.length === 0) {
    // Fall back to test-id on the container
    const strip = container.querySelector('[data-testid="health-strip"]')
    expect(strip).not.toBeNull()
  } else {
    expect(cellEls.length).toBe(288)
  }
})

test('test_provider_card_quota_bar_renders_intervals', () => {
  // Wave 11 PR3 (11-h/11-i): mockQuotas now contains 1 QuotaBarGroup with
  // N=12 segments, so the rendered interval count is 1 × 12 = 12.
  const { container } = render(
    <ProviderCard
      config={anthropicConfig}
      data={mockData}
      healthCells={mockHealthCells}
      quotas={mockQuotas}
    />
  )

  const intervals =
    container.querySelectorAll('.quota-interval').length > 0
      ? container.querySelectorAll('.quota-interval')
      : container.querySelectorAll('[data-testid="quota-interval"]')

  expect(intervals.length).toBe(12)
})

test('test_provider_card_anomaly_badge_early_reset', () => {
  const { container } = render(
    <ProviderCard
      config={anthropicConfig}
      data={mockData}
      healthCells={mockHealthCells}
      quotas={mockQuotas}
      anomalies={{ earlyReset: new Set(['anthropic']), cacheStale: false }}
    />
  )

  // Early reset badge renders ⟲ icon
  const badgeEl =
    container.querySelector('.icon-reset') ??
    container.querySelector('[aria-label*="early reset"]') ??
    container.querySelector('[aria-label*="early-reset"]')

  expect(badgeEl).not.toBeNull()
})

test('test_provider_card_anomaly_badge_cache_stale', () => {
  const { container } = render(
    <ProviderCard
      config={anthropicConfig}
      data={mockData}
      healthCells={mockHealthCells}
      quotas={mockQuotas}
      anomalies={{ earlyReset: new Set(), cacheStale: true }}
    />
  )

  // Cache stale badge renders ⚠ icon
  const badgeEl =
    container.querySelector('.icon-cache') ??
    container.querySelector('[aria-label*="cache stale"]') ??
    container.querySelector('[aria-label*="cache-stale"]')

  expect(badgeEl).not.toBeNull()
})
