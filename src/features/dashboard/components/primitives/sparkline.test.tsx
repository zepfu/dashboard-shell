/**
 * Wave 3 — Sparkline red-phase tests.
 *
 * Component path: src/features/dashboard/components/primitives/sparkline.tsx
 * Expected export: Sparkline (named)
 * Props: { data: number[]; color: string; width?: number; height?: number }
 * Renders inline SVG <polyline>.
 *
 * All tests expected to FAIL (red) — source file does not exist yet.
 */
import { render } from '@testing-library/react'
import { Sparkline } from '../primitives/sparkline'

test('test_sparkline_renders_svg_polyline', () => {
  const { container } = render(
    <Sparkline data={[10, 20, 15, 30]} color='#3b82f6' />
  )

  const polyline = container.querySelector('polyline')
  expect(polyline).not.toBeNull()
  expect(polyline!.getAttribute('stroke')).toBe('#3b82f6')

  const points = polyline!.getAttribute('points')
  expect(points).not.toBeNull()
  expect(points!.length).toBeGreaterThan(0)
})

test('test_sparkline_normalizes_to_viewbox', () => {
  const height = 20
  const { container } = render(
    <Sparkline data={[1, 100, 50]} color='#3b82f6' height={height} />
  )

  const polyline = container.querySelector('polyline')
  expect(polyline).not.toBeNull()

  const points = polyline!.getAttribute('points')!
  // Points format: "x,y x,y x,y"
  const yValues = points
    .trim()
    .split(/\s+/)
    .map((pair) => parseFloat(pair.split(',')[1]))

  // Every y must be within [2, 18] for a height-20 SVG (±2 padding)
  for (const y of yValues) {
    expect(y).toBeGreaterThanOrEqual(2)
    expect(y).toBeLessThanOrEqual(18)
  }
})

test('test_sparkline_empty_data_renders_nothing_or_placeholder', () => {
  const { container } = render(<Sparkline data={[]} color='#3b82f6' />)

  const polyline = container.querySelector('polyline')
  // Either no polyline, or a degenerate one with empty/no points
  if (polyline !== null) {
    const points = polyline.getAttribute('points') ?? ''
    expect(points.trim()).toBe('')
  }
  // If polyline is null, that's also a valid response (renders nothing)
})

// ---------------------------------------------------------------------------
// Wave 3 (adversarial-review-20260612) — FAILING tests, W3 engineer to fix
// ---------------------------------------------------------------------------

/**
 * S3-27 — Non-finite values (NaN / Infinity) must not kill the sparkline.
 *
 * One NaN or Infinity in `data` propagates through `Math.min/max` and `range`,
 * producing `points="...,NaN ..."` — the SVG drops the polyline silently.
 *
 * After fix: `data.filter(Number.isFinite)` before computing min/max.
 */
test('test_sparkline_filters_non_finite', () => {
  // NaN in the middle of otherwise valid data.
  const { container: nanContainer } = render(
    <Sparkline data={[10, NaN, 20, 30]} color='#3b82f6' />
  )
  const nanPolyline = nanContainer.querySelector('polyline')
  // After fix: polyline exists with valid points (no NaN in points string).
  expect(nanPolyline).not.toBeNull()
  const nanPoints = nanPolyline?.getAttribute('points') ?? ''
  expect(nanPoints).not.toMatch(/NaN/)
  expect(nanPoints.trim().length).toBeGreaterThan(0)

  // Infinity also handled.
  const { container: infContainer } = render(
    <Sparkline data={[5, Infinity, 15]} color='#ef4444' />
  )
  const infPolyline = infContainer.querySelector('polyline')
  expect(infPolyline).not.toBeNull()
  const infPoints = infPolyline?.getAttribute('points') ?? ''
  expect(infPoints).not.toMatch(/Infinity/)
  expect(infPoints.trim().length).toBeGreaterThan(0)

  // All-NaN: should render nothing (null return or empty).
  const { container: allNanContainer } = render(
    <Sparkline data={[NaN, NaN, NaN]} color='#10b981' />
  )
  // Either no SVG at all, or an SVG with no polyline, or a polyline with no points.
  const allNanPolyline = allNanContainer.querySelector('polyline')
  if (allNanPolyline !== null) {
    const pts = allNanPolyline.getAttribute('points') ?? ''
    expect(pts.trim()).toBe('')
  }
})

/**
 * S3-28 — Flat series must be centered; single-point must render a dot.
 *
 * Flat series (max === min): the fallback `range = 1` places y at
 * `height - 2` (floor). A 100%-success series reads as "low". Fix: center it.
 *
 * Single point: a `<polyline>` with one point paints nothing. Fix: `<circle>`.
 */
test('test_sparkline_flat_series_centered', () => {
  const height = 20
  const { container } = render(
    <Sparkline data={[50, 50, 50, 50]} color='#10b981' height={height} />
  )
  const polyline = container.querySelector('polyline')
  expect(polyline).not.toBeNull()

  const points = polyline!.getAttribute('points')!
  const yValues = points
    .trim()
    .split(/\s+/)
    .map((pair) => parseFloat(pair.split(',')[1] ?? 'NaN'))

  // After fix: flat series is centered at height/2 = 10.
  // Before fix: y = height - 2 = 18 (floor — reads as "low").
  const expectedCenter = height / 2
  for (const y of yValues) {
    expect(Math.abs(y - expectedCenter)).toBeLessThan(3) // within 3px of center
  }
})

test('test_sparkline_single_point_renders_dot', () => {
  const { container } = render(<Sparkline data={[42]} color='#f59e0b' />)
  // After fix: single-point renders a <circle>, not an invisible polyline.
  // Before fix: <polyline> with one vertex paints nothing.
  const circle = container.querySelector('circle')
  const polyline = container.querySelector('polyline')

  // Either a circle OR no polyline is acceptable for single-point.
  // But a circle is preferred: a one-vertex polyline paints nothing.
  void polyline // checked: current impl renders a degenerate polyline (no segment, not visible)
  expect(circle).not.toBeNull() // FAILS before fix (currently renders a degenerate polyline)
})
