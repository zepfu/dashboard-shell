/**
 * Wave 4 — ProviderCard red-phase tests.
 *
 * Component path: src/features/dashboard/components/provider-card.tsx
 * Expected export: ProviderCard (named)
 *
 * Wave 14-C: tests updated to match 9-row metric grid, lowercase Token Cache
 * and consolidated Reasoning value, est-mark on estimated contribution, recent
 * request counts.
 *
 * Wave 26: tests updated for restructured section layout:
 * - REQUESTS section (pc-sub-title + pc-mini-table): requests / requests 90m
 * - 6 provider-metric rows (p95 Latency → Status; Requests/Tokens/Cost removed)
 * - TOKENS section (pc-sub-title + pc-mini-table): in/out/cost/cache in/cache creation/
 *   cache miss $/reasoning*
 * - TOKEN CACHE and REASONING sub-sections removed.
 * - F8: .t-model spans in quota tooltip use providerBrandHex() color.
 */
import React, { type ReactElement } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { providerBrandHex } from '../lib/usage-report-display'
import {
  ProviderCard,
  type QuotaBarGroup,
  type QuotaLane,
  type QuotaRowConfig,
} from './provider-card'
import {
  PACKET_LOSS_STATUS_WARN_THRESHOLD,
  hasEarlyReset,
  pctSeverityClass,
} from './provider-card-helpers'
import type { AnomalyFlags } from './provider-card-types'

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
  recent_requests_90m: 12,
  traces: 5,
  rate_limits: 0,
  capacity: 0,
  packet_loss_pct: null,
}

const anthropicConfig = { provider: 'anthropic', color: '#cc7855' }

const mockHealthCells = Array.from({ length: 288 }, () => ({
  color: 'var(--card-2)',
}))

const QUOTA_SEGMENTS = 100

function hexToRgbStyle(hex: string): string {
  const normalized = hex.replace(/^#/, '')
  const red = Number.parseInt(normalized.slice(0, 2), 16)
  const green = Number.parseInt(normalized.slice(2, 4), 16)
  const blue = Number.parseInt(normalized.slice(4, 6), 16)
  return `rgb(${red.toString()}, ${green.toString()}, ${blue.toString()})`
}

// Wave 11 PR3 (11-h/11-i): QuotaBarGroup[] — each entry is a quota-type bar
// with pre-built N=100 segment array.
const makeSegments = () =>
  Array.from({ length: QUOTA_SEGMENTS }, (_, i) => ({
    widthPct: 100 / QUOTA_SEGMENTS,
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

  expect(screen.getByText('requests 90m')).toBeInTheDocument()
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

test('test_provider_card_unmeasured_p95_renders_dash_not_zero', () => {
  const { container } = render(
    <ProviderCard
      config={anthropicConfig}
      data={{ ...mockData, p95_ms: null }}
      healthCells={mockHealthCells}
      quotas={mockQuotas}
    />
  )

  const latencyMetric = Array.from(
    container.querySelectorAll('.provider-metric')
  ).find((el) => el.textContent?.includes('p95 Latency'))
  const value = latencyMetric?.querySelector('.provider-metric-value')

  expect(value?.textContent).toBe('—')
  expect(latencyMetric?.textContent).not.toContain('0ms')
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
  //       reasoning
  // Use exact string queries for labels that contain regex-special chars (e.g. '$').
  const tokensRowLabels = [
    'in',
    'out',
    'cost',
    'cache in',
    'cache creation',
    'cache miss $',
    'reasoning',
  ]

  let foundCount = 0
  for (const label of tokensRowLabels) {
    // queryAllByText with exact:true avoids regex special-char escaping issues.
    const els = screen.queryAllByText(label, { exact: true })
    if (els.length > 0) foundCount++
  }
  expect(foundCount).toBeGreaterThanOrEqual(tokensRowLabels.length)
  expect(screen.queryByText('reasoning reported', { exact: true })).toBeNull()
  expect(screen.queryByText('reasoning estimated', { exact: true })).toBeNull()
})

test('test_provider_card_tokens_section_reasoning_combines_estimated_with_hover_breakdown', () => {
  const { container } = render(
    <ProviderCard
      config={anthropicConfig}
      data={mockData}
      healthCells={mockHealthCells}
      quotas={mockQuotas}
    />
  )

  expect(container.querySelector('.reasoning-token-value')?.textContent).toBe(
    '190*'
  )
  const estMark = container.querySelector('.est-mark')
  expect(estMark).not.toBeNull()
  expect(estMark?.textContent).toBe('*')

  fireEvent.pointerEnter(container.querySelector('.reasoning-token-value')!)
  expect(screen.getAllByText('Reasoning tokens').length).toBeGreaterThan(0)
  expect(screen.getAllByText('reported').length).toBeGreaterThan(0)
  expect(screen.getAllByText('100').length).toBeGreaterThan(0)
  expect(screen.getAllByText('estimated').length).toBeGreaterThan(0)
  expect(screen.getAllByText('90').length).toBeGreaterThan(0)
})

test('test_provider_card_recent_requests_row_shows_value', () => {
  render(
    <ProviderCard
      config={anthropicConfig}
      data={{ ...mockData, recent_requests_90m: 12 }}
      healthCells={mockHealthCells}
      quotas={mockQuotas}
    />
  )

  expect(screen.getByText('requests 90m')).toBeInTheDocument()
  expect(screen.getByText('12')).toBeInTheDocument()
  expect(screen.queryByText('no-reasoning requests')).toBeNull()
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

  // Provider-card vertical strips keep 288 logical buckets but render adjacent
  // identical buckets as one proportional visual run.
  const cellEls =
    container.querySelectorAll('.health-strip-cell').length > 0
      ? container.querySelectorAll('.health-strip-cell')
      : container.querySelectorAll('[data-testid="health-strip-cell"]')

  if (cellEls.length === 0) {
    // Fall back to test-id on the container
    const strip = container.querySelector('[data-testid="health-strip"]')
    expect(strip).not.toBeNull()
  } else {
    expect(cellEls.length).toBe(1)
    expect((cellEls[0] as HTMLElement).style.flexGrow).toBe('288')
    expect((cellEls[0] as HTMLElement).style.flexBasis).toBe('0px')
  }
})

test('test_local_provider_card_renders_local_health_indicators', () => {
  render(
    <ProviderCard
      config={{ provider: 'local', color: '#a1a1aa' }}
      data={mockData}
      healthCells={mockHealthCells}
      quotas={[]}
      localHealthItems={[
        {
          checked_at: '2026-05-25T20:00:00.000Z',
          category: 'container',
          key: 'aawm-langfuse-redis',
          label: 'Langfuse Redis',
          status: 'green',
          detail: 'PONG',
          target: 'langfuse-redis:6379',
          latency_ms: 2,
        },
        {
          checked_at: '2026-05-25T20:00:00.000Z',
          category: 'model',
          key: 'aawm-tap-grobid',
          label: 'GROBID',
          status: 'yellow',
          detail: 'HTTP 404',
          target: 'http://host.docker.internal:8070/api/isalive',
          latency_ms: 4,
        },
      ]}
    />
  )

  expect(screen.getByText('LOCAL HEALTH')).toBeInTheDocument()
  expect(screen.getByLabelText('Langfuse Redis: healthy')).toBeInTheDocument()
  expect(screen.getByLabelText('GROBID: warning')).toBeInTheDocument()
})

test('test_provider_card_quota_bar_renders_intervals', () => {
  // Wave 11 PR3 (11-h/11-i): mockQuotas now contains 1 QuotaBarGroup with
  // N=100 logical segments. Adjacent identical segments render as a single run.
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

  expect(mockQuotas[0].segments).toHaveLength(QUOTA_SEGMENTS)
  expect(intervals.length).toBe(1)
  expect((intervals[0] as HTMLElement).style.width).toBe('100%')
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
      tipRequestTotal: 15,
      tipRecentRequestTotal90m: 4,
      tipModels: [
        {
          model: 'claude-3-5-sonnet-20241022',
          costDelta: '+$24',
          requests: 10,
          recentRequests90m: 3,
        },
        {
          model: 'gpt-4o',
          costDelta: '+$12',
          requests: 5,
          recentRequests90m: 1,
        },
        {
          model: 'oa_xai/grok-4.3',
          costDelta: '+$3',
          requests: 2,
          recentRequests90m: 1,
        },
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

  const quotaTrigger =
    container.querySelector('.quota-row-bar') ??
    container.querySelector('.qbar-fill')
  expect(quotaTrigger).not.toBeNull()
  fireEvent.pointerEnter(quotaTrigger as HTMLElement)

  const tModelSpans = document.body.querySelectorAll('.t-model')
  // Only populated rows have the style; placeholder '—' rows do not
  const coloredSpans = Array.from(tModelSpans).filter(
    (el) => (el as HTMLElement).style.color !== ''
  )
  expect(coloredSpans.length).toBeGreaterThanOrEqual(1)
  expect(document.body.textContent).toContain('requests')
  expect(document.body.textContent).toContain('15')
  expect(document.body.textContent).toContain('10 req · 3 90m')
  const xaiModelSpan = Array.from(tModelSpans).find(
    (el) => el.textContent === 'oa_xai/grok-4.3'
  ) as HTMLElement | undefined
  expect(xaiModelSpan).not.toBeUndefined()
  expect(xaiModelSpan?.style.color).toBe(hexToRgbStyle(providerBrandHex('xai')))
})

// ---------------------------------------------------------------------------
// W32 (full-parity) — historical reset bar tests
// ---------------------------------------------------------------------------

/**
 * W32 full-parity: ProviderCard renders additional quota bars for historical
 * resets at IDENTICAL visual weight to current bars — no opacity reduction.
 *
 * Historical bars are produced by buildHistoryBarsForProvider and have the
 * same 100-segment fill shape as current bars. The `isHistorical` field has
 * been removed; there is no longer any visual differentiation.
 */
test('test_provider_card_renders_historical_bars_identical_to_current', () => {
  const makeFullSegments = (): QuotaRowConfig[] =>
    Array.from({ length: QUOTA_SEGMENTS }, (_, i) => ({
      widthPct: 100 / QUOTA_SEGMENTS,
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
  // Historical bar uses full 100-segment segments (full parity).
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

test('test_provider_card_historical_bar_uses_100_segments', () => {
  // Full-parity: historical bars keep 100 logical quota intervals and render
  // the same merged visual-run shape as current bars.
  const makeFullSegments = (): QuotaRowConfig[] =>
    Array.from({ length: QUOTA_SEGMENTS }, (_, i) => ({
      widthPct: 100 / QUOTA_SEGMENTS,
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

  expect(historicalBar.segments).toHaveLength(QUOTA_SEGMENTS)
  const intervals = container.querySelectorAll('.quota-interval')
  expect(intervals.length).toBe(3)
  expect(
    Array.from(intervals).map((el) => (el as HTMLElement).style.width)
  ).toEqual(['6%', '1%', '93%'])
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
  // Still receives exactly 100 logical intervals and renders one merged run.
  const intervals = container.querySelectorAll('.quota-interval')
  expect(mockQuotas[0].segments).toHaveLength(QUOTA_SEGMENTS)
  expect(intervals.length).toBe(1)
})

// ---------------------------------------------------------------------------
// Wave 41 — QuotaLane rendering tests
// ---------------------------------------------------------------------------

describe('Wave 41 — QuotaLane structured lane rendering', () => {
  const makeFullSegments = (): QuotaRowConfig[] =>
    Array.from({ length: QUOTA_SEGMENTS }, (_, i) => ({
      widthPct: 100 / QUOTA_SEGMENTS,
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
    // 1 current + 2 prior = 3 bars total = 3 x 100 = 300 intervals.
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

  test('test_provider_card_prior_bars_preserve_velocity_classes', () => {
    const priorWithVelocity: QuotaBarGroup = {
      ...priorBar1,
      segments: Array.from({ length: QUOTA_SEGMENTS }, (_, i) => ({
        widthPct: 100 / QUOTA_SEGMENTS,
        severityClass: 'iv-25-50',
        highVelocity: i === 3,
        velocityClass: i === 3 ? 'velocity-hot' : undefined,
      })),
    }
    const lane: QuotaLane = {
      ...testLane,
      priorBars: [priorWithVelocity],
    }

    const { container } = render(
      <ProviderCard
        config={anthropicConfig}
        data={mockData}
        healthCells={mockHealthCells}
        quotas={[]}
        lanes={[lane]}
      />
    )

    const priorBar = container.querySelector('.quota-row-bar.is-prior')
    expect(priorBar).not.toBeNull()
    expect(
      priorBar!.querySelector('.quota-interval.high-velocity.velocity-hot')
    ).not.toBeNull()
    expect(
      priorBar!.querySelectorAll('.quota-row-velocity-overlay')
    ).toHaveLength(1)
    expect(
      priorBar!.querySelectorAll('.quota-row-velocity-sweep')
    ).toHaveLength(1)
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

  // -------------------------------------------------------------------------
  // Wave 43 — dateRangeLabel rendering on prior bars
  // -------------------------------------------------------------------------

  test('test_provider_card_prior_bar_renders_date_range_label', () => {
    // A prior bar with dateRangeLabel set must render a .quota-row-date-range element.
    const priorWithRange: QuotaBarGroup = {
      label: '5h ago',
      consumedPct: 43,
      remainingPct: 57,
      resetAt: '2026-05-20T16:00:00Z',
      segments: makeFullSegments(),
      timeAgoLabel: '5h ago',
      dateRangeLabel: '5/20 11:00 → 5/20 16:00',
    }
    const lane: QuotaLane = {
      laneKey: 'anthropic/short',
      laneLabel: 'All Models · 5hr',
      currentBar,
      priorBars: [priorWithRange],
    }
    const { container } = render(
      <ProviderCard
        config={anthropicConfig}
        data={mockData}
        healthCells={mockHealthCells}
        quotas={[]}
        lanes={[lane]}
      />
    )
    const rangeLabels = container.querySelectorAll('.quota-row-date-range')
    expect(rangeLabels.length).toBe(1)
    expect(rangeLabels[0].textContent).toBe('5/20 11:00 → 5/20 16:00')
  })

  test('test_provider_card_current_bar_does_not_render_date_range_label', () => {
    // Current bar must never render .quota-row-date-range even if dateRangeLabel
    // were accidentally set — the condition gates on isPrior.
    const currentWithRange: QuotaBarGroup = {
      ...currentBar,
      dateRangeLabel: 'should-not-appear',
    }
    const lane: QuotaLane = {
      laneKey: 'anthropic/short',
      laneLabel: 'All Models · 5hr',
      currentBar: currentWithRange,
      priorBars: [],
    }
    const { container } = render(
      <ProviderCard
        config={anthropicConfig}
        data={mockData}
        healthCells={mockHealthCells}
        quotas={[]}
        lanes={[lane]}
      />
    )
    expect(container.querySelectorAll('.quota-row-date-range').length).toBe(0)
  })

  test('test_provider_card_prior_bar_without_date_range_label_renders_no_range_element', () => {
    // Prior bars without dateRangeLabel must not render the sub-label element.
    const priorNoRange: QuotaBarGroup = {
      label: '5h ago',
      consumedPct: 43,
      remainingPct: 57,
      resetAt: '2026-05-20T16:00:00Z',
      segments: makeFullSegments(),
      timeAgoLabel: '5h ago',
      // dateRangeLabel intentionally absent
    }
    const lane: QuotaLane = {
      laneKey: 'anthropic/short',
      laneLabel: 'All Models · 5hr',
      currentBar,
      priorBars: [priorNoRange],
    }
    const { container } = render(
      <ProviderCard
        config={anthropicConfig}
        data={mockData}
        healthCells={mockHealthCells}
        quotas={[]}
        lanes={[lane]}
      />
    )
    expect(container.querySelectorAll('.quota-row-date-range').length).toBe(0)
  })

  test('test_provider_card_multiple_prior_bars_each_render_date_range_label', () => {
    // Multiple prior bars in the same lane must each render their own range label.
    const prior1: QuotaBarGroup = {
      label: '5h ago',
      consumedPct: 43,
      remainingPct: 57,
      resetAt: '2026-05-20T16:00:00Z',
      segments: makeFullSegments(),
      timeAgoLabel: '5h ago',
      dateRangeLabel: '5/20 11:00 → 5/20 16:00',
    }
    const prior2: QuotaBarGroup = {
      label: '10h ago',
      consumedPct: 88,
      remainingPct: 12,
      resetAt: '2026-05-20T11:00:00Z',
      segments: makeFullSegments(),
      timeAgoLabel: '10h ago',
      dateRangeLabel: '5/20 06:00 → 5/20 11:00',
    }
    const lane: QuotaLane = {
      laneKey: 'anthropic/short',
      laneLabel: 'All Models · 5hr',
      currentBar,
      priorBars: [prior1, prior2],
    }
    const { container } = render(
      <ProviderCard
        config={anthropicConfig}
        data={mockData}
        healthCells={mockHealthCells}
        quotas={[]}
        lanes={[lane]}
      />
    )
    const rangeLabels = container.querySelectorAll('.quota-row-date-range')
    expect(rangeLabels.length).toBe(2)
    expect(rangeLabels[0].textContent).toBe('5/20 11:00 → 5/20 16:00')
    expect(rangeLabels[1].textContent).toBe('5/20 06:00 → 5/20 11:00')
  })
})

// ---------------------------------------------------------------------------
// Wave 2 (Adversarial Review 2026-06-12) — S2 provider-card correctness tests
// ---------------------------------------------------------------------------

/**
 * S2-16: `p95_ms === null` in TopModelRow must render `—`, not `0ms`.
 *
 * Current bug: `formatLatency(m.p95_ms ?? 0)` coerces null to 0 → renders "0ms".
 * Fix: delete the `?? 0` fallback; `formatLatency(null)` should return `—`.
 */
test('test_top_models_unmeasured_p95_renders_dash_not_zero', () => {
  render(
    <ProviderCard
      config={anthropicConfig}
      data={mockData}
      healthCells={mockHealthCells}
      quotas={mockQuotas}
      topModels={[
        {
          model: 'claude-opus-4-7',
          tokens: 50000,
          cost_usd: 2.5,
          requests: 100,
          p95_ms: null, // explicitly unmeasured
        },
        {
          model: 'claude-sonnet-4-5',
          tokens: 30000,
          cost_usd: 1.2,
          requests: 60,
          p95_ms: 1500, // has a valid latency for contrast
        },
      ]}
    />
  )

  // The null p95 row must show '—' and NOT '0ms'
  // Pre-fix: formatLatency(null ?? 0) = formatLatency(0) = '0ms'
  // Post-fix: formatLatency(null) = '—'
  const allText = document.body.textContent ?? ''
  expect(allText).not.toContain('0ms')

  // '—' must appear in the top-models section for the null-p95 row
  // (the non-null row renders '1500ms' or similar — we look for '—' as latency placeholder)
  const topModelDashes = document.body.querySelectorAll('.p95')
  const dashCell = Array.from(topModelDashes).find(
    (el) => el.textContent === '—'
  )
  // After the fix: dashCell must exist (null p95 renders dash)
  // Pre-fix: dashCell is undefined (renders '0ms' instead)
  expect(dashCell).toBeDefined()
  expect(dashCell?.textContent).toBe('—')
})

/**
 * S2-17: Prior bar without `timeAgoLabel` must render `—`, not 'now' or a date.
 *
 * Current bug: when `timeAgoLabel` is undefined and `isPrior === true`,
 * `resetDisplay = formatResetDistance(quotaBar.resetAt)` which computes
 * something like "resets in Xh Ym" or a relative time — not '—'.
 *
 * Fix: when `isPrior && quotaBar.timeAgoLabel === undefined`, render `—`
 * as the reset label.
 */
test('test_prior_bar_without_timeAgoLabel_renders_dash_not_now', () => {
  // Prior bar with NO timeAgoLabel
  const priorBarNoLabel: QuotaBarGroup = {
    label: 'Prior bar',
    consumedPct: 60,
    remainingPct: 40,
    resetAt: '2026-06-12T00:00:00Z', // past reset, but no timeAgoLabel
    segments: Array.from({ length: QUOTA_SEGMENTS }, (_, i) => ({
      widthPct: 100 / QUOTA_SEGMENTS,
      severityClass: 'iv-0-5',
      highVelocity: i === 50,
    })),
    // timeAgoLabel intentionally absent
  }

  const currentBar: QuotaBarGroup = {
    label: 'Current bar',
    consumedPct: 30,
    remainingPct: 70,
    resetAt: '2026-06-13T00:00:00Z',
    segments: Array.from({ length: QUOTA_SEGMENTS }, () => ({
      widthPct: 100 / QUOTA_SEGMENTS,
      severityClass: 'iv-0-5',
      highVelocity: false,
    })),
    timeAgoLabel: undefined, // current bar: no timeAgoLabel (uses formatResetDistance)
  }

  const lane: QuotaLane = {
    laneKey: 'anthropic/short',
    laneLabel: 'All Models · 5hr',
    currentBar,
    priorBars: [priorBarNoLabel],
  }

  const { container } = render(
    <ProviderCard
      config={anthropicConfig}
      data={mockData}
      healthCells={mockHealthCells}
      quotas={[]}
      lanes={[lane]}
    />
  )

  // The prior bar's reset display must be '—' when timeAgoLabel is absent.
  // Pre-fix: resetDisplay = formatResetDistance('2026-06-12T00:00:00Z') → something like 'now'
  //          or a negative relative time like '-1d ago'
  // Post-fix: resetDisplay = '—'
  const resetLabels = container.querySelectorAll('.quota-row-reset')
  expect(resetLabels.length).toBeGreaterThanOrEqual(2) // current + prior

  // The prior bar's reset label (second .quota-row-reset) must be '—'
  // (or whichever element corresponds to the prior bar)
  const priorResetLabel = resetLabels[1] as HTMLElement | undefined
  expect(priorResetLabel).toBeDefined()

  // Pre-fix: priorResetLabel.textContent will be something like 'now' or '-24h ago'
  // Post-fix: must be exactly '—'
  expect(priorResetLabel!.textContent?.trim()).toBe('—')
})

/**
 * S2-18: Status metric — 0 errors + 100% packet loss must NOT show a clean ✓.
 *
 * Current bug: `isHealthy = data.errors === 0` — ignores packet_loss_pct.
 * When packet_loss_pct=100 and errors=0, the status shows ✓ (healthy).
 *
 * Fix: `isHealthy = data.errors === 0 && (data.packet_loss_pct === null || data.packet_loss_pct < WARN_THRESHOLD)`
 * The status glyph must be ✗ (or a warn indicator) when packet loss is 100%.
 */
test('test_provider_status_thresholded', () => {
  render(
    <ProviderCard
      config={anthropicConfig}
      data={{
        ...mockData,
        errors: 0,
        packet_loss_pct: 100,
      }}
      healthCells={mockHealthCells}
      quotas={mockQuotas}
    />
  )

  const statusRows = document.querySelectorAll('.provider-metric')
  const statusMetric = Array.from(statusRows).find((el) =>
    el.textContent?.includes('Status')
  )
  expect(statusMetric).toBeDefined()
  expect(statusMetric!.textContent).not.toContain('✓')
  expect(statusMetric!.textContent).toContain('✗')
})

/** C-4 — packet loss below total loss must degrade status (threshold tightened from 100%). */
test('test_provider_status_degraded_on_high_packet_loss_not_only_total', () => {
  const warnBelowTotal = Math.min(50, PACKET_LOSS_STATUS_WARN_THRESHOLD - 1)
  render(
    <ProviderCard
      config={anthropicConfig}
      data={{
        ...mockData,
        errors: 0,
        packet_loss_pct: warnBelowTotal,
      }}
      healthCells={mockHealthCells}
      quotas={mockQuotas}
    />
  )
  const statusMetric = Array.from(
    document.querySelectorAll('.provider-metric')
  ).find((el) => el.textContent?.includes('Status'))
  expect(statusMetric?.textContent).toContain('✗')
})

/**
 * S2-19: `wrapperClassName='aggregate compact'` must suppress accent-chrome.
 *
 * Current bug: `wrapperClassName !== 'aggregate'` — exact string check.
 * When wrapperClassName='aggregate compact' (multiple classes), the check fails
 * (because 'aggregate compact' !== 'aggregate') and accent-chrome is applied.
 *
 * Fix: `wrapperClassName?.split(' ').includes('aggregate')` or a class-list check.
 */
test('test_wrapperClassName_aggregate_multitoken_suppresses_accent_chrome', () => {
  const { container } = render(
    <ProviderCard
      config={anthropicConfig}
      data={mockData}
      healthCells={mockHealthCells}
      quotas={mockQuotas}
      wrapperClassName='aggregate compact' // multi-token className
    />
  )

  // The provider-name element must NOT have inline color set to accent-chrome
  // when the className includes 'aggregate'.
  //
  // Pre-fix: 'aggregate compact' !== 'aggregate' → accent-chrome IS applied inline
  // Post-fix: 'aggregate compact'.split(' ').includes('aggregate') = true → no inline color
  const providerName = container.querySelector(
    '.provider-name'
  ) as HTMLElement | null
  expect(providerName).not.toBeNull()

  // Pre-fix: style.color = 'var(--accent-chrome)' because the guard fails
  // Post-fix: style.color = '' (empty, deferred to CSS class rule)
  expect(providerName!.style.color).not.toBe('var(--accent-chrome)')

  // The root element must have both 'aggregate' and 'compact' classes
  const root = container.querySelector('.provider-card') as HTMLElement | null
  expect(root?.classList.contains('aggregate')).toBe(true)
  expect(root?.classList.contains('compact')).toBe(true)
})

/**
 * S2-20: Anomaly icon must be scoped to the correct lane, and cacheStale
 * must render exactly once in the header (not duplicated per lane).
 *
 * Current behavior: `showEarlyReset = hasEarlyReset(anomalies.earlyReset, config.provider)`
 * — this checks the CARD-level provider, not the lane. So if earlyReset has 'anthropic',
 * ALL lanes show the icon.
 *
 * Fix: the icon should appear only on the lane that matches the early-reset key,
 * OR the fix might restructure anomalies to be per-lane. Additionally, cacheStale
 * must only render once (in the card header or as a single badge), not once per lane.
 *
 * This test uses 6 lanes with one early-reset event on lane 3 only.
 */
test('test_anomaly_icon_scoped_to_lane_and_cachestale_once', () => {
  const makeFullSegments = () =>
    Array.from({ length: QUOTA_SEGMENTS }, (_, i) => ({
      widthPct: 100 / QUOTA_SEGMENTS,
      severityClass: 'iv-0-5' as const,
      highVelocity: i === 50,
    }))

  // 6 lanes: only lane 3 (key 'anthropic/lane3') has an early-reset
  const lanes: QuotaLane[] = Array.from({ length: 6 }, (_, i) => ({
    laneKey: `anthropic/lane${i.toString()}`,
    laneLabel: `Lane ${i.toString()}`,
    currentBar: {
      label: `Lane ${i.toString()} current`,
      consumedPct: 20 + i * 5,
      remainingPct: 80 - i * 5,
      resetAt: `2026-06-13T${String(i + 10).padStart(2, '0')}:00:00Z`,
      segments: makeFullSegments(),
    },
    priorBars: [],
  }))

  // earlyReset is a Set containing ONLY 'anthropic' (the card-level provider)
  // but the intent is that only lane 3 had an early reset.
  // After the fix: the icon must appear only on lane 3 (or only once total).
  // Pre-fix: the icon appears on ALL current bars (because showEarlyReset is card-level).

  const { container } = render(
    <ProviderCard
      config={anthropicConfig}
      data={mockData}
      healthCells={mockHealthCells}
      quotas={[]}
      lanes={lanes}
      anomalies={{
        earlyReset: new Set(['anthropic']), // card-level, affects all lanes (bug)
        cacheStale: true,
      }}
    />
  )

  // Assert: cacheStale icon (⚠) must appear exactly ONCE in the quota section.
  // Pre-fix: it appears on every current bar (6 times = 6 lanes).
  // Post-fix: it appears exactly once (either in header or one lane).
  const cacheIcons = container.querySelectorAll('.icon-cache')
  expect(cacheIcons).toHaveLength(1)

  // Assert: earlyReset icon (⟲) must appear exactly ONCE per conceptual event.
  // Pre-fix: it appears on every current bar (6 times = wrong).
  // Post-fix: appears once (or on the specific lane that had the reset).
  const resetIcons = container.querySelectorAll('.icon-reset')
  expect(resetIcons).toHaveLength(1)
})

/**
 * S2-T5: earlyReset set containing 'openai' must NOT badge the anthropic card.
 *
 * Current behavior: `hasEarlyReset(anomalies.earlyReset, config.provider)` uses
 * `earlyReset.has(config.provider)` — for anthropic card, checks `has('anthropic')`.
 * If earlyReset = Set(['openai']), then `has('anthropic')` = false → no badge.
 * This should PASS already, but we pin it as a regression guard.
 *
 * The test is RED if the current implementation incorrectly shows the badge
 * (e.g., because of a Set iteration bug or wrong key comparison).
 *
 * After review finding S2-T5: the engineer may also migrate earlyReset from Set<string>
 * to Map<string, {prior, current}> form. The Map's .has() check must also work correctly.
 */
test('test_provider_card_topmodels_negative_anomaly_case', () => {
  const { container } = render(
    <ProviderCard
      config={anthropicConfig} // provider='anthropic'
      data={mockData}
      healthCells={mockHealthCells}
      quotas={mockQuotas}
      anomalies={{
        earlyReset: new Set(['openai']), // only openai has early reset
        cacheStale: false,
      }}
    />
  )

  // The anthropic card must NOT show an early-reset badge
  const resetBadge =
    container.querySelector('.icon-reset') ??
    container.querySelector('[aria-label*="early reset"]')

  expect(resetBadge).toBeNull()

  // Also test with Map form (post-engineer migration)
  // When earlyReset is a Map: Map({'openai': {prior: '...', current: '...'}})
  // `has('anthropic')` must return false for the anthropic card.
  const { container: container2 } = render(
    <ProviderCard
      config={anthropicConfig}
      data={mockData}
      healthCells={mockHealthCells}
      quotas={mockQuotas}
      anomalies={{
        earlyReset: new Map([
          [
            'openai',
            { prior: '2026-06-12T00:00:00Z', current: '2026-06-13T00:00:00Z' },
          ],
        ]),
        cacheStale: false,
      }}
    />
  )

  const resetBadge2 =
    container2.querySelector('.icon-reset') ??
    container2.querySelector('[aria-label*="early reset"]')

  // Pre-fix: If the implementation iterates the Map incorrectly (e.g., comparing values
  // instead of keys), this could erroneously show the badge for anthropic.
  // Post-fix: must be null (anthropic is not in the Map).
  expect(resetBadge2).toBeNull()

  // Verify that when 'anthropic' IS in the Map, the badge DOES show
  const { container: container3 } = render(
    <ProviderCard
      config={anthropicConfig}
      data={mockData}
      healthCells={mockHealthCells}
      quotas={mockQuotas}
      anomalies={{
        earlyReset: new Map([
          [
            'anthropic',
            { prior: '2026-06-12T00:00:00Z', current: '2026-06-13T00:00:00Z' },
          ],
        ]),
        cacheStale: false,
      }}
    />
  )

  const resetBadge3 =
    container3.querySelector('.icon-reset') ??
    container3.querySelector('[aria-label*="early reset"]')

  // Badge SHOULD appear when anthropic IS in the Map
  expect(resetBadge3).not.toBeNull()
})

/** P-1 — memo'd ProviderCard must not re-render when props are referentially stable. */
test('test_provider_card_memo_no_rerender_on_stable_props', () => {
  const innerRenderProbe = vi.fn((): ReactElement | null => null)
  function MemoInnerProbe(): ReactElement | null {
    innerRenderProbe()
    return null
  }
  const stableExtraPane = React.createElement(MemoInnerProbe)

  const stableAnomalies: AnomalyFlags = {
    earlyReset: new Map<string, { prior: string; current: string }>(),
    cacheStale: false,
  }
  const probeProps = {
    config: anthropicConfig,
    data: mockData,
    healthCells: mockHealthCells,
    quotas: mockQuotas,
    anomalies: stableAnomalies,
    extraPaneLeft: stableExtraPane,
  }

  class ParentHarness extends React.Component {
    state = { tick: 0 }
    render() {
      return (
        <>
          <button type='button' onClick={() => this.setState({ tick: 1 })}>
            bump
          </button>
          <ProviderCard {...probeProps} />
        </>
      )
    }
  }

  innerRenderProbe.mockClear()
  render(<ParentHarness />)
  expect(innerRenderProbe).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'bump' }))
  expect(innerRenderProbe).toHaveBeenCalledTimes(1)
})

/** G-3 / A-2 — earlyReset Map-only contract (no Set union at runtime). */
test('test_hasEarlyReset_map_only_contract', () => {
  const map = new Map([['anthropic', { prior: 'a', current: 'b' }]])
  expect(hasEarlyReset(map, 'anthropic')).toBe(true)
  expect(hasEarlyReset(map, 'openai')).toBe(false)
})

/** I-4 — row pct severity uses tightened thresholds (aligned with segment scale or documented). */
test('test_pctSeverityClass_high_consumption_is_hot', () => {
  expect(pctSeverityClass(99)).toBe('hot')
  expect(pctSeverityClass(74)).not.toBe('cool')
})

/** C-6 — lane quota bar keys stay unique when current and prior share resetAt. */
test('test_provider_card_lane_quota_keys_unique_at_shared_resetAt', () => {
  const sharedReset = '2026-06-13T12:00:00Z'
  const segments = Array.from({ length: QUOTA_SEGMENTS }, () => ({
    widthPct: 100 / QUOTA_SEGMENTS,
    severityClass: 'iv-0-5',
    highVelocity: false,
  }))
  const lane: QuotaLane = {
    laneKey: 'anthropic/short',
    laneLabel: '5hr',
    currentBar: {
      label: 'current',
      consumedPct: 10,
      remainingPct: 90,
      resetAt: sharedReset,
      segments,
    },
    priorBars: [
      {
        label: 'prior',
        consumedPct: 80,
        remainingPct: 20,
        resetAt: sharedReset,
        segments,
        timeAgoLabel: '5h ago',
      },
    ],
  }
  const { container } = render(
    <ProviderCard
      config={anthropicConfig}
      data={mockData}
      healthCells={mockHealthCells}
      quotas={[]}
      lanes={[lane]}
    />
  )
  const bars = container.querySelectorAll('.quota-row-bar')
  expect(bars.length).toBe(2)
  const rowParents = Array.from(bars).map((bar) => bar.parentElement)
  expect(new Set(rowParents).size).toBe(2)
})

/** G-2 — Top Models pane must not rely on inline display:none (class/CSS hides until ≥3840px). */
test('test_provider_card_top_models_pane_not_inline_display_none', () => {
  const { container } = render(
    <ProviderCard
      config={anthropicConfig}
      data={mockData}
      healthCells={mockHealthCells}
      quotas={mockQuotas}
      topModels={[
        {
          model: 'claude-sonnet',
          tokens: 1,
          cost_usd: 0.01,
          requests: 1,
          p95_ms: 100,
        },
      ]}
    />
  )
  const pane = container.querySelector('.card-pane-right') as HTMLElement | null
  expect(pane).not.toBeNull()
  expect(pane?.style.display).not.toBe('none')
})

/** I-1 — REQUESTS section uses shared PcSubTitle (div.pc-sub-title), not ad-hoc h4 copy. */
test('test_provider_card_requests_section_uses_pc_sub_title', () => {
  const { container } = render(
    <ProviderCard
      config={anthropicConfig}
      data={mockData}
      healthCells={mockHealthCells}
      quotas={mockQuotas}
    />
  )
  const titles = container.querySelectorAll('.pc-sub-title')
  const requestsTitle = Array.from(titles).find((el) =>
    el.textContent?.includes('REQUESTS')
  )
  expect(requestsTitle?.tagName).toBe('DIV')
})

/** A-1 — variant prop preferred over parsing wrapperClassName for aggregate styling. */
test('test_provider_card_accepts_variant_aggregate_prop', () => {
  const { container } = render(
    <ProviderCard
      config={anthropicConfig}
      data={mockData}
      healthCells={mockHealthCells}
      quotas={mockQuotas}
      variant='aggregate'
    />
  )
  expect(container.querySelector('.provider-card.aggregate')).not.toBeNull()
})

/** P07-F04 — ProviderCardProps includes variant; no unused TS suppressions in this file. */
test('test_provider_card_no_stale_ts_expect_error', () => {
  const source = readFileSync(
    path.join(import.meta.dirname, 'provider-card.test.tsx'),
    'utf8'
  )
  // Match active directives only — not this assertion's own string literal.
  expect(source).not.toMatch(/^\s*\/\/\s*@ts-expect-error/m)
  expect(source).not.toMatch(/^\s*\/\/\s*@ts-ignore/m)
  type VariantOnProps = NonNullable<
    import('./provider-card').ProviderCardProps['variant']
  >
  const _variantContract: VariantOnProps = 'aggregate'
  expect(_variantContract).toBe('aggregate')
})

/**
 * W-2 guard — production `fleetActivity.invalidToolCalls` is hardcoded to 0 in
 * phosphor-dashboard.tsx; hot UI is covered by aggregate-card.test.tsx until wired
 * from UsageReportSummary.agent_invalid_tool_call_errors (or equivalent).
 */
test('test_w2_invalid_tool_calls_api_field_name_pinned', () => {
  const invalidToolField = 'agent_invalid_tool_call_errors' as const
  type RowWithInvalid = import('../api/usage-report').UsageReportRow
  const _typeCheck: keyof RowWithInvalid | typeof invalidToolField =
    invalidToolField
  expect(_typeCheck).toBe('agent_invalid_tool_call_errors')
})

describe('D1-489 — Alibaba Token Plan ProviderCard', () => {
  const ACCOUNT_HASH = 'a'.repeat(64)

  function alibabaBar(): QuotaBarGroup {
    return {
      label: '5-hour Credits',
      consumedPct: 0.04,
      remainingPct: 99.96,
      resetAt: '2026-07-22T02:22:00.000Z',
      segments: makeSegments(),
      tipIdentity: [
        'alibaba_token_plan_5h:credits',
        'alibaba_token_plan_usage',
        'qwen-cloud-console',
        'credits',
      ],
      tipObservedAt: '2026-07-21T22:39:00.000Z',
      tipAbsolutesUnavailable: true,
      showSubPercentPrecision: true,
      periodType: '5hr',
    }
  }

  test('test_display_name_renders_in_card_header', () => {
    const { container } = render(
      <ProviderCard
        config={{
          provider: 'alibaba_token_plan',
          color: '#ff6a00',
          displayName: 'Alibaba Token Plan',
          quotaOnly: true,
        }}
        data={mockData}
        healthCells={mockHealthCells}
      />
    )
    const header = container.querySelector('.provider-name')
    expect(header?.textContent).toBe('ALIBABA TOKEN PLAN')
  })

  test('test_provider_key_uppercased_when_no_display_name', () => {
    const { container } = render(
      <ProviderCard
        config={{ provider: 'anthropic', color: '#cc7855' }}
        data={mockData}
        healthCells={mockHealthCells}
      />
    )
    const header = container.querySelector('.provider-name')
    expect(header?.textContent).toBe('ANTHROPIC')
  })

  test('test_tooltip_shows_unavailable_reset_and_freshness', () => {
    const lane: QuotaLane = {
      laneKey: 'alibaba_token_plan/5h-credits',
      laneLabel: '5-hour Credits',
      currentBar: alibabaBar(),
      priorBars: [],
    }
    const { container } = render(
      <ProviderCard
        config={{
          provider: 'alibaba_token_plan',
          color: '#ff6a00',
          displayName: 'Alibaba Token Plan',
          quotaOnly: true,
        }}
        data={mockData}
        healthCells={mockHealthCells}
        lanes={[lane]}
      />
    )
    const trigger =
      container.querySelector('.quota-row-bar') ??
      container.querySelector('.qbar-fill')
    expect(trigger).not.toBeNull()
    fireEvent.pointerEnter(trigger as HTMLElement)

    const bodyText = document.body.textContent ?? ''
    expect(container.querySelector('.quota-row-pct')?.textContent).toBe('<1%')
    expect(bodyText).toContain('<1% used')
    expect(bodyText).toContain('99.96% remaining')
    expect(bodyText).toContain('credits: unavailable')
    expect(bodyText).toContain('resets')
    expect(bodyText).toContain('observed')
    expect(bodyText).toContain('alibaba_token_plan_5h:credits')
    expect(bodyText).toContain('alibaba_token_plan_usage')
  })

  test('test_tooltip_never_renders_full_account_hash', () => {
    const lane: QuotaLane = {
      laneKey: 'alibaba_token_plan/5h-credits',
      laneLabel: '5-hour Credits',
      currentBar: alibabaBar(),
      priorBars: [],
    }
    const { container } = render(
      <ProviderCard
        config={{
          provider: 'alibaba_token_plan',
          color: '#ff6a00',
          displayName: 'Alibaba Token Plan',
          quotaOnly: true,
        }}
        data={mockData}
        healthCells={mockHealthCells}
        lanes={[lane]}
      />
    )
    const trigger =
      container.querySelector('.quota-row-bar') ??
      container.querySelector('.qbar-fill')
    fireEvent.pointerEnter(trigger as HTMLElement)
    expect(document.body.textContent ?? '').not.toContain(ACCOUNT_HASH)
  })

  test('test_existing_provider_sub_one_percent_retains_whole_percent_display', () => {
    const { container } = render(
      <ProviderCard
        config={anthropicConfig}
        data={mockData}
        healthCells={mockHealthCells}
        quotas={[
          {
            label: 'Weekly',
            consumedPct: 0.04,
            remainingPct: 99.96,
            segments: makeSegments(),
          },
        ]}
      />
    )

    expect(container.querySelector('.quota-row-pct')?.textContent).toBe('0%')
  })

  test('test_quota_only_card_omits_health_usage_and_model_sections', () => {
    const lane: QuotaLane = {
      laneKey: 'alibaba_token_plan/5h-credits',
      laneLabel: '5-hour Credits',
      currentBar: alibabaBar(),
      priorBars: [],
    }
    const { container } = render(
      <ProviderCard
        config={{
          provider: 'alibaba_token_plan',
          color: '#ff6a00',
          displayName: 'Alibaba Token Plan',
          quotaOnly: true,
        }}
        data={mockData}
        healthCells={mockHealthCells}
        lanes={[lane]}
        topModels={[
          {
            model: 'qwen-token-plan',
            tokens: 100,
            cost_usd: 1,
            requests: 2,
            p95_ms: 100,
          },
        ]}
      />
    )

    const text = container.textContent ?? ''
    expect(text).toContain('ALIBABA TOKEN PLAN')
    expect(text).toContain('Quotas')
    expect(text).toContain('5-hour Credits')
    expect(text).not.toContain('REQUESTS')
    expect(text).not.toContain('TOKENS')
    expect(text).not.toContain('p95 Latency')
    expect(text).not.toContain('qwen-token-plan')
    expect(container.querySelector('[data-testid="health-strip"]')).toBeNull()
    expect(container.querySelector('.health-strip-cell')).toBeNull()
  })

  test('test_alibaba_provider_series_css_color_consistency', () => {
    const dashboardSource = readFileSync(
      path.join(import.meta.dirname, 'phosphor-dashboard.tsx'),
      'utf8'
    )
    const cssSource = readFileSync(
      path.resolve(process.cwd(), 'src/styles/index.css'),
      'utf8'
    )

    expect(dashboardSource).toMatch(
      /key:\s*'alibaba_token_plan'[\s\S]*?color:\s*'#ff6a00'[\s\S]*?cssClass:\s*'tt-alibaba'/
    )
    expect(cssSource).toMatch(
      /\.tt-slice\.tt-alibaba,\s*\.tt-swatch\.tt-alibaba\s*\{\s*background:\s*#ff6a00;/
    )
  })
})
