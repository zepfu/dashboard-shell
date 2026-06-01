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
