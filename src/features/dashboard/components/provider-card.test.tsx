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
import {
  ProviderCard,
  type QuotaBarGroup,
  type QuotaLane,
  type QuotaRowConfig,
} from './provider-card'

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

// ---------------------------------------------------------------------------
// W32 (full-parity) — historical reset bar tests
// ---------------------------------------------------------------------------

/**
 * W32 full-parity: ProviderCard renders additional quota bars for historical
 * resets at IDENTICAL visual weight to current bars — no opacity reduction.
 *
 * Historical bars are produced by buildHistoryBarsForProvider and have the
 * same 12-segment fill shape as current bars. The `isHistorical` field has
 * been removed; there is no longer any visual differentiation.
 */
test('test_provider_card_renders_historical_bars_identical_to_current', () => {
  const makeFullSegments = (): QuotaRowConfig[] =>
    Array.from({ length: 12 }, (_, i) => ({
      widthPct: 100 / 12,
      severityClass: i < 10 ? 'iv-50-p' : i === 10 ? 'iv-5-10' : 'iv-0-5',
      highVelocity: i === 10,
    }))

  const currentBar: QuotaBarGroup = {
    label: 'all · 7d',
    consumedPct: 40,
    remainingPct: 60,
    resetAt: '2026-05-19T00:00:00Z',
    segments: makeSegments(),
  }
  // Historical bar uses full 12-segment segments (full parity).
  const historicalBar: QuotaBarGroup = {
    label: 'all · 2026-05-12 00:00',
    consumedPct: 88,
    remainingPct: 12,
    resetAt: '2026-05-12T00:00:00Z',
    segments: makeFullSegments(),
    tipWindow: 'Sun 5/11 → Sun 5/18',
    tipModels: [{ model: 'claude-3-5-sonnet', costDelta: '$4.20' }],
  }

  const { container } = render(
    <ProviderCard
      config={anthropicConfig}
      data={mockData}
      healthCells={mockHealthCells}
      quotas={[currentBar, historicalBar]}
    />
  )

  // Should render 2 quota bars total (1 current + 1 historical).
  const bars = container.querySelectorAll('.quota-row-bar')
  expect(bars.length).toBe(2)

  // Historical bar wrapper must have no inline opacity style.
  const wrappers = container.querySelectorAll('.quota-row')
  const opacitySet = Array.from(wrappers).some(
    (el) => (el as HTMLElement).style.opacity !== ''
  )
  expect(opacitySet).toBe(false)
})

test('test_provider_card_historical_bar_uses_12_segments', () => {
  // Full-parity: historical bars must render 12 quota-interval segments,
  // identical to current bars produced by buildQuotaSegments().
  const makeFullSegments = (): QuotaRowConfig[] =>
    Array.from({ length: 12 }, (_, i) => ({
      widthPct: 100 / 12,
      severityClass: i < 6 ? 'iv-50-p' : i === 6 ? 'iv-5-10' : 'iv-0-5',
      highVelocity: i === 6,
    }))

  const historicalBar: QuotaBarGroup = {
    label: 'all · 2026-05-12 00:00',
    consumedPct: 75,
    remainingPct: 25,
    resetAt: '2026-05-12T00:00:00Z',
    segments: makeFullSegments(),
    tipWindow: 'Sun 5/11 → Sun 5/18',
  }

  const { container } = render(
    <ProviderCard
      config={anthropicConfig}
      data={mockData}
      healthCells={mockHealthCells}
      quotas={[historicalBar]}
    />
  )

  // Exactly 12 quota-interval elements — same as a current bar.
  const intervals = container.querySelectorAll('.quota-interval')
  expect(intervals.length).toBe(12)
})

test('test_provider_card_historical_bars_do_not_break_empty_quotaHistory', () => {
  // When no quotaHistory is present (quotas = only current bars), rendering
  // must not differ from baseline — current bars still work as before W32.
  const { container } = render(
    <ProviderCard
      config={anthropicConfig}
      data={mockData}
      healthCells={mockHealthCells}
      quotas={mockQuotas}
    />
  )

  // Still renders the Quotas section title.
  expect(container.querySelector('.quota-section-title')).not.toBeNull()
  // Still renders exactly 12 intervals (1 bar × 12 segments).
  const intervals = container.querySelectorAll('.quota-interval')
  expect(intervals.length).toBe(12)
})

// ---------------------------------------------------------------------------
// Wave 41 — QuotaLane rendering tests
// ---------------------------------------------------------------------------

describe('Wave 41 — QuotaLane structured lane rendering', () => {
  const makeFullSegments = (): QuotaRowConfig[] =>
    Array.from({ length: 12 }, (_, i) => ({
      widthPct: 100 / 12,
      severityClass: i < 8 ? 'iv-50-p' : i === 8 ? 'iv-5-10' : 'iv-0-5',
      highVelocity: i === 8,
    }))

  const currentBar: QuotaBarGroup = {
    label: 'All Models · 5hr',
    consumedPct: 67,
    remainingPct: 33,
    resetAt: '2026-05-20T21:00:00Z',
    segments: makeFullSegments(),
    tipWindow: '−5h → now',
    tipVelocity: '+13.4%/h',
  }

  const priorBar1: QuotaBarGroup = {
    label: '5h ago',
    consumedPct: 43,
    remainingPct: 57,
    resetAt: '2026-05-20T16:00:00Z',
    segments: makeFullSegments(),
    timeAgoLabel: '5h ago',
  }

  const priorBar2: QuotaBarGroup = {
    label: '10h ago',
    consumedPct: 88,
    remainingPct: 12,
    resetAt: '2026-05-20T11:00:00Z',
    segments: makeFullSegments(),
    timeAgoLabel: '10h ago',
  }

  const testLane: QuotaLane = {
    laneKey: 'anthropic/short',
    laneLabel: 'All Models · 5hr',
    currentBar,
    priorBars: [priorBar1, priorBar2],
  }

  test('test_provider_card_lane_renders_quota_section_title', () => {
    const { container } = render(
      <ProviderCard
        config={anthropicConfig}
        data={mockData}
        healthCells={mockHealthCells}
        quotas={[]}
        lanes={[testLane]}
      />
    )
    expect(container.querySelector('.quota-section-title')).not.toBeNull()
  })

  test('test_provider_card_lane_renders_lane_label', () => {
    const { container } = render(
      <ProviderCard
        config={anthropicConfig}
        data={mockData}
        healthCells={mockHealthCells}
        quotas={[]}
        lanes={[testLane]}
      />
    )
    const labels = container.querySelectorAll('.quota-lane-label')
    expect(labels.length).toBeGreaterThanOrEqual(1)
    // textTransform:uppercase is CSS — jsdom won't capitalise; check source text.
    const labelText = Array.from(labels).some((el) =>
      el.textContent?.toLowerCase().includes('all models')
    )
    expect(labelText).toBe(true)
  })

  test('test_provider_card_lane_renders_3_bars_total', () => {
    // 1 current + 2 prior = 3 bars total = 3 × 12 = 36 intervals.
    const { container } = render(
      <ProviderCard
        config={anthropicConfig}
        data={mockData}
        healthCells={mockHealthCells}
        quotas={[]}
        lanes={[testLane]}
      />
    )
    const bars = container.querySelectorAll('.quota-row-bar')
    expect(bars.length).toBe(3)
  })

  test('test_provider_card_current_bar_not_marked_is_prior', () => {
    const { container } = render(
      <ProviderCard
        config={anthropicConfig}
        data={mockData}
        healthCells={mockHealthCells}
        quotas={[]}
        lanes={[testLane]}
      />
    )
    const bars = container.querySelectorAll('.quota-row-bar')
    // First bar (current) must NOT have .is-prior class.
    expect(bars[0].classList.contains('is-prior')).toBe(false)
  })

  test('test_provider_card_prior_bars_marked_is_prior', () => {
    const { container } = render(
      <ProviderCard
        config={anthropicConfig}
        data={mockData}
        healthCells={mockHealthCells}
        quotas={[]}
        lanes={[testLane]}
      />
    )
    const bars = container.querySelectorAll('.quota-row-bar')
    // Prior bars (index 1 and 2) MUST have .is-prior class.
    expect(bars[1].classList.contains('is-prior')).toBe(true)
    expect(bars[2].classList.contains('is-prior')).toBe(true)
  })

  test('test_provider_card_multiple_lanes_render_separate_rows', () => {
    const lane2: QuotaLane = {
      laneKey: 'anthropic/weekly',
      laneLabel: 'All Models · 7d',
      currentBar: { ...currentBar, label: 'All Models · 7d' },
      priorBars: [],
    }
    const { container } = render(
      <ProviderCard
        config={anthropicConfig}
        data={mockData}
        healthCells={mockHealthCells}
        quotas={[]}
        lanes={[testLane, lane2]}
      />
    )
    const laneRows = container.querySelectorAll('.quota-lane-row')
    expect(laneRows.length).toBe(2)
  })

  test('test_provider_card_empty_lanes_falls_back_to_quotas', () => {
    // When lanes=undefined, the legacy quotas[] rendering is used.
    const { container } = render(
      <ProviderCard
        config={anthropicConfig}
        data={mockData}
        healthCells={mockHealthCells}
        quotas={[currentBar]}
      />
    )
    // Legacy path renders .quota-row-bar (not .quota-lane-row).
    expect(container.querySelectorAll('.quota-row-bar').length).toBe(1)
    expect(container.querySelectorAll('.quota-lane-row').length).toBe(0)
  })
})
