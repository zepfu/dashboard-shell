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
 * Wave 8 (S3-24) — a11y:
 *  - role='tooltip' on the floating panel
 *  - aria-describedby wired from trigger child to tooltip panel
 *  - Opens on focus (not just pointer hover)
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
    <HoverTooltip content={() => <span>Tooltip content</span>}>
      <button type='button'>Hover me</button>
    </HoverTooltip>
  )

  const tooltip =
    document.body.querySelector('.v9-tip') ??
    container.querySelector('[data-testid="hover-tooltip"]')

  expect(tooltip).toBeNull()
})

test('test_hover_tooltip_visible_on_parent_hover', () => {
  const { container } = render(
    <HoverTooltip content={() => <span>Tooltip content</span>}>
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
    <HoverTooltip content={() => <span>Tooltip content</span>}>
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
    <HoverTooltip content={() => <span>Tooltip content</span>}>
      <button type='button'>Hover me</button>
    </HoverTooltip>
  )

  const trigger = container.firstChild as HTMLElement
  fireEvent.pointerEnter(trigger)
  fireEvent.keyDown(window, { key: 'Control' })
  fireEvent.pointerLeave(trigger)
  fireEvent.keyDown(window, { key: 'Escape' })

  const tooltip = document.body.querySelector('.v9-tip') as HTMLElement | null

  expect(tooltip).toBeNull()
})

test('test_hover_tooltip_quota_variant_positions_above', () => {
  const { container } = render(
    <HoverTooltip content={() => <span>Quota tip</span>} variant='quota'>
      <button type='button'>Trigger</button>
    </HoverTooltip>
  )

  const trigger = container.firstChild as HTMLElement
  fireEvent.pointerEnter(trigger)

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
      content={() => (
        <>
          <div className='v9-tip-head'>Quota tip</div>
          <div className='v9-tip-row'>First row</div>
          <div className='v9-tip-row'>Second row</div>
        </>
      )}
      variant='quota'
    >
      <button type='button'>Trigger</button>
    </HoverTooltip>
  )

  const trigger = container.firstChild as HTMLElement
  fireEvent.pointerEnter(trigger)

  const tooltip = document.body.querySelector('.v9-tip') as HTMLElement | null
  expect(tooltip).not.toBeNull()

  // Defensive: the portalled fixed panel sets `inset: auto` so any legacy
  // absolute offsets (e.g. a class-level `bottom` on .tip-quota) cannot
  // constrain the panel height and overflow rows outside the painted
  // background, even if such offsets are reintroduced later.
  expect(tooltip?.style.inset).toBe('auto')
})

test('test_hover_tooltip_accepts_panel_style_override', () => {
  const { container } = render(
    <HoverTooltip
      content={() => <span>Tooltip content</span>}
      panelStyle={{ maxWidth: 'calc(100vw - 16px)', width: '720px' }}
    >
      <button type='button'>Hover me</button>
    </HoverTooltip>
  )

  fireEvent.pointerEnter(container.firstChild as HTMLElement)

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
      <HoverTooltip content={() => <span>Large score tooltip</span>}>
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
      <HoverTooltip content={() => <span>Wide score tooltip</span>}>
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
    <HoverTooltip content={() => <span>Tooltip content</span>}>
      <button type='button'>Hover me</button>
    </HoverTooltip>
  )

  const injectedStyle = document.head.querySelector('[data-v9-tooltip]')
  expect(injectedStyle).toBeNull()
})

// ---------------------------------------------------------------------------
// Wave 3 (adversarial-review-20260612) — FAILING tests, W3 engineer to fix
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Wave 8 (S3-24) — a11y: role=tooltip, aria-describedby, opens on focus
// ---------------------------------------------------------------------------

/**
 * S3-24 — The floating panel must carry role='tooltip'.
 *
 * `role='tooltip'` tells assistive technology that the element is a tooltip —
 * it will be announced when the trigger element is focused, provided the trigger
 * links to it via `aria-describedby`. Without this role the panel is an
 * anonymous div that AT may or may not announce.
 *
 */
test('test_hover_tooltip_panel_has_role_tooltip', () => {
  const { container } = render(
    <HoverTooltip content={() => <span>Tooltip content</span>}>
      <button type='button'>Hover me</button>
    </HoverTooltip>
  )

  fireEvent.pointerEnter(container.firstChild as HTMLElement)

  const panel = document.body.querySelector('.v9-tip') as HTMLElement | null
  expect(panel).not.toBeNull()

  expect(panel!.getAttribute('role')).toBe('tooltip')
})

/**
 * S3-24 — The tooltip panel must have an `id` and the trigger's first focusable
 * child (or the wrapper) must carry `aria-describedby` pointing to that id.
 *
 * Without this wiring:
 *  - Screen readers don't announce tooltip content when the trigger is focused.
 *  - The role='tooltip' alone is insufficient; the connection must be explicit.
 *
 * EXPECTED FAIL: current implementation has no `id` on `.v9-tip` and no
 * `aria-describedby` on the wrapper or children.
 */
test('test_aria_describedby_only_while_open', () => {
  const preExistingId = 'existing-describedby-target'
  const { container } = render(
    <HoverTooltip content={() => <span>Described content</span>}>
      <button type='button' id='my-trigger' aria-describedby={preExistingId}>
        Trigger
      </button>
    </HoverTooltip>
  )

  const trigger = container.querySelector('button') as HTMLButtonElement
  expect(trigger.getAttribute('aria-describedby')).toBe(preExistingId)

  fireEvent.pointerEnter(container.firstChild as HTMLElement)

  const panel = document.body.querySelector('.v9-tip') as HTMLElement | null
  expect(panel).not.toBeNull()
  const panelId = panel!.getAttribute('id')
  expect(panelId).not.toBeNull()
  expect(panelId).not.toBe('')

  expect(trigger.getAttribute('aria-describedby')).toBe(panelId)

  fireEvent.pointerLeave(container.firstChild as HTMLElement)

  expect(document.body.querySelector('.v9-tip')).toBeNull()
  expect(trigger.getAttribute('aria-describedby')).toBe(preExistingId)
})

/**
 * S3-24 — The tooltip must open on `focus` events, not only on pointer hover.
 *
 * Keyboard users navigate with Tab; they never trigger `pointerEnter` events.
 * The tooltip must open when the trigger element (or the wrapper) receives focus.
 *
 * EXPECTED FAIL: current implementation attaches `onPointerEnter` to the wrapper
 * div to open the tooltip, but there is no `onFocus` handler. A keyboard user
 * tabbing to the trigger child never opens the tooltip.
 */
test('test_hover_tooltip_opens_on_focus', () => {
  const { container } = render(
    <HoverTooltip content={() => <span>Focus-visible content</span>}>
      <button type='button'>Focus target</button>
    </HoverTooltip>
  )

  const trigger = container.querySelector('button') as HTMLButtonElement
  expect(trigger).not.toBeNull()

  // Simulate keyboard focus (Tab lands on the button)
  fireEvent.focus(trigger)

  const panel = document.body.querySelector('.v9-tip') as HTMLElement | null
  expect(panel).not.toBeNull()

  // Panel must be open/visible after focus
  const isOpen =
    panel!.getAttribute('data-state') === 'open' ||
    (!panel!.classList.contains('hidden') &&
      panel!.style.opacity !== '0' &&
      panel!.style.display !== 'none')

  // EXPECTED FAIL: onFocus is absent; tooltip does not open on focus
  expect(isOpen).toBe(true)
})

/**
 * S3-24 — The tooltip must close on `blur` when not pinned.
 *
 * Complementing the focus-open behavior: when the trigger loses focus via Tab
 * or Shift+Tab, the tooltip must close. Without this the tooltip stays visible
 * indefinitely for keyboard users.
 *
 * EXPECTED FAIL: if focus-open is not implemented, blur-close is also absent.
 */
test('test_hover_tooltip_closes_on_blur_when_not_pinned', () => {
  const { container } = render(
    <HoverTooltip content={() => <span>Focus-visible content</span>}>
      <button type='button'>Focus target</button>
    </HoverTooltip>
  )

  const trigger = container.querySelector('button') as HTMLButtonElement
  expect(trigger).not.toBeNull()

  // Open via focus
  fireEvent.focus(trigger)

  const panel = document.body.querySelector('.v9-tip') as HTMLElement | null
  expect(panel).not.toBeNull()

  // Blur the trigger (keyboard user Tabs away)
  fireEvent.blur(trigger)

  const panelAfterBlur = document.body.querySelector(
    '.v9-tip'
  ) as HTMLElement | null
  expect(panelAfterBlur).toBeNull()
})

// ---------------------------------------------------------------------------
// Wave 3 adversarial-review tests (pre-existing — do not modify)
// ---------------------------------------------------------------------------

/**
 * S3-22 — Re-hovering a pinned tooltip silently unpins it.
 *
 * `onPointerEnter` does `setIsPinned(false)` unconditionally. Flow:
 * hover → Ctrl (pinned) → move away (stays open) → move back across trigger → unpinned.
 *
 * After fix: `onPointerEnter` must NOT reset `isPinned` when the pin is already set.
 */
test('test_hover_tooltip_reenter_keeps_pin', () => {
  const { container } = render(
    <HoverTooltip content={() => <span>Pinnable content</span>}>
      <button type='button'>Hover me</button>
    </HoverTooltip>
  )

  const trigger = container.firstChild as HTMLElement

  // 1. Open the tooltip.
  fireEvent.pointerEnter(trigger)
  let tip = document.body.querySelector('.v9-tip') as HTMLElement | null
  expect(tip).not.toBeNull()
  expect(tip!.getAttribute('data-state')).toBe('open')

  // 2. Pin it with Ctrl.
  fireEvent.keyDown(window, { key: 'Control' })
  expect(tip!.getAttribute('data-pinned')).toBe('true')

  // 3. Leave the trigger (pinned tooltip stays open).
  fireEvent.pointerLeave(trigger)
  expect(tip!.getAttribute('data-state')).toBe('open')
  expect(tip!.getAttribute('data-pinned')).toBe('true')

  // 4. Re-enter the trigger.
  fireEvent.pointerEnter(trigger)

  // After fix: pin must be preserved (data-pinned remains 'true').
  // Before fix: setIsPinned(false) → data-pinned flips to 'false'.
  tip = document.body.querySelector('.v9-tip') as HTMLElement | null
  expect(tip!.getAttribute('data-pinned')).toBe('true')
})

/**
 * S3-25 — `panelStyle` positional override is silently clobbered by computed coords.
 *
 * `panelStyleOverride` is merged at line 355, BEFORE coords are applied.
 * A caller passing `top: '999px'` in `panelStyle` will have it overwritten
 * by the coord-computed top value (coords apply last). After the fix, either:
 *   (a) positional keys in panelStyle are applied after coords (they win), or
 *   (b) the API is documented: only non-positional keys are honored.
 *
 * This test FAILS before fix because the coord-computed top overwrites the
 * caller's explicit `top: '999px'` intent.
 */
test('test_panelStyle_nonpositional_preserved', () => {
  const { container } = render(
    <HoverTooltip
      content={() => <span>Override content</span>}
      panelStyle={{ maxWidth: '720px', top: '999px' }}
    >
      <button type='button'>Hover me</button>
    </HoverTooltip>
  )

  const trigger = container.firstChild as HTMLElement
  fireEvent.pointerEnter(trigger)

  const tip = document.body.querySelector('.v9-tip') as HTMLElement | null
  expect(tip).not.toBeNull()

  // Non-positional key: maxWidth must survive (already works, regression guard).
  expect(tip!.style.maxWidth).toBe('720px')

  // Positional key bug: `top: '999px'` in panelStyle is overwritten by coords.
  // After fix: the caller's `top` intent is preserved (applied after coords).
  // This assertion FAILS before fix — coords overwrite top to a computed value.
  expect(tip!.style.top).toBe('999px')
})
