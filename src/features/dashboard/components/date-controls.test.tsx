/**
 * Wave 2 — DateControls red-phase tests.
 *
 * Component path: src/features/dashboard/components/date-controls.tsx
 * Expected export: DateControls (named)
 * Props: { initialFrom?: string; initialTo?: string; initialGrain?: string; onRangeChange: (from: string, to: string, grain: string) => void }
 *
 * All tests expected to FAIL (red) — source file does not exist yet.
 */
// @ts-expect-error -- module does not exist yet (red phase)
import { render, screen, fireEvent } from '@testing-library/react'
import { DateControls } from './date-controls'

test('test_date_controls_period_24h_sets_range', () => {
  const onRangeChange = vi.fn()
  render(<DateControls onRangeChange={onRangeChange} />)

  const btn24h = screen.getByRole('button', { name: /24h/i })
  fireEvent.click(btn24h)

  expect(onRangeChange).toHaveBeenCalledTimes(1)

  const [from, to] = onRangeChange.mock.calls[0] as [string, string, string]

  // from should be roughly yesterday, to should be roughly today (allow ±1 day)
  const fromDate = new Date(from)
  const toDate = new Date(to)
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)

  // Within 2 days of yesterday and today respectively
  expect(Math.abs(fromDate.getTime() - yesterday.getTime())).toBeLessThan(
    2 * 24 * 60 * 60 * 1000
  )
  expect(Math.abs(toDate.getTime() - now.getTime())).toBeLessThan(
    2 * 24 * 60 * 60 * 1000
  )
})

test('test_date_controls_period_ytd_sets_range', () => {
  const onRangeChange = vi.fn()
  render(<DateControls onRangeChange={onRangeChange} />)

  const btnYtd = screen.getByRole('button', { name: /ytd/i })
  fireEvent.click(btnYtd)

  expect(onRangeChange).toHaveBeenCalledTimes(1)

  const [from, to] = onRangeChange.mock.calls[0] as [string, string, string]

  const currentYear = new Date().getFullYear()
  // from should be Jan 1 of this year
  expect(from).toMatch(new RegExp(`^${currentYear}-01-01`))

  // to should be today (current year matches)
  const toDate = new Date(to)
  expect(toDate.getFullYear()).toBe(currentYear)
})

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
