/**
 * Source-contract for scripts/configure-dashboard-refresh-cron.sql.
 * Distinguishes allowed exact legacy dashboard_shell_* names in cleanup/
 * unschedule from forbidden use as active schedule owners or wildcard cleanup.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const sqlPath = resolve(
  process.cwd(),
  'scripts/configure-dashboard-refresh-cron.sql'
)
const sql = readFileSync(sqlPath, 'utf8')

const STABLE_JOB_NAMES = [
  'aawm_rate_limit_intervals_refresh',
  'aawm_rate_limit_intervals_analyze',
  'aawm_provider_latency_health_5m_refresh',
  'aawm_provider_latency_health_5m_analyze',
] as const

const LEGACY_JOB_NAMES = [
  'dashboard_shell_rate_limit_intervals_refresh',
  'dashboard_shell_rate_limit_intervals_analyze',
  'dashboard_shell_provider_latency_health_5m_refresh',
  'dashboard_shell_provider_latency_health_5m_analyze',
] as const

const RATE_LIMIT_REFRESH_COMMAND =
  "SELECT public.dashboard_shell_maintain_materialized_view('rate_limit_intervals', 'refresh')"

function extractCronScheduleNames(source: string): string[] {
  const names: string[] = []
  const re = /cron\.schedule\(\s*'([^']+)'/g
  for (const match of source.matchAll(re)) {
    names.push(match[1]!)
  }
  return names
}

function extractAlterJobNames(source: string): string[] {
  const names: string[] = []
  const re =
    /cron\.alter_job\([\s\S]*?\)\s*FROM\s+cron\.job\s*WHERE\s+jobname\s*=\s*'([^']+)'/g
  for (const match of source.matchAll(re)) {
    names.push(match[1]!)
  }
  return names
}

function extractInvariantExpectedNames(source: string): string[] {
  const block = source.match(
    /FROM\s*\(\s*VALUES\s*((?:\('[^']+'\),?\s*)+)\)\s*AS expected\(expected_name\)\s*LEFT JOIN cron\.job/s
  )
  if (!block) return []
  return [...block[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!)
}

function extractFinalReportNames(source: string): string[] {
  const blocks = [
    ...source.matchAll(/WHERE jobname IN \(\s*((?:'[^']+',?\s*)+)\)/gs),
  ]
  if (blocks.length === 0) return []
  // Final reported active set is the last IN-list (after cleanup + report).
  const last = blocks[blocks.length - 1]!
  return [...last[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!)
}

function extractUnscheduleContext(source: string): string {
  const match = source.match(
    /Remove only the four exact obsolete dashboard_shell_[\s\S]*?END;\s*\$\$;/s
  )
  return match?.[0] ?? ''
}

describe('configure-dashboard-refresh-cron source contract', () => {
  test('enables ON_ERROR_STOP before any SQL DDL/DML', () => {
    const onErrorStop = sql.match(/\\set\s+ON_ERROR_STOP\s+on\b/i)
    expect(onErrorStop).not.toBeNull()

    const directiveIndex = onErrorStop!.index!
    const beforeDirective = sql.slice(0, directiveIndex)
    // Only blank lines and SQL comments may precede the fail-fast directive.
    expect(beforeDirective).toMatch(/^(?:\s|--[^\n]*\n)*$/)

    const afterDirective = sql.slice(directiveIndex + onErrorStop![0].length)
    // The first SQL statement after the directive must be DDL/DML, not more meta-commands only.
    expect(afterDirective).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.dashboard_shell_maintain_materialized_view/i
    )
  })

  test('preserves nonblocking advisory lock and concurrent refresh behavior', () => {
    expect(sql).toContain('pg_try_advisory_lock')
    expect(sql).toContain('pg_advisory_unlock')
    expect(sql).not.toContain('pg_advisory_xact_lock')
    expect(sql).toContain(
      'dashboard-shell materialized-view maintenance skipped because another maintenance job is active'
    )
    expect(sql).toContain(
      'REFRESH MATERIALIZED VIEW CONCURRENTLY public.rate_limit_intervals'
    )
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.dashboard_shell_maintain_materialized_view'
    )
  })

  test('schedules, alters, validates, and reports only the four stable aawm_* names', () => {
    const scheduled = extractCronScheduleNames(sql)
    const altered = extractAlterJobNames(sql)
    const invariant = extractInvariantExpectedNames(sql)
    const reported = extractFinalReportNames(sql)

    expect(scheduled).toEqual([...STABLE_JOB_NAMES])
    expect(altered).toEqual([...STABLE_JOB_NAMES])
    expect(invariant).toEqual([...STABLE_JOB_NAMES])
    expect(reported).toEqual([...STABLE_JOB_NAMES])

    for (const name of STABLE_JOB_NAMES) {
      expect(sql).toContain(name)
    }
  })

  test('uses the exact rate-limit refresh command for the stable refresh job', () => {
    expect(sql).toContain(RATE_LIMIT_REFRESH_COMMAND)

    const refreshSchedule = sql.match(
      /cron\.schedule\(\s*'aawm_rate_limit_intervals_refresh',\s*'1,11,21,31,41,51 \* \* \* \*',\s*\$cmd\$([\s\S]*?)\$cmd\$/s
    )
    expect(refreshSchedule?.[1]?.trim()).toBe(RATE_LIMIT_REFRESH_COMMAND)

    const refreshAlter = sql.match(
      /cron\.alter_job\(\s*jobid,\s*schedule => '1,11,21,31,41,51 \* \* \* \*',\s*command => \$cmd\$([\s\S]*?)\$cmd\$/s
    )
    expect(refreshAlter?.[1]?.trim()).toBe(RATE_LIMIT_REFRESH_COMMAND)
  })

  test('unschedules only the four exact obsolete dashboard_shell_* names (no wildcard)', () => {
    const cleanup = extractUnscheduleContext(sql)
    expect(cleanup).toContain('cron.unschedule')
    for (const legacy of LEGACY_JOB_NAMES) {
      expect(cleanup).toContain(legacy)
    }

    // Explicitly forbid broad cleanup that could remove unrelated jobs.
    expect(cleanup).not.toContain("jobname LIKE 'dashboard_shell_%'")
    expect(sql).not.toContain("jobname LIKE 'dashboard_shell_%'")
    expect(sql).not.toMatch(/LIKE\s+'dashboard_shell_%'/)

    const scheduled = extractCronScheduleNames(sql)
    const altered = extractAlterJobNames(sql)
    const invariant = extractInvariantExpectedNames(sql)
    const reported = extractFinalReportNames(sql)

    for (const legacy of LEGACY_JOB_NAMES) {
      expect(scheduled).not.toContain(legacy)
      expect(altered).not.toContain(legacy)
      expect(invariant).not.toContain(legacy)
      expect(reported).not.toContain(legacy)
    }

    // No cron.schedule call may introduce a dashboard_shell_* owner.
    expect(scheduled.some((name) => name.startsWith('dashboard_shell_'))).toBe(
      false
    )
  })

  test('enforces expected-name VALUES LEFT JOIN cardinality including missing jobs', () => {
    expect(sql).toMatch(
      /FROM\s*\(\s*VALUES\s*[\s\S]*?\)\s*AS expected\(expected_name\)\s*LEFT JOIN cron\.job/s
    )
    expect(sql).toContain('count(cron.job.jobid) AS job_count')
    expect(sql).toContain('HAVING count(cron.job.jobid) <> 1')
    expect(sql).toContain(
      "RAISE EXCEPTION 'dashboard-shell pg_cron job name invariant failed:"
    )

    const expected = extractInvariantExpectedNames(sql)
    expect(expected).toEqual([...STABLE_JOB_NAMES])

    // Zero-count detection requires counting joined jobids, not row count(*).
    expect(sql).not.toMatch(
      /LEFT JOIN cron\.job[\s\S]*HAVING count\(\*\)\s*<>\s*1/s
    )
  })

  test('creates missing stable jobs only when absent (preserves existing job 24)', () => {
    for (const name of STABLE_JOB_NAMES) {
      const pattern = new RegExp(
        `cron\\.schedule\\(\\s*'${name}'[\\s\\S]*?WHERE NOT EXISTS \\(\\s*SELECT 1 FROM cron\\.job WHERE jobname = '${name}'\\s*\\)`,
        's'
      )
      expect(sql).toMatch(pattern)
    }
  })
})
