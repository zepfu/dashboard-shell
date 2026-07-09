/**
 * Default date range when dashboard renders without from/to props.
 * Wave 11: extracted from phosphor-dashboard.testkit.ts
 *
 * Wave 3 (P04-F06): also hosts the DST-safe prior-window helper used by
 * PhosphorDashboard's periodDays / priorFrom math.
 */
import {
  addDaysToDateString,
  formatDashboardDate,
} from './usage-report-display'

export function localFallbackRange(): { from: string; to: string } {
  const today = formatDashboardDate(new Date())
  return {
    from: addDaysToDateString(today, -30),
    to: addDaysToDateString(today, 1),
  }
}

/**
 * Prior-window bounds for a half-open Eastern calendar-day range.
 *
 * Uses string-day arithmetic (`addDaysToDateString`) rather than raw
 * `Date` / `86_400_000` math so DST transitions cannot shift the span.
 *
 * Example (US spring-forward 2025-03-09):
 *   current 2025-03-08 → 2025-03-12 = 4 Eastern days
 *   prior   2025-03-04 → 2025-03-08
 */
export function computePriorReportWindow(
  from: string,
  to: string
): { periodDays: number; priorFrom: string; priorTo: string } {
  let periodDays = 0
  let cursor = from
  // Guard against runaway if helpers ever regress.
  while (cursor < to && periodDays < 10_000) {
    cursor = addDaysToDateString(cursor, 1)
    periodDays += 1
  }
  periodDays = Math.max(1, periodDays)
  const priorTo = from
  const priorFrom = addDaysToDateString(from, -periodDays)
  return { periodDays, priorFrom, priorTo }
}
