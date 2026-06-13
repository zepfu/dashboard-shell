/**
 * Smoke tests for plan-adversarial-review-20260612.md (Wave 5).
 *
 * These tests validate that Wave 5 features work end-to-end after
 * implementation. They become permanent regression guards.
 *
 * See: .analysis/plan-adversarial-review-20260612.md § Smoke Test Procedure
 *
 * Wave 5 specific smoke assertions:
 *   - Data-layer boundary functions import without error.
 *   - Alert hook produces deterministic output with synthetic data.
 *   - Net-new exports (signedDelta, usageReportQuotasKey) exist.
 */
import { describe, expect, test } from 'vitest'
import {
  buildDashboardAlertSummary,
  useAlertsFromAnomalies,
} from '../../features/dashboard/hooks/use-alerts-from-anomalies'
import { useAnomalyDetection } from '../../features/dashboard/hooks/use-anomaly-detection'
import { Dashboard } from '../../features/dashboard/index'
import { agentQualityFromFlatRow } from '../../features/dashboard/lib/agent-quality'
import { fmtCompact, numFmt } from '../../features/dashboard/lib/format-utils'
import {
  formatDashboardFreshness,
  formatRecencyValue,
  maxIsoTimestamp,
} from '../../features/dashboard/lib/freshness'
import {
  addDaysToDateString,
  colorWithAlpha,
  computeFleetErrors,
  computeFleetP95,
  formatDashboardDate,
} from '../../features/dashboard/lib/usage-report-display'

// ─────────────────────────────────────────────────────────────────────────────
// Import checks: all Wave 5 symbols must be importable
// ─────────────────────────────────────────────────────────────────────────────

test('test_usage_report_display_imports', () => {
  expect(typeof addDaysToDateString).toBe('function')
  expect(typeof colorWithAlpha).toBe('function')
  expect(typeof formatDashboardDate).toBe('function')
  expect(typeof computeFleetErrors).toBe('function')
  expect(typeof computeFleetP95).toBe('function')
})

test('test_format_utils_imports', () => {
  expect(typeof fmtCompact).toBe('function')
  expect(typeof numFmt).toBe('function')
})

test('test_freshness_imports', () => {
  expect(typeof formatRecencyValue).toBe('function')
  expect(typeof maxIsoTimestamp).toBe('function')
  expect(typeof formatDashboardFreshness).toBe('function')
})

test('test_agent_quality_imports', () => {
  expect(typeof agentQualityFromFlatRow).toBe('function')
})

test('test_use_anomaly_detection_imports', () => {
  expect(typeof useAnomalyDetection).toBe('function')
})

test('test_use_alerts_from_anomalies_imports', () => {
  expect(typeof buildDashboardAlertSummary).toBe('function')
  expect(typeof useAlertsFromAnomalies).toBe('function')
})

// ─────────────────────────────────────────────────────────────────────────────
// Net-new export checks: RED until engineer creates them
// ─────────────────────────────────────────────────────────────────────────────

/**
 * signedDelta must be exported from usage-report-display.ts (S4-T6).
 * RED until the engineer creates the export.
 */
test('test_signedDelta_exports_from_usage_report_display', async () => {
  const mod = await import('../../features/dashboard/lib/usage-report-display')
  const fn = (mod as unknown as Record<string, unknown>)['signedDelta']
  expect(typeof fn).toBe('function')
})

/**
 * usageReportQuotasKey must be exported from index.tsx (S4-T5/S4-20).
 * RED until the engineer creates the export.
 */
test('test_usageReportQuotasKey_exports_from_index', async () => {
  const mod = await import('../../features/dashboard/index')
  const fn = (mod as unknown as Record<string, unknown>)['usageReportQuotasKey']
  expect(typeof fn).toBe('function')
})

// ─────────────────────────────────────────────────────────────────────────────
// Logic checks with synthetic data
// ─────────────────────────────────────────────────────────────────────────────

describe('buildDashboardAlertSummary smoke (synthetic data)', () => {
  const emptyAnomalies = {
    earlyReset: new Map<string, { prior: string; current: string }>(),
    cacheStale: false,
  }

  test('empty anomalies with no data produces ok severity', () => {
    const result = buildDashboardAlertSummary({
      anomalies: emptyAnomalies,
      now: new Date('2026-06-13T12:00:00Z'),
    })
    expect(result.severity).toBe('ok')
    expect(Array.isArray(result.issues)).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  test('cache stale flag produces warning severity', () => {
    const result = buildDashboardAlertSummary({
      anomalies: { earlyReset: new Map(), cacheStale: true },
      now: new Date('2026-06-13T12:00:00Z'),
    })
    expect(result.severity).toBe('warning')
    expect(result.issues.some((i) => i.severity === 'warning')).toBe(true)
  })
})

describe('formatRecencyValue smoke (synthetic data)', () => {
  test('valid ISO returns formatted string with UTC suffix', () => {
    const result = formatRecencyValue(
      '2026-06-13T10:00:00.000Z',
      new Date('2026-06-13T10:05:00.000Z')
    )
    expect(result).toContain('UTC')
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}/)
  })

  test('null returns double-dash sentinel', () => {
    expect(formatRecencyValue(null, new Date())).toBe('--')
  })
})

describe('addDaysToDateString smoke (boundary guard)', () => {
  test('valid date advances correctly', () => {
    expect(addDaysToDateString('2026-06-13', 7)).toBe('2026-06-20')
    expect(addDaysToDateString('2026-12-28', 5)).toBe('2027-01-02')
  })
})

describe('agentQualityFromFlatRow smoke (synthetic data)', () => {
  test('returns defined summary for valid flat row', () => {
    const summary = agentQualityFromFlatRow({
      traces: 5,
      agent_score_rows: 5,
      agent_quality_score: 1.0,
      agent_quality_evaluated: 5,
      agent_quality_possible: 5,
      agent_quality_failures: 0,
    })
    expect(summary).toBeDefined()
    expect(summary?.quality.evaluated).toBe(5)
    expect(summary?.quality.score).toBe(1.0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Plan-level smoke assertions (Smoke Test Procedure)
// ─────────────────────────────────────────────────────────────────────────────

test('test_dashboard_mounts_with_populated_report_symbol_check', () => {
  // Dashboard component is exported and is a function (component)
  expect(typeof Dashboard).toBe('function')
})

/**
 * test_no_axios_import_after_w9: activate after W9 deletion sprint.
 */
test.todo('test_no_axios_import_after_w9 — activate after W9 deletion sprint')

/**
 * test_lazy_tooltip_not_in_dom_until_hover: activate after W11.
 */
test.todo(
  'test_lazy_tooltip_not_in_dom_until_hover — activate after W11 tooltip refactor'
)
