/**
 * DateControls tests.
 *
 * Component path: src/features/dashboard/components/date-controls.tsx
 * Expected export: DateControls (named)
 * Props: { initialFrom?: string; initialTo?: string; onRangeChange: (from: string, to: string) => void }
 *
 * Wave 16-V: period-button tests removed (operator decision — period buttons
 * removed from UI entirely). Grain tests removed (grain selector removed).
 * Only Apply-related and validation tests remain.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { DateControls } from './date-controls'

test('test_date_controls_apply_disabled_when_invalid', () => {
  const onRangeChange = vi.fn()
  render(<DateControls onRangeChange={onRangeChange} />)

  const fromInput = screen.getByLabelText(/from/i)
  fireEvent.change(fromInput, { target: { value: 'not-a-date' } })

  const applyButton = screen.getByRole('button', { name: /apply/i })
  expect(
    applyButton.hasAttribute('disabled') ||
      applyButton.getAttribute('aria-disabled') === 'true'
  ).toBe(true)
})

test('test_date_controls_apply_fires_when_valid', () => {
  const onRangeChange = vi.fn()
  render(
    <DateControls
      initialFrom='2025-01-01'
      initialTo='2025-01-31'
      onRangeChange={onRangeChange}
    />
  )

  const applyButton = screen.getByRole('button', { name: /apply/i })
  expect(applyButton).not.toBeDisabled()

  fireEvent.click(applyButton)
  expect(onRangeChange).toHaveBeenCalledTimes(1)
  expect(onRangeChange).toHaveBeenCalledWith('2025-01-01', '2025-01-31')
})

test('test_date_controls_apply_not_fired_when_both_invalid', () => {
  const onRangeChange = vi.fn()
  render(<DateControls onRangeChange={onRangeChange} />)

  const applyButton = screen.getByRole('button', { name: /apply/i })
  fireEvent.click(applyButton)

  expect(onRangeChange).not.toHaveBeenCalled()
})
