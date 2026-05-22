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
import {
  QuotaIntervalBar,
  type QuotaInterval,
} from '../primitives/quota-interval-bar'

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

  // Adjacent identical logical buckets are rendered as one visual run.
  const intervals =
    container.querySelectorAll('.quota-interval').length > 0
      ? container.querySelectorAll('.quota-interval')
      : container.querySelectorAll('[data-testid="quota-interval"]')

  expect(intervals.length).toBe(1)
  const mergedRun = intervals[0] as HTMLElement
  expect(mergedRun.style.width).toBe('100%')
  expect(mergedRun.style.flex).toBe('0 0 100%')
})

test('test_quota_interval_bar_high_velocity_class', () => {
  const intervals = [
    {
      widthPct: 50,
      severityClass: 'iv-warning',
      highVelocity: true,
      velocityClass: 'velocity-fast',
    },
    { widthPct: 50, severityClass: 'iv-ok', highVelocity: false },
  ]
  const { container } = render(<QuotaIntervalBar intervals={intervals} />)

  // The high-velocity interval should have the class or data attribute
  const highVelEl =
    container.querySelector('.high-velocity') ??
    container.querySelector('[data-high-velocity="true"]')

  expect(highVelEl).not.toBeNull()
})

test('test_quota_interval_bar_only_fast_hot_peak_velocity_tiers_animate', () => {
  const intervals: QuotaInterval[] = [
    {
      widthPct: 20,
      severityClass: 'iv-ok',
      highVelocity: true,
      velocityClass: 'velocity-slow',
    },
    {
      widthPct: 20,
      severityClass: 'iv-ok',
      highVelocity: true,
      velocityClass: 'velocity-steady',
    },
    {
      widthPct: 20,
      severityClass: 'iv-ok',
      highVelocity: true,
      velocityClass: 'velocity-fast',
    },
    {
      widthPct: 20,
      severityClass: 'iv-ok',
      highVelocity: true,
      velocityClass: 'velocity-hot',
    },
    {
      widthPct: 20,
      severityClass: 'iv-ok',
      highVelocity: true,
      velocityClass: 'velocity-peak',
    },
  ]

  const { container } = render(<QuotaIntervalBar intervals={intervals} />)
  const rendered = Array.from(
    container.querySelectorAll('.quota-interval')
  ) as HTMLElement[]

  expect(rendered).toHaveLength(5)
  expect(rendered[0].classList.contains('velocity-slow')).toBe(true)
  expect(rendered[0].classList.contains('high-velocity')).toBe(false)
  expect(rendered[1].classList.contains('velocity-steady')).toBe(true)
  expect(rendered[1].classList.contains('high-velocity')).toBe(false)
  expect(
    rendered.slice(2).every((el) => el.classList.contains('high-velocity'))
  ).toBe(true)
  expect(
    container.querySelectorAll('.quota-row-velocity-overlay')
  ).toHaveLength(1)
  expect(container.querySelectorAll('.quota-row-velocity-sweep')).toHaveLength(
    1
  )
})

test('test_quota_interval_bar_overlay_mask_matches_high_velocity_runs', () => {
  const intervals: QuotaInterval[] = [
    {
      widthPct: 20,
      severityClass: 'iv-ok',
      highVelocity: true,
      velocityClass: 'velocity-slow',
    },
    {
      widthPct: 20,
      severityClass: 'iv-ok',
      highVelocity: true,
      velocityClass: 'velocity-fast',
    },
    {
      widthPct: 20,
      severityClass: 'iv-ok',
      highVelocity: true,
      velocityClass: 'velocity-steady',
    },
    {
      widthPct: 40,
      severityClass: 'iv-warning',
      highVelocity: true,
      velocityClass: 'velocity-hot',
    },
  ]

  const { container } = render(<QuotaIntervalBar intervals={intervals} />)
  const overlay = container.querySelector(
    '.quota-row-velocity-overlay'
  ) as HTMLElement | null

  expect(overlay).not.toBeNull()
  expect(
    container.querySelectorAll('.quota-row-velocity-overlay')
  ).toHaveLength(1)
  expect(overlay!.querySelector('.quota-row-velocity-sweep')).not.toBeNull()

  const style = overlay!.getAttribute('style') ?? ''
  expect(style).toContain('transparent 20%')
  expect(style).toContain('black 20%')
  expect(style).toContain('black 40%')
  expect(style).toContain('transparent 60%')
  expect(style).toContain('black 60%')
  expect(style).toContain('black 100%')
})

test('test_quota_interval_bar_no_overlay_for_slow_or_steady_only', () => {
  const intervals: QuotaInterval[] = [
    {
      widthPct: 50,
      severityClass: 'iv-ok',
      highVelocity: true,
      velocityClass: 'velocity-slow',
    },
    {
      widthPct: 50,
      severityClass: 'iv-ok',
      highVelocity: true,
      velocityClass: 'velocity-steady',
    },
  ]

  const { container } = render(<QuotaIntervalBar intervals={intervals} />)

  expect(container.querySelector('.quota-row-velocity-overlay')).toBeNull()
  expect(container.querySelector('.quota-row-velocity-sweep')).toBeNull()
  expect(
    Array.from(container.querySelectorAll('.quota-interval')).every(
      (interval) => !interval.classList.contains('high-velocity')
    )
  ).toBe(true)
})

test('test_quota_interval_bar_preserves_visual_boundaries_and_widths', () => {
  const intervals: QuotaInterval[] = [
    {
      widthPct: 1,
      severityClass: 'iv-ok',
      highVelocity: false,
      velocityClass: 'velocity-slow',
    },
    {
      widthPct: 1,
      severityClass: 'iv-ok',
      highVelocity: false,
      velocityClass: 'velocity-slow',
    },
    {
      widthPct: 1,
      severityClass: 'iv-ok',
      highVelocity: true,
      velocityClass: 'velocity-fast',
    },
    {
      widthPct: 1,
      severityClass: 'iv-ok',
      highVelocity: true,
      velocityClass: 'velocity-fast',
    },
    {
      widthPct: 1,
      severityClass: 'iv-warning',
      highVelocity: true,
      velocityClass: 'velocity-fast',
    },
  ]
  const { container } = render(<QuotaIntervalBar intervals={intervals} />)
  const rendered = Array.from(
    container.querySelectorAll('.quota-interval')
  ) as HTMLElement[]

  expect(rendered.map((interval) => interval.style.width)).toEqual([
    '2%',
    '2%',
    '1%',
  ])
  expect(
    rendered.map((interval) => interval.classList.contains('high-velocity'))
  ).toEqual([false, true, true])
  expect(
    rendered.map((interval) => interval.classList.contains('iv-ok'))
  ).toEqual([true, true, false])
  expect(
    rendered.map((interval) => interval.classList.contains('iv-warning'))
  ).toEqual([false, false, true])
  expect(
    rendered.map((interval) => interval.classList.contains('velocity-fast'))
  ).toEqual([false, true, true])
})

test('test_quota_interval_bar_keeps_velocity_tiers_as_merge_boundaries', () => {
  const intervals: QuotaInterval[] = [
    {
      widthPct: 1,
      severityClass: 'iv-ok',
      highVelocity: false,
      velocityClass: 'velocity-slow',
    },
    {
      widthPct: 1,
      severityClass: 'iv-ok',
      highVelocity: false,
      velocityClass: 'velocity-steady',
    },
  ]
  const { container } = render(<QuotaIntervalBar intervals={intervals} />)
  const rendered = Array.from(
    container.querySelectorAll('.quota-interval')
  ) as HTMLElement[]

  expect(rendered).toHaveLength(2)
  expect(
    rendered.map((interval) => interval.classList.contains('velocity-slow'))
  ).toEqual([true, false])
  expect(
    rendered.map((interval) => interval.classList.contains('velocity-steady'))
  ).toEqual([false, true])
})

test('test_quota_interval_bar_merges_adjacent_matching_velocity_tiers', () => {
  const intervals: QuotaInterval[] = [
    {
      widthPct: 1,
      severityClass: 'iv-ok',
      highVelocity: false,
      velocityClass: 'velocity-slow',
    },
    {
      widthPct: 1,
      severityClass: 'iv-ok',
      highVelocity: false,
      velocityClass: 'velocity-slow',
    },
  ]
  const { container } = render(<QuotaIntervalBar intervals={intervals} />)
  const rendered = Array.from(
    container.querySelectorAll('.quota-interval')
  ) as HTMLElement[]

  expect(rendered).toHaveLength(1)
  expect(rendered[0].style.width).toBe('2%')
  expect(rendered[0].classList.contains('velocity-slow')).toBe(true)
})

test('test_quota_interval_bar_velocity_class', () => {
  const intervals = [
    {
      widthPct: 50,
      severityClass: 'iv-warning',
      highVelocity: true,
      velocityClass: 'velocity-hot',
    },
    { widthPct: 50, severityClass: 'iv-ok', highVelocity: false },
  ]
  const { container } = render(<QuotaIntervalBar intervals={intervals} />)

  const hotEl = container.querySelector('.quota-interval.velocity-hot')
  expect(hotEl).not.toBeNull()
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

test('test_quota_interval_bar_projection_tick_renders_above_velocity_overlay', () => {
  const intervals: QuotaInterval[] = [
    {
      widthPct: 50,
      severityClass: 'iv-warning',
      highVelocity: true,
      velocityClass: 'velocity-hot',
    },
    { widthPct: 50, severityClass: 'iv-ok', highVelocity: false },
  ]

  const { container } = render(
    <QuotaIntervalBar intervals={intervals} projectionPct={65} />
  )
  const overlay = container.querySelector('.quota-row-velocity-overlay')
  const projection = container.querySelector('.qbar-projection') as HTMLElement

  expect(overlay).not.toBeNull()
  expect(projection).not.toBeNull()
  expect(projection.style.zIndex).toBe('5')
  expect(
    overlay!.compareDocumentPosition(projection) &
      Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
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

// ---------------------------------------------------------------------------
// Wave 41 — isPrior prop tests
// ---------------------------------------------------------------------------

test('test_quota_interval_bar_is_prior_adds_class', () => {
  // When isPrior=true, the wrapper .quota-row-bar must carry .is-prior.
  const { container } = render(
    <QuotaIntervalBar intervals={makeIntervals(12)} isPrior={true} />
  )
  const bar = container.querySelector('.quota-row-bar')
  expect(bar).not.toBeNull()
  expect(bar!.classList.contains('is-prior')).toBe(true)
})

test('test_quota_interval_bar_no_is_prior_by_default', () => {
  // Default: isPrior=false → no .is-prior class on the wrapper.
  const { container } = render(
    <QuotaIntervalBar intervals={makeIntervals(12)} />
  )
  const bar = container.querySelector('.quota-row-bar')
  expect(bar!.classList.contains('is-prior')).toBe(false)
})

test('test_quota_interval_bar_is_prior_false_does_not_add_class', () => {
  const { container } = render(
    <QuotaIntervalBar intervals={makeIntervals(12)} isPrior={false} />
  )
  const bar = container.querySelector('.quota-row-bar')
  expect(bar!.classList.contains('is-prior')).toBe(false)
})
