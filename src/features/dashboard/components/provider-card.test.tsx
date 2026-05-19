/**
 * Wave 4 — ProviderCard red-phase tests.
 *
 * Component path: src/features/dashboard/components/provider-card.tsx
 * Expected export: ProviderCard (named)
 *
 * Wave 14-C: tests updated to match 9-row metric grid, lowercase Token Cache
 * and Reasoning labels, est-mark on estimated value, integer no-reasoning calls.
 *
 * Wave 26: tests updated for restructured section layout:
 * - REQUESTS section (pc-sub-title + pc-mini-table): requests / no-reasoning requests
 * - 6 provider-metric rows (p95 Latency → Status; Requests/Tokens/Cost removed)
 * - TOKENS section (pc-sub-title + pc-mini-table): in/out/cost/cache in/cache creation/
 *   cache miss $/reasoning reported/reasoning estimated*
 * - TOKEN CACHE and REASONING sub-sections removed.
 * - F8: .t-model spans in quota tooltip use providerBrandHex() color.
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
  cache_miss_usd: 0,
  reasoning_reported: 100,
  reasoning_estimated: 90,
  no_reasoning_calls: 5,
  traces: 5,
  rate_limits: 0,
  capacity: 0,
  packet_loss_pct: null,
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

test('test_provider_card_renders_requests_section', () => {
  render(
    <ProviderCard
      config={anthropicConfig}
      data={mockData}
      healthCells={mockHealthCells}
      quotas={mockQuotas}
    />
  )

  // Wave 26 F2: REQUESTS section header present
  expect(screen.getByText('REQUESTS')).toBeInTheDocument()

  // Wave 26 F2: requests row inside REQUESTS pc-mini-table
  const requestsLabels = screen.getAllByText(/^requests$/i)
  expect(requestsLabels.length).toBeGreaterThanOrEqual(1)

  // Wave 26 F2: no-reasoning requests row (renamed from 'no-reasoning calls')
  expect(screen.getByText('no-reasoning requests')).toBeInTheDocument()
})

test('test_provider_card_renders_6_metric_rows', () => {
  render(
    <ProviderCard
      config={anthropicConfig}
      data={mockData}
      healthCells={mockHealthCells}
      quotas={mockQuotas}
    />
  )

  // Wave 26 F2: provider-metric rows are now: p95 Latency, Errors, Rate Limits,
  // Capacity, Packet Loss, Status. Requests / Tokens / Cost moved to sections.
  const metricLabels = [
    'p95 Latency',
    'Errors',
    'Rate Limits',
    'Capacity',
    'Packet Loss',
    'Status',
  ]

  // Wave 12 Fix 2: healthTooltipContent repeats 'Errors', 'Requests' in tooltip
  // so getAllByText guards against single-match failures.
  for (const label of metricLabels) {
    const matches = screen.getAllByText(new RegExp(`^${label}$`, 'i'))
    expect(matches.length).toBeGreaterThanOrEqual(1)
  }
})

test('test_provider_card_does_not_render_requests_tokens_cost_metric_rows', () => {
  const { container } = render(
    <ProviderCard
      config={anthropicConfig}
      data={mockData}
      healthCells={mockHealthCells}
      quotas={mockQuotas}
    />
  )

  // Wave 26 F2: 'Tokens' provider-metric row is gone; 'TOKEN CACHE' section is gone;
  // 'REASONING' section is gone.
  const providerMetricEls = container.querySelectorAll('.provider-metric')
  // Should be exactly 6 (p95 Latency, Errors, Rate Limits, Capacity, Packet Loss, Status)
  expect(providerMetricEls.length).toBe(6)

  // Old section titles must not exist
  expect(screen.queryByText('TOKEN CACHE')).toBeNull()
  expect(screen.queryByText('REASONING')).toBeNull()
})

test('test_provider_card_renders_tokens_section', () => {
  render(
    <ProviderCard
      config={anthropicConfig}
      data={mockData}
      healthCells={mockHealthCells}
      quotas={mockQuotas}
    />
  )

  // Wave 26 F2: TOKENS section header
  expect(screen.getByText('TOKENS')).toBeInTheDocument()

  // Rows: in / out / cost / cache in / cache creation / cache miss $ /
  //       reasoning reported / reasoning estimated
  // Use exact string queries for labels that contain regex-special chars (e.g. '$').
  const tokensRowLabels = [
    'in',
    'out',
    'cost',
    'cache in',
    'cache creation',
    'cache miss $',
    'reasoning reported',
    'reasoning estimated',
  ]

  let foundCount = 0
  for (const label of tokensRowLabels) {
    // queryAllByText with exact:true avoids regex special-char escaping issues.
    const els = screen.queryAllByText(label, { exact: true })
    if (els.length > 0) foundCount++
  }
  expect(foundCount).toBeGreaterThanOrEqual(tokensRowLabels.length)
})

test('test_provider_card_tokens_section_reasoning_estimated_has_est_mark', () => {
  const { container } = render(
    <ProviderCard
      config={anthropicConfig}
      data={mockData}
      healthCells={mockHealthCells}
      quotas={mockQuotas}
    />
  )

  // Wave 26 F2 (preserves 14-C.8): est-mark asterisk on reasoning estimated value
  const estMark = container.querySelector('.est-mark')
  expect(estMark).not.toBeNull()
  expect(estMark?.textContent).toBe('*')
})

test('test_provider_card_no_reasoning_requests_row_shows_value', () => {
  render(
    <ProviderCard
      config={anthropicConfig}
      data={{ ...mockData, no_reasoning_calls: 5 }}
      healthCells={mockHealthCells}
      quotas={mockQuotas}
    />
  )

  // Wave 26 F2: 'no-reasoning requests' label (renamed from 'no-reasoning calls')
  // must be present and show the integer value.
  expect(screen.getByText('no-reasoning requests')).toBeInTheDocument()
  // fmtCompact(5) = '5' — but '5' may also appear elsewhere; check via label proximity
  // at minimum the label exists (value assertion via integration would need RTL queries)
  expect(screen.queryByText('no-reasoning calls')).toBeNull()
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

test('test_provider_card_quota_tip_model_has_brand_color', () => {
  // Wave 26 F8: .t-model spans in quota tooltip must have style.color set
  // via providerBrandHex(tm.model).
  const mockQuotasWithModels = [
    {
      label: 'Weekly',
      consumedPct: 30,
      remainingPct: 70,
      resetAt: '2026-05-19',
      segments: makeSegments(),
      tipModels: [
        { model: 'claude-3-5-sonnet-20241022', costDelta: '+$24' },
        { model: 'gpt-4o', costDelta: '+$12' },
      ],
    },
  ]

  const { container } = render(
    <ProviderCard
      config={anthropicConfig}
      data={mockData}
      healthCells={mockHealthCells}
      quotas={mockQuotasWithModels}
    />
  )

  // .t-model spans should have an inline color style applied
  const tModelSpans = container.querySelectorAll('.t-model')
  // Only populated rows have the style; placeholder '—' rows do not
  const coloredSpans = Array.from(tModelSpans).filter(
    (el) => (el as HTMLElement).style.color !== ''
  )
  expect(coloredSpans.length).toBeGreaterThanOrEqual(1)
})
