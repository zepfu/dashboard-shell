/**
 * Wave 3 — HoverTooltip red-phase tests.
 *
 * Component path: src/features/dashboard/components/primitives/hover-tooltip.tsx
 * Expected export: HoverTooltip (named)
 * Props: { content: ReactNode; variant?: 'health' | 'quota' | 'default'; children: ReactNode }
 *
 * NOTE: Implementation should use React state + onPointerEnter/Leave for
 * visibility — jsdom cannot execute CSS :hover rules. Tests written against
 * state-driven visibility.
 *
 * All tests expected to FAIL (red) — source file does not exist yet.
 */
import { render, fireEvent } from '@testing-library/react'
import { HoverTooltip } from '../primitives/hover-tooltip'

test('test_hover_tooltip_hidden_by_default', () => {
  const { container } = render(
    <HoverTooltip content={<span>Tooltip content</span>}>
      <button type='button'>Hover me</button>
    </HoverTooltip>
  )

  // Tooltip should be hidden initially
  const tooltip =
    container.querySelector('.v9-tip') ??
    container.querySelector('[data-testid="hover-tooltip"]')

  expect(tooltip).not.toBeNull()

  // Hidden via class or attribute
  const isHidden =
    (tooltip as HTMLElement).classList.contains('hidden') ||
    (tooltip as HTMLElement).classList.contains('opacity-0') ||
    (tooltip as HTMLElement).getAttribute('data-state') === 'closed' ||
    (tooltip as HTMLElement).style.display === 'none' ||
    (tooltip as HTMLElement).style.opacity === '0'

  expect(isHidden).toBe(true)
})

test('test_hover_tooltip_visible_on_parent_hover', () => {
  const { container } = render(
    <HoverTooltip content={<span>Tooltip content</span>}>
      <button type='button'>Hover me</button>
    </HoverTooltip>
  )

  // Fire pointerEnter on the parent trigger
  const trigger = container.firstChild as HTMLElement
  fireEvent.pointerEnter(trigger)

  const tooltip =
    container.querySelector('.v9-tip') ??
    container.querySelector('[data-testid="hover-tooltip"]')

  expect(tooltip).not.toBeNull()

  // Tooltip should now be visible — not hidden
  const isStillHidden =
    (tooltip as HTMLElement).classList.contains('hidden') ||
    (tooltip as HTMLElement).classList.contains('opacity-0') ||
    (tooltip as HTMLElement).getAttribute('data-state') === 'closed'

  expect(isStillHidden).toBe(false)
})

test('test_hover_tooltip_quota_variant_positions_above', () => {
  const { container } = render(
    <HoverTooltip content={<span>Quota tip</span>} variant='quota'>
      <button type='button'>Trigger</button>
    </HoverTooltip>
  )

  const tooltip =
    container.querySelector('.v9-tip') ??
    container.querySelector('[data-testid="hover-tooltip"]')

  expect(tooltip).not.toBeNull()

  const hasAboveClass = (tooltip as HTMLElement).classList.contains('tip-above')
  const hasAboveStyle =
    (tooltip as HTMLElement).style.bottom === 'calc(100% + 6px)'

  // Accept either class-based or inline-style-based positioning
  expect(hasAboveClass || hasAboveStyle).toBe(true)
})

test('test_hover_tooltip_does_not_inject_style_tag', () => {
  // Wave 35 ✘-2: ensureStyles() was removed so the component no longer injects
  // a <style data-v9-tooltip> tag at runtime. CSS in index.css is the sole source
  // of truth for .v9-tip* rules, eliminating the cascade override risk.
  render(
    <HoverTooltip content={<span>Tooltip content</span>}>
      <button type='button'>Hover me</button>
    </HoverTooltip>
  )

  const injectedStyle = document.head.querySelector('[data-v9-tooltip]')
  expect(injectedStyle).toBeNull()
})
