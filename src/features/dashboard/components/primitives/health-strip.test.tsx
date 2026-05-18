/**
 * Wave 3 — HealthStrip red-phase tests.
 *
 * Component path: src/features/dashboard/components/primitives/health-strip.tsx
 * Expected export: HealthStrip (named)
 * Props: { cells: { color: string }[] } — expects 288 cells; pads sparse data.
 *
 * All tests expected to FAIL (red) — source file does not exist yet.
 */
// @ts-expect-error -- module does not exist yet (red phase)
import { render } from '@testing-library/react'
import { HealthStrip } from '../primitives/health-strip'

const CELL_COUNT = 288 // 24h * 12 (5-min buckets)

test('test_health_strip_renders_288_cells', () => {
  const cells = Array.from({ length: CELL_COUNT }, () => ({
    color: 'var(--card-2)',
  }))
  const { container } = render(<HealthStrip cells={cells} />)

  const cellEls =
    container.querySelectorAll('.health-strip-cell').length > 0
      ? container.querySelectorAll('.health-strip-cell')
      : container.querySelectorAll('[data-testid="health-strip-cell"]')

  expect(cellEls.length).toBe(288)
})

test('test_health_strip_cell_bg_color_applied', () => {
  const cells = [
    { color: '#f59e0b' },
    ...Array.from({ length: 287 }, () => ({ color: 'var(--card-2)' })),
  ]
  const { container } = render(<HealthStrip cells={cells} />)

  const cellEls =
    container.querySelectorAll('.health-strip-cell').length > 0
      ? container.querySelectorAll('.health-strip-cell')
      : container.querySelectorAll('[data-testid="health-strip-cell"]')

  const firstCell = cellEls[0] as HTMLElement
  // jsdom normalizes hex to rgb: #f59e0b → rgb(245, 158, 11)
  const bg = firstCell.style.background || firstCell.style.backgroundColor
  expect(bg === '#f59e0b' || bg === 'rgb(245, 158, 11)').toBe(true)
})

test('test_health_strip_pads_sparse_data', () => {
  // Only 2 cells provided — component must pad to 288
  const cells = [{ color: '#f00' }, { color: '#0f0' }]
  const { container } = render(<HealthStrip cells={cells} />)

  const cellEls =
    container.querySelectorAll('.health-strip-cell').length > 0
      ? container.querySelectorAll('.health-strip-cell')
      : container.querySelectorAll('[data-testid="health-strip-cell"]')

  // Total rendered cells must be 288 (padded)
  expect(cellEls.length).toBe(288)

  // Trailing 286 cells should have the padding background
  const paddingCell = cellEls[2] as HTMLElement
  const paddingBg =
    paddingCell.style.background || paddingCell.style.backgroundColor
  // Accept either CSS variable literal or transparent
  expect(
    paddingBg === 'var(--card-2)' ||
      paddingBg === 'transparent' ||
      paddingBg === ''
  ).toBe(true)
})
