/**
 * Wave 3 — QuotaIntervalBar red-phase tests.
 *
 * Component path: src/features/dashboard/components/primitives/quota-interval-bar.tsx
 * Expected export: QuotaIntervalBar (named)
 * Props: { intervals: { widthPct: number; severityClass: string; highVelocity: boolean }[]; projectionPct?: number; tooltipContent?: ReactNode }
 *
 * All tests expected to FAIL (red) — source file does not exist yet.
 */
import { render } from '@testing-library/react'
import { QuotaIntervalBar } from '../primitives/quota-interval-bar'

const makeIntervals = (count: number) =>
  Array.from({ length: count }, () => ({
    widthPct: 100 / count,
    severityClass: 'iv-ok',
    highVelocity: false,
  }))

test('test_quota_interval_bar_renders_n_intervals', () => {
  const { container } = render(
    <QuotaIntervalBar intervals={makeIntervals(8)} />
  )

  // Should render 8 interval elements
  const intervals =
    container.querySelectorAll('.quota-interval').length > 0
      ? container.querySelectorAll('.quota-interval')
      : container.querySelectorAll('[data-testid="quota-interval"]')

  expect(intervals.length).toBe(8)
})

test('test_quota_interval_bar_high_velocity_class', () => {
  const intervals = [
    { widthPct: 50, severityClass: 'iv-warning', highVelocity: true },
    { widthPct: 50, severityClass: 'iv-ok', highVelocity: false },
  ]
  const { container } = render(<QuotaIntervalBar intervals={intervals} />)

  // The high-velocity interval should have the class or data attribute
  const highVelEl =
    container.querySelector('.high-velocity') ??
    container.querySelector('[data-high-velocity="true"]')

  expect(highVelEl).not.toBeNull()
})

test('test_quota_interval_bar_projection_tick_position', () => {
  const { container } = render(
    <QuotaIntervalBar intervals={makeIntervals(4)} projectionPct={65} />
  )

  const projectionEl =
    container.querySelector('.qbar-projection') ??
    container.querySelector('[data-testid="projection-tick"]')

  expect(projectionEl).not.toBeNull()

  const leftStyle = (projectionEl as HTMLElement).style.left
  expect(leftStyle).toBe('65%')
})

test('test_quota_interval_bar_no_projection_when_omitted', () => {
  const { container } = render(
    <QuotaIntervalBar intervals={makeIntervals(4)} />
  )

  const projectionEl =
    container.querySelector('.qbar-projection') ??
    container.querySelector('[data-testid="projection-tick"]')

  expect(projectionEl).toBeNull()
})
