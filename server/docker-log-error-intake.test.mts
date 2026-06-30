import { execFile } from 'node:child_process'
import { appendFile, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, test } from 'vitest'
import {
  appendDockerLogErrorsToIntake,
  loadPersistedDockerLogErrorFingerprintsFromJsonl,
  discoverDockerJsonLogSourcesFromConfigs,
  matchDockerJsonLogContainer,
  shouldDiscoverDockerJsonLogSources,
  splitDockerLogErrorsForDashboardAndIntake,
  buildDockerLogErrorFingerprint,
  capDockerLogErrorsForDashboard,
  extractDockerLogErrorsFromTail,
  selectNewDockerLogErrors,
  inferLogLevel,
  isActionableErrorLog,
  isInformationalErrorMention,
  buildDockerLogErrorRow,
  safeContainerErrorIntakeBasename,
  filterDockerLogErrorsForCentralizedIntake,
  isRepoOwnedDockerLogContainerName,
} from './docker-log-error-intake.mjs'

const execFileAsync = promisify(execFile)

describe('docker-log-error-intake', () => {
  let tmpDirs = []

  afterEach(async () => {
    await Promise.all(tmpDirs.map((dir) => rm(dir, { recursive: true, force: true })))
    tmpDirs = []
  })

  test('report-service INFO docker log error row append message is not actionable', () => {
    const msg =
      '[report-service] INFO: appended 11 docker log error row(s) to /workspace/dashboard-shell/.analysis'
    expect(isInformationalErrorMention(msg)).toBe(true)
    expect(isActionableErrorLog(msg)).toBe(false)
  })

  test('INFO lines that only mention error in non-failure context are not extracted from Docker JSON tail', () => {
    const msg =
      '[report-service] INFO: appended 3 docker log error rows to /workspace/dashboard-shell/.analysis'
    const tail = `${JSON.stringify({
      time: new Date().toISOString(),
      stream: 'stdout',
      log: msg,
    })}\n`
    const rows = extractDockerLogErrorsFromTail({
      tailText: tail,
      container: 'dashboard-shell-reports-dev',
      cutoffMs: Date.now() - 60_000,
      source: { sourceIdentity: 'docker-json-log' },
    })
    expect(rows).toHaveLength(0)
    expect(buildDockerLogErrorRow(JSON.parse(tail.trim()), 'dashboard-shell-reports-dev')).toBeNull()
  })

  test('successful HTTP 200 nginx asset access logs with error-like filenames are not actionable', () => {
    const msg =
      '172.24.0.1 - - [30/Jun/2026:13:14:18 +0000] "GET /assets/general-error-IdO0Kgsj.js HTTP/1.1" 200 1989 "-" "-" "-"'
    expect(isActionableErrorLog(msg)).toBe(false)
    expect(
      buildDockerLogErrorRow(
        { time: '2026-06-30T13:14:18.000Z', stream: 'stdout', log: msg },
        'dashboard-shell'
      )
    ).toBeNull()
  })

  test('500 nginx asset access logs remain actionable with extracted status code', () => {
    const msg =
      '172.24.0.1 - - [30/Jun/2026:13:14:18 +0000] "GET /assets/not-found-error-nSd2gCZ4.js HTTP/1.1" 500 1989 "-" "-" "-"'
    expect(isActionableErrorLog(msg)).toBe(true)
    const row = buildDockerLogErrorRow(
      { time: '2026-06-30T13:14:18.000Z', stream: 'stdout', log: msg },
      'dashboard-shell'
    )
    expect(row?.status_code).toBe(500)
  })

  test('real failures stay actionable including 5xx connection refused timeout and exception', () => {
    const cases = [
      'upstream connection refused while proxying request status 502',
      'request failed: ETIMEDOUT after 30000ms',
      'ERROR: database query failed with exception',
      'Traceback (most recent call last): ValueError',
      'CRITICAL: worker crashed',
    ]
    for (const msg of cases) {
      expect(isActionableErrorLog(msg), msg).toBe(true)
    }
  })

  test('classifies connection failures and 5xx as error severity', () => {
    const msg = 'upstream connection refused while proxying request status 502'
    expect(isActionableErrorLog(msg)).toBe(true)
    expect(inferLogLevel(msg)).toBe('error')
  })

  test('redis cache wait fallback warning is not an actionable error', () => {
    const msg =
      '[report-service] WARN: timed out waiting for Redis cache refresh for usage-quota-range-history:abc123; falling back to SQL.'
    expect(isActionableErrorLog(msg)).toBe(false)
    expect(
      buildDockerLogErrorRow(
        { time: '2026-06-30T02:42:03.000Z', stream: 'stderr', log: msg },
        'dashboard-shell-reports-dev'
      )
    ).toBeNull()
  })

  test('container wrapper skips redis cache wait fallback warning', async () => {
    const intakeDir = await mkdtemp(path.join(os.tmpdir(), 'd1-437-wrapper-'))
    tmpDirs.push(intakeDir)
    const msg =
      '[report-service] WARN: timed out waiting for Redis cache refresh for usage-v2:abc123; falling back to SQL.'

    await execFileAsync(
      'sh',
      [
        path.resolve('scripts/container-error-intake.sh'),
        'sh',
        '-c',
        `printf '%s\\n' "${msg}" >&2`,
      ],
      {
        env: {
          ...process.env,
          SHELL_CONTAINER_NAME: 'dashboard-shell-reports-dev',
          SHELL_CONTAINER_ERROR_INTAKE_DIR: intakeDir,
        },
      }
    )

    await expect(readdir(intakeDir)).resolves.toEqual([])
  })


  test('status extraction ignores decimal timestamps package counts and bare port numbers', () => {
    const falsePositives = [
      '2026-06-28 21:31:54.557 upstream healthy',
      'added 537 packages in 12s',
      'audited 538 packages in 2s',
      'listening on http://127.0.0.1:5020/api',
      'connected to postgres://db:5432/main',
      'D1-424 reopened for per-container intake',
      'ERROR: D1-424 reopened without an HTTP status',
    ]
    for (const msg of falsePositives) {
      const row = buildDockerLogErrorRow(
        { time: '2026-06-28T21:31:54.000Z', stream: 'stdout', log: msg },
        'dashboard-shell-dev'
      )
      expect(row?.status_code ?? null, msg).toBeNull()
    }
  })

  test('status extraction keeps actionable HTTP and token-delimited error codes', () => {
    const cases = [
      ['upstream returned status 502 while proxying', 502],
      ['HTTP 503 from provider', 503],
      ['ERROR: D1-424 per-container smoke status 502', 502],
      ['request failed with HTTP/1.1 404 and status 502', 502],
      ['ERROR upstream gateway failure 502', 502],
    ]
    for (const [msg, expected] of cases) {
      const row = buildDockerLogErrorRow(
        { time: '2026-06-28T21:26:28.000Z', stream: 'stderr', log: msg },
        'dashboard-shell-dev'
      )
      expect(row?.status_code, msg).toBe(expected)
    }
  })

  test('status extraction prefers real 5xx when issue ids contain 4xx-looking tokens', () => {
    const msg = 'ERROR: D1-424 per-container smoke status 502'
    const row = buildDockerLogErrorRow(
      {
        time: '2026-06-28T21:26:28.000Z',
        stream: 'stderr',
        log: msg,
      },
      'dashboard-shell-dev'
    )
    expect(row?.status_code).toBe(502)
  })

  test('dependency audit summaries and routine shutdown logs are not actionable errors', () => {
    const falsePositives = [
      'added 537 packages, and audited 538 packages in 20s',
      '27 vulnerabilities (5 low, 13 moderate, 7 high, 2 critical)',
      '14:M 28 Jun 2026 21:31:54.557 * User requested shutdown...',
      '14:M 28 Jun 2026 21:31:54.557 # Redis is now ready to exit, bye bye...',
    ]

    for (const msg of falsePositives) {
      expect(isActionableErrorLog(msg), msg).toBe(false)
      expect(
        buildDockerLogErrorRow(
          { time: '2026-06-28T21:31:54.000Z', stream: 'stdout', log: msg },
          'dashboard-shell-dev'
        ),
        msg
      ).toBeNull()
    }
  })

  test('selects unseen rows without mutating seen until append commits', () => {
    const tail = `${JSON.stringify({
      time: new Date().toISOString(),
      stream: 'stderr',
      log: 'ERROR: database query failed with exception',
    })}\n`
    const cutoff = Date.now() - 60_000
    const first = extractDockerLogErrorsFromTail({
      tailText: tail,
      container: 'dashboard-shell-reports-dev',
      cutoffMs: cutoff,
      source: { sourceIdentity: 'docker-json-log' },
    })
    expect(first).toHaveLength(1)

    const seen = new Set()
    const freshOnce = selectNewDockerLogErrors(first, seen)
    const freshTwice = selectNewDockerLogErrors(first, seen)
    expect(freshOnce).toHaveLength(1)
    expect(freshTwice).toHaveLength(1)
    expect(seen.size).toBe(0)
    expect(buildDockerLogErrorFingerprint(first[0])).toBe(first[0].fingerprint)
  })

  test('appends one jsonl row per container and commits fingerprints after success', async () => {
    const intakeDir = await mkdtemp(path.join(os.tmpdir(), 'd1-424-intake-'))
    tmpDirs.push(intakeDir)
    const row = {
      observed_at: '2026-06-28T18:41:00.000Z',
      container: 'dashboard-shell-reports-dev',
      stream: 'stderr',
      provider: 'unknown',
      status_code: 500,
      level: 'error',
      message: 'synthetic container failure for intake test',
      source_identity: 'test',
      source_path: null,
      fingerprint: 'abc123',
    }

    const seen = new Set()
    await appendDockerLogErrorsToIntake({
      intakeDir,
      rows: selectNewDockerLogErrors([row], seen),
      seenFingerprints: seen,
    })
    await appendDockerLogErrorsToIntake({
      intakeDir,
      rows: selectNewDockerLogErrors([row], seen),
      seenFingerprints: seen,
    })

    const filePath = path.join(intakeDir, `${safeContainerErrorIntakeBasename(row.container)}-error.jsonl`)
    const text = await readFile(filePath, 'utf8')
    expect(text.trim().split('\n')).toHaveLength(1)
    const parsed = JSON.parse(text.trim())
    expect(parsed.container).toBe(row.container)
    expect(parsed.fingerprint).toBeTruthy()
    expect(parsed.level).toBe('error')
    expect(seen.has(row.fingerprint)).toBe(true)
  })

  test('dashboard cap slices payload without dropping extra intake candidates', () => {
    const rows = Array.from({ length: 5 }, (_, index) => ({
      observed_at: `2026-06-28T18:4${index}:00.000Z`,
      container: 'dashboard-shell-reports-dev',
      stream: 'stderr',
      level: 'error',
      message: `failure ${index}`,
      fingerprint: `fp-${index}`,
    }))

    const capped = capDockerLogErrorsForDashboard(rows, 2)
    expect(capped).toHaveLength(2)
    expect(capped.map((row) => row.fingerprint)).toEqual(['fp-0', 'fp-1'])
    expect(rows).toHaveLength(5)
  })


  test('matches dev containers by exact Docker Name', () => {
    const config = {
      Name: '/dashboard-shell-reports-dev',
      Config: { Labels: { 'com.docker.compose.service': 'dashboard-shell-reports-dev' } },
    }
    const result = matchDockerJsonLogContainer(config, ['dashboard-shell-reports-dev'])
    expect(result).toEqual({
      matched: true,
      container: 'dashboard-shell-reports-dev',
      matchKind: 'exact',
    })
  })

  test('matches prod-style compose containers via service and repo project markers', () => {
    const config = {
      Name: '/dashboard-shell-dashboard-shell-reports-1',
      Config: {
        Labels: {
          'com.docker.compose.service': 'dashboard-shell-reports',
          'com.docker.compose.project': 'dashboard-shell',
          'com.docker.compose.project.working_dir': '/home/zepfu/projects/dashboard-shell',
          'com.docker.compose.project.config_files': '/home/zepfu/projects/dashboard-shell/docker-compose.yml',
        },
      },
    }
    const result = matchDockerJsonLogContainer(config, ['dashboard-shell-reports'])
    expect(result.matched).toBe(true)
    expect(result.matchKind).toBe('compose')
    expect(result.container).toBe('dashboard-shell-dashboard-shell-reports-1')
  })

  test('rejects same compose service from a different project path', () => {
    const config = {
      Name: '/otherproj-dashboard-shell-reports-1',
      Config: {
        Labels: {
          'com.docker.compose.service': 'dashboard-shell-reports',
          'com.docker.compose.project': 'otherproj',
          'com.docker.compose.project.working_dir': '/home/zepfu/projects/other-repo',
          'com.docker.compose.project.config_files': '/home/zepfu/projects/other-repo/docker-compose.yml',
        },
      },
    }
    const result = matchDockerJsonLogContainer(config, ['dashboard-shell-reports'])
    expect(result).toEqual({ matched: false, container: null, matchKind: null })
  })

  test('discover helper finds prod compose label match and builds json log path', () => {
    const sources = discoverDockerJsonLogSourcesFromConfigs(
      [
        {
          containerDir: '/host/docker/containers/abc123',
          entryId: 'abc123',
          config: {
            Name: '/dashboard-shell-aawm-dashboard-1',
            Config: {
              Labels: {
                'com.docker.compose.service': 'aawm-dashboard',
                'com.docker.compose.project.working_dir': '/home/zepfu/projects/dashboard-shell',
              },
            },
          },
        },
      ],
      ['aawm-dashboard']
    )
    expect(sources).toHaveLength(1)
    expect(sources[0].container).toBe('dashboard-shell-aawm-dashboard-1')
    expect(sources[0].logPath).toBe('/host/docker/containers/abc123/abc123-json.log')
    expect(sources[0].matchKind).toBe('compose')
  })

  test('dashboard row cap zero still leaves full sorted set for intake selection', () => {
    const rows = Array.from({ length: 3 }, (_, index) => ({
      observed_at: `2026-06-28T18:4${index}:00.000Z`,
      container: 'dashboard-shell-reports',
      stream: 'stderr',
      level: 'error',
      message: `failure ${index}`,
      fingerprint: `cap0-${index}`,
    }))
    const split = splitDockerLogErrorsForDashboardAndIntake(rows, 0)
    expect(split.forDashboard).toEqual([])
    expect(split.forIntake).toHaveLength(3)

    const seen = new Set()
    const fresh = selectNewDockerLogErrors(split.forIntake, seen)
    expect(fresh).toHaveLength(3)
    expect(shouldDiscoverDockerJsonLogSources(['dashboard-shell-reports'])).toBe(true)
  })


  test('existing JSONL fingerprint suppresses append and marks seen', async () => {
    const intakeDir = await mkdtemp(path.join(os.tmpdir(), 'd1-424-persist-'))
    tmpDirs.push(intakeDir)
    const row = {
      observed_at: '2026-06-28T18:41:00.000Z',
      container: 'aawm-litellm',
      stream: 'stderr',
      provider: 'openai',
      status_code: 500,
      level: 'error',
      message: 'duplicate smoke failure line',
      source_identity: 'test',
      source_path: null,
    }
    row.fingerprint = buildDockerLogErrorFingerprint(row)

    const filePath = path.join(intakeDir, `${safeContainerErrorIntakeBasename(row.container)}-error.jsonl`)
    await appendFile(
      filePath,
      `${JSON.stringify({ ...row, ingested_at: '2026-06-28T18:00:00.000Z' })}\n`,
      'utf8'
    )

    const seen = new Set()
    const result = await appendDockerLogErrorsToIntake({
      intakeDir,
      rows: [row],
      seenFingerprints: seen,
    })

    expect(result.appended).toBe(0)
    expect(result.skipped).toBe(1)
    expect(seen.has(row.fingerprint)).toBe(true)
    const text = await readFile(filePath, 'utf8')
    expect(text.trim().split('\n')).toHaveLength(1)
  })

  test('mixed existing and new rows appends only the new row once', async () => {
    const intakeDir = await mkdtemp(path.join(os.tmpdir(), 'd1-424-mixed-'))
    tmpDirs.push(intakeDir)
    const existing = {
      observed_at: '2026-06-28T18:41:00.000Z',
      container: 'litellm-dev',
      stream: 'stderr',
      provider: 'openai',
      status_code: 502,
      level: 'error',
      message: 'already on disk',
      source_identity: 'test',
      source_path: null,
    }
    existing.fingerprint = buildDockerLogErrorFingerprint(existing)

    const fresh = {
      observed_at: '2026-06-28T18:42:00.000Z',
      container: 'litellm-dev',
      stream: 'stderr',
      provider: 'openai',
      status_code: 503,
      level: 'error',
      message: 'brand new failure',
      source_identity: 'test',
      source_path: null,
    }
    fresh.fingerprint = buildDockerLogErrorFingerprint(fresh)

    const filePath = path.join(intakeDir, `${safeContainerErrorIntakeBasename(existing.container)}-error.jsonl`)
    await appendFile(
      filePath,
      `${JSON.stringify({ ...existing, ingested_at: '2026-06-28T18:00:00.000Z' })}\n`,
      'utf8'
    )

    const seen = new Set()
    const result = await appendDockerLogErrorsToIntake({
      intakeDir,
      rows: [existing, fresh],
      seenFingerprints: seen,
    })

    expect(result.appended).toBe(1)
    expect(result.skipped).toBe(1)
    expect(seen.has(existing.fingerprint)).toBe(true)
    expect(seen.has(fresh.fingerprint)).toBe(true)

    const lines = (await readFile(filePath, 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(2)
    const fps = lines.map((line) => JSON.parse(line).fingerprint)
    expect(fps).toContain(existing.fingerprint)
    expect(fps).toContain(fresh.fingerprint)
  })

  test('loadPersistedDockerLogErrorFingerprintsFromJsonl reads stored fingerprints', async () => {
    const intakeDir = await mkdtemp(path.join(os.tmpdir(), 'd1-424-load-'))
    tmpDirs.push(intakeDir)
    const filePath = path.join(intakeDir, 'litellm-dev-error.jsonl')
    await appendFile(
      filePath,
      `${JSON.stringify({ fingerprint: 'stored-fp-1', message: 'x', container: 'litellm-dev' })}\n`,
      'utf8'
    )
    const set = await loadPersistedDockerLogErrorFingerprintsFromJsonl(filePath)
    expect(set.has('stored-fp-1')).toBe(true)
  })

  test('append failure does not poison dedupe so retry can succeed', async () => {
    const intakeDir = await mkdtemp(path.join(os.tmpdir(), 'd1-424-intake-retry-'))
    tmpDirs.push(intakeDir)
    const row = {
      observed_at: '2026-06-28T18:41:00.000Z',
      container: 'dashboard-shell-reports-dev',
      stream: 'stderr',
      provider: 'unknown',
      status_code: 500,
      level: 'error',
      message: 'transient append failure should remain retryable',
      source_identity: 'test',
      source_path: null,
      fingerprint: 'retry-fp',
    }

    const seen = new Set()
    let appendAttempts = 0
    const failingAppend = async (...args) => {
      appendAttempts += 1
      if (appendAttempts === 1) {
        throw new Error('disk full')
      }
      return appendFile(...args)
    }

    await expect(
      appendDockerLogErrorsToIntake({
        intakeDir,
        rows: selectNewDockerLogErrors([row], seen),
        seenFingerprints: seen,
        appendFileFn: failingAppend,
      })
    ).rejects.toThrow('disk full')

    expect(seen.size).toBe(0)

    await appendDockerLogErrorsToIntake({
      intakeDir,
      rows: selectNewDockerLogErrors([row], seen),
      seenFingerprints: seen,
      appendFileFn: failingAppend,
    })

    expect(seen.has(row.fingerprint)).toBe(true)
    const filePath = path.join(intakeDir, `${safeContainerErrorIntakeBasename(row.container)}-error.jsonl`)
    const text = await readFile(filePath, 'utf8')
    expect(text.trim().split('\n')).toHaveLength(1)
  })


  test('repo-owned helper matches generated compose container names', () => {
    expect(isRepoOwnedDockerLogContainerName('dashboard-shell-dashboard-shell-reports-1')).toBe(
      true
    )
    expect(isRepoOwnedDockerLogContainerName('dashboard-shell-aawm-dashboard-1')).toBe(true)
    expect(isRepoOwnedDockerLogContainerName('dashboard-shell-aawm-litellm-1')).toBe(false)
    expect(isRepoOwnedDockerLogContainerName('otherproj-aawm-dashboard-1')).toBe(false)
  })

  test('repo-owned container rows are excluded from centralized report-service intake', () => {
    const rows = [
      {
        container: 'dashboard-shell-reports-dev',
        message: 'ERROR: synthetic',
        fingerprint: 'repo-1',
      },
      {
        container: 'dashboard-shell-dashboard-shell-reports-1',
        message: 'ERROR: prod report service',
        fingerprint: 'repo-prod-1',
      },
      {
        container: 'dashboard-shell-aawm-dashboard-1',
        message: 'ERROR: prod remote',
        fingerprint: 'repo-prod-2',
      },
      {
        container: 'aawm-litellm',
        message: 'ERROR: external',
        fingerprint: 'ext-1',
      },
      {
        container: 'other-thing',
        message: 'ERROR: other',
        fingerprint: 'oth-1',
      },
    ]
    const filtered = filterDockerLogErrorsForCentralizedIntake(rows, {
      env: { SHELL_REPORT_DOCKER_LOG_EXTERNAL_CONTAINERS: 'aawm-litellm,litellm-dev' },
    })
    expect(filtered.map((r) => r.container)).toEqual(['aawm-litellm', 'other-thing'])
    expect(isRepoOwnedDockerLogContainerName('dashboard-shell-redis')).toBe(true)
    expect(isRepoOwnedDockerLogContainerName('aawm-litellm')).toBe(false)
  })

})
