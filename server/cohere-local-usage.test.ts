import { describe, expect, test } from 'vitest'
import {
  buildCohereLocalUsagePresenceQuery,
  buildCohereLocalUsageQuery,
  buildDegradedQuotaReport,
  normalizeCohereLocalUsageReport,
  unavailableCohereLocalUsageReport,
} from './report-service'

interface NormalizedWindow {
  window: string
  model: string | null
  modelScoped: boolean
  used: number | null
  limit: number | null
  remaining: number | null
  limitState: string
  dataState: string
  windowSeconds: number | null
}

interface NormalizedReport {
  provider: string
  observationSource: string
  accounting: string
  readStatus: string
  unavailableReason: string | null
  sourceFreshness: string
  monthlyLimit: number
  rpmWindowSeconds: number
  rpmLimitState: string
  scopesTruncated: boolean
  scopes: Array<{
    routes: Array<{ lane: string | null; source: string | null }>
    windows: NormalizedWindow[]
  }>
}

function asReport(value: Record<string, unknown>): NormalizedReport {
  return value as unknown as NormalizedReport
}

const OBSERVED_AT = '2026-10-19T13:00:00.000Z'
const MONTH_START = '2026-10-01T00:00:00.000Z'
const MONTH_END = '2026-11-01T00:00:00.000Z'
const ACCOUNT_REF = 'a1b2c3d4e5f6'
const OTHER_ACCOUNT_REF = 'b1b2c3d4e5f6'

function usageRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    observed_at: OBSERVED_AT,
    month_start: MONTH_START,
    month_end: MONTH_END,
    latest_accepted_at: '2026-10-19T12:40:00.000Z',
    latest_persisted_at: '2026-10-19T12:40:00.000Z',
    monthly_row_count: 1,
    route_row_count: 1,
    rpm_row_count: 1,
    monthly_counts: [{ account_ref: ACCOUNT_REF, used: 412 }],
    routes: [
      {
        account_ref: ACCOUNT_REF,
        lane: 'cohere_native',
        source: 'codex_cohere_chat_completions_adapter',
      },
    ],
    rpm_counts: [
      { account_ref: ACCOUNT_REF, model: 'command-r-plus', used: 3 },
    ],
    credential_scope: 'scope-name-not-returned',
    evidence: { marker: 'row-evidence-marker' },
    session_id: 'session-name-not-returned',
    trace_id: 'trace-name-not-returned',
    litellm_call_id: 'call-name-not-returned',
    monthly_limit: 5,
    rpm_limit: 20,
    ...overrides,
  }
}

describe('Cohere locally counted usage query', () => {
  test('presence check does not read ledger rows', () => {
    const query = buildCohereLocalUsagePresenceQuery()

    expect(query.values).toEqual([])
    expect(query.sql).toContain(
      "to_regclass('public.locally_counted_accepted_calls')"
    )
    expect(query.sql).not.toContain(
      'FROM public.locally_counted_accepted_calls'
    )
    expect(query.sql).not.toContain('rate_limit_observations')
  })

  test('count query keeps monthly credential scope distinct from exact-model RPM', () => {
    const query = buildCohereLocalUsageQuery()

    expect(query.values).toEqual([])
    expect(query.sql).toContain('FROM public.locally_counted_accepted_calls')
    expect(query.sql).toContain("provider = 'cohere'")
    expect(query.sql).toContain("date_trunc('month', now() AT TIME ZONE 'UTC')")
    expect(query.sql).toContain(
      'accepted_at >= (SELECT month_start FROM bounds)'
    )
    expect(query.sql).toContain('accepted_at < (SELECT month_end FROM bounds)')
    expect(query.sql).toContain(
      "accepted_at > (SELECT observed_at FROM bounds) - (60 * INTERVAL '1 second')"
    )
    expect(query.sql).toContain(
      'accepted_at <= (SELECT observed_at FROM bounds)'
    )
    expect(query.sql).toContain('md5(credential_scope)')
    expect(query.sql).toContain('AS account_ref')
    expect(query.sql).not.toContain('AS credential_scope')
    expect(query.sql).not.toContain('session_id')
    expect(query.sql).not.toContain('trace_id')
    expect(query.sql).not.toContain('litellm_call_id')
    expect(query.sql).not.toContain('evidence')
    expect(query.sql).not.toContain('rate_limit_observations')
    expect(query.sql).not.toContain('session_history')
    expect(query.sql).not.toContain('1000')
    expect(query.sql).toContain('LIMIT 20')
    expect(query.sql).toContain('LIMIT 40')
    expect(query.sql).toContain('LIMIT 50')
  })
})

describe('Cohere locally counted usage normalization', () => {
  test('labels accepted-success counts and leaves RPM limits missing', () => {
    const report = asReport(
      normalizeCohereLocalUsageReport(usageRow(), {
        staleAfterMinutes: 120,
      })
    )
    const scope = report.scopes[0]
    const monthly = scope?.windows.find((window) => window.window === 'monthly')
    const rpm = scope?.windows.find((window) => window.window === 'rpm')
    const serialized = JSON.stringify(report)

    expect(report).toMatchObject({
      provider: 'cohere',
      observationSource: 'locally_counted',
      accounting: 'accepted_success',
      readStatus: 'ok',
      sourceFreshness: 'fresh',
      monthlyLimit: 1000,
      rpmWindowSeconds: 60,
      rpmLimitState: 'missing',
    })
    expect(monthly).toMatchObject({
      model: null,
      modelScoped: false,
      used: 412,
      limit: 1000,
      remaining: 588,
      limitState: 'known',
      dataState: 'known',
    })
    expect(rpm).toMatchObject({
      model: 'command-r-plus',
      modelScoped: true,
      windowSeconds: 60,
      used: 3,
      limit: null,
      remaining: null,
      limitState: 'missing',
      dataState: 'known',
    })
    expect(scope?.routes).toEqual([
      {
        lane: 'cohere_native',
        source: 'codex_cohere_chat_completions_adapter',
      },
    ])
    expect(serialized).not.toContain('scope-name-not-returned')
    expect(serialized).not.toContain('session-name-not-returned')
    expect(serialized).not.toContain('trace-name-not-returned')
    expect(serialized).not.toContain('call-name-not-returned')
    expect(serialized).not.toContain('row-evidence-marker')
    expect(serialized).not.toContain('"limit":20')
    expect(serialized).not.toContain('"limit":5')
  })

  test('keeps a successful empty UTC month at zero and a stale source labeled', () => {
    const report = asReport(
      normalizeCohereLocalUsageReport(
        usageRow({
          latest_persisted_at: '2026-10-19T08:00:00.000Z',
          monthly_row_count: 0,
          monthly_counts: [],
          routes: [],
          rpm_counts: [
            { account_ref: OTHER_ACCOUNT_REF, model: 'command-r', used: 1 },
          ],
          rpm_row_count: 1,
        }),
        { staleAfterMinutes: 120 }
      )
    )
    const monthly = report.scopes[0]?.windows.find(
      (window) => window.window === 'monthly'
    )

    expect(report.sourceFreshness).toBe('stale')
    expect(monthly).toMatchObject({
      used: 0,
      limit: 1000,
      remaining: 1000,
      dataState: 'known',
    })
  })

  test('does not synthesize a zero month when the bounded scope page is truncated', () => {
    const report = asReport(
      normalizeCohereLocalUsageReport(
        usageRow({
          monthly_row_count: 21,
          monthly_counts: [],
          routes: [],
          rpm_counts: [
            { account_ref: OTHER_ACCOUNT_REF, model: 'command-r', used: 2 },
          ],
        }),
        { staleAfterMinutes: 120 }
      )
    )
    const monthly = report.scopes[0]?.windows.find(
      (window) => window.window === 'monthly'
    )

    expect(report.scopesTruncated).toBe(true)
    expect(monthly).toMatchObject({
      used: null,
      remaining: null,
      dataState: 'unknown',
    })
  })

  test('unavailable reads have no scopes and no substituted counts', () => {
    const absent = asReport(
      unavailableCohereLocalUsageReport('relation_absent')
    )
    const failed = asReport(normalizeCohereLocalUsageReport(null))

    expect(absent).toMatchObject({
      readStatus: 'unavailable',
      unavailableReason: 'relation_absent',
      sourceFreshness: 'unavailable',
      observationSource: 'locally_counted',
      scopes: [],
    })
    expect(failed.readStatus).toBe('unavailable')
    expect(JSON.stringify(absent)).not.toContain('"used":0')
    expect(JSON.stringify(failed)).not.toContain('"used":0')
  })

  test('degraded quota report keeps the Cohere read unavailable', () => {
    const report = buildDegradedQuotaReport()

    expect(asReport(report.cohereLocalUsage)).toMatchObject({
      readStatus: 'unavailable',
      unavailableReason: 'read_failed',
      sourceFreshness: 'unavailable',
      scopes: [],
    })
  })
})
