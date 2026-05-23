/**
 * Wave 5 — TokenTrendChart red-phase tests.
 *
 * Component path: src/features/dashboard/components/token-trend-chart.tsx
 * Expected export: TokenTrendChart (named)
 * Props: { data: TrendBucket[]; series: ProviderSeries[] }
 *
 * Wave 28-TrendVisual: added tests for Track B (hover tooltip) and
 * Track C (bucket label row). Updated test_legend_strip_renders_7_items
 * to scope label lookup to the legend container so that tooltip content
 * (which also renders provider names) does not cause false failures.
 */
import { render, fireEvent, within } from '@testing-library/react'
import { vi } from 'vitest'
import {
  buildTokenTrendDayEnvelopes,
  formatBucketLabel,
} from '../lib/trend-utils'
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

  // Verify provider labels are present within the legend container.
  // We scope to .tt-legend to avoid false failures from tooltip content that
  // also renders provider names (added in Wave 28-TrendVisual Track B).
  const legend = container.querySelector('.tt-legend') as HTMLElement
  expect(legend).not.toBeNull()

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
    expect(within(legend).getByText(label)).toBeInTheDocument()
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

// ---------------------------------------------------------------------------
// Wave 28-TrendVisual Track B — hover tooltip tests
// ---------------------------------------------------------------------------

test('test_tooltip_hidden_by_default', () => {
  render(<TokenTrendChart data={mock24Buckets} series={series} />)

  // All tooltip panels should start closed (data-state="closed" or class "hidden")
  const openTips = document.body.querySelectorAll('.v9-tip[data-state="open"]')
  expect(openTips.length).toBe(0)
})

test('test_tooltip_shows_on_bar_hover', () => {
  const { container } = render(
    <TokenTrendChart data={mock24Buckets} series={series} />
  )

  // Find a non-empty bar wrapper (HoverTooltip wraps non-empty bars)
  const tipWrap = container.querySelector('.tt-bar-tip-wrap') as HTMLElement
  expect(tipWrap).not.toBeNull()

  // Hover over the wrapper — HoverTooltip uses onPointerEnter
  fireEvent.pointerEnter(tipWrap)

  // Panel is portalled to document.body
  const tip = document.body.querySelector('.v9-tip') as HTMLElement
  expect(tip).not.toBeNull()
  expect(tip.dataset['state']).toBe('open')
})

test('test_tooltip_hides_on_mouse_leave', () => {
  const { container } = render(
    <TokenTrendChart data={mock24Buckets} series={series} />
  )

  const tipWrap = container.querySelector('.tt-bar-tip-wrap') as HTMLElement
  fireEvent.pointerEnter(tipWrap)
  fireEvent.pointerLeave(tipWrap)

  // Panel is portalled to document.body; it persists with data-state="closed"
  const tip = document.body.querySelector('.v9-tip') as HTMLElement
  expect(tip.dataset['state']).toBe('closed')
})

test('test_tooltip_shows_bucket_label_in_head', () => {
  const { container } = render(
    <TokenTrendChart data={mock24Buckets} series={series} />
  )

  // Hover the first tip wrap
  const tipWrap = container.querySelector('.tt-bar-tip-wrap') as HTMLElement
  fireEvent.pointerEnter(tipWrap)

  // The tooltip head should contain the bucket label; panel is portalled to document.body
  const head = document.body.querySelector('.v9-tip-head') as HTMLElement
  expect(head).not.toBeNull()
  // Bucket 0 label is "0h" (relative label, returned as-is)
  expect(head.textContent).toBe('0h')
})

test('test_tooltip_shows_provider_breakdown_sorted_desc', () => {
  const { container } = render(
    <TokenTrendChart data={mock24Buckets} series={series} />
  )

  const tipWrap = container.querySelector('.tt-bar-tip-wrap') as HTMLElement
  fireEvent.pointerEnter(tipWrap)

  // Tooltip rows should exist (one per provider with non-zero tokens); panel is portalled to document.body
  // Scope to the open panel to avoid counting rows from other (closed) portalled panels
  const openTip = document.body.querySelector(
    '.v9-tip[data-state="open"]'
  ) as HTMLElement
  expect(openTip).not.toBeNull()
  const rows = openTip.querySelectorAll('.v9-tip-row')
  // Bucket 0: anthropic=100, openai=50, google=25 → 3 rows
  expect(rows.length).toBe(3)

  // First row should be the highest token count (anthropic)
  const firstModel = rows[0]?.querySelector('.t-model')
  expect(firstModel?.textContent).toBe('Anthropic')
})

test('test_empty_bucket_has_no_tooltip_wrap', () => {
  // Create data with some empty buckets at the start (mimics normalizeTrendData padding)
  const dataWithPad = [
    { label: '5h', totals: {} },
    { label: '4h', totals: {} },
    { label: '3h', totals: { anthropic: 200, openai: 100 } },
    { label: '2h', totals: { anthropic: 300 } },
    { label: '1h', totals: { anthropic: 150 } },
    { label: '0h', totals: { anthropic: 50 } },
  ]

  const { container } = render(
    <TokenTrendChart data={dataWithPad} series={series} />
  )

  // Only non-empty bars get the .tt-bar-tip-wrap class
  const tipWraps = container.querySelectorAll('.tt-bar-tip-wrap')
  expect(tipWraps.length).toBe(4)
})

// ---------------------------------------------------------------------------
// Wave 28-TrendVisual Track C — bucket label row tests
// ---------------------------------------------------------------------------

test('test_label_row_renders', () => {
  const { container } = render(
    <TokenTrendChart data={mock24Buckets} series={series} />
  )

  const labelRow = container.querySelector('.tt-label-row') as HTMLElement
  expect(labelRow).not.toBeNull()
})

test('test_label_row_has_same_count_as_buckets', () => {
  const { container } = render(
    <TokenTrendChart data={mock24Buckets} series={series} />
  )

  const labelRow = container.querySelector('.tt-label-row') as HTMLElement
  // Each label div is a direct child of the label row
  const labels = labelRow.children
  expect(labels.length).toBe(24)
})

test('test_even_labels_visible_at_24_bars', () => {
  const { container } = render(
    <TokenTrendChart data={mock24Buckets} series={series} />
  )

  const labelRow = container.querySelector('.tt-label-row') as HTMLElement
  const labels = Array.from(labelRow.children) as HTMLElement[]

  // At 24 bars, even-indexed labels should be visible; odd-indexed hidden
  for (let i = 0; i < labels.length; i++) {
    const el = labels[i] as HTMLElement
    if (i % 2 === 0) {
      // Even indices: visible with actual label text
      expect(el.style.visibility).not.toBe('hidden')
    } else {
      // Odd indices: hidden placeholder
      expect(el.style.visibility).toBe('hidden')
    }
  }
})

test('test_iso_label_formatted_as_mmdd', () => {
  const isoData = [
    { label: '2026-05-19T00:00:00.000Z', totals: { anthropic: 100 } },
    { label: '2026-05-20T00:00:00.000Z', totals: { openai: 50 } },
  ]

  const { container } = render(
    <TokenTrendChart data={isoData} series={series} />
  )

  const labelRow = container.querySelector('.tt-label-row') as HTMLElement
  const labels = Array.from(labelRow.children) as HTMLElement[]

  // Both are visible (< 12 bars, no alternating skip)
  // But the first label may have 'hidden' visibility based on index parity:
  // With only 2 buckets, skipAlternate = false (< 12), so all show.
  // Check actual text content
  expect(labels[0]?.textContent?.trim()).toBe('05/19')
  expect(labels[1]?.textContent?.trim()).toBe('05/20')
})

test('test_relative_label_displayed_as_is', () => {
  const relData = [
    { label: '5h', totals: { anthropic: 100 } },
    { label: '4h', totals: { openai: 50 } },
  ]

  const { container } = render(
    <TokenTrendChart data={relData} series={series} />
  )

  const labelRow = container.querySelector('.tt-label-row') as HTMLElement
  const labels = Array.from(labelRow.children) as HTMLElement[]

  expect(labels[0]?.textContent?.trim()).toBe('5h')
  expect(labels[1]?.textContent?.trim()).toBe('4h')
})

// ---------------------------------------------------------------------------
// D1-019 — hourly day envelope mode
// ---------------------------------------------------------------------------

test('test_day_envelope_mode_renders_days_and_24_hour_bars_per_day', () => {
  const dayEnvelopes = buildTokenTrendDayEnvelopes([
    {
      day: '2026-05-20',
      hour: 8,
      provider: 'anthropic',
      traces: 1,
      token_total: 100,
      usd_cost: 0,
    },
    {
      day: '2026-05-21',
      hour: 9,
      provider: 'openai',
      traces: 1,
      token_total: 50,
      usd_cost: 0,
    },
  ])

  const { container } = render(
    <TokenTrendChart dayEnvelopes={dayEnvelopes} series={series} />
  )

  expect(container.querySelectorAll('.tt-day-envelope').length).toBe(2)
  expect(container.querySelectorAll('.tt-day-tip-wrap').length).toBe(2)
  expect(container.querySelectorAll('.tt-hour-bar').length).toBe(48)
  expect(container.querySelectorAll('.tt-hour-tip-wrap').length).toBe(0)
  expect(
    container.querySelector('.tt-day-envelope .tt-anthropic')
  ).not.toBeNull()
  expect(container.querySelector('.tt-day-envelope .tt-openai')).not.toBeNull()
})

test('test_day_envelope_mode_renders_release_dot_and_continuation_line', () => {
  const dayEnvelopes = buildTokenTrendDayEnvelopes([
    {
      day: '2026-05-20',
      hour: 8,
      provider: 'anthropic',
      traces: 1,
      token_total: 100,
      usd_cost: 0,
    },
    {
      day: '2026-05-20',
      hour: 9,
      provider: 'anthropic',
      traces: 1,
      token_total: 110,
      usd_cost: 0,
    },
  ])

  const { container } = render(
    <TokenTrendChart
      dayEnvelopes={dayEnvelopes}
      series={series}
      versionIntervals={[
        {
          provider: 'anthropic',
          client_name: 'codex-tui',
          client_version: '0.120.0',
          first_seen_at: '2026-05-20T12:00:00.000Z',
          last_seen_at: '2026-05-20T13:10:00.000Z',
          first_seen_day: '2026-05-20',
          first_seen_hour: 8,
          last_seen_day: '2026-05-20',
          last_seen_hour: 9,
          traces: 2,
          token_total: 210,
          usd_cost: 0,
        },
      ]}
    />
  )

  expect(container.querySelector('.tt-release-dot')).not.toBeNull()
  expect(container.querySelector('.tt-version-line')).not.toBeNull()
  expect(container.querySelector('.tt-version-line-halo')).not.toBeNull()
  const overlay = container.querySelector('.tt-version-overlay') as SVGElement
  expect(overlay.style.height).toBe('100%')
  expect(overlay.style.overflow).toBe('hidden')
  const versionLine = container.querySelector('.tt-version-line') as SVGElement
  const versionHalo = container.querySelector(
    '.tt-version-line-halo'
  ) as SVGElement
  expect(versionLine.getAttribute('stroke-width')).toBe('2')
  expect(versionHalo.getAttribute('stroke-width')).toBe('5')
})

test('test_day_envelope_mode_uses_taller_chart_for_dense_ranges', () => {
  const rows = Array.from({ length: 21 }, (_, index) => ({
    day: `2026-05-${(index + 1).toString().padStart(2, '0')}`,
    hour: 8,
    provider: 'anthropic',
    traces: 1,
    token_total: 100,
    usd_cost: 0,
  }))
  const dayEnvelopes = buildTokenTrendDayEnvelopes(rows)

  const { container } = render(
    <TokenTrendChart dayEnvelopes={dayEnvelopes} series={series} />
  )

  const chart = container.querySelector('.tt-day-chart') as HTMLElement
  expect(chart.style.height).toBe('248px')
})

test('test_day_envelope_mode_hover_requests_day_detail', () => {
  const onHourHover = vi.fn()
  const dayEnvelopes = buildTokenTrendDayEnvelopes([
    {
      day: '2026-05-20',
      hour: 8,
      provider: 'anthropic',
      traces: 1,
      token_total: 100,
      usd_cost: 0,
    },
  ])

  const { container } = render(
    <TokenTrendChart
      dayEnvelopes={dayEnvelopes}
      series={series}
      onHourHover={onHourHover}
    />
  )

  const dayHoverShell = container.querySelector(
    '.tt-day-hover-shell[data-day="2026-05-20"]'
  ) as HTMLElement
  expect(dayHoverShell).not.toBeNull()
  fireEvent.pointerEnter(dayHoverShell)

  expect(onHourHover).toHaveBeenCalledWith({ day: '2026-05-20', hour: 8 })
})

test('test_day_envelope_tooltip_prioritizes_releases_before_active_versions', () => {
  const dayEnvelopes = buildTokenTrendDayEnvelopes([
    {
      day: '2026-05-20',
      hour: 8,
      provider: 'anthropic',
      traces: 1,
      token_total: 100,
      usd_cost: 0,
    },
  ])

  const { container } = render(
    <TokenTrendChart
      dayEnvelopes={dayEnvelopes}
      series={series}
      versionIntervals={[
        {
          provider: 'anthropic',
          client_name: 'codex-tui',
          client_version: '0.120.0',
          first_seen_at: '2026-05-20T12:00:00.000Z',
          last_seen_at: '2026-05-20T13:10:00.000Z',
          first_seen_day: '2026-05-20',
          first_seen_hour: 8,
          last_seen_day: '2026-05-20',
          last_seen_hour: 8,
          traces: 1,
          token_total: 100,
          usd_cost: 0,
        },
      ]}
      dayDetail={{
        metadata: {
          date: '2026-05-20',
          from: '2026-05-20',
          to: '2026-05-21',
        },
        date: '2026-05-20',
        rows: [
          {
            day: '2026-05-20',
            hour: 8,
            provider: 'anthropic',
            client_name: 'claude-code',
            client_version: '2.0.0',
            first_seen_at: '2026-05-20T12:30:00.000Z',
            last_seen_at: '2026-05-20T12:31:00.000Z',
            traces: 1,
            token_total: 25,
            usd_cost: 0,
          },
        ],
      }}
    />
  )

  const tipWrap = container.querySelector('.tt-day-tip-wrap') as HTMLElement
  fireEvent.pointerEnter(tipWrap)

  const openTip = document.body.querySelector(
    '.v9-tip[data-state="open"]'
  ) as HTMLElement
  expect(openTip).not.toBeNull()
  expect(openTip.textContent).toContain('releases')
  expect(openTip.textContent).toContain('codex-tui 0.120.0')
  expect(openTip.textContent).not.toContain('active versions')
})

// ---------------------------------------------------------------------------
// Wave 28-TrendVisual — formatBucketLabel unit tests
// ---------------------------------------------------------------------------

test('test_formatBucketLabel_iso_date', () => {
  expect(formatBucketLabel('2026-05-19T00:00:00.000Z')).toBe('05/19')
  expect(formatBucketLabel('2026-01-01')).toBe('01/01')
  expect(formatBucketLabel('2026-12-31T23:59:59Z')).toBe('12/31')
})

test('test_formatBucketLabel_relative', () => {
  expect(formatBucketLabel('23h')).toBe('23h')
  expect(formatBucketLabel('0h')).toBe('0h')
  expect(formatBucketLabel('5h')).toBe('5h')
})
