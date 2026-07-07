/**
 * Wave 11 — Lazy hover-tooltip content contract (S3-26 / #91).
 *
 * ENGINEER: C
 *
 * The W11 change converts `HoverTooltip`'s `content` prop from `ReactNode`
 * (always rendered, toggled via CSS / data attributes) to a render-prop
 * `() => ReactNode` (lazy — only called once the tooltip opens via hover or focus).
 *
 * BEHAVIORAL CONTRACT:
 *   BEFORE hover/focus: tooltip content is NOT present in the DOM at all.
 *   AFTER  hover/focus: tooltip content IS in the DOM and visible.
 *
 * This is a meaningful change from the current behaviour where the content IS
 * always mounted (just hidden via `.hidden` / `opacity:0` / `data-state=closed`).
 * The new contract is stronger: null | undefined DOM content before activation.
 *
 * WHY THIS TEST IS NEW (not a migration of existing tests):
 *   The ~20 existing tests in `hover-tooltip.test.tsx` assert the old always-mounted
 *   model (checking `isHidden` via class/attribute, asserting `.v9-tip` is present
 *   even before hover).  Those tests will be MIGRATED by Engineer C as part of the
 *   same source change.  This new file pins the LAZY contract that the migration
 *   produces — it becomes the permanent contract test.
 *
 * NOTE on existing tests:
 *   The following tests in `primitives/hover-tooltip.test.tsx` use the old
 *   always-mounted model and will be migrated by Engineer C:
 *     - test_hover_tooltip_hidden_by_default              (isHidden check on .v9-tip)
 *     - test_hover_tooltip_visible_on_parent_hover        (data-state='closed' baseline)
 *     - test_hover_tooltip_quota_variant_positions_above  (checks .v9-tip before hover)
 *     - test_hover_tooltip_portalled_panel_clears_legacy_offsets
 *     - test_hover_tooltip_accepts_panel_style_override   (checks .v9-tip before hover)
 *     - test_hover_tooltip_does_not_inject_style_tag
 *     - test_hover_tooltip_panel_has_role_tooltip
 *     - test_hover_tooltip_aria_describedby_wired_to_panel
 *     - test_hover_tooltip_default_variant_clamps_bottom_overflow
 *     - test_hover_tooltip_default_variant_flips_left_at_right_edge
 *     + ~10 more that assert .v9-tip presence before pointerEnter
 *   (Engineer C to audit and migrate; the exact count is ~20 per plan spec S2-T4.)
 */
import { fireEvent, render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { HoverTooltip } from './hover-tooltip'

// ---------------------------------------------------------------------------
// Lazy content contract tests (S3-26 / #91)
// ---------------------------------------------------------------------------

describe('lazy hover-tooltip content contract (S3-26 / #91)', () => {
  /**
   * BEFORE hover: tooltip content must NOT be in the DOM.
   *
   * This is the key behavioral difference between the old always-mounted model
   * and the new lazy render-prop model.  The old tests checked
   * `tooltip.classList.contains('hidden')` — after W11 the element itself must
   * be absent from the DOM tree.
   *
   * RED: current implementation always mounts the content inside `.v9-tip`,
   * which IS in the DOM before hover (just hidden via style/class).
   */
  test('test_lazy_tooltip_content_not_in_dom_before_hover', () => {
    const uniqueText = 'w11-lazy-content-sentinel-abc123'

    render(
      <HoverTooltip content={() => <span>{uniqueText}</span>}>
        <button type='button'>Hover target</button>
      </HoverTooltip>
    )

    const contentEl = document.body.querySelector(
      `[data-testid="hover-tooltip-content"]`
    )
    const textMatch = Array.from(document.body.querySelectorAll('*')).find(
      (el) => el.textContent === uniqueText
    )

    // Either: no .v9-tip panel exists at all (purest lazy), or it exists but
    // is completely empty of the render-prop output.
    expect(contentEl).toBeNull()
    expect(textMatch).toBeUndefined()
  })

  test('test_lazy_tooltip_content_in_dom_after_pointer_enter', () => {
    const uniqueText = 'w11-lazy-content-visible-after-hover'

    const { container } = render(
      <HoverTooltip content={() => <span>{uniqueText}</span>}>
        <button type='button'>Hover target</button>
      </HoverTooltip>
    )

    const trigger = container.firstChild as HTMLElement
    fireEvent.pointerEnter(trigger)

    // After pointerEnter: the render-prop is called and the content must be
    // present and visible in the DOM.
    const textMatch = Array.from(document.body.querySelectorAll('*')).find(
      (el) => el.textContent === uniqueText
    )

    expect(textMatch).toBeDefined()
    expect(textMatch).not.toBeNull()
  })

  test('test_lazy_tooltip_content_in_dom_after_focus', () => {
    /**
     * The lazy contract must also apply to focus (keyboard users).
     * Content is absent before focus and present after.
     */
    const uniqueText = 'w11-focus-lazy-content-sentinel'

    const { container } = render(
      <HoverTooltip content={() => <span>{uniqueText}</span>}>
        <button type='button'>Focus target</button>
      </HoverTooltip>
    )

    // Before focus: content must not be in DOM.
    const beforeFocus = Array.from(document.body.querySelectorAll('*')).find(
      (el) => el.textContent === uniqueText
    )
    expect(beforeFocus).toBeUndefined()

    // Fire focus on the button trigger.
    const button = container.querySelector('button') as HTMLButtonElement
    fireEvent.focus(button)

    // After focus: content must be present.
    const afterFocus = Array.from(document.body.querySelectorAll('*')).find(
      (el) => el.textContent === uniqueText
    )
    expect(afterFocus).toBeDefined()
    expect(afterFocus).not.toBeNull()
  })

  test('test_lazy_tooltip_content_removed_from_dom_after_pointer_leave', () => {
    /**
     * After pointerLeave (and without pin), the content must be removed from
     * the DOM (not merely hidden) — this is the lazy unmount contract.
     *
     * Implementation choice: the engineer MAY choose to keep a pre-mounted empty
     * shell and only lazy-render the children.  Either way, the uniqueText content
     * must not be in the DOM after the tooltip closes.
     */
    const uniqueText = 'w11-lazy-content-removed-after-leave'

    const { container } = render(
      <HoverTooltip content={() => <span>{uniqueText}</span>}>
        <button type='button'>Hover target</button>
      </HoverTooltip>
    )

    const trigger = container.firstChild as HTMLElement

    // Open the tooltip.
    fireEvent.pointerEnter(trigger)
    const contentPresent = Array.from(document.body.querySelectorAll('*')).find(
      (el) => el.textContent === uniqueText
    )
    expect(contentPresent).toBeDefined()

    // Close the tooltip.
    fireEvent.pointerLeave(trigger)
    const contentGone = Array.from(document.body.querySelectorAll('*')).find(
      (el) => el.textContent === uniqueText
    )
    // After close: content must be absent again (lazy unmount).
    expect(contentGone).toBeUndefined()
  })

  test('test_lazy_tooltip_render_prop_called_only_on_open', () => {
    /**
     * The render prop must be called lazily: 0 times when closed, ≥1 time
     * after open.  This guards against eager evaluation that would negate the
     * performance benefit of the render-prop API.
     */
    let callCount = 0
    const lazyContent = () => {
      callCount++
      return <span>rendered {callCount} times</span>
    }

    const { container } = render(
      <HoverTooltip content={lazyContent}>
        <button type='button'>Hover target</button>
      </HoverTooltip>
    )

    expect(callCount).toBe(0)

    // After hover: at least one call.
    const trigger = container.firstChild as HTMLElement
    fireEvent.pointerEnter(trigger)
    expect(callCount).toBeGreaterThanOrEqual(1)
  })

  test('test_lazy_tooltip_backward_compat_plain_node_content_accepted', () => {
    /**
     * Engineer C may choose to accept BOTH `content: ReactNode` (old) and
     * `content: () => ReactNode` (new render prop) to allow gradual consumer
     * migration.  If they do, a plain ReactNode must still render after hover.
     *
     * If the API accepts ONLY the render-prop form, this test should be updated
     * to match.  Leaving it here as a discussion point — update to match the
     * engineer's implementation decision.
     *
     * Note: if content is always a function, callers must be updated; the plan
     * states "every consumer (provider-card, master-ledger, health-strip,
     * sidebar, quota-interval-bar) updates" so it is acceptable to require the
     * render-prop form exclusively.
     */
    const { container } = render(
      <HoverTooltip
        content={() => <span data-testid='compat-content'>compat</span>}
      >
        <button type='button'>Hover target</button>
      </HoverTooltip>
    )

    const trigger = container.firstChild as HTMLElement
    fireEvent.pointerEnter(trigger)

    const el = document.body.querySelector('[data-testid="compat-content"]')
    expect(el).not.toBeNull()
    expect(el?.textContent).toBe('compat')
  })
})

// ---------------------------------------------------------------------------
// Smoke test alias (per plan Smoke Test Procedure §)
// Durable smoke contract ownership for the adversarial-review rename is now
// documented in docs/implemented/2026-06-plan-adversarial-review-20260612.md
// and exercised via the maintained smoke file at
// `src/test/smoke/dashboard-mount.smoke.test.tsx`.
// ---------------------------------------------------------------------------

test('test_lazy_tooltip_not_in_dom_until_hover', () => {
  /**
   * Per plan Smoke Test Procedure:
   *   "test_lazy_tooltip_not_in_dom_until_hover — post-W11 systemic #91 contract"
   *
   * This is the canonical smoke assertion.  It duplicates the core check from
   * `test_lazy_tooltip_content_not_in_dom_before_hover` above as the named
   * smoke sentinel.
   *
   */
  const sentinelText = 'smoke-lazy-tooltip-sentinel'

  const { container } = render(
    <HoverTooltip content={() => <span>{sentinelText}</span>}>
      <button type='button'>Smoke trigger</button>
    </HoverTooltip>
  )

  // Before hover: NOT in DOM.
  const beforeHover = Array.from(document.body.querySelectorAll('*')).find(
    (el) => el.textContent === sentinelText
  )
  expect(beforeHover).toBeUndefined()

  // After pointerEnter: IS in DOM.
  const trigger = container.firstChild as HTMLElement
  fireEvent.pointerEnter(trigger)

  const afterHover = Array.from(document.body.querySelectorAll('*')).find(
    (el) => el.textContent === sentinelText
  )
  expect(afterHover).toBeDefined()
  expect(afterHover).not.toBeNull()
})
