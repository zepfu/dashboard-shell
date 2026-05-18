/**
 * Wave 2 — AnchorBar red-phase tests.
 *
 * Component path: src/features/dashboard/components/anchor-bar.tsx
 * Expected export: AnchorBar (default)
 * Props: { activeSection: string; onSectionChange: (s: string) => void }
 *
 * All tests expected to FAIL (red) — source file does not exist yet.
 */
// @ts-expect-error -- module does not exist yet (red phase)
import { act, render, screen } from '@testing-library/react'
import AnchorBar from './anchor-bar'

const SECTIONS = [
  { text: '[S]tatus', key: 's', value: 'status' },
  { text: '[T]okens', key: 't', value: 'tokens' },
  { text: '[M]odels', key: 'm', value: 'models' },
  { text: '[R]epos', key: 'r', value: 'repos' },
  { text: '[C]lients', key: 'c', value: 'clients' },
  { text: '[H]ealth', key: 'h', value: 'health' },
]

test('test_anchor_bar_renders_all_six_links', () => {
  const onSectionChange = vi.fn()
  render(<AnchorBar activeSection='status' onSectionChange={onSectionChange} />)

  for (const { value } of SECTIONS) {
    // Each section should have a link containing its label text (partial match)
    expect(screen.getByText(new RegExp(value, 'i'))).toBeInTheDocument()
  }

  // Verify we have exactly 6 navigation links
  const links = screen.getAllByRole('link')
  expect(links.length).toBe(6)
})

test('test_anchor_bar_kbd_hint_spans_present', () => {
  const onSectionChange = vi.fn()
  const { container } = render(
    <AnchorBar activeSection='status' onSectionChange={onSectionChange} />
  )

  const kbdHints = container.querySelectorAll('.kbd-hint')
  expect(kbdHints.length).toBe(6)
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
