/**
 * PhosphorLayout tests.
 *
 * Wave 14-A: sidebar slot restored — PhosphorLayout now renders
 * sidebar + header + main + alerts in a 3-column grid.
 *
 * Wave 8 (S5-38/S5-39) — a11y red-phase additions:
 *  - Grid applied via class NOT inline display:grid (S5-38)
 *  - Both <aside> landmarks carry aria-label (S5-39)
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
  // Wave 18-Cards: gridTemplateColumns moved from inline style to CSS module
  // (with !important) so that media-query breakpoints at 1600/2560/3840/5120px
  // are not silently blocked by inline specificity. jsdom cannot evaluate CSS
  // module class rules, so we verify the phosphor-layout CSS class is present
  // (which carries the baseline 220px 1fr 260px rule) and that display:grid is
  // set inline (preserved for jsdom detectability of the grid container).
  expect(outerEl.className).toContain('phosphor-layout')
  expect(outerEl.style?.display).toBe('grid')
})

test('test_phosphor_layout_can_render_without_alerts_column', () => {
  const { container, queryByText } = render(
    <PhosphorLayout
      sidebar={<div>SB</div>}
      header={<div>HD</div>}
      main={<div>MN</div>}
    />
  )

  const outerEl = container.firstChild as HTMLElement
  expect(outerEl.className).toContain('phosphor-layout-no-alerts')
  expect(queryByText('AL')).not.toBeInTheDocument()
})

// ---------------------------------------------------------------------------
// Wave 8 (S5-38/S5-39) — a11y: class-based grid, labeled aside landmarks
// ---------------------------------------------------------------------------

/**
 * S5-38 — Grid must be applied via a CSS class, NOT via an inline `display:grid`.
 *
 * The current implementation sets `display: 'grid'` inline on the root element
 * alongside a note saying it's "kept inline so jsdom tests remain detectable".
 * This inline style overrides any media-query breakpoints from the CSS module
 * even after the `gridTemplateColumns` etc. were moved to CSS. The W8 fix must
 * remove the inline `display:grid` and instead rely solely on the CSS class
 * (phosphor-layout) for the grid behaviour.
 *
 * EXPECTED FAIL: current implementation has `style={{ display: 'grid', ... }}`
 * on the root element. After fix, `outerEl.style.display` must be empty or
 * absent, and the grid must be set only through the class name.
 */
test('test_phosphor_layout_grid_via_class_not_inline_style', () => {
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

  // Must have the grid class (source of display:grid in real CSS)
  expect(outerEl.className).toContain('grid')

  // EXPECTED FAIL: inline display:grid is still present in current implementation
  expect(outerEl.style.display).toBe('')
})

/**
 * S5-39 — Both <aside> landmarks must carry `aria-label`.
 *
 * Two `<aside>` elements exist in the layout (sidebar and alerts rail). When a
 * page has multiple complementary landmarks of the same type, each must have a
 * unique accessible name (`aria-label` or `aria-labelledby`) per ARIA spec.
 * Without labels, screen reader users cannot distinguish between them in the
 * landmark navigation menu.
 *
 * EXPECTED FAIL: current implementation renders `<aside className='sidebar' ...>`
 * and `<aside ...>` for alerts — neither carries an `aria-label`.
 */
test('test_phosphor_layout_both_asides_have_aria_label', () => {
  const { container } = render(
    <PhosphorLayout
      sidebar={<div>SB</div>}
      header={<div>HD</div>}
      main={<div>MN</div>}
      alerts={<div>AL</div>}
    />
  )

  const asides = Array.from(container.querySelectorAll('aside'))
  // With alerts: two asides (sidebar + alerts)
  expect(asides.length).toBe(2)

  for (const aside of asides) {
    const label =
      aside.getAttribute('aria-label') ?? aside.getAttribute('aria-labelledby')
    // EXPECTED FAIL: neither aside carries an aria-label currently
    expect(label).not.toBeNull()
    expect(label).not.toBe('')
  }
})

/**
 * S5-39 — Both aside labels must be unique (distinct from each other).
 *
 * Duplicate landmark labels are equivalent to no label from a UX perspective —
 * users can't tell them apart in the landmark list.
 *
 * EXPECTED FAIL: after fix labels must exist AND be distinct.
 */
test('test_phosphor_layout_aside_labels_are_unique', () => {
  const { container } = render(
    <PhosphorLayout
      sidebar={<div>SB</div>}
      header={<div>HD</div>}
      main={<div>MN</div>}
      alerts={<div>AL</div>}
    />
  )

  const asides = Array.from(container.querySelectorAll('aside'))
  expect(asides.length).toBe(2)

  const labels = asides.map(
    (aside) =>
      aside.getAttribute('aria-label') ??
      aside.getAttribute('aria-labelledby') ??
      ''
  )

  // Both must be non-empty
  for (const label of labels) {
    // EXPECTED FAIL: labels are absent
    expect(label).not.toBe('')
  }

  // Must be distinct
  expect(labels[0]).not.toBe(labels[1])
})
