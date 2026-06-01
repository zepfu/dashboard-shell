/**
 * DateControls — date-range picker for Phosphor Atlas.
 *
 * Wave 16-V operator decisions:
 * - Period quick-buttons (24h / 7d / 30d / 90d / YTD) removed entirely.
 *   Date selection is now purely user-driven via From/To inputs + Apply.
 * - Grain <select> removed; grain is hardcoded to 'day' at the call site.
 *
 * The component's visible UI is three elements only:
 *   [From input] [To input] [Apply]
 *
 * Apply is disabled until both inputs match YYYY-MM-DD format.
 */
import { useState, type ReactElement, type ChangeEvent } from 'react'

interface DateControlsProps {
  initialFrom?: string
  initialTo?: string
  onRangeChange: (from: string, to: string) => void
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isValidDateOnly(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  )
}

/**
 * DateControls renders From/To date inputs with an Apply button.
 */
export function DateControls({
  initialFrom = '',
  initialTo = '',
  onRangeChange,
}: DateControlsProps): ReactElement {
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(initialTo)

  const canApply = isValidDateOnly(from) && isValidDateOnly(to) && from < to

  const handleApply = (): void => {
    if (canApply) {
      onRangeChange(from, to)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.5rem',
        alignItems: 'center',
      }}
    >
      <label
        htmlFor='date-from'
        style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}
      >
        From
        <input
          id='date-from'
          data-shortcut-target='first-date'
          type='text'
          value={from}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            setFrom(e.target.value)
          }}
          placeholder='YYYY-MM-DD'
          style={{ marginInlineStart: '0.25rem' }}
        />
      </label>

      <label
        htmlFor='date-to'
        style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}
      >
        To
        <input
          id='date-to'
          type='text'
          value={to}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            setTo(e.target.value)
          }}
          placeholder='YYYY-MM-DD'
          style={{ marginInlineStart: '0.25rem' }}
        />
      </label>

      <button type='button' disabled={!canApply} onClick={handleApply}>
        Apply
      </button>
    </div>
  )
}
