/**
 * Wave 35 S4 — Unit tests for formatTipVelocity.
 *
 * `formatTipVelocity` derives a "+X.X%/h" burn-rate label from
 * `consumedPct` and `intervalStart`.  It is exported for testing via the
 * `_formatTipVelocityForTest` alias.
 *
 * Boundary cases verified:
 * - null intervalStart → undefined (no data)
 * - consumedPct === 0 → undefined (nothing consumed yet)
 * - invalid ISO string → undefined (NaN guard)
 * - future intervalStart → undefined (hoursElapsed ≤ 0)
 * - normal case → "+X.X%/h" formatted string
 */
import { _formatTipVelocityForTest } from './phosphor-dashboard'

const { describe, it, expect, beforeEach, afterEach, vi } =
  await import('vitest')

describe('formatTipVelocity — Wave 35 S4', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns undefined when intervalStart is null', () => {
    vi.setSystemTime(new Date('2026-05-19T12:00:00.000Z'))
    expect(_formatTipVelocityForTest(50, null)).toBeUndefined()
  })

  it('returns undefined when consumedPct is 0', () => {
    vi.setSystemTime(new Date('2026-05-19T12:00:00.000Z'))
    const start = '2026-05-19T07:00:00.000Z' // 5h ago
    expect(_formatTipVelocityForTest(0, start)).toBeUndefined()
  })

  it('returns undefined for an invalid ISO timestamp', () => {
    vi.setSystemTime(new Date('2026-05-19T12:00:00.000Z'))
    expect(_formatTipVelocityForTest(30, 'not-a-date')).toBeUndefined()
  })

  it('returns undefined when intervalStart is in the future', () => {
    vi.setSystemTime(new Date('2026-05-19T12:00:00.000Z'))
    const futureStart = '2026-05-19T14:00:00.000Z' // 2h in the future
    expect(_formatTipVelocityForTest(10, futureStart)).toBeUndefined()
  })

  it('computes "+2.0%/h" for 10% consumed over 5h', () => {
    vi.setSystemTime(new Date('2026-05-19T12:00:00.000Z'))
    const start = '2026-05-19T07:00:00.000Z' // 5h ago
    expect(_formatTipVelocityForTest(10, start)).toBe('+2.0%/h')
  })

  it('computes "+10.0%/h" for 70% consumed over 7h', () => {
    vi.setSystemTime(new Date('2026-05-19T12:00:00.000Z'))
    const start = '2026-05-19T05:00:00.000Z' // 7h ago
    expect(_formatTipVelocityForTest(70, start)).toBe('+10.0%/h')
  })

  it('returns a string starting with "+" and ending with "%/h"', () => {
    vi.setSystemTime(new Date('2026-05-19T12:00:00.000Z'))
    const start = '2026-05-19T10:00:00.000Z' // 2h ago
    const result = _formatTipVelocityForTest(30, start)
    expect(result).not.toBeUndefined()
    expect(result).toMatch(/^\+[\d.]+%\/h$/)
  })

  it('rounds to one decimal place', () => {
    // 17% over 5h = 3.4%/h — should render "+3.4%/h"
    vi.setSystemTime(new Date('2026-05-19T12:00:00.000Z'))
    const start = '2026-05-19T07:00:00.000Z' // 5h ago
    expect(_formatTipVelocityForTest(17, start)).toBe('+3.4%/h')
  })
})
