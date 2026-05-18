/**
 * Wave 4 — AggregateCard red-phase tests.
 *
 * Component path: src/features/dashboard/components/aggregate-card.tsx
 * Expected export: AggregateCard (named)
 * Extends ProviderCard with fleetActivity prop.
 *
 * All tests expected to FAIL (red) — source file does not exist yet.
 */
import { render, screen } from '@testing-library/react'
import { AggregateCard } from './aggregate-card'

// ---------------------------------------------------------------------------
// Fixtures (same as provider-card, plus fleetActivity)
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

const aggregateConfig = { provider: 'aggregate', color: '#3b82f6' }

const mockHealthCells = Array.from({ length: 288 }, () => ({
  color: 'var(--card-2)',
}))

const mockQuotas = Array.from({ length: 8 }, () => ({
  widthPct: 12.5,
  severityClass: 'iv-ok',
  highVelocity: false,
}))

const baseFleetActivity = {
  toolCalls: 42,
  gitCommits: 7,
  gitPushes: 3,
  invalidToolCalls: 0,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('test_aggregate_card_renders_fleet_activity_section', () => {
  render(
    <AggregateCard
      config={aggregateConfig}
      data={mockData}
      healthCells={mockHealthCells}
      quotas={mockQuotas}
      fleetActivity={baseFleetActivity}
    />
  )

  expect(screen.getByText('FLEET ACTIVITY')).toBeInTheDocument()

  // Use exact-match strings because "Tool Calls" is a substring of
  // "Invalid Tool Calls" — with semantic <dt> elements both would match a
  // /Tool Calls/i regex, causing getByText to throw "found multiple elements".
  const rowLabels = [
    'Tool Calls',
    'Git Commits',
    'Git Pushes',
    'Invalid Tool Calls',
  ]
  for (const label of rowLabels) {
    expect(screen.getByText(label, { exact: true })).toBeInTheDocument()
  }
})

test('test_aggregate_card_invalid_tool_calls_red', () => {
  const { container } = render(
    <AggregateCard
      config={aggregateConfig}
      data={mockData}
      healthCells={mockHealthCells}
      quotas={mockQuotas}
      fleetActivity={{ ...baseFleetActivity, invalidToolCalls: 5 }}
    />
  )

  // Find the cell rendering "5" in the invalid tool calls context
  // It should have a class or style indicating accent-hot color (#ef4444)
  const redEl =
    container.querySelector('.accent-hot') ??
    container.querySelector('.text-red') ??
    (() => {
      // Look for an element with inline color matching #ef4444
      const all = container.querySelectorAll('*')
      for (const el of Array.from(all)) {
        const style = (el as HTMLElement).style
        if (style.color === '#ef4444' || style.color === 'rgb(239, 68, 68)') {
          return el
        }
      }
      return null
    })()

  expect(redEl).not.toBeNull()
})

test('test_aggregate_card_pulse_dot_present_when_errors', () => {
  const { container } = render(
    <AggregateCard
      config={aggregateConfig}
      data={mockData}
      healthCells={mockHealthCells}
      quotas={mockQuotas}
      fleetActivity={{ ...baseFleetActivity, recentErrors: 3 }}
    />
  )

  const pulseDot = container.querySelector('.pulse-dot')
  expect(pulseDot).not.toBeNull()
})

test('test_aggregate_card_no_pulse_when_zero_errors', () => {
  const { container } = render(
    <AggregateCard
      config={aggregateConfig}
      data={mockData}
      healthCells={mockHealthCells}
      quotas={mockQuotas}
      fleetActivity={{ ...baseFleetActivity, recentErrors: 0 }}
    />
  )

  const pulseDot = container.querySelector('.pulse-dot')
  expect(pulseDot).toBeNull()
})
