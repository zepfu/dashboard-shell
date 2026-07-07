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
import { useEffect, useState, type ChangeEvent, type ReactElement } from 'react'

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

  useEffect(() => {
    // C-1: mirror parent-controlled range into local draft when host updates props.
    /* eslint-disable react-hooks/set-state-in-effect -- intentional controlled sync */
    setFrom(initialFrom)
    setTo(initialTo)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [initialFrom, initialTo])

  const fromValid = isValidDateOnly(from)
  const toValid = isValidDateOnly(to)
  const rangeOrdered = from <= to
  const canApply = fromValid && toValid && rangeOrdered

  const applyDisabledReason =
    !fromValid || !toValid
      ? 'Enter valid From and To dates (YYYY-MM-DD).'
      : !rangeOrdered
        ? 'From date must be on or before To date.'
        : ''

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
          type='date'
          value={from}
          aria-invalid={from.length > 0 && !fromValid}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            setFrom(e.target.value)
          }}
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
          type='date'
          value={to}
          aria-invalid={to.length > 0 && !toValid}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            setTo(e.target.value)
          }}
          style={{ marginInlineStart: '0.25rem' }}
        />
      </label>

      <button
        type='button'
        disabled={!canApply}
        title={!canApply ? applyDisabledReason : undefined}
        aria-describedby={!canApply ? 'date-apply-hint' : undefined}
        onClick={handleApply}
      >
        Apply
      </button>
      {!canApply && applyDisabledReason.length > 0 && (
        <span id='date-apply-hint' className='sr-only'>
          {applyDisabledReason}
        </span>
      )}
    </div>
  )
}
