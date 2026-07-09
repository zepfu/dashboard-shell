/**
 * D1-450 Wave 1 — quota-bars/fields behavioral contract (G3, I1, E1, E2).
 */
import { describe, expect, test } from 'vitest'
import {
  buildQuotaSegments,
  formatTimeAgo,
  quotaTypeToBarPeriodType,
} from './fields'

describe('weekly_special classification (D1-450 I1)', () => {
  test('production quotaTypeToBarPeriodType maps weekly_special to special', () => {
    expect(quotaTypeToBarPeriodType('weekly_special')).toBe('special')
  })
})

describe('formatTimeAgo future timestamps (D1-450 G3)', () => {
  test('timestamps more than one minute in the future use "in …" not "ago"', () => {
    const thirtyMinutesAhead = new Date(Date.now() + 30 * 60_000)
    const label = formatTimeAgo(thirtyMinutesAhead)
    expect(label).toMatch(/^in \d+m$/)
    expect(label).not.toMatch(/ago$/)
  })
})

describe('buildQuotaSegments dead parameter (D1-450 E1)', () => {
  test('velocitySegments is not part of the public segment builder signature', () => {
    expect(buildQuotaSegments.length).toBe(1)
    const segments = buildQuotaSegments(75)
    expect(segments).toHaveLength(100)
    expect(segments[0]).toMatchObject({
      widthPct: 1,
      severityClass: expect.any(String),
    })
  })
})
