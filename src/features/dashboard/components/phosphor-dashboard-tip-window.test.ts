/**
 * Wave 45 — Unit tests for formatTipWindow absolute date+time format.
 *
 * I4 placement: component-adjacent tests via `_formatTipWindowForTest` re-export from
 * `phosphor-dashboard.helpers.ts`; implementation lives in `lib/quota-bars/fields.ts`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { _formatTipWindowForTest } from './phosphor-dashboard.helpers'

describe('formatTipWindow — absolute date+time (Wave 45)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses current time as end for short interval with year-9999 sentinel', () => {
    vi.setSystemTime(new Date('2026-05-19T15:00:00.000Z'))
    const result = _formatTipWindowForTest(
      'short',
      '2026-05-19T10:00:00.000Z',
      '9999-12-31T00:00:00.000Z'
    )
    expect(result).toBe('5/19 06:00 → 5/19 11:00')
  })

  it('uses current time as end for weekly interval with year-9999 sentinel', () => {
    vi.setSystemTime(new Date('2026-05-19T12:00:00.000Z'))
    const result = _formatTipWindowForTest(
      'weekly',
      '2026-05-12T00:00:00.000Z',
      '9999-12-31T00:00:00.000Z'
    )
    expect(result).toBe('5/11 20:00 → 5/19 08:00')
  })

  it('uses current time as end for special interval with year-9999 sentinel', () => {
    vi.setSystemTime(new Date('2026-05-20T08:30:00.000Z'))
    const result = _formatTipWindowForTest(
      'special',
      '2026-04-19T00:00:00.000Z',
      '9999-12-31T00:00:00.000Z'
    )
    expect(result).toBe('4/18 20:00 → 5/20 04:30')
  })

  it('uses current time as end for short_special interval with year-9999 sentinel', () => {
    vi.setSystemTime(new Date('2026-05-19T10:00:00.000Z'))
    const result = _formatTipWindowForTest(
      'short_special',
      '2026-05-19T05:00:00.000Z',
      '9999-12-31T00:00:00.000Z'
    )
    expect(result).toBe('5/19 01:00 → 5/19 06:00')
  })

  it('does NOT treat year-8999 as a sentinel — emits absolute date+time', () => {
    vi.setSystemTime(new Date('2026-05-19T12:00:00.000Z'))
    const result = _formatTipWindowForTest(
      'weekly',
      '2026-01-01T00:00:00.000Z',
      '8999-12-31T00:00:00.000Z'
    )
    expect(result).toContain('→')
    expect(result).not.toBe('—')
    expect(result).not.toMatch(/→ 5\/19 12:00$/)
    expect(result).toMatch(/^12\/31 19:00 →/)
  })

  it('emits absolute date+time for a 5h short interval', () => {
    vi.setSystemTime(new Date('2026-05-19T15:00:00.000Z'))
    const result = _formatTipWindowForTest(
      'short',
      '2026-05-19T10:00:00.000Z',
      '2026-05-19T15:00:00.000Z'
    )
    expect(result).toBe('5/19 06:00 → 5/19 11:00')
  })

  it('emits absolute date+time for a 7d weekly interval', () => {
    vi.setSystemTime(new Date('2026-05-19T12:00:00.000Z'))
    const result = _formatTipWindowForTest(
      'weekly',
      '2026-05-12T00:00:00.000Z',
      '2026-05-19T00:00:00.000Z'
    )
    expect(result).toBe('5/11 20:00 → 5/18 20:00')
  })

  it('returns "this month" for monthly regardless of timestamps', () => {
    vi.setSystemTime(new Date('2026-05-19T12:00:00.000Z'))
    const result = _formatTipWindowForTest(
      'monthly',
      '9999-12-01T00:00:00.000Z',
      '9999-12-31T00:00:00.000Z'
    )
    expect(result).toBe('this month')
  })

  it('returns "—" when intervalStart is null', () => {
    vi.setSystemTime(new Date('2026-05-19T12:00:00.000Z'))
    const result = _formatTipWindowForTest('weekly', null, null)
    expect(result).toBe('—')
  })

  it('snaps sub-30-min offsets to nearest boundary', () => {
    vi.setSystemTime(new Date('2026-05-19T15:00:00.000Z'))
    const result = _formatTipWindowForTest(
      'short',
      '2026-05-19T10:04:00.000Z',
      '2026-05-19T14:52:00.000Z'
    )
    expect(result).toBe('5/19 06:00 → 5/19 11:00')
  })

  it('emits absolute date+time for a 24h short interval crossing a day boundary', () => {
    vi.setSystemTime(new Date('2026-05-20T00:00:00.000Z'))
    const result = _formatTipWindowForTest(
      'short',
      '2026-05-19T00:00:00.000Z',
      '2026-05-20T00:00:00.000Z'
    )
    expect(result).toBe('5/18 20:00 → 5/19 20:00')
  })
})
