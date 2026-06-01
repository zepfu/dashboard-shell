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

function makeRect({
  top,
  left,
  width,
  height,
}: {
  top: number
  left: number
  width: number
  height: number
}): DOMRect {
  return {
    x: left,
    y: top,
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect
}

function installTooltipRectMocks({
  viewportWidth,
  viewportHeight,
  triggerRect,
  panelRect,
}: {
  viewportWidth: number
  viewportHeight: number
  triggerRect: DOMRect
  panelRect: DOMRect
}): () => void {
  const originalGetBoundingClientRect =
    HTMLElement.prototype.getBoundingClientRect
  const originalInnerWidth = window.innerWidth
  const originalInnerHeight = window.innerHeight

  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: viewportWidth,
  })
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: viewportHeight,
  })
  HTMLElement.prototype.getBoundingClientRect = function (): DOMRect {
    return this.classList.contains('v9-tip') ? panelRect : triggerRect
  }

  return () => {
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: originalInnerWidth,
    })
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: originalInnerHeight,
    })
  }
}

test('test_hover_tooltip_hidden_by_default', () => {
  const { container } = render(
    <HoverTooltip content={<span>Tooltip content</span>}>
      <button type='button'>Hover me</button>
    </HoverTooltip>
  )

  // Tooltip panel is portalled to document.body; query there instead of container.
  const tooltip =
    document.body.querySelector('.v9-tip') ??
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

  // Tooltip panel is portalled to document.body; query there instead of container.
  const tooltip =
    document.body.querySelector('.v9-tip') ??
    container.querySelector('[data-testid="hover-tooltip"]')

  expect(tooltip).not.toBeNull()

  // Tooltip should now be visible — not hidden
  const isStillHidden =
    (tooltip as HTMLElement).classList.contains('hidden') ||
    (tooltip as HTMLElement).classList.contains('opacity-0') ||
    (tooltip as HTMLElement).getAttribute('data-state') === 'closed'

  expect(isStillHidden).toBe(false)
})

test('test_hover_tooltip_control_key_pins_open_after_pointer_leave', () => {
  const { container } = render(
    <HoverTooltip content={<span>Tooltip content</span>}>
      <button type='button'>Hover me</button>
    </HoverTooltip>
  )

  const trigger = container.firstChild as HTMLElement
  fireEvent.pointerEnter(trigger)
  fireEvent.keyDown(window, { key: 'Control' })
  fireEvent.pointerLeave(trigger)

  const tooltip = document.body.querySelector('.v9-tip') as HTMLElement | null

  expect(tooltip).not.toBeNull()
  expect(tooltip?.getAttribute('data-state')).toBe('open')
  expect(tooltip?.getAttribute('data-pinned')).toBe('true')
})

test('test_hover_tooltip_escape_closes_pinned_tooltip', () => {
  const { container } = render(
    <HoverTooltip content={<span>Tooltip content</span>}>
      <button type='button'>Hover me</button>
    </HoverTooltip>
  )

  const trigger = container.firstChild as HTMLElement
  fireEvent.pointerEnter(trigger)
  fireEvent.keyDown(window, { key: 'Control' })
  fireEvent.pointerLeave(trigger)
  fireEvent.keyDown(window, { key: 'Escape' })

  const tooltip = document.body.querySelector('.v9-tip') as HTMLElement | null

  expect(tooltip).not.toBeNull()
  expect(tooltip?.getAttribute('data-state')).toBe('closed')
  expect(tooltip?.getAttribute('data-pinned')).toBe('false')
})

test('test_hover_tooltip_quota_variant_positions_above', () => {
  const { container } = render(
    <HoverTooltip content={<span>Quota tip</span>} variant='quota'>
      <button type='button'>Trigger</button>
    </HoverTooltip>
  )

  // Tooltip panel is portalled to document.body; query there instead of container.
  const tooltip =
    document.body.querySelector('.v9-tip') ??
    container.querySelector('[data-testid="hover-tooltip"]')

  expect(tooltip).not.toBeNull()

  const hasAboveClass = (tooltip as HTMLElement).classList.contains('tip-above')
  const hasAboveStyle =
    (tooltip as HTMLElement).style.bottom === 'calc(100% + 6px)'

  // Accept either class-based or inline-style-based positioning
  expect(hasAboveClass || hasAboveStyle).toBe(true)
})

test('test_hover_tooltip_portalled_panel_clears_legacy_offsets', () => {
  const { container } = render(
    <HoverTooltip
      content={
        <>
          <div className='v9-tip-head'>Quota tip</div>
          <div className='v9-tip-row'>First row</div>
          <div className='v9-tip-row'>Second row</div>
        </>
      }
      variant='quota'
    >
      <button type='button'>Trigger</button>
    </HoverTooltip>
  )

  const trigger = container.firstChild as HTMLElement
  fireEvent.pointerEnter(trigger)

  const tooltip = document.body.querySelector('.v9-tip') as HTMLElement | null
  expect(tooltip).not.toBeNull()

  // Regression: .tip-quota still has legacy absolute `bottom` CSS. The
  // portalled fixed panel must clear it or the browser constrains the panel
  // height and rows overflow outside the painted background.
  expect(tooltip?.style.inset).toBe('auto')
})

test('test_hover_tooltip_accepts_panel_style_override', () => {
  render(
    <HoverTooltip
      content={<span>Tooltip content</span>}
      panelStyle={{ maxWidth: 'calc(100vw - 16px)', width: '720px' }}
    >
      <button type='button'>Hover me</button>
    </HoverTooltip>
  )

  const tooltip = document.body.querySelector('.v9-tip') as HTMLElement | null

  expect(tooltip).not.toBeNull()
  expect(tooltip?.style.maxWidth).toBe('calc(100vw - 16px)')
  expect(tooltip?.style.width).toBe('720px')
})

test('test_hover_tooltip_default_variant_clamps_bottom_overflow', () => {
  const restore = installTooltipRectMocks({
    viewportWidth: 800,
    viewportHeight: 300,
    triggerRect: makeRect({ top: 260, left: 100, width: 12, height: 12 }),
    panelRect: makeRect({ top: -9999, left: -9999, width: 260, height: 220 }),
  })

  try {
    const { container } = render(
      <HoverTooltip content={<span>Large score tooltip</span>}>
        <button type='button'>Hover me</button>
      </HoverTooltip>
    )

    const trigger = container.firstChild as HTMLElement
    fireEvent.pointerEnter(trigger)

    const tooltip = document.body.querySelector('.v9-tip') as HTMLElement | null

    expect(tooltip).not.toBeNull()
    expect(tooltip?.style.top).toBe('72px')
    expect(tooltip?.style.maxHeight).toBe('calc(100vh - 16px)')
    expect(tooltip?.style.overflowY).toBe('auto')
  } finally {
    restore()
  }
})

test('test_hover_tooltip_default_variant_flips_left_at_right_edge', () => {
  const restore = installTooltipRectMocks({
    viewportWidth: 300,
    viewportHeight: 400,
    triggerRect: makeRect({ top: 40, left: 260, width: 15, height: 12 }),
    panelRect: makeRect({ top: -9999, left: -9999, width: 160, height: 90 }),
  })

  try {
    const { container } = render(
      <HoverTooltip content={<span>Wide score tooltip</span>}>
        <button type='button'>Hover me</button>
      </HoverTooltip>
    )

    const trigger = container.firstChild as HTMLElement
    fireEvent.pointerEnter(trigger)

    const tooltip = document.body.querySelector('.v9-tip') as HTMLElement | null

    expect(tooltip).not.toBeNull()
    expect(tooltip?.style.left).toBe('100px')
  } finally {
    restore()
  }
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
