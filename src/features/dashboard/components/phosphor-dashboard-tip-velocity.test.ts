/**
 * Unit tests for formatTipVelocity.
 *
 * `formatTipVelocity` derives a reset-window-aware average burn-rate label from
 * consumedPct, resetAt, and quota duration. It is exported for testing via the
 * `_formatTipVelocityForTest` alias.
 */
import { _formatTipVelocityForTest } from './phosphor-dashboard'

const { describe, it, expect, beforeEach, afterEach, vi } =
  await import('vitest')

describe('formatTipVelocity', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns undefined when resetAt is null', () => {
    vi.setSystemTime(new Date('2026-05-19T12:00:00.000Z'))
    expect(_formatTipVelocityForTest(50, null, 5)).toBeUndefined()
  })

  it('returns undefined when consumedPct is 0', () => {
    vi.setSystemTime(new Date('2026-05-19T09:00:00.000Z'))
    expect(
      _formatTipVelocityForTest(0, '2026-05-19T12:00:00.000Z', 5)
    ).toBeUndefined()
  })

  it('returns undefined for an invalid reset timestamp', () => {
    vi.setSystemTime(new Date('2026-05-19T12:00:00.000Z'))
    expect(_formatTipVelocityForTest(30, 'not-a-date', 5)).toBeUndefined()
  })

  it('returns undefined for an invalid duration', () => {
    vi.setSystemTime(new Date('2026-05-19T12:00:00.000Z'))
    expect(
      _formatTipVelocityForTest(30, '2026-05-19T12:00:00.000Z', 0)
    ).toBeUndefined()
  })

  it('returns undefined before the derived reset window has started', () => {
    vi.setSystemTime(new Date('2026-05-19T06:00:00.000Z'))
    expect(
      _formatTipVelocityForTest(10, '2026-05-19T12:00:00.000Z', 5)
    ).toBeUndefined()
  })

  it('computes an hourly average for short reset windows', () => {
    vi.setSystemTime(new Date('2026-05-19T09:30:00.000Z'))
    expect(_formatTipVelocityForTest(10, '2026-05-19T12:00:00.000Z', 5)).toBe(
      'avg +4.0%/h since reset'
    )
  })

  it('computes a daily average for long reset windows', () => {
    vi.setSystemTime(new Date('2026-05-20T12:00:00.000Z'))
    expect(_formatTipVelocityForTest(14, '2026-05-26T12:00:00.000Z', 168)).toBe(
      'avg +14.0%/d since reset'
    )
  })

  it('caps elapsed time at reset when now is past resetAt', () => {
    vi.setSystemTime(new Date('2026-05-19T13:00:00.000Z'))
    expect(_formatTipVelocityForTest(10, '2026-05-19T12:00:00.000Z', 5)).toBe(
      'avg +2.0%/h since reset'
    )
  })
})
