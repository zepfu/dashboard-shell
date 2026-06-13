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
import type {
  UsageReportProviderLatencyHealthRow,
  UsageReportTokenTrendScoreRow,
} from '../api/usage-report'
import {
  buildTokenTrendDayEnvelopes,
  deriveTokenTrendActiveVersionLanes,
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

const trendHealthRows = [
  {
    bucket_start: '2026-05-20T08:00:00.000Z',
    environment: 'local',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    model_group: 'claude',
    requests: 5,
    passive_latency_sample_status: 'ok',
    upstream_p50_ms: 120,
    upstream_p95_ms: 240,
    upstream_p99_ms: 300,
    total_p95_ms: 260,
    proxy_processing_p95_ms: 20,
    missing_upstream_latency: 0,
    provider_error_events: 1,
    rate_limit_events: 2,
    capacity_events: 0,
    provider_5xx_events: 0,
    provider_timeout_events: 0,
    network_error_events: 0,
    auth_failed_events: 0,
    adapter_error_events: 0,
    status_probe_count: 1,
    status_probe_success_pct: 100,
    status_probe_p95_ms: 180,
    provider_ping_avg_ms: 30,
    provider_ping_packet_loss_pct: 0,
    control_ping_avg_ms: 20,
    control_packet_loss_pct: 0,
    control_probe_success_pct: 100,
    provider_ping_minus_control_ms: 10,
    dns_failures: 0,
    tcp_failures: 0,
    tls_failures: 0,
    icmp_failures: 0,
    probed_endpoints: null,
    status_error_classes: null,
    min_remaining_pct: null,
    max_remaining_pct: null,
    next_expected_reset_at: null,
    quota_keys: null,
    request_period_start: null,
    request_period_end: null,
  },
] as UsageReportProviderLatencyHealthRow[]

const trendScoreRows = [
  {
    bucket: '2026-05-20',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    repository: 'dashboard-shell',
    weekly_reset_first: null,
    weekly_reset_last: null,
    min_weekly_pct: null,
    max_weekly_pct: null,
    short_reset_first: null,
    short_reset_last: null,
    min_short_pct: null,
    max_short_pct: null,
    weekly_reset_special_first: null,
    weekly_reset_special_last: null,
    min_weekly_pct_special: null,
    max_weekly_pct_special: null,
    short_reset_special_first: null,
    short_reset_special_last: null,
    min_short_pct_special: null,
    max_short_pct_special: null,
    traces: 5,
    token_in: 10,
    token_out: 20,
    token_cache_input: 0,
    token_cache_creation: 0,
    reasoning_tokens_sources: null,
    token_reasoning_reported: 0,
    token_reasoning_estimated: 0,
    cache_attempted_summary: null,
    cache_miss_summary: null,
    cache_miss_reasons: null,
    token_cache_miss: null,
    token_total: 30,
    cache_miss_usd_cost: 0,
    usd_cost: 0,
    tool_calls: 1,
    git_commit: 0,
    git_push: 0,
    litellm_processing_total_ms: null,
    litellm_processing_average_ms: null,
    llm_upstream_elapsed_total_ms: null,
    llm_upstream_elapsed_average_ms: null,
    agent_score_rows: 5,
    agent_quality_score: 0.8,
    agent_quality_evaluated: 5,
    agent_quality_possible: 5,
    agent_quality_failures: 1,
    agent_instruction_score: 0.9,
    agent_instruction_evaluated: 5,
    agent_instruction_possible: 5,
    agent_instruction_failures: 0,
    agent_tool_score: 0.7,
    agent_tool_evaluated: 5,
    agent_tool_possible: 5,
    agent_tool_failures: 1,
    agent_contract_score: 0.6,
    agent_contract_evaluated: 5,
    agent_contract_possible: 5,
    agent_contract_failures: 2,
    agent_progress_score: 0.95,
    agent_progress_evaluated: 5,
    agent_progress_possible: 5,
    agent_progress_failures: 0,
    agent_risk_score: 0.2,
    agent_risk_evaluated: 5,
    agent_risk_possible: 5,
    agent_risk_events: 1,
    agent_ignored_path_tracking_policy_score: 1,
    agent_ignored_path_tracking_policy_evaluated: 5,
    agent_ignored_path_tracking_policy_possible: 5,
    agent_ignored_path_tracking_violation_count: 0,
    agent_baseline_deflection_attempted_score: 0,
    agent_baseline_deflection_attempted_evaluated: 5,
    agent_baseline_deflection_attempted_incidents: 0,
    agent_baseline_deflection_incident_score: 0,
    agent_baseline_deflection_incident_evaluated: 5,
    agent_baseline_deflection_incidents: 0,
    agent_sleep_wellness_interruption_attempted_score: 0,
    agent_sleep_wellness_interruption_attempted_evaluated: 5,
    agent_sleep_wellness_interruption_attempted_incidents: 0,
    agent_sleep_wellness_interruption_incident_score: 0,
    agent_sleep_wellness_interruption_incident_evaluated: 5,
    agent_sleep_wellness_interruption_incidents: 0,
    period_start: '2026-05-20',
    period_end: '2026-05-20',
  },
] as UsageReportTokenTrendScoreRow[]

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
  const dayShells = container.querySelectorAll('.tt-day-hover-shell')
  expect(dayShells[0]).toHaveClass('is-even')
  expect(dayShells[1]).toHaveClass('is-odd')
  expect(
    container.querySelectorAll('.tt-day-chart .tt-day-stripe')
  ).toHaveLength(2)
  expect(
    container.querySelector('.tt-day-chart .tt-day-stripe.is-even')
  ).not.toBeNull()
  expect(
    container.querySelector('.tt-day-chart .tt-day-stripe.is-odd')
  ).not.toBeNull()
  expect(container.querySelectorAll('.tt-day-tip-wrap').length).toBe(2)
  expect(container.querySelectorAll('.tt-hour-bar').length).toBe(48)
  expect(container.querySelectorAll('.tt-hour-tip-wrap').length).toBe(0)
  expect(container.querySelectorAll('.tt-token-scale-marker').length).toBe(4)
  expect(
    container.querySelector('.tt-day-envelope .tt-anthropic')
  ).not.toBeNull()
  expect(container.querySelector('.tt-day-envelope .tt-openai')).not.toBeNull()
})

test('test_day_envelope_mode_alternates_lower_lane_day_backgrounds', () => {
  const rows = [
    {
      day: '2026-05-20',
      hour: 8,
      provider: 'anthropic',
      traces: 4,
      token_total: 100,
      usd_cost: 0,
      tool_calls: 7,
    },
    {
      day: '2026-05-21',
      hour: 9,
      provider: 'openai',
      traces: 2,
      token_total: 50,
      usd_cost: 0,
      tool_calls: 3,
    },
  ]

  const { container } = render(
    <TokenTrendChart
      dayEnvelopes={buildTokenTrendDayEnvelopes(rows)}
      requestDayEnvelopes={buildTokenTrendDayEnvelopes(rows, 'requests')}
      toolDayEnvelopes={buildTokenTrendDayEnvelopes(rows, 'tools')}
      series={series}
    />
  )

  const activeLaneStripes = container.querySelectorAll(
    '.tt-active-version-lane .tt-day-stripe'
  )
  expect(activeLaneStripes).toHaveLength(2)
  expect(activeLaneStripes[0]).toHaveClass('is-even')
  expect(activeLaneStripes[1]).toHaveClass('is-odd')

  fireEvent.click(within(container).getByRole('tab', { name: 'Request' }))
  const requestDayShells = container.querySelectorAll(
    '.tt-metric-lane-requests .tt-metric-day-shell'
  )
  expect(requestDayShells).toHaveLength(2)
  expect(requestDayShells[0]).toHaveClass('is-even')
  expect(requestDayShells[1]).toHaveClass('is-odd')

  fireEvent.click(within(container).getByRole('tab', { name: 'Tool' }))
  const toolDayShells = container.querySelectorAll(
    '.tt-metric-lane-tools .tt-metric-day-shell'
  )
  expect(toolDayShells).toHaveLength(2)
  expect(toolDayShells[0]).toHaveClass('is-even')
  expect(toolDayShells[1]).toHaveClass('is-odd')
})

test('test_day_envelope_mode_renders_health_score_graph_above_token_chart', () => {
  const rows = [
    {
      day: '2026-05-20',
      hour: 8,
      provider: 'anthropic',
      traces: 4,
      token_total: 100,
      usd_cost: 0,
      tool_calls: 7,
    },
  ]

  const { container } = render(
    <TokenTrendChart
      dayEnvelopes={buildTokenTrendDayEnvelopes(rows)}
      series={series}
      healthRows={trendHealthRows}
      scoreRows={trendScoreRows}
    />
  )

  const signalPanel = container.querySelector('.tt-signal-panel')
  const tokenChart = container.querySelector('.tt-day-chart')
  expect(signalPanel).not.toBeNull()
  expect(tokenChart).not.toBeNull()
  expect(
    (signalPanel as HTMLElement).compareDocumentPosition(
      tokenChart as HTMLElement
    ) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  expect(
    within(container).getByRole('tab', { name: 'Health' })
  ).toHaveAttribute('aria-selected', 'true')
  expect(within(container).getByText('Req')).toBeInTheDocument()
  expect(within(container).getByText('Err')).toBeInTheDocument()
  expect(within(container).getByText('Prb')).toBeInTheDocument()
  expect(container.querySelector('.tt-signal-graph')).not.toBeNull()
  expect(container.querySelector('.tt-signal-day-envelope')).not.toBeNull()
  expect(container.querySelector('.tt-signal-hour-bar')).not.toBeNull()
  expect(container.querySelector('.tt-signal-slice')).not.toBeNull()
  expect(
    (container.querySelector('.tt-signal-day-envelope') as HTMLElement).style
      .height
  ).toMatch(/%$/)
  expect(
    (container.querySelector('.tt-signal-hour-bar') as HTMLElement).style.height
  ).toMatch(/%$/)

  fireEvent.click(within(container).getByRole('tab', { name: 'Score' }))

  expect(within(container).getByRole('tab', { name: 'Score' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  expect(within(container).getByText('Q')).toBeInTheDocument()
  expect(within(container).getByText('R')).toBeInTheDocument()
  expect(within(container).getByText('Ign')).toBeInTheDocument()
  expect(within(container).getByText('Base')).toBeInTheDocument()
  expect(within(container).getByText('SLP')).toBeInTheDocument()
})

test('test_day_envelope_mode_filters_health_score_graph_scope_and_metrics', () => {
  const rows = [
    {
      day: '2026-05-20',
      hour: 8,
      provider: 'anthropic',
      traces: 4,
      token_total: 100,
      usd_cost: 0,
      tool_calls: 7,
    },
  ]

  const { container } = render(
    <TokenTrendChart
      dayEnvelopes={buildTokenTrendDayEnvelopes(rows)}
      series={series}
      healthRows={trendHealthRows}
      scoreRows={trendScoreRows}
    />
  )

  const scopeTrigger = within(container).getByRole('button', {
    name: /Scope: All/i,
  })
  const scopeGroup = container.querySelector(
    '[aria-label="Trend scope options"]'
  ) as HTMLElement
  expect(scopeGroup).toHaveAttribute('hidden')
  expect(scopeTrigger).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(scopeTrigger)
  expect(scopeTrigger).toHaveAttribute('aria-expanded', 'true')
  expect(scopeGroup).not.toHaveAttribute('hidden')
  const scopeOptions = within(scopeGroup)
  fireEvent.click(scopeOptions.getByLabelText('All'))
  fireEvent.click(scopeOptions.getByLabelText('claude-sonnet-4-6'))
  expect(
    within(container).getByText(/Scope: claude-sonnet-4-6/i)
  ).toBeInTheDocument()

  const metricTrigger = within(container).getByRole('button', {
    name: /Metrics: All/i,
  })
  const metricGroup = container.querySelector(
    '[aria-label="Trend metric options"]'
  ) as HTMLElement
  expect(metricGroup).toHaveAttribute('hidden')
  expect(metricTrigger).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(metricTrigger)
  expect(metricTrigger).toHaveAttribute('aria-expanded', 'true')
  expect(scopeTrigger).toHaveAttribute('aria-expanded', 'false')
  expect(scopeGroup).toHaveAttribute('hidden')
  expect(metricGroup).not.toHaveAttribute('hidden')
  const metricOptions = within(metricGroup)
  fireEvent.click(metricOptions.getByLabelText('All'))
  expect(within(container).getByText('no selected metrics')).toBeInTheDocument()
  fireEvent.click(metricOptions.getByLabelText('Requests'))
  expect(within(container).getByText('Req')).toBeInTheDocument()
  expect(within(container).queryByText('Err')).toBeNull()
})

test('test_day_envelope_mode_renders_active_version_lane_without_usage_overlay', () => {
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
        {
          provider: 'anthropic',
          client_name: 'claude-code',
          client_version: '2.0.0',
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
        {
          provider: 'google',
          client_name: 'python-httpx',
          client_version: '0.28.1',
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
      modelFirstSeen={[
        {
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          first_seen_at: '2026-05-20T12:00:00.000Z',
          first_seen_day: '2026-05-20',
          first_seen_hour: 8,
          observations: 2,
          token_total: 210,
        },
        {
          provider: 'openai',
          model: 'gpt-5.5',
          first_seen_at: '2026-05-20T14:10:00.000Z',
          first_seen_day: '2026-05-20',
          first_seen_hour: 10,
          observations: 1,
          token_total: 100,
        },
      ]}
    />
  )

  const lane = container.querySelector('.tt-active-version-lane') as HTMLElement
  expect(lane).not.toBeNull()
  expect(lane.querySelectorAll('.tt-day-stripe')).toHaveLength(1)
  expect(within(lane).getByText('Claude')).toBeInTheDocument()
  expect(within(lane).getByText('Codex')).toBeInTheDocument()
  expect(within(lane).getByText('2.0.0')).toBeInTheDocument()
  expect(within(lane).getByText('0.120.0')).toBeInTheDocument()
  expect(within(lane).queryByText('0.28.1')).toBeNull()
  const familyRows = container.querySelectorAll('.tt-active-version-family')
  expect(familyRows).toHaveLength(4)
  expect((familyRows[0] as HTMLElement | undefined)?.style.borderTop).toBe(
    '0px'
  )
  expect((familyRows[1] as HTMLElement | undefined)?.style.borderTop).toContain(
    'color-mix'
  )
  expect(
    (familyRows[0] as HTMLElement | undefined)?.style.background
  ).toContain('color-mix')
  expect(
    (familyRows[1] as HTMLElement | undefined)?.style.background
  ).toContain('color-mix')
  expect(container.querySelectorAll('.tt-active-version-line').length).toBe(2)
  expect(
    container.querySelectorAll('.tt-active-version-release-dot').length
  ).toBe(2)
  expect(
    lane.querySelector('.tt-model-first-seen-column')
  ).not.toBeInTheDocument()
  const firstSeenColumns = container.querySelectorAll(
    '.tt-day-chart .tt-model-first-seen-column'
  )
  expect(firstSeenColumns).toHaveLength(1)
  expect(firstSeenColumns[0]).toHaveAttribute(
    'aria-label',
    expect.stringContaining('2 models first seen on 05/20')
  )
  expect(firstSeenColumns[0]).toHaveAttribute(
    'aria-label',
    expect.stringContaining('claude-sonnet-4-6')
  )
  expect(firstSeenColumns[0]).toHaveAttribute(
    'aria-label',
    expect.stringContaining('08:00 anthropic claude-sonnet-4-6')
  )
  expect(firstSeenColumns[0]).toHaveAttribute(
    'aria-label',
    expect.stringContaining('gpt-5.5')
  )
  expect(firstSeenColumns[0]).toHaveAttribute(
    'aria-label',
    expect.stringContaining('10:00 openai gpt-5.5')
  )
  expect((firstSeenColumns[0] as HTMLElement).style.position).toBe('absolute')
  expect((firstSeenColumns[0] as HTMLElement).style.top).toBe('0px')
  expect((firstSeenColumns[0] as HTMLElement).style.right).toBe('0px')
  expect((firstSeenColumns[0] as HTMLElement).style.bottom).toBe('0px')
  expect((firstSeenColumns[0] as HTMLElement).style.left).toBe('0px')
  expect(within(container).getByText('First seen model')).toBeInTheDocument()
  expect(container.querySelector('.tt-version-overlay')).toBeNull()
  expect(container.querySelector('.tt-version-line')).toBeNull()
  expect(container.querySelector('.tt-version-line-halo')).toBeNull()
})

test('test_day_envelope_mode_model_first_seen_marks_token_chart_not_versions_lane', () => {
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
      modelFirstSeen={[
        {
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          first_seen_at: '2026-05-20T12:00:00.000Z',
          first_seen_day: '2026-05-20',
          first_seen_hour: 8,
          observations: 2,
          token_total: 210,
        },
      ]}
    />
  )

  const tokenChartMarkers = container.querySelectorAll(
    '.tt-day-chart .tt-model-first-seen-column'
  )
  expect(tokenChartMarkers).toHaveLength(1)
  expect(tokenChartMarkers[0]).toHaveAttribute(
    'aria-label',
    expect.stringContaining('claude-sonnet-4-6')
  )
  expect(
    container.querySelector(
      '.tt-active-version-lane .tt-model-first-seen-column'
    )
  ).toBeNull()
  expect(within(container).getByText('no version data')).toBeInTheDocument()
  expect(within(container).getByText('First seen model')).toBeInTheDocument()
  expect(within(container).queryByText('Active version')).toBeNull()
})

test('test_day_envelope_mode_client_version_only_data_has_no_first_seen_model_legend', () => {
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
          last_seen_hour: 9,
          traces: 2,
          token_total: 150,
          usd_cost: 0,
        },
      ]}
    />
  )

  expect(
    container.querySelector('.tt-day-chart .tt-model-first-seen-column')
  ).toBeNull()
  expect(within(container).queryByText('First seen model')).toBeNull()
  expect(within(container).getByText('Active version')).toBeInTheDocument()
})

test('test_day_envelope_mode_lower_lane_tabs_switch_to_requests_and_tools', () => {
  const rows = [
    {
      day: '2026-05-20',
      hour: 8,
      provider: 'anthropic',
      traces: 4,
      token_total: 100,
      usd_cost: 0,
      tool_calls: 7,
    },
    {
      day: '2026-05-20',
      hour: 9,
      provider: 'openai',
      traces: 2,
      token_total: 50,
      usd_cost: 0,
      tool_calls: 3,
    },
  ]
  const dayEnvelopes = buildTokenTrendDayEnvelopes(rows)
  const requestDayEnvelopes = buildTokenTrendDayEnvelopes(rows, 'requests')
  const toolDayEnvelopes = buildTokenTrendDayEnvelopes(rows, 'tools')

  const { container } = render(
    <TokenTrendChart
      dayEnvelopes={dayEnvelopes}
      requestDayEnvelopes={requestDayEnvelopes}
      toolDayEnvelopes={toolDayEnvelopes}
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
          token_total: 150,
          usd_cost: 0,
        },
      ]}
    />
  )

  expect(container.querySelector('.tt-active-version-lane')).not.toBeNull()
  expect(
    container.querySelector('.tt-day-chart .tt-model-first-seen-column')
  ).toBeNull()
  expect(within(container).queryByText('First seen model')).toBeNull()
  expect(
    container.querySelector('.tt-chart-footer .tt-lower-tabs')
  ).not.toBeNull()
  expect(
    within(container).getByRole('tab', { name: 'Version' })
  ).toHaveAttribute('aria-selected', 'true')
  expect(
    Array.from(
      container.querySelectorAll('.tt-active-version-lane, .tt-chart-footer')
    )[0]
  ).toHaveClass('tt-active-version-lane')

  fireEvent.click(within(container).getByRole('tab', { name: 'Request' }))
  expect(container.querySelector('.tt-active-version-lane')).toBeNull()
  expect(container.querySelector('.tt-metric-lane-requests')).not.toBeNull()
  expect(
    container.querySelectorAll('.tt-metric-lane-requests .tt-day-stripe')
  ).toHaveLength(1)
  expect(container.querySelectorAll('.tt-metric-hour-bar')).toHaveLength(24)
  expect(container.querySelector('.tt-metric-scale-label')).toHaveTextContent(
    /req/i
  )
  const requestScaleMarker = container.querySelector(
    '.tt-metric-scale-marker'
  ) as HTMLElement
  expect(requestScaleMarker.style.top).toBe('25%')
  expect(requestScaleMarker.style.bottom).toBe('')
  expect(
    Array.from(
      container.querySelectorAll('.tt-metric-lane-requests, .tt-chart-footer')
    )[0]
  ).toHaveClass('tt-metric-lane-requests')

  fireEvent.click(within(container).getByRole('tab', { name: 'Tool' }))
  expect(container.querySelector('.tt-metric-lane-tools')).not.toBeNull()
  expect(container.querySelector('.tt-metric-lane-requests')).toBeNull()
  expect(
    container.querySelectorAll('.tt-metric-lane-tools .tt-day-stripe')
  ).toHaveLength(1)
  expect(container.querySelector('.tt-metric-scale-label')).toHaveTextContent(
    /tools/i
  )
  const toolScaleMarker = container.querySelector(
    '.tt-metric-scale-marker'
  ) as HTMLElement
  expect(toolScaleMarker.style.top).toBe('25%')
  expect(toolScaleMarker.style.bottom).toBe('')

  fireEvent.click(within(container).getByRole('tab', { name: 'Version' }))
  expect(container.querySelector('.tt-active-version-lane')).not.toBeNull()
})

test('test_day_envelope_mode_lower_lane_can_be_controlled', () => {
  const rows = [
    {
      day: '2026-05-20',
      hour: 8,
      provider: 'anthropic',
      traces: 4,
      token_total: 100,
      usd_cost: 0,
      tool_calls: 7,
    },
  ]
  const onLowerLaneModeChange = vi.fn()

  const { container } = render(
    <TokenTrendChart
      dayEnvelopes={buildTokenTrendDayEnvelopes(rows)}
      requestDayEnvelopes={buildTokenTrendDayEnvelopes(rows, 'requests')}
      toolDayEnvelopes={buildTokenTrendDayEnvelopes(rows, 'tools')}
      lowerLaneMode='requests'
      onLowerLaneModeChange={onLowerLaneModeChange}
      series={series}
    />
  )

  expect(container.querySelector('.tt-metric-lane-requests')).not.toBeNull()
  fireEvent.click(within(container).getByRole('tab', { name: 'Tool' }))

  expect(onLowerLaneModeChange).toHaveBeenCalledWith('tools')
  expect(container.querySelector('.tt-metric-lane-requests')).not.toBeNull()
  expect(container.querySelector('.tt-metric-lane-tools')).toBeNull()
})

test('test_day_envelope_mode_lower_lane_matches_token_chart_height', () => {
  const rows = [
    {
      day: '2026-05-20',
      hour: 8,
      provider: 'anthropic',
      traces: 4,
      token_total: 100,
      usd_cost: 0,
      tool_calls: 7,
    },
  ]
  const dayEnvelopes = buildTokenTrendDayEnvelopes(rows)
  const requestDayEnvelopes = buildTokenTrendDayEnvelopes(rows, 'requests')

  const { container } = render(
    <TokenTrendChart
      dayEnvelopes={dayEnvelopes}
      requestDayEnvelopes={requestDayEnvelopes}
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
    />
  )

  const tokenChart = container.querySelector('.tt-day-chart') as HTMLElement
  const tuiLane = container.querySelector(
    '.tt-active-version-lane'
  ) as HTMLElement
  expect(tuiLane.style.height).toBe(tokenChart.style.height)

  fireEvent.click(within(container).getByRole('tab', { name: 'Request' }))
  const requestLane = container.querySelector(
    '.tt-metric-lane-requests'
  ) as HTMLElement
  expect(requestLane.style.height).toBe(tokenChart.style.height)
  expect(container.querySelector('.tt-chart-footer')).not.toBeNull()
})

test('test_day_envelope_mode_renders_tiny_version_labels_under_segment', () => {
  const dayEnvelopes = buildTokenTrendDayEnvelopes(
    Array.from({ length: 30 }, (_, index) => ({
      day: `2026-05-${(index + 1).toString().padStart(2, '0')}`,
      hour: 8,
      provider: 'xai',
      traces: 1,
      token_total: 100,
      usd_cost: 0,
    }))
  )

  const { container } = render(
    <TokenTrendChart
      dayEnvelopes={dayEnvelopes}
      series={series}
      versionIntervals={[
        {
          provider: 'xai',
          client_name: 'xai-cli',
          client_version: '0.0.0',
          first_seen_at: '2026-05-01T12:00:00.000Z',
          last_seen_at: '2026-05-01T12:10:00.000Z',
          first_seen_day: '2026-05-01',
          first_seen_hour: 8,
          last_seen_day: '2026-05-01',
          last_seen_hour: 8,
          traces: 1,
          token_total: 100,
          usd_cost: 0,
        },
      ]}
    />
  )

  const underLabel = container.querySelector(
    '.tt-active-version-segment-label.is-under'
  ) as HTMLElement
  expect(underLabel).not.toBeNull()
  expect(underLabel.textContent).toBe('xai-cli')
  expect(underLabel.style.transform).toBe('translateX(-50%)')
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
  expect(chart.style.height).toBe('224px')
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

test('test_day_envelope_tooltip_separates_models_from_client_versions', () => {
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
      modelFirstSeen={[
        {
          provider: 'openai',
          model: 'gpt-5.5',
          first_seen_at: '2026-05-20T12:00:00.000Z',
          first_seen_day: '2026-05-20',
          first_seen_hour: 8,
          observations: 1,
          token_total: 100,
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
  expect(openTip.textContent).toContain('models first seen')
  expect(openTip.textContent).toContain('gpt-5.5')
  expect(openTip.textContent).toContain('client versions first seen')
  expect(openTip.textContent).toContain('codex-tui 0.120.0')
  expect(openTip.textContent).not.toContain('active versions')
  expect(openTip.textContent).not.toContain('releases')
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

// ---------------------------------------------------------------------------
// Wave 3 (adversarial-review-20260612) — FAILING tests, W3 engineer to fix
// ---------------------------------------------------------------------------

/**
 * S3-2 — Missing days collapse the time axis and drop version intervals.
 *
 * `buildTokenTrendDayEnvelopes` currently only creates envelopes for days that
 * have ≥1 row with `metricValue > 0`. An idle middle day is simply absent from
 * the output, so the version lane's `versionHourIndex` drops any interval
 * whose first_seen_day / last_seen_day falls on that idle day.
 *
 * Fix requires: `buildTokenTrendDayEnvelopes` to accept options `{ from, to }`
 * and pad empty envelopes for every calendar day in that range. When the
 * engineer adds that overload, this test asserts:
 *   1. Output includes an envelope for the idle middle day (total === 0).
 *   2. A version interval spanning the idle day survives `deriveTokenTrendActiveVersionLanes`.
 *
 * EXPORTS NEEDED from trend-utils.ts:
 *   - `buildTokenTrendDayEnvelopes(rows, metric, opts?: { from?: string; to?: string })`
 *   - `deriveTokenTrendActiveVersionLanes` (already exported)
 */
test('test_day_envelopes_padded_over_full_range', () => {
  // Data for day 1 (2026-05-20) and day 3 (2026-05-22) only — day 2 (05-21) is idle.
  const rows = [
    {
      day: '2026-05-20',
      hour: 8,
      provider: 'anthropic',
      traces: 5,
      token_total: 500,
      usd_cost: 0,
    },
    {
      day: '2026-05-22',
      hour: 10,
      provider: 'openai',
      traces: 3,
      token_total: 300,
      usd_cost: 0,
    },
  ]

  // Engineer must add the third `options` param for range-padding.
  // Until then, this call will throw or return only 2 envelopes → test FAILS.
  const envelopes = buildTokenTrendDayEnvelopes(rows, 'tokens', {
    from: '2026-05-20',
    to: '2026-05-22',
  } as Parameters<typeof buildTokenTrendDayEnvelopes>[2])

  // Assertion 1: idle middle day must exist.
  expect(envelopes).toHaveLength(3)
  const idleDay = envelopes.find((e) => e.day === '2026-05-21')
  expect(idleDay).not.toBeUndefined()
  expect(idleDay?.total).toBe(0)

  // Assertion 2: interval spanning the idle day is NOT dropped.
  const interval = {
    provider: 'anthropic',
    client_name: 'claude-code',
    client_version: '2.0.0',
    first_seen_at: '2026-05-20T08:00:00.000Z',
    last_seen_at: '2026-05-22T10:00:00.000Z',
    first_seen_day: '2026-05-20',
    last_seen_day: '2026-05-22',
    first_seen_hour: 8,
    last_seen_hour: 10,
    traces: 10,
    token_total: 800,
    usd_cost: 0,
  }
  const lanes = deriveTokenTrendActiveVersionLanes(envelopes, [interval])
  const claudeLane = lanes.find((l) => l.key === 'claude')
  // The interval must appear as a segment — not dropped because day 2 is now present.
  expect(claudeLane?.segments.length).toBeGreaterThan(0)
})

/**
 * S3-4 — Token-scale tick gridlines are linear but bar heights are floored.
 *
 * `buildTokenScaleTicks` places gridlines at 25/50/75/100% of `maxDayTotal`
 * with labeled token values. But `tokenTrendDayHeightPct` floors non-zero days
 * at 8% (and hour bars at 4%). A day at 0.5% of max renders at the 8% floor
 * position — which reads ~16× too tall against the labeled axis.
 *
 * After the fix the floor and tick labels must be reconciled:
 *   - Either tick labels reflect the floor-distorted scale, or
 *   - Gridlines are not drawn in the floor-distorted region.
 *
 * EXPORTS NEEDED from token-trend-chart.tsx:
 *   - `buildTokenScaleTicks(maxValue: number): TokenScaleTick[]`
 *
 * This test FAILS until `buildTokenScaleTicks` is exported AND the floor/tick
 * mismatch is corrected (ratio < 4× at the nearest labeled tick).
 */
test('test_token_scale_ticks_match_bar_heights', async () => {
  const { buildTokenScaleTicks } = await import('./token-trend-chart')
  const { tokenTrendDayHeightPct } = await import('../lib/trend-utils')

  const maxDayTotal = 100_000
  // Small day: 0.5% of max = 500 tokens
  const smallDayTotal = 500

  const ticks = buildTokenScaleTicks(maxDayTotal)
  expect(ticks.length).toBeGreaterThan(0)

  // Rendered height % for the small day (after any floor applied by the fix).
  const renderedPct = tokenTrendDayHeightPct(smallDayTotal, maxDayTotal)

  // Find the nearest labeled tick at or above the rendered height.
  const nearestTick = ticks.find((t) => t.pct >= renderedPct)

  if (nearestTick !== undefined) {
    // The labeled value at the nearest tick must not overstate the actual day value
    // by more than 4×. Before the fix: implied ~25 000 vs actual 500 → 50× overstatement.
    const impliedTokens = nearestTick.value
    const ratio = impliedTokens / smallDayTotal
    expect(ratio).toBeLessThan(4)
  }
  // If no tick sits at/above the bar, the floor is correctly below all gridlines — also valid.
})

/**
 * S3-5 — `onHourHover` always reports the day's argmax hour, not the hovered one.
 *
 * The `dayShell` `onPointerEnter` fires with the day's peak-volume hour regardless
 * of which hour the pointer entered. A two-hour fixture proves the callback
 * cannot distinguish hovered position from argmax.
 *
 * After the fix:
 *   (a) The handler fires at hour-bar granularity, reporting the actual hovered
 *       hour (not the argmax), OR
 *   (b) The prop is renamed `onDayHover({ day, peakHour })` so the argmax
 *       contract is explicit rather than surprising.
 *
 * This test FAILS because the current code always emits argmax (hour 16) even
 * when the pointer is notionally over hour 6 (day-shell granularity cannot
 * distinguish them — the fact that only one call is fired for the whole day
 * prevents the consumer from inferring the actual hovered hour).
 */
test('test_onHourHover_reports_or_renamed', () => {
  // Two hours: hour 6 (smaller) and hour 16 (argmax at 900 tokens).
  const rows = [
    {
      day: '2026-05-20',
      hour: 6,
      provider: 'anthropic',
      traces: 1,
      token_total: 100, // not the argmax
      usd_cost: 0,
    },
    {
      day: '2026-05-20',
      hour: 16,
      provider: 'anthropic',
      traces: 1,
      token_total: 900, // argmax
      usd_cost: 0,
    },
  ]
  const envelopes = buildTokenTrendDayEnvelopes(rows)

  const calls: Array<{ day: string; hour: number }> = []
  const onHoverSpy = vi.fn((arg: { day: string; hour: number }) => {
    calls.push(arg)
  })

  const { container } = render(
    <TokenTrendChart
      series={series}
      dayEnvelopes={envelopes}
      onHourHover={onHoverSpy}
    />
  )

  // Hover the hour-6 bar specifically (not just the day shell).
  const hourBars = container.querySelectorAll('[data-hour]')
  const hour6Bar = Array.from(hourBars).find(
    (el) =>
      el.getAttribute('data-hour') === '6' &&
      el.getAttribute('data-day') === '2026-05-20'
  ) as HTMLElement | undefined

  if (hour6Bar !== undefined) {
    // If hour bars have individual pointer events, enter the hour-6 bar.
    fireEvent.pointerEnter(hour6Bar)
  } else {
    // Fallback: enter the day shell (which exposes the current coarse behavior).
    const dayShells = container.querySelectorAll('.tt-day-hover-shell')
    const shell = Array.from(dayShells).find(
      (el) => el.getAttribute('data-day') === '2026-05-20'
    ) as HTMLElement | undefined
    expect(shell).not.toBeUndefined()
    fireEvent.pointerEnter(shell!)
  }

  expect(calls.length).toBeGreaterThan(0)
  expect(calls[0]?.day).toBe('2026-05-20')

  // After the fix: hovering hour 6 must NOT report hour 16 (the argmax).
  // Before the fix: hour-6 hover reports hour 16 → this assertion FAILS.
  // If the prop is renamed to onDayHover, the test fails at the prop level → also correct.
  if (hour6Bar !== undefined) {
    // Hour-bar-level hover: must report hour 6.
    expect(calls[0]?.hour).toBe(6)
  } else {
    // Day-shell-level hover: currently reports argmax (16).
    // This branch documents the bug: reported hour == argmax, not user's position.
    // The test FAILS here because the consumer cannot distinguish 6 from 16.
    expect(calls[0]?.hour).toBe(6) // FAILS: currently emits 16 (argmax)
  }
})

/**
 * S3-6 — Version-lane first-lane chrome hard-codes `lane.key === 'claude'`.
 *
 * `separatorHeight`, `marginTop`, and `borderTop` all special-case the string
 * `'claude'` to mean "first lane" (token-trend-chart.tsx:1400,1417,1421).
 * Reordering `TOKEN_TREND_ACTIVE_VERSION_FAMILIES` would give the new first
 * family a stray separator while claude loses its zero-separator.
 *
 * After fix: `laneIndex === 0` must determine the first-lane treatment, not the key.
 *
 * This test pins the bug by verifying the SOURCE of the `borderTop` CSS value:
 * when claude is the SECOND rendered family (codex is first because codex appears
 * before claude in the DOM via the `data-family` attribute order), claude must NOT
 * still receive the zero-separator treatment.
 *
 * IMPLEMENTATION NOTE: Since `TOKEN_TREND_ACTIVE_VERSION_FAMILIES` is not
 * exported, we verify the fix via the DOM: the rendered family element whose
 * aria-label / data attribute indicates it is the non-first family must have a
 * non-zero `borderTop`. With the current `lane.key === 'claude'` bug, the claude
 * family ALWAYS has `borderTop: '0'` even when it's the second lane — that's the
 * assertion that fails.
 */
test('test_version_lane_first_lane_by_index', () => {
  const rows = [
    {
      day: '2026-05-20',
      hour: 8,
      provider: 'anthropic',
      traces: 5,
      token_total: 500,
      usd_cost: 0,
    },
  ]
  const envelopes = buildTokenTrendDayEnvelopes(rows)

  // Provide only a codex interval (no claude). Only the codex lane renders.
  // codex is the SECOND family in TOKEN_TREND_ACTIVE_VERSION_FAMILIES (after claude).
  // When claude has no data, codex is the only rendered lane AND it is index 0 (first).
  // Before fix: codex gets `borderTop: '1px solid ...'` (separator) because
  //   `lane.key === 'claude'` is false → it thinks codex is NOT first.
  // After fix: `laneIndex === 0` → codex gets no separator as the first (only) lane.
  const codexOnlyIntervals = [
    {
      provider: 'openai',
      client_name: 'Codex CLI',
      client_version: '1.0.0',
      first_seen_at: '2026-05-20T06:00:00.000Z',
      last_seen_at: '2026-05-20T10:00:00.000Z',
      first_seen_day: '2026-05-20',
      last_seen_day: '2026-05-20',
      first_seen_hour: 6,
      last_seen_hour: 10,
      traces: 3,
      token_total: 300,
      usd_cost: 0,
    },
  ]

  const { container } = render(
    <TokenTrendChart
      series={series}
      dayEnvelopes={envelopes}
      versionIntervals={codexOnlyIntervals}
    />
  )

  const familyRows = container.querySelectorAll('.tt-active-version-family')
  // When only codex has data, only the codex lane should be visible (or at minimum one lane).
  const renderedFamilyRows = Array.from(familyRows).filter((el) => {
    const el_ = el as HTMLElement
    // Only count rows with visible content (height > 0 or not display:none).
    return el_.offsetHeight > 0 || el_.style.display !== 'none'
  })

  // At least one family row must render (codex).
  expect(renderedFamilyRows.length).toBeGreaterThan(0)

  // The first rendered family row (index 0) must have no top border separator.
  const firstRow = renderedFamilyRows[0] as HTMLElement
  const borderTop = firstRow.style.borderTop

  // After fix: laneIndex === 0 → borderTop is '0' or empty for the first lane.
  // Before fix: lane.key !== 'claude' → codex incorrectly gets a separator border
  //   even when it is the first (only) rendered lane.
  expect(
    borderTop === '0' ||
      borderTop === '' ||
      borderTop === '0px' ||
      borderTop === 'none'
  ).toBe(true) // FAILS before fix when codex is first lane (not claude)
})

/**
 * S3-8 — Latency P95 band must be request-weighted and must never mix
 * status-probe latency into the upstream-latency average.
 *
 * Current: `addSignalValue` passes weight=1 for every health row. A probe-only
 * row with `status_probe_p95_ms = 10ms` (no real traffic) contributes equally
 * to the average as a 100-request row with `upstream_p95_ms = 1000ms`, producing
 * a misleading ~505ms band value.
 *
 * After fix:
 *   - Latency is weighted by `requests`.
 *   - Probe-only rows (upstream_p95_ms === null && total_p95_ms === null) do NOT
 *     contribute to the latency metric.
 *
 * EXPORTS NEEDED from token-trend-chart.tsx:
 *   - `buildTrendSignalRows` (currently module-private)
 */
test('test_latency_band_weights_by_requests_and_excludes_probe', async () => {
  const { buildTrendSignalRows } = await import('./token-trend-chart')

  const makeHealthRow = (
    overrides: Partial<UsageReportProviderLatencyHealthRow>
  ): UsageReportProviderLatencyHealthRow => ({
    bucket_start: '2026-05-20T08:00:00.000Z',
    environment: 'local',
    provider: 'anthropic',
    model: 'claude-sonnet-4',
    model_group: 'claude',
    requests: 100,
    passive_latency_sample_status: 'ok',
    upstream_p50_ms: 500,
    upstream_p95_ms: 1000,
    upstream_p99_ms: 1200,
    total_p95_ms: 1050,
    proxy_processing_p95_ms: 50,
    missing_upstream_latency: 0,
    provider_error_events: 0,
    rate_limit_events: 0,
    capacity_events: 0,
    provider_5xx_events: 0,
    provider_timeout_events: 0,
    network_error_events: 0,
    auth_failed_events: 0,
    adapter_error_events: 0,
    status_probe_count: 0,
    status_probe_success_pct: 100,
    status_probe_p95_ms: null,
    provider_ping_avg_ms: null,
    provider_ping_packet_loss_pct: null,
    control_ping_avg_ms: null,
    control_packet_loss_pct: null,
    control_probe_success_pct: null,
    provider_ping_minus_control_ms: null,
    dns_failures: 0,
    tcp_failures: 0,
    tls_failures: 0,
    icmp_failures: 0,
    probed_endpoints: null,
    status_error_classes: null,
    min_remaining_pct: null,
    max_remaining_pct: null,
    next_expected_reset_at: null,
    quota_keys: null,
    request_period_start: null,
    request_period_end: null,
    ...overrides,
  })

  // Row A: 100 real requests, upstream latency 1000ms.
  const rowA = makeHealthRow({ requests: 100, upstream_p95_ms: 1000 })
  // Row B: 1 probe-only "request", NO upstream latency — only status_probe_p95_ms = 10ms.
  const rowB = makeHealthRow({
    requests: 1,
    upstream_p95_ms: null,
    total_p95_ms: null,
    status_probe_p95_ms: 10,
    model: 'probe-model',
  })

  const envelopes = buildTokenTrendDayEnvelopes([
    {
      day: '2026-05-20',
      hour: 8,
      provider: 'anthropic',
      traces: 100,
      token_total: 10_000,
      usd_cost: 0,
    },
  ])

  const { rows } = buildTrendSignalRows({
    mode: 'health',
    dayEnvelopes: envelopes,
    healthRows: [rowA, rowB],
    scoreRows: [],
    selectedScopeKeys: ['all'],
    selectedMetrics: [
      {
        key: 'latency',
        mode: 'health' as const,
        label: 'P95 latency',
        shortLabel: 'P95',
        color: '#a78bfa',
        kind: 'latency' as const,
      },
    ],
  })

  const latencyRow = rows.find((r) => r.metric.key === 'latency')
  expect(latencyRow).not.toBeUndefined()

  const dayGrid = latencyRow!.grid.get('2026-05-20')
  expect(dayGrid).not.toBeUndefined()

  const hourVal = dayGrid!.get(8)
  expect(hourVal).not.toBeUndefined()

  // After fix: probe latency (10ms) must NOT dilute the 1000ms high-load value.
  // Expected (request-weighted, probe excluded): ~1000ms (row A dominates at 100 req).
  // Before fix (weight=1 simple avg with probe fallback): ~(1000+10)/2 = 505ms.
  expect(hourVal!.value).toBeGreaterThan(800)
  expect(hourVal!.value).toBeLessThan(1100)
})

/**
 * S3-11 — Multiselect dropdowns don't close on outside click.
 *
 * `openSignalMenu` is cleared only by re-clicking the trigger or pressing Escape
 * in the trigger's keyDown handler. Clicking anywhere else on the dashboard
 * leaves the dropdown open over the chart.
 *
 * After fix: a pointerdown event outside `.tt-multiselect` must close the menu.
 */
test('test_multiselect_closes_on_outside_click', () => {
  const envelopes = buildTokenTrendDayEnvelopes([
    {
      day: '2026-05-20',
      hour: 8,
      provider: 'anthropic',
      traces: 5,
      token_total: 500,
      usd_cost: 0,
    },
  ])

  const { container } = render(
    <TokenTrendChart
      series={series}
      dayEnvelopes={envelopes}
      healthRows={[...trendHealthRows]}
    />
  )

  // Open the scope multiselect.
  const triggers = container.querySelectorAll('.tt-multiselect-trigger')
  expect(triggers.length).toBeGreaterThan(0)
  fireEvent.click(triggers[0] as HTMLElement)

  // Confirm it is open.
  const groups = container.querySelectorAll('[role="group"]')
  const openGroup = Array.from(groups).find((el) => !(el as HTMLElement).hidden)
  expect(openGroup).not.toBeUndefined()

  // Simulate a click outside by firing pointerdown on document.body.
  fireEvent.pointerDown(document.body)

  // After fix: group must be closed (hidden).
  const groupsAfter = container.querySelectorAll('[role="group"]')
  const stillOpen = Array.from(groupsAfter).find(
    (el) => !(el as HTMLElement).hidden
  )
  // This assertion FAILS before the outside-click handler is implemented.
  expect(stillOpen).toBeUndefined()
})

/**
 * S3-T1/S3-T2 — Wave-31 bar-height fix: zero coverage for the most
 * historically regressed behavior in this component.
 *
 * Before Wave-31 fix: all `.tt-day-envelope` had height:'100%', collapsing every
 * bar to the same height. After fix: height is `(day.total/maxDayTotal)*100%`
 * with a 6% floor for non-zero days and 0% for empty days.
 *
 * The existing `test_day_envelope_mode_renders_days_and_24_hour_bars_per_day`
 * asserts `toMatch(/%$/)` which also matches '0%' and 'NaN%'. This test asserts
 * a real numeric value.
 */
test('test_wave31_bar_height_proportional_to_day_total', () => {
  // Two days: 1000 tokens (max) and 10 tokens (1% of max → floored to ≥6%).
  const rows = [
    {
      day: '2026-05-20',
      hour: 12,
      provider: 'anthropic',
      traces: 100,
      token_total: 1000,
      usd_cost: 0,
    },
    {
      day: '2026-05-21',
      hour: 12,
      provider: 'openai',
      traces: 1,
      token_total: 10,
      usd_cost: 0,
    },
  ]
  const envelopes = buildTokenTrendDayEnvelopes(rows)

  const { container } = render(
    <TokenTrendChart series={series} dayEnvelopes={envelopes} />
  )

  const dayEnvEls = container.querySelectorAll('.tt-day-envelope')
  expect(dayEnvEls.length).toBe(2)

  const largePct = parseFloat((dayEnvEls[0] as HTMLElement).style.height)
  const smallPct = parseFloat((dayEnvEls[1] as HTMLElement).style.height)

  // Large day ≈ 100%.
  expect(largePct).toBeGreaterThan(90)
  // Small day: 1% of max → must NOT render at 100% (pre-Wave-31 bug).
  expect(smallPct).toBeLessThan(50)
  // And the values must not be NaN (toMatch(/%$/) wouldn't catch 'NaN%').
  expect(Number.isNaN(largePct)).toBe(false)
  expect(Number.isNaN(smallPct)).toBe(false)
})
