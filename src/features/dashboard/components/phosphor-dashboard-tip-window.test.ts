/**
 * Wave 31 Q3 — Unit tests for formatTipWindow sentinel-year guard.
 *
 * The API returns `intervalEnd = "9999-12-31T00:00:00.000Z"` as a "no fixed
 * end" sentinel.  Prior to the Wave 31 fix, the formatter computed
 * (9999-12-31 − intervalStart) / 86_400_000 ≈ 2_912_303 days and emitted
 * "−2912303d → now" in the quota tooltip head.
 *
 * After the fix, any `intervalEnd` with year > 9000 is treated as the
 * "no fixed end" sentinel and the formatter falls back to the type-based
 * label ("−5h → now" / "−7d → now" etc.).
 *
 * These tests drive {@link _formatTipWindowForTest} — the test-only re-export
 * of the internal `formatTipWindow` function.
 */
import { _formatTipWindowForTest } from './phosphor-dashboard'

const { describe, it, expect } = await import('vitest')

describe('formatTipWindow — sentinel-year guard (Wave 31 Q3)', () => {
  it('falls back to -5h → now for short interval with year-9999 sentinel end', () => {
    const result = _formatTipWindowForTest(
      'short',
      '2026-05-19T10:00:00.000Z',
      '9999-12-31T00:00:00.000Z'
    )
    expect(result).toBe('−5h → now')
  })

  it('falls back to -7d → now for weekly interval with year-9999 sentinel end', () => {
    const result = _formatTipWindowForTest(
      'weekly',
      '2026-05-12T00:00:00.000Z',
      '9999-12-31T00:00:00.000Z'
    )
    expect(result).toBe('−7d → now')
  })

  it('falls back to -7d → now for special interval with year-9999 sentinel end', () => {
    const result = _formatTipWindowForTest(
      'special',
      '2026-04-19T00:00:00.000Z',
      '9999-12-31T00:00:00.000Z'
    )
    expect(result).toBe('−7d → now')
  })

  it('falls back to -5h → now for short_special interval with year-9999 sentinel end', () => {
    const result = _formatTipWindowForTest(
      'short_special',
      '2026-05-19T10:00:00.000Z',
      '9999-12-31T00:00:00.000Z'
    )
    expect(result).toBe('−5h → now')
  })

  it('does NOT treat year-8999 as a sentinel — computes span normally', () => {
    // 8999-12-31 is below the > 9000 threshold so the formatter should compute
    // the actual span.  From 2026-01-01 to 8999-12-31 ≈ 2_544_834 days — well
    // above 36h so it should emit "−Nd → now" with a very large N.
    const result = _formatTipWindowForTest(
      'weekly',
      '2026-01-01T00:00:00.000Z',
      '8999-12-31T00:00:00.000Z'
    )
    // The result should start with −, contain a large number, and end → now.
    expect(result).toMatch(/^−\d+d → now$/)
    // Should not be the short type-based fallback.
    expect(result).not.toBe('−7d → now')
  })

  it('computes normal 5h span correctly (no sentinel)', () => {
    // intervalEnd is exactly 5h after intervalStart.
    const start = '2026-05-19T10:00:00.000Z'
    const end = '2026-05-19T15:00:00.000Z'
    const result = _formatTipWindowForTest('short', start, end)
    expect(result).toBe('−5h → now')
  })

  it('computes normal 7d span correctly (no sentinel)', () => {
    const start = '2026-05-12T00:00:00.000Z'
    const end = '2026-05-19T00:00:00.000Z'
    const result = _formatTipWindowForTest('weekly', start, end)
    expect(result).toBe('−7d → now')
  })

  it('returns "this month" for monthly regardless of timestamps', () => {
    const result = _formatTipWindowForTest(
      'monthly',
      '9999-12-01T00:00:00.000Z',
      '9999-12-31T00:00:00.000Z'
    )
    expect(result).toBe('this month')
  })

  it('falls back to type label when intervalStart is null', () => {
    const result = _formatTipWindowForTest('weekly', null, null)
    expect(result).toBe('−7d → now')
  })
})
