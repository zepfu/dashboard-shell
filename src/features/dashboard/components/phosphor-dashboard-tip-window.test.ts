/**
 * Wave 45 — Unit tests for formatTipWindow absolute date+time format.
 *
 * Wave 45 changes formatTipWindow to emit `M/D HH:MM → M/D HH:MM` (absolute,
 * 30-min snapped) instead of relative labels like `−5h → now`.  Monthly quotas
 * still return `this month`.
 *
 * Sentinel guard: the API uses year 9999 (e.g. "9999-12-31T00:00:00.000Z") to
 * mean "no fixed end" for ongoing intervals. For current bars the window end IS
 * "now", so the sentinel is substituted with `new Date()` and the tooltip shows
 * the snapped current moment rather than a far-future year or a bare dash.
 *
 * These tests drive {@link _formatTipWindowForTest} — the test-only re-export
 * of the internal `formatTipWindow` function.
 */
import { _formatTipWindowForTest } from './phosphor-dashboard'

const { describe, it, expect, beforeEach, afterEach, vi } =
  await import('vitest')

describe('formatTipWindow — absolute date+time (Wave 45)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses current time as end for short interval with year-9999 sentinel', () => {
    // Freeze time at a known moment so we can assert the exact snapped output.
    vi.setSystemTime(new Date('2026-05-19T15:00:00.000Z'))
    const result = _formatTipWindowForTest(
      'short',
      '2026-05-19T10:00:00.000Z',
      '9999-12-31T00:00:00.000Z'
    )
    // start snaps to 10:00, end = now = 15:00 (already on boundary)
    expect(result).toBe('5/19 10:00 → 5/19 15:00')
  })

  it('uses current time as end for weekly interval with year-9999 sentinel', () => {
    vi.setSystemTime(new Date('2026-05-19T12:00:00.000Z'))
    const result = _formatTipWindowForTest(
      'weekly',
      '2026-05-12T00:00:00.000Z',
      '9999-12-31T00:00:00.000Z'
    )
    // start = 5/12 00:00, end = now = 5/19 12:00
    expect(result).toBe('5/12 00:00 → 5/19 12:00')
  })

  it('uses current time as end for special interval with year-9999 sentinel', () => {
    vi.setSystemTime(new Date('2026-05-20T08:30:00.000Z'))
    const result = _formatTipWindowForTest(
      'special',
      '2026-04-19T00:00:00.000Z',
      '9999-12-31T00:00:00.000Z'
    )
    // start = 4/19 00:00, end = now = 5/20 08:30
    expect(result).toBe('4/19 00:00 → 5/20 08:30')
  })

  it('uses current time as end for short_special interval with year-9999 sentinel', () => {
    vi.setSystemTime(new Date('2026-05-19T10:00:00.000Z'))
    const result = _formatTipWindowForTest(
      'short_special',
      '2026-05-19T05:00:00.000Z',
      '9999-12-31T00:00:00.000Z'
    )
    // start = 5/19 05:00, end = now = 5/19 10:00
    expect(result).toBe('5/19 05:00 → 5/19 10:00')
  })

  it('does NOT treat year-8999 as a sentinel — emits absolute date+time', () => {
    vi.setSystemTime(new Date('2026-05-19T12:00:00.000Z'))
    const result = _formatTipWindowForTest(
      'weekly',
      '2026-01-01T00:00:00.000Z',
      '8999-12-31T00:00:00.000Z'
    )
    // Should contain '→' (compact range format) and NOT be '—'
    expect(result).toContain('→')
    expect(result).not.toBe('—')
    // The end date is 8999-12-31 (M/D = 12/31); the formatter uses no year.
    // Primary check: the result must not use the current time (5/19 12:00) as
    // the end — confirming 8999 was NOT treated as a sentinel.
    expect(result).not.toMatch(/→ 5\/19 12:00$/)
    // The start is 2026-01-01 → snaps to 1/1 00:00
    expect(result).toMatch(/^1\/1 00:00 →/)
  })

  it('emits absolute date+time for a 5h short interval', () => {
    vi.setSystemTime(new Date('2026-05-19T15:00:00.000Z'))
    const start = '2026-05-19T10:00:00.000Z'
    const end = '2026-05-19T15:00:00.000Z'
    const result = _formatTipWindowForTest('short', start, end)
    expect(result).toBe('5/19 10:00 → 5/19 15:00')
  })

  it('emits absolute date+time for a 7d weekly interval', () => {
    vi.setSystemTime(new Date('2026-05-19T12:00:00.000Z'))
    const start = '2026-05-12T00:00:00.000Z'
    const end = '2026-05-19T00:00:00.000Z'
    const result = _formatTipWindowForTest('weekly', start, end)
    expect(result).toBe('5/12 00:00 → 5/19 00:00')
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
    // start at :04 → snaps to :00; end at :52 → snaps to :00 next hour (15:00)
    const result = _formatTipWindowForTest(
      'short',
      '2026-05-19T10:04:00.000Z',
      '2026-05-19T14:52:00.000Z'
    )
    // :04 → 10:00, :52 → 15:00
    expect(result).toBe('5/19 10:00 → 5/19 15:00')
  })

  it('emits absolute date+time for a 24h short interval crossing a day boundary', () => {
    vi.setSystemTime(new Date('2026-05-20T00:00:00.000Z'))
    const start = '2026-05-19T00:00:00.000Z'
    const end = '2026-05-20T00:00:00.000Z'
    const result = _formatTipWindowForTest('short', start, end)
    expect(result).toBe('5/19 00:00 → 5/20 00:00')
  })
})
