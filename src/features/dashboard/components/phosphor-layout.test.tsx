/**
 * PhosphorLayout tests.
 *
 * Wave 14-A: sidebar slot restored — PhosphorLayout now renders
 * sidebar + header + main + alerts in a 3-column grid.
 */
import { render, screen } from '@testing-library/react'
import { PhosphorLayout } from './phosphor-layout'

test('test_phosphor_layout_renders_all_slots', () => {
  render(
    <PhosphorLayout
      sidebar={<div>SB</div>}
      header={<div>HD</div>}
      main={<div>MN</div>}
      alerts={<div>AL</div>}
    />
  )

  expect(screen.getByText('SB')).toBeInTheDocument()
  expect(screen.getByText('HD')).toBeInTheDocument()
  expect(screen.getByText('MN')).toBeInTheDocument()
  expect(screen.getByText('AL')).toBeInTheDocument()
})

test('test_phosphor_layout_applies_grid_class', () => {
  const { container } = render(
    <PhosphorLayout
      sidebar={<div>SB</div>}
      header={<div>HD</div>}
      main={<div>MN</div>}
      alerts={<div>AL</div>}
    />
  )

  const outerEl = container.firstChild as HTMLElement
  expect(outerEl).not.toBeNull()

  const hasGridClass = outerEl.className.includes('grid')
  const hasGridStyle = outerEl.style?.display === 'grid'

  // jsdom limitation: CSS class-based display:grid won't be computed, so we
  // check for either the class name or inline style
  expect(hasGridClass || hasGridStyle).toBe(true)
})

test('test_phosphor_layout_3col_grid_template', () => {
  const { container } = render(
    <PhosphorLayout
      sidebar={<div>SB</div>}
      header={<div>HD</div>}
      main={<div>MN</div>}
      alerts={<div>AL</div>}
    />
  )

  const outerEl = container.firstChild as HTMLElement
  expect(outerEl).not.toBeNull()
  // Baseline 3-col grid declared via inline style
  expect(outerEl.style?.gridTemplateColumns).toBe('220px 1fr 260px')
})
