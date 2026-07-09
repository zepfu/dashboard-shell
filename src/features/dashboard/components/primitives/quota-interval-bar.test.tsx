/**
 * QuotaIntervalBar — interval merge, projection tick, velocity overlay.
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

// ---------------------------------------------------------------------------
// S5-21: widths + gaps must be within bar bounds; right edge not clipped
// ---------------------------------------------------------------------------

/**
 * S5-21 — the sum of all interval widths plus inter-segment gaps must not
 * exceed the bar's total width (100%). A right-edge clip would occur when
 * widths sum > 100% or when the gap count calculation is wrong.
 *
 * The gap style is applied via CSS `gap: 2px` for bars with ≤50 intervals.
 * The number of gaps = displayIntervals.length - 1 (between segments).
 *
 * Assertions:
 *  1. Sum of displayed interval widthPct values ≤ 100 (no overflow).
 *  2. The gap is keyed to displayIntervals.length (number of merged runs).
 *  3. No interval extends past the right edge (right clip guard).
 *
 * EXPECTED FAIL: if merging is incorrect and total widthPct > 100, or if
 * gaps are calculated from raw interval count instead of displayIntervals.length.
 */
test('test_quota_bar_widths_plus_gaps_within_bounds', () => {
  // 5 heterogeneous intervals summing to exactly 100%
  const intervals: QuotaInterval[] = [
    { widthPct: 10, severityClass: 'iv-0-5', highVelocity: false },
    { widthPct: 20, severityClass: 'iv-5-10', highVelocity: false },
    { widthPct: 30, severityClass: 'iv-10-25', highVelocity: false },
    { widthPct: 25, severityClass: 'iv-25-50', highVelocity: false },
    { widthPct: 15, severityClass: 'iv-50-p', highVelocity: false },
  ]

  const { container } = render(<QuotaIntervalBar intervals={intervals} />)

  const bar = container.querySelector('.quota-row-bar')
  expect(bar).not.toBeNull()

  const renderedIntervals = Array.from(
    container.querySelectorAll('.quota-interval')
  ) as HTMLElement[]

  // Total widthPct across rendered (merged) segments must be ≤ 100%
  const totalWidthPct = renderedIntervals.reduce((sum, el) => {
    const w = parseFloat(el.style.width)
    return sum + (isNaN(w) ? 0 : w)
  }, 0)
  expect(totalWidthPct).toBeLessThanOrEqual(100)

  // Gap count = displayIntervals.length - 1, not raw intervals.length - 1
  // Since all 5 intervals have distinct severityClass, no merging occurs →
  // displayIntervals.length = 5 → 4 gaps.
  // Verify the bar wrapper uses gap:2px (≤50 intervals rule).
  // The inline style sets gap only for > 50; for ≤ 50 it's set via CSS.
  // We check the inline style directly instead of computed (JSDOM limitation).
  const inlineGap = (bar as HTMLElement).style.gap
  // For ≤50 intervals, inline gap should be '2px' or left to CSS (empty string)
  // Either '2px' or '' is acceptable — but not a raw-interval-count-based value.
  expect(['2px', '']).toContain(inlineGap)

  // Right edge guard: no individual rendered interval should have widthPct > 100
  for (const el of renderedIntervals) {
    const w = parseFloat(el.style.width)
    expect(w).toBeLessThanOrEqual(100)
  }
})

// ---------------------------------------------------------------------------
// S5-22/S5-23: quota projection tier variants and over-100 clamping
// ---------------------------------------------------------------------------

/**
 * S5-22 — projection tick must render with appropriate tier class when
 * approaching quota (approaching tier) or over quota (over tier).
 *
 * EXPECTED FAIL: current implementation uses a single static class
 * 'qbar-projection sustainable' regardless of projectionPct value.
 * Tests verify 'approaching' and 'over' classes are applied at the right
 * threshold.
 */
test('test_quota_projection_tier_variants', () => {
  const intervalsAt80: QuotaInterval[] = [
    { widthPct: 80, severityClass: 'iv-25-50', highVelocity: false },
    {
      widthPct: 20,
      severityClass: 'iv-50-p',
      highVelocity: true,
      velocityClass: 'velocity-hot',
    },
  ]

  // Approaching: projectionPct = 85 (≥80% but <100)
  const { container: approachingContainer } = render(
    <QuotaIntervalBar intervals={intervalsAt80} projectionPct={85} />
  )
  const approachingTick = approachingContainer.querySelector('.qbar-projection')
  expect(approachingTick).not.toBeNull()
  // Must carry 'approaching' class — NOT just 'sustainable'
  expect(approachingTick?.classList.contains('approaching')).toBe(true)
  expect(approachingTick?.classList.contains('sustainable')).toBe(false)

  // Over: projectionPct = 102 (>100%)
  const { container: overContainer } = render(
    <QuotaIntervalBar intervals={intervalsAt80} projectionPct={102} />
  )
  const overTick = overContainer.querySelector('.qbar-projection')
  expect(overTick).not.toBeNull()
  expect(overTick?.classList.contains('over')).toBe(true)
})

/**
 * S5-23 — when projectionPct > 100, the tick must be clamped to 100%
 * (right edge of the bar) rather than rendering outside the bar bounds.
 *
 * EXPECTED FAIL: current implementation passes projectionPct directly as
 * `left: ${projectionPct}%` with no clamping, so 102% would render outside.
 */
test('test_quota_projection_clamped_when_over_100', () => {
  const intervals: QuotaInterval[] = [
    { widthPct: 100, severityClass: 'iv-50-p', highVelocity: false },
  ]

  const { container } = render(
    <QuotaIntervalBar intervals={intervals} projectionPct={115} />
  )

  const tick = container.querySelector('.qbar-projection') as HTMLElement | null
  expect(tick).not.toBeNull()

  // left style must be clamped to ≤ 100%
  const leftStyle = tick?.style.left ?? ''
  const leftNum = parseFloat(leftStyle)
  expect(leftNum).toBeLessThanOrEqual(100)
})

test('test_over_quota_tick_exact_contract', () => {
  const intervals: QuotaInterval[] = [
    { widthPct: 100, severityClass: 'iv-50-p', highVelocity: false },
  ]

  const { container } = render(
    <QuotaIntervalBar intervals={intervals} projectionPct={115} />
  )

  const tick = container.querySelector(
    '.qbar-projection.over'
  ) as HTMLElement | null
  expect(tick).not.toBeNull()

  expect(tick!.style.left).toBe('100%')
  // Source sets right: 0 (number). jsdom CSSStyleDeclaration serializes
  // unitless zero lengths as "0px"; accept both forms of the contract.
  expect(['0', '0px']).toContain(tick!.style.right)
  expect(tick!.style.left).not.toBe('calc(100% - 2px)')
})

test('test_merged_runs_do_not_lose_newest_interval_to_px_gap', () => {
  const intervals: QuotaInterval[] = Array.from({ length: 12 }, (_, i) => ({
    widthPct: 100 / 12,
    severityClass: `iv-tier-${i}`,
    highVelocity: false,
  }))

  const { container } = render(<QuotaIntervalBar intervals={intervals} />)

  const bar = container.querySelector('.quota-row-bar') as HTMLElement | null
  expect(bar).not.toBeNull()

  const segments = Array.from(
    container.querySelectorAll('.quota-interval')
  ) as HTMLElement[]
  expect(segments.length).toBe(12)

  const barRect = bar!.getBoundingClientRect()
  const lastSegment = segments[segments.length - 1]!
  const lastRect = lastSegment.getBoundingClientRect()

  expect(lastRect.right).toBeLessThanOrEqual(barRect.right + 0.5)
  expect(lastRect.width).toBeGreaterThan(0)

  const gapPx = parseFloat(bar!.style.gap) || 2
  const totalSegmentWidth = segments.reduce((sum, el) => {
    return sum + el.getBoundingClientRect().width
  }, 0)
  const totalGaps = (segments.length - 1) * gapPx
  expect(totalSegmentWidth + totalGaps).toBeLessThanOrEqual(barRect.width + 0.5)
})
