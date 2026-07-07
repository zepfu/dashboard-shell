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

test('test_date_controls_rejects_date_with_suffix', () => {
  const onRangeChange = vi.fn()
  render(
    <DateControls
      initialFrom='2025-01-01abc'
      initialTo='2025-01-31'
      onRangeChange={onRangeChange}
    />
  )

  expect(screen.getByRole('button', { name: /apply/i })).toBeDisabled()
})

test('test_date_controls_rejects_non_ascending_range', () => {
  const onRangeChange = vi.fn()
  render(
    <DateControls
      initialFrom='2025-02-01'
      initialTo='2025-01-31'
      onRangeChange={onRangeChange}
    />
  )

  expect(screen.getByRole('button', { name: /apply/i })).toBeDisabled()
})

// ---------------------------------------------------------------------------
// S5-35: single-day range (from === to) must be allowed
// ---------------------------------------------------------------------------

/**
 * S5-35 — a single-day range where `from === to` (e.g. 2025-06-12 → 2025-06-12)
 * must be valid and the Apply button must be enabled.
 *
 * Current implementation: `canApply = isValidDateOnly(from) && isValidDateOnly(to) && from < to`
 * The strict `from < to` rejects same-day ranges.
 *
 * Required behaviour:
 *  - from === to → Apply enabled (valid single-day range)
 *  - from > to   → Apply disabled (reversed range is still invalid)
 *
 * Additionally, the From/To inputs must use type="date" so browsers provide
 * a native date-picker (keyboard-accessible date selection).
 *
 * EXPECTED FAIL (same-day): current `from < to` (strict) rejects from===to.
 * EXPECTED FAIL (type="date"): current implementation uses type="text".
 * EXPECTED FAIL (disabled-reason): no aria-describedby or title on Apply
 * explaining WHY it is disabled.
 */
test('test_date_controls_single_day_allowed', () => {
  const onRangeChange = vi.fn()
  render(
    <DateControls
      initialFrom='2025-06-12'
      initialTo='2025-06-12'
      onRangeChange={onRangeChange}
    />
  )

  // Apply must be ENABLED for a single-day range
  const applyBtn = screen.getByRole('button', { name: /apply/i })
  expect(applyBtn).not.toBeDisabled()

  // Clicking Apply should invoke onRangeChange with the same date for both
  fireEvent.click(applyBtn)
  expect(onRangeChange).toHaveBeenCalledTimes(1)
  expect(onRangeChange).toHaveBeenCalledWith('2025-06-12', '2025-06-12')
})

test('test_date_controls_inputs_are_type_date', () => {
  const onRangeChange = vi.fn()
  render(<DateControls onRangeChange={onRangeChange} />)

  // Inputs must use type="date" for native browser date-picker support
  const fromInput = screen.getByLabelText(/from/i)
  const toInput = screen.getByLabelText(/to/i)

  expect(fromInput.getAttribute('type')).toBe('date')
  expect(toInput.getAttribute('type')).toBe('date')
})

test('test_date_controls_disabled_reason_surfaced', () => {
  const onRangeChange = vi.fn()
  render(<DateControls onRangeChange={onRangeChange} />)

  const applyBtn = screen.getByRole('button', { name: /apply/i })

  // When Apply is disabled, a reason must be surfaced to users.
  // Valid approaches: aria-describedby pointing to explanatory text,
  // or a title attribute on the button, or visible helper text.
  expect(applyBtn).toBeDisabled()

  const hasTitle = (applyBtn.getAttribute('title') ?? '').length > 0
  const hasAriaDescribedBy =
    applyBtn.hasAttribute('aria-describedby') &&
    document.getElementById(applyBtn.getAttribute('aria-describedby')!) !== null

  // At least one disabled-reason mechanism must be present
  expect(hasTitle || hasAriaDescribedBy).toBe(true)
})

// ---------------------------------------------------------------------------
// D1-451 Wave 3 — C-1 (DateControls half): re-sync when parent range changes
// ---------------------------------------------------------------------------

/**
 * When the host advances the active query range (e.g. rolling default sync),
 * From/To inputs must reflect `initialFrom` / `initialTo` — not stale local edits.
 */
test('D1-451_C1_date_controls_resync_after_user_edits_when_parent_props_change', () => {
  const onRangeChange = vi.fn()
  const { rerender } = render(
    <DateControls
      initialFrom='2026-01-01'
      initialTo='2026-01-31'
      onRangeChange={onRangeChange}
    />
  )

  fireEvent.change(screen.getByLabelText(/from/i), {
    target: { value: '2026-06-01' },
  })
  fireEvent.change(screen.getByLabelText(/^to$/i), {
    target: { value: '2026-06-15' },
  })
  expect(screen.getByLabelText(/from/i)).toHaveValue('2026-06-01')

  rerender(
    <DateControls
      initialFrom='2026-02-01'
      initialTo='2026-02-10'
      onRangeChange={onRangeChange}
    />
  )

  expect(screen.getByLabelText(/from/i)).toHaveValue('2026-02-01')
  expect(screen.getByLabelText(/^to$/i)).toHaveValue('2026-02-10')
})
