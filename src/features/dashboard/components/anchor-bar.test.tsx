/**
 * Wave 2 — AnchorBar red-phase tests.
 *
 * Component path: src/features/dashboard/components/anchor-bar.tsx
 * Expected export: AnchorBar (default)
 * Props: { activeSection: string; onSectionChange: (s: string) => void }
 *
 * All tests expected to FAIL (red) — source file does not exist yet.
 */
import { act, render, screen } from '@testing-library/react'
import AnchorBar from './anchor-bar'

const SECTIONS = [
  { text: '[S]tatus', key: 's', value: 'status' },
  { text: '[H]ealth', key: 'h', value: 'status-health' },
  { text: '[Q]uota', key: 'q', value: 'status-quota' },
  { text: '[T]rend', key: 't', value: 'trend' },
  { text: '[V]ersion', key: 'v', value: 'trend-version' },
  { text: '[R]equest', key: 'r', value: 'trend-requests' },
  { text: 'T[O]ol', key: 'o', value: 'trend-tools' },
  { text: '[L]edger', key: 'l', value: 'ledger' },
  { text: '[M]odel', key: 'm', value: 'ledger-model' },
  { text: 'R[E]pository', key: 'e', value: 'ledger-repository' },
  { text: '[F]ilter', key: 'f', value: 'filter' },
  { text: '[D]ate', key: 'd', value: 'date' },
]

test('test_anchor_bar_renders_dashboard_links', () => {
  const onSectionChange = vi.fn()
  render(<AnchorBar activeSection='status' onSectionChange={onSectionChange} />)

  const links = screen.getAllByRole('link')
  expect(links.map((link) => link.textContent)).toEqual(
    SECTIONS.map((section) => section.text)
  )
})

test('test_anchor_bar_kbd_hint_spans_present', () => {
  const onSectionChange = vi.fn()
  const { container } = render(
    <AnchorBar activeSection='status' onSectionChange={onSectionChange} />
  )

  const kbdHints = container.querySelectorAll('.kbd-hint')
  expect(kbdHints.length).toBe(12)
})

test('test_anchor_bar_keyboard_s_navigates_to_status', () => {
  const onSectionChange = vi.fn()
  render(<AnchorBar activeSection='status' onSectionChange={onSectionChange} />)

  act(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', bubbles: true })
    )
  })

  expect(onSectionChange).toHaveBeenCalledWith('status')
})

test('test_anchor_bar_keyboard_q_navigates_to_status_quota', () => {
  const onSectionChange = vi.fn()
  const onActivate = vi.fn()
  render(
    <AnchorBar
      activeSection='status'
      onSectionChange={onSectionChange}
      onActivate={onActivate}
    />
  )

  act(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'q', bubbles: true })
    )
  })

  expect(onSectionChange).toHaveBeenCalledWith('status-quota')
  expect(onActivate).toHaveBeenCalledWith('status-quota')
})

test('test_anchor_bar_keyboard_d_navigates_to_date_shortcut', () => {
  const onSectionChange = vi.fn()
  render(<AnchorBar activeSection='status' onSectionChange={onSectionChange} />)

  act(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'd', bubbles: true })
    )
  })

  expect(onSectionChange).toHaveBeenCalledWith('date')
})

test('test_anchor_bar_keyboard_ignores_ctrl_shortcuts', () => {
  const onSectionChange = vi.fn()
  render(<AnchorBar activeSection='status' onSectionChange={onSectionChange} />)

  act(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true })
    )
  })

  expect(onSectionChange).not.toHaveBeenCalled()
})

test('test_anchor_bar_keyboard_ignores_input_focus', () => {
  const onSectionChange = vi.fn()
  const { container } = render(
    <>
      <AnchorBar activeSection='status' onSectionChange={onSectionChange} />
      <input data-testid='sibling-input' />
    </>
  )

  const input = container.querySelector('input') as HTMLInputElement
  input.focus()

  act(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', bubbles: true })
    )
  })

  expect(onSectionChange).not.toHaveBeenCalled()
})

// ---------------------------------------------------------------------------
// Wave 8 (S5-25/S5-27) — a11y: activeElement guard, aria-current,
// aria-keyshortcuts, Shift+S ignored
// ---------------------------------------------------------------------------

/**
 * S5-25 — Pressing 'f' while a listbox option is focused must NOT trigger the
 * anchor jump to the "Filter" section.
 *
 * The current `isInteractive` guard checks only `HTMLInputElement`,
 * `HTMLTextAreaElement`, `HTMLSelectElement`, and `contentEditable`. A focused
 * `<li role="option">` is NOT caught by this guard, so pressing 'f' while a
 * slicer listbox option has focus incorrectly fires `onSectionChange('filter')`.
 *
 * After fix: the guard must also cover `[role="option"]`, `[role="listbox"]`,
 * or more generally any element with `role` that indicates interactive content,
 * OR a broader check such as `closest('[role="listbox"]')`.
 *
 * EXPECTED FAIL: current implementation fires onSectionChange even when a
 * listbox option has focus.
 */
test('test_anchor_bar_f_key_while_listbox_option_focused_does_not_jump', () => {
  const onSectionChange = vi.fn()
  const { container } = render(
    <>
      <AnchorBar activeSection='status' onSectionChange={onSectionChange} />
      {/* Simulate a slicer listbox option that can receive focus */}
      <ul role='listbox' aria-label='Provider options'>
        <li role='option' aria-selected={false} tabIndex={0}>
          anthropic
        </li>
      </ul>
    </>
  )

  // Focus a listbox option
  const option = container.querySelector(
    '[role="option"]'
  ) as HTMLElement | null
  expect(option).not.toBeNull()
  option!.focus()
  expect(document.activeElement).toBe(option)

  act(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'f', bubbles: true })
    )
  })

  // EXPECTED FAIL: with no guard for role="option", onSectionChange IS called
  expect(onSectionChange).not.toHaveBeenCalled()
})

/**
 * S5-27 — The active anchor link carries `aria-current="page"` or
 * `aria-current="true"`.
 *
 * Screen readers announce the current page/section via `aria-current`. Without
 * it, keyboard users cannot tell which section is active.
 *
 * EXPECTED FAIL: current implementation marks the active link with a CSS class
 * (detected via `isActive ? 'anchor-link--active' : ''`) or inline styles but
 * does NOT set `aria-current` on the active `<a>` element.
 */
test('test_anchor_bar_active_link_has_aria_current', () => {
  render(<AnchorBar activeSection='trend' onSectionChange={vi.fn()} />)

  // The '[T]rend' link should be active
  const trendLink = screen.getByRole('link', { name: /\[T\]rend/i })
  expect(trendLink).toBeInTheDocument()

  // EXPECTED FAIL: aria-current is not set by current implementation
  const ariaCurrent = trendLink.getAttribute('aria-current')
  expect(
    ariaCurrent === 'page' ||
      ariaCurrent === 'true' ||
      ariaCurrent === 'location'
  ).toBe(true)
})

/**
 * S5-27 — Non-active links must NOT carry `aria-current`.
 *
 * Only the active link should be marked with aria-current to avoid misleading
 * screen readers.
 */
test('test_anchor_bar_inactive_links_do_not_have_aria_current', () => {
  render(<AnchorBar activeSection='status' onSectionChange={vi.fn()} />)

  const allLinks = screen.getAllByRole('link')
  // 'status' section has key 's', the [S]tatus link is active
  const inactiveLinks = allLinks.filter((link) => {
    const text = link.textContent ?? ''
    return !text.includes('[S]')
  })

  expect(inactiveLinks.length).toBeGreaterThan(0)

  for (const link of inactiveLinks) {
    // EXPECTED FAIL if non-active links receive aria-current (no-op until fix)
    expect(link.getAttribute('aria-current')).toBeNull()
  }
})

/**
 * S5-27 — Each anchor link carries `aria-keyshortcuts` advertising its key.
 *
 * `aria-keyshortcuts` lets screen readers and assistive tech announce the
 * keyboard shortcut associated with a control. Without it, keyboard users have
 * no programmatic way to discover shortcuts from the accessibility tree.
 *
 * EXPECTED FAIL: current implementation renders bracketed hints as visible text
 * (`[S]tatus`) but does NOT set `aria-keyshortcuts` on the anchor elements.
 */
test('test_anchor_bar_links_have_aria_keyshortcuts', () => {
  render(<AnchorBar activeSection='status' onSectionChange={vi.fn()} />)

  const links = screen.getAllByRole('link')
  expect(links.length).toBe(12)

  // Every link should advertise its shortcut key
  for (const link of links) {
    const ks = link.getAttribute('aria-keyshortcuts')
    // EXPECTED FAIL: aria-keyshortcuts not present in current impl
    expect(ks).not.toBeNull()
    expect(ks).not.toBe('')
  }
})

/**
 * S5-25 — Shift+S must NOT trigger the anchor jump.
 *
 * The existing guard skips `ctrlKey`/`metaKey`/`altKey` but does NOT check
 * `shiftKey`. A user pressing Shift+S (e.g. to type an uppercase 'S' in a
 * field that lost focus at the wrong moment) should not activate the shortcut.
 *
 * EXPECTED FAIL: `shiftKey` is not in the current guard — Shift+S fires the
 * onSectionChange('status') handler.
 */
test('test_anchor_bar_shift_s_does_not_jump', () => {
  const onSectionChange = vi.fn()
  render(<AnchorBar activeSection='status' onSectionChange={onSectionChange} />)

  act(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'S',
        shiftKey: true,
        bubbles: true,
      })
    )
  })

  // EXPECTED FAIL: Shift+S currently triggers onSectionChange
  expect(onSectionChange).not.toHaveBeenCalled()
})
