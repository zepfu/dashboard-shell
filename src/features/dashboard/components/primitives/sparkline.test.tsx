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
// @ts-expect-error -- module does not exist yet (red phase)
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
