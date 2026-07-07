/**
 * Sparkline — inline SVG polyline primitive.
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
  const yValues = points
    .trim()
    .split(/\s+/)
    .map((pair) => parseFloat(pair.split(',')[1]))

  for (const y of yValues) {
    expect(y).toBeGreaterThanOrEqual(2)
    expect(y).toBeLessThanOrEqual(18)
  }
})

test('test_sparkline_empty_data_renders_nothing_or_placeholder', () => {
  const { container } = render(<Sparkline data={[]} color='#3b82f6' />)

  const polyline = container.querySelector('polyline')
  if (polyline !== null) {
    const points = polyline.getAttribute('points') ?? ''
    expect(points.trim()).toBe('')
  }
})

test('test_sparkline_filters_non_finite', () => {
  const { container: nanContainer } = render(
    <Sparkline data={[10, NaN, 20, 30]} color='#3b82f6' />
  )
  const nanPolyline = nanContainer.querySelector('polyline')
  expect(nanPolyline).not.toBeNull()
  const nanPoints = nanPolyline?.getAttribute('points') ?? ''
  expect(nanPoints).not.toMatch(/NaN/)
  expect(nanPoints.trim().length).toBeGreaterThan(0)

  const { container: infContainer } = render(
    <Sparkline data={[5, Infinity, 15]} color='#ef4444' />
  )
  const infPolyline = infContainer.querySelector('polyline')
  expect(infPolyline).not.toBeNull()
  const infPoints = infPolyline?.getAttribute('points') ?? ''
  expect(infPoints).not.toMatch(/Infinity/)
  expect(infPoints.trim().length).toBeGreaterThan(0)

  const { container: allNanContainer } = render(
    <Sparkline data={[NaN, NaN, NaN]} color='#10b981' />
  )
  const allNanPolyline = allNanContainer.querySelector('polyline')
  if (allNanPolyline !== null) {
    const pts = allNanPolyline.getAttribute('points') ?? ''
    expect(pts.trim()).toBe('')
  }
})

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

  const expectedCenter = height / 2
  for (const y of yValues) {
    expect(Math.abs(y - expectedCenter)).toBeLessThan(3)
  }
})

test('test_sparkline_single_point_renders_dot', () => {
  const { container } = render(<Sparkline data={[42]} color='#f59e0b' />)
  const circle = container.querySelector('circle')
  expect(circle).not.toBeNull()
})

test('test_endpoint_strokes_not_clipped', () => {
  const width = 60
  const { container } = render(
    <Sparkline data={[0, 100]} color='#3b82f6' width={width} height={20} />
  )
  const polyline = container.querySelector('polyline')
  expect(polyline).not.toBeNull()

  const points = polyline!.getAttribute('points')!.trim().split(/\s+/)
  const firstX = parseFloat(points[0]!.split(',')[0]!)
  const lastX = parseFloat(points[points.length - 1]!.split(',')[0]!)

  // Documented 2px padding on all sides — x must be inset like y (C4).
  expect(firstX).toBe(2)
  expect(lastX).toBe(width - 2)
})

test('test_sparkline_nan_gap_compresses_x_axis', () => {
  const width = 60
  const { container } = render(
    <Sparkline data={[10, NaN, 30]} color='#3b82f6' width={width} />
  )
  const polyline = container.querySelector('polyline')
  expect(polyline).not.toBeNull()

  const points = polyline!.getAttribute('points')!.trim().split(/\s+/)
  // Non-finite values filtered — only two finite points, spanning full x width.
  expect(points.length).toBe(2)
  const xs = points.map((p) => parseFloat(p.split(',')[0]!))
  expect(xs[0]).toBe(0)
  expect(xs[1]).toBe(width)
})
