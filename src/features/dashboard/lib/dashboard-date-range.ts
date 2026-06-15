/**
 * Default date range when dashboard renders without from/to props.
 * Wave 11: extracted from phosphor-dashboard.testkit.ts
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
