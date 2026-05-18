/**
 * DateControls — date-range and grain picker for Phosphor Atlas.
 *
 * Provides quick-select period buttons (24h / 7d / 30d / 90d / YTD) plus
 * free-form from/to inputs and a grain selector. Emits the selected range
 * via `onRangeChange` whenever a quick-button is clicked or the Apply
 * button is pressed.
 */
import { useState, type ReactElement, type ChangeEvent } from 'react'

interface DateControlsProps {
  initialFrom?: string
  initialTo?: string
  initialGrain?: string
  onRangeChange: (from: string, to: string, grain: string) => void
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/

/** Format a Date as a YYYY-MM-DD string. */
function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Build a date N calendar days before today. */
function subDays(now: Date, n: number): string {
  const d = new Date(now)
  d.setDate(d.getDate() - n)
  return toISODate(d)
}

/**
 * DateControls renders date-range controls with quick-period shortcuts.
 */
export function DateControls({
  initialFrom = '',
  initialTo = '',
  initialGrain = 'day',
  onRangeChange,
}: DateControlsProps): ReactElement {
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(initialTo)
  const [grain, setGrain] = useState(initialGrain)

  const applyRange = (
    nextFrom: string,
    nextTo: string,
    nextGrain: string
  ): void => {
    setFrom(nextFrom)
    setTo(nextTo)
    onRangeChange(nextFrom, nextTo, nextGrain)
  }

  const handlePeriod = (days: number | 'ytd'): void => {
    const now = new Date()
    const nextTo = toISODate(now)
    const nextFrom =
      days === 'ytd'
        ? toISODate(new Date(now.getFullYear(), 0, 1))
        : subDays(now, days as number)
    applyRange(nextFrom, nextTo, grain)
  }

  const isValidDate = (val: string): boolean => ISO_DATE_RE.test(val)
  const canApply = isValidDate(from) && isValidDate(to)

  const handleApply = (): void => {
    if (canApply) {
      onRangeChange(from, to, grain)
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
      <button
        type='button'
        onClick={() => {
          handlePeriod(1)
        }}
      >
        24h
      </button>
      <button
        type='button'
        onClick={() => {
          handlePeriod(7)
        }}
      >
        7d
      </button>
      <button
        type='button'
        onClick={() => {
          handlePeriod(30)
        }}
      >
        30d
      </button>
      <button
        type='button'
        onClick={() => {
          handlePeriod(90)
        }}
      >
        90d
      </button>
      <button
        type='button'
        onClick={() => {
          handlePeriod('ytd')
        }}
      >
        YTD
      </button>

      <label
        htmlFor='date-from'
        style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}
      >
        From
        <input
          id='date-from'
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

      <label
        htmlFor='date-grain'
        style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}
      >
        Grain
        <select
          id='date-grain'
          value={grain}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => {
            setGrain(e.target.value)
          }}
          style={{ marginInlineStart: '0.25rem' }}
        >
          {/* Note: 'hour' grain is NOT listed — the server returns HTTP 500 for grain=hour.
              Valid server grains are day | week | month only. */}
          <option value='day'>day</option>
          <option value='week'>week</option>
          <option value='month'>month</option>
        </select>
      </label>

      <button type='button' disabled={!canApply} onClick={handleApply}>
        Apply
      </button>
    </div>
  )
}
