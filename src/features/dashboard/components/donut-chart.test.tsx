/**
 * Wave 6 — DonutChart red-phase tests.
 *
 * Component path: src/features/dashboard/components/donut-chart.tsx
 * Expected export: DonutChart (named)
 * Props: { slices: SliceConfig[] }
 * SliceConfig = { client: string; tokens: number; color: string }
 * SVG viewBox 0 0 140 140, r=50, stroke-width=16, stroke-based slices.
 *
 * All tests expected to FAIL (red) — source file does not exist yet.
 */
import { render } from '@testing-library/react'
import { DonutChart } from './donut-chart'

// ---------------------------------------------------------------------------
// Fixtures (total = 1000 for round numbers)
// ---------------------------------------------------------------------------

const mockSlices6 = [
  { client: 'claude-code', tokens: 320, color: '#cc7855' },
  { client: 'gemini-cli', tokens: 200, color: '#4285f4' },
  { client: 'codex', tokens: 150, color: '#10a37f' },
  { client: 'cursor', tokens: 150, color: '#9575cd' },
  { client: 'aider', tokens: 100, color: '#ef4444' },
  { client: 'other', tokens: 80, color: '#94a3b8' },
]

const CIRCUMFERENCE = 2 * Math.PI * 50 // ≈ 314.159

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('test_donut_renders_svg_circle_per_slice', () => {
  const { container } = render(<DonutChart slices={mockSlices6} />)

  // Count circles WITH stroke-dasharray (data slices, not background track)
  const allCircles = container.querySelectorAll('circle')
  const sliceCircles = Array.from(allCircles).filter(
    (c) => c.getAttribute('stroke-dasharray') !== null
  )

  expect(sliceCircles.length).toBe(6)
})

test('test_donut_claude_code_stroke_color', () => {
  const { container } = render(<DonutChart slices={mockSlices6} />)

  // Find circle for claude-code — by data attribute or stroke color
  const claudeCircle =
    container.querySelector('circle[data-client="claude-code"]') ??
    Array.from(container.querySelectorAll('circle')).find(
      (c) => c.getAttribute('stroke') === '#cc7855'
    )

  expect(claudeCircle).not.toBeNull()
  expect(claudeCircle!.getAttribute('stroke')).toBe('#cc7855')
})

test('test_donut_slice_dasharray_proportional', () => {
  const { container } = render(<DonutChart slices={mockSlices6} />)

  // claude-code: 320/1000 = 32% of circumference
  const expectedDash = CIRCUMFERENCE * 0.32 // ≈ 100.53

  const claudeCircle =
    container.querySelector('circle[data-client="claude-code"]') ??
    Array.from(container.querySelectorAll('circle')).find(
      (c) => c.getAttribute('stroke') === '#cc7855'
    )

  expect(claudeCircle).not.toBeNull()

  const dashArray = claudeCircle!.getAttribute('stroke-dasharray')
  expect(dashArray).not.toBeNull()

  // Parse first value of stroke-dasharray (may be "100.53 213.63" format)
  const firstValue = parseFloat(dashArray!.split(/[\s,]+/)[0])
  expect(Math.abs(firstValue - expectedDash)).toBeLessThan(0.5)
})

test('test_donut_center_label_shows_count', () => {
  const { container } = render(<DonutChart slices={mockSlices6} />)

  // Center <text> should show "6" (count of slices)
  const textEl = container.querySelector('text')
  expect(textEl).not.toBeNull()
  expect(textEl!.textContent).toContain('6')
})

test('test_legend_renders_6_swatches', () => {
  const { container } = render(<DonutChart slices={mockSlices6} />)

  const legendItems =
    container.querySelectorAll('.client-legend-item').length > 0
      ? container.querySelectorAll('.client-legend-item')
      : container.querySelectorAll('[data-testid="client-legend-item"]')

  expect(legendItems.length).toBe(6)
})

test('test_legend_claude_code_swatch_color', () => {
  const { container } = render(<DonutChart slices={mockSlices6} />)

  // Find the swatch element for claude-code
  const legendItems =
    container.querySelectorAll('.client-legend-item').length > 0
      ? container.querySelectorAll('.client-legend-item')
      : container.querySelectorAll('[data-testid="client-legend-item"]')

  // Find the legend item containing 'claude-code'
  const claudeItem = Array.from(legendItems).find(
    (item) =>
      item.textContent?.includes('claude-code') ||
      (item as HTMLElement).dataset['client'] === 'claude-code'
  ) as HTMLElement | undefined

  expect(claudeItem).not.toBeUndefined()

  // Find the swatch within the item
  const swatch =
    claudeItem!.querySelector('.swatch') ??
    claudeItem!.querySelector('[class*="swatch"]') ??
    claudeItem!.querySelector('span')

  expect(swatch).not.toBeNull()

  const bg =
    (swatch as HTMLElement).style.background ||
    (swatch as HTMLElement).style.backgroundColor

  // jsdom normalizes #cc7855 → rgb(204, 120, 85)
  expect(bg === '#cc7855' || bg === 'rgb(204, 120, 85)').toBe(true)
})
